"""Phase 2: the dead-man canary, the missed-canary alert, the report duty and the Fleet asks report. Fixtures only; the mailer is always a stub.

Run from lane-deadman/: python3 -I -m unittest discover -s tests -v   (ASKS_BIN points the suite at another copy of bin/, for the mutant runs)
"""
import importlib
import json
import os
import re
import sys
import tempfile
import time
import unittest
from pathlib import Path

BIN = Path(os.environ.get("ASKS_BIN") or Path(__file__).resolve().parents[1] / "bin")
sys.path.insert(0, str(BIN))
asks = importlib.import_module("asks")
notify = importlib.import_module("notify")


class FakeNotify:
    def __init__(self):
        self.sent = []

    def alert(self, home, trigger, text, test=False):
        self.sent.append((trigger, text))
        return True


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="canary-test-"))
        self.home = self.tmp / "deadman"
        self.home.mkdir()
        self.ledger = self.tmp / "ledger.md"
        self.ledger.write_text("04:00 NOTE someone unrelated line\n")
        os.environ["FLEET_LEDGER_PATH"] = str(self.ledger)
        os.environ["FLEET_ORCH_ALERTS_PATH"] = str(self.tmp / "orch.md")
        os.environ["ASKS_ROWS_DIR"] = str(self.tmp / "ask-rows")

    def status(self, host, day):
        return asks.canary_status(host, day, self.ledger, home=self.home)


class CanaryTest(Fixture):
    def test_plant_then_flagged_by_the_real_alert_path_then_verified_on_time(self):
        now = time.time()
        planted = now - asks.QUEUED_S - 5 * 60  # the fake clock: planted 2 h 5 min ago, so this pass is 5 min past the threshold
        p = asks.plant_canary("m4", self.ledger, now=planted)
        self.assertTrue(p["planted"])
        self.assertFalse(asks.plant_canary("m4", self.ledger, now=planted)["planted"], "one canary per Mac per day")
        row = [l for l in self.ledger.read_text().splitlines() if " ASK canary-" in l][0]
        self.assertRegex(row, r"ASK canary-m4-\d{8} owner=canary due=\S+ receipt=pending canary=1 ")
        # the dead-man's own pass, with the real notify.py: the alert is logged in alerts.jsonl tagged canary=1 and never reaches Telegram
        status, failed = asks._asks_pass(str(self.home), {}, notify, False, now)
        self.assertFalse(failed, status)
        recs = [json.loads(l) for l in (self.home / "alerts.jsonl").read_text().splitlines()]
        canary = [r for r in recs if r.get("canary")]
        self.assertTrue(canary, recs)
        self.assertTrue(all(r["channel"] == "telegram" and r.get("ok") for r in canary))
        self.assertIn("canary=1", (self.tmp / "orch.md").read_text(), "routed to the fleet like any alert")
        day = asks.day_stamp(planted)
        v = asks.verify_canary("m4", day, out_dir=self.tmp / "out", now=now + 60, status_of=self.status,
                               drop=lambda h, rid, reason: asks.drop_row(rid, reason, self.ledger))
        self.assertEqual(v["verdict"], "ok", v)
        self.assertTrue(v["on_time"])
        receipt = json.loads((self.tmp / "out" / f"canary-m4-{day}.json").read_text())
        for k in ("planted_at", "due", "flagged_at", "on_time", "alert"):
            self.assertIn(k, receipt)
        self.assertIn(f"ASK-DROP canary-m4-{day} reason=canary-verified", self.ledger.read_text())

    def test_canary_is_never_started_by_evidence(self):
        now = time.time()
        asks.plant_canary("m4", self.ledger, now=now - asks.QUEUED_S - 300)
        with self.ledger.open("a") as f:
            f.write(f"- {time.strftime('%H:%M', time.localtime(now))} NOTE canary started: dead-man canary for m4, owner action taken, flag it\n")
        res = asks.check(self.ledger, now=now)
        conds = {c for i, c, _ in res["conditions"] if i.startswith("canary-")}
        self.assertEqual(conds, {"queued-2h", "past-due-no-receipt"}, res["conditions"])

    def test_flag_before_the_threshold_is_not_on_time(self):
        planted = time.time() - 3 * 3600
        s = {"host": "m4", "id": "canary-m4-x", "row": {"created": asks.iso(planted), "due": asks.iso(planted + asks.QUEUED_S)},
             "alerts": [{"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(planted + 600)), "canary": 1}]}
        self.assertEqual(asks.judge_canary(s)["verdict"], "early")

    def test_notify_keeps_a_canary_off_telegram_even_as_steve_action(self):
        res = notify.send("steve-action", "canary=1 Check the fleet dead-man now.", home=str(self.home), base_url="http://127.0.0.1:9/fake")
        self.assertFalse(res["delivered"])
        self.assertIsNone(res["reason"])
        rec = json.loads((self.home / "alerts.jsonl").read_text().splitlines()[-1])
        self.assertEqual(rec.get("suppressed"), "telegram")
        self.assertEqual(rec.get("canary"), 1)


class CanaryMissedTest(Fixture):
    def test_not_flagged_30_min_after_due_raises_canary_missed_once(self):
        now = time.time()
        planted = now - asks.QUEUED_S - asks.CANARY_MISS_S - 120
        asks.plant_canary("m5", self.ledger, now=planted)
        fake = FakeNotify()
        status_of = lambda host, days: [self.status(host, d) for d in days]
        st = {}
        word, failed = asks.canary_watch(str(self.home), st, fake, now=now, hosts=("m5",), status_of=status_of)
        self.assertFalse(failed)
        missed = [t for k, t in fake.sent if k == "steve-action" and "canary missed on M5" in t]
        self.assertEqual(len(missed), 1, fake.sent)
        self.assertIsNone(notify.refusal_reason(missed[0]), "the sentence passes the gate to Steve")
        asks.canary_watch(str(self.home), st, fake, now=now + 300, hosts=("m5",), status_of=status_of)
        self.assertEqual(len([t for k, t in fake.sent if "canary missed" in t]), 1, "once per canary")

    def test_flagged_canary_is_not_missed_and_unreadable_mac_is_blind(self):
        now = time.time()
        planted = now - asks.QUEUED_S - asks.CANARY_MISS_S - 120
        asks.plant_canary("m4", self.ledger, now=planted)
        rid = asks.canary_id("m4", planted)
        (self.home / "alerts.jsonl").write_text(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(planted + asks.QUEUED_S + 200)),
                                                            "canary": 1, "text": f"canary=1 {rid} queued-2h"}) + "\n")
        fake = FakeNotify()
        asks.canary_watch(str(self.home), {}, fake, now=now, hosts=("m4",), status_of=lambda h, days: [self.status(h, d) for d in days])
        self.assertEqual(fake.sent, [])

        def down(host, days):
            raise RuntimeError("ssh exit 255")
        word, _ = asks.canary_watch(str(self.home), {}, fake, now=now, hosts=("m5",), status_of=down)
        self.assertIn("blind-alerted", word)
        self.assertTrue(any(t.startswith("BLIND canary-watch") for _, t in fake.sent))


class DutyTest(Fixture):
    def test_missing_sent_json_at_0830_raises_report_not_sent(self):
        now = time.time()
        day0 = now - 86400  # yesterday's duty: due 08:30 yesterday, long past
        daily = self.tmp / "daily"
        self.assertTrue(asks.plant_duty(day0, self.ledger, now=day0 - 86400, daily_dir=daily))
        self.assertFalse(asks.plant_duty(day0, self.ledger, now=day0, daily_dir=daily), "planted once")
        fake = FakeNotify()
        asks._asks_pass(str(self.home), {}, fake, False, now)
        date = time.strftime("%Y-%m-%d", time.localtime(day0))
        self.assertTrue(any(f"Fleet asks report not sent {date}" in t for _, t in fake.sent), fake.sent)
        self.assertFalse(any("queued-2h" in k for k, _ in fake.sent), "a scheduled duty is started at plant time")

    def test_sent_json_present_closes_the_duty_silently(self):
        now = time.time()
        day0 = now - 86400
        daily = self.tmp / "daily"
        asks.plant_duty(day0, self.ledger, now=day0 - 86400, daily_dir=daily)
        date = time.strftime("%Y-%m-%d", time.localtime(day0))
        res = asks.send_report(date, "Fleet asks report x", "body\n", lambda to, s, b: {"id": "stub-1"}, daily_dir=daily, ledger=self.ledger, now=now)
        self.assertTrue(res["sent"])
        self.assertRegex(self.ledger.read_text(), rf"ASK-DONE asks-report-{date.replace('-', '')} receipt=\S+sent.json\n", "the send step marks the duty done")
        fake = FakeNotify()
        asks._asks_pass(str(self.home), {}, fake, False, now)
        self.assertEqual([t for _, t in fake.sent if "Fleet asks report" in t], [])
        self.assertIn(f"ASK-DONE asks-report-{date.replace('-', '')}", self.ledger.read_text())


class ReportTest(Fixture):
    def dropped(self, n):
        a = [{"id": f"a{i:011x}", "text": f"ask number {i} " * 5} for i in range(n)]
        return {"dropped": 3 * n, "dropped_per_day": 3.0 * n, "never_rowed": a, "never_started": a, "past_due": a, "notes_dropped": []}

    def test_subject_prefix_line_cap_and_three_sections(self):
        flagged = {"m4": [(f"a{i:011x}", "queued-2h", 0) for i in range(40)], "m5": [("ab", "past-due-no-receipt", 0)]}
        canaries = {"m4": {"verdict": "ok", "flagged_at": "2026-11-16T10:05:00", "lag_s": 300}, "m5": {"verdict": "missed"}}
        subject, body = asks.build_report("2026-11-16", self.dropped(60), flagged, canaries, (180.0, 1618.5), errors=["x" * 50] * 9)
        self.assertRegex(subject, r"^Fleet asks report 2026-11-16: 180 dropped, 41 flagged, canary M4 ok, M5 MISSED$")
        lines = body.rstrip("\n").split("\n")
        self.assertLessEqual(len(lines), 25)
        text = "\n".join(lines)
        for section in ("Asks dropped in the last 24 h", "Stalled rows the dead-man flagged", "Canary caught on both Macs", "48 h baseline"):
            self.assertIn(section, text)
        first, _ = asks.build_report("2026-11-15", self.dropped(1), {}, {"m4": {"verdict": "pending"}, "m5": {"verdict": "pending"}}, (3.0, 1618.5), first_run=True)
        self.assertTrue(first.startswith("Fleet asks report 2026-11-15 (first run): "), first)

    def test_mailer_is_stubbed_and_receipt_needs_its_response_id(self):
        fake_mailer = self.tmp / "fleet-mail"
        fake_mailer.write_text(f"#!/bin/sh\ntouch {self.tmp}/MAILER-RAN\necho '{{\"id\": \"real\"}}'\n")
        fake_mailer.chmod(0o755)
        real, asks.FLEET_MAILER = asks.FLEET_MAILER, fake_mailer
        try:
            self.assertIsNone(asks.find_mailer(), "no mailer is reachable under test, even when one is installed")
        finally:
            asks.FLEET_MAILER = real
        calls = []
        daily = self.tmp / "daily"
        ok = asks.send_report("2026-11-16", "Fleet asks report 2026-11-16: s", "b\n", lambda to, s, b: calls.append(to) or {"id": "msg-123"}, daily_dir=daily,
                              ledger=self.ledger)
        self.assertEqual(calls, ["steve@builder.io"])
        self.assertEqual(json.loads((daily / "2026-11-16.sent.json").read_text())["response_id"], "msg-123")
        bad = asks.send_report("2026-11-17", "s", "b\n", lambda to, s, b: {}, daily_dir=daily, ledger=self.ledger)
        self.assertFalse(bad["sent"])
        self.assertFalse((daily / "2026-11-17.sent.json").exists(), "a reply with no id is no receipt")
        none = asks.send_report("2026-11-18", "s", "b\n", None, daily_dir=daily, ledger=self.ledger)
        self.assertFalse(none["sent"])
        self.assertIn("no fleet mailer", json.loads((daily / "2026-11-18.unsent.json").read_text())["reason"])
        with self.assertRaises(ValueError):
            asks.send_report("2026-11-19", "s", "b", lambda *a: {"id": "x"}, daily_dir=daily, ledger=self.ledger, to=("steve@builder.io", "x@example.com"))


    def test_send_retries_once_and_records_http_status(self):
        calls = []
        def retrying(to, subject, body):
            calls.append(to)
            if len(calls) == 1:
                raise OSError("transient")
            return {"id": "msg-retried", "http_status": 202}
        daily = self.tmp / "retry"
        res = asks.send_report("2026-11-20", "s", "b", retrying, daily_dir=daily, ledger=self.ledger)
        self.assertTrue(res["sent"])
        self.assertEqual(len(calls), 2)
        receipt = json.loads((daily / "2026-11-20.sent.json").read_text())
        self.assertEqual(receipt["http_status"], 202)

    def test_double_failure_is_not_sent_and_is_ledgered(self):
        calls = []
        def failing(*args):
            calls.append(1)
            raise OSError("transient")
        daily = self.tmp / "failed"
        day_ts = time.mktime(time.strptime("2026-11-21", "%Y-%m-%d"))
        asks.plant_duty(day_ts, ledger=self.ledger, now=time.time(), daily_dir=daily)
        res = asks.send_report("2026-11-21", "s", "b", failing, daily_dir=daily, ledger=self.ledger)
        self.assertFalse(res["sent"])
        self.assertEqual(len(calls), 2)
        self.assertFalse((daily / "2026-11-21.sent.json").exists())
        self.assertTrue((daily / "2026-11-21.unsent.json").exists())
        self.assertIn("ASK-DROP asks-report-20261121", self.ledger.read_text())


if __name__ == "__main__":
    unittest.main()
