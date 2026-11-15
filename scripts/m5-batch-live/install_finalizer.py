#!/usr/bin/env python3
"""Install the finalizer fix into the M5 batch runtime (run on the M5, from this directory).

Backs up each replaced file, refuses a batch_runner.py that is not the one the fix was cut from,
edits batch_dispatch.py at three anchors (the rest of the live file, including launch() and resume(),
is left as it is) and byte-compiles every result before the swap.
"""
import hashlib
import os
import py_compile
import shutil
import sys
import tempfile
from pathlib import Path

RUNTIME = Path(os.environ.get("BATCH_RUNTIME_DIR") or Path.home() / ".local/share/replica-batchslots/1115-runtime-v1")
RUNNER_BEFORE_SHA = "532cbe6b8f7df76f4337cbb5c50b82855c6ca197e010c3ba7b41306291e46f3a"
SUFFIX = ".prev-finalizer-1115"
HERE = Path(__file__).resolve().parent


def swap(name, produced):
    py_compile.compile(str(produced), doraise=True)
    live = RUNTIME / name
    if live.exists():
        shutil.copy2(live, str(live) + SUFFIX)
    produced.replace(live)


def edit_dispatch(text):
    def once(source, old, new):
        if source.count(old) != 1:
            sys.exit("batch_dispatch.py anchor not found exactly once: " + old[:60])
        return source.replace(old, new)

    text = once(text, "import batch_provider_routing\n", "import batch_provider_routing\nimport batch_host_finalize\n")
    text = once(text, "5. Run --phase finalize --spec {spec}. It owns checks, build, failed-row revert and candidate enqueue.\n",
                "5. Stop after every row is collected. Do not run --phase finalize: this sandbox has no network, no writable pnpm store and\n"
                "   cannot bind a socket (tsx), so the host runs it after you end and owns checks, build, failed-row revert and candidate enqueue.\n")
    return once(text, "            candidate = manifest.get('candidate') if manifest else None\n",
                "            candidate = manifest.get('candidate') if manifest else None\n"
                "            if not candidate:\n"
                "                action, detail = batch_host_finalize.step(directory, spec, manifest)\n"
                "                if action == 'started':\n"
                "                    event(pool.POOL, 'finalizer_host_started', batch=directory.name, attempt=detail)\n"
                "                if action in ('started', 'running'):\n"
                "                    manager.heartbeat(lease)\n"
                "                    continue\n"
                "                if action in ('blocked', 'blocked-reported'):\n"
                "                    if action == 'blocked':\n"
                "                        event(pool.POOL, 'finalizer_blocked', batch=directory.name, reason=detail, reason_kind=detail.get('kind'))\n"
                "                    manager.heartbeat(lease)\n"
                "                    continue\n")


def main():
    work = Path(tempfile.mkdtemp(dir=RUNTIME))
    runner = RUNTIME / "batch_runner.py"
    digest = hashlib.sha256(runner.read_bytes()).hexdigest()
    patched = hashlib.sha256((HERE / "runtime/batch_runner.py").read_bytes()).hexdigest()
    if digest not in (RUNNER_BEFORE_SHA, patched):
        sys.exit("batch_runner.py changed since the fix was cut; rebase runtime/batch_runner.py first")
    dispatch = work / "batch_dispatch.py"
    shutil.copy2(RUNTIME / "batch_dispatch.py", dispatch)
    if "batch_host_finalize" not in dispatch.read_text():
        dispatch.write_text(edit_dispatch(dispatch.read_text()))
    for name in ("batch_finalizer_env.py", "batch_host_finalize.py"):
        shutil.copy2(HERE / name, work / name)
        swap(name, work / name)
    shutil.copy2(HERE / "runtime/batch_runner.py", work / "batch_runner.py")
    swap("batch_runner.py", work / "batch_runner.py")
    swap("batch_dispatch.py", dispatch)
    shutil.rmtree(work)
    print("installed; backups end with " + SUFFIX)


if __name__ == "__main__":
    main()
