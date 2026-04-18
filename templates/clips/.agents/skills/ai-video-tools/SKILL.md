---
name: ai-video-tools
description: >-
  All AI features in Clips — titles, summaries, chapters, tags, filler-word
  removal — delegate to the agent chat via sendToAgentChat. Transcription is
  the one exception: it calls Whisper directly (Groq whisper-large-v3-turbo
  preferred, OpenAI whisper-1 fallback). Use when adding any AI-powered feature.
---

# AI Video Tools

## Rule

Every AI feature in Clips goes through the agent chat. The UI and server never call an LLM directly. **One exception:** transcription. Whisper takes audio, not prompts — the `request-transcript` action calls a Whisper endpoint directly. It prefers **Groq** `whisper-large-v3-turbo` via `GROQ_API_KEY` (typically 10x faster than OpenAI, ~$0.04/hr) and falls back to OpenAI `whisper-1` via `OPENAI_API_KEY`. Either key unlocks transcription.

## Why

The agent is already the user's primary interface — it has full project context, can chain tool calls, and can ask follow-up questions. Shadow LLM calls inside UI components create a second AI that doesn't know what the agent knows and can't coordinate with it. See the framework `delegate-to-agent` skill for the full argument.

## Features and how they delegate

| Feature                   | Trigger                                                                               | What the action does                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Title suggestion          | User clicks ✨ next to the title field, or asks the agent "rename this"               | `generate-ai-metadata --id=<id> --kind=title` → `sendToAgentChat({ background: true, context })`      |
| Summary / description     | Upload completes, or user clicks "Summarize"                                          | `generate-ai-metadata --id=<id> --kind=summary` → agent writes `update-recording --description=...`   |
| Chapters                  | User clicks "Add chapters" or transcript > 3 minutes                                  | `generate-chapters --id=<id>` → agent writes `chapters_json`                                          |
| Tags                      | On upload complete                                                                    | `generate-ai-metadata --id=<id> --kind=tags` → agent inserts `recording_tags` rows                    |
| Filler-word removal       | User clicks "Remove ums and uhs"                                                      | `generate-filler-removal --id=<id>` → agent writes proposed cuts into `editor-draft` for user review  |
| Comment auto-reply        | User types "reply with …" in the agent chat                                           | agent calls `add-comment` directly                                                                    |
| **Transcription**         | On upload complete (automatic)                                                        | `request-transcript` → direct Whisper API call (Groq preferred, OpenAI fallback) — see "Transcription" section below |

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

## Transcription — the one exception

Whisper takes an audio file and returns text + segments. That's not a prompt/response LLM interaction, so it doesn't belong in the agent chat. `actions/request-transcript.ts` calls a Whisper-compatible endpoint directly.

**Provider priority** (either key works — both are registered via `registerRequiredSecret`):

1. `GROQ_API_KEY` → `https://api.groq.com/openai/v1/audio/transcriptions`, model `whisper-large-v3-turbo`. **Preferred.** Typically 10-30x faster than OpenAI's hosted Whisper, ~$0.04/hour of audio, OpenAI-compatible multipart form-data shape.
2. `OPENAI_API_KEY` → `https://api.openai.com/v1/audio/transcriptions`, model `whisper-1`. Fallback. Fine, just slower — can take as long as the video itself for anything beyond a minute or two.

Both accept the same `file` / `model` / `response_format=verbose_json` / `timestamp_granularities[]=segment` form fields, so the action just swaps endpoint + model based on which key is available.

```ts
// actions/request-transcript.ts (excerpt)
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_MODEL = "whisper-1";

async function pickProvider(userEmail: string | null) {
  const groqKey = await resolveKey("GROQ_API_KEY", userEmail);
  if (groqKey)
    return {
      name: "groq",
      endpoint: GROQ_ENDPOINT,
      model: GROQ_MODEL,
      apiKey: groqKey,
    };
  const openaiKey = await resolveKey("OPENAI_API_KEY", userEmail);
  if (openaiKey)
    return {
      name: "openai",
      endpoint: OPENAI_ENDPOINT,
      model: OPENAI_MODEL,
      apiKey: openaiKey,
    };
  return null;
}
```

If neither key is set, the action writes `status="failed"` with `failureReason="No transcription key configured. Set GROQ_API_KEY (fast) or OPENAI_API_KEY."` so the UI can show a friendly prompt and `refresh-signal` pulls it immediately.

### Secret registration

Both keys are declared in `server/register-secrets.ts` so they appear in the agent sidebar settings UI:

```ts
registerRequiredSecret({
  key: "GROQ_API_KEY",
  label: "Groq API Key (recommended)",
  description:
    "Fast Whisper transcription via whisper-large-v3-turbo — ~10x faster than OpenAI, ~$0.04/hour.",
  docsUrl: "https://console.groq.com/keys",
  scope: "user",
  kind: "api-key",
  required: false,
});

registerRequiredSecret({
  key: "OPENAI_API_KEY",
  label: "OpenAI API Key",
  description: "Fallback Whisper transcription (whisper-1).",
  docsUrl: "https://platform.openai.com/api-keys",
  scope: "user",
  kind: "api-key",
  required: false,
});
```

Neither is marked `required: true` — videos still upload and play without transcription, they just won't have captions or AI-generated titles/summaries. The onboarding checklist surfaces both so the user can pick one.

## Follow-up — real-time streaming transcription

Right now `request-transcript` only runs after the upload finalizes, so a title can't be generated until the full media is on disk. The MediaRecorder chunk pipeline already pushes audio+video to the server every few seconds; a future pass can tap the audio track in parallel and stream it to a real-time provider:

- **Browser side:** `MediaStream.getAudioTracks()[0]` → `AudioWorkletNode` → downsample to 16kHz PCM → WebSocket.
- **Server side:** proxy WebSocket frames to **Deepgram** streaming (Nova-3 supports real-time) or **AssemblyAI** Universal-Streaming. Both give interim and final transcripts as the user speaks.
- **UX:** as `final` transcripts land, append to `recording_transcripts.segments_json` with `status="streaming"`. When the user stops, either accept the streamed transcript as-is or fire one `request-transcript` pass for a higher-quality final run.

This unlocks agent-generated titles / summaries within seconds of pressing Stop rather than minutes. Out of scope for the initial Groq swap — don't build it without a separate design pass.

## Don't

- Don't `import OpenAI from "openai"` anywhere except `actions/request-transcript.ts` (and it uses `fetch` directly, not the SDK).
- Don't `import Anthropic from "@anthropic-ai/sdk"` — the agent is already Claude.
- Don't build a "Clips AI" dialog that duplicates the agent chat. Use the agent chat.
- Don't render a robot, sparkle, or wand icon for AI affordances — all three are overplayed. Prefer plain text (or a neutral verb icon like `IconBolt`) for AI buttons.
- Don't dump entire transcripts into `sendToAgentChat` context. Pass the id; let the agent fetch.
- Don't `await` the agent's response from an action. Fire and forget; results arrive via other actions.

## Related skills

- `delegate-to-agent` — the framework-wide rule this skill is grounded in.
- `video-editing` — filler-word removal writes proposed cuts into `editor-draft` for user review.
- `recording` — transcription kicks off automatically when upload completes.
- `onboarding` — how the OpenAI key gets collected on first run.
