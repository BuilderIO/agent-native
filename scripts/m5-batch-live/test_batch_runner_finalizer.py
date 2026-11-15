"""The patched runner against a real git repository and a fake pnpm."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).with_name("runtime")))

import batch_runner
from batch_slots import NotStarted
from test_batch_finalizer_env import stock_store, write_lock

FAKE_PNPM = """#!/bin/sh
if [ "$1 $2" = "store path" ]; then echo "$FAKE_STORE"; exit 0; fi
if [ "$1" = "install" ]; then
  echo "$*|CI=$CI|TMPDIR=$TMPDIR" >> "$FAKE_CALLS"
  exit 0
fi
exit 0
"""
LANDING = """
def plan(repo, base, head):
    return [["pnpm", "install", "--frozen-lockfile"], ["true"]]
def patch_id(repo, base, head):
    return "patch"
def paths(repo, base, head):
    return ["file.txt"]
"""


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


class RunnerFinalizerTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(dir="/tmp"))
        self.repo, self.evidence, self.store = self.dir / "slot", self.dir / "evidence", self.dir / "store"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "t@example.invalid")
        git(self.repo, "config", "user.name", "t")
        (self.repo / ".gitignore").write_text(".tmp/\n")
        self.keys = ["@changesets/cli@2.31.0", "fs-extra@8.1.0"]
        write_lock(self.repo / "pnpm-lock.yaml", self.keys)
        (self.repo / "file.txt").write_text("one\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "base")
        git(self.repo, "checkout", "-q", "--detach")
        self.base = git(self.repo, "rev-parse", "HEAD")
        bin_dir = self.dir / "bin"
        bin_dir.mkdir()
        pnpm = bin_dir / "pnpm"
        pnpm.write_text(FAKE_PNPM)
        pnpm.chmod(pnpm.stat().st_mode | stat.S_IXUSR)
        (self.dir / "landing.py").write_text(LANDING)
        self.calls = self.dir / "calls.log"
        patcher = mock.patch.dict(os.environ, {"PATH": str(bin_dir) + ":" + os.environ["PATH"], "FAKE_STORE": str(self.store),
                                               "FAKE_CALLS": str(self.calls)})
        patcher.start()
        self.addCleanup(patcher.stop)
        for key in ("CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED"):
            os.environ.pop(key, None)
        self.runner = self.make_runner()
        self.runner.start()
        (self.repo / "file.txt").write_text("two\n")
        receipt = self.dir / "receipt.json"
        receipt.write_text("{}")
        self.runner.collect("a-1", {"status": "implemented", "verdict": "fixed", "receipt": str(receipt)})
        self.collected = git(self.repo, "rev-parse", "HEAD")

    def make_runner(self):
        return batch_runner.BatchRunner(
            repo=self.repo, batch_id="batch-a-1700000123456", app="a",
            rows=[{"key": "a-1", "files": ["file.txt"], "checks": [["false"]], "fixes_row": "t#1"}],
            evidence_dir=self.evidence, check_commands=[["true"]], build_command=["true"], final_commands=[["true"]],
            collect_mode=True, base_sha=self.base, landing_evidence_module=self.dir / "landing.py")

    def test_cold_store_is_a_named_store_miss_not_a_silent_revert(self):
        stock_store(self.store, self.keys[1:])
        with self.assertRaises(NotStarted) as caught:
            self.make_runner().finalize()
        message = str(caught.exception)
        self.assertIn("finalizer store-miss", message)
        self.assertIn("@changesets/cli@2.31.0", message)
        manifest = json.loads((self.evidence / "batch.json").read_text())
        self.assertEqual(manifest["status"], "not_started")
        self.assertEqual(manifest["not_started_reason"]["kind"], "store-miss")
        self.assertEqual(manifest["rows"]["a-1"]["status"], "implemented")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.collected)
        self.assertFalse((self.calls).exists())
        self.assertFalse(list(self.evidence.glob("a-1-isolate-*.log")))

    def test_warm_store_installs_offline_frozen_with_ci_and_a_short_tmpdir(self):
        stock_store(self.store, self.keys)
        self.make_runner().finalize()
        recorded = self.calls.read_text().splitlines()
        self.assertEqual(len(recorded), 1)
        argv, ci, tmpdir = recorded[0].split("|")
        self.assertEqual(argv, "install --frozen-lockfile --offline")
        self.assertEqual(ci, "CI=true")
        self.assertTrue(tmpdir.startswith("TMPDIR=" + str(self.repo.resolve() / ".tmp")))

    def test_finalize_inside_the_worker_sandbox_is_refused_without_touching_the_batch(self):
        stock_store(self.store, self.keys)
        with mock.patch.dict(os.environ, {"CODEX_SANDBOX": "seatbelt"}):
            with self.assertRaises(NotStarted) as caught:
                self.make_runner().finalize()
        self.assertIn("finalizer finalizer-in-sandbox", str(caught.exception))
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.collected)
        self.assertFalse(self.calls.exists())


if __name__ == "__main__":
    unittest.main()
