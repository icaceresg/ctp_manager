"""Install only the PRE-owned observer. Plan by default. No production changes."""
import argparse
import hashlib
import json
import os
import pathlib
import pwd
import grp
import stat
import subprocess
import sys
import time

TARGET = pathlib.Path('/opt/ctp-manager/pre-metrics')
STATE = pathlib.Path('/var/lib/ctp-manager-pre-metrics')
FILES = ['collect.py', 'traffic.py', 'ctp-manager-pre-metrics.service', 'ctp-manager-pre-metrics.timer']


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args, timeout=20):
    value = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    need(value.returncode == 0, 'observer_command_failed')
    return value.stdout


def protected():
    paths = ['/etc/caddy/Caddyfile', '/etc/ctp-manager/prod.env', '/etc/ctp-manager/pre.env',
             '/etc/systemd/system/ctp-manager-prod.service', '/etc/systemd/system/ctp-manager-pre.service']
    result = {'files': {p: sha(pathlib.Path(p)) for p in paths},
              'releases': {e: str(pathlib.Path('/srv/ctp-manager/'+e+'/current').resolve()) for e in ['pre', 'prod']}}
    for name in ['ctp-manager-prod', 'ctp-manager-pre', 'caddy']:
        result[name] = run(['systemctl', 'show', name, '-p', 'MainPID', '-p', 'ExecMainStartTimestampMonotonic', '-p', 'NRestarts'])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--hashes', required=True, type=pathlib.Path)
    args = parser.parse_args()
    stage = pathlib.Path(__file__).resolve().parent
    need(sys.platform == 'linux' and os.geteuid() == 0, 'linux_root_required')
    need(stage.stat().st_uid == 0 and not stage.stat().st_mode & 0o022, 'stage_not_private_root')
    hashes = json.loads(args.hashes.read_text())
    need(set(hashes) == set(FILES), 'observer_manifest_inventory')
    for name in FILES:
        source = stage/name
        need(not source.is_symlink() and source.is_file() and source.stat().st_uid == 0 and sha(source) == hashes[name], 'observer_source_hash')
    need(not TARGET.exists() and not TARGET.is_symlink() and not STATE.exists() and not STATE.is_symlink(), 'observer_already_present')
    for name in FILES[2:]:
        need(not pathlib.Path('/etc/systemd/system', name).exists(), 'observer_unit_already_present')
    pwd.getpwnam('ctp-manager-pre'); group = grp.getgrnam('ctp-manager-pre'); grp.getgrnam('caddy')
    before = protected()
    if not args.apply:
        print(json.dumps({'ok': True, 'apply': False, 'scope': 'pre', 'sourceHashes': hashes, 'productionChanges': False})); return
    os.umask(0o077)
    TARGET.mkdir(mode=0o755)
    TARGET.chmod(0o755)
    STATE.mkdir(mode=0o750); STATE.chmod(0o750); os.chown(STATE, 0, group.gr_gid)
    for name in FILES:
        target = TARGET/name if name.endswith('.py') else pathlib.Path('/etc/systemd/system', name)
        with target.open('xb') as stream:
            stream.write((stage/name).read_bytes()); stream.flush(); os.fsync(stream.fileno())
        target.chmod(0o644)
    run(['systemd-analyze', 'verify', '/etc/systemd/system/ctp-manager-pre-metrics.service', '/etc/systemd/system/ctp-manager-pre-metrics.timer'])
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'start', 'ctp-manager-pre-metrics.service'], 55)
    snapshot = STATE/'snapshot.json'
    need(snapshot.is_file() and stat.S_IMODE(snapshot.stat().st_mode) == 0o640 and snapshot.stat().st_uid == 0 and snapshot.stat().st_gid == group.gr_gid, 'snapshot_access_incorrect')
    value = json.loads(snapshot.read_text())
    need(value['schemaVersion'] == 1 and value['available'] is True and all(value['environments'][e]['database']['available'] for e in ['pre', 'prod']), 'observer_sources_unavailable')
    run(['runuser', '-u', 'ctp-manager-pre', '--', 'test', '-r', str(snapshot)])
    run(['systemctl', 'enable', '--now', 'ctp-manager-pre-metrics.timer'])
    need(protected() == before, 'protected_runtime_changed')
    print(json.dumps({'ok': True, 'apply': True, 'scope': 'pre', 'sourceHashes': hashes, 'generatedAt': value['generatedAt'],
                      'snapshotBytes': snapshot.stat().st_size, 'services': len(value['services']), 'productionChanges': False,
                      'managerServicesUnchanged': True, 'caddyUnchanged': True, 'postgresReadOnly': True,
                      'onlyStarted': ['ctp-manager-pre-metrics.service', 'ctp-manager-pre-metrics.timer']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error) if str(error).replace('_', '').isalnum() else type(error).__name__})); sys.exit(1)
