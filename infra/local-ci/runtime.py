"""Admission for disposable SQL test fixtures, never deployment authorization.

The local marker records a manually reviewed first-party container run. A Docker
container (including privileged DinD) is not a VM or a hostile-code sandbox.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid

LEASE_FILE = Path('/opt/ctp-local-ci/lease.json')
ROOT = Path(__file__).resolve().parents[2]


def local_test_lease(path=LEASE_FILE, *, root=ROOT, now=None):
    if sys.platform != 'linux' or not path.is_absolute() or path.resolve(strict=True) != path:
        raise ValueError('local_linux_fixture_required')
    row = path.lstat()
    if not stat.S_ISREG(row.st_mode) or row.st_uid != 0 or row.st_mode & 0o022 or not 0 < row.st_size <= 8192:
        raise ValueError('local_fixture_marker_permissions')
    for parent in path.parents:
        info = parent.stat()
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('local_fixture_parent_permissions')
    value = json.loads(path.read_text(encoding='utf-8'))
    required = {'schemaVersion', 'kind', 'leaseId', 'sourceRef', 'sourceSha', 'profile', 'createdAt', 'expiresAt'}
    if set(value) != required or value['schemaVersion'] != 1 or value['kind'] != 'local-firstparty-container-tests':
        raise ValueError('local_fixture_marker_inventory')
    nonce = uuid.UUID(value['leaseId'])
    if str(nonce) != value['leaseId'] or nonce.version != 4:
        raise ValueError('local_fixture_lease_invalid')
    if value['sourceRef'] not in ('pre', 'main') or value['profile'] not in ('ctp', 'manager') or not re.fullmatch('[a-f0-9]{40}', value['sourceSha']):
        raise ValueError('local_fixture_source_invalid')
    created = dt.datetime.fromisoformat(value['createdAt'].replace('Z', '+00:00'))
    expires = dt.datetime.fromisoformat(value['expiresAt'].replace('Z', '+00:00'))
    current = now or dt.datetime.now(dt.timezone.utc)
    if not created <= current < expires or not dt.timedelta() < expires - created <= dt.timedelta(hours=4):
        raise ValueError('local_fixture_lease_expired')
    clean = {'PATH': os.defpath, 'HOME': '/nonexistent', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull}
    actual = subprocess.run(['git', '-C', str(root), 'rev-parse', '--verify', 'HEAD'], env=clean,
                            capture_output=True, timeout=5, check=True).stdout.decode().strip()
    if actual != value['sourceSha']:
        raise ValueError('local_fixture_commit_mismatch')
    return value


def is_ephemeral_test_runtime(env=None):
    current = os.environ if env is None else env
    if sys.platform != 'linux':
        return False
    if current.get('GITHUB_ACTIONS') == 'true' and current.get('RUNNER_ENVIRONMENT') == 'github-hosted':
        return True
    try:
        lease = local_test_lease()
        return current.get('CTP_LOCAL_CI_LEASE_ID') == lease['leaseId']
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        return False
