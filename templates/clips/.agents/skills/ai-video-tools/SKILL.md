---
name: ai-video-tools
description: >-
  All AI features in Clips — titles, summaries, chapters, tags, filler-word
  removal — delegate to the agent chat via sendToAgentChat except the narrow
  media pipeline path: transcription. Use when adding any
  AI-powered feature.
---

# AI Video Tools

## Rule

Every AI feature in Clips goes through the agent chat unless it is the narrow media-pipeline exception below. The UI and server should not add broad shadow agents or inline chat workflows. **Exception:** transcription. Transcription takes audio, not prompts — the `request-transcript` action calls the transcription API directly. Provider priority for transcription: **native** first (browser Web Speech API, desktop local Whisper/macOS SFSpeech when available, and desktop Web Speech fallback on non-mac, saved via `save-browser-transcript`, no key required) → **cloud fallback** when native text is missing: **Builder.io managed** Gemini (via `BUILDER_PRIVATE_KEY` or a connected Builder account, no extra key needed) → **Groq** `whisper-large-v3-turbo` via `GROQ_API_KEY` (fast, ~$0.04/hr). Clips never routes recording/meeting audio to OpenAI for transcription.

Builder.io is the primary setup path: it brings managed AI credits, object
storage, uploads, and transcription together. Bring-your-own-key setup belongs
in the agent sidebar's **API Keys & Connections** panel; Clips settings can
signpost that existing panel, but should not add a second key-management
surface.

## Why

The agent is already the user's primary interface — it has full project context, can chain tool calls, and can ask follow-up questions. Shadow LLM calls inside UI components create a second AI that doesn't know what the agent knows and can't coordinate with it. See the framework `delegate-to-agent` skill for the full argument.

## Features and how they delegate

| Feature                   | Trigger                                                                               | What the action does                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Include full video        | User toggles "Include full video" in the AI tools menu                                | `update-clips-ai-prefs --includeFullVideoInAi=true\|false` → stored in `clips-user-prefs`; default off |
| Default title             | Native/cloud transcript becomes ready and the recording still has an automatic title   | `regenerate-title --recordingId=<id> --includeSummary=true` tries the transcript-only Gemini fast path, keeps any local heuristic title replaceable, and queues a `generate-metadata` agent refinement that writes a specific title plus description. If Include full video is on, it always delegates so the agent watches the recording |
| Manual title suggestion   | User asks the agent "rename this"                                                     | Agent reads transcript and calls `update-recording --id=<id> --title=...`                             |
| Summary / description     | Transcript becomes ready, or user clicks "Summarize" / "Regenerate description"       | The automatic metadata handoff or `regenerate-summary` asks the agent to write `update-recording --description=...`. Existing user-authored descriptions are preserved. With Include full video, the agent must watch the clip, not transcript alone |
| Chapters                  | User clicks "Add chapters" or transcript > 3 minutes                                  | `generate-chapters --id=<id>` / `regenerate-chapters` → agent writes `chapters_json` (same full-video preference) |
| Tags                      | On upload complete                                                                    | `generate-ai-metadata --id=<id> --kind=tags` → agent inserts `recording_tags` rows                    |
| Filler-word removal       | User clicks "Remove ums and uhs"                                                      | `generate-filler-removal --id=<id>` → agent writes proposed cuts into `editor-draft` for user review  |
| Comment auto-reply        | User types "reply with …" in the agent chat                                           | agent calls `add-comment` directly                                                                    |
| **Transcription**         | On upload complete (automatic) + live during recording                                | `request-transcript` → native (Web Speech / macOS SFSpeech) first, then cloud fallback Builder.io managed Gemini → Groq; `save-browser-transcript` for instant Web Speech result — see "Transcription" section below |

## Include full video

Screen recordings often have thin or misleading audio ("real quick", "um this
thing"). Titles, descriptions, chapters, and workflow docs (PR / SOP / ticket /
email) are more accurate when the agent can **see** the UI, product names, and
on-screen text.

- Preference key: `includeFullVideoInAi` on user setting `clips-user-prefs`.
- UI: checkbox at the top of the recording-page **AI tools** dropdown (copy
  notes Gemini-only).
- Actions: `get-clips-ai-prefs`, `update-clips-ai-prefs`.
- **Gemini only:** sending / understanding the full recording video requires a
  Gemini model (Builder Gemini or `GEMINI_API_KEY`). Claude and OpenAI cannot
  ingest the MP4/WebM. When the preference is on, the AI-request bridge prefers
  Builder `gemini-3-5-flash` for that turn.
- When on, queued `clips-ai-request-*` messages include instructions to attach
  or upload the recording to Gemini when possible, otherwise use
  `get-recording-player-data` / `create-recording-agent-link` and follow
  recommended frames / the frame API across the timeline — not transcript only.
- Default title generation also honors this: `regenerate-title` skips the
  transcript-only Gemini cleanup path and always queues the agent. Automatic
  post-transcription work uses one `generate-metadata` request so title and
  description are not competing application-state entries.

Do not invent a parallel "video LLM" path in the UI. Keep the preference on the
shared user-prefs object and keep delegation through the agent chat.

## The delegation pattern

From an action, kick work over to the agent chat in **background mode** so the user doesn't see a new message bubble mid-playback:

```ts
import { defineAction, sendToAgentChat } from "@agent-native/core";
import { z } from "zod";
import { getRecordingOrThrow } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Generate AI metadata for a recording. Delegates to the agent chat in the background so it can use its full toolchain.",
  schema: z.object({
    id: z.string(),
    kind: z
      .string()
      .default("title,summary")
      .describe("Comma-separated: title, summary, tags"),
  }),
  run: async ({ id, kind }) => {
    const rec = await getRecordingOrThrow(id);
    const kinds = kind.split(",").map((s) => s.trim());

    await sendToAgentChat({
      background: true,
      message: `Generate ${kinds.join(" + ")} for recording "${rec.title}" (${id}). Read the transcript via \`get-transcript --id=${id}\` and write results via \`update-recording --id=${id} --title=... --description=...\`.`,
      context: {
        recordingId: id,
        title: rec.title,
        durationMs: rec.durationMs,
        kinds,
      },
      submit: true,
    });

    return { queued: true, kinds };
  },
});
```

Key rules:

- **`background: true`** — the request runs in a hidden agent thread. The user's main chat is untouched.
- **`context`** — structured data the agent gets but the user doesn't see. Keep it small — ids, titles, durations. Don't dump the whole transcript; the agent can fetch it via `get-transcript`.
- **`submit: true`** — auto-submit. These are routine, user-approved operations.
- **Never `await` the agent's response from an action.** Fire and forget. The agent will write results back via other actions (`update-recording`, `apply-edit`), and `refresh-signal` will push them to the UI.

For UI-triggered AI — **no wand, no sparkles, no robot icons** (all three are overplayed clichés for AI). Prefer plain text with a caret (`IconChevronDown`) on a dropdown, or a neutral verb icon like `IconBolt` only if an icon is truly needed. Call the same action via `useActionMutation`:

```tsx
const generate = useActionMutation("generate-ai-metadata");
<Button onClick={() => generate.mutate({ id: rec.id, kind: "title,summary" })}>
  Suggest
  <IconChevronDown className="ml-2 h-4 w-4" />
</Button>
```

## Media-pipeline exception

Transcription takes an audio file and returns text + segments. That's not a prompt/response LLM interaction, so it doesn't belong in the agent chat. `actions/request-transcript.ts` calls the transcription API directly.

**Provider priority:**

1. **Native (highest priority).** The browser's Web Speech API, desktop local Whisper/macOS SFSpeech when available, and desktop Web Speech fallback on non-mac run during recording and save results via `save-browser-transcript`. This gives an instant transcript with no API key when the local/browser recognizer is available. When `request-transcript` runs afterward, it preserves the ready native transcript and only falls back to a cloud provider if native text is missing.
2. **Cloud fallback — Builder.io managed (Gemini).** When a Builder account is connected (`BUILDER_PRIVATE_KEY` or per-user OAuth, no separate API key needed), `request-transcript` calls `transcribeWithBuilder()`, which routes audio to Builder.io's managed Gemini transcription. Returns text plus timestamped segments. Retry a failed transcript with `force: true`; pass `regenerate: true` to replace an existing ready transcript from the stored recording media. Regeneration keeps the prior ready transcript available if the new provider attempt fails.
3. **Cloud fallback — Groq Whisper.** `GROQ_API_KEY` → `https://api.groq.com/openai/v1/audio/transcriptions`, model `whisper-large-v3-turbo`. Fast (~$0.04/hour of audio) Whisper-compatible speech-to-text used when Builder is unavailable.

Clips never routes recording/meeting audio to OpenAI for transcription. (Groq's endpoint is OpenAI-_compatible_ in request shape only — the audio goes to Groq, not OpenAI.)

If no native transcript exists and no cloud fallback is available (no Builder connection and no Groq key), the action writes `status="failed"` so the UI can show a friendly prompt.

When a transcript becomes ready, `request-transcript` must await native cleanup
and the metadata handoff before its durable post-finalize worker returns.
Do not leave title/summary work as an unawaited promise in that worker:
serverless runtimes may freeze it immediately. A local heuristic title uses
`titleSource: "context"` so it remains a temporary UI fallback until the
`generate-metadata` agent request replaces it with a transcript-backed title.

If Builder transcription fails because credits are exhausted, explain that
Builder.io credits/upgrade or a Groq key are the supported speech-to-text
fallbacks. Generic OpenAI or Anthropic chat keys power chat, but they do not
transcribe Clips recordings.

### Secret registration

Builder transcription needs no app-specific key (the connected Builder.io account or `BUILDER_PRIVATE_KEY` carries the grant). The only transcription API key declared in `server/register-secrets.ts` is the optional Groq key, so it appears in the agent sidebar settings UI:

```ts
registerRequiredSecret({
  key: "GROQ_API_KEY",
  label: "Groq API Key (recommended)",
  description:
    "Fast speech-to-text fallback via Groq. Builder Gemini Flash-Lite is preferred when connected; Groq is used only when Builder/native transcription is unavailable.",
  docsUrl: "https://console.groq.com/keys",
  scope: "user",
  kind: "api-key",
  required: false,
});
```

It is not marked `required: true` — videos still upload and play without a Groq key when video storage is connected, since native transcription (and Builder when connected) already cover the common case. The API Keys & Connections panel surfaces it so the user can add the Groq fallback if they want it.

## Live transcription during recording

The `useLiveTranscription` hook (from `@agent-native/core/client/transcription`) runs the browser's Web Speech API alongside any recording. It accumulates final transcript text in real time with no API key required. When the user stops, the client calls `save-browser-transcript` to persist the result. `request-transcript` preserves that native result and only falls back to cloud transcription when native text is missing.

A future pass could add server-side streaming transcription (Deepgram Nova-3 / AssemblyAI) via WebSocket for even higher quality real-time output — but the browser path already gives useful text from second zero.

## Don't

- Don't route Clips recording/meeting audio to OpenAI for transcription. The cloud fallback is Builder.io managed Gemini → Groq Whisper only; don't add an OpenAI transcription path or `import OpenAI from "openai"`.
- Don't `import Anthropic from "@anthropic-ai/sdk"` — the agent is already Claude.
- Don't build a "Clips AI" dialog that duplicates the agent chat. Use the agent chat.
- Don't render a robot, sparkle, or wand icon for AI affordances — all three are overplayed. Prefer plain text (or a neutral verb icon like `IconBolt`) for AI buttons.
- Don't dump entire transcripts into `sendToAgentChat` context. Pass the id; let the agent fetch.
- Don't `await` the agent's response from an action. Fire and forget; results arrive via other actions.

## Related skills

- `delegate-to-agent` — the framework-wide rule this skill is grounded in.
- `video-editing` — filler-word removal writes proposed cuts into `editor-draft` for user review.
- `recording` — transcription kicks off automatically when upload completes.
- `onboarding` — how Builder-first setup and BYOK links are surfaced.
