"""Run locally: python test/metrics-traffic.test.py -v."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / "infra/vps/metrics/traffic.py"
SPEC = importlib.util.spec_from_file_location("ctp_metrics_traffic", SOURCE)
traffic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(traffic)
NOW = 1792756800.0


def event(timestamp=NOW - 10, uri="/ranked", status=200, duration=.04,
          method="GET", headers=None, size=123):
    return {"ts": timestamp, "duration": duration, "status": status, "size": size,
            "request": {"method": method, "uri": uri, "remote_ip": "198.51.100.99",
                        "headers": headers or {"Accept": ["text/html"],
                                               "Sec-Fetch-Dest": ["document"],
                                               "User-Agent": ["Test browser"]}}}


def encoded(value):
    return json.dumps(value, separators=(",", ":")).encode() + b"\n"


class TrafficTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "pre.access.json"
        self.prod = Path(self.directory.name) / "prod.access.json"

    def collect(self, state=None, now=NOW, budget=traffic.MAX_BYTES):
        return traffic.collect_traffic({"pre": self.path, "prod": self.prod}, state or {}, now, budget)

    def test_privacy_whitelist_and_source_not_modified(self):
        secrets = ["token-DO-NOT-STORE", "PrivatePlayer123", "198.51.100.99",
                   "Secret-UA-Original", "secret-cookie-value", "private-body-value"]
        item = event(uri="/players/PrivatePlayer123?access_token=token-DO-NOT-STORE")
        item["request"]["headers"].update({"User-Agent": [secrets[3]],
                                              "Cookie": [secrets[4]],
                                              "Authorization": ["Bearer " + secrets[0]]})
        item["request"]["body"] = secrets[5]
        raw = encoded(item) + encoded(event(uri="/unexpected-PrivatePlayer123"))
        self.path.write_bytes(raw)
        result, state, delta = self.collect()
        output = json.dumps([result, state, delta])
        for secret in secrets + [str(self.path), "access_token", "remote_ip", "User-Agent"]:
            self.assertNotIn(secret, output)
        self.assertEqual(raw, self.path.read_bytes())
        self.assertFalse(result["pre"]["uniqueVisitors"])
        self.assertTrue(result["pre"]["coverageFrom"].endswith("Z"))
        self.assertNotIn("coverageFromISO", result["pre"])
        self.assertEqual({row["family"] for row in result["pre"]["routes"]}, {"html", "other"})

    def test_incremental_append_and_input_state_unchanged(self):
        self.path.write_bytes(encoded(event()))
        result, state, delta = self.collect()
        original = copy.deepcopy(state)
        again, same, zero = self.collect(state)
        self.assertEqual(state, original)
        self.assertEqual(again["pre"]["requests24h"], 1)
        self.assertEqual(zero["pre"], {"requests": 0, "errors5xx": 0, "gap": False})
        with self.path.open("ab") as output:
            output.write(encoded(event(status=503)))
        more, _, added = self.collect(same)
        self.assertEqual(more["pre"]["requests24h"], 2)
        self.assertEqual(added["pre"], {"requests": 1, "errors5xx": 1, "gap": False})

    def test_unfinished_line_is_not_persisted_or_counted_twice(self):
        data = encoded(event(uri="/ranked?secret=unfinished-secret"))
        self.path.write_bytes(data[:80])
        first, state, delta = self.collect()
        self.assertEqual(state["environments"]["pre"]["offset"], 0)
        self.assertEqual(delta["pre"]["requests"], 0)
        self.assertNotIn("unfinished-secret", json.dumps(state))
        with self.path.open("ab") as output:
            output.write(data[80:])
        complete, state, delta = self.collect(state)
        self.assertEqual(complete["pre"]["requests24h"], 1)
        self.assertEqual(state["environments"]["pre"]["offset"], len(data))
        self.assertEqual(self.collect(state)[2]["pre"]["requests"], 0)

    def test_initial_tail_is_bounded_and_partial(self):
        self.path.write_bytes(b"".join(encoded(event(NOW - 3600 + i)) for i in range(100)))
        result, state, delta = self.collect(budget=1024)
        self.assertTrue(result["pre"]["partial"])
        self.assertLess(result["pre"]["requests24h"], 100)
        self.assertGreater(result["pre"]["requests24h"], 0)
        self.assertEqual(state["environments"]["pre"]["offset"], self.path.stat().st_size)
        self.assertLess(state["environments"]["pre"]["coverageFrom"], NOW)
        self.assertEqual(state["environments"]["pre"]["completeFrom"], NOW)
        self.assertTrue(delta["pre"]["gap"])

    def test_ordinary_partial_eof_line_does_not_create_a_rate_gap(self):
        self.path.write_bytes(encoded(event()))
        _, state, _ = self.collect()
        pending = encoded(event(NOW + 59, status=503))
        with self.path.open("ab") as output:
            output.write(encoded(event(NOW + 50)))
            output.write(pending[:80])
        result, state, delta = self.collect(state, NOW + 60)
        self.assertEqual(delta["pre"], {"requests": 1, "errors5xx": 0, "gap": False})
        self.assertFalse(state["environments"]["pre"]["backlog"])
        self.assertLess(state["environments"]["pre"]["offset"], self.path.stat().st_size)
        # Also exercise upgrade from the deployed state lacking the new flag.
        del state["environments"]["pre"]["backlog"]
        with self.path.open("ab") as output:
            output.write(pending[80:])
            output.write(encoded(event(NOW + 100)))
        result, state, delta = self.collect(state, NOW + 120)
        self.assertEqual(delta["pre"], {"requests": 2, "errors5xx": 1, "gap": False})
        self.assertEqual(result["pre"]["requests24h"], 4)
        self.assertEqual(self.collect(state, NOW + 180)[2]["pre"],
                         {"requests": 0, "errors5xx": 0, "gap": False})

    def test_eight_mebibyte_read_ceiling_is_enforced(self):
        self.path.write_bytes(b"x" * (traffic.MAX_BYTES + 5) + b"\n" + encoded(event()))
        read_sizes = []
        fdopen = traffic.os.fdopen

        class TrackedFile:
            def __init__(self, source):
                self.source = source

            def __enter__(self):
                self.source.__enter__()
                return self

            def __exit__(self, *args):
                return self.source.__exit__(*args)

            def fileno(self):
                return self.source.fileno()

            def seek(self, offset):
                return self.source.seek(offset)

            def read(self, size):
                read_sizes.append(size)
                return self.source.read(size)

        with mock.patch.object(traffic.os, "fdopen", side_effect=lambda *a, **k: TrackedFile(fdopen(*a, **k))):
            result, state, delta = self.collect(budget=traffic.MAX_BYTES * 2)
        self.assertEqual(read_sizes, [traffic.MAX_BYTES])
        self.assertEqual(result["pre"]["requests24h"], 1)
        self.assertTrue(delta["pre"]["gap"])

    def test_record_arriving_after_observation_cutoff_is_deferred_without_false_gap(self):
        self.path.write_bytes(encoded(event()))
        _, state, _ = self.collect()
        completed = encoded(event(NOW + 59))
        future = encoded(event(NOW + 60.05, status=503,
                               uri="/ranked?token=private-deferred-token"))
        before = self.path.stat().st_size
        with self.path.open("ab") as output:
            output.write(completed + future)
        result, state, delta = self.collect(state, NOW + 60)
        self.assertEqual(delta["pre"], {"requests": 1, "errors5xx": 0, "gap": False})
        self.assertEqual(result["pre"]["requests24h"], 2)
        self.assertEqual(state["environments"]["pre"]["offset"], before + len(completed))
        self.assertTrue(state["environments"]["pre"]["deferred"])
        self.assertFalse(state["environments"]["pre"]["backlog"])
        self.assertNotIn("private-deferred-token", json.dumps([result, state, delta]))
        self.assertNotIn("198.51.100.99", json.dumps(state))
        with self.path.open("ab") as output:
            output.write(encoded(event(NOW + 100)))
        result, state, delta = self.collect(state, NOW + 120)
        self.assertEqual(delta["pre"], {"requests": 2, "errors5xx": 1, "gap": False})
        self.assertFalse(state["environments"]["pre"]["deferred"])
        self.assertEqual(result["pre"]["requests24h"], 4)
        self.assertEqual(self.collect(state, NOW + 180)[2]["pre"],
                         {"requests": 0, "errors5xx": 0, "gap": False})

    def test_excessively_future_record_does_not_block_valid_following_lines(self):
        self.path.write_bytes(encoded(event()))
        _, state, _ = self.collect()
        with self.path.open("ab") as output:
            output.write(encoded(event(NOW + 71)))
            output.write(encoded(event(NOW + 59)))
        result, state, delta = self.collect(state, NOW + 60)
        self.assertTrue(delta["pre"]["gap"])
        self.assertEqual(delta["pre"]["requests"], 1)
        self.assertFalse(state["environments"]["pre"]["deferred"])
        self.assertEqual(state["environments"]["pre"]["offset"], self.path.stat().st_size)

    def test_appended_backlog_drains_without_skipping_records(self):
        self.path.write_bytes(b"")
        _, state, _ = self.collect(budget=700)
        self.path.write_bytes(b"".join(encoded(event()) for _ in range(9)))
        total = 0
        for _ in range(10):
            result, state, delta = self.collect(state, budget=700)
            total += delta["pre"]["requests"]
            # Even the final catch-up sample must not become a current rate.
            self.assertTrue(delta["pre"]["gap"])
            if state["environments"]["pre"]["offset"] == self.path.stat().st_size:
                break
        self.assertEqual(total, 9)
        self.assertEqual(result["pre"]["requests24h"], 9)
        self.assertFalse(state["environments"]["pre"]["backlog"])
        self.assertFalse(self.collect(state, budget=700)[2]["pre"]["gap"])

    def test_rotation_preserves_observed_totals_and_marks_coverage_gap(self):
        self.path.write_bytes(encoded(event(NOW - 86500)) + encoded(event()))
        first, state, _ = self.collect()
        self.assertFalse(first["pre"]["partial"])
        self.path.rename(self.path.with_suffix(".old"))
        self.path.write_bytes(encoded(event(NOW + 5, status=500)))
        result, state, delta = self.collect(state, NOW + 10)
        self.assertEqual(result["pre"]["requests24h"], 2)
        self.assertEqual(delta["pre"], {"requests": 1, "errors5xx": 1, "gap": True})
        self.assertTrue(result["pre"]["partial"])
        self.assertEqual(state["environments"]["pre"]["completeFrom"], NOW + 10)

    def test_legacy_small_complete_backlog_is_not_mistaken_for_an_eof_fragment(self):
        self.path.write_bytes(b"")
        _, state, _ = self.collect(budget=700)
        self.path.write_bytes(encoded(event(NOW - 600)) * 6)
        _, state, delta = self.collect(state, budget=700)
        self.assertTrue(delta["pre"]["gap"])
        del state["environments"]["pre"]["backlog"]
        self.assertLess(state["environments"]["pre"]["size"] - state["environments"]["pre"]["offset"],
                        traffic.MAX_LINE_BYTES)
        result, state, delta = self.collect(state, NOW + 60)
        self.assertGreater(delta["pre"]["requests"], 0)
        self.assertTrue(delta["pre"]["gap"])
        self.assertEqual(result["pre"]["requests24h"], 6)
        self.assertFalse(self.collect(state, NOW + 120)[2]["pre"]["gap"])

    def test_copytruncate_smaller_file_detected(self):
        self.path.write_bytes(encoded(event()) * 3)
        _, state, _ = self.collect()
        self.path.write_bytes(encoded(event(NOW + 1, status=502)))
        result, state, delta = self.collect(state, NOW + 2)
        self.assertEqual(result["pre"]["requests24h"], 4)
        self.assertEqual(delta["pre"]["requests"], 1)
        self.assertTrue(result["pre"]["partial"])

    def test_retention_windows_and_maximum_bucket_count(self):
        self.path.write_bytes(b"".join(encoded(event(NOW - minute * 60)) for minute in range(1500)))
        result, state, _ = self.collect()
        self.assertEqual(len(state["environments"]["pre"]["buckets"]), 1441)
        self.assertEqual(result["pre"]["requests24h"], 1441)
        self.assertEqual(result["pre"]["requests1h"], 61)
        self.assertEqual(result["pre"]["requests5m"], 6)
        later, state, _ = self.collect(state, NOW + 86461)
        self.assertEqual(later["pre"]["requests24h"], 0)
        self.assertEqual(state["environments"]["pre"]["buckets"], {})

    def test_malformed_long_lines_and_nonfinite_values_are_safe(self):
        raw = b'{bad-json-secret}\n' + b'x' * (traffic.MAX_LINE_BYTES + 5) + b'\n'
        invalid = [[], {"ts": float("nan")}, event(duration=float("inf")),
                   event(status=999), event(timestamp=NOW + 11), event(timestamp=10 ** 1000)]
        self.path.write_bytes(raw + b"".join(encoded(item) for item in invalid) + encoded(event()))
        result, state, delta = self.collect()
        self.assertEqual(result["pre"]["requests24h"], 2)  # invalid duration does not erase a valid request
        self.assertTrue(result["pre"]["partial"])
        self.assertEqual(result["pre"]["p95Ms"], 50)
        serialized = json.dumps([result, state, delta], allow_nan=False)
        self.assertNotIn("bad-json-secret", serialized)

    def test_oversize_partial_line_progresses_without_raw_tail(self):
        self.path.write_bytes(b"")
        _, state, _ = self.collect(budget=1024)
        self.path.write_bytes(b"sensitive-tail-" * 120 + b"\n" + encoded(event()))
        _, state, _ = self.collect(state, budget=1024)
        self.assertTrue(state["environments"]["pre"]["droppingLine"])
        self.assertNotIn("sensitive-tail", json.dumps(state))
        result, state, delta = self.collect(state, budget=1024)
        self.assertEqual(result["pre"]["requests24h"], 1)
        self.assertEqual(delta["pre"]["requests"], 1)
        self.assertFalse(state["environments"]["pre"]["droppingLine"])

    def test_histogram_percentiles_errors_documents_and_bots(self):
        items = [event(duration=ms / 1000, status=500 if ms == 500 else 200)
                 for ms in (10, 20, 30, 40, 500)]
        items += [event(uri="/assets/app.js", headers={"Accept": ["*/*"], "User-Agent": ["ExampleCrawler"]}),
                  event(status=404, method="HEAD"),
                  event(headers={"Accept": ["text/html"], "Sec-Fetch-Dest": ["empty"]})]
        self.path.write_bytes(b"".join(encoded(item) for item in items))
        result, _, _ = self.collect()
        pre = result["pre"]
        self.assertEqual(pre["p50Ms"], 50)
        self.assertEqual(pre["p95Ms"], 500)
        self.assertEqual(pre["errors5xx24h"], 1)
        self.assertEqual(pre["errors4xx24h"], 1)
        self.assertEqual(pre["documents24h"], 5)
        self.assertEqual(pre["bots24h"], 1)
        self.assertEqual(pre["bytes24h"], 8 * 123)
        html = next(route for route in pre["routes"] if route["family"] == "html")
        self.assertEqual(html["errors5xx"], 1)
        self.assertEqual(html["p95Ms"], 500)

    def test_environment_isolation_unavailable_and_state_projection(self):
        self.path.write_bytes(encoded(event(status=500)))
        self.prod.write_bytes(encoded(event()) * 2)
        result, state, delta = self.collect()
        self.assertEqual(result["pre"]["requests24h"], 1)
        self.assertEqual(result["prod"]["requests24h"], 2)
        self.assertEqual(delta["prod"]["errors5xx"], 0)
        state["secret"] = "unwanted-secret"
        state["environments"]["pre"]["rawTail"] = "unwanted-secret"
        bucket = next(iter(state["environments"]["pre"]["buckets"].values()))
        bucket["routes"]["/unwanted-secret"] = {"count": 999}
        self.prod.unlink()
        result, state, delta = self.collect(state)
        self.assertFalse(result["prod"]["available"])
        self.assertTrue(delta["prod"]["gap"])
        self.assertEqual(result["prod"]["requests24h"], 2)
        self.assertNotIn("unwanted-secret", json.dumps([result, state, delta]))

    def test_reappearance_after_unavailable_is_not_a_live_rate(self):
        self.path.write_bytes(encoded(event()))
        _, state, _ = self.collect()
        saved = self.path.with_suffix(".saved")
        self.path.rename(saved)
        missing, state, delta = self.collect(state, NOW + 60)
        self.assertFalse(missing["pre"]["available"])
        self.assertTrue(delta["pre"]["gap"])
        saved.rename(self.path)  # Same inode: detecting replacement alone is insufficient.
        with self.path.open("ab") as output:
            output.write(encoded(event(NOW + 30)))
        result, state, delta = self.collect(state, NOW + 120)
        self.assertEqual(delta["pre"]["requests"], 1)
        self.assertTrue(delta["pre"]["gap"])
        self.assertEqual(state["environments"]["pre"]["completeFrom"], NOW + 120)
        self.assertFalse(self.collect(state, NOW + 180)[2]["pre"]["gap"])

    def test_families_are_closed_and_no_route_names_escape(self):
        cases = {"/auth/v1/token?grant_type=refresh_token&code=secret": "refresh",
                 "/auth/v1/signup": "signup", "/auth/v1/recover": "email",
                 "/rest/v1/rpc/eights_state": "poll", "/rest/v1/rpc/eights_action": "action",
                 "/rest/v1/rpc/privateFunction": "rpc", "/rest/v1/privateTable": "rest",
                 "/functions/v1/discord-link": "discord", "/functions/v1/privateFunction": "function",
                 "/functions/v1/manager-operations": "ingress", "/storage/v1/object/private": "storage",
                 "/realtime/v1/websocket": "realtime", "/robots.txt": "metadata",
                 "/privatePlayerName": "other", "/api/operations/ranked/monitor": "poll"}
        for uri, family in cases.items():
            with self.subTest(family=family):
                self.assertEqual(traffic._family("GET", uri), family)
                self.assertIn(family, traffic.FAMILIES)
        self.assertEqual(traffic._family("OPTIONS", "/any-private-route"), "preflight")


if __name__ == "__main__":
    unittest.main()
