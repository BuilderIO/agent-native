//! Microphone PCM for the local transcription engines.
//!
//! The mic is read through AVCaptureSession on the selected device, the same
//! way Apple Speech dictation reads it. AVAudioEngine stops delivering input
//! once its input is pinned to a device other than the default output, which
//! left local dictation with no audio at all.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use core_foundation::base::CFRelease;
use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_av_foundation::{
    AVCaptureAudioDataOutput, AVCaptureAudioDataOutputSampleBufferDelegate, AVCaptureConnection,
    AVCaptureOutput, AVCaptureSession,
};
use objc2_avf_audio::{
    AVFormatIDKey, AVLinearPCMBitDepthKey, AVLinearPCMIsFloatKey, AVLinearPCMIsNonInterleaved,
    AVNumberOfChannelsKey, AVSampleRateKey,
};
use objc2_core_audio_types::{
    kAudioFormatFlagIsBigEndian, kAudioFormatFlagIsFloat, kAudioFormatFlagIsNonInterleaved,
    kAudioFormatFlagIsSignedInteger, kAudioFormatLinearPCM, AudioBuffer, AudioBufferList,
    AudioStreamBasicDescription,
};
use objc2_core_media::{
    CMAudioFormatDescriptionGetStreamBasicDescription, CMBlockBuffer, CMSampleBuffer,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString};
use tauri::{AppHandle, Emitter};

use super::macos::{start_capture_session, AudioLevelPayload, CaptureSession};
use crate::capture_audio_bus::AudioCallback;

/// The worker's RNNoise speech gate only runs on 48 kHz input, so the capture
/// asks AVFoundation to convert to that rate instead of the device's own.
const CAPTURE_SAMPLE_RATE: u32 = 48_000;

struct MicSampleIvars {
    on_samples: AudioCallback,
    app: AppHandle,
    run_id: Option<u64>,
    tally: CaptureTally,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and the type has no
    // Drop impl. AVFoundation calls the delegate on our serial queue.
    #[unsafe(super(NSObject))]
    #[name = "ClipsMicSampleDelegate"]
    #[ivars = MicSampleIvars]
    struct MicSampleDelegate;

    unsafe impl NSObjectProtocol for MicSampleDelegate {}

    unsafe impl AVCaptureAudioDataOutputSampleBufferDelegate for MicSampleDelegate {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn did_output_sample_buffer(
            &self,
            _output: &AVCaptureOutput,
            sample_buffer: &CMSampleBuffer,
            _connection: &AVCaptureConnection,
        ) {
            let ivars = self.ivars();
            let Some((level, n)) = deliver(sample_buffer, &ivars.tally, &ivars.on_samples) else {
                return;
            };
            if n % 2 == 0 {
                let _ = ivars.app.emit(
                    "voice:audio-level",
                    AudioLevelPayload {
                        level,
                        source: "mic",
                        run_id: ivars.run_id,
                    },
                );
            }
        }
    }
);

/// Hands one buffer's mono frames to `on_samples`, and returns its peak level
/// and how many buffers came before it.
fn deliver(
    sample_buffer: &CMSampleBuffer,
    tally: &CaptureTally,
    on_samples: &AudioCallback,
) -> Option<(f32, u64)> {
    let pcm = match read_mono(sample_buffer) {
        Ok(pcm) => pcm,
        Err(reason) => {
            tally.note_unreadable(reason);
            return None;
        }
    };
    let level = peak_level(&pcm.samples);
    let n = tally.note_buffer(level);
    on_samples(&pcm.samples, pcm.sample_rate);
    Some((level, n))
}

impl MicSampleDelegate {
    fn new(on_samples: AudioCallback, app: AppHandle, run_id: Option<u64>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(MicSampleIvars {
            on_samples,
            app,
            run_id,
            tally: CaptureTally::default(),
        });
        unsafe { msg_send![super(this), init] }
    }
}

/// Microphone capture that hands mono `f32` frames, with their sample rate,
/// to a callback and emits `voice:audio-level` for the flow bar.
pub(crate) struct MicCapture {
    session: Retained<AVCaptureSession>,
    output: Retained<AVCaptureAudioDataOutput>,
    delegate: Retained<MicSampleDelegate>,
    queue: DispatchRetained<DispatchQueue>,
    device_name: String,
    started: Instant,
    stopped: AtomicBool,
}

// SAFETY: AVCaptureSession, its output and the delegate are refcounted ObjC
// objects that are only moved through ownership, never aliased across
// threads; the delegate's own state is atomics and `Send + Sync` handles.
unsafe impl Send for MicCapture {}

impl MicCapture {
    pub(crate) fn start(
        app: AppHandle,
        mic_device_id: Option<&str>,
        mic_device_label: Option<&str>,
        run_id: Option<u64>,
        on_samples: AudioCallback,
    ) -> Result<Self, String> {
        let delegate = MicSampleDelegate::new(on_samples, app, run_id);
        let CaptureSession {
            session,
            output,
            queue,
            device_name,
            device_uid,
        } = start_capture_session(
            mic_device_id,
            mic_device_label,
            capture_settings().as_deref(),
            ProtocolObject::from_ref(&*delegate),
            "com.clips.mic.capture",
        )?;
        eprintln!("[mic-capture] capturing from {device_name} ({device_uid}) via AVCaptureSession");
        Ok(Self {
            session,
            output,
            delegate,
            queue,
            device_name,
            started: Instant::now(),
            stopped: AtomicBool::new(false),
        })
    }

    /// Stops the session and says whether it delivered usable audio. A
    /// microphone that sent nothing, or only exact zeros, is an error: the
    /// transcript would otherwise come back empty as if nobody spoke.
    pub(crate) fn stop(self) -> Result<(), String> {
        match self.halt() {
            Some(summary) => capture_verdict(&self.device_name, &summary),
            None => Ok(()),
        }
    }

    fn halt(&self) -> Option<CaptureSummary> {
        if self.stopped.swap(true, Ordering::SeqCst) {
            return None;
        }
        unsafe {
            self.session.stopRunning();
            self.output.setSampleBufferDelegate_queue(None, None);
        }
        // Buffers already queued still reach the delegate; wait for them so
        // the tally is complete.
        self.queue.exec_sync(|| {});
        let summary = self.delegate.ivars().tally.summary(self.started.elapsed());
        eprintln!(
            "[mic-capture] {} delivered {} buffers in {:.1} s (peak {:.4}, {} unreadable)",
            self.device_name,
            summary.buffers,
            summary.running.as_secs_f32(),
            summary.peak,
            summary.unreadable,
        );
        if let Some(reason) = &summary.unreadable_reason {
            eprintln!("[mic-capture] first unreadable buffer: {reason}");
        }
        Some(summary)
    }
}

impl Drop for MicCapture {
    fn drop(&mut self) {
        self.halt();
    }
}

fn capture_settings() -> Option<Retained<NSDictionary<NSString, AnyObject>>> {
    let keys = unsafe {
        [
            AVFormatIDKey?,
            AVLinearPCMIsFloatKey?,
            AVLinearPCMBitDepthKey?,
            AVLinearPCMIsNonInterleaved?,
            AVNumberOfChannelsKey?,
            AVSampleRateKey?,
        ]
    };
    let values = [
        NSNumber::numberWithUnsignedInt(kAudioFormatLinearPCM),
        NSNumber::numberWithBool(true),
        NSNumber::numberWithUnsignedInt(32),
        NSNumber::numberWithBool(false),
        NSNumber::numberWithUnsignedInt(1),
        NSNumber::numberWithUnsignedInt(CAPTURE_SAMPLE_RATE),
    ];
    let objects: Vec<&AnyObject> = values.iter().map(|v| v.as_ref()).collect();
    Some(NSDictionary::from_slices(&keys, &objects))
}

#[derive(Default)]
struct CaptureTally {
    buffers: AtomicU64,
    peak_bits: AtomicU32,
    unreadable: AtomicU64,
    unreadable_reason: OnceLock<String>,
}

impl CaptureTally {
    /// Returns how many buffers came before this one. Non-negative floats
    /// order the same as their bit patterns, which lets `peak_bits` use
    /// `fetch_max`.
    fn note_buffer(&self, level: f32) -> u64 {
        self.peak_bits.fetch_max(level.to_bits(), Ordering::Relaxed);
        self.buffers.fetch_add(1, Ordering::Relaxed)
    }

    fn note_unreadable(&self, reason: String) {
        self.unreadable.fetch_add(1, Ordering::Relaxed);
        let _ = self.unreadable_reason.set(reason);
    }

    fn summary(&self, running: Duration) -> CaptureSummary {
        CaptureSummary {
            running,
            buffers: self.buffers.load(Ordering::Relaxed),
            peak: f32::from_bits(self.peak_bits.load(Ordering::Relaxed)),
            unreadable: self.unreadable.load(Ordering::Relaxed),
            unreadable_reason: self.unreadable_reason.get().cloned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct CaptureSummary {
    running: Duration,
    buffers: u64,
    peak: f32,
    unreadable: u64,
    unreadable_reason: Option<String>,
}

fn capture_verdict(device_name: &str, summary: &CaptureSummary) -> Result<(), String> {
    if summary.buffers == 0 {
        return Err(match &summary.unreadable_reason {
            Some(reason) => {
                format!("Microphone {device_name} sent audio Clips could not read ({reason}).")
            }
            None => format!(
                "Microphone {device_name} sent no audio in {:.1} s.",
                summary.running.as_secs_f32()
            ),
        });
    }
    if summary.peak == 0.0 {
        return Err(format!(
            "Microphone {device_name} sent only silence. Check that Clips may use the microphone in System Settings."
        ));
    }
    Ok(())
}

fn peak_level(samples: &[f32]) -> f32 {
    samples
        .iter()
        .fold(0.0_f32, |peak, v| peak.max(v.abs()))
        .min(1.0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SampleFormat {
    F32,
    I16,
    I32,
}

impl SampleFormat {
    fn bytes(self) -> usize {
        match self {
            SampleFormat::F32 | SampleFormat::I32 => 4,
            SampleFormat::I16 => 2,
        }
    }

    fn decode(self, bytes: &[u8]) -> f32 {
        match self {
            SampleFormat::F32 => f32::from_ne_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            SampleFormat::I16 => i16::from_ne_bytes([bytes[0], bytes[1]]) as f32 / 32_768.0,
            SampleFormat::I32 => {
                i32::from_ne_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f32
                    / 2_147_483_648.0
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PcmLayout {
    format: SampleFormat,
    channels: usize,
    interleaved: bool,
    sample_rate: f64,
}

fn pcm_layout(asbd: &AudioStreamBasicDescription) -> Result<PcmLayout, String> {
    if asbd.mFormatID != kAudioFormatLinearPCM {
        return Err(format!("format {:#x} is not linear PCM", asbd.mFormatID));
    }
    let flags = asbd.mFormatFlags;
    if flags & kAudioFormatFlagIsBigEndian != 0 {
        return Err("big-endian PCM".into());
    }
    let float = flags & kAudioFormatFlagIsFloat != 0;
    let signed = flags & kAudioFormatFlagIsSignedInteger != 0;
    let format = match (float, signed, asbd.mBitsPerChannel) {
        (true, _, 32) => SampleFormat::F32,
        (false, true, 16) => SampleFormat::I16,
        (false, true, 32) => SampleFormat::I32,
        (_, _, bits) => {
            let kind = if float {
                "float"
            } else if signed {
                "integer"
            } else {
                "unsigned integer"
            };
            return Err(format!("{bits}-bit {kind} PCM"));
        }
    };
    let channels = asbd.mChannelsPerFrame as usize;
    if channels == 0 {
        return Err("PCM with no channels".into());
    }
    let interleaved = flags & kAudioFormatFlagIsNonInterleaved == 0;
    let frame_bytes = format.bytes() * if interleaved { channels } else { 1 };
    if asbd.mBytesPerFrame as usize != frame_bytes {
        return Err(format!(
            "{} bytes per frame for {channels}-channel {}-bit PCM",
            asbd.mBytesPerFrame, asbd.mBitsPerChannel
        ));
    }
    if !asbd.mSampleRate.is_finite() || asbd.mSampleRate <= 0.0 {
        return Err("PCM with no sample rate".into());
    }
    Ok(PcmLayout {
        format,
        channels,
        interleaved,
        sample_rate: asbd.mSampleRate,
    })
}

/// Averages every channel into one, as built-in Mac microphones can put the
/// voice outside channel 0. Interleaved audio comes as one buffer of frames;
/// non-interleaved as one buffer per channel.
fn mix_to_mono(layout: PcmLayout, buffers: &[&[u8]]) -> Result<Vec<f32>, String> {
    let sample_bytes = layout.format.bytes();
    let scale = 1.0 / layout.channels as f32;
    if layout.interleaved {
        let [data] = buffers else {
            return Err(format!("{} buffers for interleaved PCM", buffers.len()));
        };
        let frame_bytes = sample_bytes * layout.channels;
        if data.len() % frame_bytes != 0 {
            return Err(format!(
                "{} bytes is not a whole number of {frame_bytes}-byte frames",
                data.len()
            ));
        }
        return Ok(data
            .chunks_exact(frame_bytes)
            .map(|frame| {
                frame
                    .chunks_exact(sample_bytes)
                    .map(|sample| layout.format.decode(sample))
                    .sum::<f32>()
                    * scale
            })
            .collect());
    }
    if buffers.len() != layout.channels {
        return Err(format!(
            "{} buffers for {}-channel non-interleaved PCM",
            buffers.len(),
            layout.channels
        ));
    }
    let plane_bytes = buffers[0].len();
    if buffers.iter().any(|plane| plane.len() != plane_bytes) || plane_bytes % sample_bytes != 0 {
        return Err("non-interleaved channels differ in length".into());
    }
    let mut mono = vec![0.0_f32; plane_bytes / sample_bytes];
    for plane in buffers {
        for (dst, sample) in mono.iter_mut().zip(plane.chunks_exact(sample_bytes)) {
            *dst += layout.format.decode(sample);
        }
    }
    for sample in &mut mono {
        *sample *= scale;
    }
    Ok(mono)
}

struct MonoPcm {
    samples: Vec<f32>,
    sample_rate: f64,
}

/// A Core Foundation object this code owns one retain on.
struct CfOwned<T>(NonNull<T>);

impl<T> Drop for CfOwned<T> {
    fn drop(&mut self) {
        // SAFETY: the pointer came from a Create/Copy-rule call, which hands
        // over exactly one retain.
        unsafe { CFRelease(self.0.as_ptr() as *const c_void) };
    }
}

fn read_mono(sample_buffer: &CMSampleBuffer) -> Result<MonoPcm, String> {
    let format = unsafe { sample_buffer.format_description() }
        .ok_or_else(|| "buffer has no format description".to_string())?;
    let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&format).as_ref() }
        .ok_or_else(|| "buffer has no audio format".to_string())?;
    let layout = pcm_layout(asbd)?;

    let mut list_size = 0usize;
    unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            &mut list_size,
            std::ptr::null_mut(),
            0,
            None,
            None,
            0,
            std::ptr::null_mut(),
        );
    }
    let buffers_offset = std::mem::offset_of!(AudioBufferList, mBuffers);
    if list_size < buffers_offset {
        return Err(format!("audio buffer list size {list_size}"));
    }
    // u64 storage keeps the list's pointers aligned.
    let mut storage = vec![0_u64; list_size.div_ceil(8)];
    let list = storage.as_mut_ptr().cast::<AudioBufferList>();
    let mut block: *mut CMBlockBuffer = std::ptr::null_mut();
    let status = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            std::ptr::null_mut(),
            list,
            list_size,
            None,
            None,
            0,
            &mut block,
        )
    };
    if status != 0 {
        return Err(format!("audio buffer list unavailable (OSStatus {status})"));
    }
    // Keeps the bytes the list points into alive until the mix is done.
    let _block = NonNull::new(block).map(CfOwned);

    let count = unsafe { (*list).mNumberBuffers } as usize;
    if buffers_offset + count * size_of::<AudioBuffer>() > list_size {
        return Err(format!("{count} buffers overflow a {list_size}-byte list"));
    }
    let first = unsafe { std::ptr::addr_of!((*list).mBuffers).cast::<AudioBuffer>() };
    let buffers = unsafe { std::slice::from_raw_parts(first, count) };
    let planes: Vec<&[u8]> = buffers
        .iter()
        .map(|buffer| {
            if buffer.mData.is_null() || buffer.mDataByteSize == 0 {
                &[][..]
            } else {
                unsafe {
                    std::slice::from_raw_parts(
                        buffer.mData.cast::<u8>(),
                        buffer.mDataByteSize as usize,
                    )
                }
            }
        })
        .collect();
    let samples = mix_to_mono(layout, &planes)?;
    if samples.iter().any(|sample| !sample.is_finite()) {
        return Err("PCM with non-finite samples".into());
    }
    Ok(MonoPcm {
        samples,
        sample_rate: layout.sample_rate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_core_media::{
        kCMBlockBufferAssureMemoryNowFlag, CMAudioFormatDescriptionCreate,
        CMAudioSampleBufferCreateReadyWithPacketDescriptions, CMFormatDescription, CMTime,
    };

    fn asbd(format: SampleFormat, channels: u32, interleaved: bool) -> AudioStreamBasicDescription {
        let bytes = format.bytes() as u32;
        let frame_bytes = if interleaved { bytes * channels } else { bytes };
        let mut flags = match format {
            SampleFormat::F32 => kAudioFormatFlagIsFloat,
            SampleFormat::I16 | SampleFormat::I32 => kAudioFormatFlagIsSignedInteger,
        } | objc2_core_audio_types::kAudioFormatFlagIsPacked;
        if !interleaved {
            flags |= kAudioFormatFlagIsNonInterleaved;
        }
        AudioStreamBasicDescription {
            mSampleRate: 48_000.0,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: flags,
            mBytesPerPacket: frame_bytes,
            mFramesPerPacket: 1,
            mBytesPerFrame: frame_bytes,
            mChannelsPerFrame: channels,
            mBitsPerChannel: bytes * 8,
            mReserved: 0,
        }
    }

    /// A real CMSampleBuffer carrying `bytes`, laid out as `asbd` says:
    /// frames for interleaved audio, channel planes back to back otherwise.
    fn sample_buffer(
        asbd: AudioStreamBasicDescription,
        bytes: &[u8],
        frames: usize,
    ) -> CfOwned<CMSampleBuffer> {
        unsafe {
            let mut format: *const CMFormatDescription = std::ptr::null();
            let status = CMAudioFormatDescriptionCreate(
                None,
                NonNull::from(&asbd),
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
                None,
                NonNull::from(&mut format),
            );
            assert_eq!(status, 0, "format description");
            let format = CfOwned(NonNull::new(format as *mut CMFormatDescription).unwrap());

            let mut block: *mut CMBlockBuffer = std::ptr::null_mut();
            let status = CMBlockBuffer::create_with_memory_block(
                None,
                std::ptr::null_mut(),
                bytes.len(),
                None,
                std::ptr::null(),
                0,
                bytes.len(),
                kCMBlockBufferAssureMemoryNowFlag,
                NonNull::from(&mut block),
            );
            assert_eq!(status, 0, "block buffer");
            let block = CfOwned(NonNull::new(block).unwrap());
            let status = CMBlockBuffer::replace_data_bytes(
                NonNull::new(bytes.as_ptr() as *mut c_void).unwrap(),
                block.0.as_ref(),
                0,
                bytes.len(),
            );
            assert_eq!(status, 0, "block bytes");

            let mut sample: *mut CMSampleBuffer = std::ptr::null_mut();
            let status = CMAudioSampleBufferCreateReadyWithPacketDescriptions(
                None,
                block.0.as_ref(),
                format.0.as_ref(),
                frames as isize,
                CMTime::new(0, 48_000),
                std::ptr::null(),
                NonNull::from(&mut sample),
            );
            assert_eq!(status, 0, "sample buffer");
            CfOwned(NonNull::new(sample).unwrap())
        }
    }

    fn read(sample: &CfOwned<CMSampleBuffer>) -> Result<MonoPcm, String> {
        read_mono(unsafe { sample.0.as_ref() })
    }

    fn assert_close(actual: &[f32], expected: &[f32]) {
        assert_eq!(actual.len(), expected.len(), "{actual:?} vs {expected:?}");
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 1e-6, "{actual:?} vs {expected:?}");
        }
    }

    fn f32_bytes(samples: &[f32]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_ne_bytes()).collect()
    }

    fn i16_bytes(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_ne_bytes()).collect()
    }

    #[test]
    fn reads_mono_float_as_is() {
        let samples = [0.0, 0.25, -0.5, 1.0];
        let buffer = sample_buffer(asbd(SampleFormat::F32, 1, true), &f32_bytes(&samples), 4);
        let pcm = read(&buffer).unwrap();
        assert_eq!(pcm.samples, samples);
        assert_eq!(pcm.sample_rate, 48_000.0);
    }

    #[test]
    fn averages_interleaved_float_channels() {
        // Voice only on the right channel still reaches the mix.
        let frames = [0.0, 0.5, 0.2, 0.4, -0.6, 0.0];
        let buffer = sample_buffer(asbd(SampleFormat::F32, 2, true), &f32_bytes(&frames), 3);
        assert_close(&read(&buffer).unwrap().samples, &[0.25, 0.3, -0.3]);
    }

    #[test]
    fn averages_non_interleaved_float_planes() {
        let left = [0.5, -0.5, 0.0];
        let right = [0.0, 0.25, 1.0];
        let mut bytes = f32_bytes(&left);
        bytes.extend(f32_bytes(&right));
        let buffer = sample_buffer(asbd(SampleFormat::F32, 2, false), &bytes, 3);
        assert_close(&read(&buffer).unwrap().samples, &[0.25, -0.125, 0.5]);
    }

    #[test]
    fn scales_interleaved_int16_channels() {
        let frames = [16_384_i16, 0, -32_768, -32_768, 8_192, 8_192, 0, 0];
        let buffer = sample_buffer(asbd(SampleFormat::I16, 4, true), &i16_bytes(&frames), 2);
        assert_close(&read(&buffer).unwrap().samples, &[-0.375, 0.125]);
    }

    #[test]
    fn scales_non_interleaved_int16_planes() {
        let planes = [[16_384_i16, -16_384], [0, -16_384], [-32_768, 32_767]];
        let bytes: Vec<u8> = planes.iter().flat_map(|plane| i16_bytes(plane)).collect();
        let buffer = sample_buffer(asbd(SampleFormat::I16, 3, false), &bytes, 2);
        assert_close(
            &read(&buffer).unwrap().samples,
            &[
                (0.5 + 0.0 - 1.0) / 3.0,
                (-0.5 - 0.5 + 32_767.0 / 32_768.0) / 3.0,
            ],
        );
    }

    #[test]
    fn reports_the_buffer_rate() {
        let mut format = asbd(SampleFormat::F32, 1, true);
        format.mSampleRate = 24_000.0;
        let buffer = sample_buffer(format, &f32_bytes(&[0.1, 0.2]), 2);
        assert_eq!(read(&buffer).unwrap().sample_rate, 24_000.0);
    }

    #[test]
    fn refuses_formats_it_cannot_decode() {
        let mut packed_24 = asbd(SampleFormat::I32, 1, true);
        packed_24.mBitsPerChannel = 24;
        packed_24.mBytesPerFrame = 3;
        packed_24.mBytesPerPacket = 3;
        assert_eq!(pcm_layout(&packed_24).unwrap_err(), "24-bit integer PCM");

        let mut big_endian = asbd(SampleFormat::I16, 1, true);
        big_endian.mFormatFlags |= kAudioFormatFlagIsBigEndian;
        assert_eq!(pcm_layout(&big_endian).unwrap_err(), "big-endian PCM");

        let mut compressed = asbd(SampleFormat::F32, 1, true);
        compressed.mFormatID = u32::from_be_bytes(*b"aac ");
        assert!(pcm_layout(&compressed)
            .unwrap_err()
            .contains("not linear PCM"));
    }

    #[test]
    fn refuses_buffers_that_do_not_match_their_layout() {
        let layout = pcm_layout(&asbd(SampleFormat::F32, 2, false)).unwrap();
        let left = f32_bytes(&[0.1, 0.2]);
        let short = f32_bytes(&[0.1]);
        assert!(mix_to_mono(layout, &[&left[..]]).is_err());
        assert!(mix_to_mono(layout, &[&left[..], &short[..]]).is_err());

        let interleaved = pcm_layout(&asbd(SampleFormat::I16, 2, true)).unwrap();
        let half_frame: &[u8] = &[0, 0, 0];
        assert!(mix_to_mono(interleaved, &[half_frame]).is_err());
    }

    #[test]
    fn hands_each_readable_buffer_and_its_rate_to_the_callback() {
        use std::sync::{Arc, Mutex};

        let received = Arc::new(Mutex::new(Vec::<(Vec<f32>, f64)>::new()));
        let sink = received.clone();
        let on_samples: AudioCallback = Arc::new(move |samples: &[f32], rate: f64| {
            sink.lock().unwrap().push((samples.to_vec(), rate));
        });
        let tally = CaptureTally::default();
        let mut slow = asbd(SampleFormat::I16, 1, true);
        slow.mSampleRate = 16_000.0;
        let mut packed_24 = asbd(SampleFormat::I32, 1, true);
        packed_24.mBitsPerChannel = 24;
        packed_24.mBytesPerFrame = 3;
        packed_24.mBytesPerPacket = 3;
        let buffers = [
            sample_buffer(asbd(SampleFormat::F32, 2, true), &f32_bytes(&[0.2, 0.4]), 1),
            sample_buffer(packed_24, &[0, 0, 64], 1),
            sample_buffer(slow, &i16_bytes(&[-16_384]), 1),
        ];
        let delivered: Vec<_> = buffers
            .iter()
            .map(|buffer| deliver(unsafe { buffer.0.as_ref() }, &tally, &on_samples))
            .collect();

        assert_eq!(delivered[0].map(|(_, n)| n), Some(0));
        assert_eq!(delivered[1], None);
        assert_eq!(delivered[2], Some((0.5, 1)));
        let received = received.lock().unwrap();
        assert_eq!(received.len(), 2);
        assert_close(&received[0].0, &[0.3]);
        assert_eq!(received[0].1, 48_000.0);
        assert_eq!(received[1], (vec![-0.5], 16_000.0));
        let summary = tally.summary(Duration::from_secs(1));
        assert_eq!(summary.buffers, 2);
        assert_eq!(summary.unreadable, 1);
        assert_eq!(
            summary.unreadable_reason.as_deref(),
            Some("24-bit integer PCM")
        );
        assert!((summary.peak - 0.5).abs() < 1e-6);
    }

    #[test]
    fn treats_buffers_with_non_finite_samples_as_unreadable() {
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;

        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let on_samples: AudioCallback = Arc::new(move |_: &[f32], _: f64| {
            counter.fetch_add(1, Ordering::Relaxed);
        });
        let tally = CaptureTally::default();
        let mono = asbd(SampleFormat::F32, 1, true);
        // Two loud channels whose average overflows to infinity.
        let overflowing = f32_bytes(&[f32::MAX, f32::MAX]);
        let buffers = [
            sample_buffer(mono, &f32_bytes(&[0.1, f32::NAN]), 2),
            sample_buffer(mono, &f32_bytes(&[f32::INFINITY, 0.1]), 2),
            sample_buffer(asbd(SampleFormat::F32, 2, true), &overflowing, 1),
        ];
        for buffer in &buffers {
            assert_eq!(
                deliver(unsafe { buffer.0.as_ref() }, &tally, &on_samples),
                None
            );
        }

        assert_eq!(calls.load(Ordering::Relaxed), 0);
        let summary = tally.summary(Duration::from_secs(1));
        assert_eq!(summary.buffers, 0);
        assert_eq!(summary.unreadable, 3);
        assert_eq!(summary.peak, 0.0);
        assert_eq!(
            capture_verdict("USB Mic", &summary).unwrap_err(),
            "Microphone USB Mic sent audio Clips could not read (PCM with non-finite samples)."
        );
    }

    fn summary(buffers: u64, peak: f32, reason: Option<&str>) -> CaptureSummary {
        CaptureSummary {
            running: Duration::from_millis(2_340),
            buffers,
            peak,
            unreadable: u64::from(reason.is_some()),
            unreadable_reason: reason.map(str::to_owned),
        }
    }

    #[test]
    fn a_capture_with_no_buffers_is_an_error() {
        assert_eq!(
            capture_verdict("AirPods", &summary(0, 0.0, None)).unwrap_err(),
            "Microphone AirPods sent no audio in 2.3 s."
        );
    }

    #[test]
    fn a_capture_with_only_unreadable_buffers_names_the_reason() {
        assert_eq!(
            capture_verdict("USB Mic", &summary(0, 0.0, Some("24-bit integer PCM"))).unwrap_err(),
            "Microphone USB Mic sent audio Clips could not read (24-bit integer PCM)."
        );
    }

    #[test]
    fn a_capture_of_exact_zeros_is_an_error() {
        let error = capture_verdict("MacBook Pro Microphone", &summary(40, 0.0, None)).unwrap_err();
        assert!(error.starts_with("Microphone MacBook Pro Microphone sent only silence."));
    }

    #[test]
    fn a_capture_with_any_signal_is_usable() {
        assert!(capture_verdict("AirPods", &summary(40, 0.0001, None)).is_ok());
        // A few unreadable buffers among readable ones are logged, not fatal.
        assert!(capture_verdict("AirPods", &summary(40, 0.2, Some("big-endian PCM"))).is_ok());
    }
}
