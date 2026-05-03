//! System-audio capture via ScreenCaptureKit. **Not yet implemented.**
//!
//! v1 ships mic-only via `native_speech.rs` (which already wires up
//! AVAudioEngine + SFSpeechRecognizer for the user's microphone). This
//! module exposes the public command surface so the renderer can feature-
//! detect by attempting `system_audio_start` and falling back gracefully.
//!
//! Implementation TODO: ScreenCaptureKit's audio tap landed in macOS 13 and
//! is the right way to capture the speaker output without virtual audio
//! drivers. Two paths from here:
//!
//!   1. Add the `screencapturekit` crate (current latest 1.5.4 — verified
//!      via `cargo search`). Its `SCStream` + `SCStreamConfiguration` give
//!      us a CMSampleBuffer of audio frames we can feed into a second
//!      SFSpeechRecognizer running in parallel with the mic recognizer in
//!      `native_speech.rs`. SFSpeechRecognizer is single-channel, so the
//!      "two recognizers, merge segments by timestamp" approach is what
//!      Granola itself appears to do.
//!   2. Hand-roll the selectors via `objc2` (same approach taken in
//!      `eventkit.rs`). Heavier — SCStream's delegate protocol is large.
//!
//! The renderer should treat a `system_audio_start` error as "system audio
//! unavailable on this OS / permissions denied" and continue with mic-only.

use tauri::AppHandle;

#[tauri::command]
pub async fn system_audio_start(app: AppHandle) -> Result<(), String> {
    let _ = app;
    Err("system_audio_start: ScreenCaptureKit audio tap is not yet implemented (mic-only fallback in use)".into())
}

#[tauri::command]
pub async fn system_audio_stop(app: AppHandle) -> Result<(), String> {
    let _ = app;
    Err("system_audio_stop: ScreenCaptureKit audio tap is not yet implemented".into())
}
