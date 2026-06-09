//! macOS capture backend — thin re-exports of the existing native impls.
//!
//! The high-quality macOS path is left entirely untouched: the microphone runs
//! through `native_speech` (AVAudioEngine + VoiceProcessingIO AEC) and the
//! system audio through `system_audio` (ScreenCaptureKit). This file only
//! surfaces them under the platform-agnostic names the `capture` contract and
//! `whisper_speech.rs` expect.

pub(crate) use crate::native_speech::macos::{start_raw_mic_capture, RawMicCapture};
pub(crate) use crate::system_audio::macos::{start_raw_system_capture, RawSystemCapture};
