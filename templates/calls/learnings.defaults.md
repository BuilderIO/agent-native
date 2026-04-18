# Calls — Defaults

Seed learnings the agent starts with. Personal learnings go in `learnings.md` (git-ignored).

## Conventions

- Name resources **"Call"** in user-facing strings. Never "Gong". Internal table names stay as-is (`calls`, `call_transcripts`, ...).
- Transcription uses **Deepgram Nova-3** with diarization on. Every other AI operation (summary, trackers, topics, snippet titles) delegates to the agent chat.
- Snippets are **pointer-only** — they reference a parent call with `startMs`/`endMs` and never re-encode media.

## UI

- Inter font, monochrome palette, no decorative CSS transitions.
- Tabler Icons only. No robot or sparkle icons for the agent.
- shadcn/ui for every standard UI pattern. No `window.confirm` / `alert` / `prompt` — use shadcn `AlertDialog`.

## Behavior

- After any mutation, bump `refresh-signal` in `application_state` so the UI invalidates affected queries.
- Access control goes through `accessFilter(calls, callShares)` on lists and `assertAccess("call", id, "editor"|"admin")` on mutations.
- Password + expiry are enforced server-side in the share-resolution path, never only on the client.
