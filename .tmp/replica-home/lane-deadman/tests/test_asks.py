"""asks.py: rows at birth, the dead-man rule, the audit, the BLIND alert and the brief templates. Fixtures only; never the live ledger.

Run from lane-deadman/: python3 -I -m unittest discover -s tests -v   (ASKS_BIN points the suite at another copy of bin/, which is how the mutant runs work)
"""
import importlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

BIN = Path(os.environ.get("ASKS_BIN") or Path(__file__).resolve().parents[1] / "bin")
sys.path.insert(0, str(BIN))
asks = importlib.import_module("asks")

BRIEF = """# FIXTURE-JOB: stop worktrees filling the disk

Steve's ask, relayed: worktrees fill the disk in days.

1. Strip the regenerable artifacts from idle trees and log the bytes in `fixture-job/strip.tsv`.
2. Fix the rebase leak in labs-merge.sh with a trap that removes only its own tree.

Context: the M4 is tight on disk, so once the leak is fixed and measured there is one more piece of work. 3. Pilot the pnpm global virtual store on one labs lane and report the per-tree bytes before and after.

Report `fixture-job/REPORT.md`.
"""

TEMPLATE_GLOBS = [
    ("/Users/steve/Projects/re/kit-local/areas", "AREA-BRIEF*.template.md"),
    ("/Users/steve/Projects/re/kit-local", "AREA-BRIEF.template.md"),
    ("/Users/steve/Projects/re/kit/clone-machine", "AREA-BRIEF*.template.md"),
    ("/Users/steve/Projects/re/kit/msgs", "*TEMPLATE*.md"),
    ("/Users/steve/Projects/re/kit/msgs", "*template*.md"),
]


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="asks-test-"))
        self.ledger = self.tmp / "ledger.md"
        self.ledger.write_text("04:00 NOTE someone unrelated line\n")
        os.environ["FLEET_LEDGER_PATH"] = str(self.ledger)
        os.environ["FLEET_ORCH_ALERTS_PATH"] = str(self.tmp / "orch.md")

    def row(self, rid, created, due, receipt="pending", owner="fixture-job", text="pilot the virtual store on one lane", extra=""):
        r = {"id": rid, "owner": owner, "due": asks.iso(due), "receipt": receipt, "source": f"{self.tmp}/BRIEF.md:3", "created_ts": created, "text": text}
        return asks.format_row(r, extra=extra)


class ExtractTest(Fixture):
    def test_three_steps_one_buried_then_rerun_adds_nothing(self):
        brief = self.tmp / "FIXTURE-JOB-BRIEF.md"
        brief.write_text(BRIEF)
        rows = asks.extract(brief, ledger=self.ledger)
        self.assertEqual(len(rows), 3, [r["text"] for r in rows])
        self.assertTrue(any("virtual store" in r["text"] for r in rows), "the step buried mid-paragraph became a row")
        self.assertTrue(all(r["owner"] == "FIXTURE-JOB" for r in rows), "no owner named: the brief's job owns it")
        due = [asks.parse_iso(r["due"]) - r["created_ts"] for r in rows]
        self.assertTrue(all(abs(d - 2 * 3600) <= 60 for d in due), due)
        lines = [l for l in self.ledger.read_text().splitlines() if " ASK " in l]
        self.assertEqual(len(lines), 3)
        for l in lines:
            self.assertRegex(l, r"^- \d\d:\d\d ASK a[0-9a-f]{11} owner=\S+ due=\d{4}-\d\d-\d\dT\d\d:\d\d receipt=\S+ source=\S+:\d+ created=\S+ :: .+")
        self.assertEqual(asks.extract(brief, ledger=self.ledger), [], "re-running extract appends no duplicate rows")
        self.assertEqual(len([l for l in self.ledger.read_text().splitlines() if " ASK " in l]), 3)


class CheckTest(Fixture):
    def test_flags_queued_and_past_due_and_stays_silent_for_started_with_receipt(self):
        now = time.time()
        real = self.tmp / "fixture-job" / "strip.tsv"
        real.parent.mkdir()
        real.write_text("tree\tbytes\n")
        lines = [
            self.row("aqueued00001", now - 3 * 3600, now + 3600, text="strip idle trees"),
            self.row("apastdue0001", now - 3600, now - 600, receipt=str(self.tmp / "missing" / "receipt.json"), text="write the budget receipt"),
            self.row("asilent00001", now - 3 * 3600, now - 600, receipt=str(real), text="log stripped bytes"),
            f"- {time.strftime('%H:%M', time.localtime(now - 2 * 3600))} ASK-START asilent00001 evidence={real}",
        ]
        with self.ledger.open("a") as f:
            f.write("\n".join(lines) + "\n")
        res = asks.check(self.ledger, now=now)
        got = {(i, c) for i, c, _ in res["conditions"]}
        self.assertIn(("aqueued00001", "queued-2h"), got)
        self.assertIn(("apastdue0001", "past-due-no-receipt"), got)
        self.assertFalse([c for c in got if c[0] == "asilent00001"], "a started row with a real receipt is silent")
        self.assertNotIn(("apastdue0001", "queued-2h"), got, "under 2 h old is not queued too long")
        self.assertIn("ASK-DONE asilent00001", self.ledger.read_text(), "the receipt on disk closes the row")

    def test_alert_once_per_id_and_condition(self):
        sent = []
        conds = [("aone", "queued-2h", "x"), ("aone", "past-due-no-receipt", "y")]
        asks.alert_conditions(conds, self.tmp, lambda c, t: sent.append((c, t)) or True)
        asks.alert_conditions(conds, self.tmp, lambda c, t: sent.append((c, t)) or True)
        self.assertEqual(sorted(c for c, _ in sent), ["past-due-no-receipt", "queued-2h"])


class AuditTest(Fixture):
    def test_lists_a_never_rowed_ask(self):
        jobs = self.tmp / "jobs"
        jobs.mkdir()
        (jobs / "LOST-BRIEF.md").write_text("# LOST: one ask nobody rowed\n\n1. Pilot the shared store on one labs lane and report bytes.\n")
        res = asks.audit(self.ledger, since=time.time() - 3600, roots=[(jobs, "*BRIEF*.md", "brief")], messages=False)
        texts = [a["text"] for a in res["never_rowed"]]
        self.assertTrue(any("shared store" in t for t in texts), texts)
        self.assertIn("Promised but never a row", asks.audit_markdown(res))
        asks.extract(jobs / "LOST-BRIEF.md", ledger=self.ledger)
        res2 = asks.audit(self.ledger, since=time.time() - 3600, roots=[(jobs, "*BRIEF*.md", "brief")], messages=False)
        self.assertEqual(res2["never_rowed"], [], "once rowed it is no longer listed as never a row")


class BlindTest(Fixture):
    def test_blind_fires_once_not_twice_and_rearms(self):
        st, sent = {}, []
        alert = lambda text: sent.append(text) or True
        self.assertEqual(asks.blind_step(st, "asks-check", "/x/ledger.md", False, alert), "blind-alerted")
        self.assertEqual(asks.blind_step(st, "asks-check", "/x/ledger.md", False, alert), "blind-already")
        self.assertEqual(sent, ["BLIND asks-check cannot read /x/ledger.md"])
        self.assertEqual(asks.blind_step(st, "asks-check", "/x/ledger.md", True, alert), "blind-cleared")
        asks.blind_step(st, "asks-check", "/x/ledger.md", False, alert)
        self.assertEqual(len(sent), 2, "readable again re-arms the alert")

    def test_deadman_pass_unreadable_ledger_is_blind_not_empty(self):
        bad = self.tmp / "ledger-is-a-dir"
        bad.mkdir()
        os.environ["FLEET_LEDGER_PATH"] = str(bad)
        sent = []

        class FakeNotify:
            @staticmethod
            def alert(home, trigger, text, test=False):
                sent.append((trigger, text))
                return True
        state = {}
        status, failed = asks.deadman_pass(str(self.tmp), state, FakeNotify)
        asks.deadman_pass(str(self.tmp), state, FakeNotify)
        self.assertTrue(status.startswith("blind-alerted"), status)
        self.assertEqual(len(sent), 1)
        self.assertTrue(sent[0][1].startswith("BLIND asks-check cannot read"))

    def test_watch_source_blind_once_per_episode(self):
        good, gone = self.tmp / "rows.tsv", self.tmp / "receipts" / "gone.tsv"
        good.write_text("a\tb\n")
        (self.tmp / "watch-sources.tsv").write_text(f"watch\tsource\nfill-pulse\t{good}\nrun-watch\t{self.tmp}/receipts/*.tsv\n")
        sent = []

        class FakeNotify:
            @staticmethod
            def alert(home, trigger, text, test=False):
                sent.append(text)
                return True
        state = {}
        asks.blind_watches(str(self.tmp), state, FakeNotify)
        asks.blind_watches(str(self.tmp), state, FakeNotify)
        self.assertEqual(sent, [f"BLIND run-watch cannot read {self.tmp}/receipts/*.tsv"], "only the unreadable source, and only once")
        gone.parent.mkdir()
        gone.write_text("x\n")
        status, failed = asks.blind_watches(str(self.tmp), state, FakeNotify)
        self.assertIn("blind-cleared=1", status)
        self.assertFalse(failed)
        gone.unlink()
        asks.blind_watches(str(self.tmp), state, FakeNotify)
        self.assertEqual(len(sent), 2, "blind again after it cleared alerts again")


class TemplateConformanceTest(unittest.TestCase):
    def test_every_brief_template_ends_with_an_asks_table(self):
        globs = json.loads(os.environ["ASKS_TEMPLATE_GLOBS"]) if os.environ.get("ASKS_TEMPLATE_GLOBS") else TEMPLATE_GLOBS
        roots = [(Path(r), g) for r, g in globs]
        if not any(r.is_dir() for r, _ in roots):
            self.skipTest("no brief template folders on this Mac")
        files = sorted({p for r, g in roots if r.is_dir() for p in r.glob(g)})
        self.assertTrue(files, "template folders exist but hold no brief template")
        for p in files:
            text = p.read_text()
            self.assertRegex(text, r"(?m)^## Asks\s*$", p)
            self.assertRegex(text, r"(?m)^\|\s*id\s*\|\s*owner\s*\|\s*due\s*\|\s*receipt\s*\|", p)
            tail = text[text.rindex("## Asks"):]
            self.assertNotRegex(tail.split("\n", 1)[1], r"(?m)^## ", f"{p}: the Asks table is the brief's last section")


class OvernightSectionTest(unittest.TestCase):
    def test_renders_hourly_rows_in_order_and_queue_with_sensitive_values_redacted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "coordinator-hourly.tsv").write_text(
                "time\tmeasurements\tchanged\n"
                "01:00\tworkers=2\tstarted batch\n"
                "02:00\tworkers=3\tAPI_KEY=abc123 sent to steve@example.com\n"
            )
            (root / "QUEUE.md").write_text("# Queue\n- [ ] stuck item; owner person@example.com\n")
            rendered = asks.overnight_section(root)
        joined = "\n".join(rendered)
        self.assertLess(joined.index("time=01:00"), joined.index("time=02:00"))
        self.assertIn("workers=2", joined)
        self.assertIn("changed=started batch", joined)
        self.assertIn("API_KEY=[redacted]", joined)
        self.assertIn("[email redacted]", joined)
        self.assertNotIn("abc123", joined)
        self.assertIn("# Queue", rendered)

    def test_each_missing_or_unreadable_file_is_named(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "coordinator-hourly.tsv").mkdir()
            rendered = asks.overnight_section(root)
        joined = "\n".join(rendered)
        self.assertIn(f"unreadable: {root}/coordinator-hourly.tsv", joined)
        self.assertIn(f"unreadable: {root}/QUEUE.md", joined)


if __name__ == "__main__":
    unittest.main()
