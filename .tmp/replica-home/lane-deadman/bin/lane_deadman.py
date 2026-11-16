#!/usr/bin/env python3
"""Dead-man for lane turns, one per Mac, every 5 minutes.

An idle Mac was only ever found by a session that happened to check. This watches the number instead: a Mac with 0 lane turns for 10 minutes while startable
work exists and free RAM is above the floor is healed first (kickstart the pool, the only M5 dispatcher; clear a STOP older than the queue by renaming it),
and if it is still at 0 five minutes after the heal, ONE alert goes out through prs/notify.py (the gate: ledger + orchestrator alert file, never Steve's Telegram). Turns coming back
re-arm it. An empty queue, or RAM under the floor, is not an alert.

  --mode m5     on the M5: its own turns (live lane-* units), the pool's lane queue, its free RAM; heals by kickstarting local.replica.m5-pool
  --mode mac2   on the M4: its own agent-turn.sh count against queue.txt (heals by kickstarting the fleet loop) AND the M5 over ssh (heals it over ssh);
                the M5 cannot reach the M4, so only the M4 can watch the peer
  probe         print this Mac's reading as JSON (what --mode mac2 runs on the M5 over ssh)

Every pass on both Macs also runs asks.py check on this Mac's ledger: ask rows queued over 2 h with no start, or past due with no receipt on disk.
"""
from __future__ import annotations

import argparse, json, os, re, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lane_heal
GRACE_S = 600       # 0 turns with work for this long starts the heal
HEAL_WAIT_S = 300   # still 0 this long after the heal: alert
FLOOR_FREE_GB = 15.0
FILL_WINDOW_S = 300  # under half the worker target this long, with startable rows, is an under-filled Mac
FILL_FRACTION = 0.5
M5_HOST = "Steves-MacBook-Pro.local"
POOL_LABEL = "local.replica.m5-pool"
LOOP_LABEL = "com.steve.re.fleet-loop"


def step(st, probe, now, heal, alert, grace=GRACE_S, heal_wait=HEAL_WAIT_S, floor=FLOOR_FREE_GB):
    """One look at one Mac. `st` is that Mac's persisted episode state (mutated); `probe` {turns, startable, free_gb} or None when unreadable.
    Returns the status word. heal() and alert(text) are injected so a fake clock and a fake queue drive every branch in a unit test."""
    if probe is None:
        st["misses"] = st.get("misses", 0) + 1
        if st["misses"] < 2:
            return "unreadable-once"
        probe = {"turns": 0, "startable": 1, "free_gb": floor, "unreadable": True}  # two blind looks in a row count as idle with work: loud, not clean
    else:
        st["misses"] = 0
    work = probe["startable"] > 0 and probe["free_gb"] >= floor
    if probe["turns"] > 0:
        rearmed = st.pop("alerted", None) is not None
        st.pop("zero_since", None), st.pop("healed_at", None)
        return "rearmed" if rearmed else "running"
    if not work:
        st.pop("zero_since", None), st.pop("healed_at", None)  # nothing startable, or no RAM to start it: not this watcher's alarm
        return "idle-no-work" if probe["startable"] <= 0 else "held-by-ram"
    st.setdefault("zero_since", now)
    if now - st["zero_since"] < grace:
        return "watching"
    if "healed_at" not in st:
        heal()
        st["healed_at"] = now
        return "healed"
    if now - st["healed_at"] < heal_wait:
        return "healing"
    if st.get("alerted") is not None:
        return "alerted-already"
    reason = "its reading was unreadable twice" if probe.get("unreadable") else f"{probe['startable']} startable unit(s), {probe['free_gb']:.0f} GiB free"
    if alert(f"0 lane turns for {int((now - st['zero_since']) // 60)} min with work waiting ({reason}); the heal at {time.strftime('%H:%M', time.localtime(st['healed_at']))} did not bring one back."):
        st["alerted"] = now
        return "alerted"
    return "alert-failed"  # not marked: the next pass retries


def worker_target(snap, startable):
    """Workers this Mac should be running: what its RAM allows in total (running + new that fit, from clone/ram_ceiling.py: free RAM above the 8 GB margin
    over the footprint measured from live RSS, disk and swap holds included), never more than running + startable rows. Returns (running, target)."""
    import ram_ceiling
    c = ram_ceiling.ceiling(snap)
    return c["running"], min(c["ceiling"], c["running"] + startable)


def top_refusal(pool_dir):
    """The most common typed reason in pool/refusals.tsv, or a word for why there is none to read."""
    try:
        reasons = [l.split("\t")[2] for l in Path(pool_dir, "refusals.tsv").read_text().splitlines() if l.strip() and not l.startswith("#") and l.count("\t") >= 2]
    except OSError:
        return "no-refusal-log"
    if not reasons:
        return "none-refused"
    top = max(set(reasons), key=lambda r: (reasons.count(r), r))
    return f"{top} x{reasons.count(top)}"


def fill_step(st, probe, now, heal, alert, window=FILL_WINDOW_S, heal_wait=HEAL_WAIT_S):
    """Is this Mac under-filled? `probe` {workers, target, startable, top_refusal, mac} or None when unreadable (no change: a blind look is not a verdict).
    Under half the target for `window` seconds while startable rows exist: a ledger ALERT line, one heal, and (the lane-turns rule) ONE fleet alert only
    if the Mac is still under a heal window later. An empty queue is never an alarm. Returns (status word, ledger line or None)."""
    if probe is None or probe.get("target") is None:
        return "fill-unreadable", None
    running, target, startable = probe["workers"], probe["target"], probe["startable"]
    if startable <= 0:
        st.pop("under_since", None), st.pop("healed_at", None)
        return "empty-queue", None
    if target <= 0 or running >= target * FILL_FRACTION:
        rearmed = st.pop("alerted", None) is not None
        st.pop("under_since", None), st.pop("healed_at", None)
        return ("fill-rearmed" if rearmed else "fill-ok"), None
    st.setdefault("under_since", now)
    if now - st["under_since"] < window:
        return "fill-watching", None
    line = f"ALERT {probe.get('mac', '?')} under {int(FILL_FRACTION * 100)}% of worker target for {window // 60 if window >= 60 else '<1'}m: running={running} target={target} startable={startable} top_refusal={probe.get('top_refusal', '?')}"
    if "healed_at" not in st:
        heal()
        st["healed_at"] = now
        return "fill-healed", line
    if st.get("alerted") is not None:
        return "fill-alerted-already", None
    if now - st["healed_at"] < heal_wait:
        return "fill-healing", None
    if alert(f"{line}. The heal at {time.strftime('%H:%M', time.localtime(st['healed_at']))} (stale claims released, pool kicked) did not fill it."):
        st["alerted"] = now
        return "fill-alerted", line
    return "fill-alert-failed", line


EXIT_ALERT_FRESH_S = 3600  # an EXIT-ALERT.json older than this is history
EXIT_ALERT_REPEAT_S = 6 * 3600  # a STOP file restarts the pool every minute and rewrites the marker: one alert per reason per this long


def pool_exit_step(st, info, now, alert):
    """The pool exits only for a STOP file or MAX_FAILS launch failures and leaves EXIT-ALERT.json {reason, at}; this sends it, once per reason. `info` None = no file."""
    if not info or now - int(info.get("at", 0)) > EXIT_ALERT_FRESH_S:
        return "pool-exit-none"
    if st.get("reason") == info.get("reason") and now - st.get("alerted", 0) < EXIT_ALERT_REPEAT_S:
        return "pool-exit-already"
    if alert(f"the pool exited ({info.get('reason', 'no reason recorded')}) and was not started as a pool that polls: STOP files and launch failures stop it on purpose, so this needs a person."):
        st["reason"], st["alerted"] = info.get("reason"), now
        return "pool-exit-alerted"
    return "pool-exit-alert-failed"


PEER_STALE_S = 600  # the publisher stamps every 2 minutes; ten minutes of silence is the M4 (or its publisher) gone, whatever the queue file says


def peer_step(st, age, problem, now, alert, limit=PEER_STALE_S, gate=None):
    """The M5's look at the M4: `age` is seconds since the M4's last heartbeat, None with `problem` ('missing' or 'unreadable') when it cannot be read.
    One alert per episode; a fresh heartbeat re-arms. An unreadable heartbeat is stale, never fine."""
    if age is not None and age <= limit:
        return "peer-rearmed" if st.pop("alerted", None) is not None else "peer-ok"
    if st.get("alerted") is not None:
        return "peer-stale-already"
    waiting = gate() if gate else None  # lane_heal.peer_gate: install grace, the M4's heal window, never-seen; waits and reports, never touches a unit
    if waiting:
        return waiting
    why = problem or f"last heartbeat {int(age // 60)} min ago"
    if alert(f"the M4 has not published for over {limit // 60} min ({why}); the M5 queue is not being fed and M4 lane turns are unwatched from here." + (f" After the M4's heal window: {st['note']}." if st.get("note") else "")):
        st["alerted"] = now
        return "peer-stale-alerted"
    return "peer-alert-failed"


def read_heartbeat(path, now):
    """(age_s, info, problem). Missing and unreadable are different problems, and neither reads as a young heartbeat."""
    try:
        info = json.loads(Path(path).read_text())
        return max(0, int(now - int(info["ts"]))), info, None
    except FileNotFoundError:
        return None, {}, "no heartbeat file"
    except (ValueError, KeyError, TypeError, OSError):
        return None, {}, "heartbeat file unreadable"


def local_turns(mode):
    out = subprocess.run(["ps", "-axo", "command"], capture_output=True, text=True).stdout
    if mode == "m5":
        pool = Path.home() / "m5-jobs"
        return sum(1 for d in pool.glob("lane-*") if (d / "STARTED").exists() and not any(l.startswith("END") for l in (d / "STARTED").read_text().splitlines()))
    return sum(1 for l in out.splitlines() if re.search(r"agent-turn\.sh ", l) and "grep" not in l)


def local_probe(mode):
    import ram_ceiling
    free = ram_ceiling.snapshot(str(Path.home() / "m5-jobs/pool" if mode == "m5" else Path.home() / "Projects/re/kit-local"))["free_mem_gb"]
    if mode == "m5":
        import lane_rows
        q, claims, holds = lane_rows.paths(Path.home() / "m5-jobs/pool")
        startable = len(lane_rows.startable(lane_rows.read_queue(q), lane_rows.claimed_keys(claims), lane_rows.held_apps(holds), {p.name for p in (Path.home() / "m5-jobs").glob("lane-*")}))
    else:
        q = Path.home() / "Projects/re/kit-local/clone/queue.txt"
        startable = len([l for l in q.read_text().splitlines() if l.strip()]) if q.exists() else 0
    pool_dir = Path.home() / "m5-jobs/pool"
    snap = ram_ceiling.snapshot(str(pool_dir if mode == "m5" else Path.home() / "Projects/re/kit-local"))
    turns = local_turns(mode)
    running, target = worker_target(snap, startable)
    return {"turns": turns, "startable": startable, "free_gb": round(free, 1), "workers": max(running, turns), "target": target,
            "top_refusal": top_refusal(pool_dir) if mode == "m5" else "n/a", "mac": "m5" if mode == "m5" else "m4"}


def remote_probe(host=M5_HOST):
    try:
        done = subprocess.run(["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "/usr/bin/python3 m5-jobs/pool/lane_deadman.py probe"], capture_output=True, text=True, timeout=60)
        return json.loads(done.stdout) if done.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def kickstart(label, host=None):
    cmd = ["/bin/launchctl", "kickstart", "-k", f"gui/{os.getuid() if host is None else 501}/{label}"]
    if host:
        cmd = ["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, " ".join(cmd)]
    subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=60)


def clear_stale_stop(pool_dir, queue):
    """A pool STOP older than the queue file stopped a queue that no longer exists. Renamed, never deleted; the swarm daemon's STOP is a different file."""
    stop, q = Path(pool_dir) / "STOP", Path(queue)
    if stop.exists() and q.exists() and stop.stat().st_mtime < q.stat().st_mtime:
        stop.rename(stop.with_name(f"STOP.cleared-{time.strftime('%m%d-%H%M')}-lane-deadman"))
        return True
    return False


def load(path):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return {}


def save(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(path) + f".tmp{os.getpid()}")
    tmp.write_text(json.dumps(data, indent=1, sort_keys=True))
    os.replace(tmp, path)


def receipt(home, target, status, probe, extra=""):
    day = time.strftime("%Y-%m-%d")
    p = Path(home) / "receipts" / f"lane-deadman-{day}.tsv"
    p.parent.mkdir(parents=True, exist_ok=True)
    pr = probe or {}
    with p.open("a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{target}\t{status}\tturns={pr.get('turns', '?')}\tstartable={pr.get('startable', '?')}\tfree_gb={pr.get('free_gb', '?')}\t{extra}\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=("m5", "mac2", "probe"), default=None)
    ap.add_argument("cmd", nargs="?")
    ap.add_argument("--home", default=str(Path.home() / "m5-jobs/lane-deadman"))
    ap.add_argument("--publish-home", default=str(Path.home() / "Projects/builder/agent-native/.tmp/replica-home/lane-publish"))
    ap.add_argument("--fake-probe", help="drill only, needs a DEADMAN-TEST file in --home: replaces the M5 reading (JSON) and shortens grace and heal wait to --drill-seconds")
    ap.add_argument("--drill-seconds", type=int, default=20)
    a = ap.parse_args(argv)
    if a.cmd == "probe":
        print(json.dumps(local_probe("m5")))
        return 0
    import notify
    home = Path(a.home)
    test = (home / "DEADMAN-TEST").exists()
    state_path = home / ("state.test.json" if test else "state.json")
    state = load(state_path)
    now = time.time()
    grace, wait = GRACE_S, HEAL_WAIT_S
    if a.fake_probe and not test:
        raise SystemExit("--fake-probe needs a DEADMAN-TEST file in --home")
    if a.fake_probe:
        grace, wait = a.drill_seconds, a.drill_seconds
    targets = [("m5", json.loads(a.fake_probe) if a.fake_probe else local_probe("m5"), lambda: heal_m5(None))] if a.mode == "m5" else [
        ("m4", local_probe("mac2"), lambda: kickstart(LOOP_LABEL)), ("m5", remote_probe(), lambda: heal_m5(M5_HOST))]
    worst = 0
    if a.mode == "mac2":
        try:
            notify.mirror_remote(home, M5_HOST)
        except notify.NotifyError as e:
            receipt(home, "alert-mirror", "mirror-failed", None, str(e))
            worst = 1
    if a.mode == "m5" and not a.fake_probe:
        pool_dir = Path.home() / "m5-jobs/pool"
        age, info, problem = read_heartbeat(pool_dir / "m4-heartbeat.json", now)
        pst = state.setdefault("peer-m4", {})
        marker, marker_problem = lane_heal.read_marker(pool_dir / lane_heal.MARKER)
        waiting = lane_heal.peer_gate(pst, age, now, marker, marker_problem)  # runs every pass: it records first_seen and last_good
        status = peer_step(pst, age, problem, now, lambda text: notify.alert(home, "lane-peer-m4", f"Lane queue (M4 -> M5): {text}", test=test), gate=lambda: waiting)
        receipt(home, "peer-m4", status, None, f"hb_age={age} m4_turns={info.get('m4_lane_turns', '?')} depth={info.get('queue_depth', '?')}")
        print(json.dumps({"target": "peer-m4", "status": status, "hb_age": age}))
        worst = max(worst, status == "peer-alert-failed")
        worst = max(worst, guard_pool(home, state, notify, test))
        try:
            exit_info = json.loads((pool_dir / "EXIT-ALERT.json").read_text())
        except (OSError, ValueError):
            exit_info = None
        xstatus = pool_exit_step(state.setdefault("pool-exit", {}), exit_info, now, lambda text: notify.alert(home, "lane-pool-exit", f"Lane pool (M5): {text}", test=test))
        receipt(home, "pool-exit", xstatus, None, (exit_info or {}).get("reason", ""))
        worst = max(worst, xstatus == "pool-exit-alert-failed")
    for name, probe, heal in targets:
        st = state.setdefault(name, {})
        status = step(st, probe, now, heal, lambda text, n=name: notify.alert(home, f"lane-turns-{n}", f"Lane turns ({n.upper()}): {text}", test=test), grace, wait)
        receipt(home, name, status, probe)
        print(json.dumps({"target": name, "status": status, "probe": probe}))
        worst = max(worst, status == "alert-failed")
        fstatus, ledger = fill_step(state.setdefault(f"fill-{name}", {}), probe, now, heal, lambda text, n=name: notify.alert(home, f"lane-fill-{n}", f"Lane workers ({n.upper()}): {text}", test=test), *((grace, wait) if a.fake_probe else ()))
        receipt(home, f"fill-{name}", fstatus, probe, ledger or ("empty queue: nothing startable" if fstatus == "empty-queue" else f"workers={(probe or {}).get('workers', '?')} target={(probe or {}).get('target', '?')}"))
        print(json.dumps({"target": f"fill-{name}", "status": fstatus}))
        worst = max(worst, fstatus == "fill-alert-failed")
    if not a.fake_probe:
        worst = max(worst, ask_rows(home, state, notify, test))
    if a.mode == "mac2" and not a.fake_probe:
        worst = max(worst, lane_heal.watch_publisher(home, Path(a.publish_home), state, notify, test, M5_HOST, receipt))
    save(state_path, state)
    return int(worst)


def ask_rows(home, state, notify, test):
    """Every pass: ask rows queued over 2 h with no start, or past due with no receipt on disk (asks.py check). A broken check is a receipt line and exit 1."""
    try:
        import asks
        status, failed = asks.deadman_pass(str(home), state, notify, test)
    except Exception as e:  # noqa: BLE001 - any failure of the ask pass is reported, never read as a clean pass
        status, failed = f"asks-failed {type(e).__name__}: {str(e)[:120]}", True
    receipt(home, "asks", status, None)
    print(json.dumps({"target": "asks", "status": status}))
    return int(failed)


def guard_pool(home, state, notify, test):
    """Every pass: the pool copy the GUI agent loads must carry lane_pass. A repair kicks the pool (plain kickstart, never -k: workers survive)."""
    import pool_guard
    gui = Path.home() / ".config/replica-workers/m5-pool-gui/pool-gui.py"
    st = state.setdefault("pool-guard", {})
    try:
        status = pool_guard.check(gui, lambda: subprocess.run(["/bin/launchctl", "kickstart", f"gui/{os.getuid()}/{POOL_LABEL}"], stdin=subprocess.DEVNULL, capture_output=True, timeout=60))
        st.pop("alerted", None)
    except (pool_guard.GuardError, OSError) as e:
        status = "pool-guard-failed"
        if st.get("alerted") is None and notify.alert(home, "lane-pool-guard", f"Lane pool guard (M5): the loaded pool has no lane_pass and could not be patched ({e}).", test=test):
            st["alerted"] = time.time()
    receipt(home, "pool-guard", status, None)
    print(json.dumps({"target": "pool-guard", "status": status}))
    return int(status == "pool-guard-failed")


def release_stale_claims(pool_dir):
    """Heal step before the kick: M5 claims whose job ended or vanished go back to the queue (lane_rows.reap_claims, the same rule the publisher's ingest runs)."""
    import lane_rows
    pool_dir = Path(pool_dir)
    _, claims, _ = lane_rows.paths(pool_dir)
    open_file = pool_dir / "lane-open.tsv"
    keys = {lane_rows.safe_key(r["key"]) for r in lane_rows.read_queue(open_file)} if open_file.exists() else None
    return lane_rows.reap_claims(claims, pool_dir.parent, keys, int(time.time()))


def heal_m5(host):
    if host is None:
        release_stale_claims(Path.home() / "m5-jobs/pool")
        clear_stale_stop(Path.home() / "m5-jobs/pool", Path.home() / "m5-jobs/pool/lane-queue.tsv")
        kickstart(POOL_LABEL)
    else:
        subprocess.run(["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "/usr/bin/python3 m5-jobs/pool/lane_deadman.py heal"], stdin=subprocess.DEVNULL, capture_output=True, timeout=90)


if __name__ == "__main__":
    if sys.argv[1:] == ["heal"]:
        heal_m5(None)
        sys.exit(0)
    sys.exit(main())
