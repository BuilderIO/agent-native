//! Windows capture backend — `cpal` microphone + WASAPI loopback system audio.
//!
//! `cpal` is the single cross-platform crate that covers both primitives the
//! Whisper engine needs on Windows:
//!
//!   - **Microphone:** the default (or label-matched) WASAPI input device.
//!   - **System audio:** WASAPI *loopback* — `cpal` builds an input stream on
//!     the default *output* device, which sets `AUDCLNT_STREAMFLAGS_LOOPBACK`
//!     and captures whatever the speakers are playing. No OS permission prompt.
//!
//! Both paths down-mix the device's native interleaved format (any
//! `SampleFormat`, any channel count) to mono `f32`, forward it to
//! `on_samples`, and emit `voice:audio-level` on the same cadence as the macOS
//! backend so the silence detector and waveform UI behave identically. The real
//! device sample rate is reported via `sample_rate()`; `whisper_speech.rs`
//! resamples to 16 kHz from there.
//!
//! ## Known limitation (v1): no mic AEC
//!
//! macOS applies hardware acoustic echo cancellation (VoiceProcessingIO) so the
//! mic stream doesn't echo the system audio. `cpal` delivers the raw mic with
//! no AEC, so expect some speaker bleed into the mic transcript when the user
//! is not on headphones. Acceptable for v1 — mic and system are transcribed and
//! labeled separately. No software AEC is added here.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{FromSample, SampleFormat, SizedSample, Stream, StreamConfig};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Mirrors the macOS `voice:audio-level` payload so the waveform meter and the
/// silence detector consume an identical event shape on every platform.
#[derive(Serialize, Clone)]
struct AudioLevelPayload {
    level: f32,
    source: &'static str,
}

// ---- public handles ---------------------------------------------------------

/// Handle for a running cpal microphone capture. Dropping the inner `Stream`
/// (via `stop()`) tears down the WASAPI client and its callback thread.
pub(crate) struct RawMicCapture {
    stream: Stream,
    sample_rate: f64,
}

// SAFETY: cpal's WASAPI `Stream` holds COM interface pointers and is `!Send`.
// We never call methods on it from another thread — the only cross-thread
// operation is moving the handle into the session `Mutex` and later dropping
// it, which signals the capture thread to stop. This mirrors the macOS handles'
// `unsafe impl Send`.
unsafe impl Send for RawMicCapture {}

impl RawMicCapture {
    /// Hardware sample rate of the mic stream (e.g. 48000) — the Whisper engine
    /// resamples to 16 kHz from this.
    pub(crate) fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    pub(crate) fn stop(self) {
        drop(self.stream);
    }
}

/// Handle for a running WASAPI loopback (system audio) capture.
pub(crate) struct RawSystemCapture {
    stream: Stream,
    #[allow(dead_code)]
    sample_rate: f64,
}

// SAFETY: same argument as `RawMicCapture`.
unsafe impl Send for RawSystemCapture {}

impl RawSystemCapture {
    pub(crate) fn stop(self) {
        drop(self.stream);
    }
}

// ---- sample conversion ------------------------------------------------------

/// Down-mix an interleaved buffer of any sample format / channel count to mono
/// `f32`. cpal may deliver `i16`/`u16`/`f32`/… and 1–N channels; we average all
/// channels per frame so neither stereo music nor multi-channel mixes are
/// truncated to one side.
fn interleaved_to_mono_f32<T>(data: &[T], channels: usize) -> Vec<f32>
where
    T: Copy,
    f32: FromSample<T>,
{
    if channels <= 1 {
        return data.iter().map(|&s| f32::from_sample(s)).collect();
    }
    let frames = data.len() / channels;
    let mut out = Vec::with_capacity(frames);
    for frame in 0..frames {
        let base = frame * channels;
        let mut acc = 0.0f32;
        for c in 0..channels {
            acc += f32::from_sample(data[base + c]);
        }
        out.push(acc / channels as f32);
    }
    out
}

/// Peak absolute amplitude of a mono buffer — the level the waveform meter and
/// silence detector expect.
fn peak_level(mono: &[f32]) -> f32 {
    mono.iter().fold(0.0f32, |m, &s| m.max(s.abs()))
}

// ---- stream construction ----------------------------------------------------

/// Build a cpal input stream for sample type `T`, converting each callback
/// buffer to mono `f32` and forwarding it to `mono_cb`.
fn build_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    mono_cb: impl Fn(&[f32]) + Send + 'static,
) -> Result<Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let mono = interleaved_to_mono_f32(data, channels);
                mono_cb(&mono);
            },
            |err| eprintln!("[capture-win] stream error: {err}"),
            None,
        )
        .map_err(|e| format!("build_input_stream failed: {e}"))
}

/// Construct the per-buffer callback that forwards mono samples to the Whisper
/// engine and emits `voice:audio-level` on `level_every`-th buffer.
fn make_callback(
    app: AppHandle,
    source: &'static str,
    level_every: u32,
    on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
) -> impl Fn(&[f32]) + Send + 'static {
    let tick = AtomicU32::new(0);
    move |mono: &[f32]| {
        on_samples(mono);
        let n = tick.fetch_add(1, Ordering::Relaxed);
        if level_every > 0 && n % level_every == 0 {
            let _ = app.emit(
                "voice:audio-level",
                AudioLevelPayload {
                    level: peak_level(mono),
                    source,
                },
            );
        }
    }
}

/// Dispatch stream construction over cpal's runtime `SampleFormat`. Each match
/// arm moves `mono_cb` — allowed because only one arm executes.
fn build_for_format(
    device: &cpal::Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    mono_cb: impl Fn(&[f32]) + Send + 'static,
) -> Result<Stream, String> {
    match sample_format {
        SampleFormat::F32 => build_stream::<f32>(device, config, mono_cb),
        SampleFormat::F64 => build_stream::<f64>(device, config, mono_cb),
        SampleFormat::I8 => build_stream::<i8>(device, config, mono_cb),
        SampleFormat::I16 => build_stream::<i16>(device, config, mono_cb),
        SampleFormat::I32 => build_stream::<i32>(device, config, mono_cb),
        SampleFormat::I64 => build_stream::<i64>(device, config, mono_cb),
        SampleFormat::U8 => build_stream::<u8>(device, config, mono_cb),
        SampleFormat::U16 => build_stream::<u16>(device, config, mono_cb),
        SampleFormat::U32 => build_stream::<u32>(device, config, mono_cb),
        SampleFormat::U64 => build_stream::<u64>(device, config, mono_cb),
        other => Err(format!("unsupported sample format: {other:?}")),
    }
}

// ---- device selection -------------------------------------------------------

/// Resolve the microphone device. The renderer passes a web
/// `enumerateDevices()` id/label, which does not map to cpal's device names, so
/// we best-effort match the label against cpal's device names (case-insensitive
/// substring) and fall back to the system default input.
fn resolve_input_device(
    host: &cpal::Host,
    mic_device_label: Option<&str>,
) -> Result<cpal::Device, String> {
    if let Some(label) = mic_device_label.map(str::trim).filter(|l| !l.is_empty()) {
        let needle = label.to_ascii_lowercase();
        if let Ok(devices) = host.input_devices() {
            for device in devices {
                if let Ok(name) = device.name() {
                    if name.to_ascii_lowercase().contains(&needle) {
                        return Ok(device);
                    }
                }
            }
        }
    }
    host.default_input_device()
        .ok_or_else(|| "no default microphone device available".to_string())
}

// ---- public entry points ----------------------------------------------------

/// Start microphone capture and forward every mono `f32` buffer to
/// `on_samples`. `mic_device_id` is currently unused on Windows (the web device
/// id has no cpal equivalent); selection is by `mic_device_label`.
pub(crate) fn start_raw_mic_capture(
    app: AppHandle,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
) -> Result<RawMicCapture, String> {
    let _ = mic_device_id;
    let host = cpal::default_host();
    let device = resolve_input_device(&host, mic_device_label.as_deref())?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("default_input_config failed: {e}"))?;
    let sample_format = supported.sample_format();
    let sample_rate = supported.sample_rate().0 as f64;
    let config: StreamConfig = supported.into();

    let cb = make_callback(app.clone(), "mic", 2, on_samples);
    let stream = build_for_format(&device, &config, sample_format, cb)?;
    use cpal::traits::StreamTrait;
    stream
        .play()
        .map_err(|e| format!("mic stream play failed: {e}"))?;

    eprintln!(
        "[capture-win] mic capture started: {} Hz, {} ch, {:?}",
        sample_rate as u32, config.channels, sample_format
    );
    Ok(RawMicCapture {
        stream,
        sample_rate,
    })
}

/// Start system-audio capture via WASAPI loopback. cpal builds an *input*
/// stream on the default *output* device, which captures the speaker mix. No OS
/// permission prompt is required for loopback.
pub(crate) fn start_raw_system_capture(
    app: AppHandle,
    on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
) -> Result<RawSystemCapture, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "no default output device available for loopback".to_string())?;
    // The loopback stream uses the output device's native render format.
    let supported = device
        .default_output_config()
        .map_err(|e| format!("default_output_config failed: {e}"))?;
    let sample_format = supported.sample_format();
    let sample_rate = supported.sample_rate().0 as f64;
    let config: StreamConfig = supported.into();

    let cb = make_callback(app.clone(), "system", 3, on_samples);
    let stream = build_for_format(&device, &config, sample_format, cb)?;
    use cpal::traits::StreamTrait;
    stream
        .play()
        .map_err(|e| format!("loopback stream play failed: {e}"))?;

    eprintln!(
        "[capture-win] system loopback started: {} Hz, {} ch, {:?}",
        sample_rate as u32, config.channels, sample_format
    );
    Ok(RawSystemCapture {
        stream,
        sample_rate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_passthrough() {
        let data: [f32; 3] = [0.1, -0.2, 0.3];
        let out = interleaved_to_mono_f32(&data, 1);
        assert_eq!(out, vec![0.1, -0.2, 0.3]);
    }

    #[test]
    fn stereo_f32_averaged_to_mono() {
        // L/R interleaved: (1.0,-1.0) -> 0.0 ; (0.5,0.5) -> 0.5
        let data: [f32; 4] = [1.0, -1.0, 0.5, 0.5];
        let out = interleaved_to_mono_f32(&data, 2);
        assert_eq!(out, vec![0.0, 0.5]);
    }

    #[test]
    fn stereo_i16_converted_and_averaged() {
        // i16::MAX in both channels -> ~1.0 mono; opposite extremes -> ~0.0
        let data: [i16; 4] = [i16::MAX, i16::MAX, i16::MAX, i16::MIN];
        let out = interleaved_to_mono_f32(&data, 2);
        assert!((out[0] - 1.0).abs() < 1e-3, "got {}", out[0]);
        assert!(out[1].abs() < 1e-3, "got {}", out[1]);
    }

    #[test]
    fn four_channel_averaged() {
        let data: [f32; 4] = [1.0, 1.0, 1.0, 1.0];
        let out = interleaved_to_mono_f32(&data, 4);
        assert_eq!(out, vec![1.0]);
    }

    #[test]
    fn peak_level_picks_max_abs() {
        assert_eq!(peak_level(&[0.1, -0.9, 0.4]), 0.9);
        assert_eq!(peak_level(&[]), 0.0);
    }
}
