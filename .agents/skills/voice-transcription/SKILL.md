---
name: voice-transcription
description: >-
  Framework-wide voice dictation in the agent sidebar composer. Use when
  changing composer microphone UX, the transcribe-voice route, or the
  Voice Transcription settings section. Covers provider routing (Builder /
  OpenAI Whisper / browser Web Speech API) and the provider-preference
  application-state key.
---

# Voice Transcription

Click-to-toggle microphone inside the sidebar composer turns speech into
text. Users can pick a provider from Settings → Voice Transcription. The
feature is available in every template that renders `TiptapComposer`.

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

## Providers

| Provider         | Backend                                                         | Quality | Needs key                    |
| ---------------- | --------------------------------------------------------------- | ------- | ---------------------------- |
| `builder-gemini` | `POST /_agent-native/transcribe-voice` → Builder Gemini Flash-Lite | High    | Builder.io account connected |
| `builder`        | `POST /_agent-native/transcribe-voice` → Builder proxy          | High    | Builder.io account connected |
| `gemini`         | `POST /_agent-native/transcribe-voice` → Google Gemini BYOK     | High    | `GEMINI_API_KEY`             |
| `groq`           | `POST /_agent-native/transcribe-voice` → Groq Whisper           | High    | `GROQ_API_KEY`               |
| `openai`         | `POST /_agent-native/transcribe-voice` → OpenAI Whisper         | High    | `OPENAI_API_KEY`             |
| `browser`        | Web Speech API (`webkitSpeechRecognition`)                      | Low     | No                           |

Selection is persisted in `application_state["voice-transcription-prefs"]`
as `{ provider: "builder-gemini" | "builder" | "gemini" | "groq" | "openai" | "browser" }`.
When no preference is saved, Builder-connected users default to
`builder-gemini`; everyone else defaults to `browser` in the web composer.

## Where the pieces live

| File                                                                  | Purpose                                             |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/core/src/client/composer/useVoiceDictation.ts`              | Provider-routing hook (MediaRecorder / Web Speech)  |
| `packages/core/src/client/composer/VoiceButton.tsx`                   | Mic button + live amplitude + cancel overlay        |
| `packages/core/src/client/composer/TiptapComposer.tsx`                | Wires the hook, insertion, and keyboard shortcut    |
| `packages/core/src/client/settings/VoiceTranscriptionSection.tsx`     | Provider radio in sidebar settings                  |
| `packages/core/src/client/transcription/BuilderTranscriptionCta.tsx`  | CTA shown when Builder account isn't connected      |
| `packages/core/src/client/transcription/use-live-transcription.ts`    | Web Speech live-transcription hook for recordings   |
| `packages/core/src/server/transcribe-voice.ts`                        | Route handler (routes to Builder/Gemini/Groq/Whisper) |
| `packages/core/src/transcription/builder-transcription.ts`            | Builder proxy transcription client                  |
| `packages/core/src/secrets/register-framework-secrets.ts`             | Framework-level provider key registration           |

## Key resolution (server)

`transcribe-voice.ts` routes based on the user's provider preference:

1. If `builder-gemini` and `resolveHasBuilderPrivateKey()` → calls `transcribeWithBuilder({ model: "gemini-3-1-flash-lite" })` via Builder proxy.
2. If `builder` and `resolveHasBuilderPrivateKey()` → calls `transcribeWithBuilder()` via Builder proxy.
3. If `gemini` → resolves `GEMINI_API_KEY` and calls the direct Google Gemini path.
4. If `groq` → resolves `GROQ_API_KEY` and calls Groq's Whisper-compatible endpoint.
5. If `openai` → resolves `OPENAI_API_KEY`:
   - `readAppSecret({ key: "OPENAI_API_KEY", scope: "user", scopeId: session.email })` — user's encrypted secret.
   - `resolveCredential("OPENAI_API_KEY")` — env var + SQL settings fallback.

In auto mode / no preference, the route tries Builder Gemini Flash-Lite first
when Builder is connected, then Gemini BYOK, Groq, and OpenAI.

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
