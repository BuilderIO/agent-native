---
name: integrations
description: Calendar + video provider integrations — Google Calendar, Office 365, Zoom, Cal Video, Google Meet — and how to write new ones.
---

# Integrations

## Calendar providers

- **google_calendar** — OAuth; read freeBusy + write events; optionally
  create Google Meet conference via `includeConference=true`.
- **office365_calendar** — Microsoft Graph; read freeBusy + write events.
- **caldav** (planned) — generic CalDAV for Apple iCloud, Fastmail, etc.

## Video providers

- **cal_video** — Daily.co-backed; zero OAuth; server-to-server API key.
- **zoom_video** — OAuth; create meetings via Zoom REST API.
- **google_meet** — piggy-backs on Google Calendar credential.
- **teams_video** (planned) — Microsoft Teams.

## Credential lifecycle

1. User clicks "Connect" → `connect-calendar` returns `authUrl` + `state`
2. Redirect to provider → consent → provider redirects to our callback
3. Server exchanges code → writes `scheduling_credentials` row +
   core `oauth_tokens` entry
4. We fetch calendar list, let user pick "checked" + "destination"
5. Token expires → refresh flow runs silently; on failure, set
   `invalid: true` and show re-connect banner

## Busy-time aggregation

`aggregateBusy({userEmail, rangeStart, rangeEnd})` merges:
- Confirmed bookings hosted by the user
- External busy from each `selected_calendars` entry via the provider

Cached in `calendar_cache` (short TTL, default 5 min). Busted on any
booking write for that host.

## Writing a new provider

See `docs/providers.md` for the full interface.

## Common tasks

| User | Action |
|---|---|
| "Connect Google Calendar" | `connect-calendar --kind google_calendar --redirectUri ...` → redirect to returned `authUrl` |
| "Stop checking my vacation calendar" | `toggle-selected-calendar --include false` for that externalId |
| "Default to Zoom for new bookings" | `set-default-conferencing-app --credentialId <zoom-cred>` |
| "Refresh calendar cache" | `refresh-busy-times` |
