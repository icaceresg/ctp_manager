"""Compare exact collector sources against a loopback stats-API/kernel fixture.

No Docker daemon, database, real process counters, CTP service or credentials.
One synthetic HTTP response models one CLI stats invocation. It deliberately
does not claim to reproduce Docker's per-container subscription CPU cost.
"""
import argparse
import hashlib
import http.server
import importlib.util
import json
import pathlib
import sys
import tempfile
import threading
import time
import urllib.request


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-collector', required=True, type=pathlib.Path)
    parser.add_argument('--candidate-collector', type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    parser.add_argument('--containers', type=int, default=40)
    args = parser.parse_args()
    if not 1 <= args.containers <= 100:
        raise ValueError('fixture_container_limit')
    repo = pathlib.Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo/'infra/vps/metrics'))
    baseline = load(args.baseline_collector, 'baseline_observer')
    candidate_file = args.candidate_collector or repo/'infra/vps/metrics/collect.py'
    candidate = load(candidate_file, 'candidate_observer')
    inventory = [{'name': '/ctp-prod-unit'+str(i), 'id': format(i+1, '064x'), 'pid': 10000+i,
                  'status': 'running', 'memoryLimit': 8192, 'oomKilled': False, 'restarts': 0, 'health': 'healthy'}
                 for i in range(args.containers)]
    body = ('\n'.join(json.dumps({'Name': row['name'].lstrip('/'), 'CPUPerc': '1.0%', 'MemUsage': '3KiB / 8KiB'})
                      for row in inventory)).encode()
    requests = [0]

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            assert self.path == '/synthetic-docker-stats'
            requests[0] += 1
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='ctp-observer-kernel-fixture-') as folder:
            root = pathlib.Path(folder)
            cgroup, proc = root/'cgroup', root/'proc'
            cgroup.mkdir(); proc.mkdir()
            (cgroup/'cgroup.controllers').write_text('cpu memory io pids\n')
            for row in inventory:
                group = cgroup/'system.slice'/('docker-'+row['id']+'.scope')
                process = proc/str(row['pid'])
                group.mkdir(parents=True); process.mkdir()
                (process/'cgroup').write_text('0::/system.slice/docker-'+row['id']+'.scope\n')
                (process/'stat').write_text(str(row['pid'])+' (synthetic worker) '+' '.join(['S']+['0']*18+['12500']+['0']*5)+'\n')
                (group/'cpu.stat').write_text('usage_usec 90000000\nuser_usec 50000000\nsystem_usec 40000000\n')
                (group/'memory.current').write_text('4096\n')
                (group/'memory.stat').write_text('anon 2048\ninactive_file 1024\n')
            results = []
            for name, observer in [('installed_baseline', baseline), ('git_candidate', candidate)]:
                calls = []

                def command(arguments, **kwargs):
                    calls.append(arguments[:2])
                    if arguments[:2] == ['docker', 'ps']:
                        return '\n'.join(row['name'].lstrip('/') for row in inventory)
                    if arguments[:2] == ['docker', 'inspect']:
                        return '\n'.join(json.dumps(row) for row in inventory)
                    if arguments[:2] == ['docker', 'stats']:
                        with urllib.request.urlopen('http://127.0.0.1:'+str(server.server_port)+'/synthetic-docker-stats', timeout=2) as response:
                            return response.read().decode()
                    if arguments[:2] == ['systemctl', 'show']:
                        return ''
                    raise AssertionError('unexpected_fixture_command')

                observer.command = command
                previous_requests = requests[0]
                if name == 'git_candidate':
                    rows, state = observer.service_snapshots({}, 60, cgroup_root=cgroup, proc_root=proc)
                    assert all(row['cpuPercent'] is None for row in rows), 'first CPU samples must be unknown'
                    assert len(state['_containerCpu']) == args.containers
                else:
                    rows, state = observer.service_snapshots({}, 60)
                assert len(rows) == args.containers
                results.append({'variant': name, 'inventoryContainers': len(rows),
                                'dockerStatsCliInvocations': calls.count(['docker', 'stats']),
                                'syntheticStatsHttpRequests': requests[0]-previous_requests,
                                'dockerInventoryCalls': calls.count(['docker', 'ps'])+calls.count(['docker', 'inspect']),
                                'systemdCalls': calls.count(['systemctl', 'show']),
                                'memoryPayloadPreserved': all(row['memoryBytes'] == 3072 for row in rows)})
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)
    assert results[0]['dockerStatsCliInvocations'] == results[0]['syntheticStatsHttpRequests'] == 1
    assert results[1]['dockerStatsCliInvocations'] == results[1]['syntheticStatsHttpRequests'] == 0
    assert all(row['memoryPayloadPreserved'] for row in results)
    result = {'kind': 'LOCAL_COLLECTOR_STATS_FANOUT_FIXTURE', 'passed': True,
              'baselineSha256': hashlib.sha256(args.baseline_collector.read_bytes()).hexdigest(),
              'candidateSha256': hashlib.sha256(candidate_file.read_bytes()).hexdigest(),
              'results': results, 'realDockerUsed': False, 'databaseUsed': False, 'sharedDevUsed': False,
              'productionCpuReductionProven': False,
              'limits': ['The loopback server models a CLI stats response, not Docker daemon internals.',
                         'First cgroup CPU samples remain unknown; memory and inventory remain available.',
                         'This proves avoided stats calls, not total host CPU savings.']}
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
