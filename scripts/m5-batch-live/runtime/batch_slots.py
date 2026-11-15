#!/usr/bin/env python3
"""Fixed, durable app worktrees. Refusals are retryable non-starts (exit 75)."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import uuid

BUILD_DIRS = frozenset(("build", "dist", ".netlify", ".react-router", ".vite", ".turbo", ".output", ".next"))
EVIDENCE_DIRS = frozenset(("evidence", "receipts", "screenshots", "test-results", "playwright-report"))


class NotStarted(RuntimeError):
    exit_code = 75

    def __init__(self, reason):
        self.reason = reason
        super().__init__("not started: " + reason)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with temp.open("x") as out:
        json.dump(value, out, sort_keys=True)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temp, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def process_identity(pid):
    if not isinstance(pid, int) or pid <= 0:
        return None
    try:
        done = subprocess.run(["ps", "-p", str(pid), "-o", "lstart=", "-o", "stat="], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise NotStarted("cannot inspect slot owner") from error
    if done.returncode not in (0, 1):
        raise NotStarted("cannot inspect slot owner")
    fields = done.stdout.strip().rsplit(None, 1)
    if len(fields) != 2 or fields[1].startswith("Z"):
        return None
    return fields[0]


class SlotManager:
    def __init__(self, repo, root, state_dir, queue_paths=(), integrate="origin/integrate", git="/usr/bin/git"):
        self.repo = Path(repo).resolve()
        self.root = Path(root).resolve()
        self.state = Path(state_dir).resolve()
        self.queue_paths = tuple(Path(p) for p in queue_paths)
        self.integrate = integrate
        self.git_bin = git
        self.state.mkdir(parents=True, exist_ok=True)

    def _git(self, *args, cwd=None, ok=(0,)):
        try:
            done = subprocess.run([self.git_bin, "-C", str(cwd or self.repo), *args], capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise NotStarted("git unavailable: " + type(error).__name__) from error
        if done.returncode not in ok:
            raise NotStarted("git " + args[0] + " failed (exit " + str(done.returncode) + ")")
        return done

    @contextmanager
    def _guard(self):
        with (self.state / "manager.lock").open("a+") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise NotStarted("slot manager busy") from error
            owner = {"pid": os.getpid(), "identity": process_identity(os.getpid()), "heartbeat": time.time(), "active": True}
            atomic_json(self.state / "manager.owner.json", owner)
            stopped = threading.Event()
            renewal_errors = []

            def renew():
                while not stopped.wait(10):
                    try:
                        atomic_json(self.state / "manager.owner.json", {**owner, "heartbeat": time.time()})
                    except OSError as error:
                        renewal_errors.append(error)
                        return

            heartbeat = threading.Thread(target=renew, daemon=True)
            heartbeat.start()
            try:
                yield
            finally:
                stopped.set()
                heartbeat.join()
                atomic_json(self.state / "manager.owner.json", {**owner, "heartbeat": time.time(), "active": False})
                fcntl.flock(lock, fcntl.LOCK_UN)
                if renewal_errors:
                    raise NotStarted("slot manager heartbeat failed") from renewal_errors[0]

    def _record(self, name):
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*-[12]", name):
            raise NotStarted("invalid slot name")
        path = self.state / (name + ".json")
        try:
            record = json.loads(path.read_text())
            required = ("slot", "app", "path", "token", "pid", "identity", "heartbeat", "active")
            if not isinstance(record, dict) or any(key not in record for key in required):
                raise ValueError("incomplete slot record")
            if record["slot"] != name or record["path"] != str(self.root / name):
                raise ValueError("slot path mismatch")
            if (record["app"] != name.rsplit("-", 1)[0]
                    or type(record["pid"]) is not int or record["pid"] <= 0
                    or not isinstance(record["identity"], str) or not record["identity"]
                    or not isinstance(record["token"], str) or not record["token"]
                    or type(record["active"]) is not bool
                    or not isinstance(record["heartbeat"], (int, float)) or not math.isfinite(record["heartbeat"])):
                raise ValueError("invalid slot owner record")
            return record
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as error:
            raise NotStarted("unreadable slot record: " + str(path)) from error

    def _owned(self, lease):
        record = self._record(lease["slot"])
        if record is None or not record["active"] or record.get("token") != lease.get("token"):
            raise NotStarted("slot lease lost")
        if process_identity(record["pid"]) != record["identity"]:
            raise NotStarted("slot owner dead")
        return record

    def acquire(self, app, batch_id, p0=False, owner_pid=None):
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", app):
            raise NotStarted("invalid app")
        indices = (2,) if p0 else (1,)
        pid = os.getpid() if owner_pid is None else owner_pid
        identity = process_identity(pid)
        if identity is None:
            raise NotStarted("slot owner dead")
        with self._guard():
            for index in indices:
                name = app + "-" + str(index)
                previous = self._record(name)
                if previous and previous.get("active"):
                    if process_identity(previous["pid"]) == previous["identity"]:
                        if time.time() - previous["heartbeat"] > 180:
                            raise NotStarted("app slot heartbeat stale but owner still live")
                        continue
                    self._reap_server(previous)
                record = {"slot": name, "app": app, "batch_id": str(batch_id), "path": str(self.root / name),
                          "token": uuid.uuid4().hex, "pid": pid, "identity": identity, "heartbeat": time.time(),
                          "active": True, "recovered_dead_owner": bool(previous and previous.get("active")),
                          "lock_hash": previous.get("lock_hash") if previous else None}
                if previous and previous.get("server"):
                    record["server"] = previous["server"]
                atomic_json(self.state / (name + ".json"), record)
                return record
        raise NotStarted("app slot busy" + (" (P0 reserved slot)" if p0 else ""))

    def heartbeat(self, lease):
        with self._guard():
            record = self._owned(lease)
            record["heartbeat"] = time.time()
            atomic_json(self.state / (record["slot"] + ".json"), record)
            return record

    def _ancestor(self, sha, base):
        done = self._git("merge-base", "--is-ancestor", sha, base, ok=(0, 1))
        return done.returncode == 0

    def _pending(self, path, head, base):
        landed_heads = set()
        pending = []
        unlanded = set(self._git("rev-list", head, "--not", base).stdout.splitlines())
        for location in self.queue_paths:
            if not location.exists():
                raise NotStarted("landing queue unavailable: " + str(location))
            files = location.glob("*.json") if location.is_dir() else (location,)
            for filename in files:
                try:
                    record = json.loads(filename.read_text())
                except (OSError, ValueError) as error:
                    raise NotStarted("landing queue unreadable: " + str(filename)) from error
                for item in record if isinstance(record, list) else (record,):
                    if not isinstance(item, dict):
                        raise NotStarted("invalid landing queue record: " + str(filename))
                    candidate = item.get("candidate") or item.get("candidate_sha") or item.get("head")
                    source = item.get("worktree") or item.get("source_worktree") or item.get("path")
                    if candidate is not None and not isinstance(candidate, str):
                        raise NotStarted("invalid landing candidate: " + str(filename))
                    related = source == str(path) or candidate == head or candidate in unlanded
                    if not related:
                        continue
                    state = item.get("status") or item.get("state")
                    landed = item.get("landed_sha") or item.get("landed_commit") or item.get("integrate_sha")
                    if state == "landed" and candidate == head and landed and self._ancestor(landed, base):
                        landed_heads.add(head)
                        continue
                    if candidate and candidate not in unlanded:
                        if candidate == head or self._ancestor(candidate, base):
                            continue
                    pending.append((candidate, filename))
        for candidate, filename in pending:
            if head in landed_heads and candidate in unlanded:
                continue
            raise NotStarted("slot holds unlanded candidate: " + str(filename))
        pins = self._git("for-each-ref", "--format=%(objectname) %(refname)", "refs/replica/").stdout.splitlines()
        for pin in pins:
            sha, ref = pin.split(" ", 1)
            if sha in unlanded and head not in landed_heads:
                raise NotStarted("slot holds unlanded pin: " + ref)
        if head in unlanded and head not in landed_heads:
            raise NotStarted("slot holds unlanded commits")
        self._git("update-ref", "refs/replica/slots/" + path.name + "/" + head, head)

    def _clean_outputs(self, path):
        cleaned = []
        for directory, names, _ in os.walk(path, followlinks=False):
            names[:] = [name for name in names if name not in EVIDENCE_DIRS and name not in (".git", "node_modules")]
            for name in tuple(names):
                if name not in BUILD_DIRS:
                    continue
                names.remove(name)
                output = Path(directory) / name
                relative = output.relative_to(path).as_posix()
                if output.is_symlink():
                    continue
                if self._git("ls-files", "--", relative, cwd=path).stdout:
                    continue
                if self._git("check-ignore", "-q", "--", relative + "/", cwd=path, ok=(0, 1)).returncode:
                    continue
                protected = any(p.name.lower() in EVIDENCE_DIRS or "receipt" in p.name.lower() or "evidence" in p.name.lower()
                                for p in output.rglob("*"))
                if protected:
                    continue
                self._git("clean", "-fdX", "--", relative, cwd=path)
                cleaned.append(relative)
        return cleaned

    def creation_allowed(self, path, lease):
        record = self._owned(lease)
        if not path or Path(path).resolve() != self.root / record["slot"] or record["path"] != str(Path(path).resolve()):
            raise NotStarted("use a slot")
        return record

    def _switch_safe(self, path, head, base):
        # Git permits overwriting ignored files on checkout; those can still be row evidence.
        current = set(self._git("ls-files", "-z", cwd=path).stdout.split("\0"))
        added = self._git("diff", "--name-only", "--diff-filter=A", "-z", head, base, cwd=path).stdout.split("\0")
        for name in filter(None, added):
            target = path / name
            if name not in current and (target.exists() or target.is_symlink()):
                raise NotStarted("slot has untracked work at incoming path: " + name)
            for parent in target.parents:
                if parent == path:
                    break
                if parent.is_symlink():
                    raise NotStarted("slot has symlink at incoming path: " + parent.relative_to(path).as_posix())

    def prepare(self, lease, fetch=True):
        with self._guard():
            record = self.creation_allowed(lease["path"], lease)
            if fetch:
                self._git("fetch", "--quiet", "origin", "integrate")
            base = self._git("rev-parse", "--verify", self.integrate + "^{commit}").stdout.strip()
            path = Path(record["path"])
            if path.exists():
                if self._git("rev-parse", "--show-toplevel", cwd=path).stdout.strip() != str(path):
                    raise NotStarted("slot path is not its own worktree")
                if self._git("status", "--porcelain", "--untracked-files=no", cwd=path).stdout:
                    raise NotStarted("slot has uncommitted tracked work")
                head = self._git("rev-parse", "HEAD", cwd=path).stdout.strip()
                self._pending(path, head, base)
                self._switch_safe(path, head, base)
                self._reap_server(record)
                self._git("switch", "--detach", base, cwd=path)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                self._git("worktree", "add", "--detach", str(path), base)
            cleaned = self._clean_outputs(path)
            lockfile = path / "pnpm-lock.yaml"
            lock_hash = hashlib.sha256(lockfile.read_bytes()).hexdigest() if lockfile.exists() else None
            install_required = not (path / "node_modules").exists() or record.get("lock_hash") != lock_hash
            record.update({"base_sha": base, "heartbeat": time.time(), "prepared_lock_hash": lock_hash, "cleaned_outputs": cleaned})
            atomic_json(self.state / (record["slot"] + ".json"), record)
            return {**record, "install_required": install_required}

    def installed(self, lease):
        with self._guard():
            record = self._owned(lease)
            record["lock_hash"] = record["prepared_lock_hash"]
            atomic_json(self.state / (record["slot"] + ".json"), record)

    def register_server(self, lease, pid):
        with self._guard():
            record = self._owned(lease)
            if record.get("server") and process_identity(record["server"]["pid"]) == record["server"]["identity"]:
                raise NotStarted("slot dev server already running")
            identity = process_identity(pid)
            if identity is None:
                raise NotStarted("slot dev server dead")
            group = os.getpgid(pid)
            if group != pid or group == os.getpgrp():
                raise NotStarted("slot dev server needs its own process group")
            record["server"] = {"pid": pid, "identity": identity, "pgid": group}
            atomic_json(self.state / (record["slot"] + ".json"), record)
            return record

    def _reap_server(self, record):
        server = record.get("server")
        if not server:
            return
        if process_identity(server["pid"]) != server["identity"]:
            record.pop("server", None)
            return
        if os.getpgid(server["pid"]) != server["pgid"] or server["pgid"] == os.getpgrp():
            raise NotStarted("slot dev server identity changed")
        os.killpg(server["pgid"], signal.SIGTERM)
        deadline = time.monotonic() + 5
        while process_identity(server["pid"]) == server["identity"]:
            if time.monotonic() >= deadline:
                raise NotStarted("slot dev server did not stop")
            time.sleep(0.05)
        record.pop("server", None)

    def reap_server(self, lease):
        with self._guard():
            record = self._owned(lease)
            self._reap_server(record)
            atomic_json(self.state / (record["slot"] + ".json"), record)
            return record

    def release(self, lease):
        with self._guard():
            record = self._owned(lease)
            self._reap_server(record)
            record.update({"active": False, "heartbeat": time.time()})
            atomic_json(self.state / (record["slot"] + ".json"), record)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("acquire", "heartbeat", "prepare", "release", "installed", "guard-create", "server", "reap-server"))
    parser.add_argument("--repo", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--queue", action="append", default=[])
    parser.add_argument("--integrate", default="origin/integrate")
    parser.add_argument("--app")
    parser.add_argument("--batch")
    parser.add_argument("--p0", action="store_true")
    parser.add_argument("--owner-pid", type=int, default=os.getppid())
    parser.add_argument("--lease", help="JSON lease file returned by acquire")
    parser.add_argument("--path")
    parser.add_argument("--server-pid", type=int)
    args = parser.parse_args()
    manager = SlotManager(args.repo, args.root, args.state, args.queue, args.integrate)
    try:
        if args.command == "acquire":
            result = manager.acquire(args.app or "", args.batch or "", args.p0, args.owner_pid)
        else:
            if not args.lease:
                raise NotStarted("use a slot")
            lease = json.loads(Path(args.lease).read_text())
            if args.command == "guard-create":
                result = manager.creation_allowed(args.path, lease)
            elif args.command == "server":
                result = manager.register_server(lease, args.server_pid)
            elif args.command == "reap-server":
                result = manager.reap_server(lease)
            else:
                result = getattr(manager, args.command)(lease)
        print(json.dumps({"status": "ready", "result": result}))
    except NotStarted as error:
        print(json.dumps({"status": "not_started", "reason": error.reason}))
        return error.exit_code
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"status": "not_started", "reason": "slot state unreadable: " + type(error).__name__}))
        return NotStarted.exit_code
    return 0


if __name__ == "__main__":
    sys.exit(main())
