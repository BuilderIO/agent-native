---
name: dictate
description: >-
  The Dictate tab in Clips — press-and-hold desktop dictation, mobile voice
  dictation, history, AI cleanup, and native capture hand-offs. Use when
  listing past dictations, polishing dictation text, or wiring native capture.
---

# Dictate

## When to use

Reach for this skill any time the user asks about a past dictation, the press-and-hold UX, or how the desktop app captures the audio. Specifically:

- Listing past dictations at `/dictate` (`view: "dictate"`).
- Opening a single dictation with original + AI-cleaned text (`dictationId`).
- Cleaning up a single dictation's text after the fact.
- Touching the Hold-Fn / Cmd+Shift+Space hand-off from the desktop tray.

For meetings (calendar-synced events with summaries + attendees), use the `meetings` skill instead.

## Design reference

The press-and-hold UX intentionally mirrors **Wispr Flow**. See `templates/clips/desktop/design-refs/wispr-ux.md` for the source-of-truth interaction notes (hold-to-record, instant paste-on-release, no UI chrome, low-latency overlay, transcript-then-cleanup pipeline). Read this file before changing the dictation UX — agents have repeatedly broken Wispr-style flow by inserting modals, confirmation steps, or extra clicks.

## Data model touched

- **`dictations`** — `id`, `fullText`, `cleanedText`, `durationMs`, `audioUrl`,
  `source` (desktop shortcuts, `manual`, or `mobile`), `createdAt`,
  `ownableColumns()`.

`fullText` is the raw native transcript captured on-device (macOS Speech / Web Speech). `cleanedText` is the optional AI-polished version produced by the shared `cleanup-transcript` pipeline. UI shows `cleanedText ?? fullText`.

## Audio source

Dictate captures **mic only** — system audio is never recorded for dictations. (System audio split is a Meetings-only feature, where mic + system are tagged separately so transcripts attribute speech to the user vs other attendees.)

## Actions

| Action               | What it does                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `list-dictations`    | Past dictations, scoped via `accessFilter`                                                  |
| `cleanup-dictation`  | Polish a single dictation's text (writes `cleanedText`)                                     |
| `cleanup-transcript` | Shared cleanup pipeline (also used by Clips + Meetings); resolves credentials per the order below |

All actions go through `accessFilter` / `assertAccess`. AI work delegates via `sendToAgentChat` per the `delegate-to-agent` skill — never inline LLM calls.

## Cleanup credential order

The `cleanup-transcript` action resolves credentials in this order — **always lead with Builder.io Connect**:

1. **Builder.io Connect (primary)** — managed Gemini 3.1 Flash-Lite. Easiest path; no key required. Recommend this first whenever the user asks how to enable cleanup.
2. **BYOK Gemini (secondary)** — user's own `GEMINI_API_KEY` (direct to Google's `generativelanguage` API). Mention only as a fallback when the user can't or won't connect Builder. The `cleanup-transcript` action does **not** route to Groq or OpenAI — those keys are used by `transcribe-voice` (transcription), not cleanup.

The "Cleanup transcripts with AI" toggle in Settings → Voice & Transcription gates whether cleanup runs automatically (default ON when Builder is connected).

## Navigation state

The app exposes `view` and `dictationId`:

```json
{ "view": "dictate" }
{ "view": "dictate", "dictationId": "dct_xyz" }
```

`view-screen` includes the active dictation's metadata + cleaned/raw text snippet automatically — see the `meetings` skill's "view-screen output" section for the full shape.

## Common tasks

| User request                              | What to do                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| "Show me what I dictated yesterday"       | `pnpm action navigate --view=dictate`                                                   |
| "Open that dictation about the launch"    | `list-dictations`, find by snippet, then `pnpm action navigate --view=dictate --dictationId=<id>` |
| "Clean up that dictation"                 | `pnpm action cleanup-dictation --id=<id>`                                               |
| "Polish the last 5 dictations"            | `list-dictations --limit=5`, then loop `cleanup-dictation --id=<id>`                    |

## Hold-Fn UX

The press-and-hold flow is **owned by the desktop app** (`src-tauri/`). On Hold-Fn or Cmd+Shift+Space:

1. Desktop tray captures mic audio while the key is held.
2. macOS Speech transcribes locally; text is pasted instantly on release (Wispr-style).
3. The dictation row is created via the framework HTTP layer — the agent does not start/stop dictations.
4. AI cleanup is a background pass via `cleanup-dictation`, not in the hot path — never block paste-on-release on a network round-trip.

Agents must **never** wire dictation start/stop server-side. Desktop key
listeners and the mobile capture UI own those user gestures.

## Mobile dictation

The Agent Native iOS/Android app exposes Dictate from native Home, deep links,
and OS quick actions. Mobile is click-to-toggle rather than hold-to-talk:

1. `expo-audio` records mic-only M4A and persists it under the app documents
   directory before any network request.
2. A durable capture-queue row protects the audio across interruptions, app
   restarts, and upload failures.
3. The named mobile voice client posts multipart audio to the authenticated
   `/_agent-native/transcribe-voice` route. Provider keys never enter the app.
4. The cleaned transcript is editable, copied to the OS clipboard, and saved
   with `create-dictation --source=mobile`; edits use `update-dictation`.
5. The audio also syncs to Clips through the resumable recording upload path so
   a failed transcription never destroys the captured speech.

Do not auto-send mobile dictation to an agent or another app. iOS/Android quick
actions open capture; clipboard is the cross-app fallback until platform
keyboard/accessibility insertion is enabled.

## UI conventions (don't break)

- List view = expandable rows. Original on top, cleaned text below when expanded.
- Live indicator (while dictating) is a red animated dot — never a sparkle or robot icon.
- Tabler icons only (`IconMicrophone2`, `IconWand`).
- Inter font, monochrome aesthetic — same conventions as the rest of Clips.

## How the agent uses Dictate

- "What did I say about Q3 budget?" → `list-dictations`, grep `cleanedText ?? fullText` for matches, return the snippet + a `navigate --view=dictate --dictationId=<id>` link.
- "Turn that ramble into bullet points" → read the dictation, then delegate to the agent chat for transformation (don't inline an LLM call).
- "Stop saving my dictations" → toggle the relevant Settings switch; do not delete history without explicit confirmation.
