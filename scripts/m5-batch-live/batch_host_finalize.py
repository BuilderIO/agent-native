#!/usr/bin/env python3
"""Run a batch's finalizer on the host, where pnpm, its store and tsx work.

The dispatcher calls step() once per pass; step() starts this file detached
and reports a named reason when the finalizer cannot run.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import batch_finalizer_env as env_lib

TERMINAL = frozenset(("requeued", "verified", "queued", "final_check_failed", "failed_unisolated",
                      "source_verification_failed", "enqueue_failed", "reverting"))
MAX_ATTEMPTS = 3
CHECK_TIMEOUT_S = 5400  # test:fast alone exceeded the runner default of 1800s with the M5 at load 76
RETRY_DELAY_S = 600
DEFAULT_PATH = [str(Path.home() / ".nvm/versions/node/v24.14.0/bin")]


def applicable(spec, manifest):
    rows = (manifest or {}).get("rows", {})
    return bool(manifest and not manifest.get("candidate") and manifest.get("status") not in TERMINAL
                and all(row["key"] in rows and rows[row["key"]].get("status") != "collecting" for row in spec["rows"]))


def reason_of(manifest, log):
    reason = manifest.get("not_started_reason")
    if reason:
        return reason
    tail = Path(log).read_text().strip().splitlines()[-1:] if Path(log).is_file() else []
    return {"kind": "finalizer-unavailable", "detail": tail[0] if tail else "finalizer exited without a result", "log": str(log)}


def step(directory, spec, manifest, now=None, launch=None, alive=None):
    """One dispatcher pass: ('skip'|'running'|'started'|'blocked'|'blocked-reported', detail)."""
    directory, now = Path(directory), time.time() if now is None else now
    marker = directory / "FINALIZE-HOST.json"
    state = json.loads(marker.read_text()) if marker.exists() else {"attempts": 0}
    if state.get("pid") and not state.get("exited_at"):
        if (alive or _alive)(state):
            return "running", state["attempts"]
        state["exited_at"] = now
        _save(marker, state)
    if not applicable(spec, manifest):
        return "skip", None
    if state["attempts"] >= MAX_ATTEMPTS:
        return _blocked(marker, state, manifest, directory)
    if state.get("exited_at") and now - state["exited_at"] < RETRY_DELAY_S:
        return "running", state["attempts"]
    log = directory / ("finalize-host-" + str(state["attempts"] + 1) + ".log")
    pid, identity = (launch or _launch)(directory, log)
    state.update({"attempts": state["attempts"] + 1, "pid": pid, "identity": identity, "log": str(log), "started_at": now})
    state.pop("exited_at", None)
    _save(marker, state)
    return "started", state["attempts"]


def _blocked(marker, state, manifest, directory):
    reason = reason_of(manifest, state.get("log", ""))
    reported = state.get("blocked_reported")
    state["blocked_reported"] = True
    _save(marker, state)
    return ("blocked-reported" if reported else "blocked"), reason


def _save(marker, state):
    temporary = marker.with_name(marker.name + ".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True))
    os.replace(temporary, marker)


def _alive(state):
    from batch_slots import process_identity
    return process_identity(state["pid"]) == state.get("identity")


def _launch(directory, log):
    from batch_slots import process_identity
    with open(log, "w") as out:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--job", str(directory)],
                                 stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
    return child.pid, process_identity(child.pid)


def host_environment(slot, run_id, base=None):
    base = dict(os.environ if base is None else base)
    for key in ("CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED"):
        base.pop(key, None)
    base["PATH"] = os.pathsep.join(DEFAULT_PATH + [base.get("PATH", "/usr/bin:/bin")])
    return env_lib.finalizer_env(base, slot, run_id)


def warm_store(repo, env, log, runner=subprocess.run):
    """Networked step before the finalizer: fetch what the lockfile needs and the store lacks."""
    store = env_lib.host_store(runner, repo, env)
    missing = env_lib.missing_from_store(Path(repo) / "pnpm-lock.yaml", store)
    if not missing:
        return None
    with open(log, "a") as out:
        out.write("store-warm: " + str(len(missing)) + " package(s) missing, first " + missing[0]["package"] + "; running pnpm fetch\n")
    env_lib.run_logged(runner, ["pnpm", "fetch"], repo, env, log, 1800)
    missing = env_lib.missing_from_store(Path(repo) / "pnpm-lock.yaml", store)
    return env_lib.store_miss(missing, store) if missing else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, required=True)
    args = parser.parse_args()
    spec = json.loads((args.job / "BATCH.json").read_text())
    env = host_environment(spec["repo"], uuid.uuid4().hex[:6])
    log = args.job / "finalize-host-warm.log"
    runner = str(Path(__file__).with_name("batch_runner.py"))
    failure = None
    try:
        failure = warm_store(spec["repo"], env, log)
    except env_lib.FinalizerFailure as error:
        failure = error
    if failure:
        manifest_path = Path(spec["evidence_dir"]) / "batch.json"
        manifest = json.loads(manifest_path.read_text())
        manifest.update({"status": "not_started", "not_started_reason": failure.reason})
        manifest_path.write_text(json.dumps(manifest))
        print("not started: " + str(failure), file=sys.stderr)
        return env_lib.NOT_STARTED
    host_spec = args.job / "BATCH-FINALIZE-HOST.json"
    host_spec.write_text(json.dumps({**spec, "timeout": max(spec.get("timeout", 0), CHECK_TIMEOUT_S)}))
    return subprocess.run([sys.executable, runner, "--phase", "finalize", "--spec", str(host_spec)], env=env).returncode


if __name__ == "__main__":
    raise SystemExit(main())
