import pathlib
import sys
import unittest
import json
import subprocess
import tempfile
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]/'infra/vps/metrics'))
from collect import alerts_for, bytes_value, rate, service_environment
import collect as observer


class AggregateObserverTests(unittest.TestCase):
    def test_counter_rate_uses_elapsed_time_and_preserves_real_zero(self):
        self.assertEqual(rate(150, 90, 30, 60), 120)
        self.assertEqual(rate(0, 0, 60, 60), 0)
        self.assertEqual(rate(120, 60, 120, 60), 30)

    def test_restarts_missing_samples_and_clock_gaps_are_not_zero_traffic(self):
        for args in [(1, 100, 60), (100, None, 60), (100, 10, 0), (100, 10, 301), (float('inf'), 10, 60)]:
            self.assertIsNone(rate(*args))

    def test_memory_units_are_not_confused_with_percentages(self):
        self.assertEqual(bytes_value('128MiB '), 128*1024*1024)
        self.assertEqual(bytes_value('1.5GiB'), round(1.5*1024**3))
        self.assertEqual(bytes_value('0B'), 0)
        self.assertIsNone(bytes_value('27.2%'))

    def test_pre_and_production_service_attribution(self):
        self.assertEqual(service_environment('realtime-dev.ctp-prod-realtime'), 'prod')
        self.assertEqual(service_environment('realtime-dev.supabase-realtime'), 'pre')
        self.assertEqual(service_environment('ctp-manager-pre'), 'pre')
        self.assertEqual(service_environment('caddy'), 'host')

    def test_swap_occupancy_does_not_claim_active_swapping(self):
        alerts = alerts_for({'swapUsedPercent': 96, 'swapInBytesPerSec': 0, 'swapOutBytesPerSec': 0}, {}, [])
        self.assertEqual([a['code'] for a in alerts], ['swap_used'])
        self.assertNotIn('swap_activity', [a['code'] for a in alerts])

    def test_database_connection_pressure_uses_its_own_limit(self):
        data = {'pre': {'database': {'available': True, 'connections': 81, 'maxConnections': 100}, 'traffic': {}}}
        self.assertEqual(alerts_for({}, data, [])[0]['code'], 'connection_pressure')
        self.assertEqual(alerts_for({}, data, [])[0]['scope'], 'pre')

    def test_missing_database_is_unavailable_not_a_healthy_zero(self):
        alerts = alerts_for({}, {'prod': {'database': {'available': False}, 'traffic': {}}}, [])
        self.assertEqual(alerts[0]['code'], 'source_unavailable')

    def test_oom_and_unhealthy_service_are_visible(self):
        alerts = alerts_for({'oomEvents24h': 1}, {}, [{'oomKilled': True, 'status': 'running', 'environment': 'pre'}])
        self.assertEqual([a['code'] for a in alerts], ['oom_recent', 'service_unhealthy'])

    def test_stopped_cores_and_docker_health_remain_visible_without_stats_for_stopped_services(self):
        inventory = [
            {'name': '/supabase-auth', 'status': 'exited', 'memoryLimit': 1024, 'oomKilled': True, 'restarts': 2, 'health': None},
            {'name': '/ctp-prod-envoy', 'status': 'exited', 'memoryLimit': 2048, 'oomKilled': False, 'restarts': 0, 'health': None},
            {'name': '/supabase-rest', 'status': 'running', 'memoryLimit': 4096, 'oomKilled': False, 'restarts': 0, 'health': 'unhealthy'},
            {'name': '/ctp-prod-bridge-rollback', 'status': 'exited', 'memoryLimit': 4096, 'oomKilled': False, 'restarts': 0, 'health': None},
        ]
        calls = []
        def fake(args, **kwargs):
            calls.append((args, kwargs))
            if args[:2] == ['docker', 'ps']:
                self.assertIn('-a', args)
                return '\n'.join(item['name'].lstrip('/') for item in inventory)+'\nnot-ctp-application\n'
            if args[:2] == ['docker', 'inspect']:
                self.assertNotIn('not-ctp-application', args)
                # Docker's strict template evaluation rejects .State.Health on
                # containers with no healthcheck; map lookup keeps them visible.
                self.assertIn('index .State "Health"', args[3])
                self.assertNotIn('.State.Health', args[3])
                return '\n'.join(json.dumps(item) for item in inventory)
            if args[:2] == ['docker', 'stats']:
                self.assertEqual(args[5:], ['supabase-rest'])
                return json.dumps({'Name': 'supabase-rest', 'CPUPerc': '12.5%', 'MemUsage': '1KiB / 4KiB'})
            if args[:2] == ['systemctl', 'show']:
                return ''
            self.fail(args)
        with mock.patch.object(observer, 'command', side_effect=fake):
            services, _ = observer.service_snapshots({}, 60)
        by_name = {row['name']: row for row in services}
        self.assertEqual(set(by_name), {'supabase-auth', 'ctp-prod-envoy', 'supabase-rest'})
        for name in ['supabase-auth', 'ctp-prod-envoy']:
            self.assertIsNone(by_name[name]['cpuPercent'])
            self.assertIsNone(by_name[name]['memoryBytes'])
            self.assertEqual(by_name[name]['status'], 'exited')
        self.assertTrue(by_name['supabase-auth']['oomKilled'])
        self.assertEqual(by_name['supabase-rest']['status'], 'unhealthy')
        self.assertEqual(by_name['supabase-rest']['cpuPercent'], 12.5)
        self.assertEqual(by_name['supabase-rest']['memoryBytes'], 1024)
        self.assertEqual(len(alerts_for({}, {}, services)), 3)

    def test_stats_timeout_preserves_inventory_without_inventing_zero_usage(self):
        def fake(args, **kwargs):
            if args[:2] == ['docker', 'ps']:
                return 'supabase-rest\n'
            if args[:2] == ['docker', 'inspect']:
                return json.dumps({'name': '/supabase-rest', 'status': 'running', 'memoryLimit': 4096, 'oomKilled': False, 'restarts': 0, 'health': None})
            if args[:2] == ['docker', 'stats']:
                raise subprocess.TimeoutExpired(args, 8)
            return ''
        with mock.patch.object(observer, 'command', side_effect=fake):
            services, _ = observer.service_snapshots({}, 60)
        self.assertEqual(len(services), 1)
        self.assertIsNone(services[0]['cpuPercent'])
        self.assertIsNone(services[0]['memoryBytes'])
        self.assertEqual(services[0]['status'], 'running')

    def test_systemd_is_batched_and_id_scoped_with_missing_units_omitted(self):
        calls = []
        def fake(args, **kwargs):
            calls.append((args, kwargs))
            if args[:2] == ['docker', 'ps']:
                return ''
            self.assertEqual(args[:2], ['systemctl', 'show'])
            self.assertTrue(all(name+'.service' in args for name in observer.UNITS))
            self.assertIn('Id', args)
            self.assertEqual(kwargs['timeout'], 3)
            self.assertEqual(kwargs['accepted_codes'], (0, 1))
            return '\n\n'.join([
                'Id=caddy.service\nLoadState=loaded\nActiveState=active\nCPUUsageNSec=2000000000\nMemoryCurrent=1024\nMemoryMax=infinity\nNRestarts=0',
                'Id=ctp-manager-prod.service\nLoadState=not-found\nActiveState=inactive',
                'Id=ctp-manager-pre.service\nLoadState=loaded\nActiveState=active\nCPUUsageNSec=5000000000\nMemoryCurrent=2048\nMemoryMax=4096\nNRestarts=2',
                'Id=unrelated-app.service\nLoadState=loaded\nActiveState=active',
            ])
        with mock.patch.object(observer, 'command', side_effect=fake):
            services, units = observer.service_snapshots({'caddy': 1000000000, 'ctp-manager-pre': 2000000000}, 60)
        self.assertEqual(len([args for args, _ in calls if args[:2] == ['systemctl', 'show']]), 1)
        self.assertEqual([row['name'] for row in services], ['caddy', 'ctp-manager-pre'])
        self.assertEqual(services[0]['cpuPercent'], 1.667)
        self.assertEqual(services[1]['cpuPercent'], 5)
        self.assertEqual(units, {'caddy': 2000000000, 'ctp-manager-pre': 5000000000})

    def test_external_command_timeouts_fit_35_seconds_per_complete_sample(self):
        timeouts = []
        def fake(args, timeout=10, **kwargs):
            timeouts.append(timeout)
            if args[:2] == ['docker', 'exec']:
                self.assertIn('BEGIN READ ONLY', kwargs['input_text'])
                return '{}'
            if args[:2] == ['docker', 'ps']:
                return 'supabase-rest'
            if args[:2] == ['docker', 'inspect']:
                return json.dumps({'name': '/supabase-rest', 'status': 'running', 'memoryLimit': 4096, 'oomKilled': False, 'restarts': 0, 'health': None})
            return ''
        def journal(args, **kwargs):
            timeouts.append(kwargs['timeout'])
            return SimpleNamespace(returncode=0, stdout='', stderr='')
        with mock.patch.object(observer, 'command', side_effect=fake), mock.patch.object(observer.subprocess, 'run', side_effect=journal):
            observer.journal_snapshot({}, 10000)
            observer.database_snapshot('supabase-db')
            observer.database_snapshot('ctp-prod-db')
            observer.service_snapshots({}, 60)
        self.assertEqual(timeouts, [5, 3, 5, 5, 3, 3, 8, 3])
        self.assertEqual(sum(timeouts), 35)

    def test_systemd_exit_one_tolerance_does_not_relax_other_command_failures(self):
        with mock.patch.object(observer.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='Id=caddy.service', stderr='')):
            with self.assertRaises(RuntimeError):
                observer.command(['docker', 'exec'])
            self.assertEqual(observer.command(['systemctl', 'show'], accepted_codes=(0, 1)), 'Id=caddy.service')


class CgroupCounterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.cgroups, self.proc = self.root/'cgroup', self.root/'proc'
        self.cgroups.mkdir(); (self.cgroups/'cgroup.controllers').write_text('cpu memory io pids')
        self.identity = 'a'*64
        self.info = {'id': self.identity, 'pid': 1234, 'name': '/supabase-rest', 'status': 'running',
                     'memoryLimit': 4096, 'oomKilled': False, 'restarts': 0, 'health': 'healthy'}
        self.group = self.cgroups/'system.slice'/('docker-'+self.identity+'.scope')
        self.group.mkdir(parents=True); (self.proc/'1234').mkdir(parents=True)
        (self.proc/'1234'/'cgroup').write_text('0::/system.slice/docker-'+self.identity+'.scope\n')
        self.start_ticks = 12500
        self.write_stat(1234, self.start_ticks)
        (self.group/'cpu.stat').write_text('usage_usec 90000000\nuser_usec 50000000\nsystem_usec 40000000\n')
        (self.group/'memory.current').write_text('4096\n')
        (self.group/'memory.stat').write_text('anon 2048\ninactive_file 1024\n')

    def write_stat(self, pid, start_ticks):
        # The parenthesised process name deliberately contains spaces and ')'.
        fields = ['S']+['0']*18+[str(start_ticks)]+['0']*5
        (self.proc/str(pid)/'stat').write_text(str(pid)+' (synthetic ) worker) '+' '.join(fields)+'\n')

    def previous(self, usage, at=100, **generation):
        return {self.identity: {'usageUsec': usage, 'monotonic': at, 'pid': 1234,
                               'startTicks': self.start_ticks, 'restarts': 0, **generation}}

    def measurement(self, old=None, at=160):
        with mock.patch.object(observer.time, 'monotonic', return_value=at):
            return observer.cgroup_measurement(self.info, old or {}, self.cgroups, self.proc)

    def test_cpu_uses_per_core_docker_convention_and_memory_excludes_inactive_file(self):
        value, counter = self.measurement(self.previous(30000000))
        self.assertEqual(counter, self.previous(90000000, at=160)[self.identity])
        self.assertEqual(value, {'cpuPercent': 100.0, 'memoryBytes': 3072})
        self.assertEqual(self.measurement(self.previous(0), at=130)[0]['cpuPercent'], 300.0)

    def test_first_reset_gap_or_recreated_identity_never_reports_false_zero_cpu(self):
        for old, at in [({}, 160), (self.previous(100000000), 160), (self.previous(0), 401),
                        ({'b'*64: 0}, 160), ({self.identity: 30000000}, 160), (self.previous(0), 100)]:
            self.assertIsNone(self.measurement(old, at)[0]['cpuPercent'])
        self.assertEqual(self.measurement(self.previous(90000000))[0]['cpuPercent'], 0)

    def test_restart_of_same_docker_id_is_unknown_even_when_reset_counter_exceeds_previous_usage(self):
        old = self.previous(30000000)
        self.info['pid'] = 5678
        (self.proc/'5678').mkdir()
        (self.proc/'5678'/'cgroup').write_text('0::/system.slice/docker-'+self.identity+'.scope\n')
        self.write_stat(5678, 60000)
        self.info['restarts'] = 1
        value, counter = self.measurement(old)
        self.assertIsNone(value['cpuPercent'])
        self.assertEqual(counter['usageUsec'], 90000000)
        (self.group/'cpu.stat').write_text('usage_usec 150000000\n')
        self.assertEqual(self.measurement({self.identity: counter}, at=220)[0]['cpuPercent'], 100.0)

    def test_pid_reuse_or_restart_count_change_cannot_reuse_a_counter_generation(self):
        for generation in [{'startTicks': self.start_ticks-1}, {'restarts': 1}, {'pid': 5678}]:
            self.assertIsNone(self.measurement(self.previous(30000000, **generation))[0]['cpuPercent'])

    def test_counter_changes_generation_while_reading_refuses_fast_path(self):
        with mock.patch.object(observer, '_process_start_ticks', side_effect=[12500, 60000]):
            self.assertIsNone(self.measurement(self.previous(30000000)))

    def test_invalid_missing_foreign_or_escaping_counter_paths_refuse_the_fast_path(self):
        for path in ['0::/../../outside\n', '0::/system.slice/docker-foreign.scope\n', '1:cpu:/legacy\n']:
            (self.proc/'1234'/'cgroup').write_text(path)
            self.assertIsNone(self.measurement())
        (self.proc/'1234'/'cgroup').write_text('0::/system.slice/docker-'+self.identity+'.scope\n')
        (self.group/'cpu.stat').write_text('usage_usec invalid\n')
        self.assertIsNone(self.measurement())

    def test_valid_cgroup_snapshot_avoids_docker_stats_but_preserves_inventory_and_bounded_private_counters(self):
        calls = []
        def fake(args, **kwargs):
            calls.append(args[:2])
            if args[:2] == ['docker', 'ps']: return 'supabase-rest'
            if args[:2] == ['docker', 'inspect']: return json.dumps(self.info)
            if args[:2] == ['systemctl', 'show']: return ''
            self.fail('unexpected stats stream')
        with mock.patch.object(observer, 'command', side_effect=fake), mock.patch.object(observer.time, 'monotonic', return_value=160):
            rows, state = observer.service_snapshots({'_containerCpu': self.previous(30000000)}, 60, cgroup_root=self.cgroups, proc_root=self.proc)
        self.assertNotIn(['docker', 'stats'], calls)
        self.assertEqual(rows[0]['cpuPercent'], 100.0)
        self.assertEqual(rows[0]['memoryBytes'], 3072)
        self.assertEqual(state, {'_containerCpu': self.previous(90000000, at=160)})
        self.assertNotIn('pid', rows[0]); self.assertNotIn('id', rows[0])

    def test_cpu_denominator_uses_actual_sample_times_when_earlier_collection_work_varies(self):
        def fake(args, **kwargs):
            if args[:2] == ['docker', 'ps']: return 'supabase-rest'
            if args[:2] == ['docker', 'inspect']: return json.dumps(self.info)
            if args[:2] == ['systemctl', 'show']: return ''
            self.fail('unexpected stats stream')
        # Collect starts may be 60 seconds apart while work before sampling
        # grows from 5s to 35s. These CPU counters are 90s apart, not 60s.
        (self.group/'cpu.stat').write_text('usage_usec 120000000\n')
        previous = {'_containerCpu': self.previous(30000000, at=105)}
        with mock.patch.object(observer, 'command', side_effect=fake), mock.patch.object(observer.time, 'monotonic', return_value=195):
            rows, state = observer.service_snapshots(previous, 60, cgroup_root=self.cgroups, proc_root=self.proc)
        self.assertEqual(rows[0]['cpuPercent'], 100.0, 'using collect-start delta would incorrectly produce 150%')
        self.assertEqual(state['_containerCpu'][self.identity]['monotonic'], 195)
        self.assertNotIn('monotonic', rows[0]); self.assertNotIn('startTicks', rows[0]); self.assertNotIn('pid', rows[0])

    def test_missing_cgroup_falls_back_once_and_a_failed_fallback_keeps_unknown_not_zero(self):
        (self.group/'memory.current').unlink()
        calls = []
        def fake(args, **kwargs):
            calls.append(args[:2])
            if args[:2] == ['docker', 'ps']: return 'supabase-rest'
            if args[:2] == ['docker', 'inspect']: return json.dumps(self.info)
            if args[:2] == ['docker', 'stats']: raise subprocess.TimeoutExpired(args, 8)
            return ''
        with mock.patch.object(observer, 'command', side_effect=fake):
            rows, state = observer.service_snapshots({}, 60, cgroup_root=self.cgroups, proc_root=self.proc)
        self.assertEqual(calls.count(['docker', 'stats']), 1)
        self.assertIsNone(rows[0]['cpuPercent']); self.assertIsNone(rows[0]['memoryBytes'])
        self.assertEqual(state, {})


if __name__ == '__main__':
    unittest.main()
