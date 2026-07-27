---
name: mail-backends
description: >-
  How Mail actions pick between the real Gmail API and synthetic local-emails
  fallback data per user. Use when mail data looks fake or empty, when a user
  has no connected Google account, or before claiming a message really was
  sent or fetched from Gmail.
---

# Mail Backends

## Rule

**Two mail backends, chosen automatically per user.** When the user has a
connected Google account (`isConnected(ownerEmail)`), actions call the real
Gmail API. When no account is connected, the same actions fall back
transparently to synthetic `local-emails` data stored via `getUserSetting` /
`putUserSetting`. Never assume Gmail is connected — actions like
`search-emails`, `list-emails`, `get-thread`, `get-email`, and `move-email`
branch on this internally, so call them the same way either way.

## Why it matters

The fallback exists so the app is usable and demoable without OAuth. It is not
a queue that later flushes to Gmail. If you are in fallback mode, do not tell
the user that mail left their real inbox or that a real Gmail record changed —
say the data is local demo state.

## Related Skills

- `inbox-reads-and-triage` — reading mail and reporting coverage honestly.
- `email-drafts` — what `send-email` does in each mode, including the synthetic
  "Sent" item written to `local-emails`.
