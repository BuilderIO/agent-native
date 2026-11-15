# FLEET-MAIL

Date: 2026-11-15 (M4 only)

## Result

Installed the send-only executable at `~/.config/replica-workers/bin/fleet-mail`. It reads the SendGrid key at runtime from `templates/mail/.env`; the key was not printed, copied, or moved to the M5. The allow-list is stored beside the executable and contains Steve's two existing addresses. The executable refuses all other recipients and cc/bcc, reports typed errors as one JSON line, and exits nonzero on failure. The configured sender is `noreply@builder.io`.

The existing launchd job `com.steve.re.fleet-asks-report` remains the sole daily schedule at 08:00. Its existing `asks.py daily` flow now sends through `fleet-mail`, retries one failed send once, writes a `.sent.json` only after an id is returned, and records double failure in `.unsent.json` plus an `ASK-DROP` ledger row. No new account, key, or paid plan change was needed.

## First send

Generated and sent today's first-run Fleet asks report to Steve only. SendGrid returned:

```json
{"id":"kfNgHdHTRmWKb1Bw1CC54A","http_status":202}
```

The daily report is at `.tmp/replica-home/jobs-1115/ask-rows/daily/2026-11-15.md`; its receipt is `2026-11-15.sent.json`. The ASK-ROWS duty row is closed with `ASK-DONE`. The handoff ledger has the requested `DONE fleet-mail` row. The 11/16 08:05 receipt readback remains scheduled.

## Blocker rule

Added: “An email or message only to Steve never needs his yes. Not a Steve blocker.” to `~/Projects/re/kit-local/rules-addendum.md`. The existing fleet-monitor blocker relay has a deterministic check, so it now refuses Steve-only email/message approval blockers and supports content-hash closures for unkeyed entries. The 12:08 ask has an appended resolution in `steve-blockers.md`.

## Verification

- Red-first mailer test confirmed the executable was missing before implementation.
- `test_fleet_mail.py`: 4 passed (other recipient refused; cc/bcc refused; missing key named; allowed request built with mocked SendGrid response).
- `test_canary_report.py`: 12 passed, including retry-once, failure ledgering, and no false sent receipt.
- Active fleet-monitor `--selftest`: passed, including Steve-only approval refusal and appended resolution handling.
- LaunchAgent plist validation: passed; exactly one matching launchd label is loaded.

No PR was opened. This job is handed off on its pushed job branch.
