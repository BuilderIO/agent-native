# Appointment Blocker

Appointment Blocker turns personal-inbox appointment details into private work
calendar blocks with a 30-minute buffer before and after each appointment. It
checks work-calendar overlaps for external attendees, then requires explicit
approval before handing the exact windows to the connected calendar agent.

The app keeps the local test path honest: it can parse pasted appointment and
calendar lines, but the final action only records approval. A connected agent is
responsible for creating opaque, private calendar events and reporting provider
limitations.

## Workflow

1. Capture appointment lines from a personal inbox or the local fallback.
2. Prepare buffered windows.
3. Check work-calendar conflicts and external attendees.
4. Confirm and hand off calendar creation.

Paste one appointment per line, for example:

```text
Appointment | Wed Oct 7, 2026 9am - 9:30am (PDT)
```

For local conflict testing, paste one work-calendar event per line:

```text
Customer call | Wed Oct 14, 2026 4:30pm - 5pm | attendees: partner@example.com
```

ChatGPT and Claude import is coming soon and is not implemented in this
version.

## Develop locally

From this directory:

```bash
pnpm install
pnpm dev
```

This test copy has an ignored `.env` with `AUTH_DISABLED=1`, so the local
appointment workflow opens without an account. Its committed
`agent-native.json` shows the shared Connect AI / BYOK choice by default in
development and skips the generic agent integrations catalog. Add
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` there if you want agent handoffs without
the setup prompt. Never commit or deploy `AUTH_DISABLED`.

The generated shared onboarding flow handles Builder connection and custom
agent credentials. The app is build-ready locally; deployment still needs a
chosen host and its normal credentials/configuration.
