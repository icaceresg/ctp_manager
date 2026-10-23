"""Read existing Caddy JSON access logs without retaining request identifiers.

Import ``collect_traffic(paths, state, now)`` from the local metrics collector.
``paths`` has only pre/prod file paths; this module makes no network/SQL calls.
The returned state is JSON-serializable and contains file cursors and fixed-size
minute aggregates only. It must be persisted atomically by the caller. No source
path, address, URI, query, header, user agent, body, exception or raw fragment is
returned. There are deliberately no visitor identifiers or visitor hashes.

Windows are minute-resolution (the boundary minute is included). Percentiles
are approximate upper bounds from a fixed latency histogram, over retained 24h
samples. Document loads mean GET requests accepting HTML with a document fetch
destination (or no destination header); they do not count SPA navigations.
Bot counts are user-agent heuristics, not verified classifications.
Public ``coverageFrom`` is the earliest observed log timestamp, including a
partial historical tail. Private ``completeFrom`` tracks reliable continuity;
partial stays true for a full 24h after a gap even when older counts are shown.

``minute_counters`` counts newly consumed, retained events in this invocation,
not requests per second. Initial reads/backlog can include historical events;
the collector must not turn that backfill into a current-traffic rate. Rotation
or truncation preserves collected aggregates but resets reliable coverage. An
unread old rotated file cannot be recovered from the new filename. Copytruncate
followed by regrowth beyond the old size between polls is not detectable from
inode/length alone. No exactly-once guarantee is made for those cases.
"""

from __future__ import annotations

import bisect
import datetime as dt
import json
import math
import os
import re
import stat
from urllib.parse import parse_qs, unquote, urlsplit

MAX_BYTES = 8 * 1024 * 1024
MAX_LINE_BYTES = 64 * 1024
MAX_COUNTER = (1 << 53) - 1
RETENTION_SECONDS = 24 * 60 * 60
LATENCY_BOUNDS_MS = (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000,
                     5000, 10000, 30000, 60000, 120000, 300000, 900000, 3600000)
HISTOGRAM_SIZE = len(LATENCY_BOUNDS_MS) + 1
FAMILIES = frozenset(("html", "static", "rest", "rpc", "poll", "action", "auth",
                      "signup", "login", "refresh", "email", "discord", "ingress",
                      "storage", "realtime", "function", "other", "metadata",
                      "preflight", "internal"))
ENVIRONMENTS = ("pre", "prod")
COUNTERS = ("requests", "documents", "bots", "errors4xx", "errors5xx", "bytes")
POLL_RPCS = frozenset(("eights_state", "eights_state_compact", "eights_leaderboard_page",
                      "get_ranked_leaderboard_page", "get_platform_features",
                      "challenge_state_compact", "challenge_state", "communication_unread_count",
                      "guard_match_state", "get_match_veto_state"))
ACTION_RPCS = frozenset(("eights_action", "eights_party_action"))
INGRESS_FUNCTIONS = frozenset(("stripe-webhook", "eights-discord-worker",
                             "challenge-discord-worker", "tournament-scheduler",
                             "manager-operations"))
HTML_ROOTS = frozenset(("", "app", "perfil", "profile", "jugadores", "players", "equipos",
                        "teams", "torneos", "tournaments", "8s", "ranked", "leaderboard",
                        "terms", "privacy", "cookies", "live", "pro-view", "circuit",
                        "circuito", "guia", "guide", "calendario", "market", "operaciones"))
STATIC_EXTENSION = re.compile(r"\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|svg|ico|gif|avif|mp4|webm|mp3|ogg|wav|wasm|traineddata|map|webmanifest)$", re.I)
BOT = re.compile(r"bot|crawler|spider|headless|curl|wget|python-requests|python-urllib|go-http-client|facebookexternalhit|lighthouse|httpclient", re.I)


def _number(value):
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return -MAX_COUNTER <= value <= MAX_COUNTER
    return isinstance(value, float) and math.isfinite(value)


def _counter(value):
    return min(value, MAX_COUNTER) if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _file_integer(value):
    # Windows file IDs can exceed JavaScript's safe integer range. This private
    # Python state is never sent to the UI; do not truncate inode identity.
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value < (1 << 128) else 0


def _histogram(value=None):
    return [_counter(value[i]) if isinstance(value, list) and i < len(value) else 0
            for i in range(HISTOGRAM_SIZE)]


def _empty_bucket():
    return {**dict.fromkeys(COUNTERS, 0), "hist": _histogram(), "maxMs": 0, "routes": {}}


def _max_ms(value):
    return value if _number(value) and 0 <= value <= MAX_COUNTER else 0


def _sanitize_bucket(value):
    if not isinstance(value, dict):
        return _empty_bucket()
    routes = {}
    raw_routes = value.get("routes", {})
    if isinstance(raw_routes, dict):
        for family in FAMILIES:
            route = raw_routes.get(family)
            if isinstance(route, dict):
                routes[family] = {"count": _counter(route.get("count")),
                                  "errors5xx": _counter(route.get("errors5xx")),
                                  "hist": _histogram(route.get("hist")),
                                  "maxMs": _max_ms(route.get("maxMs"))}
    return {**{key: _counter(value.get(key)) for key in COUNTERS},
            "hist": _histogram(value.get("hist")), "maxMs": _max_ms(value.get("maxMs")),
            "routes": routes}


def _sanitize_state(value, now):
    """Explicit projection also prevents old/custom state fields leaking out."""
    value = value if isinstance(value, dict) else {}
    earliest, current = int((now - RETENTION_SECONDS) // 60), int(now // 60)
    buckets = {}
    raw_buckets = value.get("buckets", {})
    if isinstance(raw_buckets, dict):
        # Iterate the bounded time range, not attacker-controlled dictionary keys.
        for minute in range(max(0, earliest), current + 1):
            key = str(minute)
            if key in raw_buckets:
                buckets[key] = _sanitize_bucket(raw_buckets[key])
    coverage = value.get("coverageFrom")
    coverage = coverage if _number(coverage) and 0 <= coverage <= now else None
    complete = value.get("completeFrom", coverage)
    complete = complete if _number(complete) and 0 <= complete <= now else None
    return {"device": _file_integer(value.get("device")), "inode": _file_integer(value.get("inode")),
            "offset": _file_integer(value.get("offset")), "size": _file_integer(value.get("size")),
            "coverageFrom": coverage, "completeFrom": complete,
            "droppingLine": value.get("droppingLine") is True,
            "unavailable": value.get("unavailable") is True,
            "buckets": buckets}


def _header(headers, name):
    if not isinstance(headers, dict):
        return ""
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == name:
            if isinstance(value, str):
                return value[:8192]
            if isinstance(value, list):
                return ",".join(item[:2048] for item in value[:4] if isinstance(item, str))
    return ""


def _family(method, uri):
    """Only an enum escapes this function; original paths never become keys."""
    if method == "OPTIONS":
        return "preflight"
    if not isinstance(uri, str) or len(uri) > MAX_LINE_BYTES:
        return "other"
    try:
        parsed = urlsplit(uri)
        path = unquote(parsed.path, errors="replace").lower()
        # Invalid paths remain one safe bucket, rather than generating labels.
        if not path.startswith("/") or "\\" in path or any(ord(c) < 32 for c in path):
            return "other"
        parts = [part for part in path.split("/") if part]
        if any(part in (".", "..") for part in parts):
            return "other"
        path = "/" + "/".join(parts)
        if path in ("/robots.txt", "/sitemap.xml", "/release.json", "/auth/v1/health"):
            return "metadata"
        if path in ("/healthz", "/check"):
            return "internal"
        if path.startswith("/auth/v1/") or path.startswith("/api/auth/"):
            leaf = parts[-1]
            if leaf in ("signup", "register"):
                return "signup"
            if leaf in ("recover", "resend", "otp", "magiclink", "forgot-password"):
                return "email"
            if leaf == "refresh":
                return "refresh"
            if leaf == "token":
                # Read only this protocol discriminator; never persist the query.
                grant = parse_qs(parsed.query, max_num_fields=128).get("grant_type", [""])[0]
                return "refresh" if grant == "refresh_token" else "login"
            return "login" if leaf in ("login", "authorize", "callback") else "auth"
        if path.startswith("/rest/v1/rpc/"):
            name = parts[3] if len(parts) > 3 else ""
            return "poll" if name in POLL_RPCS else "action" if name in ACTION_RPCS else "rpc"
        if path == "/rest/v1" or path.startswith("/rest/v1/"):
            return "rest"
        if path.startswith("/functions/v1/"):
            name = parts[2] if len(parts) > 2 else ""
            return ("login" if name == "nickname-login" else "discord" if name == "discord-link"
                    else "ingress" if name in INGRESS_FUNCTIONS else "function")
        if path == "/storage/v1" or path.startswith("/storage/v1/"):
            return "storage"
        if path == "/realtime/v1" or path.startswith("/realtime/v1/"):
            return "realtime"
        if path.startswith("/api/"):
            if path.endswith("/monitor") or path.endswith("/state"):
                return "poll"
            return "rest" if method in ("GET", "HEAD") else "action"
        if parts and parts[0] in ("assets", "fonts", "pwa", "brand") or STATIC_EXTENSION.search(path):
            return "static"
        if parts and parts[0] in ("es", "en", "fr", "de", "it", "pt"):
            parts = parts[1:]
        root = parts[0] if parts else ""
        if root == "login":
            return "login"
        if root in ("register", "registro"):
            return "signup"
        return "html" if root in HTML_ROOTS else "other"
    except (ValueError, UnicodeError):
        return "other"


def _record(line, now):
    try:
        value = json.loads(line)
    except (ValueError, UnicodeError, RecursionError):
        return None
    if not isinstance(value, dict):
        return None
    timestamp, status = value.get("ts"), value.get("status")
    request = value.get("request")
    if (not _number(timestamp) or not 0 <= timestamp <= now
            or not isinstance(status, int) or isinstance(status, bool) or not 100 <= status <= 599
            or not isinstance(request, dict)):
        return None
    method = request.get("method", "")
    method = method.upper() if isinstance(method, str) else ""
    headers = request.get("headers", {})
    accept, destination = _header(headers, "accept").lower(), _header(headers, "sec-fetch-dest").lower()
    document = method == "GET" and "text/html" in accept and destination in ("", "document", "iframe", "frame")
    latency = value.get("duration")
    latency = latency * 1000 if _number(latency) and 0 <= latency <= MAX_COUNTER / 1000 else None
    return {"ts": timestamp, "status": status, "bytes": _counter(value.get("size")),
            "document": document, "bot": bool(BOT.search(_header(headers, "user-agent"))),
            "latency": latency, "family": _family(method, request.get("uri"))}


def _add_record(buckets, item):
    key = str(int(item["ts"] // 60))
    bucket = buckets.setdefault(key, _empty_bucket())
    bucket["requests"] += 1
    bucket["documents"] += int(item["document"])
    bucket["bots"] += int(item["bot"])
    bucket["errors4xx"] += int(400 <= item["status"] <= 499)
    error = int(item["status"] >= 500)
    bucket["errors5xx"] += error
    bucket["bytes"] += item["bytes"]
    route = bucket["routes"].setdefault(item["family"], {"count": 0, "errors5xx": 0, "hist": _histogram(), "maxMs": 0})
    route["count"] += 1
    route["errors5xx"] += error
    if item["latency"] is not None:
        index = bisect.bisect_left(LATENCY_BOUNDS_MS, item["latency"])
        for target in (bucket, route):
            target["hist"][index] += 1
            target["maxMs"] = max(target["maxMs"], item["latency"])


def _percentile(hist, percentile, maximum):
    total = sum(hist)
    if not total:
        return None
    target, seen = math.ceil(total * percentile), 0
    for index, count in enumerate(hist):
        seen += count
        if seen >= target:
            return LATENCY_BOUNDS_MS[index] if index < len(LATENCY_BOUNDS_MS) else maximum
    return None


def _summary(cursor, available, now):
    buckets = cursor["buckets"]
    totals = {key: sum(item[key] for item in buckets.values()) for key in COUNTERS}
    hist = [sum(item["hist"][i] for item in buckets.values()) for i in range(HISTOGRAM_SIZE)]
    maximum = max((item["maxMs"] for item in buckets.values()), default=0)
    routes = []
    for family in sorted(FAMILIES):
        items = [item["routes"][family] for item in buckets.values() if family in item["routes"]]
        count = sum(item["count"] for item in items)
        if not count:
            continue
        route_hist = [sum(item["hist"][i] for item in items) for i in range(HISTOGRAM_SIZE)]
        routes.append({"family": family, "count": count,
                       "errors5xx": sum(item["errors5xx"] for item in items),
                       "p95Ms": _percentile(route_hist, .95, max(item["maxMs"] for item in items))})
    coverage = cursor["coverageFrom"]
    iso = dt.datetime.fromtimestamp(coverage, dt.timezone.utc).isoformat().replace("+00:00", "Z") if coverage is not None else None
    return {"available": available, "coverageFrom": iso,
            "partial": not available or cursor["completeFrom"] is None or cursor["completeFrom"] > now - RETENTION_SECONDS
                       or cursor["offset"] < cursor["size"] or cursor["droppingLine"],
            "uniqueVisitors": False,
            "requests5m": sum(value["requests"] for minute, value in buckets.items() if int(minute) >= int((now - 300) // 60)),
            "requests1h": sum(value["requests"] for minute, value in buckets.items() if int(minute) >= int((now - 3600) // 60)),
            "requests24h": totals["requests"], "documents24h": totals["documents"],
            "bots24h": totals["bots"], "errors4xx24h": totals["errors4xx"],
            "errors5xx24h": totals["errors5xx"], "bytes24h": totals["bytes"],
            "p50Ms": _percentile(hist, .5, maximum), "p95Ms": _percentile(hist, .95, maximum),
            "routes": sorted(routes, key=lambda route: (-route["count"], route["family"]))}


def _consume(path, cursor, now, budget):
    delta = {"requests": 0, "errors5xx": 0, "gap": True}
    if not isinstance(path, (str, os.PathLike)):
        cursor["unavailable"] = True
        return False, delta
    try:
        flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb", buffering=0) as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode):
                cursor["unavailable"] = True
                return False, delta
            initial = cursor["coverageFrom"] is None
            resumed = cursor["unavailable"]
            old_backlog = cursor["offset"] < cursor["size"] or cursor["droppingLine"]
            rotated = not initial and (cursor["device"] != info.st_dev or cursor["inode"] != info.st_ino
                                        or info.st_size < cursor["offset"] or info.st_size < cursor["size"])
            if initial or rotated:
                cursor.update(device=info.st_dev, inode=info.st_ino, offset=0, size=info.st_size,
                              coverageFrom=now if initial else cursor["coverageFrom"],
                              completeFrom=now, droppingLine=False)
            start = cursor["offset"]
            clipped = (initial or rotated) and info.st_size > budget
            if clipped:
                start = info.st_size - budget
                cursor["droppingLine"] = True
            cursor["size"] = info.st_size
            source.seek(start)
            data = source.read(min(budget, max(0, info.st_size - start)))
            cursor["unavailable"] = False
    except (OSError, ValueError, TypeError):
        # No raw OS exception or configured path is propagated to the output.
        cursor["unavailable"] = True
        return False, delta

    offset = start
    position = 0
    clean_initial = initial and not clipped
    first_timestamp = None
    gap = rotated or clipped or resumed
    while position < len(data):
        end = data.find(b"\n", position)
        if cursor["droppingLine"]:
            if end == -1:
                offset = start + len(data)
                break
            position = end + 1
            offset = start + position
            cursor["droppingLine"] = False
            continue
        if end == -1:
            # Short unfinished lines are re-read next time, never stored raw.
            if len(data) - position >= min(MAX_LINE_BYTES, budget):
                cursor["droppingLine"] = True
                gap = True
                offset = start + len(data)
            break
        line = data[position:end]
        position = end + 1
        offset = start + position
        if not line.strip():
            continue
        if len(line) > MAX_LINE_BYTES:
            gap = True
            continue
        item = _record(line, now)
        if item is None:
            gap = True
            continue
        first_timestamp = item["ts"] if first_timestamp is None else min(first_timestamp, item["ts"])
        if int(item["ts"] // 60) < int((now - RETENTION_SECONDS) // 60):
            continue
        _add_record(cursor["buckets"], item)
        delta["requests"] += 1
        delta["errors5xx"] += int(item["status"] >= 500)
    cursor["offset"] = offset
    if first_timestamp is not None:
        cursor["coverageFrom"] = min(cursor["coverageFrom"], first_timestamp)
        if clean_initial and not gap:
            cursor["completeFrom"] = first_timestamp
    if gap:
        cursor["completeFrom"] = now
    delta["gap"] = bool(initial or old_backlog or gap or cursor["offset"] < cursor["size"] or cursor["droppingLine"])
    return True, delta


def collect_traffic(paths: dict, state: dict, now: float, max_bytes=MAX_BYTES):
    """Return ``(traffic_by_env, new_state, minute_counters)`` without mutation.

    Reads at most min(max_bytes, 8 MiB) from each existing regular file. Missing
    environments are unavailable; no paths are guessed. Cursors before an
    incomplete line are retained; overlong lines are discarded using a boolean
    cursor flag. At most 1,441 minute buckets and the fixed family/histogram
    dimensions survive. Persist state only after accepting the whole result.
    A delta's ``gap`` is true for initial/backlog/rotated/incomplete/unavailable
    reads, so history must not derive current request rates from that sample.
    """
    if not _number(now) or not 0 <= now <= 253402300799:
        raise ValueError("Invalid metrics observation time")
    if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes < 1:
        raise ValueError("Invalid metrics byte budget")
    budget = min(max_bytes, MAX_BYTES)
    paths = paths if isinstance(paths, dict) else {}
    old = state.get("environments", {}) if isinstance(state, dict) and state.get("version") == 1 else {}
    old = old if isinstance(old, dict) else {}
    traffic, cursors, deltas = {}, {}, {}
    for environment in ENVIRONMENTS:
        cursor = _sanitize_state(old.get(environment), now)
        available, delta = _consume(paths.get(environment), cursor, now, budget)
        # Re-project after arithmetic as well as on input; counts remain bounded.
        cursor = _sanitize_state(cursor, now)
        cursors[environment] = cursor
        traffic[environment] = _summary(cursor, available, now)
        deltas[environment] = delta
    return traffic, {"version": 1, "environments": cursors}, deltas
