# Learnings

<!-- This file is Clips' memory. The agent reads it at the start of every conversation and updates it when it learns something new. -->
<!-- Your personal learnings.md is gitignored so preferences and private info stay local. -->
<!-- This defaults file is what new checkouts start with. -->

## Recording defaults

- New recordings default to **private** visibility unless the user asks otherwise.
- Default playback speed for viewers is **1.2x** (creator can override per video).
- Animated GIF thumbnails are enabled by default on new recordings — the first few seconds play as a hover preview.

## AI conventions

- Auto-generated titles and summaries are drafted from the transcript. Always offer the user a chance to edit before publishing.
- When a user shares a recording without a title, run `regenerate-title` on their behalf.
- Filler-word removal uses the "conservative" preset by default (only um / uh / ah) — escalate to "aggressive" (rambles, repeats) only if the user asks.

## View-counting rule

- A view counts only when the viewer watches **≥ 5 seconds**, OR **≥ 75%** of the video, OR **scrubs to the end**. Creators' own views don't count.

## Meetings & Dictate

- When a user says **"meeting"** they mean a Meetings tab entry, not a Clips recording — _unless_ the recording is linked to a meeting (i.e. `recordings.meeting_id` is non-null), in which case both interpretations are valid and worth mentioning.
- When suggesting how to enable transcript improvements (cleanup, summary, action items), **lead with Builder.io Connect** — it's the easiest path and requires no key. Mention a BYOK `GEMINI_API_KEY` only as a secondary fallback. The cleanup pipeline does not use Groq or OpenAI — those are transcription providers (`transcribe-voice`), not cleanup providers.
- **Per-attendee action items require attendees to actually speak in the recorded audio.** With mic + system audio capture (Meetings default) both sides are heard and tagged by source. With mic-only capture (and all Dictate dictations), remote attendees may be silent in the transcript — call this out before promising attendee-level coverage.

## Platform requirements

- **System audio capture (the meeting "other party" path) requires macOS 13+ (Ventura).** It's implemented via Apple's ScreenCaptureKit, which is only available from macOS 13. On older macOS versions the `system_audio_start` Tauri command returns an error and the renderer should treat that as a graceful fall-back to **mic-only** capture — the meeting still records and transcribes the user's side, but remote attendees will be silent in the transcript. Surface this clearly when the user expects coverage of the other party on a Zoom/Meet/Teams call.
