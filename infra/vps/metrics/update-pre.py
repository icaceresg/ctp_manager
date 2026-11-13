"""Atomically update an existing PRE observer; never start or control a service.

The reviewed manifest pins both the installed bytes and the Git LF candidate.
Planning is read-only. A root CI adapter must separately authorize this exact
operation; the application's existing deploy key cannot invoke arbitrary root.
"""
import argparse
import ast
import contextlib
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import uuid

TARGET = pathlib.Path('/opt/ctp-manager/pre-metrics/collect.py')
PROTECTED = (
    pathlib.Path('/opt/ctp-manager/pre-metrics/traffic.py'),
    pathlib.Path('/etc/systemd/system/ctp-manager-pre-metrics.service'),
    pathlib.Path('/etc/systemd/system/ctp-manager-pre-metrics.timer'),
)
LIMIT = 128 * 1024
DIGEST = re.compile(r'[0-9a-f]{64}\Z')


def need(value, reason):
    if not value:
        raise RuntimeError(reason)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def regular_root_file(path, limit=LIMIT):
    need(path.is_absolute() and path.resolve(strict=True) == path, 'source_symlink_or_relative')
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'source_not_root_owned')
    need(0 < info.st_size <= limit, 'source_size_limit')
    for parent in path.parents:
        metadata = parent.lstat()
        need(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0 and not metadata.st_mode & 0o022,
             'source_ancestor_untrusted')
    return path.read_bytes()


def inspect_plan(source, manifest, *, target=TARGET, protected=PROTECTED, reader=regular_root_file):
    need(set(manifest) == {'schemaVersion', 'scope', 'sourceCommit', 'expectedInstalledSha256',
                           'candidateSha256', 'protectedSha256'}, 'manifest_inventory')
    need(manifest['schemaVersion'] == 1 and manifest['scope'] == 'pre_metrics_collector_only', 'manifest_scope')
    need(isinstance(manifest['sourceCommit'], str) and re.fullmatch(r'[0-9a-f]{40}', manifest['sourceCommit']), 'manifest_commit')
    need(all(isinstance(manifest[key], str) and DIGEST.fullmatch(manifest[key])
             for key in ('expectedInstalledSha256', 'candidateSha256')), 'manifest_digest')
    need(manifest['expectedInstalledSha256'] != manifest['candidateSha256'], 'same_source_not_update')
    need(source != target and source.name == 'collect.py', 'candidate_path')
    need(set(manifest['protectedSha256']) == {str(path) for path in protected}, 'protected_inventory')
    candidate, installed = reader(source), reader(target)
    need(sha(candidate) == manifest['candidateSha256'], 'candidate_changed')
    need(sha(installed) == manifest['expectedInstalledSha256'], 'installed_changed')
    ast.parse(candidate.decode('utf-8'), filename='reviewed_collect.py')
    observed = {str(path): sha(reader(path)) for path in protected}
    need(observed == manifest['protectedSha256'], 'protected_changed')
    plan = {'schemaVersion': 1, 'scope': manifest['scope'], 'sourceCommit': manifest['sourceCommit'],
            'installedSha256': sha(installed), 'candidateSha256': sha(candidate), 'candidateBytes': len(candidate),
            'protectedSha256': observed, 'servicesToControl': [], 'timersToChange': [],
            'databaseWrites': False, 'productionChanges': False}
    return plan, candidate, installed


def atomic_replace(target, data, *, mode=0o644):
    temporary = target.parent / ('.collect-update-' + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_WRONLY, mode)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def update(source, manifest, expected_plan, *, target=TARGET, protected=PROTECTED,
           reader=regular_root_file):
    # This lock belongs only to the updater. The running observer can finish
    # from its old open file; the next already-scheduled run reads all new bytes.
    import fcntl
    lockpath = target.parent / '.collector-update.lock'
    fd = os.open(lockpath, os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, 'update_lock_untrusted')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        plan, candidate, installed = inspect_plan(source, manifest, target=target, protected=protected, reader=reader)
        need(sha(canonical(plan)) == expected_plan, 'exact_plan_required')
        backup = target.parent / ('collect.previous-' + plan['installedSha256'] + '.py')
        if backup.exists():
            need(sha(reader(backup)) == plan['installedSha256'], 'backup_changed')
        else:
            backup_fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_WRONLY, 0o600)
            with os.fdopen(backup_fd, 'wb') as stream:
                stream.write(installed)
                stream.flush()
                os.fsync(stream.fileno())
        atomic_replace(target, candidate)
        need(sha(reader(target)) == plan['candidateSha256'], 'installed_readback_failed')
        need({str(path): sha(reader(path)) for path in protected} == plan['protectedSha256'], 'protected_changed_after_update')
        return {**plan, 'planSha256': expected_plan, 'applied': True, 'atomicReplacement': True,
                'previousBytesRetained': True, 'nextScheduledRunOnly': True}
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, required=True)
    parser.add_argument('--manifest', type=pathlib.Path, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-plan-sha256')
    args = parser.parse_args()
    need(sys.platform == 'linux' and os.geteuid() == 0, 'linux_root_required')
    manifest = json.loads(regular_root_file(args.manifest).decode('utf-8'))
    if args.apply:
        need(args.expected_plan_sha256 and DIGEST.fullmatch(args.expected_plan_sha256), 'exact_plan_required')
        result = update(args.source, manifest, args.expected_plan_sha256)
    else:
        plan, _, _ = inspect_plan(args.source, manifest)
        result = {**plan, 'planSha256': sha(canonical(plan)), 'applied': False}
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        reason = str(error)
        print(json.dumps({'ok': False, 'code': reason if re.fullmatch(r'[a-z_]{1,90}', reason) else 'observer_update_failed',
                          'automaticRetry': False, 'serviceChanges': False}))
        sys.exit(1)
