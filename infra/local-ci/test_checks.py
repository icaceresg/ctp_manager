import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import checks


class ManagerLocalCiTests(unittest.TestCase):
    def test_profile_has_all_pre_broker_checks_and_existing_release_commands(self):
        profile = checks.load_profile()
        commands = {row['id']: row['argv'] for phase in checks.PHASES for row in profile[phase]}
        self.assertEqual(list(commands), [
            'install', 'audit', 'application-tests', 'metrics-traffic', 'metrics-collector',
            'metrics-update', 'manager-release', 'local-ci-contract', 'build',
            'runtime-prepare', 'runtime-install', 'package',
        ])
        self.assertEqual(commands['application-tests'], ['npm', 'test'])
        self.assertEqual(commands['runtime-install'], ['npm', 'ci', '--omit=dev', '--ignore-scripts',
            '--no-audit', '--no-fund', '--prefix', 'output/runtime'])
        self.assertEqual(commands['package'], ['node', 'scripts/package-vps.mjs', '--out',
            'output/ctp-manager.tar.gz', '--deps', 'output/runtime'])

    def test_profile_rejects_drift_from_existing_workflow(self):
        with patch.object(checks.hashlib, 'sha256') as sha:
            sha.return_value.hexdigest.return_value = '0' * 64
            with self.assertRaisesRegex(ValueError, 'workflow_changed_review_local_profile'):
                checks.load_profile()

    def test_build_environment_does_not_inherit_remote_credentials_or_runner_identity(self):
        with tempfile.TemporaryDirectory() as scratch, patch.dict(checks.os.environ, {
            'PATH': '/usr/bin', 'GITHUB_ACTIONS': 'true', 'MANAGER_TOKEN': 'fixture', 'SSH_AUTH_SOCK': 'fixture',
        }, clear=True):
            env = checks.build_environment(Path(scratch))
            self.assertTrue({'GITHUB_ACTIONS', 'MANAGER_TOKEN', 'SSH_AUTH_SOCK'}.isdisjoint(env))
            self.assertEqual(Path(env['NPM_CONFIG_USERCONFIG']).read_text(), '')
            self.assertEqual(Path(env['TMPDIR']), Path(scratch) / 'tool-home' / 'tmp')
            self.assertTrue(Path(env['TMPDIR']).is_dir())

    def test_failed_check_stops_before_build_and_cannot_issue_ready_summary(self):
        summary, executed = self.run_fixture(failed='application-tests')
        self.assertEqual(executed, ['install', 'audit', 'application-tests'])
        self.assertFalse(summary['releaseReady'])
        self.assertFalse(summary['deploymentAuthorized'])
        self.assertNotIn('artifact', summary)

    def test_summary_binds_complete_checks_and_package_to_exact_source(self):
        summary, executed = self.run_fixture()
        self.assertEqual(executed[-3:], ['runtime-prepare', 'runtime-install', 'package'])
        self.assertEqual(summary['sourceCommit'], 'a' * 40)
        self.assertEqual(summary['sourceRef'], 'refs/heads/pre')
        self.assertEqual(summary['artifact']['sha256'], hashlib.sha256(b'test artifact').hexdigest())
        self.assertEqual(summary['artifact']['bytes'], len(b'test artifact'))
        self.assertTrue(summary['releaseReady'])
        self.assertFalse(summary['deploymentAuthorized'])

    def run_fixture(self, failed=None):
        profile = checks.load_profile()
        executed = []

        def execute(row, env, output, ref, commit):
            check_id = row['id']
            executed.append(check_id)
            self.assertEqual((ref, commit), ('pre', 'a' * 40))
            if check_id == 'package':
                (root / 'output').mkdir()
                (root / 'output' / checks.ARTIFACT).write_bytes(b'test artifact')
            return {'id': check_id, 'exitCode': int(check_id == failed)}

        with tempfile.TemporaryDirectory() as scratch:
            base = Path(scratch).resolve()
            root, out = base / 'source', base / 'out'
            root.mkdir()
            out.mkdir()
            with patch.object(checks, 'ROOT', root), patch.object(checks, 'verify_lease'), \
                 patch.object(checks, 'verify_source'), patch.object(checks, 'execute', side_effect=execute), \
                 patch.object(checks.subprocess, 'check_output', return_value=b'v24.1.0'):
                self.assertEqual(checks.run(profile, 'pre', 'a' * 40, out), int(failed is not None))
            return json.loads((out / 'summary.json').read_text(encoding='utf-8')), executed


if __name__ == '__main__':
    unittest.main()
