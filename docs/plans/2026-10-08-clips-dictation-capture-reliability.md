# Clips Dictation Capture Reliability Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** A dictation press on macOS either captures real mic audio or falls back to a path that does. When neither works, the bar says why ("Microphone permission denied", "No audio from AirPods") instead of a bare "Could not transcribe".

**Architecture:** `e8fbabd36` (#6719) swapped the dictation capture path from AVAudioEngine to AVCaptureSession, with nothing at runtime confirming the new path delivers audio. It runs on every Mac by default (`macos-native` provider). The voice-bar level and the speech recognizer read the same buffers. So one capture failure (no callbacks, silent buffers, or a format mismatch) produces both reported symptoms: no mic level, then "Could not transcribe".

This plan:
1. Diagnoses the field failure first.
2. Removes the format assumption.
3. Adds a first-buffer and real-signal watchdog with automatic fallback to the old AVAudioEngine path.
4. Checks microphone permission explicitly.
5. Catches every Objective-C exception during setup.
6. Carries typed failure reasons to the UI.

A smaller second phase fixes the silent failure handling in the server transcription route.

**Tech Stack:** Tauri 2 desktop (`templates/clips/desktop`), Rust with `objc2` / `objc2-av-foundation` / `objc2-core-media` / `objc2-speech`, TypeScript (`src/lib/voice-dictation.ts`, `src/overlays/flow-bar.tsx`), Vitest. Phase 2 touches `@agent-native/core` (`packages/core/src/server/transcribe-voice.ts`).

> **Verification constraint:** AVFoundation capture cannot be exercised in the Linux cloud container. Every task that touches Rust capture code must be verified on a Mac, using a desktop build from the branch with the device matrix in Task 9. In the container, only `vitest` and TypeScript checks run. Say so explicitly in the PR; do not claim capture works from container checks.

---

## Root causes this plan addresses

| # | Problem | Evidence |
|---|---------|----------|
| 1 | A capture-path swap shipped with no runtime liveness check and no fallback. `start` succeeds once `session.isRunning()`, even if no buffer ever arrives. | `desktop/src-tauri/src/native_speech.rs:1009–1015`; `start_engine_audio` is now meetings-only (`:1284–1297`) |
| 2 | Hard-coded capture format: mono Float32, interleaved, no sample rate. The level meter then reads the raw bytes as `f32` whatever was actually delivered. | `native_speech.rs:931–951` (`capture_audio_settings`); `:910–929` (`peak_level_for_sample_buffer`) |
| 3 | Only speech-recognition permission is requested. Microphone authorization for AVCaptureDevice is never checked before capture, and macOS delivers silent buffers when it is denied. | `native_speech.rs:425–475` |
| 4 | Objective-C exceptions are caught only around `startRunning`. `addInput`, `setAudioSettings`, `addOutput`, and `setSampleBufferDelegate` can throw `NSInvalidArgumentException` and abort the process. | `native_speech.rs:990–1008` |
| 5 | Every failure collapses to "Could not transcribe". Device, permission, no-audio, no-speech, and server errors look the same to the user and to whoever triages a bug report. | `desktop/src/overlays/flow-bar.tsx:117, 170` |
| 6 | Any non-synthetic level event, even `0.0`, marks the meter as having a real signal and stops the synthetic animation. A dead mic therefore shows a flat bar with no explanation. | `desktop/src/lib/voice-dictation.ts:1835–1840` |
| 7 | (Phase 2, server path) Failures turn into plausible-looking values. A multipart parse failure becomes "Missing audio", and a session lookup failure becomes "Authentication required". | `packages/core/src/server/transcribe-voice.ts:110, 150` |

---

## Phase 1 — Native capture (desktop)

### Task 1: Diagnose the field failure before changing behavior

**Files:**
- Modify: `templates/clips/desktop/src-tauri/src/native_speech.rs` (delegate, `DictationCapture::stop`)

**Step 1: Ask for the existing log line from the affected machine.** The line is `[voice-dictation] native capture from <device> delivered <N> buffers (peak <P>)`. It is printed on stop by `native_speech.rs:1039–1044`. Interpret it as follows:

| Log | Meaning | Most relevant task |
|-----|---------|--------------------|
| `N = 0` | No callbacks at all: device, session, or delegate problem | Task 4 (watchdog + fallback) |
| `N > 0`, `P = 0.0000` | Silent buffers: permission denied or format mismatch | Tasks 2–3 |
| `N > 0`, `P > 0` | Capture is fine; the recognizer rejected the audio | Task 2 (format), Task 5 (reason codes) |
| No line | `start` returned an error before capture | Task 5 (surface the error) |

**Step 2: Log the actual delivered format once per session.** In `did_output_sample_buffer`, on the first buffer only (`n == 0`), read the format description: `sample_buffer.format_description()`, then the stream's basic description (`AudioStreamBasicDescription`). Log the sample rate, format id, format flags, bits per channel, channels per frame, and bytes per frame:

```
[voice-dictation] capture format from <device>: 48000 Hz, lpcm, flags=0x9, 32 bit, 1 ch, 4 B/frame
```

**Step 3: Build locally on a Mac.** Run `cargo check --manifest-path templates/clips/desktop/src-tauri/Cargo.toml`. Expected: exit 0. It cannot run in the Linux container because the AVFoundation crates are macOS-gated.

**Step 4: Commit**: `chore(clips-desktop): log delivered dictation capture format`

---

### Task 2: Stop forcing a capture format; decode whatever arrives

**Files:**
- Modify: `templates/clips/desktop/src-tauri/src/native_speech.rs`

**Step 1: Delete `capture_audio_settings()` and its `setAudioSettings` call.** Let AVCaptureAudioDataOutput deliver the device's native format. That is the format `SFSpeechAudioBufferRecognitionRequest.appendAudioSampleBuffer` is documented to accept for capture-session buffers. It also removes the case where the requested format and the meter's assumption disagree.

**Step 2: Make the peak meter format-aware.** Change `peak_level_for_sample_buffer` to read the format description:
- `kAudioFormatFlagIsFloat` with 32 bits: decode as `f32`.
- Signed integer with 16 bits: decode as `i16`, divided by 32768.
- Signed integer with 32 bits: decode as `i32`, divided by 2^31.
- Anything else: return `None`, not `0.0`. "Unreadable" must be a different value from "silent".

Keep the existing stride sampling (`step = len / 64`). Pull the decode into a pure function, `fn peak_from_bytes(bytes: &[u8], format: SampleFormat) -> Option<f32>`, so it can be unit-tested without AVFoundation.

**Step 3: Add `#[cfg(test)]` unit tests** next to the existing test module (`native_speech.rs:1732`):
- Float32 silence gives `Some(0.0)`.
- Float32 at ±0.5 gives `Some(0.5)`.
- Int16 at 16384 gives `Some(~0.5)`.
- An unknown format gives `None`.

Run: `cargo test --manifest-path templates/clips/desktop/src-tauri/Cargo.toml peak_from_bytes` on a Mac. Expected: pass.

**Step 4: When the meter returns `None`, skip emitting `voice:audio-level`,** so the frontend keeps its synthetic meter (see Task 6).

**Step 5: Commit**: `fix(clips-desktop): capture dictation audio in the device's native format`

---

### Task 3: Check microphone permission and catch every setup exception

**Files:**
- Modify: `templates/clips/desktop/src-tauri/src/native_speech.rs` (`DictationCapture::start`, permission helpers near `:425`)
- Check (read only): `templates/clips/desktop/src-tauri/src/permission_status.rs:45–65`

**Step 1: Check microphone authorization before opening the device.** Call `AVCaptureDevice::authorizationStatusForMediaType(AVMediaTypeAudio)`:
- `NotDetermined`: call `requestAccessForMediaType_completionHandler` and wait on the result, the same pattern as the speech-permission request at `:425–475`.
- `Denied` or `Restricted`: return `Err("mic-permission-denied: …")` immediately.
- `Authorized`: continue.

**Step 2: Wrap each throwing AVFoundation call.** Put `addInput`, `addOutput`, and `setSampleBufferDelegate_queue` each in `objc2::exception::catch(AssertUnwindSafe(|| …))`. Map each exception to `Err("capture-setup-failed: <call>: <exception>")`. `startRunning` is already wrapped; keep it.

**Step 3: Make every start error carry a reason-code prefix.** Use the form `<code>: <human detail>`. Codes:
- `mic-permission-denied`
- `mic-unavailable` (the `resolve_capture_device` failures)
- `capture-setup-failed`
- `capture-no-audio` (Task 4)
- `speech-permission-denied`

Task 5 parses these.

**Step 4: Verify on a Mac.** Revoke Clips' microphone access in System Settings, then dictate. Expected log: `native_speech_start failed: mic-permission-denied: …`. The process does not crash.

**Step 5: Commit**: `fix(clips-desktop): check mic permission and catch capture setup exceptions`

---

### Task 4: First-buffer and real-signal watchdog with AVAudioEngine fallback

**Files:**
- Modify: `templates/clips/desktop/src-tauri/src/native_speech.rs` (`DictationSampleIvars`, `DictationCapture::start`, the `SessionOwner::Dictation` branch at `:1284`)

**Step 1: Let the delegate signal its first buffer.** Add `first_buffer: Arc<(Mutex<bool>, Condvar)>` to `DictationSampleIvars`. On `n == 0`, set it and `notify_all()`.

**Step 2: Wait for that buffer in `DictationCapture::start`.** After `startRunning` succeeds, wait on the condvar for up to `CAPTURE_FIRST_BUFFER_TIMEOUT = 750ms`. This holds the command thread, not the audio thread. If it times out, call `stop()` and return `Err("capture-no-audio: <device> delivered no buffers in 750 ms")`. On success the wait ends as soon as the first buffer lands, typically 20–60 ms, so the healthy path pays almost nothing.

**Step 3: Fall back at the dictation branch.**

```rust
SessionOwner::Dictation => match DictationCapture::start(app.clone(), request.clone(), id, label) {
    Ok(capture) => SpeechAudio::Capture(capture),
    Err(err) if err.starts_with("capture-") => {
        eprintln!("[voice-dictation] {err}; falling back to AVAudioEngine");
        start_engine_audio(&app, &request, owner, id, label)?
    }
    Err(err) => return Err(err),
},
```

Permission and device-unavailable errors do not fall back; the engine would fail the same way. Capture-specific failures do.

**Step 4: Detect silent capture after start.** In the delegate, track `nonzero_seen: AtomicBool`, set when `peak > 1e-4`. Real mics produce a noise floor, while exact digital silence for 1.5 s means a dead path. Emit `voice:capture-silent` with `{ device }` once if no non-zero buffer arrives in the first 1.5 s after the first buffer. The frontend uses it to show a hint (Task 6).

Do not auto-switch paths mid-utterance; the recognizer request is already attached to this session.

**Step 5: Verify on a Mac.** Temporarily force the fallback by returning `Err("capture-no-audio: test")` from `start`. Dictation still works, through the engine path, and the log shows the fallback line. Revert.

**Step 6: Commit**: `fix(clips-desktop): fall back to AVAudioEngine when dictation capture is silent`

---

### Task 5: Carry typed failure reasons to the voice bar

**Files:**
- Create: `templates/clips/desktop/src/lib/dictation-failure.ts`
- Create: `templates/clips/desktop/src/lib/dictation-failure.test.ts`
- Modify: `templates/clips/desktop/src/lib/voice-dictation.ts` (the `startNative` catch around `:1134–1160`, the no-transcript paths at `:1617` and `:1672`, and the server `transcribe` throw at `:417`)
- Modify: `templates/clips/desktop/src/overlays/flow-bar.tsx`
- Modify: `templates/clips/desktop/src/i18n/en-US.ts`

**Step 1: Create `dictation-failure.ts`.**

```ts
export type DictationFailureReason =
  | "mic-permission-denied"
  | "speech-permission-denied"
  | "mic-unavailable"
  | "capture-no-audio"
  | "capture-setup-failed"
  | "no-speech"
  | "server-error"
  | "unknown";

const NATIVE_CODES = new Set<DictationFailureReason>([
  "mic-permission-denied",
  "speech-permission-denied",
  "mic-unavailable",
  "capture-no-audio",
  "capture-setup-failed",
]);

export function parseDictationFailure(err: unknown): DictationFailureReason {
  const code = String(err).split(":")[0]?.trim() as DictationFailureReason;
  return NATIVE_CODES.has(code) ? code : "unknown";
}
```

**Step 2: Test it.** Each native prefix maps to its code; a free-form string maps to `unknown`; `undefined` maps to `unknown`. Run: `pnpm --filter clips-desktop test -- dictation-failure`.

**Step 3: Set the reason everywhere dictation fails.** Add the reason to the event payload or state that drives the bar's `error` state.
- Native start failure: `parseDictationFailure(err)`.
- "no transcript captured": `"no-speech"`.
- Server non-OK response: `"server-error"`, keeping the HTTP status in the log.

**Step 4: Render the reason in `flow-bar.tsx`.** Map each reason to a short string from `src/i18n/en-US.ts`, for example "Microphone access is off", "No audio from <device>", or "Didn't catch that". Fall back to "Could not transcribe" only for `unknown`. Keep the strings short; the bar is a pill.

**Step 5: Verify.** Run `pnpm --filter clips-desktop test` and the desktop TypeScript check (`pnpm --filter clips-desktop typecheck`, or `tsc --noEmit -p templates/clips/desktop` if there is no script). Both must exit 0. Then on a Mac, with mic access denied, the bar shows "Microphone access is off".

**Step 6: Commit**: `fix(clips-desktop): say why dictation failed`

---

### Task 6: Keep the meter honest

**Files:**
- Modify: `templates/clips/desktop/src/lib/voice-dictation.ts` (`onAudioLevel` listener at `:1835`, synthetic meter at `:360–373`)
- Modify: `templates/clips/desktop/src/overlays/flow-bar.tsx`

**Step 1: Only treat a real level above the floor as a real signal.** Set `meterHasRealSignal` only when `level > 0.001`, so zero-valued events no longer kill the synthetic meter.

**Step 2: Show the silent-capture hint.** Listen for `voice:capture-silent` (Task 4 Step 4). While still recording, show an inline hint in the bar, "No mic input from <device>", using an `en-US.ts` string. Don't end the session; the user may simply not have started speaking into a muted headset.

**Step 3: Verify on a Mac.** Mute the input with the hardware mute or a muted AirPods mic, then dictate. The hint appears after about 1.5 s. Unmute and speak, and the level animates.

**Step 4: Commit**: `fix(clips-desktop): show when dictation hears no mic input`

---

## Phase 2 — Server transcription path (core)

Lower priority. This path is used by the Builder and BYOK providers, not the macOS default. It can't remove the live mic level, but it produces the same "Could not transcribe" for different causes.

### Task 7: Distinguish failures in `transcribe-voice`

**Files:**
- Modify: `packages/core/src/server/transcribe-voice.ts`
- Modify: `packages/core/src/server/transcribe-voice.spec.ts` (create it if absent)
- Create: `.changeset/<name>.md` (patch, `@agent-native/core`)

**Step 1: Stop turning a parse failure into "missing audio".** Replace `readMultipartFormData(event).catch(() => null)` at `:110`. A thrown parse error returns `400 { error: "Could not read audio upload", code: "multipart-invalid" }`. "Missing audio" stays only for a successful parse that has no audio part.

**Step 2: Stop turning a session failure into "authentication required".** Replace `getSession(event).catch(() => null)` at `:150`. A thrown lookup returns `503 { error: "Session lookup failed", code: "session-unavailable" }` and logs the error. 401 stays only for a successful lookup with no user.

**Step 3: Add spec cases** for both distinctions, then run `pnpm --filter @agent-native/core test -- transcribe-voice`.

**Step 4: Confirm desktop requests pass the origin check.** `isSameOriginRequest` (`packages/core/src/server/request-origin.ts:127`) returns early on any `Sec-Fetch-Site` header, so the `tauri://localhost` allowance below it never runs when WKWebView sends `cross-site`.
- Capture the real request headers from a desktop server-path dictation on a Mac.
- Only if they include `Sec-Fetch-Site: cross-site`, add a spec that reproduces the 403, then move the `tauri:` origin check above the `fetchSite` return.
- Do not change it speculatively. This file was just reworked in `b119a3df8` (#7012).

**Step 5: Add the changeset** (`@agent-native/core: patch`): "transcribe-voice returns distinct errors for unreadable uploads and session lookup failures."

**Step 6: Commit**: `fix(core): report distinct transcribe-voice failures`

### Task 8: Scale the desktop server-transcription timeout

**Files:**
- Modify: `templates/clips/desktop/src/lib/voice-dictation.ts:400`

**Step 1:** Replace the fixed `8_000` ms abort, which covers upload plus transcription, with `Math.min(60_000, 8_000 + audioDurationMs * 0.5)`. Track `audioDurationMs` from the session start and stop timestamps.

**Step 2:** On abort, report the reason as `server-error`, with "timed out" in the log.

**Step 3: Commit**: `fix(clips-desktop): give long dictations time to transcribe`

---

## Task 9: Device matrix sign-off (Mac, branch build)

Run every row with the default `macos-native` provider. For each, record the stop log line, the format log line, and the visible result.

| Input | Permission | Expected |
|-------|-----------|----------|
| Built-in mic | Granted | Level animates; text pastes |
| AirPods (the #6719 target) | Granted | Level animates; text pastes; no fallback line |
| USB mic | Granted | Level animates; text pastes |
| Saved mic that is unplugged | Granted | "No audio from …" or "Microphone unavailable", no crash |
| Built-in mic | Denied | "Microphone access is off", no crash |
| Built-in mic | Not determined (`tccutil reset Microphone <bundle id>`) | OS prompt appears; dictation works after granting |
| AirPods, during an active meeting transcription | Granted | Both keep working; stopping one doesn't stop the other (#6570 behavior) |
| Built-in mic, during a screen recording | Granted | Dictation works; recording audio unaffected |

Then:
- Add the changelog entry from `templates/clips`: `agent-native changelog add "Dictation now falls back automatically when a microphone delivers no audio and says why it failed" --type fixed`.
- Changeset check: Phase 1 is template-only, so no changeset. Phase 2 needs the core changeset from Task 7.
- Run `pnpm guards`. Expected: all pass, with nothing SKIPPED.

## Final verification checklist

- [ ] Task 1 diagnosis recorded in the PR: which row of the interpretation table the field failure matched.
- [ ] `cargo test` (on a Mac) passes, including the `peak_from_bytes` tests.
- [ ] `pnpm --filter clips-desktop test` and the desktop typecheck pass.
- [ ] Every Task 9 matrix row passes on a branch desktop build.
- [ ] Forced-fallback test shows dictation still works through AVAudioEngine.
- [ ] Phase 2: `pnpm --filter @agent-native/core test -- transcribe-voice` passes, and the changeset is present.

## Open questions

1. If Task 1 shows `N > 0, P > 0` while the recognizer still fails, the problem is recognizer-side, not capture. Does `appendAudioSampleBuffer` reject the native format for some devices? If so, Task 2 needs a conversion step through `AVAudioConverter` into an `AVAudioPCMBuffer`, then `appendAudioPCMBuffer`, instead of the raw sample buffer.
2. Should the fallback decision be remembered per device for the rest of the app session, so a known-bad device skips the 750 ms watchdog on later presses? This plan leaves it out until the matrix shows the watchdog firing in practice.
