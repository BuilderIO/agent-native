---
name: meetings
description: >-
  Live calendar-backed meetings in Clips — upcoming Google Calendar events,
  desktop join/record reminders, live transcripts with mic + system-audio
  capture, AI summary / bullets / per-attendee action items, and the
  bidirectional recording↔meeting link. Use when listing meetings, opening a
  meeting detail, finalizing notes, connecting a calendar, or working with
  attendee-tagged transcript segments.
---

# Meetings

## When to use

Reach for this skill any time the user asks about a meeting, calendar event, or attendee-tagged transcript. Specifically:

- Listing upcoming/past meetings (`/meetings`).
- Opening a single meeting detail with transcript + AI notes (`/meetings/:id`).
- Generating notes (summary + bullets + action items) for a finished meeting.
- Connecting Google Calendar (and later iCloud).
- Reasoning about who said what when system + mic audio are both captured.

For press-and-hold dictations (Hold-Fn / Cmd+Shift+Space) and the `/dictate` tab, use the `dictate` skill.

## Design reference

The Meetings tab intentionally mirrors **Granola**: a compact "Coming up" card over a dense reverse-chronological history, two-pane detail (transcript left + AI notes right), inline title edit, "Generate notes" button, per-attendee action items. See `templates/clips/desktop/design-refs/granola-ux.md` for the source-of-truth interaction notes — read this before redesigning any Meetings surface. (Wispr-style press-and-hold patterns belong in the Dictate skill, not here.)

The list was a grid of tiles until 2026-08-14. That contradicted §2 of the ref ("list-row style rather than tile cards") and cost so much vertical space that history sat below the fold, which is how a user ends up unable to find last month's call.

## Data model touched

- **`meetings`** — title, scheduled/actual start+end, platform, joinUrl, recordingId, transcriptStatus, summaryMd, bulletsJson, actionItemsJson, source, ownableColumns.
- **`meeting_participants`** — meetingId + email + name + isOrganizer + attendedAt.
- **`meeting_action_items`** — meetingId, assigneeEmail, text, dueDate, completedAt.
- **`calendar_accounts`** — provider, externalAccountId, secret refs, lastSyncedAt. (See onboarding-calendar plugin.)
- **`calendar_events`** — compatibility snapshot for events that have been recorded or edited; the visible list reads Google Calendar live.
- **`recordings`** — when a meeting is recorded, the resulting recording row carries `meeting_id` (non-null) so we keep a bidirectional link. See the `recording` skill for the inverse direction.

## Audio capture: mic + system, tagged

Meeting capture records **two streams** and tags transcript segments by source:

- **mic** — what the user said locally.
- **system** — what came out of the speakers (other attendees on Zoom/Meet/Teams calls).

Each transcript segment carries a `source: "mic" | "system"` tag, which we use to attribute action items to the right attendee. This is why **per-attendee action items only work reliably with mic + system capture** — mic-only recordings make remote attendees silent. Document this caveat whenever you surface action items.

The iOS/Android companion is intentionally different: mobile background meeting
capture is microphone-only because the operating systems do not expose another
phone app's Zoom/Meet/Teams audio. It is appropriate for in-person rooms and for
capturing audio played from a separate device. Mobile recordings still receive
Clips transcription and summaries, but do not promise desktop-quality remote
speaker attribution or per-attendee action items.

## Bidirectional recording ↔ meeting link

A meeting can have an associated recording, and a recording can be linked back to a meeting:

- `meetings.recordingId` → `recordings.id`
- `recordings.meeting_id` → `meetings.id`

Both fields are set by `start-meeting-recording`. Agents that operate on a recording with a non-null `meeting_id` should consider both surfaces (a "Clip" answer and a "Meeting" answer can both be valid).

## Calendar reminders

Calendar events fire a desktop notification **1 minute before** the meeting start and keep it visible until **5 minutes after** start unless dismissed (consumer: the desktop tray in `src-tauri/`). The tray polls `list-meetings`, which reads Google Calendar live and excludes events the current user has declined, so upcoming reminders do not depend on a manual sync or pre-created `meetings` rows. The normal Meetings list remains calendar-backed and is not filtered by the reminder-only exclusion. Desktop Zoom joins use Zoom's native `zoommtg://` link so the Zoom app opens directly without an intermediate browser tab; unsupported Zoom link shapes and other providers retain their HTTPS join URL. Agents do not need to schedule reminders manually.

## Adhoc Zoom / Teams detection (desktop)

When meetings are enabled, the Clips desktop app also watches for native Zoom (`us.zoom.xos` / `us.zoom.ZoomClips`) and Microsoft Teams (`com.microsoft.teams` / `com.microsoft.teams2`) becoming frontmost. After a short dwell (~9s), and only while that same platform holds a live audio input, it creates an adhoc meeting via `create-meeting` (`source: "adhoc"`) and shows the same Granola-style popup (`type: "adhoc"`, subtitle "Take notes?"). Auto transcription mode also emits `meetings:start-transcription` with reason `adhoc-auto`. Detection skips when a meeting is already being transcribed, when Manual mode has the meeting widget disabled, and soft-skips shortly after a calendar reminder for the same platform. The microphone check reads CoreAudio per-process input state, which is macOS 14+; where the OS cannot answer, detection falls back to dwell alone rather than going silent.

## Actions

| Action                    | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `list-meetings`           | Upcoming + past, scoped via `accessFilter`; reads connected Google Calendar live. `hasContent` filters to meetings worth reopening; `offset` + `hasMore` page the history |
| `search-meetings`         | Find a meeting by title, summary, notes, attendee, or linked transcript text, with a match snippet. Use this — not `list-meetings` — when the user describes what was said rather than when it happened |
| `get-meeting`             | One meeting + participants + segments + notes                         |
| `create-meeting`          | Create a meeting row (`source`: `calendar` / `adhoc` / `manual`); desktop adhoc Zoom/Teams detection passes `source: "adhoc"` |
| `update-meeting`          | Inline title/notes edits and owner/admin visibility changes; meeting share links include the full transcript whenever one exists |
| `delete-meeting`          | Soft-delete a meeting from the visible list; linked recordings and calendar events stay intact |
| `start-meeting-recording` | Begin native macOS transcript stream + create the linked recording   |
| `stop-meeting-recording`  | End the active capture                                                |
| `finalize-meeting`        | Delegate Gemini Flash-Lite cleanup + summary + bullets + action items |
| `cleanup-transcript`      | Shared cleanup pipeline (used by Clips, Meetings, Dictate)            |
| `connect-calendar`        | Returns OAuth URL for Google Calendar                                 |
| `list-calendar-accounts`  | What's connected                                                      |
| `sync-calendars`          | Compatibility refresh for `calendar_events`; not needed for the visible list |
| `disconnect-calendar`     | Revoke + clear secret refs                                            |

All actions go through `accessFilter` / `assertAccess`. AI work delegates via `sendToAgentChat` per the `delegate-to-agent` skill — never inline LLM calls.

### Calendar provider-API boundary

These calendar-sourced actions are shortcuts, not a capability ceiling — but do
not add raw `provider-api-request` access for Google Calendar until the provider
API runtime can resolve Clips `calendar_accounts` through sharing/access checks
and read their encrypted `app_secrets` token refs. Clips calendar grants are not
stored in core `oauth_tokens`, so bypassing that model would break the account
sharing/status boundary.

## Sharing meeting notes and transcripts

Meeting share links always include generated notes: the summary, key points,
action items, and the full transcript whenever a linked transcript exists.
There is no transcript-sharing toggle. The legacy `share_transcript` column is
retained for database compatibility, but it is no longer a control and does not
change the meeting share payload. Sharing a meeting still must not expose the
linked recording's media or comments.

## Cleanup credential order

The `cleanup-transcript` action resolves credentials in this order — **always lead with Builder.io Connect** when explaining options to the user:

1. **Builder.io Connect (primary)** — managed Gemini 3.1 Flash-Lite. Easiest path; no key required.
2. **BYOK Gemini (secondary)** — user's own `GEMINI_API_KEY` (direct to Google). Mention only as a fallback. `cleanup-transcript` does **not** call Groq or OpenAI — those are transcription providers (`transcribe-voice`), not cleanup providers.

## Navigation state

The app exposes `view`, `meetingId`, and `dictationId` so the agent always knows what's on screen:

```json
{ "view": "meetings" }
{ "view": "meeting", "meetingId": "mtg_abc" }
{ "view": "dictate", "dictationId": "dct_xyz" }
```

## view-screen output

`view-screen` auto-includes meeting/dictate context — agents can trust this is present without re-querying. Shape (when on a meeting):

```json
{
  "navigation": { "view": "meeting", "meetingId": "mtg_abc" },
  "meeting": {
    "id": "mtg_abc",
    "title": "Weekly Sync",
    "scheduledStart": "...",
    "scheduledEnd": "...",
    "transcriptStatus": "ready",
    "shareTranscript": true,
    "participants": [{ "email": "alice@ex.com", "name": "Alice" }, ...],
    "actionItems": [{ "assigneeEmail": "alice@ex.com", "text": "..." }, ...],
    "hasRecording": true,
    "recordingId": "rec_xyz"
  }
}
```

When on `view: "dictate"`, the block instead contains a `dictation` object with `id`, `fullText` snippet, `cleanedText` snippet, `durationMs`, `source`. When on `view: "meetings"` (the list), `view-screen` returns the upcoming-meetings summary plus `calendarAccounts` health (`status`, `lastSyncedAt`, `lastSyncError`) instead of a single meeting.

## Common tasks

| User request                                  | What to do                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| "Show me my meetings today"                   | `pnpm action navigate --view=meetings`                                                  |
| "Open my 3pm call with Alice"                 | Look up via `list-meetings`, then `pnpm action navigate --view=meeting --meetingId=<id>` |
| "Summarize the standup I just finished"       | `pnpm action finalize-meeting --id=<id>` (delegates to agent for Gemini cleanup)        |
| "Create a meeting note for the call I just finished" | Prefer the current calendar event. If it was not on the calendar, send the user to `/record` instead of creating a fake meeting from the UI. |
| "Connect my Google Calendar"                  | `pnpm action connect-calendar --provider=google` then open returned `authUrl`           |
| "Show my action items from last week"         | `list-meetings --view=past --hasContent`, then collect `actionItemsJson` and filter by `assigneeEmail` |

## How the agent uses Meetings

These flows are common enough to memorize:

- **"Summarize my last meeting with Alice"** — `search-meetings --query=alice`, pick the most recent, `get-meeting`, then `finalize-meeting` if `summaryMd` is empty.
- **"Find the call where we discussed the renewal"** — `search-meetings --query="renewal"`. It reads transcripts, so it finds calls the user never titled usefully; `list-meetings` cannot answer this.
- **"Show me action items I owe Bob"** — `list-meetings` (recent), aggregate `actionItemsJson`, filter `assigneeEmail` matching Bob's email. Mention the mic+system caveat if the user expects coverage of remote attendees.
- **"Create a meeting note for the call I just finished"** — prefer an existing calendar-synced meeting. If the call was not on the calendar, send the user to `/record`; do not invent a fake calendar meeting in the visible Meetings list.
- **"What did Alice commit to in last Tuesday's standup?"** — `get-meeting`, scan `actionItemsJson` filtered by assignee, fall back to grepping the transcript segments tagged `source: "system"` (since Alice is remote).

## UI conventions (don't break)

- **Upcoming is one compact card** ("Coming up"), never a tile grid: a date column per day, one line per event, and Join / Open notes only on the live or imminent row. It must not push history below the fold.
- **History is dense one-line rows**, grouped by day with a date header (Today / Yesterday / Weekday Date): attendee avatars, title, attendee names, right-aligned time. No summary preview and no per-row status pills — transcript/notes state belongs on the detail page, not repeated down a list.
- **History is paged, never capped.** The list reads `list-meetings` with `hasContent: true` (not `recordedOnly`) so desktop live notes without a linked recording still appear, and pages with `offset` + `hasMore` behind a "Load older" button.
- **The search box is server-side**, calling `search-meetings`. Never filter the loaded page client-side: the meeting a user is hunting for is usually one they have not scrolled to.
- **Calendar-sourced list**: no "New meeting" CTA and no manual sync requirement in the Meetings list. Users connect/reconnect/disconnect the calendar from the calendar settings menu; events are fetched live from Google Calendar.
- **Two-pane detail**: transcript (left) + AI notes (right) with a "Generate notes" button in the header.
- **Live indicator** is a red animated dot — never a sparkle or a robot icon.
- **Calendar empty state** uses one focused Google Calendar CTA card.
- shadcn components only. Tabler icons (`IconCalendar`, `IconMicrophone2`, `IconWand`, `IconNotes`). No emojis as icons. No sparkle/robot.
