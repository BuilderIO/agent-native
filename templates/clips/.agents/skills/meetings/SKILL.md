---
name: meetings
description: >-
  Calendar-synced meetings in Clips — upcoming meetings, live transcripts with
  mic + system-audio capture, AI summary / bullets / per-attendee action items,
  and the bidirectional recording↔meeting link. Use when listing meetings,
  opening a meeting detail, finalizing notes, connecting a calendar, or working
  with attendee-tagged transcript segments.
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

The Meetings tab intentionally mirrors **Granola**: card grid grouped by day, two-pane detail (transcript left + AI notes right), inline title edit, "Generate notes" button, per-attendee action items. See `templates/clips/desktop/design-refs/granola-ux.md` for the source-of-truth interaction notes — read this before redesigning any Meetings surface. (Wispr-style press-and-hold patterns belong in the Dictate skill, not here.)

> If `granola-ux.md` is missing, treat that as a TODO — the Wispr ref has been written but the Granola ref hasn't landed yet.

## Data model touched

- **`meetings`** — title, scheduled/actual start+end, platform, joinUrl, recordingId, transcriptStatus, summaryMd, bulletsJson, actionItemsJson, source, ownableColumns.
- **`meeting_participants`** — meetingId + email + name + isOrganizer + attendedAt.
- **`meeting_action_items`** — meetingId, assigneeEmail, text, dueDate, completedAt.
- **`calendar_accounts`** — provider, externalAccountId, secret refs, lastSyncedAt. (See onboarding-calendar plugin.)
- **`calendar_events`** — synced events; auto-promote to a `meetings` row N min before start.
- **`recordings`** — when a meeting is recorded, the resulting recording row carries `meeting_id` (non-null) so we keep a bidirectional link. See the `recording` skill for the inverse direction.

## Audio capture: mic + system, tagged

Meeting capture records **two streams** and tags transcript segments by source:

- **mic** — what the user said locally.
- **system** — what came out of the speakers (other attendees on Zoom/Meet/Teams calls).

Each transcript segment carries a `source: "mic" | "system"` tag, which we use to attribute action items to the right attendee. This is why **per-attendee action items only work reliably with mic + system capture** — mic-only recordings make remote attendees silent. Document this caveat whenever you surface action items.

## Bidirectional recording ↔ meeting link

A meeting can have an associated recording, and a recording can be linked back to a meeting:

- `meetings.recordingId` → `recordings.id`
- `recordings.meeting_id` → `meetings.id`

Both fields are set by `start-meeting-recording`. Agents that operate on a recording with a non-null `meeting_id` should consider both surfaces (a "Clip" answer and a "Meeting" answer can both be valid).

## Calendar reminders

Calendar events fire a desktop notification **5 minutes before** the meeting start (consumer: the desktop tray in `src-tauri/`). A recurring job (`calendar-jobs.ts`) keeps `calendar_events` fresh; the tray subscribes via the framework's polling layer. Agents do not need to schedule reminders manually.

## Actions

| Action                    | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `list-meetings`           | Upcoming + past, scoped via `accessFilter`                            |
| `get-meeting`             | One meeting + participants + segments + notes                         |
| `create-meeting`          | Manual ad-hoc meeting (no calendar event)                             |
| `update-meeting`          | Inline title edit, notes edits                                        |
| `start-meeting-recording` | Begin native macOS transcript stream + create the linked recording   |
| `stop-meeting-recording`  | End the active capture                                                |
| `finalize-meeting`        | Delegate Gemini Flash-Lite cleanup + summary + bullets + action items |
| `cleanup-transcript`      | Shared cleanup pipeline (used by Clips, Meetings, Dictate)            |
| `connect-calendar`        | Returns OAuth URL for Google Calendar                                 |
| `list-calendar-accounts`  | What's connected                                                      |
| `sync-calendars`          | Force-refresh `calendar_events`                                       |
| `disconnect-calendar`     | Revoke + clear secret refs                                            |

All actions go through `accessFilter` / `assertAccess`. AI work delegates via `sendToAgentChat` per the `delegate-to-agent` skill — never inline LLM calls.

## Cleanup credential order

The `cleanup-transcript` action resolves credentials in this order — **always lead with Builder.io Connect** when explaining options to the user:

1. **Builder.io Connect (primary)** — managed Gemini 3.1 Flash-Lite. Easiest path; no key required.
2. **BYOK (secondary)** — user's own `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY`. Mention only as a fallback.

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
    "participants": [{ "email": "alice@ex.com", "name": "Alice" }, ...],
    "actionItems": [{ "assigneeEmail": "alice@ex.com", "text": "..." }, ...],
    "hasRecording": true,
    "recordingId": "rec_xyz"
  }
}
```

When on `view: "dictate"`, the block instead contains a `dictation` object with `id`, `fullText` snippet, `cleanedText` snippet, `durationMs`, `source`. When on `view: "meetings"` (the list), `view-screen` returns the upcoming-meetings summary instead of a single meeting.

## Common tasks

| User request                                  | What to do                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| "Show me my meetings today"                   | `pnpm action navigate --view=meetings`                                                  |
| "Open my 3pm call with Alice"                 | Look up via `list-meetings`, then `pnpm action navigate --view=meeting --meetingId=<id>` |
| "Summarize the standup I just finished"       | `pnpm action finalize-meeting --id=<id>` (delegates to agent for Gemini cleanup)        |
| "Create a meeting note for the call I just finished" | `pnpm action create-meeting --title="..."` then `start-meeting-recording --id=<mid>` |
| "Connect my Google Calendar"                  | `pnpm action connect-calendar --provider=google` then open returned `authUrl`           |
| "Show my action items from last week"         | `list-meetings --since=<iso>`, then collect `actionItemsJson` and filter by `assigneeEmail` |

## How the agent uses Meetings

These flows are common enough to memorize:

- **"Summarize my last meeting with Alice"** — `list-meetings` filtered by participant, pick the most recent, `get-meeting`, then `finalize-meeting` if `summaryMd` is empty.
- **"Show me action items I owe Bob"** — `list-meetings` (recent), aggregate `actionItemsJson`, filter `assigneeEmail` matching Bob's email. Mention the mic+system caveat if the user expects coverage of remote attendees.
- **"Create a meeting note for the call I just finished"** — `create-meeting` (manual ad-hoc), then `start-meeting-recording` to attach a transcript. Use this when the call wasn't on the calendar.
- **"What did Alice commit to in last Tuesday's standup?"** — `get-meeting`, scan `actionItemsJson` filtered by assignee, fall back to grepping the transcript segments tagged `source: "system"` (since Alice is remote).

## UI conventions (don't break)

- **Card grid** for meeting lists, grouped by day with a date header (Today / Tomorrow / Weekday Date).
- **Two-pane detail**: transcript (left) + AI notes (right) with a "Generate notes" button in the header.
- **Live indicator** is a red animated dot — never a sparkle or a robot icon.
- **Calendar empty state** mirrors `ConnectBuilderCard` layout: single CTA card + "Add API key" disclosure underneath.
- shadcn components only. Tabler icons (`IconCalendar`, `IconMicrophone2`, `IconWand`, `IconNotes`). No emojis as icons. No sparkle/robot.
