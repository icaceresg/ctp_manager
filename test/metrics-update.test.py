import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import stat
import sys
import tempfile
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('observer_update', pathlib.Path(__file__).resolve().parents[1] / 'infra/vps/metrics/update-pre.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class CollectorUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ctp-observer-unit-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'stage' / 'collect.py'
        self.source.parent.mkdir()
        self.source.write_bytes(b'VALUE = "new"\n')
        self.target = self.root / 'installed' / 'collect.py'
        self.target.parent.mkdir()
        self.target.write_bytes(b'VALUE = "old"\n')
        self.protected = tuple(self.root / name for name in ('traffic.py', 'observer.service', 'observer.timer'))
        for path in self.protected:
            path.write_bytes(b'preserve\n')
        self.manifest = {'schemaVersion': 1, 'scope': 'pre_metrics_collector_only', 'sourceCommit': 'a' * 40,
                         'expectedInstalledSha256': updater.sha(self.target.read_bytes()),
                         'candidateSha256': updater.sha(self.source.read_bytes()),
                         'protectedSha256': {str(path): updater.sha(path.read_bytes()) for path in self.protected}}

    def plan(self, manifest=None):
        return updater.inspect_plan(self.source, manifest or self.manifest, target=self.target,
                                    protected=self.protected, reader=pathlib.Path.read_bytes)

    def test_plan_is_readonly_and_pins_exact_bytes(self):
        before = {str(path): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        plan, new, old = self.plan()
        self.assertEqual(plan['candidateSha256'], updater.sha(new))
        self.assertEqual(plan['installedSha256'], updater.sha(old))
        self.assertEqual(plan['servicesToControl'], [])
        self.assertEqual(plan['timersToChange'], [])
        self.assertFalse(plan['productionChanges'])
        self.assertFalse(plan['databaseWrites'])
        self.assertEqual(before, {str(path): path.read_bytes() for path in self.root.rglob('*') if path.is_file()})

    def test_other_scope_inventory_and_paths_are_rejected(self):
        for key, value in [('scope', 'prod'), ('schemaVersion', 2), ('sourceCommit', '../private')]:
            candidate = {**self.manifest, key: value}
            with self.assertRaises(RuntimeError):
                self.plan(candidate)
        with self.assertRaisesRegex(RuntimeError, 'manifest_inventory'):
            self.plan({**self.manifest, 'arbitraryFile': '/etc/private'})
        candidate = copy.deepcopy(self.manifest)
        candidate['protectedSha256'].clear()
        with self.assertRaisesRegex(RuntimeError, 'protected_inventory'):
            self.plan(candidate)

    def test_candidate_drift_installed_drift_and_protected_drift_refuse_publication(self):
        for path, expected in [(self.source, 'candidate_changed'), (self.target, 'installed_changed'),
                               (self.protected[0], 'protected_changed')]:
            original = path.read_bytes()
            path.write_bytes(b'changed\n')
            with self.assertRaisesRegex(RuntimeError, expected):
                self.plan()
            path.write_bytes(original)

    def test_invalid_python_is_not_installed(self):
        self.source.write_bytes(b'invalid !!!\n')
        self.manifest['candidateSha256'] = updater.sha(self.source.read_bytes())
        with self.assertRaises(SyntaxError):
            self.plan()

    def test_untrusted_owner_permissions_symlink_and_oversize_are_rejected_before_read(self):
        for mode, owner, size in [(stat.S_IFREG | 0o644, 1000, 10),
                                  (stat.S_IFREG | 0o664, 0, 10),
                                  (stat.S_IFLNK | 0o777, 0, 10),
                                  (stat.S_IFREG | 0o644, 0, updater.LIMIT + 1)]:
            path = mock.Mock()
            path.is_absolute.return_value = True
            path.resolve.return_value = path
            path.lstat.return_value = types.SimpleNamespace(st_mode=mode, st_uid=owner, st_size=size)
            path.parents = []
            with self.assertRaises(RuntimeError):
                updater.regular_root_file(path)
            path.read_bytes.assert_not_called()

    def update(self, digest, atomic):
        # Test fixture only: no root filesystem, service, database or real lock.
        fake_fcntl = types.SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=mock.Mock())
        with mock.patch.dict(sys.modules, {'fcntl': fake_fcntl}), \
             mock.patch.object(os, 'O_NOFOLLOW', getattr(os, 'O_NOFOLLOW', 0), create=True), \
             mock.patch.object(os, 'fstat', return_value=types.SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0)), \
             mock.patch.object(updater, 'atomic_replace', side_effect=atomic):
            value = updater.update(self.source, self.manifest, digest, target=self.target,
                                   protected=self.protected, reader=pathlib.Path.read_bytes)
        fake_fcntl.flock.assert_called_once()
        return value

    def test_wrong_review_hash_cannot_replace_target(self):
        with self.assertRaisesRegex(RuntimeError, 'exact_plan_required'):
            self.update('0' * 64, lambda *_: self.fail('must not write target'))
        self.assertEqual(self.target.read_bytes(), b'VALUE = "old"\n')

    def test_update_retains_old_bytes_and_refuses_repeated_apply(self):
        plan, new, old = self.plan()
        digest = updater.sha(updater.canonical(plan))
        value = self.update(digest, lambda path, data: path.write_bytes(data))
        self.assertTrue(value['applied'])
        self.assertTrue(value['nextScheduledRunOnly'])
        self.assertEqual(self.target.read_bytes(), new)
        backup = self.target.parent / ('collect.previous-' + updater.sha(old) + '.py')
        self.assertEqual(backup.read_bytes(), old)
        for path in self.protected:
            self.assertEqual(path.read_bytes(), b'preserve\n')
        with self.assertRaisesRegex(RuntimeError, 'installed_changed'):
            self.update(digest, lambda *_: self.fail('must not repeat replacement'))

    def test_nonblocking_lock_contention_never_replaces_a_file(self):
        fake_fcntl = types.SimpleNamespace(LOCK_EX=1, LOCK_NB=2,
                                          flock=mock.Mock(side_effect=BlockingIOError('busy')))
        with mock.patch.dict(sys.modules, {'fcntl': fake_fcntl}), \
             mock.patch.object(os, 'O_NOFOLLOW', getattr(os, 'O_NOFOLLOW', 0), create=True), \
             mock.patch.object(os, 'fstat', return_value=types.SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0)), \
             mock.patch.object(updater, 'atomic_replace') as atomic:
            with self.assertRaises(BlockingIOError):
                updater.update(self.source, self.manifest, '0' * 64, target=self.target,
                               protected=self.protected, reader=pathlib.Path.read_bytes)
        atomic.assert_not_called()
        self.assertEqual(self.target.read_bytes(), b'VALUE = "old"\n')
        self.assertEqual(list(self.target.parent.glob('collect.previous-*')), [])

    def test_post_apply_external_drift_requires_reconciliation_and_is_not_rolled_back(self):
        plan, new, _ = self.plan()
        def replace_then_external_change(path, data):
            path.write_bytes(data)
            self.protected[0].write_bytes(b'external change\n')
        with self.assertRaisesRegex(RuntimeError, 'protected_changed_after_update'):
            self.update(updater.sha(updater.canonical(plan)), replace_then_external_change)
        # Do not erase a concurrent actor's change or pretend nothing applied.
        self.assertEqual(self.target.read_bytes(), new)
        self.assertEqual(self.protected[0].read_bytes(), b'external change\n')

    @unittest.skipUnless(os.name == 'posix', 'Linux atomic filesystem primitives')
    def test_real_atomic_replacement_is_complete_and_has_no_partial_stage(self):
        updater.atomic_replace(self.target, b'complete new bytes\n')
        self.assertEqual(self.target.read_bytes(), b'complete new bytes\n')
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o644)
        self.assertEqual(list(self.target.parent.glob('.collect-update-*')), [])


if __name__ == '__main__':
    unittest.main()
