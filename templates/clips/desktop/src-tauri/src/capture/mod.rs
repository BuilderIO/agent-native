//! Platform-dispatched audio capture for meeting transcription.
//!
//! The local Whisper engine (`whisper_speech.rs`) needs exactly two capture
//! primitives — a microphone stream and a system-audio (loopback) stream —
//! each forwarding mono `f32` samples to a callback and exposing the hardware
//! sample rate plus a `stop()`. Everything else in the meeting pipeline
//! (detection, notifications, transcript rendering) is already cross-platform.
//!
//! This module owns that public contract and dispatches to the right backend
//! at compile time:
//!
//!   - macOS  → thin re-exports of the proven `native_speech` (AVAudioEngine +
//!              VPIO AEC) mic path and `system_audio` (ScreenCaptureKit) loopback.
//!   - Windows → `cpal` mic + WASAPI loopback (see `windows.rs`).
//!
//! Both backends expose the same names so `whisper_speech.rs` stays
//! platform-agnostic:
//!
//! ```ignore
//! start_raw_mic_capture(app, mic_device_id, mic_device_label, on_samples) -> RawMicCapture
//! start_raw_system_capture(app, on_samples) -> RawSystemCapture
//! ```
//!
//! Each handle type exposes `sample_rate() -> f64` and `stop()` so the session
//! teardown in `whisper_speech.rs` works unchanged across platforms.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub(crate) use macos::{
    start_raw_mic_capture, start_raw_system_capture, RawMicCapture, RawSystemCapture,
};

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub(crate) use windows::{
    start_raw_mic_capture, start_raw_system_capture, RawMicCapture, RawSystemCapture,
};
