#!/usr/bin/env python3
"""The one outbound gate to Steve's Telegram. No other fleet script may reach the bot (tests/test_steve_gate.py lints for it).

Steve gets a message only when he must do something himself, as ONE plain-English sentence. Everything else is the fleet's to fix: it goes to the ledger as an
`ALERT <source> ...` line and to the orchestrator's alert file, and the caller's own heal path runs.

  send(kind, text, source=..., home=...)   kind "steve-action" enters the incident pager; any other kind is routed to ledger + orchestrator
  alert(home, trigger, text, test=False)   the old caller API, now a thin wrapper over send(); True means the alert was handled (delivered or routed)

Refused or failed sends are never swallowed: each leaves an ALERT ledger line and an orchestrator line, and is never retried as different text. A test-marked
message is never delivered through send(); asking to send one to the real bot is a hard TestSendToRealChat error. The bot credential is read at run time and never printed,
logged, put in argv, or kept in an exception.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

TELEGRAM_DIR = Path.home() / ".claude/channels/telegram"
REAL_BASE = "https://api.telegram.org"
TEST_PREFIX = "[TEST fired on purpose by the PR-sweep proof] "
STEVE_ACTION = "steve-action"
STEVE_PAGE = "steve-page"
PAGE_SEVERITIES = frozenset(("provider-login", "unacted-p0", "throughput-stall", "route-failure", "human-action"))
ROUTE_TEST = "PAGE-ROUTE test: reply not needed"
DEDUPE_S = 6 * 3600
MAX_LEN = 200
SLACK_NEED = "NEED slack bot credential (fleet Slack bot for DM alerts; Slack sender stays OUTBOX until it exists)"
VERBS = frozenset("""add allow answer approve authorize check choose click confirm connect decide deny enable enter fix grant install log open pay pick plug provide renew
reply restart review run send set share sign tell turn unlock update""".split())
CANARY_TAG = re.compile(r"(?<!\S)canary=1(?!\S)")  # the dead-man's own test alert: logged and routed like any alert, never sent to Steve
_SECRET_SHAPE = re.compile(r"\b\d{6,}:[A-Za-z0-9_-]{20,}\b")
_TEST_MARKED = re.compile(r"^\W*test\b|\[test\b|\btest (message|alert)\b|\bfired on purpose\b", re.I)
# Each pattern is something Steve should never read: file paths, code identifiers, hashes, ids, stack text, alert tags.
_INTERNAL = (
    ("path", re.compile(r"(?:^|[\s(])(?:~|\.{1,2})?/[\w.-]+|\b[\w-]+\.(?:py|sh|zsh|md|json|jsonl|tsv|log|mjs|js|ts|plist|txt|yml|yaml)\b")),
    ("code-identifier", re.compile(r"\b[a-z]+_[a-z0-9_]+\b|\b[a-z]+[A-Z]\w*\b|\(\)|`|=|::|->|\{|\}")),
    ("hash-or-id", re.compile(r"\b[0-9a-f]{7,}\b|\b\d{6,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-", re.I)),
    ("stack-text", re.compile(r"Traceback|\bException\b|\bError:|\bat line \d+|\bstack\b", re.I)),
    ("alert-tag", re.compile(r"\bALERT\b")),
)


class NotifyError(Exception):
    """A send that did not land. The message is already redacted."""


class TestSendToRealChat(NotifyError):
    """A test-marked message was pointed at the real bot. Tests use a fake base URL and a fake sink only."""

    __test__ = False


def redact(text, secrets=()):
    text = str(text)
    for secret in secrets:
        if secret:
            text = text.replace(secret, "<redacted>")
    return _SECRET_SHAPE.sub("<redacted>", text)


def refusal_reason(text):
    """None when `text` is one plain sentence telling Steve what to do; else a short typed reason."""
    if not isinstance(text, str) or not text.strip():
        return "empty"
    if "\n" in text or "\r" in text:
        return "multi-line"
    if len(text) > MAX_LEN:
        return f"over-{MAX_LEN}-chars"
    for reason, pattern in _INTERNAL:
        if pattern.search(text):
            return reason
    words = re.findall(r"[A-Za-z']+", text)
    first = words[1] if words and words[0].lower() == "please" and len(words) > 1 else (words[0] if words else "")
    if first.lower() not in VERBS:
        return "no-action-verb"
    if not text.rstrip().endswith((".", "!")) or re.search(r"[.!?]\s+\S", text.strip()):
        return "not-one-sentence"
    return None


def is_test_marked(text, test=False):
    return bool(test) or bool(_TEST_MARKED.search(text or ""))


def _stamp(now):
    return time.strftime("%H:%M", time.localtime(now))


def _append(path, line):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, (line.rstrip("\n") + "\n").encode())
    finally:
        os.close(fd)


def _under_test():
    """True inside pytest or unittest: a run that falls back to the live ledger would put fixture alerts in front of the orchestrator."""
    return "PYTEST_CURRENT_TEST" in os.environ or "pytest" in sys.modules or "unittest" in " ".join(sys.argv[:3])


def _sinks(home):
    """(ledger file, orchestrator alert file). Env overrides win; otherwise the Mac 2 handoff ledger and kit-local file when they exist, else files under `home`."""
    ledger = os.environ.get("FLEET_LEDGER_PATH")
    orch = os.environ.get("FLEET_ORCH_ALERTS_PATH")
    base = Path.home() / "Projects/builder/agent-native/.tmp/replica-home/handoff-ledger.md"
    kit = Path.home() / "Projects/re/kit-local"
    spill = Path.home() / ".config/replica-workers/alerts"  # a Mac with no handoff ledger (the M5): one fixed place the Mac 2 dead-man mirrors from
    if (not ledger or not orch) and _under_test():
        raise NotifyError("under test, the ledger and orchestrator sinks must be set explicitly (FLEET_LEDGER_PATH, FLEET_ORCH_ALERTS_PATH); the real files are never a default")
    ledger = ledger or (str(base) if base.parent.is_dir() else str(spill / "ledger-alerts.md"))
    orch = orch or (str(kit / "orchestrator-alerts.md") if kit.is_dir() else str(spill / "orchestrator-alerts.md"))
    return ledger, orch


def route_to_fleet(home, source, text, now, prefix="ALERT"):
    """The ledger line plus the orchestrator's alert line. Both are internal: raw text is fine here, the bot never sees it."""
    ledger, orch = _sinks(home)
    body = redact(" ".join(str(text).split()))
    host = os.uname().nodename.split(".")[0]
    _append(ledger, f"{_stamp(now)} {prefix} {source} {body}")
    _append(orch, f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(now))} [{source} · {host}] {prefix} {body}")


def mirror_remote(home, host, remote_path=".config/replica-workers/alerts/orchestrator-alerts.md", run=None, now=None):
    """Mac 2 side: pull the M5's new orchestrator lines (the M5 cannot reach this Mac) into this Mac's ledger and orchestrator file, once each. Returns the number of
    lines mirrored; raises NotifyError when the read fails, so an unreachable M5 is never read as 'no alerts'."""
    import subprocess

    now = time.time() if now is None else now
    offset_path = Path(home) / "mirror-offset.json"
    try:
        offset = int(json.loads(offset_path.read_text()).get(host, 0))
    except FileNotFoundError:
        offset = 0
    except (OSError, ValueError):
        raise NotifyError("mirror offset unreadable") from None
    run = run or (lambda cmd: subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=60))
    done = run(["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, f"test -f {remote_path} && tail -c +{offset + 1} {remote_path} || true"])
    if done.returncode != 0:
        raise NotifyError(f"could not read the M5 alert file (ssh exit {done.returncode})")
    data = done.stdout
    complete = data[: data.rfind(b"\n") + 1]
    ledger, orch = _sinks(home)
    count = 0
    for line in complete.decode(errors="replace").splitlines():
        _append(orch, line)
        _append(ledger, f"{_stamp(now)} ALERT m5-mirror {redact(line)}")
        count += 1
    if complete:
        offset_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = offset_path.with_name(f".{offset_path.name}.{os.getpid()}")
        tmp.write_text(json.dumps({host: offset + len(complete)}))
        os.replace(tmp, offset_path)
    return count


def read_credentials(directory=None):
    directory = Path(directory or os.environ.get("TELEGRAM_CREDENTIALS_DIR") or TELEGRAM_DIR)
    try:
        lines = (directory / ".env").read_text().splitlines()
        access = json.loads((directory / "access.json").read_text())
    except (OSError, ValueError) as error:
        raise NotifyError(f"telegram credentials unreadable: {type(error).__name__}") from None
    bot = None
    for line in lines:
        key, _, value = line.partition("=")
        if "TOKEN" in key.upper() and value.strip():
            bot = value.strip().strip("'\"")
    allow = access.get("allowFrom") or []
    if not bot:
        raise NotifyError("telegram bot credential missing from .env")
    if not allow or len(allow) != 1:
        raise NotifyError("telegram access.json must allow exactly one private recipient")
    return bot, str(allow[0])


def _telegram_cap(text):
    """Bound all installed gate copies, including callers outside the incident pager."""
    import fcntl
    import tempfile
    root = Path.home() / '.local/share/page-route'
    root.mkdir(parents=True, exist_ok=True)
    now = time.time()
    digest = hashlib.sha256(text.encode()).hexdigest()
    with (root / 'telegram-cap.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = root / 'telegram-cap.json'
        try:
            sent = json.loads(path.read_text())
        except FileNotFoundError:
            sent = []
        except (OSError, ValueError):
            raise NotifyError('telegram rate budget unreadable') from None
        sent = [row for row in sent if now - row['at'] < 3600]
        if len(sent) >= 5 or any(row['digest'] == digest for row in sent):
            raise NotifyError('telegram hourly cap: message not sent')
        sent.append({'at': now, 'digest': digest})
        fd, name = tempfile.mkstemp(dir=root, prefix='.cap')
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(sent, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)


def _post(text, directory, base_url, timeout, method="sendMessage"):
    """The only code in the fleet that talks to the Bot API. Reached from send() alone, after every rule has passed."""
    bot, chat_id = read_credentials(directory)
    base = (base_url or os.environ.get("PR_SWEEP_TELEGRAM_BASE") or REAL_BASE).rstrip("/")
    if method == 'sendMessage' and _is_real_base(base_url):
        _telegram_cap(text)
    request = urllib.request.Request(
        f"{base}/bot{bot}/{method}",
        data=json.dumps({"chat_id": chat_id, "text": text} if method == "sendMessage" else {"chat_id": chat_id} if method == "getChat" else {}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    failure = None
    body = None
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        failure = f"telegram HTTP {error.code}"
    except Exception as error:  # noqa: BLE001 - every network failure becomes one typed, redacted error
        failure = f"telegram send failed: {type(error).__name__}"
    if failure:
        raise NotifyError(redact(failure, (bot, chat_id)))
    try:
        reply = json.loads(body)
    except ValueError:
        raise NotifyError("telegram reply was not JSON") from None
    if not reply.get("ok"):
        raise NotifyError(redact(f"telegram not ok: {reply.get('description', 'no description')}", (bot, chat_id)))
    result = reply.get("result")
    if not isinstance(result, dict):
        raise NotifyError("bot reply has no result")
    if method == "sendMessage":
        if not isinstance(result.get("message_id"), int):
            raise NotifyError("bot reply has no delivery receipt")
        return result["message_id"]
    return result


def probe_route(directory=None, base_url=None, timeout=10):
    """Read-only auth and private-chat checks; never send a message or consume updates."""
    _bot, chat = read_credentials(directory)
    if not chat.isdigit() or STEVE_PAGE != "steve-page" or len(PAGE_SEVERITIES) != 5:
        raise NotifyError("page gate or private recipient is not configured")
    me = _post(None, directory, base_url, timeout, method="getMe")
    if me.get("is_bot") is not True:
        raise NotifyError("getMe did not identify a bot")
    target = _post(None, directory, base_url, timeout, method="getChat")
    if str(target.get("id")) != chat or target.get("type") != "private":
        raise NotifyError("configured recipient is not the allowed private chat")
    return {"bot_auth": True, "chat_allowed": True, "gate_class": STEVE_PAGE}


def deliver_page(text, severity, directory=None, base_url=None, timeout=10, authorized_test=False):
    """Transport for the incident pager; ordinary fleet kinds cannot enter this class."""
    if authorized_test:
        if text != ROUTE_TEST or (_under_test() and _is_real_base(base_url)):
            raise NotifyError("only the exact explicitly authorized route test may be sent")
    else:
        if severity not in PAGE_SEVERITIES:
            raise NotifyError("severity is not a page class")
        reason = refusal_reason(text)
        if reason or is_test_marked(text) or _SECRET_SHAPE.search(text):
            raise NotifyError("page rejected: " + (reason or "unsafe content"))
    return {"delivered": True, "route": "telegram", "message_id": _post(text, directory, base_url, timeout)}


def _is_real_base(base_url):
    base = (base_url or os.environ.get("PR_SWEEP_TELEGRAM_BASE") or REAL_BASE).rstrip("/")
    return base == REAL_BASE or "api.telegram.org" in base


def _log(home, record):
    path = Path(home) / "alerts.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as stream:
        stream.write(json.dumps(record, sort_keys=True) + "\n")


def send(kind, text, source=None, home=None, test=False, directory=None, base_url=None, timeout=10, now=None):
    """Gate one message. Returns {"delivered": bool, "route": "telegram"|"fleet", "reason": str|None, "message_id": n|None}.
    Raises TestSendToRealChat for a test-marked message aimed at the real bot, after logging it."""
    now = time.time() if now is None else now
    home = home or str(Path.home() / "m5-jobs/pr-sweep")
    source = source or kind
    record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(now)), "trigger": source, "kind": kind, "test": bool(test), "channel": "telegram"}
    result = {"delivered": False, "route": "fleet", "reason": None, "message_id": None}
    canary = bool(CANARY_TAG.search(str(text)))
    if canary:
        record.update(canary=1, text=redact(" ".join(str(text).split()))[:400])

    def finish(reason, route_text=None, prefix="ALERT", ok=False):
        result["reason"] = reason
        record.update(ok=ok, error=reason)
        _log(home, record)
        if route_text is not None:
            route_to_fleet(home, source, route_text, now, prefix)
        return result

    if is_test_marked(text, test):
        if _is_real_base(base_url):
            finish("test-marked message aimed at the real chat", f"refused: test-marked message aimed at the real Telegram chat ({kind}): {text}")
            raise TestSendToRealChat("a test-marked message may only use a fake base URL, never Steve's chat")
        return finish("test-marked", f"refused: test-marked message never goes to Steve ({kind}): {text}")
    if canary or kind != STEVE_ACTION:
        if canary and kind == STEVE_ACTION:
            record["suppressed"] = "telegram"
        return finish(None, text, ok=True)
    reason = refusal_reason(text)
    if reason:
        return finish(f"refused: {reason}", f"refused steve-action ({reason}), not sent to Steve: {text}")
    import importlib.util
    from types import SimpleNamespace
    pager_path = Path(__file__).resolve().parents[1] / "kit/tools/page-steve.py"
    if not pager_path.is_file():
        pager_path = Path.home() / ".local/share/page-route/page-steve.py"
    spec = importlib.util.spec_from_file_location("steve_page_manager", pager_path)
    pager = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pager)
    transport = SimpleNamespace(NotifyError=NotifyError, deliver_page=lambda message, severity, **kw: deliver_page(
        message, severity, directory=directory, base_url=base_url, timeout=timeout, **kw))
    # A fake bot cannot fall through to a real desktop notification in a test process.
    fallback_send = None if _is_real_base(base_url) else lambda *a: {"delivered": False, "route": "sandbox-fallback", "reason": "sandbox has no notification service"}
    incident = source + ":" + hashlib.sha256(text.strip().encode()).hexdigest()
    incident_home = home if not _is_real_base(base_url) else pager.ROOT
    outcome = pager.event("human-action", incident, source, now, root=incident_home, now=now,
                          repage_minutes=DEDUPE_S // 60, transport=transport, fallback_send=fallback_send)
    if outcome["route"] in ("deduplicated", "acknowledged"):
        return finish("duplicate", prefix="NOTE")
    if not outcome["delivered"]:
        return finish("send failed: " + outcome.get("primary_reason", outcome.get("primary_error", "fallback failed")),
                      "steve-action send failed; inspect the incident receipt")
    result.update(delivered=True, route=outcome['route'], message_id=outcome.get('message_id'))
    record.update(ok=True, message_id=outcome.get('message_id'), channel=outcome['route'])
    _log(home, record)
    with (Path(home) / "slack-outbox.jsonl").open("a") as stream:
        stream.write(json.dumps({"ts": record["ts"], "trigger": source,
                                "text": pager.SEVERITIES["human-action"], "need": SLACK_NEED}) + "\n")
    return result


def alert(home, trigger, text, test=False, directory=None, base_url=None, timeout=10):
    """Caller API kept for the dead-men: `trigger` names the source and is the kind. True when the alert was handled (routed to the fleet, or delivered as a
    steve-action sentence); False when a steve-action send was refused or failed, so a caller that retries keeps its state unmarked."""
    outcome = send(trigger, text, source=trigger, home=home, test=test, directory=directory, base_url=base_url, timeout=timeout)
    return outcome["delivered"] or (trigger != STEVE_ACTION and outcome["reason"] is None)


if __name__ == "__main__":
    print("notify.py is a library: use send(kind, text); there is no manual send.", file=sys.stderr)
    sys.exit(2)
