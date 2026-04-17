---
name: ai-video-tools
description: >-
  All AI features in Clips — titles, summaries, chapters, tags, filler-word
  removal — delegate to the agent chat via sendToAgentChat. Transcription is
  the one exception: it calls Whisper directly with OPENAI_API_KEY. Use when
  adding any AI-powered feature.
---

# AI Video Tools

## Rule

Every AI feature in Clips goes through the agent chat. The UI and server never call an LLM directly. **One exception:** transcription. Whisper takes audio, not prompts — the `transcribe-recording` action calls the OpenAI Whisper endpoint directly using `OPENAI_API_KEY`.

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
| **Transcription**         | On upload complete (automatic)                                                        | `transcribe-recording` → direct Whisper API call — see "Transcription" section below                  |

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

For UI-triggered AI (a sparkle button next to the title — **wait, no sparkle icons**, use something like `IconWand` or `IconBolt`), call the same action via `useActionMutation`:

```tsx
const generate = useActionMutation("generate-ai-metadata");
<Button onClick={() => generate.mutate({ id: rec.id, kind: "title,summary" })}>
  <IconWand className="mr-2" />
  Suggest
</Button>
```

## Transcription — the one exception

Whisper takes an audio file and returns text + segments. That's not a prompt/response LLM interaction, so it doesn't belong in the agent chat. Clips calls the OpenAI Whisper endpoint directly using `OPENAI_API_KEY`.

```ts
// actions/transcribe-recording.ts
export default defineAction({
  schema: z.object({ id: z.string() }),
  run: async ({ id }) => {
    await assertAccess("recording", id, "editor");
    const rec = await getRecordingOrThrow(id);
    if (!rec.videoUrl) throw new Error("Recording is not uploaded yet");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const videoBlob = await fetch(rec.videoUrl).then((r) => r.blob());
    const form = new FormData();
    form.append("file", videoBlob, `${id}.webm`);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Whisper failed: ${res.status}`);
    const data = await res.json();

    // Write to recording_transcripts, then refresh.
    // ...
  },
});
```

### Secret registration

`OPENAI_API_KEY` will be declared via the upcoming `registerRequiredSecret` API in `server/plugins/onboarding.ts`:

```ts
// Upcoming — pattern, not yet finalized.
registerRequiredSecret({
  key: "OPENAI_API_KEY",
  label: "OpenAI API key",
  description: "Used for Whisper transcription of recordings.",
  docsUrl: "https://platform.openai.com/api-keys",
});
```

This pushes a card into the onboarding checklist so the user is prompted before transcription runs. Until `registerRequiredSecret` ships, we read `OPENAI_API_KEY` from `.env` and throw a friendly "not configured" error at action time.

## Don't

- Don't `import OpenAI from "openai"` anywhere except `actions/transcribe-recording.ts`.
- Don't `import Anthropic from "@anthropic-ai/sdk"` — the agent is already Claude.
- Don't build a "Clips AI" dialog that duplicates the agent chat. Use the agent chat.
- Don't render a robot or sparkle icon for AI affordances — use Tabler's `IconWand`, `IconBolt`, or `IconSparkles` — actually, **no** `IconSparkles` either. Pick `IconWand` or `IconBolt`.
- Don't dump entire transcripts into `sendToAgentChat` context. Pass the id; let the agent fetch.
- Don't `await` the agent's response from an action. Fire and forget; results arrive via other actions.

## Related skills

- `delegate-to-agent` — the framework-wide rule this skill is grounded in.
- `video-editing` — filler-word removal writes proposed cuts into `editor-draft` for user review.
- `recording` — transcription kicks off automatically when upload completes.
- `onboarding` — how the OpenAI key gets collected on first run.
