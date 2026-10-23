"""PRE-owned aggregate observer. Never writes CTP databases or controls services.

The Manager receives a small read-only JSON snapshot, not Docker/SSH access.
Only aggregate counters are retained. Existing access logs are read by traffic.py.
"""
import argparse
import datetime
import json
import math
import os
import pathlib
import re
import shutil
import stat
import subprocess
import time
import traceback
import urllib.request
import uuid

from traffic import collect_traffic

DIRECTORY = pathlib.Path('/var/lib/ctp-manager-pre-metrics')
SERVICE_NAME = re.compile(r'^(?:ctp-(?:pre|prod)-|supabase-|realtime-dev\.(?:ctp-prod|supabase)-|ctp-manager-(?:pre|prod)|ctp-edge-guard-(?:pre|prod)|caddy)[a-z0-9_.-]{0,90}$')
LOGS = {'pre': '/var/log/caddy/pre-playctp.access.json', 'prod': '/var/log/caddy/playctp.access.json'}
UNITS = ['caddy', 'ctp-manager-pre', 'ctp-manager-prod', 'ctp-edge-guard-pre', 'ctp-edge-guard-prod']
# Retained rollback bridges and retired workers may deliberately be stopped.
# Only the fixed database/auth/REST/gateway cores are unhealthy when not running.
STOPPED_CORE_SERVICES = frozenset(
    prefix+role for prefix in ['supabase-', 'ctp-pre-', 'ctp-prod-']
    for role in ['db', 'auth', 'rest', 'kong', 'envoy'])


def command(args, timeout=10, input_text=None, accepted_codes=(0,)):
    result = subprocess.run(args, input=input_text, capture_output=True, text=True, timeout=timeout)
    if result.returncode not in accepted_codes:
        raise RuntimeError('observer_source_unavailable')
    return result.stdout


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def iso(now):
    return datetime.datetime.fromtimestamp(now, datetime.timezone.utc).isoformat()


def rate(current, previous, elapsed, factor=1):
    if not finite(current) or not finite(previous) or not finite(elapsed) or not 0 < elapsed <= 300 or current < previous:
        return None
    return round((current - previous) / elapsed * factor, 3)


def bytes_value(text):
    match = re.fullmatch(r'\s*([\d.]+)\s*([KMGT]?i?B)\s*', text)
    if not match:
        return None
    multiplier = {'B': 1, 'kB': 1000, 'KB': 1000, 'MB': 1000**2, 'GB': 1000**3, 'TB': 1000**4,
                  'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3, 'TiB': 1024**4}.get(match[2])
    return round(float(match[1]) * multiplier) if multiplier else None


def proc_values():
    cpu = [int(value) for value in pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    memory = {key: int(value.split()[0]) * 1024 for key, value in
              (line.split(':', 1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())}
    vm = {key: int(value) for key, value in (line.split() for line in pathlib.Path('/proc/vmstat').read_text().splitlines())}
    pressure = {}
    for kind in ['cpu', 'memory', 'io']:
        source = pathlib.Path('/proc/pressure') / kind
        match = re.search(r'^some avg10=([\d.]+)', source.read_text(), re.M) if source.exists() else None
        pressure[kind] = float(match[1]) if match else None
    return {'cpu': cpu, 'memory': memory, 'vm': vm, 'pressure': pressure,
            'monotonic': time.monotonic(), 'pageSize': os.sysconf('SC_PAGE_SIZE')}


def host_snapshot(raw, previous, journal):
    old_cpu = previous.get('cpu')
    cpu_percent = io_percent = None
    if isinstance(old_cpu, list) and len(old_cpu) == len(raw['cpu']):
        delta = [current - old for current, old in zip(raw['cpu'], old_cpu)]
        total = sum(delta)
        if total > 0 and min(delta) >= 0:
            cpu_percent = round((total - delta[3] - delta[4]) / total * 100, 2)
            io_percent = round(delta[4] / total * 100, 2)
    memory = raw['memory']
    disk = shutil.disk_usage('/')
    elapsed = raw['monotonic'] - previous.get('monotonic', raw['monotonic'])
    old_vm = previous.get('vm', {})
    load = os.getloadavg()
    return {'cpuCores': os.cpu_count(), 'cpuPercent': cpu_percent, 'iowaitPercent': io_percent,
            'load1': round(load[0], 3), 'load5': round(load[1], 3), 'load15': round(load[2], 3),
            'memoryTotalBytes': memory['MemTotal'], 'memoryAvailableBytes': memory['MemAvailable'],
            'memoryUsedPercent': round((1 - memory['MemAvailable'] / memory['MemTotal']) * 100, 2),
            'swapTotalBytes': memory['SwapTotal'], 'swapUsedBytes': memory['SwapTotal'] - memory['SwapFree'],
            'swapUsedPercent': round((1 - memory['SwapFree'] / memory['SwapTotal']) * 100, 2) if memory['SwapTotal'] else 0,
            'diskTotalBytes': disk.total, 'diskFreeBytes': disk.free, 'diskUsedPercent': round(disk.used / disk.total * 100, 2),
            'oomEvents24h': journal.get('oomEvents24h'), 'failedUnitsCount': journal.get('failedUnitsCount'),
            'pressureCpu10': raw['pressure']['cpu'], 'pressureMem10': raw['pressure']['memory'],
            'pressureIo10': raw['pressure']['io'],
            'swapInBytesPerSec': rate(raw['vm'].get('pswpin'), old_vm.get('pswpin'), elapsed, raw['pageSize']),
            'swapOutBytesPerSec': rate(raw['vm'].get('pswpout'), old_vm.get('pswpout'), elapsed, raw['pageSize'])}


def journal_snapshot(previous, now):
    if 0 <= now - previous.get('at', 0) < 600:
        return previous
    result = {'at': now, 'oomEvents24h': None, 'failedUnitsCount': None}
    try:
        journal = subprocess.run(['journalctl', '--quiet', '-k', '--since', '24 hours ago', '-g', 'Out of memory|Killed process|oom-kill', '--no-pager', '-o', 'cat'], capture_output=True, text=True, timeout=5)
        if journal.returncode == 0 or (journal.returncode == 1 and not journal.stdout.strip() and not journal.stderr.strip()):
            result['oomEvents24h'] = len(journal.stdout.splitlines())
    except (RuntimeError, subprocess.TimeoutExpired):
        pass
    try:
        failed = command(['systemctl', '--failed', '--no-legend', '--plain'], timeout=3)
        result['failedUnitsCount'] = len(failed.splitlines())
    except (RuntimeError, subprocess.TimeoutExpired):
        pass
    return result


def database_snapshot(container):
    sql = """BEGIN READ ONLY;SET LOCAL statement_timeout='3s';SET LOCAL lock_timeout='250ms';
SELECT jsonb_build_object('available',true,
 'database',jsonb_build_object('available',true,'connections',(SELECT count(*)FROM pg_stat_activity),
 'maxConnections',current_setting('max_connections')::integer,
 'active',(SELECT count(*)FROM pg_stat_activity WHERE state='active'),
 'waitingLocks',(SELECT count(*)FROM pg_stat_activity WHERE wait_event_type='Lock'),
 'idleInTransaction',(SELECT count(*)FROM pg_stat_activity WHERE state='idle in transaction'),
 'longestTransactionSeconds',(SELECT coalesce(max(extract(epoch FROM clock_timestamp()-xact_start)),0)::integer FROM pg_stat_activity WHERE xact_start IS NOT NULL),
 'deadlocks',(SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()),'databaseBytes',pg_database_size(current_database())),
 'activity',jsonb_build_object('available',true,'accounts',(SELECT count(*)FROM auth.users WHERE deleted_at IS NULL),
 'confirmedAccounts',(SELECT count(*)FROM auth.users WHERE deleted_at IS NULL AND email_confirmed_at IS NOT NULL),
 'registrations24h',(SELECT count(*)FROM auth.users WHERE deleted_at IS NULL AND created_at>=clock_timestamp()-interval '24 hours'),
 'signIns24h',(SELECT count(*)FROM auth.users WHERE deleted_at IS NULL AND last_sign_in_at>=clock_timestamp()-interval '24 hours'),
 'signIns5m',(SELECT count(*)FROM auth.users WHERE deleted_at IS NULL AND last_sign_in_at>=clock_timestamp()-interval '5 minutes'),
 'waitingPlayers',(SELECT count(*)FROM public.eights_memberships WHERE lobby_id IS NULL),
 'activeMatches',(SELECT count(*)FROM public.eights_lobbies WHERE status IN('voting','drafting','ready','reported','disputed')),
 'activePlayers',(SELECT count(DISTINCT p.user_id)FROM public.eights_lobby_players p JOIN public.eights_lobbies l ON l.id=p.lobby_id WHERE l.status IN('voting','drafting','ready','reported','disputed')),
 'closedMatches24h',(SELECT count(*)FROM public.eights_lobbies WHERE status='closed'AND closed_at>=clock_timestamp()-interval '24 hours')));
COMMIT;"""
    try:
        return json.loads(command(['docker', 'exec', '-i', container, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], timeout=5, input_text=sql))
    except (ValueError, RuntimeError, subprocess.TimeoutExpired):
        return {'available': False, 'database': {'available': False}, 'activity': {'available': False}}


def service_environment(name):
    return 'prod' if 'prod' in name else 'pre' if name.startswith(('supabase-', 'realtime-dev.supabase-', 'ctp-pre-', 'ctp-manager-pre', 'ctp-edge-guard-pre')) else 'host'


def service_snapshots(previous, elapsed):
    result = []
    next_units = {}
    try:
        names = sorted({name for name in command(['docker', 'ps', '-a', '--format', '{{.Names}}'], timeout=3).splitlines()
                        if SERVICE_NAME.fullmatch(name)}, key=lambda name: (name not in STOPPED_CORE_SERVICES, name))[:80]
        fmt = '{"name":{{json .Name}},"memoryLimit":{{json .HostConfig.Memory}},"oomKilled":{{json .State.OOMKilled}},"restarts":{{json .RestartCount}},"status":{{json .State.Status}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}}'
        inventory = {row['name'].lstrip('/'): row for row in
                     (json.loads(line) for line in command(['docker', 'inspect', '--format', fmt, *names], timeout=3).splitlines())} if names else {}
        running = [name for name in names if inventory.get(name, {}).get('status') == 'running']
        measurements = {}
        try:
            stats = command(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *running], timeout=8) if running else ''
            for line in stats.splitlines():
                try:
                    row = json.loads(line)
                    if row.get('Name') in running:
                        measurements[row['Name']] = {'cpuPercent': float(row['CPUPerc'].rstrip('%')),
                                                     'memoryBytes': bytes_value(row['MemUsage'].split('/')[0])}
                except (KeyError, ValueError, TypeError):
                    continue
        except (RuntimeError, subprocess.TimeoutExpired):
            pass
        for name in names:
            info = inventory.get(name)
            if not info or info.get('status') != 'running' and name not in STOPPED_CORE_SERVICES:
                continue
            result.append({'name': name, 'environment': service_environment(name),
                           'cpuPercent': measurements.get(name, {}).get('cpuPercent'),
                           'memoryBytes': measurements.get(name, {}).get('memoryBytes'),
                           'memoryLimitBytes': info['memoryLimit'] or None,
                           'oomKilled': bool(info['oomKilled']), 'restarts': info['restarts'],
                           'status': 'unhealthy' if info.get('health') == 'unhealthy' else info['status']})
    except (KeyError, ValueError, RuntimeError, subprocess.TimeoutExpired):
        pass
    try:
        source = command(['systemctl', 'show', *[name+'.service' for name in UNITS],
                          '-p', 'Id', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'CPUUsageNSec',
                          '-p', 'MemoryCurrent', '-p', 'MemoryMax', '-p', 'NRestarts'],
                         timeout=3, accepted_codes=(0, 1))
    except (RuntimeError, subprocess.TimeoutExpired):
        source = ''
    for block in re.split(r'\n\s*\n', source.strip()):
        try:
            unit = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
            name = unit.get('Id', '').removesuffix('.service')
            if name not in UNITS or unit.get('LoadState') == 'not-found':
                continue
            cpu = int(unit['CPUUsageNSec']) if unit.get('CPUUsageNSec', '').isdigit() else None
            next_units[name] = cpu
            result.append({'name': name, 'environment': service_environment(name), 'cpuPercent': rate(cpu, previous.get(name), elapsed, 100/1e9),
                           'memoryBytes': int(unit['MemoryCurrent']) if unit.get('MemoryCurrent', '').isdigit() else None,
                           'memoryLimitBytes': int(unit['MemoryMax']) if unit.get('MemoryMax', '').isdigit() else None,
                           'oomKilled': False, 'restarts': int(unit.get('NRestarts', '0')), 'status': unit.get('ActiveState', 'unknown')})
        except ValueError:
            continue
    return result[:90], next_units


def alerts_for(host, environments, services):
    alerts = []
    def add(code, severity, scope, value, threshold):
        alerts.append(dict(code=code, severity=severity, scope=scope, value=value, threshold=threshold))
    for key, threshold, code in [('cpuPercent', 85, 'cpu_busy'), ('pressureCpu10', 20, 'cpu_pressure'),
                                  ('memoryUsedPercent', 85, 'memory_low'), ('swapUsedPercent', 80, 'swap_used'), ('diskUsedPercent', 85, 'disk_full')]:
        if finite(host.get(key)) and host[key] >= threshold:
            add(code, 'warning', 'host', host[key], threshold)
    for key in ['swapInBytesPerSec', 'swapOutBytesPerSec']:
        if finite(host.get(key)) and host[key] >= 1024*1024:
            add('swap_activity', 'warning', 'host', host[key], 1024*1024)
    if (host.get('oomEvents24h') or 0) > 0:
        add('oom_recent', 'critical', 'host', host['oomEvents24h'], 0)
    for env, data in environments.items():
        database = data['database']
        if database.get('available'):
            percent = database['connections'] / database['maxConnections'] * 100
            if percent >= 80:
                add('connection_pressure', 'warning', env, round(percent, 2), 80)
            if database.get('waitingLocks', 0) > 0:
                add('database_blocked', 'warning', env, database['waitingLocks'], 0)
            if database.get('idleInTransaction', 0) > 0:
                add('database_idle_transaction', 'warning', env, database['idleInTransaction'], 0)
        else:
            add('source_unavailable', 'warning', env, 1, 0)
        if data['traffic'].get('partial'):
            add('collector_partial', 'info', env, 1, 0)
    for service in services:
        if service['oomKilled'] or service['status'] not in ['running', 'active']:
            add('service_unhealthy', 'warning', service['environment'], 1, 0)
    return alerts[:30]


def read_state():
    path = DIRECTORY/'state.private.json'
    try:
        if path.is_symlink() or path.stat().st_size > 16*1024*1024:
            raise RuntimeError('observer_state_invalid')
        value = json.loads(path.read_text())
        return value if value.get('schemaVersion') == 1 else {}
    except FileNotFoundError:
        return {}


def atomic_json(name, value, public):
    import grp
    directory = DIRECTORY.resolve()
    metadata = DIRECTORY.lstat()
    if directory != DIRECTORY or DIRECTORY.is_symlink() or metadata.st_uid != 0 or metadata.st_mode & 0o022 or name not in ['snapshot.json', 'state.private.json']:
        raise RuntimeError('observer_output_directory_invalid')
    temporary = DIRECTORY/('.'+name+'.'+uuid.uuid4().hex)
    data = (json.dumps(value, separators=(',', ':'), allow_nan=False)+'\n').encode()
    if len(data) > (4 if public else 16)*1024*1024:
        raise RuntimeError('observer_output_too_large')
    fd = os.open(temporary, os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW, 0o640 if public else 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            if public:
                os.fchown(stream.fileno(), 0, grp.getgrnam('ctp-manager-pre').gr_gid)
                os.fchmod(stream.fileno(), 0o640)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, DIRECTORY/name)
    finally:
        if temporary.exists():
            temporary.unlink()


def collect(dry_run=False):
    now = time.time()
    previous = read_state()
    raw = proc_values()
    elapsed = now - previous.get('at', now)
    journal = journal_snapshot(previous.get('journal', {}), now)
    host = host_snapshot(raw, previous.get('proc', {}), journal)
    traffic, traffic_state, counters = collect_traffic(LOGS, previous.get('traffic', {}), now)
    environments = {}
    for env, container in [('pre', 'supabase-db'), ('prod', 'ctp-prod-db')]:
        database = database_snapshot(container)
        traffic_data = traffic.get(env, {'available': False})
        environments[env] = {'traffic': traffic_data, 'routes': traffic_data.pop('routes', []),
                             'activity': database['activity'], 'database': database['database']}
    services, units = service_snapshots(previous.get('units', {}), elapsed)
    point = {'at': iso(now), **{key: host[key] for key in ['cpuPercent', 'memoryUsedPercent', 'swapUsedPercent', 'diskUsedPercent']}}
    for env in ['pre', 'prod']:
        counts = counters.get(env, {})
        valid_interval = previous.get('at') is not None and environments[env]['traffic'].get('available') and not counts.get('gap', False)
        point[env+'Requests'] = rate(counts.get('requests'), 0, elapsed, 60) if valid_interval else None
        point[env+'5xx'] = rate(counts.get('errors5xx'), 0, elapsed, 60) if valid_interval else None
        activity = environments[env]['activity']
        point[env+'WaitingPlayers'] = activity.get('waitingPlayers') if activity.get('available') else None
        point[env+'ActivePlayers'] = activity.get('activePlayers') if activity.get('available') else None
    cutoff = iso(now-86400)
    history = [item for item in previous.get('history', []) if isinstance(item, dict) and cutoff <= item.get('at', '') <= iso(now)]
    history = (history+[point])[-1440:]
    started = previous.get('collectionStartedAt', iso(now))
    snapshot = {'schemaVersion': 1, 'available': True, 'generatedAt': iso(now),
                'source': {'collectionStartedAt': started, 'intervalSeconds': 60, 'retentionHours': 24},
                'host': host, 'environments': environments, 'services': services, 'history': history,
                'alerts': alerts_for(host, environments, services),
                'coverage': {'uniqueVisitors': False, 'pageViews': 'server_documents_only'}}
    if not dry_run:
        atomic_json('state.private.json', {'schemaVersion': 1, 'at': now, 'collectionStartedAt': started,
                                         'proc': raw, 'journal': journal, 'units': units, 'traffic': traffic_state, 'history': history}, False)
        atomic_json('snapshot.json', snapshot, True)
    return snapshot


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if os.name != 'posix' or os.geteuid() != 0:
        raise SystemExit('observer_requires_linux_root')
    os.umask(0o077)
    try:
        value = collect(args.dry_run)
        print(json.dumps({'ok': True, 'dryRun': args.dry_run, 'generatedAt': value['generatedAt'],
                          'services': len(value['services']), 'samples': len(value['history']), 'alerts': value['alerts']}))
    except Exception as error:
        # Fixed diagnostic metadata only: never emit exception messages or locals.
        print(json.dumps({'ok': False, 'errorType': type(error).__name__,
                          'frames': [{'function': f.name, 'line': f.lineno} for f in traceback.extract_tb(error.__traceback__)[-3:]]}))
        raise SystemExit('aggregate_observer_failed')
