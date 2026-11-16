import os, shutil, subprocess, sys, tempfile, json
from pathlib import Path
SRC = Path(sys.argv[1]); TESTS = Path(sys.argv[2]); OUT = Path(sys.argv[3])
M = [
 ("asks.py", "canary started by evidence (probe tag ignored)", 'ev = r.get("started") if tag else started_evidence(r, led, nouns, now)', 'ev = started_evidence(r, led, nouns, now)'),
 ("notify.py", "notify canary suppression deleted", '    if canary or kind != STEVE_ACTION:\n', '    if kind != STEVE_ACTION:\n'),
 ("notify.py", "notify canary=1 record tag deleted", '        record.update(canary=1, text=redact(" ".join(str(text).split()))[:400])\n', '        pass\n'),
 ("asks.py", "canary alert not its own tagged alert", '        text = probe_alert_text(i, c, d)\n        if text and alert(c, text):', '        text = None\n        if text and alert(c, text):'),
 ("asks.py", "on-time window deleted (any flag is on time)", 'out["on_time"] = 0 <= t - threshold <= CANARY_GRACE_S', 'out["on_time"] = True'),
 ("asks.py", "verify never closes the canary", '        drop(host, v["id"], "canary-verified" if v["flagged_at"] else "canary-missed")\n', '        pass\n'),
 ("asks.py", "canary-missed rule deleted", '    elif now > due + CANARY_MISS_S:\n        out["verdict"] = "missed"', '    elif now > due + CANARY_MISS_S:\n        out["verdict"] = "pending"'),
 ("asks.py", "canary-missed once-guard deleted", 'if v["verdict"] == "missed" and not st.get(s["id"]):', 'if v["verdict"] == "missed":'),
 ("asks.py", "canary watch reads unreachable Mac as no canary", '        except Exception as e:  # noqa: BLE001 - any read failure is this watch going blind on that Mac\n', '        except Exception as e:  # noqa: BLE001 - any read failure is this watch going blind on that Mac\n            continue\n'),
 ("asks.py", "duty alert text deleted (grouped as a plain ask)", '    m = re.match(r"duty=(\\S+) (.*)$", detail)', '    m = None'),
 ("asks.py", "duty not started at plant (queued-2h fires)", '''                          f"- {hm} ASK-START {rid} evidence=scheduled:{REPORT_LABEL}"])''', '''                          ])'''),
 ("asks.py", "duty planted twice", '    rid = duty_id(day_ts)\n    if rid in parse_rows(read_lines(ledger)[0]):\n        return False\n', '    rid = duty_id(day_ts)\n'),
 ("asks.py", "send never marks the duty done", '''        append_lines(Path(ledger) if ledger else ledger_path(), [f"- {time.strftime('%H:%M', time.localtime(now))} ASK-DONE {rid_row} receipt={receipt}"])''', '''        pass'''),
 ("asks.py", "line caps removed", 'for a in (dropped["never_rowed"] + dropped["never_started"] + dropped["past_due"])[:4]]', 'for a in (dropped["never_rowed"] + dropped["never_started"] + dropped["past_due"])]'),
 ("asks.py", "canary section dropped from the body", '    body.append("3. Canary caught on both Macs:")\n', ''),
 ("asks.py", "subject prefix changed", 'subject = (f"Fleet asks report {day}', 'subject = (f"Asks report {day}'),
 ("asks.py", "receipt written without a response id", '                if rid:\n                    reason = None\n                    break', '                if True:\n                    reason = None\n                    break'),
 ("asks.py", "recipient guard deleted", '    if list(to) != [REPORT_TO]:\n', '    if False:\n'),
 ("asks.py", "mailer reachable under test", '    if under_test():\n        return None\n    if FLEET_MAILER', '    if FLEET_MAILER'),
]
res = []
for f, name, old, new in M:
    d = Path(tempfile.mkdtemp(prefix="p2-mutant-"))
    for g in SRC.glob("*.py"):
        shutil.copy2(g, d / g.name)
    text = (d / f).read_text()
    assert text.count(old) == 1, name
    (d / f).write_text(text.replace(old, new))
    r = subprocess.run([sys.executable, "-I", "-m", "unittest", "discover", "-s", str(TESTS)], capture_output=True, text=True, env={**os.environ, "ASKS_BIN": str(d)})
    tail = [l for l in r.stderr.splitlines() if l.startswith(("FAIL:", "ERROR:"))]
    res.append({"file": f, "mutant": name, "rc": r.returncode, "red": r.returncode != 0, "failing": tail})
    shutil.rmtree(d)
OUT.write_text(json.dumps(res, indent=1) + "\n")
for x in res:
    print(("RED  " if x["red"] else "GREEN"), x["mutant"], "|", "; ".join(x["failing"])[:150])
print("all red:", all(x["red"] for x in res))
