---
name: integrations
description: Calendar + video provider integrations — Google Calendar, Office 365, Zoom, built-in video, Google Meet — and how to write new ones.
---

# Integrations

## Calendar providers

- **google_calendar** — OAuth; read freeBusy + write events; optionally
  create Google Meet conference via `includeConference=true`.
- **office365_calendar** — Microsoft Graph; read freeBusy + write events.
- **caldav** (planned) — generic CalDAV for Apple iCloud, Fastmail, etc.

## Video providers

- **builtin_video** — Daily.co-backed; zero OAuth; server-to-server API key.
- **zoom_video** — OAuth; create meetings via Zoom REST API.
- **google_meet** — piggy-backs on Google Calendar credential.
- **teams_video** — delegated Microsoft OAuth for work or school accounts;
  creates and cancels standalone meetings through Microsoft Graph.

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
| "Connect Microsoft Teams" | `connect-video --kind teams_video --redirectUri ...` → complete the callback with `completeVideoOAuth()` |
| "Default to Teams for new bookings" | `set-default-conferencing-app --credentialId <teams-cred>` |
| "Refresh calendar cache" | `refresh-busy-times` |

## Microsoft Teams setup

Register `createTeamsProvider()` as a video provider with the deployment's
Microsoft client id and secret plus consumer-owned `getAccessToken`,
`updateTokens`, and `markInvalid` callbacks. The provider defaults to the
`organizations` tenant because Graph's delegated online-meeting API supports
work or school accounts, not personal Microsoft accounts. It requests only
`offline_access`, `OnlineMeetings.ReadWrite`, and `User.Read`.

Use `connect-video` to start OAuth and `completeVideoOAuth()` in the callback;
inserting a `teams_video` row with `install-conferencing-app` alone does not
grant Microsoft access. Token refresh remains the consumer's responsibility in
`getAccessToken`. The booking service stores the returned meeting id and join
URL in `booking_references` and calls the provider again on cancellation.
