---
name: voice-transcription
description: >-
  Framework-wide voice dictation in the agent sidebar composer. Use when
  changing composer microphone UX, the transcribe-voice route, or the
  Voice Transcription settings section. Covers transcription-source routing,
  cleanup routing, Google realtime gating, and the voice transcription
  application-state keys.
---

# Voice Transcription

Click-to-toggle microphone inside the sidebar composer turns speech into
text. Users configure live transcription separately from AI cleanup in
Settings → Voice Transcription. The feature is available in every template
that renders `TiptapComposer`.

## UX rules

- **Always show the mic alongside the send button.** Cursor replaces send
  with mic when the composer is empty; their users complain. We keep both
  visible — Lovable does the same.
- **Click-to-toggle, not push-to-talk.** More forgiving in a sidebar, avoids
  host-app hotkey clashes. Keyboard shortcut is `Cmd/Ctrl+Shift+M` and
  `Escape` cancels mid-recording.
- **Transcript lands in the composer, editable, never auto-sent.** Insert at
  the caret via `editor.chain().focus().insertContent(text).run()`.
- **No CSS transitions for the recording state.** Framework rule; use static
  brand color (`#625DF5`) instead of pulses.
- **Icon:** Tabler `IconMicrophone` (idle) / `IconPlayerStopFilled` (recording).
  Never use a sparkle or robot icon.
- **Errors via inline alert or toast, never `window.alert`.**

## Source And Cleanup

Settings must keep these as separate choices:

- **Live transcription source**: `mac-native`, `google-realtime`, or `batch`.
- **AI cleanup**: independent off/on toggle. Cleanup uses Builder Gemini first
  when Builder.io Connect is configured, then BYOK Gemini (`GEMINI_API_KEY`).
  Gemini cleanup/title/summary generation is not a live STT source.

`application_state["voice-transcription-prefs"]` stores
`{ transcriptionMode, provider, instructions }`. The legacy `provider` field
is still written for old clients and batch provider preferences:

| Value             | Meaning                                                        | Needs key                    |
| ----------------- | -------------------------------------------------------------- | ---------------------------- |
| `mac-native`      | Native macOS/Tauri speech path; web clients normalize to browser-native where needed | No                           |
| `google-realtime` | Future dedicated WebSocket → Google Speech-to-Text gRPC `StreamingRecognize` path | `GOOGLE_APPLICATION_CREDENTIALS` |
| `batch`           | Upload audio after stop through the existing batch route       | Builder/Gemini/Groq/OpenAI depending on fallback |
| `auto` provider   | Existing batch fallback chain                                  | Any configured batch provider |
| `builder-gemini`  | Builder Gemini Flash-Lite batch/cleanup preference             | Builder.io account connected |
| `gemini`          | Direct Google Gemini BYOK batch/cleanup preference             | `GEMINI_API_KEY`             |
| `groq`            | Groq Whisper batch preference                                  | `GROQ_API_KEY`               |
| `openai`          | OpenAI Whisper batch preference                                | `OPENAI_API_KEY`             |
| `browser`         | Legacy native/browser live speech preference                   | No                           |

Default behavior:

- The shared web settings/composer default to Batch / `auto`.
- Dedicated macOS Tauri-native surfaces may save `mac-native`, but do not
  assume the shared React settings default to it.
- Old stored `builder` values are treated as `builder-gemini`.
- Old stored `browser` values are treated as `mac-native`.
- Saved `google-realtime` preferences must not hit `/_agent-native/transcribe-voice`; until the streaming endpoint exists, clients should fall back safely rather than trying to retrofit streaming into the batch route.

## Where the pieces live

| File                                                                  | Purpose                                             |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/core/src/client/composer/useVoiceDictation.ts`              | Provider-routing hook (MediaRecorder / Web Speech)  |
| `packages/core/src/client/composer/VoiceButton.tsx`                   | Mic button + live amplitude + cancel overlay        |
| `packages/core/src/client/composer/TiptapComposer.tsx`                | Wires the hook, insertion, and keyboard shortcut    |
| `packages/core/src/client/settings/VoiceTranscriptionSection.tsx`     | Live source + cleanup controls in sidebar settings  |
| `packages/core/src/client/transcription/BuilderTranscriptionCta.tsx`  | CTA shown when Builder account isn't connected      |
| `packages/core/src/client/transcription/use-live-transcription.ts`    | Web Speech live-transcription hook for recordings   |
| `packages/core/src/server/transcribe-voice.ts`                        | Route handler (routes to Builder/Gemini/Groq/Whisper) |
| `packages/core/src/transcription/builder-transcription.ts`            | Builder proxy transcription client                  |
| `packages/core/src/secrets/register-framework-secrets.ts`             | Framework-level provider key registration           |

## Key resolution (server)

`transcribe-voice.ts` is batch-only. Do not add realtime streaming to this
route. Google Speech-to-Text realtime needs a dedicated audio-frame protocol:
client audio frames → WebSocket → Google gRPC `StreamingRecognize` → partial /
final transcript events. Use the canonical docs URL:
https://cloud.google.com/speech-to-text/v2/docs/streaming-recognize

Batch routing is based on the user's provider preference:

1. If `builder-gemini` and `resolveHasBuilderPrivateKey()` → calls `transcribeWithBuilder({ model: "gemini-3-1-flash-lite" })` via Builder proxy, or uses Builder Gemini Flash-Lite to clean up a live native/browser transcript when the desktop client sends text instead of audio.
2. If `builder` and `resolveHasBuilderPrivateKey()` → legacy alias; prefer `builder-gemini`.
3. If `gemini` → resolves `GEMINI_API_KEY` and calls the direct Google Gemini path.
4. If `groq` → resolves `GROQ_API_KEY` and calls Groq's Whisper-compatible endpoint.
5. If `openai` → resolves `OPENAI_API_KEY`:
   - `readAppSecret({ key: "OPENAI_API_KEY", scope: "user", scopeId: session.email })` — user's encrypted secret.
   - `resolveCredential("OPENAI_API_KEY")` — env var + SQL settings fallback.

In auto mode / no preference, the route tries Builder Gemini Flash-Lite first
when Builder is connected, then Gemini BYOK, Groq, and OpenAI.
When a request includes `instructions`, pass them through to the selected LLM
provider. Gemini uses them in the transcription prompt, Builder receives them
as transcription/cleanup instructions, and Whisper-compatible providers receive
them as provider prompt/context.

Never hardcode a shared key. Never log the value. Never echo it back to the
client.

## Overriding per-template

Templates can:
- **Disable the mic**: pass `voiceEnabled={false}` to `TiptapComposer`.
- **Replace the button**: wrap `TiptapComposer` and render your own `extraActionButton` (the framework mic sits between `extraActionButton` and the send button).
- **Pre-register provider keys as `required: true`**: call `registerRequiredSecret(...)` from your own server plugin when a template needs a specific BYOK provider in onboarding.

## Don'ts

- Don't call transcription providers from the client — go through `/_agent-native/transcribe-voice` so the user's secret stays server-side.
- Don't remove the cancel affordance — mic permission abuse paranoia is real.
- Don't auto-submit the transcript — users always edit before sending.
- Don't copy Cursor's "hide send when empty" pattern — it confuses users.
