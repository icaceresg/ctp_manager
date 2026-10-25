#!/usr/bin/env python3
"""CTP Manager VPS releases: restricted SSH client, root broker and installer.

client   Forced SSH command of the deploy account. Streams the upload to the
         broker socket and relays its JSON receipt. No shell, no sudo.
broker   Root, socket-activated per connection. Verifies the peer, the
         checksum and every file of the manifest, installs an immutable
         release, backs up SQLite, switches `current`, restarts the Manager
         service, verifies the new process and rolls back on any failure.
install  Root, run once by hand. Creates the deploy account, its SSH policy,
         the forced command and the broker units. Never publishes a release.

Nothing from the upload runs as root: the only program started is the
existing systemd unit, which runs the release with the pinned Node runtime.
"""
from __future__ import annotations

import argparse
import ast
import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import zlib

MIB = 1024 * 1024
APPLICATION = 'ctp-manager'
REPOSITORY = 'icaceresg/ctp_manager'
HELPER = '/usr/local/libexec/ctp-manager-release.py'
CONFIG_ROOT = '/etc/ctp-manager-deploy'
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
RELEASE = re.compile(r'([0-9a-f]{40})-([1-9][0-9]{0,19})-([1-9][0-9]{0,5})\Z')
ANY_RELEASE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,159}\Z')
LIMITS = {'compressed': 200 * MIB, 'expanded': 600 * MIB, 'files': 20000, 'manifest': 8 * MIB}
ROOT_FILES = frozenset({'manifest.json', 'package.json', 'package-lock.json'})
ROOT_DIRS = frozenset({'server', 'shared', 'dist', 'node_modules'})
REQUIRED_FILES = ('server/index.js', 'dist/index.html', 'package.json', 'package-lock.json',
    'node_modules/express/package.json')

ENVIRONMENTS = {
    'pre': {
        'environment': 'pre',
        'ref': 'refs/heads/pre',
        'deployUser': 'ctp-manager-deploy-pre',
        'root': '/srv/ctp-manager/pre',
        'service': 'ctp-manager-pre.service',
        'serviceUser': 'ctp-manager-pre',
        'database': '/var/lib/ctp-manager-pre/myredesmanager.db',
        'state': '/var/lib/ctp-manager-release/pre',
        'backups': '/var/backups/ctp-manager-release/pre',
        'socket': '/run/ctp-manager-release/pre.sock',
        'lock': '/run/lock/ctp-manager-release-pre.lock',
        'port': 3210,
        'publicOrigin': 'https://pre.manager.playctp.com',
        'ctpOrigin': 'https://pre.playctp.com',
        'keepReleases': 5,
        'keepBackups': 10,
        'startSeconds': 45,
    },
}


class ReleaseError(Exception):
    def __init__(self, reason, details=None):
        super().__init__(reason)
        self.reason = reason
        self.details = details


def require(condition, reason):
    if not condition:
        raise ReleaseError(reason)


def reason_of(error, fallback):
    reason = error.reason if isinstance(error, ReleaseError) else fallback
    return reason if isinstance(reason, str) and re.fullmatch(r'[a-z0-9_]{1,80}', reason) else fallback


def environment_config(name):
    require(name in ENVIRONMENTS, 'unknown_environment')
    return ENVIRONMENTS[name]


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    def constant(value):
        raise ReleaseError('invalid_json_constant')
    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, TypeError) as error:
        raise ReleaseError('invalid_json') from error


def sha256_file(path):
    hasher = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(64 * 1024), b''):
            hasher.update(block)
    return hasher.hexdigest()


def regular_file(path):
    try:
        return stat.S_ISREG(Path(path).lstat().st_mode)
    except FileNotFoundError:
        return False


def sync_directory(path):
    if os.name == 'posix':
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def atomic_json(path, value):
    path = Path(path)
    require(not path.is_symlink(), 'state_symlink')
    descriptor, temporary = tempfile.mkstemp(prefix='.state-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, separators=(',', ':'), sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parse_command(original, environment):
    require(isinstance(original, str) and len(original) <= 256, 'invalid_command')
    match = re.fullmatch(r'deploy ([a-z]{2,8}) ([0-9a-f]{40}) ([1-9][0-9]{0,19}) ([1-9][0-9]{0,5}) ([0-9a-f]{64})', original)
    require(match is not None, 'invalid_command')
    name, commit, run_id, attempt, checksum = match.groups()
    require(name == environment, 'wrong_environment')
    return {'environment': name, 'commit': commit, 'runId': run_id, 'attempt': attempt,
        'checksum': checksum, 'release': f'{commit}-{run_id}-{attempt}'}


# --- Archive -----------------------------------------------------------------

def safe_member(name):
    require(isinstance(name, str) and 0 < len(name) <= 512, 'archive_path')
    require(not any(ord(char) < 32 or ord(char) == 127 for char in name) and '\\' not in name, 'archive_path')
    path = PurePosixPath(name)
    require(not path.is_absolute() and path.as_posix() == name, 'archive_path_noncanonical')
    parts = path.parts
    require(all(part not in ('', '.', '..') for part in parts), 'archive_path_escape')
    top = parts[0]
    require((top in ROOT_FILES and len(parts) == 1) or top in ROOT_DIRS, 'archive_unexpected_path')
    # npm packages ship dotfiles; the application's own trees must not.
    require(top == 'node_modules' or not any(part.startswith('.') for part in parts), 'archive_hidden_path')
    return name


def receive(source, path, limit, expected):
    total, hasher = 0, hashlib.sha256()
    with open(path, 'xb') as destination:
        os.chmod(path, 0o600)
        while True:
            data = source.read(min(64 * 1024, limit - total + 1))
            if not data:
                break
            total += len(data)
            require(total <= limit, 'archive_compressed_limit')
            hasher.update(data)
            destination.write(data)
    require(total > 0 and hasher.hexdigest() == expected, 'archive_checksum')


def unpack(archive, destination, limits=LIMITS):
    """Extract regular files and directories only. Returns {path: (bytes, sha256)}."""
    files, directories, total, entries = {}, set(), 0, 0

    class StrictTarInfo(tarfile.TarInfo):
        def _proc_member(self, package):
            # Refuse PAX/GNU extension headers before tarfile reads their bodies.
            require(self.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE), 'archive_special_file')
            require(0 <= self.size <= limits['expanded'], 'archive_expanded_limit')
            return super()._proc_member(package)

    try:
        with tarfile.open(archive, mode='r|gz', tarinfo=StrictTarInfo) as package:
            for member in package:
                entries += 1
                require(entries <= limits['files'] * 2 + 16, 'archive_entry_limit')
                name = member.name.rstrip('/') if member.isdir() else member.name
                safe_member(name)
                require(name not in files and name not in directories, 'archive_duplicate_path')
                require(not member.pax_headers and member.sparse is None, 'archive_extended_metadata')
                require(member.isdir() or member.isfile(), 'archive_special_file')
                parts = PurePosixPath(name).parts
                for depth in range(1, len(parts)):
                    require('/'.join(parts[:depth]) not in files, 'archive_file_directory_conflict')
                target = destination / name
                if member.isdir():
                    require(parts[0] in ROOT_DIRS and member.size == 0, 'archive_unexpected_directory')
                    target.mkdir(parents=True, exist_ok=True, mode=0o700)
                    directories.add(name)
                    continue
                require(len(parts) > 1 or name in ROOT_FILES, 'archive_unexpected_path')
                require(name not in directories, 'archive_file_directory_conflict')
                require(type(member.size) is int and member.size >= 0, 'archive_file_size')
                total += member.size
                require(total <= limits['expanded'] and len(files) < limits['files'], 'archive_expanded_limit')
                require(name != 'manifest.json' or member.size <= limits['manifest'], 'archive_manifest_limit')
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                data = package.extractfile(member)
                require(data is not None, 'archive_missing_data')
                hasher = hashlib.sha256()
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
                with data, os.fdopen(descriptor, 'wb') as output:
                    remaining = member.size
                    while remaining:
                        block = data.read(min(64 * 1024, remaining))
                        require(block, 'archive_truncated')
                        output.write(block)
                        hasher.update(block)
                        remaining -= len(block)
                files[name] = (member.size, hasher.hexdigest())
    except (tarfile.TarError, EOFError, OSError, zlib.error) as error:
        raise ReleaseError('archive_invalid') from error
    require('manifest.json' in files, 'archive_manifest_missing')
    return files


def validate_manifest(destination, files, env, command):
    manifest = strict_json((destination / 'manifest.json').read_bytes())
    require(isinstance(manifest, dict) and manifest.get('schemaVersion') == 1, 'manifest_schema')
    require(manifest.get('application') == APPLICATION and manifest.get('repository') == REPOSITORY,
        'manifest_application')
    require(manifest.get('ref') == env['ref'], 'manifest_ref')
    groups = {key: manifest.get(key) for key in ('source', 'build', 'dependencies')}
    require(all(isinstance(group, dict) and isinstance(group.get('files'), list) for group in groups.values()),
        'manifest_groups')
    require(groups['source'].get('commit') == command['commit'], 'manifest_commit')
    require(groups['source'].get('dirty') is False, 'manifest_dirty_source')
    owners = {
        'source': lambda path: path in ('package.json', 'package-lock.json') or path.split('/')[0] in ('server', 'shared'),
        'build': lambda path: path.startswith('dist/'),
        'dependencies': lambda path: path.startswith('node_modules/'),
    }
    declared = {}
    for key, group in groups.items():
        for entry in group['files']:
            require(isinstance(entry, dict) and set(entry) == {'path', 'sha256', 'bytes'}, 'manifest_file_schema')
            path = entry['path']
            safe_member(path)
            require(path != 'manifest.json' and owners[key](path) and path not in declared, 'manifest_file_owner')
            require(isinstance(entry['sha256'], str) and HEX64.fullmatch(entry['sha256']), 'manifest_file_digest')
            require(type(entry['bytes']) is int and entry['bytes'] >= 0, 'manifest_file_bytes')
            declared[path] = (entry['bytes'], entry['sha256'])
    require(all(path in declared for path in REQUIRED_FILES), 'manifest_required_file_missing')
    actual = {path: value for path, value in files.items() if path != 'manifest.json'}
    require(actual == declared, 'manifest_inventory_mismatch')
    return {'commit': command['commit'], 'indexSha256': declared['dist/index.html'][1],
        'files': len(declared), 'expandedBytes': sum(size for size, _ in declared.values())}


def make_readable(tree):
    for parent, directories, names in os.walk(tree, followlinks=False):
        os.chmod(parent, 0o755)
        for name in directories:
            require(not (Path(parent) / name).is_symlink(), 'release_symlink')
        for name in names:
            path = Path(parent) / name
            require(regular_file(path), 'release_special_file')
            os.chmod(path, 0o644)


# --- Release tree ------------------------------------------------------------

class Paths:
    def __init__(self, env):
        self.root = Path(env['root'])
        self.releases = self.root / 'releases'
        self.current = self.root / 'current'
        self.state = Path(env['state'])
        self.backups = Path(env['backups'])
        self.database = Path(env['database'])
        self.lock = Path(env['lock'])
        self.pending = self.state / 'pending.json'


def checked_directory(path, *, private=False):
    path = Path(path)
    require(path.is_absolute() and path.is_dir() and not path.is_symlink(), 'directory_missing_or_symlink')
    require(Path(os.path.realpath(path)) == path, 'directory_not_canonical')
    if os.name == 'posix':
        info = path.stat()
        require(info.st_uid == os.geteuid() and not info.st_mode & (0o077 if private else 0o022),
            'directory_owner_or_mode')


def current_release(paths):
    if not paths.current.is_symlink():
        require(not paths.current.exists(), 'current_not_symlink')
        return None
    target = Path(os.path.realpath(paths.current))
    require(target.parent == paths.releases and ANY_RELEASE.fullmatch(target.name)
        and target.is_dir() and not target.is_symlink(), 'current_outside_releases')
    return target.name


def switch_current(paths, name):
    require(isinstance(name, str) and ANY_RELEASE.fullmatch(name), 'invalid_release_name')
    target = paths.releases / name
    require(target.is_dir() and not target.is_symlink(), 'release_missing')
    current_release(paths)  # Refuse an unexpected file where the link lives.
    temporary = paths.root / f'.current-{os.urandom(8).hex()}'
    try:
        os.symlink(str(target), temporary, target_is_directory=True)
        os.replace(temporary, paths.current)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)
    sync_directory(paths.root)


def backup_database(paths, name):
    """Copy SQLite while Manager is stopped; the live files are never opened."""
    import sqlite3
    source = paths.database
    if not source.exists() and not source.is_symlink():
        return None
    require(regular_file(source), 'database_not_regular')
    folder = paths.backups / name
    folder.mkdir(mode=0o700)
    target = folder / source.name
    shutil.copyfile(source, target, follow_symlinks=False)
    os.chmod(target, 0o600)
    wal = source.with_name(source.name + '-wal')
    if regular_file(wal):
        shutil.copyfile(wal, target.with_name(target.name + '-wal'), follow_symlinks=False)
    connection = sqlite3.connect(str(target))
    try:
        mode = connection.execute('PRAGMA journal_mode=DELETE').fetchone()[0]
        require(mode == 'delete', 'backup_journal_mode')
        require(connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'backup_integrity_failed')
    finally:
        connection.close()
    for suffix in ('-wal', '-shm', '-journal'):
        leftover = target.with_name(target.name + suffix)
        if leftover.exists():
            leftover.unlink()
    return {'path': str(target), 'sha256': sha256_file(target), 'bytes': target.stat().st_size}


def prune(paths, keep_releases, keep_backups, protect):
    """Remove CI releases and deploy backups beyond retention; never the protected releases.

    Only names created by this tool are considered: manual releases stay.
    """
    def ordered(folder):
        if not folder.is_dir():
            return []
        items = [item for item in folder.iterdir() if RELEASE.fullmatch(item.name)
            and item.is_dir() and not item.is_symlink()]
        return sorted(items, key=lambda item: tuple(int(value) for value in RELEASE.fullmatch(item.name).groups()[1:]),
            reverse=True)
    removed = {'releases': [], 'backups': []}
    for key, folder, keep in (('releases', paths.releases, keep_releases), ('backups', paths.backups, keep_backups)):
        for item in ordered(folder)[keep:]:
            if key == 'backups' or item.name not in protect:
                shutil.rmtree(item)
                removed[key].append(item.name)
    return removed


# --- Service control ---------------------------------------------------------

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class System:
    """Host operations, replaced by a fake in tests."""

    def systemctl(self, *arguments):
        result = subprocess.run(['/usr/bin/systemctl', *arguments], stdin=subprocess.DEVNULL,
            capture_output=True, timeout=90, check=False)
        require(result.returncode == 0, 'systemctl_' + re.sub('[^a-z]', '_', arguments[0]) + '_failed')
        return result.stdout.decode('utf-8', 'replace')

    def stop(self, service):
        self.systemctl('stop', service)

    def start(self, service):
        self.systemctl('start', service)

    def restart(self, service):
        # A crashing candidate can exhaust StartLimitBurst; clear it first.
        with contextlib.suppress(ReleaseError, OSError, subprocess.SubprocessError):
            self.systemctl('reset-failed', service)
        self.systemctl('restart', service)

    def main_pid(self, service):
        value = self.systemctl('show', '--property=MainPID', '--value', service).strip()
        return int(value) if value.isdigit() else 0

    def runs_in(self, pid, directory):
        # The unit runs in its own mount namespace: compare the inode, not the path text.
        try:
            actual, expected = os.stat(f'/proc/{pid}/cwd'), os.stat(directory)
        except OSError:
            return False
        return (actual.st_dev, actual.st_ino) == (expected.st_dev, expected.st_ino)

    def http_get(self, url, host=None, timeout=10):
        headers = {'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity', 'User-Agent': 'CTP-Manager-release/1'}
        if host:
            headers['Host'] = host
        opener = build_opener(ProxyHandler({}), NoRedirect)
        try:
            response = opener.open(Request(url, headers=headers), timeout=timeout)
        except HTTPError as error:
            response = error
        except (URLError, OSError) as error:
            raise ReleaseError('health_unreachable') from error
        try:
            with response:
                data = response.read(4 * MIB + 1) if response.fp is not None else b''
                status = response.getcode()
        except OSError as error:
            raise ReleaseError('health_unreachable') from error
        require(len(data) <= 4 * MIB, 'health_response_limit')
        return status, data

    def sleep(self, seconds):
        time.sleep(seconds)

    def monotonic(self):
        return time.monotonic()


def check_status(body, env):
    value = strict_json(body)
    require(isinstance(value, dict) and value.get('provider') == 'ctp' and value.get('authenticated') is False
        and value.get('web_origin') == env['ctpOrigin'], 'health_status_body')


def verify_running(env, paths, release, system, *, index_sha256=None, public=True, wait=None):
    """The service process runs `release` and answers on its exact host.

    With index_sha256 the loopback page must be that build's index.html. The
    public check only proves Caddy reaches it: a proxy may rewrite HTML.
    """
    service, host = env['service'], urlsplit(env['publicOrigin']).netloc
    local = f"http://127.0.0.1:{env['port']}"
    deadline = system.monotonic() + (env['startSeconds'] if wait is None else wait)
    while True:
        try:
            pid = system.main_pid(service)
            require(pid > 0, 'service_not_running')
            require(system.runs_in(pid, paths.releases / release), 'service_running_other_release')
            status, body = system.http_get(local + '/api/auth/status', host)
            require(status == 200, 'health_status_http')
            check_status(body, env)
            break
        except ReleaseError:
            if system.monotonic() >= deadline:
                raise
            system.sleep(1)
    if index_sha256 is not None:
        status, body = system.http_get(local + '/', host)
        require(status == 200 and hashlib.sha256(body).hexdigest() == index_sha256, 'health_local_index')
    if public:
        status, body = system.http_get(env['publicOrigin'] + '/api/auth/status')
        require(status == 200, 'health_public_http')
        check_status(body, env)


def restore_previous(env, paths, previous, system):
    """Leave `previous` current and running. Raises when it cannot be verified."""
    if current_release(paths) != previous:
        switch_current(paths, previous)
    system.restart(env['service'])
    verify_running(env, paths, previous, system, public=False)


def recover_pending(env, paths, system):
    if not paths.pending.exists() and not paths.pending.is_symlink():
        return False
    require(regular_file(paths.pending) and paths.pending.stat().st_size <= 1024, 'pending_not_regular')
    pending = strict_json(paths.pending.read_bytes())
    require(isinstance(pending, dict) and set(pending) == {'schemaVersion', 'candidate', 'previous'}
        and pending['schemaVersion'] == 1, 'pending_schema')
    candidate, previous = pending['candidate'], pending['previous']
    require(isinstance(candidate, str) and RELEASE.fullmatch(candidate) and isinstance(previous, str)
        and ANY_RELEASE.fullmatch(previous) and candidate != previous, 'pending_release')
    require(current_release(paths) in (candidate, previous), 'pending_conflicts_with_current')
    try:
        restore_previous(env, paths, previous, system)
    except ReleaseError as error:
        raise ReleaseError('recovery_failed_' + error.reason[:60]) from error
    paths.pending.unlink()
    sync_directory(paths.state)
    return True


@contextlib.contextmanager
def exclusive_lock(path):
    path = Path(path)
    require(not path.is_symlink(), 'lock_symlink')
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        require(stat.S_ISREG(os.fstat(descriptor).st_mode), 'lock_not_regular')
        if os.name == 'posix':
            import fcntl
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ReleaseError('deployment_locked') from error
        yield
    finally:
        os.close(descriptor)


def deploy(env, command, source, system, *, paths=None, limits=LIMITS):
    paths = paths or Paths(env)
    started = time.time()
    with exclusive_lock(paths.lock):
        for directory in (paths.root, paths.releases):
            checked_directory(directory)
        for directory in (paths.state, paths.backups):
            checked_directory(directory, private=True)
        recovered = recover_pending(env, paths, system)
        previous = current_release(paths)
        require(previous is not None, 'current_release_missing')
        name = command['release']
        candidate, staging = paths.releases / name, paths.releases / ('.incoming-' + name)
        require(not os.path.lexists(candidate) and not os.path.lexists(staging), 'release_already_exists')
        with tempfile.TemporaryDirectory(prefix='upload-', dir=paths.state) as workspace:
            archive = Path(workspace) / 'release.tar.gz'
            receive(source, archive, limits['compressed'], command['checksum'])
            staging.mkdir(mode=0o700)
            try:
                files = unpack(archive, staging, limits)
                summary = validate_manifest(staging, files, env, command)
                require(shutil.disk_usage(paths.releases).free >= summary['expandedBytes'] + 256 * MIB,
                    'insufficient_disk')
                make_readable(staging)
                os.rename(staging, candidate)
                sync_directory(paths.releases)
            except BaseException:
                shutil.rmtree(staging, ignore_errors=True)
                raise
        atomic_json(paths.pending, {'schemaVersion': 1, 'candidate': name, 'previous': previous})
        backup = None
        try:
            system.stop(env['service'])
            backup = backup_database(paths, name)
            switch_current(paths, name)
            system.start(env['service'])
            verify_running(env, paths, name, system, index_sha256=summary['indexSha256'])
        except BaseException as error:
            failure = ReleaseError(reason_of(error, 'release_failed'))
            try:
                restore_previous(env, paths, previous, system)
                paths.pending.unlink()
                sync_directory(paths.state)
                failure.details = {'rolledBack': True, 'running': previous}
            except BaseException as rollback:
                failure.details = {'rolledBack': False, 'rollbackReason': reason_of(rollback, 'rollback_failed')}
            failure.details.update(release=name, backup=backup)
            raise failure from error
        receipt = {'status': 'deployed', 'environment': env['environment'], 'release': name,
            'previous': previous, 'commit': command['commit'], 'artifactSha256': command['checksum'],
            'files': summary['files'], 'backup': backup, 'recoveredPending': recovered,
            'seconds': round(time.time() - started, 1)}
        atomic_json(paths.state / 'last-success.json', receipt)
        paths.pending.unlink()
        sync_directory(paths.state)
        try:
            receipt['pruned'] = prune(paths, env['keepReleases'], env['keepBackups'], {name, previous})
        except OSError:
            receipt['pruned'] = 'failed'
        return receipt


# --- Socket roles ------------------------------------------------------------

def read_header(stream):
    line = stream.readline(1025)
    require(line.endswith(b'\n') and len(line) <= 1024, 'release_request_limit')
    header = strict_json(line)
    require(isinstance(header, dict) and set(header) == {'command'}, 'release_request_schema')
    return header['command']


def terminate(signum, frame):
    raise SystemExit(128 + signum)  # Lets an interrupted deploy roll back first.


def serve(environment):
    import pwd
    import signal
    require(sys.platform.startswith('linux') and os.geteuid() == 0, 'root_linux_required')
    os.umask(0o077)
    signal.signal(signal.SIGTERM, terminate)
    env = environment_config(environment)
    connection = socket.socket(fileno=os.dup(0))
    connection.settimeout(600)
    credentials = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))
    _, uid, _ = struct.unpack('3i', credentials)
    require(uid == pwd.getpwnam(env['deployUser']).pw_uid, 'release_peer_denied')
    with connection, connection.makefile('rb', buffering=0) as incoming:
        command = parse_command(read_header(incoming), environment)
        return deploy(env, command, incoming, System())


def client(environment, original, source):
    env = environment_config(environment)
    parse_command(original, environment)
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(660)
    with connection:
        connection.connect(env['socket'])
        connection.sendall((json.dumps({'command': original}) + '\n').encode())
        total = 0
        try:
            for block in iter(lambda: source.read(64 * 1024), b''):
                total += len(block)
                require(total <= LIMITS['compressed'], 'archive_compressed_limit')
                connection.sendall(block)
            connection.shutdown(socket.SHUT_WR)
        except (BrokenPipeError, ConnectionResetError):
            pass  # The broker stopped reading early; its reason is in the reply.
        reply = bytearray()
        while True:
            try:
                block = connection.recv(64 * 1024)
            except ConnectionResetError:
                break  # Linux reports unread upload bytes after the reply.
            if not block:
                break
            reply.extend(block)
            require(len(reply) <= MIB, 'release_reply_limit')
    result = strict_json(bytes(reply))
    require(isinstance(result, dict) and result.get('status') in ('deployed', 'failed'), 'release_reply_schema')
    return result


# --- Installer ---------------------------------------------------------------

def parse_public_key(data):
    try:
        text = data.decode('ascii').strip()
        require('\n' not in text and '\r' not in text, 'one_public_key_required')
        parts = text.split()
        require(len(parts) >= 2 and parts[0] == 'ssh-ed25519', 'ed25519_public_key_required')
        raw = base64.b64decode(parts[1], validate=True)
        offset = 0
        def field():
            nonlocal offset
            require(offset + 4 <= len(raw), 'invalid_public_key')
            length = struct.unpack('>I', raw[offset:offset + 4])[0]
            offset += 4
            require(offset + length <= len(raw), 'invalid_public_key')
            value = raw[offset:offset + length]
            offset += length
            return value
        require(field() == b'ssh-ed25519' and len(field()) == 32 and offset == len(raw), 'invalid_public_key')
        require(base64.b64encode(raw).decode() == parts[1], 'invalid_public_key')
        fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip('=')
        return 'ssh-ed25519 ' + parts[1], fingerprint
    except (ValueError, UnicodeError, struct.error) as error:
        raise ReleaseError('invalid_public_key') from error


def forced_command(environment):
    return f'/usr/local/libexec/ctp-manager-deploy-{environment}'


def wrapper(environment):
    env = environment_config(environment)
    user = env['deployUser']
    return ('#!/bin/sh\nset -eu\numask 077\n'
        'exec /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C.UTF-8 '
        f'HOME=/var/lib/{user} USER={user} LOGNAME={user} '
        'SSH_ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND-}" '
        f'/usr/bin/python3 -I {HELPER} client --environment {environment}\n').encode()


def authorized_key(environment, key):
    return f'restrict,command="{forced_command(environment)}" {key} ctp-manager-{environment}-deploy\n'.encode()


SSHD_EXPECTED = {'authenticationmethods': 'publickey', 'pubkeyauthentication': 'yes',
    'passwordauthentication': 'no', 'kbdinteractiveauthentication': 'no', 'authorizedkeyscommand': 'none',
    'disableforwarding': 'yes', 'allowtcpforwarding': 'no', 'allowstreamlocalforwarding': 'no',
    'allowagentforwarding': 'no', 'x11forwarding': 'no', 'permittunnel': 'no', 'permittty': 'no',
    'permituserrc': 'no'}


def sshd_fragment(environment):
    env = environment_config(environment)
    return ('# Managed by the CTP Manager release installer. Upload only, no shell.\n'
        f"Match User {env['deployUser']}\n"
        '    AuthenticationMethods publickey\n    PubkeyAuthentication yes\n'
        '    PasswordAuthentication no\n    KbdInteractiveAuthentication no\n'
        f'    AuthorizedKeysFile {CONFIG_ROOT}/keys/{environment}\n'
        '    AuthorizedKeysCommand none\n'
        f'    ForceCommand {forced_command(environment)}\n'
        '    DisableForwarding yes\n    AllowTcpForwarding no\n    AllowStreamLocalForwarding no\n'
        '    AllowAgentForwarding no\n    X11Forwarding no\n    PermitTunnel no\n    PermitTTY no\n'
        '    PermitUserRC no\n\nMatch all\n').encode()


def socket_unit(environment):
    env = environment_config(environment)
    return f'''[Unit]
Description=CTP Manager {environment.upper()} release broker socket

[Socket]
ListenStream={env['socket']}
SocketUser=root
SocketGroup={env['deployUser']}
SocketMode=0660
DirectoryMode=0755
Accept=yes
MaxConnections=2
RemoveOnStop=yes

[Install]
WantedBy=sockets.target
'''.encode()


def service_unit(environment):
    return f'''[Unit]
Description=CTP Manager {environment.upper()} release broker
CollectMode=inactive-or-failed

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/bin/python3 -I {HELPER} broker --environment {environment}
StandardInput=socket
StandardOutput=socket
StandardError=journal
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
RuntimeMaxSec=600
# SIGTERM triggers a rollback, which may need a full service start.
TimeoutStopSec=90
'''.encode()


def managed_files(environment, key, helper):
    return {
        Path(HELPER): (helper, 0o755),
        Path(forced_command(environment)): (wrapper(environment), 0o755),
        Path(CONFIG_ROOT) / 'keys' / environment: (authorized_key(environment, key), 0o644),
        Path(f'/etc/ssh/sshd_config.d/41-ctp-manager-deploy-{environment}.conf'): (sshd_fragment(environment), 0o644),
        Path(f'/etc/systemd/system/ctp-manager-release-{environment}.socket'): (socket_unit(environment), 0o644),
        Path(f'/etc/systemd/system/ctp-manager-release-{environment}@.service'): (service_unit(environment), 0o644),
    }


def normalized_helper(data):
    data = data.replace(b'\r\n', b'\n')
    require(b'\x00' not in data and b'def deploy(' in data and b'def client(' in data, 'unexpected_helper')
    try:
        ast.parse(data.decode('utf-8'))
    except (SyntaxError, UnicodeError) as error:
        raise ReleaseError('helper_python_invalid') from error
    return data


def run(arguments, *, check=True, timeout=60):
    result = subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C.UTF-8'}, check=False)
    require(not check or result.returncode == 0, 'command_failed_' + re.sub('[^a-z]', '_', Path(arguments[0]).name))
    return result


def write_root_file(path, data, mode):
    require(not path.is_symlink() and (not path.exists() or regular_file(path)), 'managed_file_not_regular')
    descriptor, temporary = tempfile.mkstemp(prefix='.ctp-manager-install-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            os.fchown(stream.fileno(), 0, 0)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def ensure_directory(path, mode, uid=0, gid=0):
    path = Path(path)
    if not path.exists():
        path.mkdir(mode=mode)
    require(path.is_dir() and not path.is_symlink(), 'not_a_directory')
    os.chown(path, uid, gid, follow_symlinks=False)
    os.chmod(path, mode, follow_symlinks=False)


def deploy_account(env):
    import grp
    import pwd
    name = env['deployUser']
    try:
        user = pwd.getpwnam(name)
    except KeyError:
        return None
    require(0 < user.pw_uid < 1000 and user.pw_dir == '/var/lib/' + name and user.pw_shell == '/bin/sh',
        'existing_account_is_not_managed_system_user')
    require(grp.getgrgid(user.pw_gid).gr_name == name, 'existing_account_primary_group')
    groups = {int(value) for value in run(['/usr/bin/id', '-G', name]).stdout.split()}
    require(groups == {user.pw_gid}, 'deploy_account_has_supplementary_groups')
    return user


def check_effective_sshd(env, environment):
    output = run(['/usr/sbin/sshd', '-T', '-C', f"user={env['deployUser']},host=localhost,addr=127.0.0.1"]).stdout.decode()
    effective, allow_users, allow_groups, deny_users = {}, [], [], []
    for line in output.splitlines():
        key, _, value = line.partition(' ')
        effective[key] = value
        {'allowusers': allow_users, 'allowgroups': allow_groups, 'denyusers': deny_users}.get(key, []).extend(value.split())
    expected = {**SSHD_EXPECTED, 'authorizedkeysfile': f'{CONFIG_ROOT}/keys/{environment}',
        'forcecommand': forced_command(environment)}
    require(all(effective.get(key) == value for key, value in expected.items()), 'sshd_effective_policy_mismatch')
    require(not allow_users or env['deployUser'] in allow_users or '*' in allow_users, 'sshd_allowusers_excludes_deploy_user')
    require(not allow_groups or env['deployUser'] in allow_groups, 'sshd_allowgroups_excludes_deploy_user')
    require(env['deployUser'] not in deny_users, 'sshd_denyusers_includes_deploy_user')


def reload_ssh():
    if run(['/usr/bin/systemctl', 'is-active', '--quiet', 'ssh.service'], check=False).returncode == 0:
        run(['/usr/bin/systemctl', 'reload', 'ssh.service'])
    else:
        # Socket-activated sshd reads its configuration for every new connection.
        require(run(['/usr/bin/systemctl', 'is-active', '--quiet', 'ssh.socket'], check=False).returncode == 0,
            'ssh_service_not_active')


def known_hosts(host):
    lines = []
    for path in sorted(Path('/etc/ssh').glob('ssh_host_*_key.pub')):
        parts = path.read_text('ascii').split()
        if len(parts) >= 2 and parts[0] == 'ssh-ed25519':
            lines.append(f'{host} {parts[0]} {parts[1]}')
    return lines


def install(environment, key_file, host, dry_run):
    import pwd
    require(sys.platform.startswith('linux') and os.geteuid() == 0, 'root_linux_required')
    env = environment_config(environment)
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}', host or ''), 'invalid_host')
    key_path = Path(key_file)
    require(regular_file(key_path) and key_path.stat().st_size <= 8192, 'public_key_file')
    key, fingerprint = parse_public_key(key_path.read_bytes())
    helper = normalized_helper(Path(__file__).read_bytes())
    for command in ('/usr/sbin/sshd', '/usr/sbin/useradd', '/usr/sbin/usermod', '/usr/bin/systemctl',
            '/usr/bin/python3', '/usr/bin/env', '/usr/bin/id'):
        require(Path(command).is_file(), 'required_system_command_missing')
    run(['/usr/sbin/sshd', '-t'])
    require(Path('/etc/systemd/system/' + env['service']).is_file(), 'manager_service_unit_missing')
    try:
        pwd.getpwnam(env['serviceUser'])
    except KeyError as error:
        raise ReleaseError('manager_service_user_missing') from error
    paths = Paths(env)
    for directory in (paths.root, paths.releases):
        checked_directory(directory)
    previous = current_release(paths)
    require(previous is not None, 'current_release_missing')
    # The running service must already be the current release and answer on its host.
    verify_running(env, paths, previous, System(), wait=5)
    account = deploy_account(env)
    files = managed_files(environment, key, helper)
    plan = {'environment': environment, 'deployUser': env['deployUser'], 'keyFingerprint': fingerprint,
        'current': previous, 'helperSha256': hashlib.sha256(helper).hexdigest(),
        'createsAccount': account is None, 'files': sorted(str(path) for path in files),
        'knownHosts': known_hosts(host)}
    if dry_run:
        return {'status': 'validated', **plan}
    for directory in ('/usr/local/libexec', CONFIG_ROOT, CONFIG_ROOT + '/keys'):
        ensure_directory(directory, 0o755)
    for directory in ('/var/lib/ctp-manager-release', '/var/backups/ctp-manager-release'):
        ensure_directory(directory, 0o700)
    ensure_directory(paths.state, 0o700)
    ensure_directory(paths.backups, 0o700)
    previous_files = {path: (path.read_bytes(), stat.S_IMODE(path.stat().st_mode)) if regular_file(path) else None
        for path in files}
    with exclusive_lock(paths.lock):
        try:
            if account is None:
                run(['/usr/sbin/useradd', '--system', '--home-dir', '/var/lib/' + env['deployUser'], '--shell', '/bin/sh',
                    '--no-create-home', '--user-group', '--comment', f'CTP Manager {environment.upper()} release upload only',
                    env['deployUser']])
            run(['/usr/sbin/usermod', '--lock', env['deployUser']])
            user = deploy_account(env)
            require(user is not None, 'account_creation_failed')
            ensure_directory('/var/lib/' + env['deployUser'], 0o700, user.pw_uid, user.pw_gid)
            for path, (data, mode) in files.items():
                write_root_file(path, data, mode)
            run(['/usr/sbin/sshd', '-t'])
            check_effective_sshd(env, environment)
            reload_ssh()
            run(['/usr/bin/systemctl', 'daemon-reload'])
            run(['/usr/bin/systemctl', 'enable', '--now', f'ctp-manager-release-{environment}.socket'])
        except BaseException:
            for path, previous_file in previous_files.items():
                if previous_file is None:
                    with contextlib.suppress(FileNotFoundError):
                        path.unlink()
                else:
                    write_root_file(path, *previous_file)
            if run(['/usr/sbin/sshd', '-t'], check=False).returncode == 0:
                with contextlib.suppress(ReleaseError, OSError, subprocess.SubprocessError):
                    reload_ssh()
            run(['/usr/bin/systemctl', 'daemon-reload'], check=False)
            raise
    return {'status': 'installed', **plan}


# --- Entry point -------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('role', choices=['client', 'broker', 'install'])
    parser.add_argument('--environment', default='pre', choices=sorted(ENVIRONMENTS))
    parser.add_argument('--public-key', help='install: ed25519 public key of the GitHub deploy identity')
    parser.add_argument('--host', default='31.70.157.157', help='install: host name GitHub uses, for known_hosts')
    parser.add_argument('--dry-run', action='store_true', help='install: validate and print the plan only')
    args = parser.parse_args(argv)
    try:
        if args.role == 'client':
            result = client(args.environment, os.environ.get('SSH_ORIGINAL_COMMAND', ''), sys.stdin.buffer)
        elif args.role == 'broker':
            result = serve(args.environment)
        else:
            require(args.public_key, 'public_key_required')
            result = install(args.environment, args.public_key, args.host, args.dry_run)
    except Exception as error:
        # Reason codes only: never paths, provider bodies or exception text.
        result = {'status': 'failed', 'reason': reason_of(error, args.role + '_internal_error')}
        if isinstance(error, ReleaseError) and isinstance(error.details, dict):
            result['details'] = error.details
        # The broker's stdout is the socket; stderr is the journal.
        print(json.dumps(result, separators=(',', ':')), file=sys.stderr, flush=True)
        if args.role != 'broker':
            return 1
    else:
        if args.role == 'broker':
            print(json.dumps(result, separators=(',', ':')), file=sys.stderr, flush=True)
    print(json.dumps(result, separators=(',', ':')), flush=True)
    return 0 if result.get('status') in ('deployed', 'validated', 'installed') else 1


if __name__ == '__main__':
    sys.exit(main())
