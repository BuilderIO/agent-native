#!/usr/bin/env python3
"""Asks are ledger rows. An ask that lives only in a brief or a message has no owner, no due time and no alarm, so it is dropped without anyone seeing it.

Every ask is one appended line in the ledger (the handoff ledger on the M4, the spill ledger notify.py writes on a Mac without one):

  - HH:MM ASK <id> owner=<lane|session> due=<YYYY-MM-DDTHH:MM> receipt=<abs path|pending> source=<abs path:line|msg:<id>> created=<YYYY-MM-DDTHH:MM> :: <one-line ask>
  - HH:MM ASK-START <id> evidence=<path>        - HH:MM ASK-DONE <id> receipt=<path>        - HH:MM ASK-DROP <id> reason=<why>

<id> hashes the source and the ask text, so extracting the same brief twice adds nothing.

  extract FILE [--owner NAME]   append the missing ASK rows for one brief or message file (wave.py runs this on every brief it launches)
  check                         the dead-man rule, run inside lane_deadman.py: queued over 2 h with no start, or past due with no receipt on disk
  audit [--since T]             asks promised but never a row, rows never started, rows past due with no receipt
  backfill --hours 48           classify every ask of the last 48 h against ledger lines, job reports and receipt files (the baseline)
  canary plant|status|verify|drop --host m4|m5   the dead-man's own daily test row: no owner action, so it must be flagged at 2 h
  daily [--first-run]           the 08:00 PT report step (launchd com.steve.re.fleet-asks-report on the M4)

Absent and unreadable are different: a missing ledger is no rows, an unreadable one raises and becomes one BLIND alert.
"""
from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

QUEUED_S = 2 * 3600
DEFAULT_DUE_S = 2 * 3600
MAX_TEXT = 220
VERBS = ("ASK", "ASK-START", "ASK-DONE", "ASK-DROP")
ROW = re.compile(r"^(?:- )?(?P<hm>\d\d:\d\d) (?P<verb>ASK(?:-START|-DONE|-DROP)?) (?P<id>[A-Za-z0-9][\w.:-]*)(?P<rest>.*)$")
FIELD = re.compile(r"(?<!\S)([a-z_]+)=(\S+)")
STAMP = re.compile(r"^(?:- )?(?:(?P<date>\d{4}-\d\d-\d\d)[ T])?(?P<hm>\d\d:\d\d)\b")
DATE_ONLY = re.compile(r"^(?:- )?(?P<date>\d{4}-\d\d-\d\d)\b")
STATUS_PARTIAL = re.compile(r"\b(partial|failed|fail|blocked|not started|never started|not run|withheld|deferred|stopped|refused|todo|not done|unmet|pending)\b", re.I)
FILE_TOKEN = re.compile(r"(?<![\w/.-])((?:~|/|\.{1,2}/)?(?:[\w.@-]+/)*[\w@-][\w.@-]*\.(?:md|json|jsonl|tsv|log|diff|patch|txt|csv|png))(?![\w/-])")
INPUT_DOCS = {"brief.md", "agents.md", "claude.md", "skill.md", "readme.md", "worker-contract.md", "rules-addendum.md", "handoff-ledger.md", "standing-decisions.md"}
OUTPUT_HINT = re.compile(r"\b(write|writes|written|save|saved|record|log|receipt|report|produce|create|output|append|emit|leave|put)\b", re.I)
STOP = set("""about above after again against also among another anything around because been before being below between both cannot could does doing done down each
either every first from further have having here into itself just last least less like made make many more most much must need never next none only other others
over same should since some still such than that their them then there these they this those through under until upon very want were what when where which while
whom will with within without would your yours please item step steps first second third note only once owner due receipt source true false none null each
the and for are but not you all any can had her was one our out has his how its may new now old see two way who did get let put say she too use
""".split())


# ---------------------------------------------------------------- time and ids

def iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M", time.localtime(ts))


def parse_iso(text):
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return time.mktime(time.strptime(text[:len(time.strftime(fmt, time.localtime(0)))], fmt))
        except ValueError:
            continue
    raise ValueError(f"not a time: {text}")


def norm(text):
    return " ".join(re.sub(r"[*`_]+", "", str(text)).split()).strip()


def ask_id(source_key, text):
    """Stable over re-extraction: the source (path without line number, or msg:<hash>) plus the normalized ask text."""
    return "a" + hashlib.sha1(f"{source_key}\n{norm(text).lower()}".encode()).hexdigest()[:11]


def msg_key(text):
    return "msg:" + hashlib.sha1(norm(text).lower().encode()).hexdigest()[:12]


# ---------------------------------------------------------------- the ledger

def ledger_path(home=None):
    """The same ledger notify.py routes ALERT lines to (FLEET_LEDGER_PATH, else the M4 handoff ledger, else this Mac's spill ledger)."""
    env = os.environ.get("FLEET_LEDGER_PATH")
    if env:
        return Path(env)
    import notify
    return Path(notify._sinks(home or str(HERE))[0])


def read_lines(path):
    """(lines, 'ok'|'missing'). Unreadable raises OSError: it is never an empty ledger."""
    try:
        return Path(path).read_text(errors="replace").splitlines(), "ok"
    except FileNotFoundError:
        return [], "missing"


def append_lines(path, lines):
    if not lines:
        return
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = "".join(l.rstrip("\n") + "\n" for l in lines).encode()
    fd = os.open(str(path), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            view = view[n:]
    finally:
        os.close(fd)


def parse_rows(lines):
    """{id: row}. A row is its ASK line plus the state lines after it; a state line for an id with no ASK line is kept as an orphan state."""
    rows = {}
    for n, line in enumerate(lines):
        m = ROW.match(line)
        if not m:
            continue
        rest = m.group("rest")
        fields_part, _, text = rest.partition(" :: ")
        fields = dict(FIELD.findall(fields_part))
        rid, verb = m.group("id"), m.group("verb")
        row = rows.setdefault(rid, {"id": rid, "line": None, "started": None, "done": None, "dropped": None})
        if verb == "ASK":
            if row["line"] is None:
                row.update(fields, text=text.strip(), line=n, hm=m.group("hm"))
        elif verb == "ASK-START":
            row["started"] = row["started"] or fields.get("evidence", "yes")
        elif verb == "ASK-DONE":
            row["done"] = fields.get("receipt", "yes")
        else:
            row["dropped"] = fields.get("reason", "yes")
    return rows


def line_times(lines, now=None):
    """Epoch per ledger line. The ledger stamps HH:MM only, so the date comes from walking back from today and stepping a day each time the clock runs
    backwards by more than 3 h; a line with a full date resets it. A line with no stamp takes its neighbour's time."""
    now = time.time() if now is None else now
    day = datetime.fromtimestamp(now).date()
    out = [None] * len(lines)
    later = None
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]
        m = STAMP.match(line)
        d = DATE_ONLY.match(line)
        if m and m.group("date"):
            day = datetime.strptime(m.group("date"), "%Y-%m-%d").date()
        elif d and not m:
            day = datetime.strptime(d.group("date"), "%Y-%m-%d").date()
            out[i] = later
            continue
        if not m:
            out[i] = later
            continue
        hh, mm = map(int, m.group("hm").split(":"))
        minutes = hh * 60 + mm
        if later is not None and not m.group("date"):
            later_min = datetime.fromtimestamp(later).hour * 60 + datetime.fromtimestamp(later).minute
            if minutes - later_min > 180:
                day -= timedelta(days=1)
        ts = datetime(day.year, day.month, day.day, hh, mm).timestamp()
        out[i] = later = ts
    return out


def format_row(r, hm=None, extra=""):
    hm = hm or time.strftime("%H:%M", time.localtime(r["created_ts"]))
    r = dict(r, due=r.get("due") or iso(r["due_ts"]))
    text = norm(r["text"])[:MAX_TEXT]
    return (f"- {hm} ASK {r['id']} owner={r['owner']} due={r['due']} receipt={r['receipt']} source={r['source']} created={iso(r['created_ts'])}"
            f"{(' ' + extra) if extra else ''} :: {text}")


# ---------------------------------------------------------------- finding asks in text

NUMBERED = re.compile(r"^\s*(?:[-*]\s+)?\(?(\d{1,2})[.)]\s+(\S.*)$")
INLINE_NUM = re.compile(r"(?:(?<=[\s:;])|^)\(?(\d{1,2})[.)]\s+(?=[A-Z*`(\[\"'])")
KEYWORD = re.compile(r"\bplease\b|^\s*next\s*:|\bowner\s*[:=]|\bitem \d+\b|^\s*[-*]\s*\[ \]", re.I | re.M)
KEYWORD_CASED = re.compile(r"\bASK\b|\bTODO\b|^\s*Do\b(?! not| NOT)")
PROHIBITION = re.compile(r"^\W*(?:please\s+)?(?:do not|don't|never|no )\b", re.I)  # a standing rule, not a task  # "ask" and "todo" in prose are not commitments; the shouted tags and a sentence opening "Do" are
ACTION = set("""add answer apply append archive attach backfill build change check classify clean close commit compare confirm count create cut deploy diagnose
document do drop edit enable disable ensure explain extend file find finish fix flip gate give handle hook implement include install inventory investigate keep
kill land launch link list make mark measure merge migrate mirror move open own pick pilot pin ping post prove publish push put queue quote raise read rebase
rebuild record reload remove rename replace reply report reproduce rerun re-run restart retry return review rotate route run schedule send set ship show split
start stop strip summarize switch sync tag take tell test update use verify wait wire write""".split())
SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z*`(\"'])")
TABLE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")


def _sentences(text):
    return [s.strip() for s in SENT.split(text) if s.strip()]


def _clean(text):
    return norm(text).strip(" -:;")


def asks_table(lines):
    """Rows of a `## Asks` table: | id | owner | due | receipt | ask |. Returns [(line_no, cells)] for filled rows (header, rule and placeholder rows skipped)."""
    out, inside, header = [], False, None
    for n, line in enumerate(lines):
        if re.match(r"^#{1,6}\s+Asks\b", line.strip(), re.I):
            inside, header = True, None
            continue
        if inside and re.match(r"^#{1,6}\s", line.strip()):
            break
        if not inside:
            continue
        m = TABLE_ROW.match(line)
        if not m:
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if header is None:
            header = [c.lower() for c in cells]
            continue
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        row = dict(zip(header, cells))
        text = row.get("ask") or row.get("what") or ""
        if not text or re.fullmatch(r"[<(].*[>)]", text) or text.lower() in ("-", "tbd"):
            continue
        out.append((n, row))
    return out


def find_asks(text, numbered_any=True):
    """Each commitment in a brief or message: numbered steps (also one buried mid-paragraph, when it continues the list), `## Asks` table rows, and
    sentences with please / next: / owner: / item N / ASK / TODO / an unchecked box / a sentence that starts with Do. Returns [{line, text, table}]."""
    lines = text.splitlines()
    found, covered = [], set()
    fence = False
    last_num = 0
    table = asks_table(lines)
    for n, row in table:
        found.append({"line": n + 1, "text": _clean(row.get("ask") or row.get("what")), "table": row})
        covered.add(n)
    in_table_block = {n for n, _ in table}
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            fence = not fence
            i += 1
            continue
        if fence or i in in_table_block or TABLE_ROW.match(line):
            i += 1
            continue
        m = NUMBERED.match(line)
        if m:
            num = int(m.group(1))
            body = [m.group(2)]
            j = i + 1
            while j < len(lines) and lines[j].strip() and not NUMBERED.match(lines[j]) and (lines[j].startswith((" ", "\t")) and not lines[j].lstrip().startswith(("-", "*"))):
                body.append(lines[j].strip())
                j += 1
            item = " ".join(body)
            first = _sentences(item)
            ask = " ".join(first[:2]) if first else item
            if numbered_any or _is_action(ask):
                found.append({"line": i + 1, "text": _clean(ask), "table": None, "num": num})
            covered.update(range(i, j))
            last_num = num
            # a later number buried in the same item line is its own step
            for sub in _inline_steps(item, last_num, skip_first=True):
                found.append({"line": i + 1, "text": sub[1], "table": None})
                last_num = sub[0]
            i = j
            continue
        if line.strip():
            steps = _inline_steps(line, last_num)
            if steps:
                for num, ask in steps:
                    found.append({"line": i + 1, "text": ask, "table": None, "num": num})
                    last_num = num
                covered.add(i)
        i += 1
    fence = False
    for n, line in enumerate(lines):
        if line.strip().startswith("```"):
            fence = not fence
            continue
        if fence or n in covered or TABLE_ROW.match(line) or not line.strip():
            continue
        if line.lstrip().startswith("#"):
            continue
        for s in _sentences(line):
            if (KEYWORD.search(s) or KEYWORD_CASED.search(s)) and not PROHIBITION.search(s):
                found.append({"line": n + 1, "text": _clean(s), "table": None})
    seen, out = set(), []
    for f in found:
        key = f["text"].lower()
        if len(key) < 8 or key in seen:
            continue
        seen.add(key)
        out.append(f)
    # a body step that restates a table row is the same ask
    rows = [f for f in out if f["table"]]
    if rows:
        out = [f for f in out if f["table"] or not any(_overlap(f["text"], r["text"]) >= 0.6 for r in rows)]
    return out


def _is_action(text):
    """A numbered item in a message is an ask only when it tells someone to do something; a numbered finding is not."""
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", re.sub(r"^\W*(?:\*\*)?[^:*]{0,40}(?:\*\*)?:\s*", "", text) or text)
    first = words[0].lower() if words else ""
    return first in ACTION or first == "please" or bool(re.search(r"\bplease\b|\bowner\s*[:=]", text, re.I))


def _inline_steps(line, last_num, skip_first=False):
    """Numbered steps inside running text: accepted only when the number continues the list (last+1), or a 1 is followed by a 2 in the same text."""
    marks = [(m.start(), int(m.group(1)), m.end()) for m in INLINE_NUM.finditer(line)]
    if skip_first:
        marks = [mk for mk in marks if mk[0] > 0]
    nums = [mk[1] for mk in marks]
    out, expect = [], last_num + 1
    for k, (start, num, end) in enumerate(marks):
        ok = num == expect or (num == 1 and (k + 1 < len(nums) and nums[k + 1] == 2))
        if not ok:
            continue
        stop = len(line)
        for s2, n2, _ in marks[k + 1:]:
            if n2 == num + 1:
                stop = s2
                break
        chunk = line[end:stop]
        first = _sentences(chunk)
        ask = _clean(" ".join(first[:2]) if first else chunk)
        if ask:
            out.append((num, ask))
            expect = num + 1
    return out


def _tokens(text):
    out = []
    for t in re.findall(r"[a-z0-9][a-z0-9._-]{2,}", text.lower()):
        t = t.rstrip("._-")
        if len(t) >= 3 and t not in STOP and not re.fullmatch(r"[\d.,:-]+", t):
            out.append(t)
    return out


def _overlap(a, b):
    ta, tb = set(_tokens(a)), set(_tokens(b))
    return len(ta & tb) / max(1, min(len(ta), len(tb)))


# ---------------------------------------------------------------- owner, due, receipt

def job_owner(path):
    p = Path(path)
    name = p.name
    if re.fullmatch(r"BRIEF(?:\.md)?|BRIEF[-.].*\.md", name, re.I) or name.upper() == "BRIEF.MD":
        parent = p.parent.name
        return re.sub(r"\.(failed|done|unknown|diagnose|no_change_needed|waiting_dependency)-[\d-]+$", "", parent)
    m = re.match(r"^(?P<n>.+?)-BRIEF\.md$", name, re.I)
    if m:
        return m.group("n")
    m = re.match(r"^BRIEF-(?P<n>.+?)\.md$", name, re.I)
    if m:
        return m.group("n")
    m = re.match(r"^assign-(?P<n>.+?)\.md$", name, re.I)
    if m:
        return m.group("n")
    return re.sub(r"\.(inbox\.)?md$", "", name)


def out_dirs(brief_path, text=""):
    """Folders a job writes into: the brief's own folder when it is the job folder, `<dir>/<owner lower>/`, and the folder of any REPORT.md the brief names."""
    p = Path(brief_path)
    owner = job_owner(p)
    dirs = []
    if p.name.upper() == "BRIEF.MD" or p.name.upper().startswith("BRIEF."):
        dirs.append(p.parent)
    for cand in (p.parent / owner.lower(), p.parent / owner):
        if cand.is_dir():
            dirs.append(cand)
    rep = _own_report_name(text, owner)
    if rep:
        q = resolve(rep, p)
        if q is not None:
            dirs.append(q.parent)
    seen, out = set(), []
    for d in dirs:
        k = str(d)
        if k not in seen:
            seen.add(k)
            out.append(d)
    return out


def _own_report_name(text, owner):
    """The report this job writes, not one it is told to read: the named REPORT/RESULT whose folder is the job's own name, else the last one named."""
    names = re.findall(r"([\w./~-]*/(?:REPORT|RESULT)\.md)", text or "")
    if not names:
        return None
    o = (owner or "").lower()
    mine = [n for n in names if o and Path(n).parent.name.lower() == o]
    return (mine or names)[-1]


def resolve(name, brief_path):
    """An absolute path for a file a brief names, trying the brief folder, its parents up to the replica home, and ~. None when nothing exists."""
    name = name.strip("`'\"()[],;:")
    if name.startswith("~"):
        q = Path(name).expanduser()
        return q if q.exists() else None
    if name.startswith("/"):
        q = Path(name)
        return q if q.exists() else None
    base = Path(brief_path).parent
    tries = [base / name]
    for parent in list(base.parents)[:4]:
        tries.append(parent / name)
    tries.append(Path.home() / name)
    for q in tries:
        if q.exists():
            return q
    return None


def report_of(brief_path, text):
    """The job's report: a REPORT.md the brief names, else REPORT.md / RESULT.md in one of its out folders, else None."""
    rep = _own_report_name(text, job_owner(brief_path))
    if rep:
        q = resolve(rep, brief_path)
        if q is not None:
            return q
        guess = Path(brief_path).parent / rep
        for parent in [Path(brief_path).parent] + list(Path(brief_path).parents)[:3]:
            if (parent / rep).parent.is_dir():
                return parent / rep
        return guess
    for d in out_dirs(brief_path, ""):
        for n in ("REPORT.md", "RESULT.md"):
            if (d / n).exists():
                return d / n
    if Path(brief_path).name.upper() == "BRIEF.MD":
        return Path(brief_path).parent / "REPORT.md"
    return None


def parse_due(text, created):
    m = re.search(r"\b(?:due|deadline)\s*[:=]\s*(\d{4}-\d\d-\d\dT\d\d:\d\d|\d{1,2}:\d\d)", text, re.I) or re.search(r"\bby (\d{1,2}:\d\d)\b", text)
    if m:
        v = m.group(1)
        if "T" in v:
            return parse_iso(v)
        hh, mm = map(int, v.split(":"))
        base = datetime.fromtimestamp(created)
        due = base.replace(hour=hh % 24, minute=mm, second=0, microsecond=0)
        if due.timestamp() < created - 600:
            due += timedelta(days=1)
        return due.timestamp()
    m = re.search(r"\bwithin (\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|h)\b", text, re.I)
    if m:
        n = float(m.group(1))
        return created + n * (3600 if m.group(2).lower().startswith("h") else 60)
    return created + DEFAULT_DUE_S


def parse_owner(text, default):
    m = re.search(r"\bowner\s*[:=]\s*([A-Za-z0-9][\w./@-]*)", text)
    if m and m.group(1).lower() not in STOP and len(m.group(1)) >= 3:
        return m.group(1).rstrip(".,;:")
    m = re.match(r"^\s*to ([a-z0-9][\w-]*(?:/[\w-]+)?)\b", text)
    if m:
        return m.group(1)
    return default


def named_receipt(text, brief_path, created):
    """A file the ask says it will write: named with an output verb nearby, or not on disk before the ask existed. Inputs it reads are not receipts."""
    for m in FILE_TOKEN.finditer(text):
        name = m.group(1)
        base = Path(name).name.lower()
        if base in INPUT_DOCS or base == Path(brief_path).name.lower() or "brief" in base or "template" in base:
            continue
        before = text[max(0, m.start() - 60):m.start()]
        q = resolve(name, brief_path)
        if q is not None:
            try:
                born = getattr(q.stat(), "st_birthtime", q.stat().st_mtime)
            except OSError:
                born = 0
            other_job = q.parent.name.lower() not in (job_owner(brief_path).lower(), Path(brief_path).parent.name.lower())
            if born < created - 300 and (other_job or (not OUTPUT_HINT.search(before) and not re.search(r"(report|result|receipt)", base))):
                continue
            return q
        if OUTPUT_HINT.search(before) or re.search(r"(report|result|receipt|verdict)", base):
            dirs = out_dirs(brief_path)
            return (dirs[0] if dirs else Path(brief_path).parent) / name.lstrip("./")
    return None


def make_asks(text, source_path, owner=None, created=None, source_key=None, kind="brief"):
    """ASK records for one file or message (not yet written). A brief with no matching sentence is one ask: its title."""
    created = time.time() if created is None else created
    source_key = source_key or str(Path(source_path).resolve()) if source_path else source_key
    owner = owner or (job_owner(source_path) if source_path else "unaddressed")
    report = report_of(source_path, text) if kind == "brief" and source_path else None
    found = find_asks(text, numbered_any=(kind == "brief"))
    if not found and kind == "brief":
        title = next((l.lstrip("# ").strip() for l in text.splitlines() if l.strip()), "")
        if title:
            found = [{"line": 1, "text": _clean(title)[:MAX_TEXT], "table": None}]
    out = []
    for f in found:
        t = f["table"] or {}
        a_owner = (t.get("owner") if t.get("owner") not in (None, "", "-") else None) or parse_owner(f["text"], owner)
        due_cell = t.get("due") if t.get("due") not in (None, "", "-") else None
        try:
            due = parse_iso(due_cell) if due_cell else parse_due(f["text"], created)
        except ValueError:
            due = parse_due(due_cell or f["text"], created)
        rec_cell = t.get("receipt") if t.get("receipt") not in (None, "", "-", "pending") else None
        rec = (resolve(rec_cell, source_path) or Path(rec_cell)) if rec_cell and source_path else (Path(rec_cell) if rec_cell else None)
        if rec is None and source_path:
            rec = named_receipt(f["text"], source_path, created)
        if rec is None and report is not None:
            rec = report
        tid = t.get("id")
        rid = tid if tid and re.fullmatch(r"[A-Za-z0-9][\w.:-]{2,}", tid) and tid not in ("-", "id") else ask_id(source_key, f["text"])
        src = f"{source_path}:{f['line']}" if source_path and not str(source_key).startswith("msg:") else (source_key if str(source_key).startswith("msg:") else f"{source_path}:{f['line']}")
        out.append({"id": rid, "owner": re.sub(r"\s+", "-", a_owner), "due": iso(due), "due_ts": due, "receipt": str(Path(rec).expanduser()) if rec else "pending",
                    "source": src, "text": f["text"], "created_ts": created, "kind": kind, "source_path": str(source_path) if source_path else None,
                    "num": f.get("num")})
    return out


def extract(path, owner=None, ledger=None, now=None, write=True):
    """Append the missing ASK rows for one file. Returns the new rows (empty on a re-run)."""
    path = Path(path).resolve()
    text = path.read_text(errors="replace")
    ledger = Path(ledger) if ledger else ledger_path()
    lines, _ = read_lines(ledger)
    have = set(parse_rows(lines))
    rows = [r for r in make_asks(text, path, owner=owner, created=time.time() if now is None else now) if r["id"] not in have]
    if write:
        append_lines(ledger, [format_row(r) for r in rows])
    return rows


# ---------------------------------------------------------------- the oracle: started, done

class Ledger:
    """The ledger read once per pass: lines, their times, and a token index so each ask's evidence search is a set lookup, not a scan."""

    def __init__(self, lines, now=None):
        self.lines = lines
        self.times = line_times(lines, now)
        self.index = {}
        for n, line in enumerate(lines):
            if ROW.match(line):
                continue
            for t in set(_tokens(line)):
                self.index.setdefault(t, []).append(n)
        self.df = {t: len(v) for t, v in self.index.items()}

    def nouns(self, text, k=7):
        """The ask's most distinctive words: in the text, rare in the ledger. Very common fleet words carry no evidence."""
        cap = max(50, len(self.lines) // 40)
        toks = [t for t in dict.fromkeys(_tokens(text)) if len(t) >= 4 and self.df.get(t, 0) <= cap]
        toks.sort(key=lambda t: (self.df.get(t, 0) == 0, self.df.get(t, 0), -len(t)))  # words the fleet has used, rarest first; never-seen words last
        return toks[:k]

    def hits(self, owner_variants, nouns, after, need, before=None, verbs=None):
        """Ledger line numbers after `after` that name the owner (any variant; skipped when empty) and at least `need` of the nouns."""
        if not nouns or need <= 0:
            return []
        counts = {}
        for t in nouns:
            for n in self.index.get(t, ()):
                counts[n] = counts.get(n, 0) + 1
        out = []
        for n, c in counts.items():
            if c < need:
                continue
            ts = self.times[n]
            if ts is None or ts < after - 300 or (before is not None and ts > before):
                continue
            low = self.lines[n].lower()
            if owner_variants and not any(re.search(rf"(?<![\w-]){re.escape(o)}(?![\w-])", low) for o in owner_variants):
                continue
            if verbs and not re.match(rf"^(?:- )?\d\d:\d\d (?:{verbs})\b", self.lines[n]):
                continue
            out.append(n)
        return sorted(out)

    def owner_seen(self, owner_variants, after):
        """First ledger line after `after` that names the owner anywhere in a word (WORKTREE-DIET also matches worktree-diet-codex)."""
        if not owner_variants:
            return None
        if not hasattr(self, "low"):
            self.low = [l.lower() for l in self.lines]
        pats = [re.compile(rf"(?<![\w]){re.escape(o)}") for o in owner_variants]
        for n in range(len(self.lines)):
            ts = self.times[n]
            if ts is None or ts < after - 300 or ROW.match(self.lines[n]):
                continue
            if any(o in self.low[n] for o in owner_variants) and any(p.search(self.low[n]) for p in pats):
                return n
        return None


def owner_variants(owner):
    """Names a ledger line would use for this owner. A session id is never written in the ledger, so a session owner has none: its evidence is the
    ask's own nouns alone, at a stricter count."""
    o = (owner or "").lower().strip()
    if not o or o in ("unaddressed",) or re.match(r"^(local_|session:|codex:|[0-9a-f]{8}-)", o):
        return []
    v = {o, o.replace("_", "-"), o.replace("-", "_")}
    v.add(re.sub(r"-\d{3,4}$", "", o))
    return sorted(x for x in v if len(x) >= 3)


def need_for(nouns):
    return min(len(nouns), 3) if len(nouns) >= 3 else len(nouns)


def paragraphs(text):
    return [p for p in re.split(r"\n\s*\n|\n(?=\s*(?:\d{1,2}[.)]|[-*])\s)", text) if p.strip()]


def covers(path, nouns, min_need=2, num=None):
    """('done'|'partial'|None, paragraph) for how a shared report covers one ask: the paragraph with the most of the ask's nouns, its status words."""
    try:
        text = Path(path).read_text(errors="replace")[:400000]
    except OSError:
        return None, ""
    if not nouns:
        return "done", ""
    need = max(min_need, math.ceil(0.5 * len(nouns))) if len(nouns) >= 2 else 1
    best, score = None, 0
    for p in paragraphs(text):
        low = p.lower()
        s = sum(1 for t in nouns if t in low)
        if num is not None and re.match(rf"^\s*(?:[-*]\s+)?\**{num}[.)]\s", p) and s >= 1:
            best, score = p, max(s, need)  # the report's own item N, naming the ask: that is its line
            break
        if s > score:
            best, score = p, s
    if best is None or score < min(need, len(nouns)):
        return None, ""
    head = best[:120]
    if STATUS_PARTIAL.search(head):
        state = "partial"
    elif re.search(r"\b(done|pass(?:ed)?|complete[d]?|green|landed|merged)\b", head, re.I):
        state = "done"
    else:
        state = "partial" if STATUS_PARTIAL.search(best[:600]) else "done"
    return state, " ".join(best.split())[:240]


SHARED = re.compile(r"^(REPORT|RESULT|out|run|VERDICT)(\.md|\.log)?$", re.I)


def receipt_state(row, nouns, now=None, num=None):
    """('done'|'partial'|'uncovered'|'missing'|'pending', detail). A path that does not exist is no receipt. A shared report (REPORT.md, RESULT.md)
    must name this ask: its item N, or a paragraph with the ask's nouns. One that exists but never names the ask is `uncovered`: on disk, so not
    alarmed as missing, and never recorded as done."""
    rec = row.get("receipt") or "pending"
    if rec == "pending":
        return "pending", ""
    p = Path(rec)
    if not p.exists():
        alt = archived(p)
        if alt is None:
            return "missing", rec
        p = alt
    if SHARED.match(p.name) and len(nouns) >= 2:
        st, para = covers(p, nouns, num=num)
        if st is None:
            return "uncovered", f"{p} exists but does not name this ask"
        return st, f"{p}: {para}"
    return "done", str(p)


def archived(p):
    """A lane job folder moves to archive-lane*/<name>.<state>-<stamp>/ when it ends; its receipts move with it."""
    job = p.parent
    if not job.name.startswith("lane-"):
        return None
    for d in sorted(job.parent.glob("archive-lane*/" + job.name + ".*")):
        q = d / p.name
        if q.exists():
            return q
    return None


def started_evidence(row, led, nouns, now):
    """Evidence the owner started this ask after it was created: an ASK-START line, a ledger line naming the owner and the ask's nouns, or a file the
    job wrote in its own folder after the ask existed. Returns a path or ledger reference, or None."""
    if row.get("started"):
        return row["started"]
    created = row.get("created_ts") or 0
    hits = led.hits(owner_variants(row.get("owner")), nouns, created, max(1, min(2, len(nouns)))) if led else []
    if hits:
        return f"ledger:{hits[0] + 1}"
    src = (row.get("source") or "").rsplit(":", 1)[0]
    if src and not src.startswith("msg") and Path(src).exists():
        for d in out_dirs(src, ""):
            for name in ("STARTED", "CHECKPOINT.md", "run.log", "out.md", "run.stderr", "REPORT.md", "RESULT.md"):
                q = d / name
                try:
                    if q.exists() and q.stat().st_mtime >= created - 60 and q.stat().st_size > 0:
                        return str(q)
                except OSError:
                    continue
        owner = (row.get("owner") or "").lower()
        if owner:
            try:
                for q in Path(src).parent.glob(owner + "*"):
                    if q.is_file() and q.suffix in (".log", ".jsonl") and q.stat().st_mtime >= created - 60 and q.stat().st_size > 0:
                        return str(q)
            except OSError:
                pass
    return None


# ---------------------------------------------------------------- check: the dead-man rule

def open_rows(rows, include_backfill=False):
    for r in rows.values():
        if r.get("line") is None or r.get("done") or r.get("dropped"):
            continue
        if r.get("backfill") == "1" and not include_backfill:
            continue
        try:
            r["created_ts"] = parse_iso(r["created"]) if r.get("created") else None
            r["due_ts"] = parse_iso(r["due"]) if r.get("due") else None
        except ValueError:
            r["created_ts"] = r.get("created_ts")
        yield r


def check(ledger=None, now=None, write=True):
    """One dead-man look at every open live row. Records ASK-START / ASK-DONE lines from evidence on disk, and returns the conditions:
    [(id, 'queued-2h'|'past-due-no-receipt', detail)]. Backfill rows are the baseline, not live work, and are never alarmed."""
    now = time.time() if now is None else now
    ledger = Path(ledger) if ledger else ledger_path()
    lines, status = read_lines(ledger)
    rows = parse_rows(lines)
    led = Ledger(lines, now) if any(True for _ in open_rows(rows)) else None
    appended, conditions = [], []
    hm = time.strftime("%H:%M", time.localtime(now))
    for r in open_rows(rows):
        created = r.get("created_ts")
        if created is None and led is not None and r.get("line") is not None:
            created = led.times[r["line"]]
        r["created_ts"] = created or now
        nouns = led.nouns(r.get("text", "")) if led else []
        rec, detail = receipt_state(r, nouns, now)
        if rec == "done":
            appended.append(f"- {hm} ASK-DONE {r['id']} receipt={detail.split(':', 1)[0] if ':' in detail and detail.startswith('/') else r['receipt']} auto=1")
            continue
        tag = probe_tag(r)
        ev = r.get("started") if tag else started_evidence(r, led, nouns, now)  # a probe row is started by its own line, never by evidence
        if ev and not r.get("started"):
            appended.append(f"- {hm} ASK-START {r['id']} evidence={ev} auto=1")
        if not ev and now - r["created_ts"] > QUEUED_S:
            conditions.append((r["id"], "queued-2h", f"{tag}owner={r.get('owner')} created={r.get('created')} :: {r.get('text', '')[:120]}"))
        due = r.get("due_ts")
        if due is not None and now > due and rec != "uncovered":
            why = {"missing": f"receipt {detail} not on disk", "pending": "no receipt named", "partial": f"receipt says partial ({detail[:100]})"}[rec]
            conditions.append((r["id"], "past-due-no-receipt", f"{tag}owner={r.get('owner')} due={r.get('due')} {why} :: {r.get('text', '')[:120]}"))
    if write:
        append_lines(ledger, appended)
    return {"ledger": str(ledger), "ledger_status": status, "open": sum(1 for _ in open_rows(rows)), "recorded": len(appended), "conditions": conditions}


def alert_conditions(conditions, home, alert, dedupe_path=None, now=None):
    """Each (id, condition) is alerted once, ever. All new pairs of one pass go out as one alert per condition, so a bad hour is one line, not a flood;
    the full list lands in the receipts file. Returns the pairs alerted this pass. A pair whose alert failed is not marked and is retried next pass."""
    now = time.time() if now is None else now
    dedupe_path = Path(dedupe_path or Path(home) / "asks-alerted.json")
    try:
        seen = json.loads(dedupe_path.read_text())
    except FileNotFoundError:
        seen = {}
    fresh = [(i, c, d) for i, c, d in conditions if f"{i}:{c}" not in seen]
    sent = []
    for i, c, d in fresh:  # a probe row is its own alert: the canary is proof the path works, a duty names the duty, so neither hides in a group
        text = probe_alert_text(i, c, d)
        if text and alert(c, text):
            seen[f"{i}:{c}"] = now
            sent.append((i, c))
    fresh = [(i, c, d) for i, c, d in fresh if not probe_alert_text(i, c, d)]
    for cond in ("queued-2h", "past-due-no-receipt"):
        group = [(i, d) for i, c, d in fresh if c == cond]
        if not group:
            continue
        listing = Path(home) / "receipts" / f"asks-{cond}-{time.strftime('%Y%m%d-%H%M', time.localtime(now))}.tsv"
        listing.parent.mkdir(parents=True, exist_ok=True)
        listing.write_text("".join(f"{i}\t{cond}\t{d}\n" for i, d in group))
        head = "; ".join(f"{i} {d[:90]}" for i, d in group[:3])
        word = "queued over 2 h with no start" if cond == "queued-2h" else "past due with no receipt on disk"
        text = f"{len(group)} ask row(s) {word}: {head}{' ...' if len(group) > 3 else ''} (all: {listing})"
        if alert(cond, text):
            for i, _ in group:
                seen[f"{i}:{cond}"] = now
                sent.append((i, cond))
    tmp = dedupe_path.with_name(f".{dedupe_path.name}.{os.getpid()}")
    dedupe_path.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(json.dumps(seen, sort_keys=True))
    os.replace(tmp, dedupe_path)
    return sent


def blind_step(st, watch, source, readable, alert, now=None):
    """One BLIND alert per blind episode: posted when `watch` first cannot read `source`, never again until the source is readable, then re-armed."""
    now = time.time() if now is None else now
    if readable:
        return "blind-cleared" if st.pop("blind", None) is not None else "readable"
    if st.get("blind") is not None:
        return "blind-already"
    if alert(f"BLIND {watch} cannot read {source}"):
        st["blind"] = now
        return "blind-alerted"
    return "blind-alert-failed"


def source_readable(pattern):
    """A watch can read its source when the file opens and reads or the folder lists; a glob needs its newest match readable. Missing is not readable."""
    p = os.path.expanduser(pattern)
    if any(c in p for c in "*?["):
        found = []
        for m in glob.glob(p):
            try:
                found.append((os.stat(m).st_mtime, m))
            except OSError:
                pass
        if not found:
            return False
        p = max(found)[1]
    try:
        if os.path.isdir(p):
            os.listdir(p)
        else:
            with open(p, "rb") as f:
                f.read(1)
        return True
    except OSError:
        return False


def blind_watches(home, state, notify, test=False, now=None, sources=None):
    """One BLIND alert per (watch, source) episode for each row of <home>/watch-sources.tsv (watch<TAB>source).
    No list is "unconfigured", said in the receipt; a list that exists but cannot be read is itself BLIND."""
    path = sources or os.path.join(str(home), "watch-sources.tsv")
    st = state.setdefault("blind", {})
    alert = lambda text: notify.alert(home, "watch-blind", text, test=test)
    if not os.path.lexists(path):
        return "blind unconfigured", False
    try:
        with open(path) as f:
            rows = [l.rstrip("\n").split("\t") for l in f if l.strip() and not l.startswith(("#", "watch\t"))]
    except OSError:
        w = blind_step(st.setdefault("watch-sources", {}), "asks-blind", path, False, alert, now)
        return f"blind {w}", w == "blind-alert-failed"
    blind_step(st.setdefault("watch-sources", {}), "asks-blind", path, True, alert, now)
    words = {}
    for r in rows:
        if len(r) < 2:
            words["bad-row"] = words.get("bad-row", 0) + 1
            continue
        w = blind_step(st.setdefault(f"{r[0]}\t{r[1]}", {}), r[0], r[1], source_readable(r[1]), alert, now)
        words[w] = words.get(w, 0) + 1
    return "blind " + " ".join(f"{k}={v}" for k, v in sorted(words.items())), bool(words.get("blind-alert-failed") or words.get("bad-row"))


def deadman_pass(home, state, notify, test=False, now=None):
    """What lane_deadman.py runs every cycle. Returns (status word, failed?). The M4 also watches both Macs' canaries for a miss."""
    blind, blind_failed = blind_watches(home, state, notify, test, now)
    status, failed = _asks_pass(home, state, notify, test, now)
    watch = local_host() == "m4" and not under_test()  # under test the real Macs are never read; tests call canary_watch with fixture hosts
    canary, canary_failed = canary_watch(home, state, notify, test, now) if watch else ("", False)
    return f"{status} {blind}{' ' + canary if canary else ''}", failed or blind_failed or canary_failed


def _asks_pass(home, state, notify, test, now):
    st = state.setdefault("asks", {})
    led = ledger_path(home)
    send = lambda trigger, text: notify.alert(home, f"ask-{trigger}", f"Ask rows: {text}", test=test)
    try:
        result = check(led, now=now)
    except OSError as e:
        b = blind_step(st, "asks-check", led, False, lambda text: notify.alert(home, "ask-blind", text, test=test), now)
        return f"{b} ({type(e).__name__})", b == "blind-alert-failed"
    b = blind_step(st, "asks-check", led, True, None, now)
    sent = alert_conditions(result["conditions"], home, send, now=now)
    st["last"] = {"open": result["open"], "recorded": result["recorded"], "conditions": len(result["conditions"]), "alerted": len(sent), "ledger": result["ledger_status"]}
    return f"asks open={result['open']} recorded={result['recorded']} conditions={len(result['conditions'])} alerted={len(sent)} ledger={result['ledger_status']}{' ' + b if b == 'blind-cleared' else ''}", False


# ---------------------------------------------------------------- canary, the daily report duty, and the report itself

CANARY_GRACE_S = 15 * 60       # a canary is on time when its first alert lands within 15 min after the 2 h threshold
CANARY_MISS_S = 30 * 60        # not flagged 30 min after due is itself a real alert to Steve
REPORT_TO = "steve@builder.io"  # the only recipient, ever; send_report refuses any other list
REPORT_DUTY = "fleet-asks-report"
REPORT_LABEL = "com.steve.re.fleet-asks-report"
DUTY_TITLES = {REPORT_DUTY: "Fleet asks report"}
M5_SSH = "Steves-MacBook-Pro.local"
HOSTS = {  # where each Mac's ledger-reading copy of this file and its dead-man home live
    "m4": {"node": "Steves-MacBook-Pro-2", "asks": None, "home": None},
    "m5": {"node": "Steves-MacBook-Pro", "asks": "/Users/steve/m5-jobs/pool/asks.py", "home": "/Users/steve/m5-jobs/lane-deadman"},
}
FLEET_MAILER = Path.home() / ".config/replica-workers/bin/fleet-mail"  # none exists yet (11/15): the send step reports blocked until one does


def local_host():
    node = os.uname().nodename.split(".")[0]
    return next((h for h, v in HOSTS.items() if v["node"] == node), node)


def host_home(host):
    return Path(HOSTS[host]["home"]) if HOSTS.get(host, {}).get("home") else REPLICA_HOME / "lane-deadman"


def ask_rows_dir():
    return Path(os.environ.get("ASKS_ROWS_DIR") or REPLICA_HOME / "jobs-1115/ask-rows")


def probe_tag(row):
    """'canary=1 ' or 'duty=<name> ' for a probe row (the dead-man's own test row, or a scheduled duty), '' for a real ask."""
    if row.get("canary") == "1":
        return "canary=1 "
    if row.get("duty"):
        return f"duty={row['duty']} "
    return ""


def probe_alert_text(rid, cond, detail):
    """The alert text for one probe row's condition, or None for a real ask. A canary alert carries canary=1, which notify.py keeps off Telegram."""
    if detail.startswith("canary=1 "):
        return f"canary=1 {rid} {cond}: {detail[len('canary=1 '):]}"
    m = re.match(r"duty=(\S+) (.*)$", detail)
    if m:
        date = re.search(r"(\d{4})(\d\d)(\d\d)$", rid)
        day = f"{date.group(1)}-{date.group(2)}-{date.group(3)}" if date else "?"
        return f"{DUTY_TITLES.get(m.group(1), m.group(1))} not sent {day} ({rid} {cond}: {m.group(2)[:160]})"
    return None


def day_stamp(ts):
    return time.strftime("%Y%m%d", time.localtime(ts))


def canary_id(host, ts):
    return f"canary-{host}-{day_stamp(ts)}"


def plant_canary(host, ledger=None, now=None):
    """Append today's canary row for `host` unless it is already there. The row has no owner action, so the dead-man must flag it at 2 h."""
    now = time.time() if now is None else now
    ledger = Path(ledger) if ledger else ledger_path()
    lines, _ = read_lines(ledger)
    rid = canary_id(host, now)
    if rid in parse_rows(lines):
        return {"id": rid, "planted": False}
    stamp = lambda ts: time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ts))
    append_lines(ledger, [f"- {time.strftime('%H:%M', time.localtime(now))} ASK {rid} owner=canary due={stamp(now + QUEUED_S)} receipt=pending canary=1 "
                          f"source=canary:{host} created={stamp(now)} :: dead-man canary for {host}: no owner action; the dead-man must flag it at 2 h"])
    return {"id": rid, "planted": True, "created": stamp(now), "due": stamp(now + QUEUED_S)}


def drop_row(rid, reason, ledger=None, now=None):
    now = time.time() if now is None else now
    ledger = Path(ledger) if ledger else ledger_path()
    rows = parse_rows(read_lines(ledger)[0])
    if rid not in rows or rows[rid].get("dropped") or rows[rid].get("done"):
        return False
    append_lines(ledger, [f"- {time.strftime('%H:%M', time.localtime(now))} ASK-DROP {rid} reason={reason}"])
    return True


def _alert_ts(record):
    try:
        return datetime.strptime(record["ts"], "%Y-%m-%dT%H:%M:%S%z").timestamp()
    except (KeyError, ValueError):
        return None


def canary_status(host, day, ledger=None, home=None):
    """This Mac's view of one canary: its row and every canary=1 alert notify.py logged for it. Read-only; an unreadable alert log raises."""
    ledger = Path(ledger) if ledger else ledger_path()
    rid = f"canary-{host}-{day}"
    row = parse_rows(read_lines(ledger)[0]).get(rid)
    alerts = []
    log = Path(home or host_home(host)) / "alerts.jsonl"
    try:
        text = log.read_text(errors="replace")
    except FileNotFoundError:
        text = ""
    for line in text.splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("canary") and rid in str(rec.get("text", "")):
            alerts.append(rec)
    keep = ("created", "due", "started", "done", "dropped", "line")
    return {"host": host, "id": rid, "row": {k: row.get(k) for k in keep} if row and row.get("line") is not None else None, "alerts": alerts}


def judge_canary(status, now=None):
    """verdict ok (flagged within 15 min after the 2 h threshold or due), late, early, pending, missed (not flagged 30 min after due), or not-planted."""
    now = time.time() if now is None else now
    row = status.get("row")
    out = {"host": status["host"], "id": status["id"], "planted_at": None, "due": None, "flagged_at": None, "on_time": False, "alert": None}
    if not row:
        return dict(out, verdict="not-planted")
    planted, due = parse_iso(row["created"]), parse_iso(row["due"])
    threshold = min(planted + QUEUED_S, due)
    flags = sorted(((t, r) for r in status.get("alerts", []) for t in [_alert_ts(r)] if t is not None), key=lambda x: x[0])
    out.update(planted_at=row["created"], due=row["due"])
    if flags:
        t, rec = flags[0]
        out.update(flagged_at=time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(t)), alert=rec, lag_s=round(t - threshold))
        out["on_time"] = 0 <= t - threshold <= CANARY_GRACE_S
        out["verdict"] = "ok" if out["on_time"] else ("early" if t < threshold else "late")
    elif now > due + CANARY_MISS_S:
        out["verdict"] = "missed"
    else:
        out["verdict"] = "pending"
    return out


def _ssh(args, timeout=60, stdin=None):
    import subprocess
    return subprocess.run(["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", M5_SSH] + args, input=stdin,
                          capture_output=True, text=True, timeout=timeout)


def on_host(host, argv, timeout=60):
    """Run this tool's own subcommand on `host` and parse its JSON. The M4 runs locally; the M5 through ssh with the M5's own copy. Failure raises."""
    if host == local_host():
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = main(argv)
        if rc != 0:
            raise RuntimeError(f"{' '.join(argv)} exit {rc}")
        return json.loads(buf.getvalue().strip().splitlines()[-1])
    done = _ssh(["/usr/bin/python3", "-I", HOSTS[host]["asks"]] + argv, timeout=timeout)
    if done.returncode != 0:
        raise RuntimeError(f"{host} {' '.join(argv[:2])} ssh exit {done.returncode}: {done.stderr.strip()[-160:]}")
    return json.loads(done.stdout.strip().splitlines()[-1])


def canary_watch(home, state, notify, test=False, now=None, hosts=("m4", "m5"), status_of=None):
    """The M4 dead-man's look at both Macs' canaries (the M5's over ssh, read-only). A canary not flagged 30 min after its due time is a real alert to
    Steve, once per canary. A Mac whose canary cannot be read is one BLIND alert, never 'no canary'."""
    now = time.time() if now is None else now
    st = state.setdefault("canary", {})
    status_of = status_of or (lambda host, days: on_host(host, ["canary", "status", "--host", host, "--date", ",".join(days)])["statuses"])
    words, failed = [], False
    for host in hosts:
        try:
            statuses = status_of(host, [day_stamp(now), day_stamp(now - 86400)])
        except Exception as e:  # noqa: BLE001 - any read failure is this watch going blind on that Mac
            b = blind_step(st.setdefault(f"blind-{host}", {}), "canary-watch", f"{host} canary rows", False,
                           lambda text: notify.alert(home, "canary-blind", text, test=test), now)
            words.append(f"{host}:{b}")
            failed = failed or b == "blind-alert-failed"
            continue
        blind_step(st.setdefault(f"blind-{host}", {}), "canary-watch", f"{host} canary rows", True, None, now)
        for s in statuses:
            day = s["id"].rsplit("-", 1)[1]
            if not s.get("row") or s["row"].get("dropped"):
                continue
            v = judge_canary(s, now)
            words.append(f"{host}-{day}:{v['verdict']}")
            if v["verdict"] == "missed" and not st.get(s["id"]):
                sentence = f"Check the fleet dead-man: canary missed on {host.upper()}, no alert {CANARY_MISS_S // 60} min after due."
                if notify.alert(home, "steve-action", sentence, test=test):
                    st[s["id"]] = now
                else:
                    failed = True
    return ("canary " + " ".join(words)) if words else "canary none", failed


def verify_canary(host, day, out_dir=None, now=None, status_of=None, drop=None):
    """Write canary-<host>-<date>.json (planted_at, due, flagged_at, on_time, the alert line), then close a judged canary with ASK-DROP. A pending
    canary is written as pending and left open."""
    now = time.time() if now is None else now
    status_of = status_of or (lambda h, d: on_host(h, ["canary", "status", "--host", h, "--date", d])["statuses"][0])
    drop = drop or (lambda h, rid, reason: on_host(h, ["canary", "drop", "--host", h, "--id", rid, "--reason", reason]))
    v = judge_canary(status_of(host, day), now)
    v.update(checked_at=time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now)), date=day)
    out = Path(out_dir or ask_rows_dir()) / f"canary-{host}-{day}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(v, indent=1, sort_keys=True) + "\n")
    if v["verdict"] in ("ok", "late", "early", "missed"):
        drop(host, v["id"], "canary-verified" if v["flagged_at"] else "canary-missed")
    v["receipt"] = str(out)
    return v


def duty_id(ts):
    return f"asks-report-{day_stamp(ts)}"


def plant_duty(day_ts, ledger=None, now=None, daily_dir=None):
    """The report duty as an ASK row: due 08:30 that day, receipt = that day's .sent.json. Planted a day ahead, so a cron that never fires is still
    flagged. Its ASK-START is written with it: the duty is scheduled, so only past-due-no-receipt can fire."""
    now = time.time() if now is None else now
    ledger = Path(ledger) if ledger else ledger_path()
    rid = duty_id(day_ts)
    if rid in parse_rows(read_lines(ledger)[0]):
        return False
    d = datetime.fromtimestamp(day_ts).date()
    receipt = Path(daily_dir or ask_rows_dir() / "daily") / f"{d.isoformat()}.sent.json"
    hm = time.strftime("%H:%M", time.localtime(now))
    append_lines(ledger, [f"- {hm} ASK {rid} owner={REPORT_DUTY} due={d.isoformat()}T08:30 receipt={receipt} duty={REPORT_DUTY} "
                          f"source=launchd:{REPORT_LABEL} created={d.isoformat()}T08:00 :: send the Fleet asks report for {d.isoformat()}",
                          f"- {hm} ASK-START {rid} evidence=scheduled:{REPORT_LABEL}"])
    return True


def flagged_rows(alerted, since):
    """Real ask rows the dead-man flagged since `since`, from an asks-alerted.json map ({'<id>:<condition>': epoch}). Probe rows are left out."""
    out = []
    for key, ts in sorted(alerted.items(), key=lambda kv: kv[1]):
        rid, _, cond = key.rpartition(":")
        if ts >= since and not rid.startswith(("canary-", "asks-report-")):
            out.append((rid, cond, ts))
    return out


OVERNIGHT_DIR = Path("/Users/steve/Projects/builder/agent-native/.tmp/replica-home/jobs-1115/OVERNIGHT")
_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
_SECRET_RE = re.compile(r"(?i)\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|credential)\b(\s*[:=]\s*)[^\s,;]+")
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")


def _safe_overnight_line(value):
    value = _EMAIL_RE.sub("[email redacted]", value)
    value = _SECRET_RE.sub(lambda m: m.group(0).split(m.group(1), 1)[0] + m.group(1) + "[redacted]", value)
    return _BEARER_RE.sub("Bearer [redacted]", value)


def overnight_section(directory=OVERNIGHT_DIR):
    """Render hourly checks and the coordinator queue, preserving source order."""
    directory = Path(directory)
    lines = ["Overnight checks"]
    hourly = directory / "coordinator-hourly.tsv"
    try:
        with hourly.open(newline="") as source:
            rows = list(csv.reader(source, delimiter="\t"))
        if not rows:
            raise ValueError("empty hourly table")
        headers = rows[0]
        lines.extend(
            "- " + _safe_overnight_line("; ".join(f"{name}={value}" for name, value in zip(headers, row)))
            for row in rows[1:] if row
        )
    except (OSError, UnicodeError, csv.Error, ValueError):
        lines.append(f"- unreadable: {hourly}")
    queue = directory / "QUEUE.md"
    try:
        content = queue.read_text()
        lines.extend(["", "Overnight queue", *(_safe_overnight_line(line) for line in content.splitlines())])
    except (OSError, UnicodeError):
        lines.extend(["", "Overnight queue", f"unreadable: {queue}"])
    return lines


def build_report(day, dropped, flagged, canaries, trend, first_run=False, errors=(), overnight=()):
    """(subject, body). dropped: audit() result; flagged: {host: [(id, cond, ts)]}; canaries: {host: judge_canary result}; trend: (now, baseline)."""
    word = lambda v: "ok" if v and v.get("verdict") == "ok" else ("pending" if v and v.get("verdict") in ("pending", "not-planted") and first_run else "MISSED")
    n_flag = sum(len(v) for v in flagged.values())
    subject = (f"Fleet asks report {day}{' (first run)' if first_run else ''}: {dropped['dropped']} dropped, {n_flag} flagged, "
               f"canary M4 {word(canaries.get('m4'))}, M5 {word(canaries.get('m5'))}")
    body = [subject, ""]
    if overnight:
        body += ["Overnight", *overnight, ""]
    body += ["Fleet asks",
            f"1. Asks dropped in the last 24 h: {dropped['dropped']} (never a row {len(dropped['never_rowed'])}, never started "
            f"{len(dropped['never_started'])}, past due {len(dropped['past_due'])}, NOTE asks unanswered {len(dropped['notes_dropped'])})"]
    sample = [f"   {a['id']} {norm(a.get('text', ''))[:90]}" for a in (dropped["never_rowed"] + dropped["never_started"] + dropped["past_due"])[:4]]
    body += sample
    body.append(f"2. Stalled rows the dead-man flagged (24 h): {n_flag}")
    for host in ("m4", "m5"):
        rows = flagged.get(host, [])
        if rows:
            body.append(f"   {host.upper()}: " + ", ".join(f"{i} {c}" for i, c, _ in rows[:3]) + (f" (+{len(rows) - 3} more)" if len(rows) > 3 else ""))
    body.append("3. Canary caught on both Macs:")
    for host in ("m4", "m5"):
        v = canaries.get(host) or {"verdict": "not-planted"}
        if v.get("flagged_at"):
            detail = f"flagged {v['flagged_at'][11:16]}, {v.get('lag_s', 0) // 60} min after the 2 h mark"
        else:
            detail = {"pending": f"planted {str(v.get('planted_at'))[11:16]}, due {str(v.get('due'))[11:16]}, not yet judged",
                      "not-planted": "no canary was planted for this day", "missed": "no alert 30 min after due"}.get(v["verdict"], v["verdict"])
        body.append(f"   {host.upper()}: {word(v)} ({v['verdict']}; {detail})")
    now_rate, base = trend
    delta = f"{(now_rate - base) / base * 100:+.0f}%" if base else "n/a"
    base = base if base is not None else "unreadable"
    body += ["", f"Trend: asks dropped per day {now_rate} now vs {base} in the 48 h baseline ({delta})."]
    body.append(f"Files: {ask_rows_dir()}/daily/{day}.md")
    if errors:
        body.append("Errors: " + "; ".join(errors)[:300])
    return subject, "\n".join(body if overnight else body[:25]) + "\n"


def under_test():
    return "PYTEST_CURRENT_TEST" in os.environ or "pytest" in sys.modules or "unittest" in " ".join(sys.argv[:3])


def find_mailer():
    """The fleet's outbound mailer, or None. Never under test: a test that reached a real mailer could mail Steve."""
    if under_test():
        return None
    if FLEET_MAILER.is_file() and os.access(FLEET_MAILER, os.X_OK):
        import subprocess

        def run(to, subject, body):
            done = subprocess.run([str(FLEET_MAILER), "--to", to, "--subject", subject], input=body, capture_output=True, text=True, timeout=120)
            lines = done.stdout.strip().splitlines()
            if not lines:
                raise RuntimeError(f"fleet-mail exit {done.returncode} without a JSON result")
            reply = json.loads(lines[-1])
            if done.returncode != 0 and not reply.get("error"):
                raise RuntimeError(f"fleet-mail exit {done.returncode}")
            return reply
        return run
    return None


def send_report(day, subject, body, mailer, daily_dir=None, ledger=None, now=None, to=(REPORT_TO,)):
    """Send through the fleet mailer and write <date>.sent.json with its response id, the receipt the report duty checks. No mailer, a failed send, or
    a reply with no id writes <date>.unsent.json instead and returns sent False: the duty row then goes past due and the dead-man alerts."""
    now = time.time() if now is None else now
    if list(to) != [REPORT_TO]:
        raise ValueError("the asks report goes to one recipient only")
    daily_dir = Path(daily_dir or ask_rows_dir() / "daily")
    daily_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now))
    reason = None
    reply = None
    if mailer is None:
        reason = f"no fleet mailer: nothing at {FLEET_MAILER} and no other fleet script sends mail"
    else:
        for attempt in range(2):
            try:
                reply = mailer(REPORT_TO, subject, body)
                rid = reply.get("id") if isinstance(reply, dict) else None
                if rid:
                    reason = None
                    break
                error = reply.get("error") if isinstance(reply, dict) else None
                reason = f"send failed: {error or 'mailer reply has no response id'}"
            except Exception as e:  # noqa: BLE001 - failed sends are typed and retried once
                reason = f"send failed: {type(e).__name__}"
    if reason:
        failure = {"date": day, "at": stamp, "subject": subject, "reason": reason, "attempts": 2}
        if isinstance(reply, dict):
            failure["http_status"] = reply.get("http_status")
            failure["next_step"] = reply.get("next_step")
        (daily_dir / f"{day}.unsent.json").write_text(json.dumps(failure, indent=1) + "\n")
        rid_row = f"asks-report-{day.replace('-', '')}"
        ledger_path_value = Path(ledger) if ledger else ledger_path()
        if rid_row in parse_rows(read_lines(ledger_path_value)[0]):
            append_lines(ledger_path_value, [f"- {time.strftime('%H:%M', time.localtime(now))} ASK-DROP {rid_row} reason=send-failed-after-one-retry:{reason.replace(' ', '_')[:100]}"])
        result = {"sent": False, "reason": reason, "attempts": 2}
        if isinstance(reply, dict):
            result["http_status"] = reply.get("http_status")
            result["next_step"] = reply.get("next_step")
        return result
    receipt = daily_dir / f"{day}.sent.json"
    receipt.write_text(json.dumps({"date": day, "sent_at": stamp, "to": REPORT_TO, "subject": subject, "response_id": rid, "http_status": reply.get("http_status")}, indent=1) + "\n")
    rid_row = f"asks-report-{day.replace('-', '')}"
    if rid_row in parse_rows(read_lines(Path(ledger) if ledger else ledger_path())[0]):
        append_lines(Path(ledger) if ledger else ledger_path(), [f"- {time.strftime('%H:%M', time.localtime(now))} ASK-DONE {rid_row} receipt={receipt}"])
    return {"sent": True, "receipt": str(receipt), "response_id": rid}


def _read_alerted(host):
    path = host_home(host) / "asks-alerted.json"
    if host == local_host():
        try:
            return json.loads(path.read_text())
        except FileNotFoundError:
            return {}
    done = _ssh(["cat", str(path)])
    if done.returncode != 0:
        raise RuntimeError(f"{host} asks-alerted.json unreadable (ssh exit {done.returncode})")
    return json.loads(done.stdout or "{}")


def daily(now=None, first_run=False, mailer="find", hosts=("m4", "m5")):
    """The 08:00 step: verify yesterday's canaries, plant today's, keep the report duty rows planted ahead, build the report, write it, send it."""
    now = time.time() if now is None else now
    day = time.strftime("%Y-%m-%d", time.localtime(now))
    out = {"date": day, "canaries": {}, "planted": {}, "errors": []}
    canaries = {}
    for host in hosts:
        try:
            canaries[host] = verify_canary(host, day_stamp(now - 86400), now=now)
        except Exception as e:  # noqa: BLE001
            canaries[host] = {"verdict": "unreadable", "error": f"{type(e).__name__}: {str(e)[:120]}"}
            out["errors"].append(f"verify {host}: {canaries[host]['error']}")
        try:
            out["planted"][host] = on_host(host, ["canary", "plant", "--host", host])
            if first_run and canaries[host].get("verdict") == "not-planted":  # nothing to verify yet: show today's, pending
                canaries[host] = judge_canary(on_host(host, ["canary", "status", "--host", host, "--date", day_stamp(now)])["statuses"][0], now)
        except Exception as e:  # noqa: BLE001
            out["errors"].append(f"plant {host}: {type(e).__name__}: {str(e)[:120]}")
    for k in range(3):
        plant_duty(now + k * 86400, now=now)
    flagged = {}
    for host in hosts:
        try:
            flagged[host] = flagged_rows(_read_alerted(host), now - 86400)
        except Exception as e:  # noqa: BLE001
            flagged[host] = []
            out["errors"].append(f"flagged {host}: {type(e).__name__}: {str(e)[:120]}")
    dropped = audit(since=now - 86400, now=now)
    try:
        base = json.loads((ask_rows_dir() / "metrics.json").read_text())["dropped_per_day"]
    except (OSError, ValueError, KeyError):
        base = None
    subject, body = build_report(day, dropped, flagged, canaries, (dropped["dropped_per_day"], base), first_run=first_run,
                                 errors=out["errors"], overnight=overnight_section())
    daily_dir = ask_rows_dir() / "daily"
    daily_dir.mkdir(parents=True, exist_ok=True)
    (daily_dir / f"{day}.md").write_text(f"Subject: {subject}\n\n{body}")
    sent = send_report(day, subject, body, find_mailer() if mailer == "find" else mailer, now=now)
    out.update(subject=subject, report=str(daily_dir / f"{day}.md"), send=sent, canaries={h: v.get("verdict") for h, v in canaries.items()})
    return out


# ---------------------------------------------------------------- sources for audit and backfill

REPLICA_HOME = Path.home() / "Projects/builder/agent-native/.tmp/replica-home"
SKIP_PARTS = ("/repo/", "/wt/", "/node_modules/", "/.git/", "/wt.noindex/", "/study/", "/rebase-revert-fixture/", "/fixtures/", "/tests/")
GENERATED = re.compile(r"/(?:archive-lane[^/]*/)?(?:lane-|pool-|m5td-|m5mob-|held-pitch|p0-|rv-|cl2?-spec-|cx-spec-|qa-v\d)")


def brief_kind(path):
    return "pool-brief" if GENERATED.search(str(path)) else "brief"


def discover_files(roots, since):
    """(path, kind) for brief, inbox and request files modified since `since` under the configured roots."""
    out = []
    for root, pattern, kind in roots:
        root = Path(root).expanduser()
        if not root.exists():
            continue
        for p in root.glob(pattern):
            s = str(p)
            if any(part in s for part in SKIP_PARTS) or "template" in p.name.lower() or not p.is_file():
                continue
            try:
                if p.stat().st_mtime < since:
                    continue
            except OSError:
                continue
            out.append((p, brief_kind(p) if kind == "brief" else kind))
    seen, uniq = set(), []
    for p, k in out:
        if str(p) not in seen:
            seen.add(str(p))
            uniq.append((p, k))
    return uniq


def default_roots():
    h = REPLICA_HOME
    return [
        (h / "jobs-1114", "*BRIEF*.md", "brief"), (h / "jobs-1114", "*/*BRIEF*.md", "brief"),
        (h / "jobs-1115", "*BRIEF*.md", "brief"), (h / "jobs-1115", "*/*BRIEF*.md", "brief"),
        (h, "assign-*.md", "brief"), (h, "BRIEF-*.md", "brief"),
        (Path.home() / "Projects/re/lane-inbox", "**/*", "inbox"),
        (Path.home() / "Projects/re", "*-clean-room/*.md", "request"),
        (Path.home() / "m5-jobs", "*/BRIEF*.md", "brief"), (Path.home() / "m5-jobs", "*/*/BRIEF*.md", "brief"),
        (Path.home() / "m5-jobs", "INBOX*", "inbox"), (Path.home() / "m5-jobs", "*/INBOX*", "inbox"),
    ]


def transcript_roots():
    return [Path.home() / ".claude/projects", Path.home() / ".config/replica-workers/claude-personal/projects"]


def codex_roots():
    return [Path.home() / ".codex/sessions", Path.home() / ".config/replica-workers/codex-personal/sessions"]


CSM = re.compile(r"<cross-session-message\b([^>]*)>(.*?)</cross-session-message>", re.S)
SEND_TOOLS = {"SendMessage", "mcp__ccd_session_mgmt__send_message", "send_message", "send_message_to_thread"}


def _ts(value):
    try:
        return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S").timestamp() + (0 if not value.endswith("Z") else -time.timezone if time.localtime().tm_isdst == 0 else -time.altzone)
    except (ValueError, TypeError):
        return None


def _msg_text(inp):
    if isinstance(inp, str):
        try:
            inp = json.loads(inp)
        except ValueError:
            return inp, None
    if not isinstance(inp, dict):
        return None, None
    to = inp.get("to") or inp.get("session_id") or inp.get("thread_id") or inp.get("target")
    best = max((v for k, v in inp.items() if isinstance(v, str) and k in ("message", "input", "text", "prompt", "content", "body")), key=len, default=None)
    return best, to


def discover_messages(since, claude_roots=None, codex_dirs=None):
    """Cross-session messages since `since`: sent (SendMessage / session send_message tool inputs) and received (<cross-session-message> blocks).
    The same message seen from both ends has one msg id. Returns [{key, text, to, ts, file}]."""
    out, seen = [], set()

    def add(text, to, ts, f):
        if not text or len(text) < 20:
            return
        k = msg_key(text)
        if k in seen:
            return
        seen.add(k)
        out.append({"key": k, "text": text, "to": to, "ts": ts, "file": str(f)})

    for root in claude_roots if claude_roots is not None else transcript_roots():
        for f in Path(root).glob("*/*.jsonl"):
            try:
                if f.stat().st_mtime < since:
                    continue
                stream = f.open("r", errors="replace")
            except OSError:
                continue
            with stream:
                for line in stream:
                    if "send_message" not in line and "SendMessage" not in line and "cross-session-message" not in line:
                        continue
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    ts = _ts(rec.get("timestamp") or "") or f.stat().st_mtime
                    if ts < since:
                        continue
                    content = (rec.get("message") or {}).get("content")
                    items = content if isinstance(content, list) else [{"type": "text", "text": content}] if isinstance(content, str) else []
                    for it in items:
                        if not isinstance(it, dict):
                            continue
                        if it.get("type") == "tool_use" and it.get("name") in SEND_TOOLS:
                            text, to = _msg_text(it.get("input"))
                            add(text, to, ts, f)
                        elif it.get("type") == "text" and "cross-session-message" in (it.get("text") or ""):
                            for m in CSM.finditer(it["text"]):
                                add(m.group(2).strip(), "session:" + f.stem[:8], ts, f)
                        elif it.get("type") == "tool_result":
                            pass
    for root in codex_dirs if codex_dirs is not None else codex_roots():
        for f in Path(root).glob("**/*.jsonl"):
            try:
                if f.stat().st_mtime < since:
                    continue
                stream = f.open("r", errors="replace")
            except OSError:
                continue
            with stream:
                for line in stream:
                    if '"function_call"' not in line or "send_message" not in line:
                        if "cross-session-message" not in line:
                            continue
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    ts = _ts(rec.get("timestamp") or "") or f.stat().st_mtime
                    if ts < since:
                        continue
                    pl = rec.get("payload") or {}
                    if pl.get("type") == "function_call" and pl.get("name") in SEND_TOOLS:
                        text, to = _msg_text(pl.get("arguments"))
                        add(text, to, ts, f)
                    elif "cross-session-message" in line:
                        blob = json.dumps(pl)
                        for m in CSM.finditer(json.loads(json.dumps(blob))):
                            add(m.group(2).replace("\\n", "\n").strip(), "codex:" + f.stem[-12:], ts, f)
    return out


NOTE_TO = re.compile(r"^(?:- )?\d\d:\d\d NOTE (?P<author>\S+)(?: [\w/-]+)? to (?P<to>[A-Za-z0-9][\w./-]*)")
PLEASE_OWNER = re.compile(r"(?:^|[\s(;,.])(?P<o>[A-Z][A-Z0-9-]{2,}|[a-z0-9]+-[a-z0-9-]+)\s+please\b")


def ledger_note_asks(lines, times, since, ledger_file):
    """NOTE lines addressed `to <lane>` or carrying `please`: the please-sentence (or the note) is the ask, the addressee is the owner."""
    out = []
    for n, line in enumerate(lines):
        if times[n] is None or times[n] < since or " NOTE " not in line[:12] and not line.startswith(("- ",)):
            continue
        if not re.match(r"^(?:- )?\d\d:\d\d NOTE ", line):
            continue
        m = NOTE_TO.match(line)
        low = line.lower()
        if not m and "please" not in low:
            continue
        body = line.split(" NOTE ", 1)[1]
        sents = [s for s in _sentences(body) if "please" in s.lower()] or [body]
        for s in sents[:3]:
            p = PLEASE_OWNER.search(s)
            owner = (m.group("to") if m else None) or (p.group("o") if p else None) or "unaddressed"
            due = parse_due(s, times[n])
            out.append({"id": ask_id(f"{ledger_file}:{n + 1}", s), "owner": owner.rstrip(":,."), "text": _clean(s)[:MAX_TEXT], "created_ts": times[n],
                        "due_ts": due, "due": iso(due), "receipt": "pending", "source": f"{ledger_file}:{n + 1}", "kind": "ledger-note", "source_path": None,
                        "note_line": n})
    return out


# ---------------------------------------------------------------- classification (backfill and audit share it)

CLASSES = ("rowed+started+receipted", "rowed-never-started", "never-rowed", "past-due-no-receipt", "unclear")
DROPPED = ("never-rowed", "rowed-never-started", "past-due-no-receipt")


def classify(a, led, rows, now, local_only=False):
    """The oracle for one ask. Returns (class, evidence dict). `rowed`: an owner-bearing row exists (its own ASK row; for a brief step, the launched job
    that owns it; for a message, a ledger line that took it up; a ledger NOTE is already a row). `started`/`receipted` come from ledger lines naming the
    owner and the ask's nouns, the job's report and the files the ask names. Undecidable is `unclear`, never done."""
    ev = {}
    nouns = led.nouns(a["text"]) if led else [t for t in dict.fromkeys(_tokens(a["text"])) if len(t) >= 4][:6]
    ev["nouns"] = ",".join(nouns)
    created, due = a["created_ts"], a["due_ts"]
    ov = owner_variants(a["owner"])
    row = rows.get(a["id"]) if rows else None
    rowed = None
    if row and row.get("line") is not None and row.get("backfill") != "1":
        rowed = f"ledger-row:{row['line'] + 1}"
    if a["kind"] == "ledger-note":
        rowed = rowed or f"ledger-note:{a['note_line'] + 1}"
    src = a.get("source_path")
    if not rowed and a["kind"] in ("brief", "pool-brief") and src:
        for d in out_dirs(src, ""):
            for name in ("STARTED", "VERDICT", "REPORT.md", "RESULT.md", "out.md", "run.log", "CLAIM.json"):
                if (d / name).exists():
                    rowed = f"job:{d / name}"
                    break
            if rowed:
                break
        if not rowed and led:
            n = led.owner_seen(ov, created)
            if n is not None:
                rowed = f"ledger:{n + 1}"
        if not rowed:
            try:
                logs = [q for q in list(Path(src).parent.glob(a["owner"].lower() + "*")) + list(Path(src).parent.glob(a["owner"] + "*"))
                        if q.is_file() and "brief" not in q.name.lower() and q.stat().st_mtime >= created - 60]
            except OSError:
                logs = []
            if logs:
                rowed = f"job-file:{logs[0]}"
    if not rowed and a["kind"] in ("message", "inbox", "request") and led:
        h = led.hits([], nouns, created, max(3, need_for(nouns))) if len(nouns) >= 3 else []
        if h:
            rowed = f"ledger:{h[0] + 1}"
    ev["rowed"] = rowed or ""
    started = None
    if led:
        h = led.hits(ov, nouns, created, max(1, min(2, len(nouns)))) if ov else led.hits([], nouns, created, max(3, need_for(nouns))) if len(nouns) >= 3 else []
        if a["kind"] == "ledger-note":
            h = [x for x in h if x != a["note_line"]]
        if h:
            started = f"ledger:{h[0] + 1}"
    rec_state, rec_detail = "pending", ""
    if a.get("receipt") and a["receipt"] != "pending":
        rec_state, rec_detail = receipt_state(a, nouns, num=a.get("num"))
    if rec_state in ("missing", "pending") and src:
        for d in out_dirs(src, ""):
            for name in ("REPORT.md", "RESULT.md"):
                q = d / name
                if q.exists() and str(q) != a.get("receipt"):
                    st, para = covers(q, nouns, num=a.get("num"))
                    if st:
                        rec_state, rec_detail = st, f"{q}: {para}"
                        break
            if rec_state in ("done", "partial"):
                break
    if rec_state in ("missing", "pending") and led and nouns and (ov or len(nouns) >= 3):
        h = led.hits(ov, nouns, created, max(2 if ov else 3, need_for(nouns)), verbs="DONE|LANDED|RESULT")
        if h:
            rec_state, rec_detail = "done", f"ledger:{h[0] + 1}"
    if rec_state in ("done", "partial") and not started:
        started = rec_detail.split(":", 1)[0] if rec_detail.startswith("/") else rec_detail
    if not started and src and a["kind"] in ("brief", "pool-brief"):
        started = started_evidence({"owner": a["owner"], "created_ts": created, "source": src + ":1"}, None, nouns, now)
    ev.update(started=started or "", receipt=rec_state, receipt_evidence=rec_detail[:300])
    if not rowed and rec_state == "done":
        rowed = "via-receipt"
        ev["rowed"] = rowed
    if not rowed and a["kind"] in ("message", "inbox", "request") and len(nouns) < 3:
        ev["why_unclear"] = "too few distinctive words to search the ledger"
        return "unclear", ev
    if not rowed:
        return "never-rowed", ev
    if rec_state == "done":
        return ("rowed+started+receipted" if started else "unclear"), ev
    if rec_state == "partial":
        ev["why_unclear"] = "receipt says partial"
        return "unclear", ev
    if rec_state == "uncovered":
        ev["why_unclear"] = "report exists but does not name this ask"
        return "unclear", ev
    if not started:
        if now - created > QUEUED_S:
            return "rowed-never-started", ev
        ev["why_unclear"] = "younger than 2 h"
        return "unclear", ev
    if now > due:
        return "past-due-no-receipt", ev
    ev["why_unclear"] = "started, not yet due"
    return "unclear", ev


def gather(hours, now, roots=None, claude_roots=None, codex_dirs=None, led_lines=None, ledger_file=None, messages=True):
    """Every ask of the window, from files, messages and ledger NOTE lines (not written)."""
    since = now - hours * 3600
    asks = []
    for p, kind in discover_files(roots if roots is not None else default_roots(), since):
        try:
            text = p.read_text(errors="replace")
            born = getattr(p.stat(), "st_birthtime", p.stat().st_mtime)
        except OSError:
            continue
        owner = job_owner(p)
        for a in make_asks(text, p, owner=owner, created=born, kind="brief" if kind in ("brief", "pool-brief") else kind):
            a["kind"] = kind
            asks.append(a)
    if messages:
        for m in discover_messages(since, claude_roots, codex_dirs):
            owner = str(m["to"] or "unaddressed")
            owner = re.sub(r"[^\w:./@-]", "-", owner)[:60]
            for a in make_asks(m["text"], None, owner=owner, created=m["ts"], source_key=m["key"], kind="message"):
                a["source"] = m["key"]
                a["source_file"] = m["file"]
                asks.append(a)
    if led_lines is not None:
        times = line_times(led_lines, now)
        asks += ledger_note_asks(led_lines, times, since, ledger_file)
    return asks


def backfill(hours=48, now=None, ledger=None, roots=None, claude_roots=None, codex_dirs=None, write=True, out_tsv=None, out_metrics=None, host=None,
             imported=None, notes=True, append_kinds=None):
    now = time.time() if now is None else now
    ledger = Path(ledger) if ledger else ledger_path()
    lines, status = read_lines(ledger)
    led = Ledger(lines, now) if lines else None
    rows = parse_rows(lines)
    asks = gather(hours, now, roots, claude_roots, codex_dirs, lines if notes else None, str(ledger))
    host = host or os.uname().nodename.split(".")[0]
    for a in asks:
        a["host"] = host
    for a in imported or []:
        asks.append(a)
    result = []
    for a in asks:
        if a.get("class") and (a.get("local_final") or a.get("kind") == "pool-brief"):
            result.append(a)  # a pool job's evidence is its own folder on the Mac that ran it; this Mac's ledger adds nothing a lane row did not
            continue
        cls, ev = classify(a, led, rows, now)
        if a.get("class") and a["class"] != "never-rowed" and cls in ("never-rowed", "unclear"):
            cls, ev = a["class"], {**a.get("ev", {}), **{k: v for k, v in ev.items() if v}}
        a["class"], a["ev"] = cls, ev
        result.append(a)
    if write:
        have = set(rows)
        hm = time.strftime("%H:%M", time.localtime(now))
        new = [format_row(a, hm=hm, extra=f"backfill=1 class={a['class']} host={a['host']}") for a in result
               if a["id"] not in have and (append_kinds is None or a["kind"] in append_kinds)]
        append_lines(ledger, new)
    by = {c: 0 for c in CLASSES}
    for a in result:
        by[a["class"]] += 1
    dropped = sum(by[c] for c in DROPPED)
    metrics = {"window_h": hours, "asks_total": len(result), "dropped": dropped, "dropped_per_day": round(dropped / (hours / 24.0), 1), "by_class": by,
               "unclear": by["unclear"], "generated_at": iso(now), "ledger": str(ledger), "ledger_status": status}
    if out_tsv:
        write_tsv(out_tsv, result)
    if out_metrics:
        Path(out_metrics).write_text(json.dumps(metrics, indent=1) + "\n")
    return result, metrics


TSV_COLS = ("id", "host", "kind", "class", "owner", "created", "due", "receipt", "source", "rowed_evidence", "started_evidence", "receipt_state",
            "receipt_evidence", "nouns", "why_unclear", "ask")


def write_tsv(path, result):
    def clean(v):
        return str(v or "").replace("\t", " ").replace("\n", " ")
    with open(path, "w") as f:
        f.write("\t".join(TSV_COLS) + "\n")
        for a in result:
            ev = a.get("ev", {})
            f.write("\t".join(clean(x) for x in (a["id"], a.get("host"), a["kind"], a["class"], a["owner"], iso(a["created_ts"]), iso(a["due_ts"]),
                                                  a.get("receipt"), a.get("source"), ev.get("rowed"), ev.get("started"), ev.get("receipt"),
                                                  ev.get("receipt_evidence"), ev.get("nouns"), ev.get("why_unclear"), norm(a["text"])[:MAX_TEXT])) + "\n")


def audit(ledger=None, since=None, now=None, roots=None, claude_roots=None, codex_dirs=None, messages=True):
    """Dropped asks since `since`: promised (in a brief, message or NOTE) but never a row; rows never started; rows past due with no receipt."""
    now = time.time() if now is None else now
    since = now - 24 * 3600 if since is None else since
    ledger = Path(ledger) if ledger else ledger_path()
    lines, status = read_lines(ledger)
    rows = parse_rows(lines)
    led = Ledger(lines, now) if lines else None
    hours = max(0.01, (now - since) / 3600)
    promised = [a for a in gather(hours, now, roots, claude_roots, codex_dirs, lines, str(ledger), messages) if a["created_ts"] >= since]
    never_rowed = [a for a in promised if a["id"] not in rows and a["kind"] != "ledger-note"]
    note_asks = [a for a in promised if a["kind"] == "ledger-note"]
    never_started, past_due = [], []
    for r in open_rows(rows):
        created = r.get("created_ts") or (led.times[r["line"]] if led else None) or now
        if created < since or probe_tag(r):
            continue
        r["created_ts"] = created
        nouns = led.nouns(r.get("text", "")) if led else []
        rec, _ = receipt_state(r, nouns, now)
        if rec == "done":
            continue
        if not started_evidence(r, led, nouns, now) and now - created > QUEUED_S:
            never_started.append(r)
        elif r.get("due_ts") and now > r["due_ts"]:
            past_due.append(r)
    unstarted_notes = []
    for a in note_asks:
        cls, ev = classify(a, led, rows, now)
        if cls in DROPPED:
            unstarted_notes.append((a, cls))
    total = len(promised) + sum(1 for r in rows.values() if r.get("line") is not None and r.get("backfill") != "1" and (r.get("created_ts") or 0) >= since
                                and r["id"] not in {a["id"] for a in promised})
    dropped = len(never_rowed) + len(never_started) + len(past_due) + len(unstarted_notes)
    return {"since": iso(since), "now": iso(now), "window_h": round(hours, 2), "ledger_status": status, "asks_total": total,
            "never_rowed": never_rowed, "never_started": never_started, "past_due": past_due, "notes_dropped": unstarted_notes,
            "dropped": dropped, "dropped_per_day": round(dropped / (hours / 24.0), 1)}


def audit_markdown(res, limit=40):
    out = [f"## Dropped asks (since {res['since']}, {res['window_h']} h)", "",
           f"asks {res['asks_total']}, dropped {res['dropped']} ({res['dropped_per_day']}/day): never a row {len(res['never_rowed'])}, rows never started "
           f"{len(res['never_started'])}, past due with no receipt {len(res['past_due'])}, ledger NOTE asks with no follow-up {len(res['notes_dropped'])}.", ""]
    if res["never_rowed"]:
        out.append("Promised but never a row:")
        out += [f"- {a['id']} owner={a['owner']} source={a['source']} :: {norm(a['text'])[:140]}" for a in res["never_rowed"][:limit]]
        out.append("")
    if res["never_started"]:
        out.append("Rows never started:")
        out += [f"- {r['id']} owner={r.get('owner')} created={r.get('created')} :: {r.get('text', '')[:140]}" for r in res["never_started"][:limit]]
        out.append("")
    if res["past_due"]:
        out.append("Rows past due with no receipt:")
        out += [f"- {r['id']} owner={r.get('owner')} due={r.get('due')} receipt={r.get('receipt')} :: {r.get('text', '')[:140]}" for r in res["past_due"][:limit]]
        out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ledger")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("file")
    e.add_argument("--owner")
    e.add_argument("--dry-run", action="store_true")
    c = sub.add_parser("check")
    c.add_argument("--dry-run", action="store_true")
    a = sub.add_parser("audit")
    a.add_argument("--since", help="ISO time or epoch; default 24 h ago")
    a.add_argument("--json")
    a.add_argument("--no-messages", action="store_true")
    b = sub.add_parser("backfill")
    b.add_argument("--hours", type=float, default=48)
    b.add_argument("--tsv")
    b.add_argument("--metrics")
    b.add_argument("--emit-jsonl", help="write the classified asks as JSON lines (the M5 side of a two-Mac backfill)")
    b.add_argument("--import-jsonl", action="append", default=[], help="classify these asks too (from the other Mac) against this ledger")
    b.add_argument("--no-write", action="store_true")
    b.add_argument("--append-kinds", help="comma list of kinds whose rows are appended (default all)")
    k = sub.add_parser("canary", help="plant | status | verify | drop one Mac's daily dead-man canary row")
    k.add_argument("action", choices=("plant", "status", "verify", "drop"))
    k.add_argument("--host", required=True, choices=tuple(HOSTS))
    k.add_argument("--date", help="YYYYMMDD (comma list for status); default today, yesterday for verify")
    k.add_argument("--id")
    k.add_argument("--reason", default="canary-verified")
    k.add_argument("--out-dir")
    d = sub.add_parser("daily", help="the 08:00 step: verify yesterday's canaries, plant today's, build, write and send the Fleet asks report")
    d.add_argument("--first-run", action="store_true")
    d.add_argument("--no-send", action="store_true", help="build and write the report, never call the mailer")
    args = ap.parse_args(argv)
    ledger = Path(args.ledger) if args.ledger else None
    if args.cmd == "canary":
        if args.action == "plant":
            print(json.dumps(plant_canary(args.host, ledger)))
        elif args.action == "status":
            days = (args.date or day_stamp(time.time())).split(",")
            print(json.dumps({"statuses": [canary_status(args.host, d, ledger) for d in days]}))
        elif args.action == "drop":
            if not (args.id or "").startswith(f"canary-{args.host}-"):
                print("drop takes a canary id of this host", file=sys.stderr)
                return 2
            print(json.dumps({"id": args.id, "dropped": drop_row(args.id, args.reason, ledger)}))
        else:
            print(json.dumps(verify_canary(args.host, args.date or day_stamp(time.time() - 86400), out_dir=args.out_dir)))
        return 0
    if args.cmd == "daily":
        res = daily(first_run=args.first_run, mailer=None if args.no_send else "find")
        print(json.dumps(res))
        return 0 if res["send"]["sent"] and not res["errors"] else 1
    if args.cmd == "extract":
        rows = extract(args.file, owner=args.owner, ledger=ledger, write=not args.dry_run)
        print(json.dumps({"file": str(Path(args.file).resolve()), "new_rows": len(rows), "ids": [r["id"] for r in rows]}))
        return 0
    if args.cmd == "check":
        res = check(ledger, write=not args.dry_run)
        print(json.dumps({k: (v if k != "conditions" else len(v)) for k, v in res.items()}))
        for i, cond, d in res["conditions"][:50]:
            print(f"{i}\t{cond}\t{d}")
        return 0
    if args.cmd == "audit":
        since = None
        if args.since:
            since = float(args.since) if re.fullmatch(r"\d+(\.\d+)?", args.since) else parse_iso(args.since)
        res = audit(ledger, since=since, messages=not args.no_messages)
        print(audit_markdown(res))
        if args.json:
            Path(args.json).write_text(json.dumps({"window_h": res["window_h"], "since": res["since"], "now": res["now"], "asks_total": res["asks_total"],
                                                   "dropped": res["dropped"], "dropped_per_day": res["dropped_per_day"],
                                                   "by_class": {"never-rowed": len(res["never_rowed"]), "rowed-never-started": len(res["never_started"]),
                                                                "past-due-no-receipt": len(res["past_due"]), "ledger-note-no-follow-up": len(res["notes_dropped"])},
                                                   "never_rowed_ids": [x["id"] for x in res["never_rowed"]]}, indent=1) + "\n")
        return 0
    if args.cmd == "backfill":
        imported = []
        for path in args.import_jsonl:
            for line in Path(path).read_text().splitlines():
                if line.strip():
                    imported.append(json.loads(line))
        kinds = set(args.append_kinds.split(",")) if args.append_kinds else None
        result, metrics = backfill(args.hours, ledger=ledger, write=not args.no_write, out_tsv=args.tsv, out_metrics=args.metrics, imported=imported,
                                   append_kinds=kinds)
        if args.emit_jsonl:
            with open(args.emit_jsonl, "w") as f:
                for a in result:
                    f.write(json.dumps({k: v for k, v in a.items() if k != "table"}) + "\n")
        print(json.dumps(metrics))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
