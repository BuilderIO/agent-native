import base64
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import batch_finalizer_env as lib


def integrity(name):
    return "sha512-" + base64.b64encode(hashlib.sha512(name.encode()).digest()).decode()


def write_lock(path, keys):
    lines = ["lockfileVersion: '9.0'", "", "importers:", "  .: {}", "", "packages:", ""]
    for key in keys:
        lines += ["  '" + key + "':", "    resolution: {integrity: " + integrity(key) + "}", ""]
    lines += ["snapshots:", "", "  x@1.0.0: {}"]
    path.write_text("\n".join(lines) + "\n")


def stock_store(store, keys):
    for key in keys:
        target = lib.index_path(store, integrity(key), key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("{}")


class Runner:
    def __init__(self, store, installs):
        self.store, self.installs, self.calls = store, list(installs), []

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        if command[:3] == ["pnpm", "store", "path"]:
            return SimpleNamespace(returncode=0, stdout=str(self.store) + "\n", stderr="")
        out = kwargs["stdout"]
        code, text = self.installs.pop(0)
        out.write(text)
        return SimpleNamespace(returncode=code)


class FinalizerEnvTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(dir="/tmp"))
        self.repo, self.store, self.log = self.dir / "slot", self.dir / "store", self.dir / "install.log"
        self.repo.mkdir()
        self.keys = ["@changesets/cli@2.31.0", "fs-extra@8.1.0"]
        write_lock(self.repo / "pnpm-lock.yaml", self.keys)
        self.command = ["pnpm", "install", "--frozen-lockfile"]

    def installs(self, runner):
        return [call for call in runner.calls if call[:2] == ["pnpm", "install"]]

    def test_store_missing_one_package_is_a_named_store_miss_and_installs_nothing(self):
        stock_store(self.store, self.keys[1:])
        runner = Runner(self.store, [])
        code, reason = lib.install(self.command, self.repo, {}, self.log, 60, runner)
        self.assertEqual(code, lib.NOT_STARTED)
        self.assertEqual(reason["kind"], "store-miss")
        self.assertEqual(reason["package"], "@changesets/cli@2.31.0")
        self.assertIn("pnpm-lock.yaml:", reason["lockfile_entry"])
        self.assertIn("packages['@changesets/cli@2.31.0']", reason["lockfile_entry"])
        self.assertEqual(reason["missing_count"], 1)
        self.assertEqual(self.installs(runner), [])
        self.assertIn("store-miss", self.log.read_text())

    def test_warm_store_installs_offline_with_the_frozen_lockfile(self):
        stock_store(self.store, self.keys)
        runner = Runner(self.store, [(0, "Done\n")])
        self.assertEqual(lib.install(self.command, self.repo, {}, self.log, 60, runner), (0, None))
        self.assertEqual(self.installs(runner), [self.command + ["--offline"]])

    def test_falls_back_to_prefer_offline_and_keeps_the_frozen_lockfile(self):
        stock_store(self.store, self.keys)
        runner = Runner(self.store, [(1, "ERR_PNPM_OUTDATED_LOCKFILE\n"), (0, "Done\n")])
        self.assertEqual(lib.install(self.command, self.repo, {}, self.log, 60, runner), (0, None))
        attempts = self.installs(runner)
        self.assertEqual(attempts, [self.command + ["--offline"], self.command + ["--prefer-offline"]])
        self.assertTrue(all("--frozen-lockfile" in attempt for attempt in attempts))

    def test_pnpm_offline_tarball_error_is_named_without_a_network_fallback(self):
        stock_store(self.store, self.keys)
        text = ("ERR_PNPM_NO_OFFLINE_TARBALL  A package is missing from the store. The missing package may be downloaded from "
                "https://registry.npmjs.org/@changesets/cli/-/cli-2.31.0.tgz.\n")
        runner = Runner(self.store, [(1, text)])
        code, reason = lib.install(self.command, self.repo, {}, self.log, 60, runner)
        self.assertEqual((code, reason["kind"], reason["package"]), (lib.NOT_STARTED, "store-miss", "@changesets/cli@2.31.0"))
        self.assertEqual(len(self.installs(runner)), 1)

    def test_other_install_failure_is_named_install_failed(self):
        stock_store(self.store, self.keys)
        runner = Runner(self.store, [(1, "boom\n"), (1, "boom\n")])
        code, reason = lib.install(self.command, self.repo, {}, self.log, 60, runner)
        self.assertEqual((code, reason["kind"]), (lib.NOT_STARTED, "install-failed"))

    def test_a_relaxed_lockfile_is_refused(self):
        stock_store(self.store, self.keys)
        for command in (["pnpm", "install"], ["pnpm", "install", "--frozen-lockfile", "--no-frozen-lockfile"],
                        ["pnpm", "install", "--no-frozen-lockfile"]):
            runner = Runner(self.store, [])
            code, reason = lib.install(command, self.repo, {}, self.log, 60, runner)
            self.assertEqual((code, reason["kind"]), (lib.NOT_STARTED, "lockfile-relaxed"))
            self.assertEqual(self.installs(runner), [])

    def test_install_in_the_worker_sandbox_is_refused(self):
        runner = Runner(self.store, [])
        code, reason = lib.install(self.command, self.repo, {"CODEX_SANDBOX": "seatbelt"}, self.log, 60, runner)
        self.assertEqual((code, reason["kind"]), (lib.NOT_STARTED, "finalizer-in-sandbox"))
        self.assertEqual(runner.calls, [])

    def test_env_has_ci_and_a_short_writable_tmpdir(self):
        env = lib.finalizer_env({"PATH": "/usr/bin"}, self.repo, "abc123", uid=501)
        self.assertEqual(env["CI"], "true")
        self.assertEqual(Path(env["TMPDIR"]), self.repo / ".tmp" / "fabc123")
        self.assertTrue(Path(env["TMPDIR"]).is_dir())
        self.assertLessEqual(len(env["TMPDIR"] + "/tsx-501/9999999.pipe"), lib.SOCKET_PATH_LIMIT)

    def test_platform_specific_packages_this_host_does_not_install_are_not_required(self):
        text = ("packages:\n\n  win@1.0.0:\n    resolution: {integrity: " + integrity("win@1.0.0") + "}\n    cpu: [x64]\n    os: [win32]\n\n"
                "  mac@1.0.0:\n    resolution: {integrity: " + integrity("mac@1.0.0") + "}\n    os: [darwin]\n\n"
                "  any@1.0.0:\n    resolution: {integrity: " + integrity("any@1.0.0") + "}\n    os: ['!win32']\n\nsnapshots:\n")
        keys = lambda host: [key for key, _, _ in lib.lock_packages(text, host)]
        self.assertEqual(keys(("darwin", "arm64")), ["mac@1.0.0", "any@1.0.0"])
        self.assertEqual(keys(("win32", "x64")), ["win@1.0.0"])

    def test_a_slot_too_deep_for_a_unix_socket_fails_loudly(self):
        deep = self.dir / ("d" * 90)
        with self.assertRaises(lib.FinalizerFailure) as caught:
            lib.finalizer_env({}, deep, "abc123", uid=501)
        self.assertEqual(caught.exception.reason["kind"], "tmpdir-too-long")


if __name__ == "__main__":
    unittest.main()
