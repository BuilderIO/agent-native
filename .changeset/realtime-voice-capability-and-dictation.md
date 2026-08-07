---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fix realtime voice tool calls failing with "Invalid or expired realtime voice capability" on serverless deploys. The capability minted by `/_agent-native/realtime-voice/session` lived in a per-process `Map`, so under `NITRO_PRESET=netlify` a tool call that landed on a different instance than the SDP request was rejected — the agent would report that it could not read the current selection and ask the user to reopen the editor. The capability is now an HMAC-signed token carrying the caller's identity, browser tab, and allowed tool names, so any instance can verify it.

Two behavior changes follow from that. The grant no longer slides on use — it cannot be extended server-side — so its TTL is now an absolute 75 minutes, covering the provider's maximum session length. And when a `tool-search` widens the manifest, the tool response carries a re-issued capability that the client adopts; without it, calls to the newly discovered tools would 404.

Fix dictation stopping instantly with no error anywhere. `SpeechRecognition` always fires `end` after `error`, and `useVoiceDictation`'s `end` handler returned the composer to idle — erasing the message `onerror` had just set. Every speech failure was therefore invisible in both the UI and the console. `end` no longer overwrites a reported error.

Dictation also survives browsers that ship `SpeechRecognition` without a speech backend. Brave exposes `webkitSpeechRecognition` but removed the Google service behind it, so `auto` mode selected a recognizer that can only ever fail with `network`. In `auto` mode a recognizer that produced no text — because it failed, or because it ended before the microphone opened — now falls back to the MediaRecorder upload path. Permission and device errors are excluded, since retrying those through another provider fails identically. A mid-session drop that already captured speech keeps the transcript rather than failing over.

The amplitude meter's own `getUserMedia` also moved to after recognition claims the microphone, since taking the device first can make Chrome abort the session.
