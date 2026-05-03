---
name: meetings
description: >-
  Granola-style meetings in Clips — calendar-synced upcoming meetings,
  live transcripts, and AI summary/bullets/action items. Also covers the
  Wispr dictation history tab. Use when listing meetings, opening a
  meeting detail, finalizing notes, or working with past Fn-hold
  dictations.
---

# Meetings + Wispr

## When to use

Reach for this skill any time the user asks about a meeting, calendar event, or past voice dictation. It's the map for:

- Listing upcoming/past meetings (`/meetings`).
- Opening a single meeting detail with transcript + AI notes (`/meetings/:id`).
- Generating notes (summary + bullets + action items) for a finished meeting.
- Connecting Google Calendar (and later iCloud).
- Browsing past Wispr dictations (Fn-hold or Cmd+Shift+Space) at `/wispr`.

## Data model touched

- **`meetings`** — title, scheduled/actual start+end, platform, joinUrl, recordingId, transcriptStatus, summaryMd, bulletsJson, actionItemsJson, source, ownableColumns.
- **`meeting_participants`** — meetingId + email + name + isOrganizer + attendedAt.
- **`meeting_action_items`** — meetingId, assigneeEmail, text, dueDate, completedAt.
- **`calendar_accounts`** — provider, externalAccountId, secret refs, lastSyncedAt.
- **`calendar_events`** — synced events; auto-promote to a `meetings` row N min before start.
- **`dictations`** — id, fullText, cleanedText, durationMs, audioUrl, source, ownableColumns.

## Actions

| Action                    | What it does                                                         |
| ------------------------- | -------------------------------------------------------------------- |
| `list-meetings`           | Upcoming + past, scoped via `accessFilter`                          |
| `get-meeting`             | One meeting + participants + segments + notes                        |
| `create-meeting`          | Manual ad-hoc meeting (no calendar event)                            |
| `update-meeting`          | Inline title edit, notes edits                                       |
| `start-meeting-recording` | Begin native macOS transcript stream                                 |
| `stop-meeting-recording`  | End the active capture                                               |
| `finalize-meeting`        | Delegate Gemini Flash-Lite cleanup + summary + bullets + action items |
| `list-dictations`         | Wispr history                                                        |
| `cleanup-dictation`       | Polish a single dictation's text                                     |
| `cleanup-transcript`      | Shared cleanup pipeline (used by Clips, Meetings, Wispr)             |
| `connect-calendar`        | Returns OAuth URL for Google Calendar                                |
| `list-calendar-accounts`  | What's connected                                                     |
| `sync-calendars`          | Force-refresh `calendar_events`                                      |
| `disconnect-calendar`     | Revoke + clear secret refs                                           |

All actions go through `accessFilter` / `assertAccess`. AI work delegates via `sendToAgentChat` per the `delegate-to-agent` skill — never inline LLM calls.

## Common tasks

| User request                                  | What to do                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| "Show me my meetings today"                   | `pnpm action navigate --view=meetings`                                                  |
| "Open my 3pm call with Alice"                 | Look up via `list-meetings`, then `pnpm action navigate --view=meeting --meetingId=<id>` |
| "Summarize the standup I just finished"       | `pnpm action finalize-meeting --id=<id>` (delegates to agent for Gemini cleanup)        |
| "Connect my Google Calendar"                  | `pnpm action connect-calendar --provider=google` then open returned `authUrl`           |
| "Show me what I dictated yesterday"           | `pnpm action navigate --view=wispr`                                                     |
| "Clean up that dictation"                     | `pnpm action cleanup-dictation --id=<id>`                                               |

## Navigation state

The app exposes `view`, `meetingId`, and `dictationId` so the agent always knows what's on screen:

```json
{ "view": "meetings" }
{ "view": "meeting", "meetingId": "mtg_abc" }
{ "view": "wispr", "dictationId": "dct_xyz" }
```

## UI conventions (don't break)

- **Card grid** for meeting lists, grouped by day with a date header (Today / Tomorrow / Weekday Date).
- **Two-pane detail**: transcript (left) + AI notes (right) with a "Generate notes" button in the header.
- **Live indicator** is a red animated dot — never a sparkle or a robot icon.
- **Calendar empty state** mirrors `ConnectBuilderCard` layout: single CTA card + "Add API key" disclosure underneath.
- shadcn components only. Tabler icons (`IconCalendar`, `IconMicrophone2`, `IconWand`, `IconNotes`). No emojis as icons. No sparkle/robot.

## Cleanup pipeline

The `cleanup-transcript` action is the shared Gemini 3.1 Flash-Lite pass for Clips, Meetings, and Wispr. It resolves credentials in this order: Builder.io Connect → user's `GEMINI_API_KEY` → fallback. Tasks: `cleanup` | `title` | `summary+bullets+actions`.

The "Cleanup transcripts with AI" toggle in Settings → Voice & Transcription controls whether finalize calls run automatically (default ON when Builder is connected).
