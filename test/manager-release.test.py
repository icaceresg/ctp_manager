"""Run locally (Linux/macOS): python3 -B test/manager-release.test.py -v."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import struct
import sys
import tarfile
import tempfile
import threading
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / 'infra/vps/cicd/manager_release.py'
SPEC = importlib.util.spec_from_file_location('ctp_manager_release', SOURCE)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

COMMIT = 'a' * 40
POSIX = os.name == 'posix'
STATUS = {'setup': True, 'authenticated': False, 'user': None, 'provider': 'ctp', 'web_origin': 'https://pre.playctp.com'}


def default_files():
    return {
        'server/index.js': b'console.log("manager");',
        'shared/access.js': b'export const staffOnly = true;',
        'dist/index.html': b'<!doctype html><script type="module" src="/assets/app-abc12345.js"></script>',
        'dist/assets/app-abc12345.js': b'console.log("compiled");',
        'package.json': b'{"name":"ctp-manager","type":"module"}',
        'package-lock.json': b'{"lockfileVersion":3}',
        'node_modules/express/package.json': b'{"name":"express"}',
        'node_modules/gopd/.eslintrc': b'{}',
    }


def manifest_for(files, commit=COMMIT, ref='refs/heads/pre', dirty=False):
    def entries(predicate):
        return [{'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
            for path, data in sorted(files.items()) if predicate(path)]
    return {'schemaVersion': 1, 'application': 'ctp-manager', 'repository': 'icaceresg/ctp_manager', 'ref': ref,
        'source': {'commit': commit, 'dirty': dirty, 'sha256': '0' * 64,
            'files': entries(lambda path: path.split('/')[0] in ('server', 'shared') or '/' not in path)},
        'build': {'sha256': '0' * 64, 'files': entries(lambda path: path.startswith('dist/'))},
        'dependencies': {'sha256': '0' * 64, 'files': entries(lambda path: path.startswith('node_modules/'))}}


def archive(files=None, manifest=None, extra=None):
    files = default_files() if files is None else files
    manifest = manifest_for(files) if manifest is None else manifest
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz', format=tarfile.USTAR_FORMAT) as package:
        for name, data in [('manifest.json', json.dumps(manifest).encode()), *sorted(files.items())]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            package.addfile(info, io.BytesIO(data))
        for info, data in extra or []:
            package.addfile(info, io.BytesIO(data) if data is not None else None)
    return buffer.getvalue()


def command_for(data, run_id='12', attempt='1', commit=COMMIT):
    return release.parse_command(f'deploy pre {commit} {run_id} {attempt} {hashlib.sha256(data).hexdigest()}', 'pre')


class FakeSystem:
    """systemd + HTTP double: the service runs whatever `current` points to when started."""

    def __init__(self, paths):
        self.paths = paths
        self.calls = []
        self.running = None
        self.clock = 0.0
        self.crashing = set()
        self.stale_index = set()
        self.public_down = False
        self.running = release.current_release(paths)

    def stop(self, service):
        self.calls.append('stop')
        self.running = None

    def start(self, service):
        self.calls.append('start')
        name = release.current_release(self.paths)
        self.running = None if name in self.crashing else name

    def restart(self, service):
        self.calls.append('restart')
        self.running = None
        self.start(service)
        self.calls.pop()

    def main_pid(self, service):
        return 4242 if self.running else 0

    def runs_in(self, pid, directory):
        return self.running is not None and Path(directory) == self.paths.releases / self.running

    def http_get(self, url, host=None, timeout=10):
        if url.startswith('https://'):
            release.require(not self.public_down, 'health_unreachable')
            return 200, json.dumps(STATUS).encode()
        assert host == 'pre.manager.playctp.com'
        release.require(self.running is not None, 'health_unreachable')
        if url.endswith('/api/auth/status'):
            return 200, json.dumps(STATUS).encode()
        if self.running in self.stale_index:
            return 200, b'<!doctype html>stale'
        return 200, (self.paths.releases / self.running / 'dist/index.html').read_bytes()

    def sleep(self, seconds):
        self.clock += seconds

    def monotonic(self):
        return self.clock


class CommandAndPathTests(unittest.TestCase):
    def test_command_is_exact(self):
        digest = 'b' * 64
        parsed = release.parse_command(f'deploy pre {COMMIT} 99 2 {digest}', 'pre')
        self.assertEqual(parsed['release'], f'{COMMIT}-99-2')
        for value in (f'deploy prod {COMMIT} 99 2 {digest}', f'deploy pre {COMMIT} 99 2 {digest} --x',
                f'deploy pre {COMMIT} 0 2 {digest}', f'deploy pre {COMMIT.upper()} 9 2 {digest}',
                f'deploy pre {COMMIT} 9 2 {digest}; id', '', 'deploy'):
            with self.subTest(value=value), self.assertRaises(release.ReleaseError):
                release.parse_command(value, 'pre')

    def test_member_paths(self):
        for value in ('../x', '/etc/passwd', 'dist/.env', 'data/myredesmanager.db', 'server//a.js', 'dist\\a.js',
                'server/../x', '.env', 'scripts/x.js', 'manifest.json/x', 'dist/a\nb'):
            with self.subTest(value=value), self.assertRaises(release.ReleaseError):
                release.safe_member(value)
        for value in ('node_modules/gopd/.eslintrc', 'dist/assets/app-abc12345.js', 'package.json', 'server'):
            self.assertEqual(release.safe_member(value), value)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        self.count = 0

    def check(self, data, command=None):
        self.count += 1
        path = self.base / f'upload-{self.count}.tar.gz'
        path.write_bytes(data)
        target = self.base / f'out-{self.count}'
        target.mkdir()
        files = release.unpack(path, target)
        return release.validate_manifest(target, files, release.ENVIRONMENTS['pre'], command or command_for(data))

    def test_valid_release(self):
        summary = self.check(archive())
        self.assertEqual(summary['files'], 8)
        self.assertEqual(summary['indexSha256'], hashlib.sha256(default_files()['dist/index.html']).hexdigest())

    def test_tampered_or_incomplete_releases_are_refused(self):
        files = default_files()
        tampered = dict(files, **{'server/index.js': b'console.log("other");'})
        undeclared = archive(manifest=manifest_for(files), files=dict(files, **{'server/extra.js': b'x'}))
        without_deps = {key: value for key, value in files.items() if not key.startswith('node_modules/')}
        cases = {
            'manifest_inventory_mismatch': archive(files=tampered, manifest=manifest_for(files)),
            'manifest_inventory_mismatch ': undeclared,
            'manifest_required_file_missing': archive(files=without_deps),
            'manifest_ref': archive(manifest=manifest_for(files, ref='refs/heads/main')),
            'manifest_dirty_source': archive(manifest=manifest_for(files, dirty=True)),
            'manifest_commit': archive(manifest=manifest_for(files, commit='c' * 40)),
        }
        for reason, data in cases.items():
            with self.subTest(reason=reason), self.assertRaises(release.ReleaseError) as caught:
                self.check(data, command_for(data))
            self.assertEqual(caught.exception.reason, reason.strip())

    def test_links_devices_and_hidden_application_files_are_refused(self):
        link = tarfile.TarInfo('dist/link')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/shadow'
        hard = tarfile.TarInfo('dist/hard')
        hard.type = tarfile.LNKTYPE
        hard.linkname = 'package.json'
        fifo = tarfile.TarInfo('dist/fifo')
        fifo.type = tarfile.FIFOTYPE
        hidden = tarfile.TarInfo('dist/.env')
        hidden.size = 1
        for info, data in ((link, None), (hard, None), (fifo, None), (hidden, b'x')):
            with self.subTest(member=info.name), self.assertRaises(release.ReleaseError):
                self.check(archive(extra=[(info, data)]))

    def test_duplicate_member_is_refused(self):
        duplicate = tarfile.TarInfo('server/index.js')
        duplicate.size = 1
        with self.assertRaises(release.ReleaseError) as caught:
            self.check(archive(extra=[(duplicate, b'x')]))
        self.assertEqual(caught.exception.reason, 'archive_duplicate_path')

    def test_limits_and_garbage(self):
        with self.assertRaises(release.ReleaseError) as caught:
            path = self.base / 'big.tar.gz'
            path.write_bytes(archive())
            (self.base / 'big').mkdir()
            release.unpack(path, self.base / 'big', dict(release.LIMITS, files=3))
        self.assertEqual(caught.exception.reason, 'archive_expanded_limit')
        with self.assertRaises(release.ReleaseError) as caught:
            self.check(b'not a tar archive')
        self.assertEqual(caught.exception.reason, 'archive_invalid')


@unittest.skipUnless(POSIX, 'release switching uses POSIX symlinks, fsync and flock')
class DeployTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        base = Path(os.path.realpath(self.directory.name))
        for name in ('srv', 'state', 'backups', 'data'):
            (base / name).mkdir(mode=0o700)
        (base / 'srv/releases').mkdir(mode=0o755)
        os.chmod(base / 'srv', 0o755)
        self.env = dict(release.ENVIRONMENTS['pre'], root=str(base / 'srv'), state=str(base / 'state'),
            backups=str(base / 'backups'), database=str(base / 'data/myredesmanager.db'), lock=str(base / 'deploy.lock'))
        self.paths = release.Paths(self.env)
        old = self.paths.releases / 'manual-959d704'
        (old / 'dist').mkdir(parents=True)
        (old / 'dist/index.html').write_bytes(b'<!doctype html>old')
        os.symlink(str(old), self.paths.current)
        self.database = sqlite3.connect(self.env['database'])
        self.addCleanup(self.database.close)
        self.database.execute('PRAGMA journal_mode=WAL')
        self.database.execute('CREATE TABLE cards (title TEXT)')
        self.database.execute("INSERT INTO cards VALUES ('Calendario')")
        self.database.commit()
        self.system = FakeSystem(self.paths)

    def deploy(self, data, **command):
        return release.deploy(self.env, command_for(data, **command), io.BytesIO(data), self.system, paths=self.paths)

    def test_successful_deploy_switches_backs_up_and_verifies(self):
        data = archive()
        receipt = self.deploy(data)
        name = f'{COMMIT}-12-1'
        self.assertEqual(receipt['status'], 'deployed')
        self.assertEqual(receipt['previous'], 'manual-959d704')
        self.assertEqual(release.current_release(self.paths), name)
        self.assertEqual(self.system.running, name)
        self.assertEqual(self.system.calls, ['stop', 'start'])
        self.assertFalse(self.paths.pending.exists())
        self.assertEqual(json.loads((self.paths.state / 'last-success.json').read_text())['release'], name)
        candidate = self.paths.releases / name
        self.assertEqual((candidate / 'server/index.js').stat().st_mode & 0o777, 0o644)
        self.assertEqual(candidate.stat().st_mode & 0o777, 0o755)
        self.assertTrue((candidate / 'manifest.json').is_file())
        backup = Path(receipt['backup']['path'])
        self.assertEqual(backup.parent.stat().st_mode & 0o777, 0o700)
        self.assertFalse(Path(str(backup) + '-wal').exists())
        copy = sqlite3.connect(backup)
        try:
            self.assertEqual(copy.execute('SELECT title FROM cards').fetchall(), [('Calendario',)])
            self.assertEqual(copy.execute('PRAGMA journal_mode').fetchone()[0], 'delete')
        finally:
            copy.close()

    def test_wrong_checksum_changes_nothing(self):
        data = archive()
        command = command_for(archive(files=dict(default_files(), **{'server/x.js': b'x'})))
        with self.assertRaises(release.ReleaseError) as caught:
            release.deploy(self.env, command, io.BytesIO(data), self.system, paths=self.paths)
        self.assertEqual(caught.exception.reason, 'archive_checksum')
        self.assertEqual(release.current_release(self.paths), 'manual-959d704')
        self.assertEqual(self.system.calls, [])
        self.assertEqual(sorted(path.name for path in self.paths.releases.iterdir()), ['manual-959d704'])

    def test_invalid_release_never_stops_the_service(self):
        data = archive(manifest=manifest_for(default_files(), ref='refs/heads/main'))
        with self.assertRaises(release.ReleaseError):
            self.deploy(data)
        self.assertEqual(self.system.calls, [])
        self.assertEqual(sorted(path.name for path in self.paths.releases.iterdir()), ['manual-959d704'])

    def test_stale_build_rolls_back_to_previous(self):
        self.system.stale_index.add(f'{COMMIT}-12-1')
        with self.assertRaises(release.ReleaseError) as caught:
            self.deploy(archive())
        self.assertEqual(caught.exception.reason, 'health_local_index')
        self.assertEqual(caught.exception.details['rolledBack'], True)
        self.assertEqual(caught.exception.details['running'], 'manual-959d704')
        self.assertEqual(release.current_release(self.paths), 'manual-959d704')
        self.assertEqual(self.system.running, 'manual-959d704')
        self.assertFalse(self.paths.pending.exists())

    def test_crashing_release_rolls_back_after_the_start_window(self):
        self.system.crashing.add(f'{COMMIT}-12-1')
        with self.assertRaises(release.ReleaseError) as caught:
            self.deploy(archive())
        self.assertEqual(caught.exception.reason, 'service_not_running')
        self.assertTrue(caught.exception.details['rolledBack'])
        self.assertGreaterEqual(self.system.clock, self.env['startSeconds'])
        self.assertEqual(self.system.running, 'manual-959d704')

    def test_public_failure_rolls_back_and_reports_it(self):
        self.system.public_down = True
        with self.assertRaises(release.ReleaseError) as caught:
            self.deploy(archive())
        self.assertEqual(caught.exception.reason, 'health_unreachable')
        self.assertTrue(caught.exception.details['rolledBack'])
        self.assertEqual(release.current_release(self.paths), 'manual-959d704')

    def test_failed_rollback_keeps_pending_for_recovery(self):
        self.system.crashing.update({f'{COMMIT}-12-1', 'manual-959d704'})
        with self.assertRaises(release.ReleaseError) as caught:
            self.deploy(archive())
        self.assertFalse(caught.exception.details['rolledBack'])
        self.assertTrue(self.paths.pending.exists())
        self.system.crashing.clear()
        receipt = self.deploy(archive(), run_id='13')
        self.assertTrue(receipt['recoveredPending'])
        self.assertEqual(receipt['previous'], 'manual-959d704')
        self.assertEqual(release.current_release(self.paths), f'{COMMIT}-13-1')

    def test_interrupted_switch_is_recovered_before_the_next_release(self):
        first = self.deploy(archive())
        release.atomic_json(self.paths.pending, {'schemaVersion': 1, 'candidate': first['release'],
            'previous': 'manual-959d704'})
        receipt = self.deploy(archive(), run_id='14')
        self.assertTrue(receipt['recoveredPending'])
        self.assertEqual(receipt['previous'], 'manual-959d704')

    def test_same_release_is_not_overwritten(self):
        self.deploy(archive())
        with self.assertRaises(release.ReleaseError) as caught:
            self.deploy(archive())
        self.assertEqual(caught.exception.reason, 'release_already_exists')

    def test_concurrent_deploy_is_refused(self):
        import fcntl
        descriptor = os.open(self.env['lock'], os.O_RDWR | os.O_CREAT, 0o600)
        self.addCleanup(os.close, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        with self.assertRaises(release.ReleaseError) as caught:
            self.deploy(archive())
        self.assertEqual(caught.exception.reason, 'deployment_locked')

    def test_retention_only_removes_old_ci_releases(self):
        for run_id in range(20, 28):
            self.deploy(archive(), run_id=str(run_id))
        names = sorted(path.name for path in self.paths.releases.iterdir())
        self.assertIn('manual-959d704', names)
        kept = sorted(int(name.split('-')[1]) for name in names if name != 'manual-959d704')
        self.assertEqual(kept, [23, 24, 25, 26, 27])
        self.assertEqual(len(list(self.paths.backups.iterdir())), 8)
        release.prune(self.paths, 1, 2, {f'{COMMIT}-27-1', f'{COMMIT}-23-1'})
        names = sorted(path.name for path in self.paths.releases.iterdir())
        self.assertEqual(names, [f'{COMMIT}-23-1', f'{COMMIT}-27-1', 'manual-959d704'])
        self.assertEqual(sorted(path.name for path in self.paths.backups.iterdir()), [f'{COMMIT}-26-1', f'{COMMIT}-27-1'])


@unittest.skipUnless(POSIX and hasattr(socket, 'AF_UNIX'), 'needs Unix sockets')
class ClientTests(unittest.TestCase):
    def serve_once(self, path, reply, read_body=True):
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(path)
        server.listen(1)
        received = {}
        def run():
            connection, _ = server.accept()
            with connection, connection.makefile('rb', buffering=0) as stream:
                received['command'] = release.read_header(stream)
                if read_body:
                    received['body'] = stream.read()
                connection.sendall(json.dumps(reply).encode() + b'\n')
            server.close()
        thread = threading.Thread(target=run)
        thread.start()
        return thread, received

    def test_streams_upload_and_returns_reply(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'b.sock')
            original = f'deploy pre {COMMIT} 1 1 {"d" * 64}'
            thread, received = self.serve_once(path, {'status': 'deployed', 'release': 'x'})
            with mock.patch.dict(release.ENVIRONMENTS['pre'], {'socket': path}):
                result = release.client('pre', original, io.BytesIO(b'payload' * 1000))
            thread.join(5)
            self.assertEqual(result['status'], 'deployed')
            self.assertEqual(received['command'], original)
            self.assertEqual(received['body'], b'payload' * 1000)

    def test_early_broker_refusal_still_reaches_github(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'b.sock')
            thread, _ = self.serve_once(path, {'status': 'failed', 'reason': 'deployment_locked'}, read_body=False)
            with mock.patch.dict(release.ENVIRONMENTS['pre'], {'socket': path}):
                result = release.client('pre', f'deploy pre {COMMIT} 1 1 {"d" * 64}', io.BytesIO(os.urandom(8 * 1024 * 1024)))
            thread.join(5)
            self.assertEqual(result, {'status': 'failed', 'reason': 'deployment_locked'})

    def test_client_refuses_other_commands_before_connecting(self):
        with mock.patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': 'sh -c id'}), \
                contextlib.redirect_stderr(io.StringIO()) as error, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(release.main(['client']), 1)
        self.assertEqual(json.loads(error.getvalue())['reason'], 'invalid_command')


class InstallerRenderTests(unittest.TestCase):
    @staticmethod
    def key(byte=1, comment=b' laptop'):
        raw = struct.pack('>I', 11) + b'ssh-ed25519' + struct.pack('>I', 32) + bytes([byte]) * 32
        return b'ssh-ed25519 ' + base64.b64encode(raw) + comment

    def test_public_key_validation(self):
        key, fingerprint = release.parse_public_key(self.key())
        self.assertTrue(fingerprint.startswith('SHA256:'))
        self.assertNotIn('laptop', key)
        for value in (self.key() + b'\n' + self.key(2), b'command="id" ' + self.key(), b'ssh-rsa AAAA',
                b'-----BEGIN OPENSSH PRIVATE KEY-----', b'ssh-ed25519 not-base64'):
            with self.subTest(value=value[:24]), self.assertRaises(release.ReleaseError):
                release.parse_public_key(value)

    def test_forced_command_and_ssh_policy(self):
        text = release.wrapper('pre').decode()
        self.assertIn('/usr/bin/env -i ', text)
        self.assertIn('/usr/bin/python3 -I /usr/local/libexec/ctp-manager-release.py client --environment pre', text)
        self.assertIn('SSH_ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND-}"', text)
        self.assertNotIn('eval', text)
        self.assertNotIn('sudo', text)
        key, _ = release.parse_public_key(self.key())
        line = release.authorized_key('pre', key).decode()
        self.assertTrue(line.startswith('restrict,command="/usr/local/libexec/ctp-manager-deploy-pre" ssh-ed25519 '))
        policy = release.sshd_fragment('pre').decode()
        self.assertIn('Match User ctp-manager-deploy-pre\n', policy)
        self.assertTrue(policy.endswith('Match all\n'))
        for setting in ('PasswordAuthentication no', 'PermitTTY no', 'DisableForwarding yes', 'PermitUserRC no',
                'ForceCommand /usr/local/libexec/ctp-manager-deploy-pre'):
            self.assertIn(setting, policy)

    def test_units_bind_the_socket_to_the_deploy_group(self):
        unit = release.socket_unit('pre').decode()
        self.assertIn('SocketGroup=ctp-manager-deploy-pre', unit)
        self.assertIn('SocketMode=0660', unit)
        self.assertIn('Accept=yes', unit)
        service = release.service_unit('pre').decode()
        self.assertIn('broker --environment pre', service)
        self.assertIn('StandardInput=socket', service)
        files = release.managed_files('pre', 'ssh-ed25519 AAAA', b'helper')
        self.assertIn(Path('/etc/systemd/system/ctp-manager-release-pre@.service'), files)

    def test_installed_helper_is_this_file_with_unix_newlines(self):
        data = release.normalized_helper(SOURCE.read_bytes().replace(b'\n', b'\r\n').replace(b'\r\r\n', b'\r\n'))
        self.assertNotIn(b'\r\n', data)
        with self.assertRaises(release.ReleaseError):
            release.normalized_helper(b'print("other")')


if __name__ == '__main__':
    unittest.main()
