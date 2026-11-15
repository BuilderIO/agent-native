"""Environment, store check and offline install for the M5 batch finalizer.

The finalizer must run on the host: the worker sandbox has no network, no
writable pnpm store and cannot listen on a socket (tsx needs one).
"""
import base64
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

NOT_STARTED = 75
SOCKET_PATH_LIMIT = 100  # macOS sun_path is 104 bytes including the NUL
LOCK_ENTRY = re.compile(r"^  ('?)(?P<key>[^\s'][^:]*?)\1:\s*$")
INTEGRITY = re.compile(r"integrity:\s*(?P<value>sha512-[A-Za-z0-9+/=]+)")
OFFLINE_TARBALL = re.compile(r"https://registry\.npmjs\.org/(?P<name>(?:@[^/\s]+/)?[^/\s]+)/-/(?P<file>[^/\s]+?)\.tgz")


class FinalizerFailure(Exception):
    """An environment failure that must never be attributed to a batch row."""

    def __init__(self, kind, detail, **fields):
        super().__init__(kind + ": " + detail)
        self.reason = {"kind": kind, "detail": detail, **fields}


def in_sandbox(env):
    return bool(env.get("CODEX_SANDBOX")) or env.get("CODEX_SANDBOX_NETWORK_DISABLED") == "1"


def refuse_in_sandbox(env):
    if in_sandbox(env):
        raise FinalizerFailure(
            "finalizer-in-sandbox",
            "the worker sandbox has no network, no writable pnpm store and cannot bind a socket (tsx); "
            "the host runs --phase finalize after the worker ends")


def run_tmpdir(slot, run_id, uid):
    """A short per-run directory under the slot for tsx's unix-socket IPC."""
    path = Path(slot) / ".tmp" / ("f" + str(run_id))
    longest = str(path) + "/tsx-" + str(uid) + "/9999999.pipe"
    if len(longest) > SOCKET_PATH_LIMIT:
        raise FinalizerFailure("tmpdir-too-long", "finalizer TMPDIR would exceed the unix socket path limit: " + longest)
    path.mkdir(parents=True, exist_ok=True)
    return path


def finalizer_env(base, slot, run_id, uid=None):
    uid = os.getuid() if uid is None else uid
    return dict(base, CI="true", TMPDIR=str(run_tmpdir(slot, run_id, uid)))


def is_pnpm_install(command):
    return len(command) >= 2 and command[0] == "pnpm" and command[1] == "install"


def install_attempts(command):
    """Offline first, then prefer-offline; the frozen lockfile flag is never dropped."""
    if "--frozen-lockfile" not in command or any(arg in command for arg in ("--no-frozen-lockfile", "--fix-lockfile", "--lockfile-only")):
        raise FinalizerFailure("lockfile-relaxed", "the finalizer install must keep --frozen-lockfile: " + " ".join(command))
    base = [arg for arg in command if arg not in ("--offline", "--prefer-offline")]
    return [base + ["--offline"], base + ["--prefer-offline"]]


PLATFORM_FIELD = re.compile(r"^    (?P<field>os|cpu):\s*\[(?P<values>[^\]]*)\]")


def current_platform():
    machine = platform.machine()
    return {"darwin": "darwin", "linux": "linux"}.get(sys.platform, sys.platform), {"x86_64": "x64", "aarch64": "arm64"}.get(machine, machine)


def supported(constraints, current):
    values = [item.strip().strip("'\"") for item in constraints.split(",") if item.strip()]
    if any(item.startswith("!") for item in values):
        return ("!" + current) not in values
    return not values or current in values


def lock_packages(text, host=None):
    """(key, integrity, line number) for every registry package pnpm installs on this platform."""
    system, machine = host or current_platform()
    packages, section, entry = [], False, None

    def close():
        if entry and entry["integrity"] and supported(entry.get("os", ""), system) and supported(entry.get("cpu", ""), machine):
            packages.append((entry["key"], entry["integrity"], entry["line"]))

    for number, line in enumerate(text.splitlines(), 1):
        if not line.startswith(" ") and line.strip():
            close()
            section, entry = line.startswith("packages:"), None
            continue
        if not section:
            continue
        found = LOCK_ENTRY.match(line)
        if found:
            close()
            entry = {"key": found.group("key"), "line": number, "integrity": None}
            continue
        if entry is None:
            continue
        integrity = INTEGRITY.search(line)
        if integrity:
            entry["integrity"] = integrity.group("value")
        constraint = PLATFORM_FIELD.match(line)
        if constraint:
            entry[constraint.group("field")] = constraint.group("values")
    close()
    return packages


def index_path(store, integrity, key):
    digest = base64.b64decode(integrity.split("-", 1)[1]).hex()[:64]
    return Path(store) / "index" / digest[:2] / (digest[2:] + "-" + re.sub(r'[\\/:*?"<>|]', "+", key) + ".json")


def missing_from_store(lockfile, store):
    return [{"package": key, "lockfile_entry": "pnpm-lock.yaml:" + str(line) + " packages['" + key + "']"}
            for key, integrity, line in lock_packages(Path(lockfile).read_text())
            if not index_path(store, integrity, key).is_file()]


def store_miss(missing, store):
    first = missing[0]
    return FinalizerFailure(
        "store-miss",
        "package " + first["package"] + " (lockfile entry " + first["lockfile_entry"] + ") is not in the offline store "
        + str(store) + "; " + str(len(missing)) + " lockfile package(s) missing; warm the store from a networked step, not the finalizer",
        package=first["package"], lockfile_entry=first["lockfile_entry"], missing_count=len(missing), store=str(store))


def store_miss_from_log(text, lockfile, store):
    found = OFFLINE_TARBALL.search(text)
    if "ERR_PNPM_NO_OFFLINE_TARBALL" not in text and "ERR_PNPM_NO_OFFLINE_META" not in text:
        return None
    if not found:
        return store_miss([{"package": "unknown", "lockfile_entry": "unknown"}], store)
    name, base = found.group("name"), found.group("file")
    version = base[len(name.split("/")[-1]) + 1:]
    key = name + "@" + version
    entry = next((item for item in missing_from_store(lockfile, store) if item["package"] == key), None)
    return store_miss([entry or {"package": key, "lockfile_entry": "not found in " + str(lockfile)}], store)


def host_store(runner, repo, env):
    done = runner(["pnpm", "store", "path"], cwd=repo, env=env, capture_output=True, text=True, timeout=60)
    if done.returncode or not done.stdout.strip():
        raise FinalizerFailure("store-unknown", "pnpm store path failed: " + done.stderr.strip()[-300:])
    return done.stdout.strip().splitlines()[-1]


def run_logged(runner, command, repo, env, log, timeout):
    with open(log, "a") as out:
        out.write("$ " + " ".join(command) + "\n")
        out.flush()
        done = runner(command, cwd=repo, env=env, stdout=out, stderr=subprocess.STDOUT, timeout=timeout)
    return done.returncode


def install(command, repo, env, log, timeout, runner=subprocess.run):
    """Run the finalizer install. Returns (exit_code, reason); a reason means an environment failure."""
    repo, log = Path(repo), Path(log)
    try:
        refuse_in_sandbox(env)
        attempts = install_attempts(command)
        store = host_store(runner, repo, env)
        missing = missing_from_store(repo / "pnpm-lock.yaml", store)
        if missing:
            raise store_miss(missing, store)
        for number, attempt in enumerate(attempts):
            code = run_logged(runner, attempt, repo, env, log, timeout)
            if code == 0:
                return 0, None
            text = log.read_text()
            miss = store_miss_from_log(text, repo / "pnpm-lock.yaml", store)
            if miss:
                raise miss
        raise FinalizerFailure("install-failed", "pnpm install --frozen-lockfile failed offline and with --prefer-offline (exit " + str(code) + ")",
                               log=str(log))
    except FinalizerFailure as failure:
        with open(log, "a") as out:
            out.write("FINALIZER " + str(failure) + "\n")
        return NOT_STARTED, failure.reason
