---
title: "Voice Input"
description: "Voice dictation in the agent chat composer — OpenAI Whisper with a browser Web Speech fallback."
---

# Voice Input

Every agent-native app has a microphone in the chat composer. Click it, talk, and your words get transcribed into the prompt. Useful on mobile, useful for long prompts, useful when your hands are on something else.

The framework handles all of this automatically — no setup on your end other than an OpenAI API key for best-quality transcription.

## How it works {#how-it-works}

The composer's voice button records audio in the browser, then picks a provider:

1. **OpenAI Whisper (preferred).** If an `OPENAI_API_KEY` is configured, the browser POSTs the audio to `/_agent-native/transcribe-voice`, which proxies to Whisper and returns the transcript. Hard 25 MB limit per clip (Whisper's).
2. **Browser Web Speech API (fallback).** If no key is available, the composer falls back to the browser's built-in speech recognition. Works in Chromium-based browsers (Chrome, Edge, Arc) and Safari. Less accurate; streams live.

Provider choice is stored in application state under `settings.voiceTranscriptionProvider` (`"openai"` or `"browser"`) so the user can force one or the other in the sidebar settings.

The route is **same-origin only** — cross-site POSTs are rejected so an attacker can't burn your OpenAI credits from an external page.

## Enabling Whisper {#enabling-whisper}

Two ways to provide an OpenAI key:

### Per-user (recommended for SaaS)

The user sets their own key via the agent sidebar settings UI. It's stored as a user-scoped encrypted secret (via `readAppSecret`). Each user pays for their own transcription; zero cost to the host.

### Shared (for internal tools)

Set `OPENAI_API_KEY` as an environment variable or in the `settings` table. Every user's transcription hits the shared key.

The route checks user-scope first, then falls back to the shared credential — so a power user with their own key can override the shared one.

If no key is configured at all, the route returns a 400 the composer recognizes, and silently falls back to Web Speech.

## The route {#route}

`POST /_agent-native/transcribe-voice`

- **Body:** multipart form with a single `audio` part (webm/opus by default).
- **Response:** `{ text }` on success, `{ error }` on failure.
- **Auth:** requires an active session (Better Auth cookie).
- **Origin check:** same-origin only.
- **Max size:** 25 MB (Whisper's hard limit).

You don't need to call this directly — the composer does. But if you're building a custom input surface and want the same transcription, POST a `FormData` with an `audio` blob to the same route.

## Customizing the provider {#customizing}

The provider field is a plain application-state key, so the agent can change it on request (`"use the browser speech recognizer instead"`). If you're building a template with different requirements — say, an on-prem Whisper deployment — swap the route handler by registering your own `transcribe-voice` route before the framework mounts the default.

## What's next

- [**Drop-in Agent**](/docs/drop-in-agent) — the composer that exposes the voice button
- [**Onboarding**](/docs/onboarding) — registering the OpenAI key as a setup step
- [**Security & Data Scoping**](/docs/security) — how encrypted secrets are stored per user
