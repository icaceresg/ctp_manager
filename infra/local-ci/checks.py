"""Run Manager's release checks inside the shared, disposable local CI guest."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PROFILE = Path(__file__).with_name('profile.json')
REPOSITORY = 'icaceresg/ctp_manager'
PHASES = ('checks', 'build', 'package')
ARTIFACT = 'ctp-manager.tar.gz'
WORKFLOWS = {'.github/actions/manager-checks/action.yml', '.github/workflows/deploy-pre.yml',
             '.github/workflows/deploy-prod.yml'}
_runtime_spec = importlib.util.spec_from_file_location('manager_local_ci_runtime', Path(__file__).with_name('runtime.py'))
runtime = importlib.util.module_from_spec(_runtime_spec)
_runtime_spec.loader.exec_module(runtime)


def require(condition, code):
    if not condition:
        raise ValueError(code)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load_profile():
    value = json.loads(PROFILE.read_text(encoding='utf-8'))
    require(value['schemaVersion'] == 1 and value['application'] == 'manager'
            and value['repository'] == REPOSITORY and value['nodeMajor'] == 24, 'profile_identity')
    require(set(value['workflowSha256']) == WORKFLOWS, 'profile_workflow_inventory')
    for name, expected in value['workflowSha256'].items():
        actual = hashlib.sha256((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
        require(actual == expected, 'workflow_changed_review_local_profile')
    ids = []
    for phase in PHASES:
        for row in value[phase]:
            require(set(row) == {'id', 'argv', 'timeoutSeconds'} and
                    re.fullmatch(r'[a-z][a-z0-9-]{1,65}', row['id']) and
                    row['argv'][0] in ('bash', 'npm', 'python3', 'node') and
                    0 < row['timeoutSeconds'] <= 900, 'profile_command_invalid')
            ids.append(row['id'])
    require(len(ids) == len(set(ids)), 'duplicate_check')
    return value


def verify_lease(source_ref, source_sha):
    require(sys.platform == 'linux' and os.geteuid() != 0 and not os.getgroups()
            and os.environ.get('GITHUB_ACTIONS') != 'true', 'owned_local_ci_ordinary_linux_required')
    lease = runtime.local_test_lease(root=ROOT)
    require(lease['profile'] == 'manager' and lease['leaseId'] == os.environ.get('CTP_LOCAL_CI_LEASE_ID')
            and (lease['sourceRef'], lease['sourceSha']) == (source_ref, source_sha), 'local_ci_lease_source_mismatch')


def git(args, env):
    return subprocess.check_output(['git', *args], cwd=ROOT, env=env, timeout=20).decode().strip()


def verify_source(source_sha, env):
    require(git(['rev-parse', 'HEAD'], env) == source_sha, 'source_changed')
    require(not git(['status', '--porcelain', '--untracked-files=normal'], env), 'clean_export_required')


def verify_no_build_overrides():
    for parent, directories, files in os.walk(ROOT, followlinks=False):
        directories[:] = [name for name in directories if name not in {'.git', 'node_modules'}]
        for name in files:
            if name.startswith('.env') and not name.endswith(('.example', '.sample')) or name == '.npmrc':
                raise ValueError('source_configuration_override_refused')


def build_environment(out):
    home = out / 'tool-home'
    home.mkdir(mode=0o700)
    scratch = home / 'tmp'
    scratch.mkdir(mode=0o700)
    npm_config = home / 'empty.npmrc'
    npm_global = home / 'empty-global.npmrc'
    npm_config.touch(exist_ok=False)
    npm_global.touch(exist_ok=False)
    # The guest's /tmp is noexec. The deployment tests execute their own SSH stub.
    return {'PATH': os.environ['PATH'], 'HOME': str(home), 'TMPDIR': str(scratch), 'CI': 'true', 'LANG': 'C.UTF-8',
            'PYTHONDONTWRITEBYTECODE': '1', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
            'NPM_CONFIG_USERCONFIG': str(npm_config), 'NPM_CONFIG_GLOBALCONFIG': str(npm_global),
            'NPM_CONFIG_CACHE': str(home / 'npm-cache')}


def execute(row, env, out, source_ref, source_sha):
    logfile = out / (row['id'] + '.log')
    started = time.monotonic()
    if row['id'] == 'package':
        # The existing archive format calls these fields GITHUB_REF and GITHUB_SHA.
        # They describe the source and never grant a hosted runner identity.
        env = env | {'GITHUB_REF': 'refs/heads/' + source_ref, 'GITHUB_SHA': source_sha}
    with logfile.open('xb') as stream:
        child = subprocess.Popen(row['argv'], cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                 stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = child.wait(timeout=row['timeoutSeconds'])
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait(timeout=20)
            code = 124
    return {'id': row['id'], 'status': 'success' if code == 0 else 'failure', 'exitCode': code,
            'elapsedSeconds': round(time.monotonic() - started, 3), 'logSha256': digest(logfile)}


def run(value, source_ref, source_sha, output):
    require(source_sha is not None and re.fullmatch(r'[a-f0-9]{40}', source_sha), 'exact_source_required')
    verify_lease(source_ref, source_sha)
    out = Path(output).absolute()
    require(out.is_dir() and out.resolve() == out and not out.is_relative_to(ROOT), 'external_output_required')
    require(not (out / 'summary.json').exists(), 'output_already_used')
    verify_no_build_overrides()
    env = build_environment(out)
    verify_source(source_sha, env)
    version = subprocess.check_output(['node', '--version'], env=env, timeout=10).decode().strip()
    require(re.fullmatch(r'v24\.[0-9]+\.[0-9]+', version), 'node_24_required')
    artifact = ROOT / 'output' / ARTIFACT
    require(not artifact.exists() and not artifact.is_symlink(), 'artifact_already_exists')
    checks = []
    for phase in PHASES:
        verify_source(source_sha, env)
        for row in value[phase]:
            result = execute(row, env, out, source_ref, source_sha)
            checks.append(result)
            print(json.dumps(result), flush=True)
            if result['exitCode']:
                break
        if checks[-1]['exitCode']:
            break
    complete = all(row['exitCode'] == 0 for row in checks)
    summary = {'schemaVersion': 1, 'application': 'manager', 'repository': REPOSITORY,
               'provider': 'owned-pc-local', 'sourceRef': 'refs/heads/' + source_ref, 'sourceCommit': source_sha,
               'platform': 'linux', 'preliminary': False, 'ok': complete, 'releaseReady': complete,
               'deploymentAuthorized': False, 'checks': checks}
    if complete:
        verify_source(source_sha, env)
        require(artifact.resolve() == artifact and artifact.is_file()
                and 0 < artifact.stat().st_size <= 200 * 1024 * 1024, 'artifact_missing_or_invalid')
        destination = out / ARTIFACT
        with artifact.open('rb') as source, destination.open('xb') as target:
            shutil.copyfileobj(source, target)
        summary['artifact'] = {'path': str(destination), 'bytes': destination.stat().st_size,
                               'sha256': digest(destination)}
    with (out / 'summary.json').open('x', encoding='utf-8') as stream:
        json.dump(summary, stream, indent=2)
    return 0 if complete else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('plan', 'run'))
    parser.add_argument('--source-ref', choices=('pre', 'main'))
    parser.add_argument('--source-sha')
    parser.add_argument('--out')
    args = parser.parse_args()
    value = load_profile()
    if args.operation == 'plan':
        print(json.dumps({'application': 'manager', 'checks': [row['id'] for phase in PHASES for row in value[phase]],
                          'execution': False, 'deploymentAuthorized': False}))
        return 0
    require(args.source_ref and args.out, 'exact_source_and_output_required')
    return run(value, args.source_ref, args.source_sha, args.out)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (KeyError, OSError, TypeError, ValueError, subprocess.SubprocessError) as error:
        code = str(error)
        print(json.dumps({'ok': False, 'releaseReady': False, 'deploymentAuthorized': False,
                          'code': code if re.fullmatch('[a-z0-9_]{1,100}', code) else 'local_checks_failed'}))
        raise SystemExit(1)
