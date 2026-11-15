import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import batch_finalizer_env as lib
import batch_host_finalize as host
from test_batch_finalizer_env import Runner, stock_store, write_lock

SPEC = {"rows": [{"key": "a-1"}, {"key": "a-2"}]}


def manifest(**fields):
    base = {"status": "implementing", "rows": {"a-1": {"status": "implemented"}, "a-2": {"status": "implemented"}}}
    return {**base, **fields}


class Launcher:
    def __init__(self):
        self.count = 0

    def __call__(self, directory, log):
        self.count += 1
        return 1000 + self.count, "id" + str(self.count)


class HostFinalizeStepTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(dir="/tmp"))
        self.launch = Launcher()

    def step(self, current, now, alive=False):
        return host.step(self.dir, SPEC, current, now=now, launch=self.launch, alive=lambda state: alive)

    def test_not_applicable_until_every_row_is_collected(self):
        partial = manifest(rows={"a-1": {"status": "implemented"}})
        self.assertEqual(self.step(partial, 0), ("skip", None))
        collecting = manifest(rows={"a-1": {"status": "implemented"}, "a-2": {"status": "collecting"}})
        self.assertEqual(self.step(collecting, 0), ("skip", None))
        self.assertEqual(self.launch.count, 0)

    def test_terminal_and_candidate_manifests_are_left_alone(self):
        for terminal in ("requeued", "verified", "queued", "final_check_failed"):
            self.assertEqual(self.step(manifest(status=terminal), 0), ("skip", None))
        self.assertEqual(self.step(manifest(candidate="abc"), 0), ("skip", None))

    def test_starts_once_then_reports_running_while_alive(self):
        self.assertEqual(self.step(manifest(), 0), ("started", 1))
        self.assertEqual(self.step(manifest(), 5, alive=True), ("running", 1))
        self.assertEqual(self.launch.count, 1)

    def test_retries_after_the_delay_then_blocks_with_the_named_reason_once(self):
        reason = {"kind": "store-miss", "package": "fs-extra@8.1.0", "detail": "named"}
        current = manifest(status="not_started", not_started_reason=reason)
        now = 0
        for attempt in range(1, host.MAX_ATTEMPTS + 1):
            self.assertEqual(self.step(current, now), ("started", attempt))
            if attempt < host.MAX_ATTEMPTS:
                self.assertEqual(self.step(current, now + 1), ("running", attempt))
            now += host.RETRY_DELAY_S + 2
        self.assertEqual(self.step(current, now), ("blocked", reason))
        self.assertEqual(self.step(current, now + 1), ("blocked-reported", reason))
        self.assertEqual(self.launch.count, host.MAX_ATTEMPTS)

    def test_blocked_without_a_manifest_reason_still_names_the_log_tail(self):
        log = self.dir / "finalize-host-1.log"
        log.write_text("not started: uncollected source remains in slot\n")
        current = manifest(status="not_started")
        for _ in range(host.MAX_ATTEMPTS):
            self.step(current, 0)
            (self.dir / "FINALIZE-HOST.json").write_text(json.dumps({**json.loads((self.dir / "FINALIZE-HOST.json").read_text()), "exited_at": -10 ** 6}))
        state = json.loads((self.dir / "FINALIZE-HOST.json").read_text())
        state["log"] = str(log)
        (self.dir / "FINALIZE-HOST.json").write_text(json.dumps(state))
        action, reason = self.step(current, 10 ** 7)
        self.assertEqual(action, "blocked")
        self.assertEqual(reason["kind"], "finalizer-unavailable")
        self.assertIn("uncollected source", reason["detail"])


class HostEnvironmentTest(unittest.TestCase):
    def test_sandbox_markers_are_stripped_and_ci_is_set(self):
        slot = Path(tempfile.mkdtemp(dir="/tmp"))
        env = host.host_environment(slot, "abc123", {"CODEX_SANDBOX": "seatbelt", "CODEX_SANDBOX_NETWORK_DISABLED": "1", "PATH": "/usr/bin"})
        self.assertNotIn("CODEX_SANDBOX", env)
        self.assertNotIn("CODEX_SANDBOX_NETWORK_DISABLED", env)
        self.assertEqual(env["CI"], "true")
        self.assertIn("v24.14.0/bin", env["PATH"].split(":")[0])


class WarmStoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(dir="/tmp"))
        self.repo, self.store, self.log = self.dir / "slot", self.dir / "store", self.dir / "warm.log"
        self.repo.mkdir()
        self.keys = ["a@1.0.0", "b@2.0.0"]
        write_lock(self.repo / "pnpm-lock.yaml", self.keys)

    def runner(self, fetched):
        store, keys = self.store, self.keys

        class Fetching(Runner):
            def __call__(self, command, **kwargs):
                if command[:2] == ["pnpm", "fetch"]:
                    self.calls.append(command)
                    stock_store(store, keys if fetched else [])
                    return SimpleNamespace(returncode=0)
                return super().__call__(command, **kwargs)

        return Fetching(self.store, [])

    def test_warm_store_runs_no_fetch(self):
        stock_store(self.store, self.keys)
        runner = self.runner(True)
        self.assertIsNone(host.warm_store(self.repo, {}, self.log, runner))
        self.assertNotIn(["pnpm", "fetch"], runner.calls)

    def test_missing_packages_are_fetched_by_the_networked_step(self):
        stock_store(self.store, self.keys[:1])
        runner = self.runner(True)
        self.assertIsNone(host.warm_store(self.repo, {}, self.log, runner))
        self.assertIn(["pnpm", "fetch"], runner.calls)

    def test_a_store_that_stays_cold_is_a_named_store_miss(self):
        runner = self.runner(False)
        failure = host.warm_store(self.repo, {}, self.log, runner)
        self.assertEqual(failure.reason["kind"], "store-miss")
        self.assertEqual(failure.reason["package"], "a@1.0.0")


if __name__ == "__main__":
    unittest.main()
