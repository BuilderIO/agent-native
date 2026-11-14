---
name: voice-transcription
description: >-
  Framework-wide voice dictation in the agent sidebar composer. Use when
  changing composer microphone UX, the transcribe-voice route, or the
  Voice Transcription settings section. Covers transcription-source routing,
  cleanup routing, Google realtime gating, and the voice transcription
  application-state keys.
scope: dev
metadata:
  internal: true
---

# Voice Transcription

The sidebar composer offers two distinct paths: the mic always starts editable
dictation, and the empty-draft primary button starts an opt-in realtime
speech-to-speech agent session.
Users configure dictation separately from AI cleanup. The source picker (Mac
Native, Google Realtime, Batch) is the Voice transcription row on Settings ›
Account › Preferences (`VoiceTranscriptionSection compact`, anchor `voice`);
cleanup and batch provider keys stay in the agent sidebar's Voice
Transcription section. Both write the per-user `voice-transcription-prefs`
application state. Both paths are available in every template that renders
the shared agent sidebar.

## UX rules

- **Always show the mic alongside the send button.** Replacing send with the
  mic when the composer is empty confuses users, so keep both visible.
- **The mic is dictation, with no chooser.** A click starts dictation at once;
  the browser's permission prompt is the only step in between. A blocked,
  missing, or busy microphone shows the amber composer notice with Try again,
  and the mic stays clickable. Do not read `voice-input-preference` app
  state.
- **Voice chat lives in the primary slot.** With an empty draft, no run, no
  dictation, and a ready realtime provider (Builder or OpenAI), Send shows a
  voice-chat glyph and starts realtime voice. Any draft (text, attachment,
  Plan chip) turns it back into Send; without a provider it is a dimmed Send.
- **Dictation is click-to-toggle, not push-to-talk.** More forgiving in a sidebar, avoids
  host-app hotkey clashes. Keyboard shortcut is `Cmd/Ctrl+Shift+M` and
  `Escape` cancels mid-recording.
- **Transcript lands in the composer, editable, never auto-sent.** Insert at
  the caret via `editor.chain().focus().insertContent(text).run()`.
- **Recording grows from the mic.** While dictating, the mic's slot becomes a
  pill with a waveform driven by the analyser level (written from an animation
  frame, never through React state) and a stop button. Stop inserts the
  transcript; Escape cancels. Under reduced motion the bars stay still.
- **Icons:** Tabler `IconMicrophone` (idle), `IconPlayerStopFilled` (stop), and
  the toolkit's five-bar `IconVoiceChat` (voice chat, from
  `composer/voice-chat-icon`). `IconWaveSine` reads as a heartbeat; never use
  it, a sparkle, or a robot icon for voice.
- **Errors via inline alert or toast, never `window.alert`.**

## Realtime speech mode

Realtime speech mode is a full-duplex OpenAI Realtime WebRTC session, separate
from the dictation providers below. It prefers the authenticated user's
complete Builder connection and the Builder-managed metered gateway. A scoped
`OPENAI_API_KEY` is the fallback when Builder is not connected. The server owns
the `gpt-realtime-2.1` session configuration and keeps credentials out of
browser code. Voice chat is offered only once one of them is configured.

- Voice chat lives in the composer. While a session
  is on, the mic's slot holds a status pill (live bars from the microphone
  while you speak, muted bars from the assistant's audio while it speaks, and
  the session status) and speaker and microphone mute toggles, nothing
  else; the primary slot is an End voice chat X, never red, that spins
  while connecting or ending. Muting the microphone disables the WebRTC input
  track; muting the speaker mutes playback only. The editor locks behind a
  "Listening…" placeholder: the realtime session takes no typed input, so a
  typed draft would start a separate run the voice agent never hears. Errors
  use the composer's amber notice with Try again.
- At silence the bars rest at their baseline; under reduced motion they stay
  still and fade with the level. When the session becomes live, the assistant
  gives one brief spoken greeting so readiness is unambiguous. Do not apply a
  text-sized `max_output_tokens` cap to that audio greeting because audio
  tokens can truncate it mid-sentence.
- Voice device, language, intelligence and voice style live only in Settings
  › Account › Preferences › Voice chat (`VoiceChatSettings`), never in the
  composer. Those rows write the same preferences a session reads:
  `application_state["realtime-voice-prefs"]` and the browser-local
  microphone choice. A session re-reads them every time it starts, so a
  change applies to the next voice chat.
- Semantic VAD keeps listening, starts responses automatically, and supports
  barge-in while the agent is speaking.
- Function calls must cross the authenticated realtime tool bridge and enter
  `executeAgentToolCall`. Never call `ActionEntry.run` directly: that bypasses
  schema validation, approvals, audit/journal behavior, timeouts, redaction,
  and mutation refreshes.
- Preserve the active browser-tab id in request context so `set-url-path`,
  `set-search-params`, `view-screen`, and tab-scoped application state affect
  the app the user is actually speaking to. Realtime tool manifests are capped,
  so prioritize `navigate`, `set-url-path`, `set-search-params`, and
  `view-screen` before packing large template registries.
- Keep `tool-search` in the initial Realtime manifest. A successful specific
  search may expand the live session with matching action schemas, but the
  server must derive those schemas from its own registry, bind authorization
  to the authenticated voice session, and continue execution through
  `executeAgentToolCall`. Treat `session.update.tools` as a full replacement:
  preserve the pinned navigation/discovery tools, evict lower-priority entries
  within the manifest cap, and wait for `session.updated` before asking the
  model to continue with a newly discovered tool.
- Do not persist audio. Transcript deltas stream into the chat thread that
  was on screen when the session started, as ordinary user and assistant
  messages that fill in under one id per turn; the shared `AgentKitChat`
  consumes them, so every host shows them. A turn is saved with the thread
  only once its transcript completes (a streaming turn is never saved), and
  ending or failing the session finalizes what was heard. Input transcription
  completes asynchronously from assistant generation, so reserve provider
  conversation item order: a turn appears only after every earlier turn has
  appeared, and completion arrival time never sets chat order. Ending voice
  chat opens that chat so the user can continue over text. Store only compact lifecycle and latest
  context at `application_state["realtime-voice-session"]`; delete it when the
  session ends.
- Store the user-controlled language, intelligence, and output-voice choices at
  `application_state["realtime-voice-prefs"]`. Keep this separate from
  `voice-transcription-prefs`, which configures editable dictation rather than
  the speech-to-speech session.
- Missing-key failures should open Settings focused on the user-scoped
  `OPENAI_API_KEY` field. Never send, log, or echo the key to the browser.

## Source And Cleanup

Settings must keep these as separate choices:

- **Live transcription source**: `mac-native`, `google-realtime`, or `batch`.
- **AI cleanup**: independent off/on toggle. Cleanup uses managed Gemini first
  when a managed AI services connection is configured, then BYOK Gemini (the one
  Gemini key, `GOOGLE_GENERATIVE_AI_API_KEY`; older `GEMINI_API_KEY` rows still work).
  Gemini cleanup/title/summary generation is not a live STT source.

`application_state["voice-transcription-prefs"]` stores
`{ transcriptionMode, provider, instructions }`. The legacy `provider` field
is still written for old clients and batch provider preferences:

| Value             | Meaning                                                        | Needs key                    |
| ----------------- | -------------------------------------------------------------- | ---------------------------- |
| `mac-native`      | Native macOS/Tauri speech path; web clients normalize to browser-native where needed | No                           |
| `google-realtime` | Dedicated WebSocket → Google Speech-to-Text gRPC `StreamingRecognize` path | `GOOGLE_APPLICATION_CREDENTIALS` |
| `batch`           | Upload audio after stop through the existing batch route       | Builder/Gemini/Groq/OpenAI depending on fallback |
| `auto` provider   | Browser SpeechRecognition when supported; server batch fallback chain otherwise | No key needed in browsers that support SpeechRecognition |
| `builder-gemini`  | Managed Gemini Flash-Lite batch/cleanup preference             | Managed AI services account connected |
| `gemini`          | Direct Google Gemini BYOK batch/cleanup preference             | `GOOGLE_GENERATIVE_AI_API_KEY` (or legacy `GEMINI_API_KEY`) |
| `groq`            | Groq Whisper batch preference                                  | `GROQ_API_KEY`               |
| `openai`          | OpenAI Whisper batch preference                                | `OPENAI_API_KEY`             |
| `browser`         | Legacy native/browser live speech preference                   | No                           |

Default behavior:

- The shared web settings/composer default to Batch / `auto`. In `auto` mode,
  `useVoiceDictation` uses `startBrowser()` (Web Speech API, no key required,
  incremental streaming) when the browser supports `SpeechRecognition`. It only
  falls back to the MediaRecorder → server upload path when `SpeechRecognition`
  is not available (e.g. Firefox). This means dictation works out of the box in
  Chrome, Edge, and Safari without any API key configuration.
- Dedicated macOS Tauri-native surfaces may save `mac-native`, but do not
  assume the shared React settings default to it.
- Old stored `builder` values are treated as `builder-gemini`.
- Old stored `browser` values are treated as `mac-native`.
- Saved `google-realtime` preferences must never hit `/_agent-native/transcribe-voice`. They go through the dedicated session bridge `POST /_agent-native/transcribe-stream/session`, which mints an opaque ai-services websocket session and keeps the Google service-account JSON off the client.
- In the current bridge, the Google option is only actually ready when both the user's `GOOGLE_APPLICATION_CREDENTIALS` secret exists and a managed AI services connection is configured, because the framework mints the managed ai-services session before streaming begins.

## Where the pieces live

| File                                                                  | Purpose                                             |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/toolkit/src/composer/useVoiceDictation.ts`                  | Provider-routing hook (MediaRecorder / Web Speech)  |
| `packages/toolkit/src/composer/VoiceButton.tsx`                       | Mic, recording pill, voice-chat Send, error notice  |
| `packages/toolkit/src/composer/RealtimeVoiceMode.tsx`                | Composer voice chat controls and settings           |
| `packages/toolkit/src/composer/useRealtimeVoiceMode.tsx`             | WebRTC lifecycle, provider events, and tool bridge  |
| `packages/toolkit/src/composer/TiptapComposer.tsx`                    | Wires the hook, insertion, and keyboard shortcut    |
| `packages/core/src/client/settings/VoiceTranscriptionSection.tsx`     | Live source + cleanup controls in sidebar settings; `compact` is the Preferences row |
| `packages/core/src/client/transcription/BuilderTranscriptionCta.tsx`  | CTA shown when Builder account isn't connected      |
| `packages/core/src/client/transcription/use-live-transcription.ts`    | Web Speech live-transcription hook for recordings   |
| `packages/core/src/server/transcribe-voice.ts`                        | Route handler (routes to Builder/Gemini/Groq/Whisper) |
| `packages/core/src/server/realtime-voice.ts`                          | Authenticated OpenAI SDP and action-tool routes     |
| `packages/core/src/transcription/builder-transcription.ts`            | Builder proxy transcription client                  |
| `packages/core/src/voice/`                                            | Shared voice context pack, prompt, and replacement helpers |
| `packages/core/src/secrets/register-framework-secrets.ts`             | Framework-level provider key registration           |

## Key resolution (server)

`transcribe-voice.ts` is batch-only. Do not add realtime streaming to this
route. Google Speech-to-Text realtime uses a dedicated audio-frame protocol:
client audio frames → `/_agent-native/transcribe-stream/session` →
ai-services WebSocket → Google gRPC `StreamingRecognize` → partial / final
transcript events. Use the canonical docs URL:
https://cloud.google.com/speech-to-text/v2/docs/streaming-recognize

Batch routing is based on the user's provider preference:

1. If `builder-gemini` and `resolveHasBuilderPrivateKey()` → calls `transcribeWithBuilder({ model: "gemini-3-1-flash-lite" })` via Builder proxy, or uses Builder Gemini Flash-Lite to clean up a live native/browser transcript when the desktop client sends text instead of audio.
2. If `builder` and `resolveHasBuilderPrivateKey()` → legacy alias; prefer `builder-gemini`.
3. If `gemini` → resolves the Gemini key under either name (`resolveGeminiApiKey`) and calls the direct Google Gemini path.
4. If `groq` → resolves `GROQ_API_KEY` and calls Groq's Whisper-compatible endpoint.
5. If `openai` → resolves `OPENAI_API_KEY`:
   - `readAppSecret({ key: "OPENAI_API_KEY", scope: "user", scopeId: session.email })` — user's encrypted secret.
   - `resolveCredential("OPENAI_API_KEY")` — env var + SQL settings fallback.

In auto mode / no preference, the route tries Builder Gemini Flash-Lite first
when Builder is connected, then Gemini BYOK, Groq, and OpenAI. The
organization's **Voice input** provider (Settings › Infrastructure, the
`manage-service-providers` action, org setting `service-providers`) moves one
of those to the front; a chosen provider with no key is skipped, a failed
Builder or Gemini attempt falls through, and the first Whisper-compatible
provider with a key answers. Read the order with
`serviceProviderOrder("voice", choice)`; never re-list it. The org choice
applies only when the user's own provider is auto: a user's single-provider
preference (and the live source: Mac native, Google realtime, or Batch) stays
per user and wins. An unreadable org setting fails the request with 503 rather
than using the default order, and `/_agent-native/voice-providers/status`
reports it as `orgProvider` (with `orgProviderLookupFailed` when unreadable).
When a request includes `instructions`, pass them through to the selected LLM
provider. Gemini uses them in the transcription prompt, Builder receives them
as transcription/cleanup instructions, and Whisper-compatible providers receive
them as provider prompt/context.

Requests may also include a multipart `voiceContext` JSON field. Parse it with
`parseVoiceContextPack()` from `@agent-native/core/voice` and pass the resulting
context through `buildVoiceGuidanceBlock()`; do not hand-roll separate prompt
formats. The context pack is for bounded snippets, active references, route/page
metadata, and preferred vocabulary/replacements only. Browser-native and Google
realtime final text can POST `{ text, provider, instructions, voiceContext }` to
`/_agent-native/transcribe-voice` when AI cleanup is enabled; batch audio can
send the same `voiceContext` field with its audio upload.

Never hardcode a shared key. Never log the value. Never echo it back to the
client.

## Overriding per-template

Templates can:
- **Disable the mic**: pass `voiceEnabled={false}` to `TiptapComposer`.
- **Replace the button**: wrap `TiptapComposer` and render your own `extraActionButton`; the framework mic stays immediately before the primary send/stop control. Use `stopButton` for an active-run control so the disabled send button becomes stop when the draft is empty and returns when the user types.
- **Pre-register provider keys as `required: true`**: call `registerRequiredSecret(...)` from your own server plugin when a template needs a specific BYOK provider in onboarding.

## Don'ts

- Don't call transcription providers from the client — go through `/_agent-native/transcribe-voice` so the user's secret stays server-side.
- Don't remove the cancel affordance — mic permission abuse paranoia is real.
- Don't auto-submit the transcript — users always edit before sending.
- Don't route realtime tool calls around the central guarded agent executor.
- Don't persist realtime audio or put provider keys in SDP/session payloads.
- Don't hide send when the composer is empty; it confuses users.
