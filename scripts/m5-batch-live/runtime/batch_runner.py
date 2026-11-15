#!/usr/bin/env python3
"""Implement one app batch in an already leased slot and publish one candidate."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import fcntl
import shutil
import uuid
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import threading

from batch_slots import NotStarted, SlotManager, atomic_json, process_identity
import batch_finalizer_env


class BatchFailed(RuntimeError):
    exit_code = 1


def safe_name(value):
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(value))


def argv(value):
    if not isinstance(value, list) or not value or any(not isinstance(x, str) or not x or "\x00" in x for x in value):
        raise ValueError("commands must be nonempty argument arrays")
    return value


def implementation_waves(rows):
    """A conflicting row follows all earlier rows which own one of its files."""
    waves, last = [], {}
    for row in rows:
        index = max((last.get(path, -1) + 1 for path in row["files"]), default=0)
        while len(waves) <= index:
            waves.append([])
        waves[index].append(row)
        for path in row["files"]:
            last[path] = index
    return waves


class BatchRunner:
    def __init__(self, repo, batch_id, app, rows, evidence_dir, check_commands, build_command,
                 final_commands, implement=None, timeout=1800, enqueue_command=None, collect_mode=False, base_sha=None,
                 landing_evidence_module=None):
        self.repo = Path(repo).resolve()
        self.batch_id, self.app = str(batch_id), str(app)
        self.rows = [dict(row) for row in rows]
        self.evidence = Path(evidence_dir).resolve()
        if self.evidence == self.repo or self.repo in self.evidence.parents:
            raise ValueError("batch evidence must live outside its worktree")
        if not 1 <= len(self.rows) <= 10:
            raise ValueError("a batch contains one to ten rows")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", self.app):
            raise ValueError("invalid app")
        self.branch = "batch/" + self.app + "/" + safe_name(batch_id)
        if any(row.get("app", app) != app for row in self.rows):
            raise ValueError("a batch belongs to one app")
        if any(row.get("p0") for row in self.rows) and len(self.rows) != 1:
            raise ValueError("P0 rows require a batch of one")
        keys = [row["key"] for row in self.rows]
        if len(set(keys)) != len(keys):
            raise ValueError("duplicate row")
        for row in self.rows:
            row.setdefault("fixes_row", row["key"])
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*#[A-Za-z0-9][A-Za-z0-9_.-]*", row["fixes_row"]):
                raise ValueError("each row needs its original tracker#row Fixes-row value")
            if not row.get("files") or len(set(row["files"])) != len(row["files"]):
                raise ValueError("each row needs unique owned files")
            for filename in row["files"]:
                path = Path(filename)
                if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] == ".git":
                    raise ValueError("owned files must be repository relative")
                resolved = (self.repo / path).resolve()
                if self.repo not in resolved.parents:
                    raise ValueError("owned file escapes worktree")
            if not row.get("checks"):
                raise ValueError("each row needs a check which can identify its failure")
            for command in row["checks"]:
                argv(command)
            if implement is None and not collect_mode:
                argv(row["implement"])
        self.checks = [argv(command) for command in check_commands]
        self.build = argv(build_command)
        self.final = [argv(command) for command in final_commands]
        if not self.checks or not self.final:
            raise ValueError("batch and final checks are required")
        self.implement = implement or self._implement_command
        self.timeout = timeout
        self.expected_base = base_sha
        self.landing_evidence_module = Path(landing_evidence_module).resolve() if landing_evidence_module else None
        self.enqueue_command = argv(enqueue_command) if enqueue_command else None
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.manifest = {"batch_id": self.batch_id, "app": self.app, "branch": self.branch,
                         "source_worktree": str(self.repo), "worktree": str(self.repo),
                         "status": "preparing", "created_at": time.time(), "rows": {}, "checks": []}
        self.pin = "refs/replica/batches/" + self.app + "/" + safe_name(batch_id)

    def git(self, *args, ok=(0,)):
        result = subprocess.run(["/usr/bin/git", "-C", str(self.repo), *args], capture_output=True,
                                text=True, timeout=120)
        if result.returncode not in ok:
            raise BatchFailed("git " + args[0] + " failed: " + result.stderr.strip()[:400])
        return result

    def save(self):
        atomic_json(self.evidence / "batch.json", self.manifest)

    def _changed(self):
        tracked = self.git("diff", "--name-only", "HEAD", "-z").stdout.split("\x00")
        untracked = self.git("ls-files", "--others", "--exclude-standard", "-z").stdout.split("\x00")
        return set(filter(None, tracked + untracked))

    def _retry_lease_check(self):
        state = getattr(self, "retry_state", None)
        if state is None:
            return
        record = json.loads((Path(state["slot_state"]) / (state["slot"] + ".json")).read_text())
        if (not record.get("active") or record.get("token") != state["slot_token"]
                or record.get("batch_id") != self.batch_id or record.get("app") != self.app
                or Path(record["path"]).resolve() != self.repo or not record.get("identity")
                or process_identity(record["pid"]) != record["identity"]):
            raise NotStarted("validation slot lease lost; recovery fence retained")

    def command(self, command, label, env=None):
        self._retry_lease_check()
        command = argv(command)
        log = getattr(self, "log_evidence", self.evidence) / (safe_name(label) + ".log")
        start = time.time()
        source_tree = self.git("rev-parse", "HEAD^{tree}").stdout.strip()
        reason = None
        try:
            if env is None:
                env = batch_finalizer_env.finalizer_env(os.environ, self.repo, self.batch_id[-6:])
            if batch_finalizer_env.is_pnpm_install(command):
                log.write_text("")
                code, reason = batch_finalizer_env.install(command, self.repo, env, log, self.timeout)
            else:
                with log.open("w") as out:
                    done = subprocess.run(command, cwd=self.repo, env=env, stdout=out,
                                          stderr=subprocess.STDOUT, timeout=self.timeout)
                code = done.returncode
        except subprocess.TimeoutExpired:
            code = 75
            with log.open("a") as out:
                out.write("\nnot started: command timed out; incomplete check\n")
        except OSError as error:
            code = 75
            log.write_text("not started: command unavailable: " + type(error).__name__ + "\n")
        result = {"command": command, "exit_code": code, "log_path": str(log), "source_tree": source_tree,
                  "started_at": start, "finished_at": time.time()}
        if reason:
            result["finalizer_reason"] = reason
        return result

    def _unavailable(self, check, default):
        reason = check.get("finalizer_reason")
        if not reason:
            return NotStarted(default + "; evidence " + check["log_path"])
        self.manifest["not_started_reason"] = reason
        return NotStarted("finalizer " + reason["kind"] + ": " + reason["detail"] + "; evidence " + check["log_path"])

    def _implement_command(self, row, repo, evidence):
        result_path = evidence / "worker-result.json"
        receipt = evidence / "receipt.json"
        env = dict(os.environ, BATCH_ROW_KEY=row["key"], BATCH_WORKTREE=str(repo),
                   BATCH_RECEIPT_PATH=str(receipt), BATCH_RESULT_PATH=str(result_path))
        execution = self.command(row["implement"], row["key"] + "-implement", env)
        if execution["exit_code"]:
            return {"status": "not_started" if execution["exit_code"] == 75 else "failed",
                    "reason": "implementation command failed", "execution": execution}
        try:
            result = json.loads(result_path.read_text())
        except (OSError, ValueError) as error:
            return {"status": "failed", "reason": "worker result unavailable: " + type(error).__name__,
                    "execution": execution}
        return {**result, "execution": execution}

    def _worker(self, row):
        evidence = self.evidence / safe_name(row["key"])
        evidence.mkdir(exist_ok=True)
        try:
            result = self.implement(row, self.repo, evidence)
            if not isinstance(result, dict):
                raise ValueError("worker must return an explicit outcome")
            return result
        except NotStarted as error:
            return {"status": "not_started", "reason": str(error)}
        except Exception as error:
            failure = evidence / "implementation-error.log"
            failure.write_text(type(error).__name__ + ": " + str(error) + "\n")
            return {"status": "failed", "reason": "implementation raised " + type(error).__name__,
                    "log_path": str(failure)}

    def _commit(self, files, message):
        self.git("add", "--", *files)
        self.git("commit", "-q", "-m", message)
        sha = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("update-ref", self.pin, sha)
        return sha

    def _receipt(self, row, outcome):
        receipt = outcome.get("receipt") or outcome.get("receipt_path")
        if not isinstance(receipt, str) or "\n" in receipt or "\r" in receipt:
            raise ValueError("worker must supply a readable receipt path")
        path = Path(receipt).resolve()
        if not path.is_file():
            raise ValueError("worker receipt missing")
        return str(path), hashlib.sha256(path.read_bytes()).hexdigest()

    def _requeue(self, row, reason, checks=(), failure_kind=None, attempt_charge=None):
        record = self.manifest["rows"][row["key"]]
        if attempt_charge is None:
            attempt_charge = record.get("implementation_status") != "not_started"
        failure_kind = failure_kind or ("not_started" if not attempt_charge else "no_change")
        outcome = ("failed: " if attempt_charge else "not started: ") + reason
        record.update({"status": "requeued", "reason": reason, "failing_checks": list(checks),
                       "failure_kind": failure_kind, "attempt_charge": attempt_charge, "requeue_outcome": outcome})
        atomic_json(self.evidence / (safe_name(row["key"]) + ".requeue.json"),
                    {"key": row["key"], "app": self.app, "outcome": outcome, "failure_kind": failure_kind,
                     "attempt_charge": attempt_charge, "evidence_path": str(self.evidence / "batch.json"),
                     "failing_checks": list(checks), "implementation_status": record.get("implementation_status")})

    def _load(self):
        self.manifest = json.loads((self.evidence / "batch.json").read_text())
        if self.manifest.get("batch_id") != self.batch_id or self.manifest.get("app") != self.app:
            raise NotStarted("batch manifest identity changed")
        self.base = self.manifest["base_sha"]
        if self.git("symbolic-ref", "--short", "HEAD").stdout.strip() != self.branch:
            raise NotStarted("slot branch changed")
        if self.expected_base and self.base != self.expected_base:
            raise NotStarted("batch base changed")

    def collect(self, key, outcome):
        self._load()
        row = next((row for row in self.rows if row["key"] == key), None)
        if row is None:
            raise ValueError("unknown row")
        if key in self.manifest["rows"] and self.manifest["rows"][key].get("status") != "collecting":
            raise NotStarted("row already collected")
        for previous in self.rows[:self.rows.index(row)]:
            if set(previous["files"]).intersection(row["files"]) and previous["key"] not in self.manifest["rows"]:
                raise NotStarted("overlapping predecessor must be collected first")
        if self.git("diff", "--cached", "--name-only").stdout:
            raise NotStarted("worker modified shared index")
        changed = self._changed()
        allowed = set(path for candidate in self.rows for path in candidate["files"])
        if changed - allowed:
            raise NotStarted("unowned source remains in slot: " + ", ".join(sorted(changed - allowed)))
        previous = self.manifest["rows"].get(key)
        if previous and previous.get("status") == "collecting":
            head = self.git("rev-parse", "HEAD").stdout.strip()
            if head != previous["before_commit"]:
                parent = self.git("rev-parse", "HEAD^").stdout.strip()
                message = self.git("show", "-s", "--format=%B", "HEAD").stdout
                if parent != previous["before_commit"] or "Fixes-row: " + row["fixes_row"] + "\n" not in message:
                    raise NotStarted("uncertain row commit needs recovery; source preserved")
                previous.update({"commit": head, "status": "implemented"})
                self.git("update-ref", self.pin, head)
                self.save()
                return previous
        record = {"key": key, "fixes_row": row["fixes_row"], "files": row["files"],
                  "implementation_status": outcome.get("status"), "outcome": outcome}
        self.manifest["rows"][key] = record
        files = sorted(changed.intersection(row["files"]))
        if not files:
            self._requeue(row, "implementation produced no change")
            self.save()
            return record
        try:
            receipt, digest = self._receipt(row, outcome)
            verdict = outcome.get("verdict")
            if not isinstance(verdict, str) or not verdict or "\n" in verdict or "\r" in verdict:
                raise ValueError("worker must supply its row verdict")
        except ValueError as error:
            receipt_path = self.evidence / (safe_name(key) + ".failure.json")
            atomic_json(receipt_path, {"row": key, "outcome": outcome, "reason": str(error)})
            receipt, digest = str(receipt_path), hashlib.sha256(receipt_path.read_bytes()).hexdigest()
            verdict = "not-started" if outcome.get("status") == "not_started" else "failed"
            record["implementation_status"] = "not_started" if outcome.get("status") == "not_started" else "failed"
            record["outcome"] = {**outcome, "reason": str(error)}
        record.update({"receipt": receipt, "receipt_sha256": digest, "verdict": verdict})
        message = "Implement " + row["fixes_row"] + "\n\nFixes-row: " + row["fixes_row"]
        message += "\nRow-verdict: " + verdict + "\nRow-receipt: " + receipt
        record.update({"status": "collecting", "before_commit": self.git("rev-parse", "HEAD").stdout.strip()})
        self.save()
        record["commit"] = self._commit(files, message)
        record["status"] = "implemented"
        self.save()
        return record

    def start(self):
        if self._changed() or self.git("diff", "--cached", "--name-only").stdout:
            raise NotStarted("slot has uncommitted source")
        if self.git("symbolic-ref", "-q", "HEAD", ok=(0, 1)).returncode == 0:
            raise NotStarted("batch requires a detached prepared slot")
        self.base = self.git("rev-parse", "HEAD").stdout.strip()
        if self.expected_base and self.base != self.expected_base:
            raise NotStarted("prepared slot base changed")
        self.manifest["base_sha"] = self.base
        self.git("switch", "-q", "-c", self.branch)
        self.manifest["status"] = "implementing"
        self.save()
        return self.manifest

    def run(self):
        self.start()
        pending_failures = set()
        for number, wave in enumerate(implementation_waves(self.rows)):
            head = self.git("rev-parse", "HEAD").stdout.strip()
            with ThreadPoolExecutor(max_workers=len(wave)) as executor:
                outcomes = list(executor.map(self._worker, wave))
            if self.git("rev-parse", "HEAD").stdout.strip() != head or self.git("diff", "--cached", "--name-only").stdout:
                raise BatchFailed("worker changed shared Git state; slot preserved for recovery")
            changed = self._changed()
            allowed = set(path for row in wave for path in row["files"])
            if changed - allowed:
                raise BatchFailed("worker changed files outside its ownership; slot preserved: " + ", ".join(sorted(changed - allowed)))
            for row, outcome in zip(wave, outcomes):
                record = self.collect(row["key"], outcome)
                record["wave"] = number
                self.save()
        return self.finalize(load=False)

    def finalize(self, load=True):
        try:
            batch_finalizer_env.refuse_in_sandbox(os.environ)
        except batch_finalizer_env.FinalizerFailure as failure:
            raise NotStarted("finalizer " + failure.reason["kind"] + ": " + failure.reason["detail"])
        if load:
            self._load()
        self._recover_reverts()
        self._recover_summary()
        if self.manifest.get("candidate"):
            if self.manifest.get("status") == "queued":
                return self.manifest
            if self.landing_evidence_module and not self.manifest.get("source_verification_path"):
                self._publish_source_evidence(self.manifest["candidate"])
                self.manifest["status"] = "verified"
                self.save()
            return self._enqueue()
        if self._changed() or self.git("diff", "--cached", "--name-only").stdout:
            raise NotStarted("uncollected source remains in slot")
        missing = set(row["key"] for row in self.rows) - set(self.manifest["rows"])
        if missing:
            raise NotStarted("rows have not been collected: " + ", ".join(sorted(missing)))
        if all(record["status"] == "requeued" for record in self.manifest["rows"].values()):
            self.manifest["status"] = "requeued"
            self.save()
            return self.manifest
        pending_failures = {key for key, record in self.manifest["rows"].items()
                            if record.get("status") == "implemented" and record.get("implementation_status") != "implemented"}
        pending_failures.update(key for key in self.manifest.get("pending_reverts", [])
                                if self.manifest["rows"][key]["status"] == "implemented")
        if self.landing_evidence_module:
            head = self.git("rev-parse", "HEAD").stdout.strip()
            shared = [self.command(command, "batch-source-plan-" + str(i))
                      for i, command in enumerate(self._source_module().plan(self.repo, self.base, head))]
        else:
            shared = [self.command(command, "batch-check-" + str(i)) for i, command in enumerate(self.checks)]
            shared.append(self.command(self.build, "batch-build"))
        self.manifest["checks"].extend(shared)
        unavailable = [check for check in shared if check["exit_code"] == 75]
        if unavailable:
            self.manifest["status"] = "not_started"
            error = self._unavailable(unavailable[0], "batch check unavailable")
            self.save()
            raise error
        for row in self.rows:
            if self.manifest["rows"][row["key"]]["status"] != "implemented":
                continue
            checks = [self.command(command, row["key"] + "-isolate-" + str(i))
                      for i, command in enumerate(row["checks"])]
            self.manifest["rows"][row["key"]]["checks"] = checks
            if any(check["exit_code"] == 75 for check in checks):
                self.manifest["status"] = "not_started"
                self.save()
                raise NotStarted("row isolation check unavailable; commits retained")
            if any(check["exit_code"] for check in checks):
                pending_failures.add(row["key"])
        if any(check["exit_code"] for check in shared) and not pending_failures:
            self.manifest["status"] = "failed_unisolated"
            self.save()
            raise BatchFailed("batch check failed without an isolated row; commits retained")
        # Later overlapping edits depend on the failed patch; remove them first so
        # reverting an earlier row cannot conflict with a surviving file owner.
        dependencies = set()
        direct_failures = set()
        for row in self.rows:
            if dependencies.intersection(row["files"]):
                pending_failures.add(row["key"])
                dependencies.update(row["files"])
            elif row["key"] in pending_failures:
                direct_failures.add(row["key"])
                dependencies.update(row["files"])
        direct_failures = set(self.manifest.get("direct_revert_failures", direct_failures))
        self.manifest["direct_revert_failures"] = sorted(direct_failures)
        self.manifest["pending_reverts"] = sorted(pending_failures)
        self.save()
        for row in reversed(self.rows):
            record = self.manifest["rows"][row["key"]]
            if row["key"] not in pending_failures or not record.get("commit"):
                continue
            failed_checks = [check for check in record.get("checks", []) if check["exit_code"]]
            dependency = row["key"] not in direct_failures
            reason = "depends on failed row" if dependency else ("row check failed" if failed_checks else "implementation failed")
            kind = "dependency" if dependency else ("check_failed" if failed_checks else record.get("implementation_status", "implementation_failed"))
            charge = not dependency and record.get("implementation_status") != "not_started"
            record.update({"status": "reverting", "revert_intent": {"before_head": self.git("rev-parse", "HEAD").stdout.strip(),
                           "reason": reason, "checks": failed_checks, "failure_kind": kind, "attempt_charge": charge}})
            self.save()
            self._recover_reverts()
        survivors = [row for row in self.rows if self.manifest["rows"][row["key"]]["status"] == "implemented"]
        if not survivors:
            self.manifest["status"] = "requeued"
            self.save()
            return self.manifest
        final = [self.command(command, "final-check-" + str(i)) for i, command in enumerate(self.final)]
        if not self.landing_evidence_module and shared[-1]["exit_code"]:
            final.append(self.command(self.build, "final-build"))
        self.manifest["checks"].extend(final)
        if any(check["exit_code"] for check in final):
            self.manifest["status"] = "final_check_failed"
            self.save()
            if any(check["exit_code"] == 75 for check in final):
                raise NotStarted("final check unavailable; commits retained")
            raise BatchFailed("final check failed; commits and evidence retained")
        if self._changed() or self.git("diff", "--cached", "--name-only").stdout:
            raise NotStarted("source changed during final verification; source preserved")
        message = "Complete " + self.app + " batch " + self.batch_id + "\n\n"
        for row in survivors:
            record = self.manifest["rows"][row["key"]]
            message += "Fixes-row: " + row["fixes_row"] + "\nRow-verdict: " + record["verdict"]
            message += "\nRow-receipt: " + record["receipt"] + "\n"
            record["status"] = "candidate"
        self.manifest["summary_intent"] = {"before_head": self.git("rev-parse", "HEAD").stdout.strip(), "message": message}
        self.save()
        self.git("commit", "-q", "--allow-empty", "-m", message)
        candidate = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("update-ref", self.pin, candidate)
        self.manifest.update({"candidate": candidate, "candidate_sha": candidate, "status": "verified",
                              "finished_at": time.time(), "pin": self.pin,
                              "source_verification": {"candidate": candidate, "base_sha": self.base,
                                                      "commands": final, "log_path": str(self.evidence / "batch.json")}})
        if self.landing_evidence_module:
            self._publish_source_evidence(candidate)
        self.save()
        return self._enqueue()

    def retry_validation(self, spec_path, expected_head, prerequisite_head=None, prerequisite_files=(), recover_lease=None):
        # The dispatcher takes the same lock before it reads any batch state.
        job = spec_path.resolve().parent
        marker = job / "VALIDATION-RETRY.json"
        with (job / ".validation-retry.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise NotStarted("batch reconciliation or validation is active")
            if (job / "SETTLED.json").exists():
                raise NotStarted("batch already settled")
            lease = json.loads((job / "SLOT.json").read_text())
            if (Path(lease["path"]).resolve() != self.repo or not lease.get("identity")
                    or process_identity(lease["pid"]) != lease["identity"]):
                raise NotStarted("batch slot lease is not live")
            self._load()
            if self.manifest.get("source_worktree") != str(self.repo) or (self.manifest.get("candidate") and not marker.exists()):
                raise NotStarted("batch source ownership changed or candidate already exists")
            if self.landing_evidence_module:
                raise NotStarted("retry does not support a source-plan replacement for original checks")
            if self._changed() or self.git("diff", "--cached", "--name-only").stdout:
                raise NotStarted("slot has uncommitted source")
            head = self.git("rev-parse", "HEAD").stdout.strip()
            if not marker.exists():
                raise NotStarted("validation retry has not been prepared; no source changed")
            state = json.loads(marker.read_text())
            if state["expected_head"] != expected_head or state["batch_id"] != self.batch_id:
                raise NotStarted("validation retry identity changed")
            if state.get("stage") not in ("snapshot", "restore", "activate", "validate"):
                raise NotStarted("validation retry setup is incomplete; fence retained")
            pending_rebind = None
            if recover_lease is not None:
                backup = Path(recover_lease).resolve()
                if (backup.parent != job or not backup.name.startswith("SLOT.json.prev-")
                        or state["stage"] != "validate" or self.manifest.get("candidate")
                        or self.manifest.get("summary_intent")):
                    raise NotStarted("invalid lease recovery boundary")
                previous = json.loads(backup.read_text())
                prior = state.get("lease_recoveries", [])
                repeated = bool(prior and prior[-1]["old_token"] == previous.get("token")
                                and prior[-1]["new_token"] == state.get("slot_token")
                                and state.get("slot_token") == lease.get("token"))
                if (type(previous.get("pid")) is not int or previous["pid"] <= 0
                        or type(state.get("pid")) is not int or state["pid"] <= 0
                        or not previous.get("identity") or process_identity(previous["pid"]) == previous["identity"]
                        or (not repeated and (not state.get("identity") or process_identity(state["pid"]) == state["identity"]))):
                    raise NotStarted("previous validation or slot owner is still live")
                if (not isinstance(previous.get("token"), str) or not previous["token"] or previous.get("active") is not True
                        or previous.get("token") != (prior[-1]["old_token"] if repeated else state.get("slot_token"))
                        or previous.get("slot") != state.get("slot") or previous.get("batch_id") != self.batch_id
                        or previous.get("app") != self.app or Path(previous["path"]).resolve() != self.repo
                        or lease.get("slot") != state.get("slot") or lease.get("batch_id") != self.batch_id
                        or lease.get("app") != self.app or not lease.get("recovered_dead_owner")
                        or previous.get("token") == lease.get("token")):
                    raise NotStarted("lease recovery does not match the original batch")
                manager = SlotManager(self.repo, self.repo.parent, state["slot_state"], ())
                with manager._guard():
                    current = manager._owned(lease)
                    for key in ("slot", "token", "pid", "identity", "path", "app", "batch_id"):
                        if current.get(key) != lease.get(key):
                            raise NotStarted("replacement slot lease differs from its owner record")
                if not repeated:
                    pending_rebind = {"old_token": previous["token"], "old_pid": previous["pid"],
                                      "old_identity": previous["identity"], "new_token": lease["token"],
                                      "new_pid": lease["pid"], "new_identity": lease["identity"],
                                      "old_validator_pid": state["pid"], "old_validator_identity": state["identity"],
                                      "backup": str(backup), "at": time.time()}
                    state["slot_token"] = lease["token"]
            self.retry_state = state
            self._retry_lease_check()
            def checkpoint():
                if pending_rebind is not None:
                    return
                state.update({"pid": os.getpid(), "identity": process_identity(os.getpid()), "heartbeat": time.time()})
                atomic_json(marker, state)
            if state["stage"] == "snapshot":
                snapshot = Path(state["snapshot"])
                if snapshot.exists():
                    raise NotStarted("uncertain evidence snapshot; inspect before retry")
                shutil.copytree(self.evidence, snapshot)
                state["stage"] = "restore"
                checkpoint()
            if state["stage"] == "restore":
                for index, row in enumerate(self.rows):
                    record = self.manifest["rows"][row["key"]]
                    if index < len(state["restored"]):
                        continue
                    before = state.get("before_head")
                    head = self.git("rev-parse", "HEAD").stdout.strip()
                    if before is None:
                        expected = state["restored"][-1] if state["restored"] else expected_head
                        if head != expected:
                            raise NotStarted("source changed during restoration")
                        before = head
                        state["before_head"] = before
                        checkpoint()
                    message = ("Restore " + row["fixes_row"] + " after validation failure\n\n"
                               + "Reverts-revert: " + record["revert_commit"] + "\n"
                               + "Fixes-row: " + row["fixes_row"] + "\n"
                               + "Row-verdict: " + record["verdict"] + "\n"
                               + "Row-receipt: " + record["receipt"])
                    if head == before:
                        self._retry_lease_check()
                        self.git("revert", "--no-commit", record["revert_commit"])
                        self.git("commit", "-q", "-m", message)
                        head = self.git("rev-parse", "HEAD").stdout.strip()
                    parent = self.git("rev-parse", head + "^").stdout.strip()
                    tree = self.git("rev-parse", head + "^{tree}").stdout.strip()
                    expected_tree = self.git("rev-parse", record["commit"] + "^{tree}").stdout.strip()
                    actual_message = self.git("show", "-s", "--format=%B", head).stdout
                    if parent != before or tree != expected_tree or actual_message.strip() != message.strip():
                        raise NotStarted("uncertain restoration commit; source preserved")
                    self.git("update-ref", self.pin, head)
                    state["restored"].append(head)
                    state.pop("before_head")
                    checkpoint()
                state["stage"] = "activate"
                checkpoint()
            if state["stage"] == "activate":
                if self.git("rev-parse", "HEAD").stdout.strip() != state["restored"][-1]:
                    raise NotStarted("source changed before validation")
                original = json.loads((Path(state["snapshot"]) / "batch.json").read_text())
                self.manifest = original
                for row, commit in zip(self.rows, state["restored"]):
                    record = self.manifest["rows"][row["key"]]
                    for key in ("revert_intent", "revert_commit", "reason", "failing_checks", "failure_kind", "attempt_charge", "requeue_outcome"):
                        record.pop(key, None)
                    record.update({"status": "implemented", "commit": commit})
                for key in ("pending_reverts", "direct_revert_failures"):
                    self.manifest.pop(key, None)
                self.manifest["status"] = "implementing"
                self.save()
                state["stage"] = "validate"
                checkpoint()
            registered = state.get("prerequisites", [])
            registered_head = state.get("validation_head", registered[-1]["commit"] if registered else state["restored"][-1])
            if not self.manifest.get("candidate") and not self.manifest.get("summary_intent"):
                head = self.git("rev-parse", "HEAD").stdout.strip()
                following = self.git("rev-list", "--reverse", registered_head + ".." + head).stdout.splitlines()
                for commit in following:
                    matches = [record for record in self.manifest["rows"].values()
                               if record.get("status") == "requeued" and record.get("failure_kind") == "check_failed"
                               and record.get("attempt_charge") is True and record.get("revert_commit") == commit]
                    if not matches:
                        break
                    if len(matches) != 1:
                        raise NotStarted("ambiguous finalizer revert; recovery fence retained")
                    record = matches[0]
                    original = record.get("commit")
                    parents = self.git("rev-list", "--parents", "-n", "1", commit).stdout.split()
                    intent = record.get("revert_intent", {})
                    if (original not in state["restored"] or parents != [commit, registered_head]
                            or intent.get("before_head") != registered_head
                            or not any(check.get("exit_code") not in (0, 75) for check in record.get("checks", []))):
                        raise NotStarted("finalizer revert identity changed; recovery fence retained")
                    subject = self.git("show", "-s", "--format=%s", original).stdout.strip()
                    message = self.git("show", "-s", "--format=%B", commit).stdout.strip()
                    expected_message = 'Revert "' + subject + '"\n\nThis reverts commit ' + original + '.'
                    files = set(filter(None, self.git("diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", commit).stdout.split("\x00")))
                    patch = self.git("diff", "--binary", "--full-index", original + "^", original).stdout
                    reversed_patch = self.git("diff", "--binary", "--full-index", commit, registered_head).stdout
                    if message != expected_message or not files or not files <= set(record["files"]) or not patch or patch != reversed_patch:
                        raise NotStarted("finalizer revert does not match the failed row; recovery fence retained")
                    state.setdefault("validation_reverts", []).append({"row": record["key"], "commit": commit, "reverted": original})
                    registered_head = commit
                    state["validation_head"] = commit
                    checkpoint()
            last_registration = state.get("last_prerequisite_registration")
            if (prerequisite_head and last_registration
                    and prerequisite_head == last_registration["head"]
                    and sorted(prerequisite_files) == last_registration["files"]):
                prerequisite_head, prerequisite_files = None, ()
            if prerequisite_head is not None or prerequisite_files:
                if (state["stage"] != "validate" or self.manifest.get("candidate") or self.manifest.get("summary_intent")
                        or not prerequisite_head or not re.fullmatch(r"[0-9a-f]{40}", prerequisite_head)
                        or not prerequisite_files or len(set(prerequisite_files)) != len(prerequisite_files)):
                    raise NotStarted("invalid validation prerequisite registration")
                allowed = set(prerequisite_files)
                for filename in allowed:
                    path = Path(filename)
                    parts = [part.lower() for part in path.parts]
                    if (path.is_absolute() or not parts or path.as_posix() != filename
                            or any(part in (".", "..", ".git", "secrets", "credentials", "id_rsa", "id_ed25519")
                                   or part.startswith(".env") for part in parts)
                            or re.search(r"(?:^|[._-])(secret|credential|token)(?:[._-]|$)", path.name.lower())
                            or path.suffix.lower() in (".pem", ".key", ".p12", ".pfx")
                            or self.repo not in (self.repo / path).resolve().parents):
                        raise NotStarted("unsafe validation prerequisite path")
                if self.git("rev-parse", "HEAD").stdout.strip() != prerequisite_head:
                    raise NotStarted("prerequisite head does not match source")
                commits = self.git("rev-list", "--reverse", registered_head + ".." + prerequisite_head).stdout.splitlines()
                if not commits:
                    raise NotStarted("no new prerequisite commits")
                additions, paths, parent = [], set(), registered_head
                for commit in commits:
                    parents = self.git("rev-list", "--parents", "-n", "1", commit).stdout.split()
                    if len(parents) != 2 or parents[1] != parent:
                        raise NotStarted("prerequisite commits must form a linear chain")
                    changed = set(filter(None, self.git("diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", commit).stdout.split("\x00")))
                    message = self.git("show", "-s", "--format=%B", commit).stdout
                    reasons = re.findall(r"^Batch-prerequisite: ([^\r\n]+)$", message, re.MULTILINE)
                    if not changed or not changed <= allowed or len(reasons) != 1 or not reasons[0].strip():
                        raise NotStarted("prerequisite paths or truthful trailer do not match")
                    additions.append({"commit": commit, "files": sorted(changed), "reason": reasons[0].strip()})
                    paths.update(changed)
                    parent = commit
                if parent != prerequisite_head or paths != allowed:
                    raise NotStarted("prerequisite paths do not exactly match registration")
                state["prerequisites"] = registered + additions
                state["validation_head"] = prerequisite_head
                state["last_prerequisite_registration"] = {"head": prerequisite_head, "files": sorted(allowed)}
                checkpoint()
                registered = state["prerequisites"]
                registered_head = prerequisite_head
                if pending_rebind is None:
                    self.git("update-ref", self.pin, prerequisite_head)
            if registered:
                if self.manifest.get("candidate") or self.manifest.get("summary_intent"):
                    if self.manifest.get("prerequisites") != registered:
                        raise NotStarted("candidate prerequisite evidence changed")
                else:
                    if pending_rebind is None:
                        self.git("update-ref", self.pin, registered_head)
                        if self.manifest.get("prerequisites") != registered:
                            self.manifest["prerequisites"] = registered
                            self.save()
            if not self.manifest.get("candidate") and not self.manifest.get("summary_intent"):
                if self.git("rev-parse", "HEAD").stdout.strip() != registered_head:
                    raise NotStarted("source changed during validation; recovery fence retained")
            if pending_rebind is not None:
                state.setdefault("lease_recoveries", []).append(pending_rebind)
                pending_rebind = None
                checkpoint()
                self._retry_lease_check()
                if registered:
                    self.git("update-ref", self.pin, registered_head)
                    if self.manifest.get("prerequisites") != registered:
                        self.manifest["prerequisites"] = registered
                        self.save()
            self.log_evidence = self.evidence / ("validation-retry-" + uuid.uuid4().hex)
            self.log_evidence.mkdir()
            heartbeat = job / "VALIDATION-RETRY-HEARTBEAT.json"
            stop = threading.Event()
            def beat():
                while not stop.wait(10):
                    atomic_json(heartbeat, {"pid": os.getpid(), "identity": process_identity(os.getpid()), "at": time.time()})
            atomic_json(heartbeat, {"pid": os.getpid(), "identity": process_identity(os.getpid()), "at": time.time()})
            thread = threading.Thread(target=beat, daemon=True)
            thread.start()
            try:
                result = self.finalize(load=False)
            finally:
                stop.set()
                thread.join()
            if result.get("status") != "queued":
                raise NotStarted("retry did not publish a candidate; recovery fence retained")
            marker.unlink()
            heartbeat.unlink(missing_ok=True)
            return result

    def _recover_summary(self):
        intent = self.manifest.get("summary_intent")
        if not intent or self.manifest.get("candidate"):
            return
        if self._changed() or self.git("diff", "--cached", "--name-only").stdout:
            raise NotStarted("source changed during candidate checkpoint; source preserved")
        head = self.git("rev-parse", "HEAD").stdout.strip()
        if head == intent["before_head"]:
            self.git("commit", "-q", "--allow-empty", "-m", intent["message"])
            head = self.git("rev-parse", "HEAD").stdout.strip()
        else:
            parent = self.git("rev-parse", "HEAD^").stdout.strip()
            message = self.git("show", "-s", "--format=%B", "HEAD").stdout
            if parent != intent["before_head"] or message.strip() != intent["message"].strip():
                raise NotStarted("uncertain candidate checkpoint needs recovery; source preserved")
        self.git("update-ref", self.pin, head)
        self.manifest.update({"candidate": head, "candidate_sha": head, "pin": self.pin,
                              "status": "verified", "finished_at": time.time()})
        self.save()

    def _recover_reverts(self):
        for row in reversed(self.rows):
            record = self.manifest["rows"].get(row["key"], {})
            if record.get("status") != "reverting":
                continue
            intent = record["revert_intent"]
            head = self.git("rev-parse", "HEAD").stdout.strip()
            if head == intent["before_head"]:
                self.git("revert", "--no-edit", record["commit"])
                head = self.git("rev-parse", "HEAD").stdout.strip()
            else:
                parent = self.git("rev-parse", "HEAD^").stdout.strip()
                message = self.git("show", "-s", "--format=%B", "HEAD").stdout
                if parent != intent["before_head"] or "This reverts commit " + record["commit"] + "." not in message:
                    raise NotStarted("uncertain row revert requires recovery; source preserved")
            record["revert_commit"] = head
            self.git("update-ref", self.pin, head)
            self._requeue(row, intent["reason"], intent["checks"], intent["failure_kind"], intent["attempt_charge"])
            self.save()

    def _source_module(self):
        spec = importlib.util.spec_from_file_location("batch_landing_evidence", self.landing_evidence_module)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _publish_source_evidence(self, candidate):
        module = self._source_module()
        expected = module.plan(self.repo, self.base, candidate)
        tree = self.git("rev-parse", candidate + "^{tree}").stdout.strip()
        available = [entry for entry in self.manifest["checks"]
                     if entry["exit_code"] == 0 and entry.get("source_tree") == tree
                     and Path(entry["log_path"]).is_file()]
        results = []
        for index, command in enumerate(expected):
            entry = next((entry for entry in reversed(available) if entry["command"] == command), None)
            if entry is None:
                entry = self.command(command, "source-plan-" + str(index))
                self.manifest["checks"].append(entry)
            if entry["exit_code"]:
                self.manifest["status"] = "source_verification_unavailable" if entry["exit_code"] == 75 else "source_verification_failed"
                self.save()
                if entry["exit_code"] == 75:
                    error = self._unavailable(entry, "source plan unavailable")
                    self.save()
                    raise error
                raise BatchFailed("source plan failed; candidate retained; log " + entry["log_path"])
            results.append({"argv": command, "exit_code": 0, "log_path": entry["log_path"]})
        if self.git("rev-parse", "HEAD").stdout.strip() != candidate or self._changed() or self.git("diff", "--cached", "--name-only").stdout:
            raise NotStarted("source changed during canonical verification; evidence not published")
        record = {"version": 1, "candidate": candidate, "base": self.base,
                  "patch_id": module.patch_id(self.repo, self.base, candidate),
                  "paths": module.paths(self.repo, self.base, candidate), "commands": results,
                  "fixes_rows": [row["fixes_row"] for row in self.manifest["rows"].values() if row["status"] == "candidate"],
                  "source": str(self.repo), "created_at": time.time()}
        path = self.evidence / "source-verification.json"
        atomic_json(path, record)
        self.manifest.update({"source_verification": record, "source_verification_path": str(path)})

    def _enqueue(self):
        self._retry_lease_check()
        if self.manifest.get("status") == "queued" or not self.enqueue_command:
            return self.manifest
        candidate = self.manifest["candidate"]
        if self.enqueue_command:
            queue_dir = os.environ.get("LABS_MERGE_RETRY_DIR")
            if queue_dir:
                for path in Path(queue_dir).glob("*.json"):
                    queued = json.loads(path.read_text())
                    if queued.get("candidate") == candidate:
                        self.manifest.update({"status": "queued", "queue_record": str(path)})
                        self.save()
                        return self.manifest
            env = dict(os.environ, BATCH_CANDIDATE=candidate, BATCH_BRANCH=self.branch,
                       BATCH_MANIFEST=str(self.evidence / "batch.json"))
            if self.manifest.get("source_verification_path"):
                env["LABS_MERGE_EVIDENCE"] = self.manifest["source_verification_path"]
            execution = self.command(self.enqueue_command + ["record", "--branch", self.branch,
                                     "--candidate", candidate, "--lane", "batch-" + self.app], "enqueue", env)
            self.manifest["enqueue"] = execution
            if execution["exit_code"]:
                self.manifest["status"] = "enqueue_failed"
                self.save()
                raise NotStarted("candidate enqueue failed; pin retained; log " + execution["log_path"])
            self.manifest["status"] = "queued"
            self.save()
        return self.manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--phase", choices=("run", "start", "collect", "finalize", "retry-validation"), default="run")
    parser.add_argument("--expected-head")
    parser.add_argument("--recover-lease", type=Path)
    parser.add_argument("--prerequisite-head")
    parser.add_argument("--prerequisite-file", action="append", default=[])
    parser.add_argument("--row")
    parser.add_argument("--result", type=Path)
    args = parser.parse_args()
    try:
        spec = json.loads(args.spec.read_text())
        if args.phase != "retry-validation" and (args.prerequisite_head or args.prerequisite_file or args.recover_lease):
            raise ValueError("prerequisite arguments require retry-validation")
        if args.phase != "run":
            spec["collect_mode"] = True
        runner = BatchRunner(**spec)
        if args.phase == "retry-validation":
            if not args.expected_head:
                raise ValueError("retry-validation requires --expected-head")
            result = runner.retry_validation(args.spec, args.expected_head, args.prerequisite_head, args.prerequisite_file, args.recover_lease)
        elif args.phase == "collect":
            if not args.row or args.result is None:
                raise ValueError("collect requires --row and --result")
            runner.collect(args.row, json.loads(args.result.read_text()))
            result = runner.manifest
        else:
            result = getattr(runner, args.phase)()
        print(json.dumps({key: result.get(key) for key in ("batch_id", "status", "candidate", "branch")}))
        if args.phase in ("run", "finalize") and result.get("status") == "requeued":
            charged = any(row.get("attempt_charge") for row in result["rows"].values())
            print(("failed: " if charged else "not started: ") + "all rows requeued; evidence " + str(runner.evidence), file=sys.stderr)
            return 1 if charged else 75
        return 0
    except (NotStarted, BatchFailed) as error:
        print(str(error), file=sys.stderr)
        return error.exit_code
    except (OSError, ValueError, KeyError) as error:
        print("not started: invalid batch specification: " + str(error), file=sys.stderr)
        return 75


if __name__ == "__main__":
    raise SystemExit(main())
