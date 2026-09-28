
use super::*;
use screencapturekit::error::SCError;
use screencapturekit::stream::delegate_trait::SCStreamDelegateTrait;
use std::io::{Seek, SeekFrom, Write};
use std::sync::RwLock;
use tauri::{AppHandle, Emitter};

const AV_WRITER_STATUS_COMPLETED: i64 = 2;
const AUDIO_FORMAT_AAC: i64 = 0x6161_6320;
const OUTPUT_SEGMENT_INTERVAL_SECONDS: i64 = 1;
const CAPTURE_VIDEO_BPP: f64 = 0.15;

const CAPTURE_STALL_TIMEOUT: Duration = Duration::from_secs(4);
const CAPTURE_WATCHDOG_POLL: Duration = Duration::from_millis(1000);
const CAPTURE_FIRST_SAMPLE_TIMEOUT: Duration = Duration::from_secs(4);
const CAPTURE_FIRST_FRAGMENT_TIMEOUT: Duration = Duration::from_secs(3);
const AUDIO_FENCE_LOOKBEHIND_SECONDS: f64 = 2.0;
const CAPTURE_MAX_RESTARTS: u32 = 5;

pub(crate) struct CaptureWatch {
    last_activity: Mutex<Instant>,
    stream_stopped: Mutex<Option<String>>,
    user_stopped: AtomicBool,
    paused: AtomicBool,
    screen_samples: AtomicU64,
    usable_screen_samples: AtomicU64,
    system_audio_samples: AtomicU64,
    microphone_samples: AtomicU64,
}

impl CaptureWatch {
    fn new() -> Self {
        Self {
            last_activity: Mutex::new(Instant::now()),
            stream_stopped: Mutex::new(None),
            user_stopped: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            screen_samples: AtomicU64::new(0),
            usable_screen_samples: AtomicU64::new(0),
            system_audio_samples: AtomicU64::new(0),
            microphone_samples: AtomicU64::new(0),
        }
    }

    fn note_activity(&self) {
        if let Ok(mut guard) = self.last_activity.lock() {
            *guard = Instant::now();
        }
    }

    fn note_sample(&self, of_type: SCStreamOutputType, usable_screen: bool) {
        let (counter, label) = match of_type {
            SCStreamOutputType::Screen => (&self.screen_samples, "screen"),
            SCStreamOutputType::Audio => (&self.system_audio_samples, "system-audio"),
            SCStreamOutputType::Microphone => (&self.microphone_samples, "microphone"),
        };
        let count = counter.fetch_add(1, Ordering::Relaxed) + 1;
        if count == 1 {
            crate::logfile::diagnostic(&format!("[capture-health] first {label} sample callback"));
        }
        if usable_screen {
            let usable = self.usable_screen_samples.fetch_add(1, Ordering::Relaxed) + 1;
            if usable == 1 {
                crate::logfile::diagnostic("[capture-health] first usable screen sample");
            }
        }
    }

    fn sample_counts(&self) -> (u64, u64, u64, u64) {
        (
            self.screen_samples.load(Ordering::Relaxed),
            self.usable_screen_samples.load(Ordering::Relaxed),
            self.system_audio_samples.load(Ordering::Relaxed),
            self.microphone_samples.load(Ordering::Relaxed),
        )
    }

    fn since_activity(&self) -> Duration {
        self.last_activity
            .lock()
            .map(|t| t.elapsed())
            .unwrap_or_default()
    }

    fn note_stream_stopped(&self, reason: String) {
        if let Ok(mut guard) = self.stream_stopped.lock() {
            if guard.is_none() {
                *guard = Some(reason);
            }
        }
    }

    fn take_stream_stopped(&self) -> Option<String> {
        self.stream_stopped.lock().ok().and_then(|mut g| g.take())
    }

    fn note_user_stopped(&self) {
        self.user_stopped.store(true, Ordering::SeqCst);
    }

    fn user_stopped(&self) -> bool {
        self.user_stopped.load(Ordering::SeqCst)
    }

    fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
    }

    fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
}


const AV_ASSET_WRITER_SEGMENT_TYPE_INITIALIZATION: isize = 1;
const AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE: isize = 2;

#[derive(Clone, Copy, PartialEq, Eq)]
enum CustomWriterOutput {
    Standard,
    RewindCmaf,
    ClipHls,
}

impl CustomWriterOutput {
    fn segmented(self) -> bool {
        !matches!(self, Self::Standard)
    }

    fn preserves_separate_audio(self) -> bool {
        matches!(self, Self::RewindCmaf)
    }
}

fn segmented_output_enabled(output: CustomWriterOutput, live_upload_enabled: bool) -> bool {
    output.segmented() || live_upload_enabled
}

fn live_audio_mixing_enabled(
    output: CustomWriterOutput,
    include_audio: bool,
    _capture_system_audio: bool,
) -> bool {
    include_audio && !output.preserves_separate_audio()
}

pub(crate) fn audio_sidecar_path(video_path: &Path, source: &str) -> PathBuf {
    let stem = video_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("segment");
    video_path.with_file_name(format!("{stem}.{source}.wav"))
}

struct FloatWavWriter {
    file: std::fs::File,
    data_bytes: u32,
    sample_rate: u32,
}

impl FloatWavWriter {
    fn create(path: &Path, sample_rate: u32) -> Result<Self, String> {
        let mut file = std::fs::File::create(path)
            .map_err(|error| format!("audio sidecar create failed: {error}"))?;
        file.write_all(&[0u8; 44])
            .map_err(|error| format!("audio sidecar header reserve failed: {error}"))?;
        Ok(Self {
            file,
            data_bytes: 0,
            sample_rate,
        })
    }

    fn append_at(&mut self, samples: &[f32], start_seconds: f64) -> Result<(), String> {
        let target = (start_seconds.max(0.0) * self.sample_rate as f64).round() as usize;
        let current = self.data_bytes as usize / 4;
        if target > current {
            for _ in 0..target.saturating_sub(current) {
                self.file
                    .write_all(&0.0f32.to_le_bytes())
                    .map_err(|error| format!("audio sidecar silence write failed: {error}"))?;
            }
            self.data_bytes = self
                .data_bytes
                .saturating_add((target.saturating_sub(current) as u32).saturating_mul(4));
        }
        let current = self.data_bytes as usize / 4;
        let skip = current.saturating_sub(target).min(samples.len());
        for sample in &samples[skip..] {
            self.file
                .write_all(&sample.to_le_bytes())
                .map_err(|error| format!("audio sidecar write failed: {error}"))?;
        }
        self.data_bytes = self
            .data_bytes
            .saturating_add(((samples.len() - skip) as u32).saturating_mul(4));
        Ok(())
    }

    fn finish(mut self) -> Result<(), String> {
        let riff_size = 36u32.saturating_add(self.data_bytes);
        let byte_rate = self.sample_rate.saturating_mul(4);
        let mut header = Vec::with_capacity(44);
        header.extend_from_slice(b"RIFF");
        header.extend_from_slice(&riff_size.to_le_bytes());
        header.extend_from_slice(b"WAVEfmt ");
        header.extend_from_slice(&16u32.to_le_bytes());
        header.extend_from_slice(&3u16.to_le_bytes());
        header.extend_from_slice(&1u16.to_le_bytes());
        header.extend_from_slice(&self.sample_rate.to_le_bytes());
        header.extend_from_slice(&byte_rate.to_le_bytes());
        header.extend_from_slice(&4u16.to_le_bytes());
        header.extend_from_slice(&32u16.to_le_bytes());
        header.extend_from_slice(b"data");
        header.extend_from_slice(&self.data_bytes.to_le_bytes());
        self.file
            .seek(SeekFrom::Start(0))
            .and_then(|_| self.file.write_all(&header))
            .and_then(|_| self.file.flush())
            .and_then(|_| self.file.sync_all())
            .map_err(|error| format!("audio sidecar finalize failed: {error}"))
    }
}

struct AudioSidecarState {
    system: Option<FloatWavWriter>,
    microphone: Option<FloatWavWriter>,
    failed: Option<String>,
    segment_base_pts: Option<f64>,
    latest_end_pts: Option<f64>,
    session_start_pts: Option<f64>,
    fence_pending: bool,
    queued: std::collections::VecDeque<QueuedAudio>,
}

struct QueuedAudio {
    microphone: bool,
    samples: Vec<f32>,
    sample_rate: f64,
    pts_seconds: f64,
}

struct AudioSidecarManager {
    state: Mutex<AudioSidecarState>,
    sources: crate::capture_audio_bus::AudioSources,
}

impl AudioSidecarManager {
    fn create(
        video_path: &Path,
        sources: crate::capture_audio_bus::AudioSources,
    ) -> Result<Arc<Self>, String> {
        let system = sources
            .system
            .then(|| FloatWavWriter::create(&audio_sidecar_path(video_path, "system"), 48_000))
            .transpose()?;
        let microphone = sources
            .microphone
            .then(|| FloatWavWriter::create(&audio_sidecar_path(video_path, "microphone"), 48_000))
            .transpose()?;
        Ok(Arc::new(Self {
            state: Mutex::new(AudioSidecarState {
                system,
                microphone,
                failed: None,
                segment_base_pts: None,
                latest_end_pts: None,
                session_start_pts: None,
                fence_pending: false,
                queued: std::collections::VecDeque::new(),
            }),
            sources,
        }))
    }

    fn append(
        &self,
        microphone: bool,
        samples: &[f32],
        sample_rate: f64,
        pts_seconds: f64,
        session_start_seconds: f64,
    ) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if state.failed.is_some() {
            return;
        }
        if (sample_rate - 48_000.0).abs() > 1.0 {
            state.failed = Some(format!(
                "audio sidecar received unsupported sample rate {sample_rate}"
            ));
            return;
        }
        state.session_start_pts.get_or_insert(session_start_seconds);
        state.queued.push_back(QueuedAudio {
            microphone,
            samples: samples.to_vec(),
            sample_rate,
            pts_seconds,
        });
        if !state.fence_pending {
            let cutoff = pts_seconds - AUDIO_FENCE_LOOKBEHIND_SECONDS;
            Self::flush_complete_buffers_before(&mut state, cutoff, session_start_seconds);
        }
    }

    fn flush_complete_buffers_before(
        state: &mut AudioSidecarState,
        cutoff_pts: f64,
        session_start_seconds: f64,
    ) {
        while state.queued.front().is_some_and(|buffer| {
            buffer.pts_seconds + buffer.samples.len() as f64 / buffer.sample_rate <= cutoff_pts
        }) {
            let buffer = state.queued.pop_front().expect("front checked above");
            Self::append_locked(
                state,
                buffer.microphone,
                &buffer.samples,
                buffer.sample_rate,
                buffer.pts_seconds,
                session_start_seconds,
            );
        }
    }

    fn flush_all(state: &mut AudioSidecarState, session_start_seconds: f64) {
        let queued = std::mem::take(&mut state.queued);
        for buffer in queued {
            Self::append_locked(
                state,
                buffer.microphone,
                &buffer.samples,
                buffer.sample_rate,
                buffer.pts_seconds,
                session_start_seconds,
            );
        }
    }

    fn append_locked(
        state: &mut AudioSidecarState,
        microphone: bool,
        samples: &[f32],
        sample_rate: f64,
        pts_seconds: f64,
        session_start_seconds: f64,
    ) {
        let base = *state.segment_base_pts.get_or_insert(session_start_seconds);
        let skip = (((base - pts_seconds) * sample_rate).ceil() as isize)
            .clamp(0, samples.len() as isize) as usize;
        let samples = &samples[skip..];
        if samples.is_empty() {
            return;
        }
        let pts_seconds = pts_seconds + skip as f64 / sample_rate;
        let start_seconds = (pts_seconds - base).max(0.0);
        state.latest_end_pts = Some(
            state
                .latest_end_pts
                .unwrap_or(pts_seconds)
                .max(pts_seconds + samples.len() as f64 / sample_rate),
        );
        let writer = if microphone {
            state.microphone.as_mut()
        } else {
            state.system.as_mut()
        };
        if let Some(writer) = writer {
            if let Err(error) = writer.append_at(samples, start_seconds) {
                state.failed = Some(error);
            }
        }
    }

    fn begin_fence(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if let Some(error) = state.failed.clone() {
            return Err(error);
        }
        if state.fence_pending {
            return Err("an audio sidecar fence is already pending".into());
        }
        state.fence_pending = true;
        Ok(())
    }

    fn complete_fence(&self, next_video_path: &Path, boundary_seconds: f64) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if let Some(error) = state.failed.clone() {
            return Err(error);
        }
        if !state.fence_pending {
            return Err("audio sidecar fence completed without a pending fence".into());
        }
        let session_start = state.session_start_pts.unwrap_or(0.0);
        let boundary_pts = session_start + boundary_seconds;
        let queued = std::mem::take(&mut state.queued);
        for buffer in &queued {
            let before = (((boundary_pts - buffer.pts_seconds) * buffer.sample_rate).round()
                as isize)
                .clamp(0, buffer.samples.len() as isize) as usize;
            if before > 0 {
                Self::append_locked(
                    &mut state,
                    buffer.microphone,
                    &buffer.samples[..before],
                    buffer.sample_rate,
                    buffer.pts_seconds,
                    session_start,
                );
            }
        }
        if let Some(writer) = state.system.take() {
            writer.finish()?;
        }
        if let Some(writer) = state.microphone.take() {
            writer.finish()?;
        }
        state.system = self
            .sources
            .system
            .then(|| FloatWavWriter::create(&audio_sidecar_path(next_video_path, "system"), 48_000))
            .transpose()?;
        state.microphone = self
            .sources
            .microphone
            .then(|| {
                FloatWavWriter::create(&audio_sidecar_path(next_video_path, "microphone"), 48_000)
            })
            .transpose()?;
        state.segment_base_pts = Some(boundary_pts);
        state.fence_pending = false;
        for buffer in queued {
            let after = (((boundary_pts - buffer.pts_seconds) * buffer.sample_rate).round()
                as isize)
                .clamp(0, buffer.samples.len() as isize) as usize;
            if after < buffer.samples.len() {
                Self::append_locked(
                    &mut state,
                    buffer.microphone,
                    &buffer.samples[after..],
                    buffer.sample_rate,
                    buffer.pts_seconds + after as f64 / buffer.sample_rate,
                    boundary_pts,
                );
            }
        }
        crate::logfile::diagnostic(&format!(
            "[capture-health] audio sidecars fenced at writer PTS {boundary_seconds:.6}s"
        ));
        Ok(())
    }

    fn cancel_fence(&self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if !state.fence_pending {
            return;
        }
        let session_start = state.session_start_pts.unwrap_or(0.0);
        state.fence_pending = false;
        Self::flush_all(&mut state, session_start);
    }

    fn finish(&self) -> Result<(), String> {
        self.cancel_fence();
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        let session_start = state.session_start_pts.unwrap_or(0.0);
        Self::flush_all(&mut state, session_start);
        if let Some(writer) = state.system.take() {
            writer.finish()?;
        }
        if let Some(writer) = state.microphone.take() {
            writer.finish()?;
        }
        state.failed.clone().map_or(Ok(()), Err)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ClosedSegmentFile {
    pub path: PathBuf,
    pub sequence: u64,
    pub media_fragments: u64,
    pub bytes_written: u64,
    pub boundary_seconds: Option<f64>,
}

pub(crate) struct SegmentFence {
    result: std::sync::mpsc::Receiver<Result<ClosedSegmentFile, String>>,
    audio_sidecars: Option<(Arc<AudioSidecarManager>, PathBuf)>,
}

impl SegmentFence {
    pub(crate) fn wait(self, timeout: Duration) -> Result<ClosedSegmentFile, String> {
        match self.result.recv_timeout(timeout) {
            Ok(Ok(closed)) => {
                if let Some((sidecars, next_path)) = self.audio_sidecars {
                    let boundary = closed.boundary_seconds.ok_or_else(|| {
                        sidecars.cancel_fence();
                        "AVAssetWriter did not report the video fragment boundary".to_string()
                    })?;
                    sidecars.complete_fence(&next_path, boundary)?;
                }
                Ok(closed)
            }
            Ok(Err(error)) => {
                if let Some((sidecars, _)) = self.audio_sidecars {
                    sidecars.cancel_fence();
                }
                Err(error)
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if let Some((sidecars, _)) = self.audio_sidecars {
                    sidecars.cancel_fence();
                }
                Err("fragment fence timed out".into())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                if let Some((sidecars, _)) = self.audio_sidecars {
                    sidecars.cancel_fence();
                }
                Err("fragment fence was cancelled before completion".into())
            }
        }
    }
}

struct PendingFence {
    next_path: PathBuf,
    completion: std::sync::mpsc::Sender<Result<ClosedSegmentFile, String>>,
}

struct SegmentSinkState {
    file: std::fs::File,
    path: PathBuf,
    sequence: u64,
    bytes_written: u64,
    media_fragments: u64,
    init_segment: Option<Vec<u8>>,
    pending_fences: std::collections::VecDeque<PendingFence>,
    failed: Option<String>,
}

#[derive(Clone, Copy, Debug, Default)]
struct SegmentProgress {
    bytes_written: u64,
    media_fragments: u64,
    has_initialization: bool,
}

pub(super) struct SegmentSink {
    state: Mutex<SegmentSinkState>,
}

impl SegmentSink {
    fn create(path: &Path) -> Result<Arc<Self>, String> {
        let file = std::fs::File::create(path)
            .map_err(|e| format!("could not create recording file {}: {e}", path.display()))?;
        Ok(Arc::new(Self {
            state: Mutex::new(SegmentSinkState {
                file,
                path: path.to_path_buf(),
                sequence: 0,
                bytes_written: 0,
                media_fragments: 0,
                init_segment: None,
                pending_fences: std::collections::VecDeque::new(),
                failed: None,
            }),
        }))
    }

    fn fail(state: &mut SegmentSinkState, error: String) {
        if state.failed.is_none() {
            state.failed = Some(error.clone());
        }
        while let Some(fence) = state.pending_fences.pop_front() {
            let _ = fence.completion.send(Err(error.clone()));
        }
    }

    fn write_current(state: &mut SegmentSinkState, bytes: &[u8]) -> Result<(), String> {
        use std::io::Write;
        state
            .file
            .write_all(bytes)
            .map_err(|err| format!("segment write failed: {err}"))?;
        state.bytes_written = state.bytes_written.saturating_add(bytes.len() as u64);
        Ok(())
    }

    fn failure(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|guard| guard.failed.clone())
    }

    fn progress(&self) -> SegmentProgress {
        self.state
            .lock()
            .map(|state| SegmentProgress {
                bytes_written: state.bytes_written,
                media_fragments: state.media_fragments,
                has_initialization: state.init_segment.is_some(),
            })
            .unwrap_or_default()
    }

    fn cancel_pending(&self, error: &str) {
        if let Ok(mut state) = self.state.lock() {
            while let Some(fence) = state.pending_fences.pop_front() {
                let _ = fence.completion.send(Err(error.to_owned()));
            }
        }
    }

    pub(crate) fn fence(&self, next_path: PathBuf) -> Result<SegmentFence, String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if let Some(error) = state.failed.clone() {
            return Err(error);
        }
        if next_path == state.path
            || state
                .pending_fences
                .iter()
                .any(|f| f.next_path == next_path)
        {
            return Err("fragment fence path is already active or pending".into());
        }
        let (completion, result) = std::sync::mpsc::channel();
        state.pending_fences.push_back(PendingFence {
            next_path,
            completion,
        });
        Ok(SegmentFence {
            result,
            audio_sidecars: None,
        })
    }

    fn append(&self, bytes: &[u8], segment_type: isize, boundary_seconds: Option<f64>) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if state.failed.is_some() {
            return;
        }
        match segment_type {
            AV_ASSET_WRITER_SEGMENT_TYPE_INITIALIZATION => {
                state.init_segment = Some(bytes.to_vec());
                crate::logfile::diagnostic(&format!(
                    "[capture-health] writer initialization segment: {} bytes",
                    bytes.len()
                ));
                if state.media_fragments == 0 && state.bytes_written == 0 {
                    if let Err(error) = Self::write_current(&mut state, bytes) {
                        Self::fail(&mut state, error);
                    }
                }
            }
            AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE => {
                let Some(init) = state.init_segment.clone() else {
                    Self::fail(
                        &mut state,
                        "media fragment arrived before initialization segment".into(),
                    );
                    return;
                };
                if state.media_fragments > 0 && !state.pending_fences.is_empty() {
                    let fence = state.pending_fences.pop_front().expect("checked above");
                    use std::io::Write;
                    let closed = ClosedSegmentFile {
                        path: state.path.clone(),
                        sequence: state.sequence,
                        media_fragments: state.media_fragments,
                        bytes_written: state.bytes_written,
                        boundary_seconds,
                    };
                    let rotate = (|| -> Result<(), String> {
                        state
                            .file
                            .flush()
                            .map_err(|e| format!("segment flush failed: {e}"))?;
                        state
                            .file
                            .sync_all()
                            .map_err(|e| format!("segment sync failed: {e}"))?;
                        let mut next = std::fs::File::create(&fence.next_path).map_err(|e| {
                            format!(
                                "could not create fenced recording file {}: {e}",
                                fence.next_path.display()
                            )
                        })?;
                        next.write_all(&init)
                            .map_err(|e| format!("segment init write failed: {e}"))?;
                        state.file = next;
                        state.path = fence.next_path.clone();
                        state.sequence = state.sequence.saturating_add(1);
                        state.bytes_written = init.len() as u64;
                        state.media_fragments = 0;
                        Self::write_current(&mut state, bytes)?;
                        state.media_fragments = 1;
                        Ok(())
                    })();
                    match rotate {
                        Ok(()) => {
                            let _ = fence.completion.send(Ok(closed));
                        }
                        Err(error) => {
                            let _ = fence.completion.send(Err(error.clone()));
                            Self::fail(&mut state, error);
                        }
                    }
                } else if let Err(error) = Self::write_current(&mut state, bytes) {
                    Self::fail(&mut state, error);
                } else {
                    state.media_fragments = state.media_fragments.saturating_add(1);
                    if state.media_fragments == 1 {
                        crate::logfile::diagnostic(&format!(
                            "[capture-health] first writer media fragment: {} bytes",
                            bytes.len()
                        ));
                    }
                }
            }
            _ => Self::fail(
                &mut state,
                format!("unsupported AVAssetWriter segment type {segment_type}"),
            ),
        }
    }
}

struct SegmentDelegateIvars {
    sink: Arc<SegmentSink>,
}

objc2::define_class!(
    // SAFETY: NSObject has no subclassing requirements and the type has no
    // Drop impl. Methods are called by AVFoundation on its own serial queue.
    #[unsafe(super(objc2::runtime::NSObject))]
    #[name = "ClipsSegmentWriterDelegate"]
    #[ivars = SegmentDelegateIvars]
    struct SegmentWriterDelegate;

    impl SegmentWriterDelegate {
        #[unsafe(method(assetWriter:didOutputSegmentData:segmentType:segmentReport:))]
        fn did_output_segment(
            &self,
            _writer: *mut objc2::runtime::AnyObject,
            data: *mut objc2::runtime::AnyObject,
            segment_type: isize,
            segment_report: *mut objc2::runtime::AnyObject,
        ) {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if data.is_null() {
                    return;
                }
                let (ptr, len): (*const std::ffi::c_void, usize) = unsafe {
                    (
                        objc2::msg_send![&*data, bytes],
                        objc2::msg_send![&*data, length],
                    )
                };
                if ptr.is_null() || len == 0 {
                    return;
                }
                let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };
                let boundary_seconds = if segment_report.is_null() {
                    None
                } else {
                    let reports: *mut objc2::runtime::AnyObject = unsafe {
                        objc2::msg_send![&*segment_report, trackReports]
                    };
                    let count: usize = if reports.is_null() { 0 } else { unsafe { objc2::msg_send![&*reports, count] } };
                    if count == 0 {
                        None
                    } else {
                        let track: *mut objc2::runtime::AnyObject = unsafe { objc2::msg_send![&*reports, objectAtIndex: 0usize] };
                        let earliest: ObjcCMTime = unsafe { objc2::msg_send![&*track, earliestPresentationTimeStamp] };
                        ((earliest.flags & 1) != 0 && earliest.timescale > 0)
                            .then_some(earliest.value as f64 / earliest.timescale as f64)
                    }
                };
                use objc2::DefinedClass;
                self.ivars().sink.append(bytes, segment_type, boundary_seconds);
            }));
        }
    }
);

impl SegmentWriterDelegate {
    fn new(sink: Arc<SegmentSink>) -> objc2::rc::Retained<Self> {
        use objc2::AllocAnyThread;
        let this = Self::alloc().set_ivars(SegmentDelegateIvars { sink });
        unsafe { objc2::msg_send![super(this), init] }
    }
}

pub(crate) struct CustomScreenCaptureWriter {
    inner: Arc<Mutex<CustomScreenCaptureWriterState>>,
    mixer: Option<Arc<Mutex<LiveAudioMixer>>>,
    started: Arc<AtomicBool>,
    session_start_bits: Arc<AtomicU64>,
    appends_closed: Arc<AtomicBool>,
    dropped_samples: Arc<AtomicU64>,
    pause_offset_bits: Arc<AtomicU64>,
    audio_producer: Option<crate::capture_audio_bus::AudioProducer>,
    audio_sidecars: Option<Arc<AudioSidecarManager>>,
}

struct CustomScreenCaptureWriterState {
    writer: objc2::rc::Retained<objc2::runtime::AnyObject>,
    video_input: objc2::rc::Retained<objc2::runtime::AnyObject>,
    system_audio_input: Option<objc2::rc::Retained<objc2::runtime::AnyObject>>,
    mic_audio_input: Option<objc2::rc::Retained<objc2::runtime::AnyObject>>,
    mixed_audio_input: Option<objc2::rc::Retained<objc2::runtime::AnyObject>>,
    segmented: bool,
    segment_sink: Option<Arc<SegmentSink>>,
    #[allow(dead_code)]
    segment_delegate: Option<objc2::rc::Retained<SegmentWriterDelegate>>,
    session_start_time: Option<(i64, i32)>,
    finished: bool,
    failed: Option<String>,
    append_stats: std::collections::HashMap<&'static str, TrackAppendStats>,
}

mod track_labels {
    pub(super) const VIDEO: &str = "video";
    pub(super) const SYSTEM_AUDIO: &str = "system-audio";
    pub(super) const MIC_AUDIO: &str = "mic-audio";
    pub(super) const MIXED_AUDIO: &str = "mixed-audio";
}

#[derive(Default, Clone, Copy)]
struct TrackAppendStats {
    appended: u64,
    last_pts_seconds: Option<f64>,
    pts_regressions: u64,
}

// SAFETY: `Retained<AnyObject>` is `!Send`/`!Sync` by default because objc2
// cannot know an arbitrary object's threading contract. Here every
// Objective-C call on the retained writer/input handles (`startWriting`,
// `startSessionAtSourceTime:`, `appendSampleBuffer:`, `markAsFinished`,
// `finishWriting…`, `status`/`error` reads) happens while holding the `inner`
// mutex, so access is serialized even though callbacks arrive on multiple SCK
// dispatch queues. The remaining shared fields are lock-free atomics
// (`started`, `session_start_bits`, `appends_closed`, `dropped_samples`), and
// the mixer holds no Objective-C state and lives behind its own mutex.
// Objective-C retain/release itself is atomic, so moving the retained
// pointers across threads is sound.
unsafe impl Send for CustomScreenCaptureWriter {}
unsafe impl Sync for CustomScreenCaptureWriter {}
unsafe impl Send for CustomScreenCaptureWriterState {}

#[derive(Clone)]
struct CustomScreenCaptureOutputHandler {
    app: AppHandle,
    writer: CustomScreenCaptureWriter,
    stream_generation: u64,
    active_stream_generation: Arc<AtomicU64>,
    callback_admission: Arc<RwLock<()>>,
    clip_sink: Arc<Mutex<Option<ClipSinkSlot>>>,
    recording_enabled: Arc<AtomicBool>,
    mic_ready: Option<Arc<AtomicBool>>,
    audio_level_tick: Arc<AtomicU32>,
    watch: Arc<CaptureWatch>,
}

pub(crate) struct ClipSinkSlot {
    writer: CustomScreenCaptureWriter,
    gate: Arc<ClipSinkGate>,
}

fn install_only_slot<T>(slot: &mut Option<T>, value: T) -> Result<(), String> {
    if slot.is_some() {
        return Err("a Clip sink is already attached to this capture producer".into());
    }
    *slot = Some(value);
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum ClipSinkState {
    Prepared = 0,
    Active = 1,
    Paused = 2,
    Closed = 3,
}

struct ClipSinkGate {
    state: AtomicU64,
    activated_at: Mutex<Option<Instant>>,
    paused_at: Mutex<Option<Instant>>,
    paused_total: Mutex<Duration>,
    logical_end: Mutex<Option<Instant>>,
}

impl ClipSinkGate {
    fn new() -> Self {
        Self {
            state: AtomicU64::new(ClipSinkState::Prepared as u64),
            activated_at: Mutex::new(None),
            paused_at: Mutex::new(None),
            paused_total: Mutex::new(Duration::ZERO),
            logical_end: Mutex::new(None),
        }
    }

    fn state(&self) -> ClipSinkState {
        match self.state.load(Ordering::SeqCst) {
            1 => ClipSinkState::Active,
            2 => ClipSinkState::Paused,
            3 => ClipSinkState::Closed,
            _ => ClipSinkState::Prepared,
        }
    }

    fn accepts(&self) -> bool {
        self.state() == ClipSinkState::Active
    }

    fn media_duration_ms(&self) -> u64 {
        let started = self.activated_at.lock().ok().and_then(|value| *value);
        let Some(started) = started else {
            return 0;
        };
        let paused_total = self
            .paused_total
            .lock()
            .map(|value| *value)
            .unwrap_or_default();
        let current_pause = self
            .paused_at
            .lock()
            .ok()
            .and_then(|value| *value)
            .map(|value| value.elapsed())
            .unwrap_or_default();
        started
            .elapsed()
            .saturating_sub(paused_total)
            .saturating_sub(current_pause)
            .as_millis() as u64
    }
}

pub(crate) struct PreparedClipSink {
    slot: Arc<Mutex<Option<ClipSinkSlot>>>,
    writer: CustomScreenCaptureWriter,
    gate: Arc<ClipSinkGate>,
}

impl PreparedClipSink {
    pub(crate) fn activate(&self) -> Result<(), String> {
        let slot = self.slot.lock().map_err(|error| error.to_string())?;
        let installed = slot
            .as_ref()
            .is_some_and(|installed| Arc::ptr_eq(&installed.gate, &self.gate));
        if !installed || self.gate.state() != ClipSinkState::Prepared {
            return Err("Clip sink is not prepared".to_string());
        }
        *self
            .gate
            .activated_at
            .lock()
            .map_err(|error| error.to_string())? = Some(Instant::now());
        self.gate
            .state
            .store(ClipSinkState::Active as u64, Ordering::SeqCst);
        Ok(())
    }

    pub(crate) fn pause(&self) -> Result<(), String> {
        let _slot = self.slot.lock().map_err(|error| error.to_string())?;
        if self.gate.state() != ClipSinkState::Active {
            return Err("Clip sink is not active".into());
        }
        *self
            .gate
            .paused_at
            .lock()
            .map_err(|error| error.to_string())? = Some(Instant::now());
        self.gate
            .state
            .store(ClipSinkState::Paused as u64, Ordering::SeqCst);
        Ok(())
    }

    pub(crate) fn resume(&self) -> Result<(), String> {
        let _slot = self.slot.lock().map_err(|error| error.to_string())?;
        if self.gate.state() != ClipSinkState::Paused {
            return Err("Clip sink is no longer paused".into());
        }
        let paused_at = self
            .gate
            .paused_at
            .lock()
            .map_err(|e| e.to_string())?
            .take()
            .ok_or_else(|| "Clip sink is not paused".to_string())?;
        let paused_for = paused_at.elapsed();
        let mut paused_total = self
            .gate
            .paused_total
            .lock()
            .map_err(|error| error.to_string())?;
        *paused_total = paused_total.saturating_add(paused_for);
        self.writer
            .set_pause_offset(self.writer.pause_offset() + paused_for.as_secs_f64());
        self.gate
            .state
            .store(ClipSinkState::Active as u64, Ordering::SeqCst);
        Ok(())
    }

    pub(crate) fn deactivate(&self) {
        if let Ok(_slot) = self.slot.lock() {
            self.gate
                .state
                .store(ClipSinkState::Closed as u64, Ordering::SeqCst);
        }
        if let Ok(mut end) = self.gate.logical_end.lock() {
            *end = Some(Instant::now());
        }
    }

    pub(crate) fn duration_ms(&self) -> u64 {
        self.gate.media_duration_ms()
    }

    pub(crate) fn finalize(&self) -> Result<(), String> {
        self.deactivate();
        let result = self.writer.finish(true);
        self.remove();
        result
    }

    pub(crate) fn cancel(&self) {
        self.deactivate();
        let _ = self.writer.finish(false);
        self.remove();
    }

    fn remove(&self) {
        if let Ok(mut slot) = self.slot.lock() {
            let same_sink = slot
                .as_ref()
                .is_some_and(|installed| Arc::ptr_eq(&installed.gate, &self.gate));
            if same_sink {
                *slot = None;
            }
        }
    }
}

pub(crate) fn prepare_clip_sink(
    slot: Arc<Mutex<Option<ClipSinkSlot>>>,
    output_path: &Path,
    width: u32,
    height: u32,
    include_mic: bool,
    include_system_audio: bool,
    voice_cleanup_enabled: bool,
) -> Result<PreparedClipSink, String> {
    let mut installed = slot.lock().map_err(|e| e.to_string())?;
    if installed.is_some() {
        return Err("a Clip sink is already attached to this capture producer".into());
    }
    let writer = CustomScreenCaptureWriter::new(
        output_path,
        width,
        height,
        include_system_audio,
        include_mic,
        live_audio_mixing_enabled(
            CustomWriterOutput::ClipHls,
            include_mic,
            include_system_audio,
        ),
        voice_cleanup_enabled,
        CustomWriterOutput::ClipHls,
        None,
    )?;
    let gate = Arc::new(ClipSinkGate::new());
    install_only_slot(
        &mut installed,
        ClipSinkSlot {
            writer: writer.clone(),
            gate: Arc::clone(&gate),
        },
    )?;
    drop(installed);
    Ok(PreparedClipSink { slot, writer, gate })
}

impl Clone for CustomScreenCaptureWriter {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            mixer: self.mixer.clone(),
            started: Arc::clone(&self.started),
            session_start_bits: Arc::clone(&self.session_start_bits),
            appends_closed: Arc::clone(&self.appends_closed),
            dropped_samples: Arc::clone(&self.dropped_samples),
            pause_offset_bits: Arc::clone(&self.pause_offset_bits),
            audio_producer: self.audio_producer.clone(),
            audio_sidecars: self.audio_sidecars.clone(),
        }
    }
}

impl CustomScreenCaptureOutputHandler {
    fn replacement_stream(&self) -> Self {
        let _admission = self
            .callback_admission
            .write()
            .unwrap_or_else(|error| error.into_inner());
        let stream_generation = self.active_stream_generation.fetch_add(1, Ordering::SeqCst) + 1;
        Self {
            app: self.app.clone(),
            writer: self.writer.clone(),
            stream_generation,
            active_stream_generation: Arc::clone(&self.active_stream_generation),
            callback_admission: Arc::clone(&self.callback_admission),
            clip_sink: Arc::clone(&self.clip_sink),
            recording_enabled: Arc::clone(&self.recording_enabled),
            mic_ready: self.mic_ready.clone(),
            audio_level_tick: Arc::clone(&self.audio_level_tick),
            watch: Arc::clone(&self.watch),
        }
    }

    fn invalidate_stream(&self) {
        let _admission = self
            .callback_admission
            .write()
            .unwrap_or_else(|error| error.into_inner());
        self.active_stream_generation.fetch_add(1, Ordering::SeqCst);
    }

    fn is_current(&self) -> bool {
        stream_generation_is_current(
            self.active_stream_generation.load(Ordering::SeqCst),
            self.stream_generation,
        )
    }

    fn emit_microphone_level(&self, samples: &[f32]) {
        let tick = self.audio_level_tick.fetch_add(1, Ordering::Relaxed);
        if tick % 3 != 0 || samples.is_empty() {
            return;
        }
        let level = samples
            .iter()
            .copied()
            .map(f32::abs)
            .fold(0.0_f32, f32::max)
            .min(1.0);
        let _ = self.app.emit(
            "voice:audio-level",
            serde_json::json!({ "level": level, "source": "mic" }),
        );
    }
}

fn stream_generation_is_current(active_generation: u64, sample_generation: u64) -> bool {
    active_generation == sample_generation
}

fn sample_pts_advances(previous: Option<f64>, current: f64) -> bool {
    previous.is_none_or(|last| current > last)
}

impl SCStreamOutputTrait for CustomScreenCaptureOutputHandler {
    fn did_output_sample_buffer(
        &self,
        sample_buffer: screencapturekit::cm::CMSampleBuffer,
        of_type: SCStreamOutputType,
    ) {
        let Ok(_admission) = self.callback_admission.read() else {
            return;
        };
        if !self.is_current() {
            return;
        }
        if matches!(of_type, SCStreamOutputType::Microphone) {
            if let Some(mic_ready) = &self.mic_ready {
                mic_ready.store(true, Ordering::Relaxed);
            }
        }
        if matches!(
            of_type,
            SCStreamOutputType::Audio | SCStreamOutputType::Microphone
        ) {
            let mut decoded_mic = None;
            let panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _ = objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
                    decoded_mic = self.writer.publish_audio_sample(&sample_buffer, of_type);
                }));
            }));
            if panic_result.is_err() {
                eprintln!("[mixer] panic while publishing shared {of_type:?} PCM");
            }
            if matches!(of_type, SCStreamOutputType::Microphone) {
                if let Some(samples) = decoded_mic.as_deref() {
                    self.emit_microphone_level(samples);
                }
            }
        }
        if !self.recording_enabled.load(Ordering::SeqCst) {
            return;
        }
        self.watch.note_activity();
        self.watch.note_sample(
            of_type,
            matches!(of_type, SCStreamOutputType::Screen) && sample_buffer.image_buffer().is_some(),
        );
        if self.writer.appends_closed.load(Ordering::SeqCst) {
            return;
        }
        if matches!(of_type, SCStreamOutputType::Screen) {
            use std::sync::atomic::AtomicU64;
            static SCREEN_SEEN: AtomicU64 = AtomicU64::new(0);
            static SCREEN_BUFFERLESS: AtomicU64 = AtomicU64::new(0);
            let seen = SCREEN_SEEN.fetch_add(1, Ordering::Relaxed) + 1;
            if sample_buffer.image_buffer().is_none() {
                let skipped = SCREEN_BUFFERLESS.fetch_add(1, Ordering::Relaxed) + 1;
                if skipped == 1 || skipped % 100 == 0 {
                    eprintln!(
                        "[mixer] screen frame without image buffer skipped ({skipped} so far, status={:?})",
                        sample_buffer.frame_status()
                    );
                }
                return;
            }
            if seen == 1 || seen % 512 == 0 {
                eprintln!(
                    "[mixer] screen frames delivered: seen={seen} bufferless={} status_now={:?}",
                    SCREEN_BUFFERLESS.load(Ordering::Relaxed),
                    sample_buffer.frame_status()
                );
            }
        }
        if let Ok(slot) = self.clip_sink.lock() {
            if let Some(clip) = slot.as_ref().filter(|clip| clip.gate.accepts()) {
                let _ = objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
                    clip.writer.append_sample(&sample_buffer, of_type);
                }));
            }
        }
        let panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let exc_result = objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
                self.writer.append_sample(&sample_buffer, of_type);
            }));
            if let Err(exc) = exc_result {
                let detail = describe_objc_exception(exc);
                eprintln!(
                    "[mixer] append_sample raised Objective-C exception for {of_type:?}: {detail}; cancelling capture"
                );
                self.writer.appends_closed.store(true, Ordering::SeqCst);
            }
        }));
        if panic_result.is_err() {
            eprintln!("[mixer] panic while appending {of_type:?} sample; cancelling capture");
            self.writer.appends_closed.store(true, Ordering::SeqCst);
        }
    }
}

impl CustomScreenCaptureWriter {
    fn new(
        output_path: &Path,
        width: u32,
        height: u32,
        capture_system_audio: bool,
        include_audio: bool,
        mix_live: bool,
        voice_cleanup_enabled: bool,
        output: CustomWriterOutput,
        audio_producer: Option<crate::capture_audio_bus::AudioProducer>,
    ) -> Result<Self, String> {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        #[link(name = "AVFoundation", kind = "framework")]
        extern "C" {
            static AVFileTypeMPEG4: *const AnyObject;
            static AVMediaTypeVideo: *const AnyObject;
            static AVFileTypeProfileMPEG4AppleHLS: *const AnyObject;
            static AVFileTypeProfileMPEG4CMAFCompliant: *const AnyObject;
        }
        #[link(name = "UniformTypeIdentifiers", kind = "framework")]
        extern "C" {}

        let segmented = segmented_output_enabled(
            output,
            crate::remote_flags::current().custom_sck_pipeline_live_upload_enabled,
        );
        unsafe {
            let writer_cls = av_class_named("AVAssetWriter")
                .ok_or_else(|| "AVAssetWriter missing".to_string())?;

            let (writer, segment_sink, segment_delegate) = if segmented {
                let ident = av_ns_string_from("public.mpeg-4")
                    .ok_or_else(|| "NSString for UTType failed".to_string())?;
                let ut_cls =
                    av_class_named("UTType").ok_or_else(|| "UTType missing".to_string())?;
                let ut: *mut AnyObject = msg_send![ut_cls, typeWithIdentifier: &*ident];
                if ut.is_null() {
                    return Err("UTType public.mpeg-4 unavailable".into());
                }
                let allocated: *mut AnyObject = msg_send![writer_cls, alloc];
                let writer_raw: *mut AnyObject = msg_send![allocated, initWithContentType: ut];
                if writer_raw.is_null() {
                    if !allocated.is_null() {
                        let _ = objc2::rc::Retained::from_raw(allocated);
                    }
                    return Err("AVAssetWriter initWithContentType failed".into());
                }
                let writer = objc2::rc::Retained::from_raw(writer_raw)
                    .ok_or_else(|| "AVAssetWriter retain failed".to_string())?;

                let interval = ObjcCMTime {
                    value: OUTPUT_SEGMENT_INTERVAL_SECONDS,
                    timescale: 1,
                    flags: 1,
                    epoch: 0,
                };
                let _: () = msg_send![&*writer, setPreferredOutputSegmentInterval: interval];
                let output_profile = if output.preserves_separate_audio() {
                    AVFileTypeProfileMPEG4CMAFCompliant
                } else {
                    AVFileTypeProfileMPEG4AppleHLS
                };
                let _: () = msg_send![
                    &*writer,
                    setOutputFileTypeProfile: output_profile
                ];

                let sink = SegmentSink::create(output_path)?;
                let delegate = SegmentWriterDelegate::new(Arc::clone(&sink));
                let _: () = msg_send![&*writer, setDelegate: &*delegate];
                (writer, Some(sink), Some(delegate))
            } else {
                let url = av_file_url(output_path).ok_or_else(|| {
                    format!("could not build output URL for {}", output_path.display())
                })?;
                let allocated: *mut AnyObject = msg_send![writer_cls, alloc];
                let mut err_ptr: *mut AnyObject = std::ptr::null_mut();
                let writer_raw: *mut AnyObject = msg_send![
                    allocated,
                    initWithURL: &*url,
                    fileType: AVFileTypeMPEG4,
                    error: &mut err_ptr
                ];
                if writer_raw.is_null() {
                    let detail = av_error_suffix(err_ptr);
                    if !allocated.is_null() {
                        let _ = objc2::rc::Retained::from_raw(allocated);
                    }
                    return Err(format!("AVAssetWriter init failed{detail}"));
                }
                let writer = objc2::rc::Retained::from_raw(writer_raw)
                    .ok_or_else(|| "AVAssetWriter retain failed".to_string())?;
                let _: () = msg_send![&*writer, setShouldOptimizeForNetworkUse: true];
                (writer, None, None)
            };
            let input_cls = av_class_named("AVAssetWriterInput")
                .ok_or_else(|| "AVAssetWriterInput missing".to_string())?;
            let video_settings = av_video_output_settings(width, height)?;
            let video_raw: *mut AnyObject = msg_send![
                input_cls,
                assetWriterInputWithMediaType: AVMediaTypeVideo,
                outputSettings: &*video_settings
            ];
            if video_raw.is_null() {
                return Err("AVAssetWriterInput video allocation failed".into());
            }
            let video_input = objc2::rc::Retained::retain(video_raw)
                .ok_or_else(|| "AVAssetWriterInput video retain failed".to_string())?;
            let _: () = msg_send![&*video_input, setExpectsMediaDataInRealTime: true];
            let can_add_video: bool = msg_send![&*writer, canAddInput: &*video_input];
            if !can_add_video {
                return Err("AVAssetWriter cannot add video input".into());
            }
            let _: () = msg_send![&*writer, addInput: &*video_input];

            let sidecar_sources = crate::capture_audio_bus::AudioSources::new(
                include_audio && output.preserves_separate_audio(),
                capture_system_audio && output.preserves_separate_audio(),
            );
            let audio_sidecars = (sidecar_sources.microphone || sidecar_sources.system)
                .then(|| AudioSidecarManager::create(output_path, sidecar_sources))
                .transpose()?;

            let (system_audio_input, mic_audio_input, mixed_audio_input, mixer) = if mix_live {
                let mixed = av_make_audio_writer_input(input_cls, &writer)?;
                (
                    None,
                    None,
                    Some(mixed),
                    Some(LiveAudioMixer::new(
                        segmented,
                        include_audio,
                        capture_system_audio,
                        voice_cleanup_enabled,
                    )?),
                )
            } else {
                let system_audio_input =
                    if capture_system_audio && !output.preserves_separate_audio() {
                        Some(av_make_audio_writer_input(input_cls, &writer)?)
                    } else {
                        None
                    };
                let mic_audio_input = if include_audio && !output.preserves_separate_audio() {
                    Some(av_make_audio_writer_input(input_cls, &writer)?)
                } else {
                    None
                };
                (system_audio_input, mic_audio_input, None, None)
            };

            Ok(Self {
                inner: Arc::new(Mutex::new(CustomScreenCaptureWriterState {
                    writer,
                    video_input,
                    system_audio_input,
                    mic_audio_input,
                    mixed_audio_input,
                    segmented,
                    segment_sink,
                    segment_delegate,
                    session_start_time: None,
                    finished: false,
                    failed: None,
                    append_stats: std::collections::HashMap::new(),
                })),
                mixer: mixer.map(|m| Arc::new(Mutex::new(m))),
                started: Arc::new(AtomicBool::new(false)),
                session_start_bits: Arc::new(AtomicU64::new(f64::NAN.to_bits())),
                appends_closed: Arc::new(AtomicBool::new(false)),
                dropped_samples: Arc::new(AtomicU64::new(0)),
                pause_offset_bits: Arc::new(AtomicU64::new(0.0_f64.to_bits())),
                audio_producer,
                audio_sidecars,
            })
        }
    }

    fn publish_audio_sample(
        &self,
        sample: &screencapturekit::cm::CMSampleBuffer,
        of_type: SCStreamOutputType,
    ) -> Option<Vec<f32>> {
        if self.audio_producer.is_none() && self.audio_sidecars.is_none() {
            return None;
        }
        let label = match of_type {
            SCStreamOutputType::Audio => "shared-system",
            SCStreamOutputType::Microphone => "shared-mic",
            _ => return None,
        };
        let Some((interleaved, pts_seconds)) = extract_interleaved_stereo(sample, label) else {
            return None;
        };
        let mono: Vec<f32> = interleaved
            .chunks_exact(2)
            .map(|channels| (channels[0] + channels[1]) * 0.5)
            .collect();
        if let Some(sidecars) = self.audio_sidecars.as_ref() {
            let session_start_seconds =
                f64::from_bits(self.session_start_bits.load(Ordering::SeqCst));
            if !session_start_seconds.is_nan() {
                sidecars.append(
                    matches!(of_type, SCStreamOutputType::Microphone),
                    &mono,
                    AUDIO_OUTPUT_SAMPLE_RATE as f64,
                    pts_seconds,
                    session_start_seconds,
                );
            }
        }
        let Some(producer) = self.audio_producer.as_ref() else {
            return Some(mono);
        };
        match of_type {
            SCStreamOutputType::Audio => {
                producer.publish_system(&mono, AUDIO_OUTPUT_SAMPLE_RATE as f64)
            }
            SCStreamOutputType::Microphone => {
                producer.publish_microphone(&mono, AUDIO_OUTPUT_SAMPLE_RATE as f64)
            }
            _ => {}
        }
        Some(mono)
    }

    pub(super) fn segmented(&self) -> bool {
        self.inner.lock().map(|g| g.segmented).unwrap_or(false)
    }

    pub(crate) fn request_fragment_fence(
        &self,
        next_path: PathBuf,
    ) -> Result<SegmentFence, String> {
        let guard = self.inner.lock().map_err(|e| e.to_string())?;
        if guard.finished || guard.failed.is_some() {
            return Err("fragment fences require an active custom capture writer".into());
        }
        let sink = guard
            .segment_sink
            .clone()
            .ok_or_else(|| "fragment fences require segmented custom capture".to_string())?;
        if let Some(sidecars) = self.audio_sidecars.as_ref() {
            sidecars.begin_fence()?;
        }
        let mut fence = match sink.fence(next_path.clone()) {
            Ok(fence) => fence,
            Err(error) => {
                if let Some(sidecars) = self.audio_sidecars.as_ref() {
                    sidecars.cancel_fence();
                }
                return Err(error);
            }
        };
        if let Some(sidecars) = self.audio_sidecars.as_ref() {
            fence.audio_sidecars = Some((Arc::clone(sidecars), next_path));
        }
        Ok(fence)
    }

    pub(super) fn is_started(&self) -> bool {
        self.started.load(Ordering::SeqCst)
    }

    fn segment_progress(&self) -> SegmentProgress {
        self.inner
            .lock()
            .ok()
            .and_then(|guard| guard.segment_sink.as_ref().map(|sink| sink.progress()))
            .unwrap_or_default()
    }

    fn failure(&self) -> Option<String> {
        self.inner
            .lock()
            .ok()
            .and_then(|guard| guard.failed.clone())
    }

    fn append_stats_summary(&self) -> String {
        let Ok(guard) = self.inner.lock() else {
            return "append stats unavailable (writer lock poisoned)".to_string();
        };
        if guard.append_stats.is_empty() {
            return "no samples appended on any track".to_string();
        }
        let mut tracks: Vec<_> = guard.append_stats.iter().collect();
        tracks.sort_by_key(|(track, _)| **track);
        tracks
            .iter()
            .map(|(track, stats)| {
                format!(
                    "{track}: appended={} last_pts={} regressions={}",
                    stats.appended,
                    stats
                        .last_pts_seconds
                        .map(|v| format!("{v:.6}s"))
                        .unwrap_or_else(|| "none".to_string()),
                    stats.pts_regressions
                )
            })
            .collect::<Vec<_>>()
            .join(" | ")
    }

    pub(super) fn pause_offset(&self) -> f64 {
        f64::from_bits(self.pause_offset_bits.load(Ordering::SeqCst))
    }

    pub(super) fn set_pause_offset(&self, seconds: f64) {
        self.pause_offset_bits
            .store(seconds.max(0.0).to_bits(), Ordering::SeqCst);
    }

    fn append_sample(
        &self,
        sample: &screencapturekit::cm::CMSampleBuffer,
        of_type: SCStreamOutputType,
    ) {
        if self.mixer.is_some()
            && matches!(
                of_type,
                SCStreamOutputType::Audio | SCStreamOutputType::Microphone
            )
        {
            self.append_mixed_audio(sample, of_type);
            return;
        }

        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        if guard.finished || guard.failed.is_some() {
            return;
        }
        let (input, track) = match of_type {
            SCStreamOutputType::Screen => (Some(guard.video_input.clone()), track_labels::VIDEO),
            SCStreamOutputType::Audio => {
                (guard.system_audio_input.clone(), track_labels::SYSTEM_AUDIO)
            }
            SCStreamOutputType::Microphone => {
                (guard.mic_audio_input.clone(), track_labels::MIC_AUDIO)
            }
        };
        let Some(input) = input else {
            return;
        };
        let timing = match sample.sample_timing_info(0) {
            Ok(timing) if timing.presentation_time_stamp.is_valid() => timing,
            _ => return,
        };
        let source_pts = timing.presentation_time_stamp.as_seconds();

        unsafe {
            if !self.ensure_session_started(&mut guard, timing.presentation_time_stamp) {
                return;
            }
            if guard.segmented {
                let Some(base) = guard.session_start_time else {
                    return;
                };
                let pause_offset = self.pause_offset();
                match retimed_sample_copy(sample, &timing, base, pause_offset) {
                    Ok(copy) => {
                        let rebased_pts = copy
                            .sample_timing_info(0)
                            .ok()
                            .and_then(|t| t.presentation_time_stamp.as_seconds());
                        self.append_sample_ptr(
                            &mut guard,
                            &input,
                            copy.as_ptr(),
                            track,
                            rebased_pts,
                        );
                    }
                    Err(err) => {
                        drop(guard);
                        self.fail(format!("sample retime failed on {track}: {err}"));
                    }
                }
            } else {
                self.append_sample_ptr(&mut guard, &input, sample.as_ptr(), track, source_pts);
            }
        }
    }

    fn append_mixed_audio(
        &self,
        sample: &screencapturekit::cm::CMSampleBuffer,
        of_type: SCStreamOutputType,
    ) {
        let (source, label) = match of_type {
            SCStreamOutputType::Audio => (MixSource::System, "system"),
            SCStreamOutputType::Microphone => (MixSource::Mic, "mic"),
            _ => return,
        };
        let Some((interleaved, pts_seconds)) = extract_interleaved_stereo(sample, label) else {
            return;
        };

        let Some(mixer) = self.mixer.as_ref() else {
            return;
        };
        let Ok(mut mixer_guard) = mixer.lock() else {
            return;
        };
        mixer_guard.set_pause_offset(self.pause_offset());
        mixer_guard.push(source, &interleaved, pts_seconds);
        if !self.started.load(Ordering::SeqCst) {
            return;
        }
        let start_secs = f64::from_bits(self.session_start_bits.load(Ordering::SeqCst));
        if !start_secs.is_nan() {
            mixer_guard.set_min_start(start_secs);
        }
        let emitted = match mixer_guard.drain_ready(false) {
            Ok(buffers) => buffers,
            Err(err) => {
                drop(mixer_guard);
                self.fail(err);
                return;
            }
        };
        if emitted.is_empty() {
            return;
        }

        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        if guard.finished || guard.failed.is_some() {
            return;
        }
        let Some(input) = guard.mixed_audio_input.clone() else {
            return;
        };
        for buffer in &emitted {
            let pts = buffer
                .sample_timing_info(0)
                .ok()
                .and_then(|t| t.presentation_time_stamp.as_seconds());
            unsafe {
                self.append_sample_ptr(
                    &mut guard,
                    &input,
                    buffer.as_ptr(),
                    track_labels::MIXED_AUDIO,
                    pts,
                );
            }
            if guard.failed.is_some() {
                break;
            }
        }
    }

    fn fail(&self, err: String) {
        self.appends_closed.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.inner.lock() {
            if guard.failed.is_none() {
                guard.failed = Some(err);
            }
        }
    }

    unsafe fn ensure_session_started(
        &self,
        guard: &mut CustomScreenCaptureWriterState,
        pts: screencapturekit::cm::CMTime,
    ) -> bool {
        use objc2::msg_send;

        if self.started.load(Ordering::SeqCst) {
            return true;
        }
        let writer_ptr = &*guard.writer as *const objc2::runtime::AnyObject;
        let segmented = guard.segmented;
        let start = if segmented {
            ObjcCMTime {
                value: 0,
                timescale: pts.timescale.max(1),
                flags: 1,
                epoch: 0,
            }
        } else {
            ObjcCMTime::from(pts)
        };
        let outcome = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            if segmented {
                let _: () = msg_send![&*writer_ptr, setInitialSegmentStartTime: start];
            }
            let ok: bool = msg_send![&*writer_ptr, startWriting];
            if !ok {
                return false;
            }
            let _: () = msg_send![&*writer_ptr, startSessionAtSourceTime: start];
            true
        }));
        match outcome {
            Ok(true) => {
                guard.session_start_time = Some((pts.value, pts.timescale.max(1)));
                if let Some(secs) = pts.as_seconds() {
                    self.session_start_bits
                        .store(secs.to_bits(), Ordering::SeqCst);
                }
                self.started.store(true, Ordering::SeqCst);
                crate::logfile::diagnostic("[capture-health] AVAssetWriter session started");
                true
            }
            Ok(false) => {
                self.appends_closed.store(true, Ordering::SeqCst);
                let error = format!(
                    "AVAssetWriter startWriting failed{}",
                    av_writer_error_suffix(&guard.writer)
                );
                crate::logfile::diagnostic(&format!(
                    "[capture-health] {error} (segmented={segmented})"
                ));
                guard.failed = Some(error);
                false
            }
            Err(exc) => {
                self.appends_closed.store(true, Ordering::SeqCst);
                let detail = describe_objc_exception(exc);
                eprintln!("[mixer] startWriting raised Objective-C exception: {detail}");
                let error = format!("AVAssetWriter startWriting raised: {detail}");
                crate::logfile::diagnostic(&format!(
                    "[capture-health] {error} (segmented={segmented})"
                ));
                guard.failed = Some(error);
                false
            }
        }
    }

    unsafe fn append_sample_ptr(
        &self,
        guard: &mut CustomScreenCaptureWriterState,
        input: &objc2::rc::Retained<objc2::runtime::AnyObject>,
        sample_ptr: *mut std::ffi::c_void,
        track: &'static str,
        pts_seconds: Option<f64>,
    ) {
        use objc2::msg_send;

        let ready: bool = msg_send![&**input, isReadyForMoreMediaData];
        if !ready {
            let dropped = self.dropped_samples.fetch_add(1, Ordering::Relaxed) + 1;
            if dropped == 1 || dropped % 100 == 0 {
                eprintln!(
                    "[mixer] writer input not ready on {track}; dropped {dropped} sample(s) so far"
                );
            }
            return;
        }
        let stats = guard.append_stats.entry(track).or_default();
        let previous_pts = stats.last_pts_seconds;
        if let Some(pts) = pts_seconds {
            if !sample_pts_advances(previous_pts, pts) {
                stats.pts_regressions += 1;
                let regressions = stats.pts_regressions;
                if regressions == 1 || regressions % 100 == 0 {
                    crate::logfile::diagnostic(&format!(
                        "[capture-health] dropped {track} sample with non-advancing PTS: {:.6}s after {:.6}s ({regressions} so far)",
                        pts,
                        previous_pts.unwrap_or(f64::NAN)
                    ));
                }
                return;
            }
            stats.last_pts_seconds = Some(pts);
        }
        let appended_before = stats.appended;
        stats.appended += 1;
        let pts_report = |outcome: &str| {
            format!(
                "AVAssetWriter appendSampleBuffer {outcome} on {track} (pts={}, previous={}, appended={appended_before})",
                pts_seconds
                    .map(|v| format!("{v:.6}s"))
                    .unwrap_or_else(|| "unknown".to_string()),
                previous_pts
                    .map(|v| format!("{v:.6}s"))
                    .unwrap_or_else(|| "none".to_string()),
            )
        };
        let input_ptr = &**input as *const objc2::runtime::AnyObject;
        let outcome = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            let appended: bool = msg_send![&*input_ptr, appendSampleBuffer: sample_ptr];
            appended
        }));
        match outcome {
            Ok(true) => {}
            Ok(false) => {
                self.appends_closed.store(true, Ordering::SeqCst);
                guard.failed = Some(format!(
                    "{}{}",
                    pts_report("failed"),
                    av_writer_error_suffix(&guard.writer)
                ));
            }
            Err(exc) => {
                self.appends_closed.store(true, Ordering::SeqCst);
                let detail = describe_objc_exception(exc);
                eprintln!(
                    "[mixer] appendSampleBuffer raised Objective-C exception on {track}: {detail}"
                );
                guard.failed = Some(format!("{}: {detail}", pts_report("raised")));
            }
        }
    }

    pub(super) fn finish(&self, wait_for_finalize: bool) -> Result<(), String> {
        if let Some(producer) = self.audio_producer.as_ref() {
            producer.deactivate();
        }
        if let Some(sidecars) = self.audio_sidecars.as_ref() {
            sidecars.finish()?;
        }
        self.appends_closed.store(true, Ordering::SeqCst);
        let dropped = self.dropped_samples.load(Ordering::Relaxed);
        eprintln!(
            "[mixer] writer finish requested (wait={wait_for_finalize}, dropped_samples={dropped})"
        );

        if let Some(mixer) = self.mixer.as_ref() {
            if self.started.load(Ordering::SeqCst) {
                let mut mixer_guard = mixer.lock().map_err(|e| e.to_string())?;
                let start_secs = f64::from_bits(self.session_start_bits.load(Ordering::SeqCst));
                if !start_secs.is_nan() {
                    mixer_guard.set_min_start(start_secs);
                }
                let emitted = mixer_guard.drain_ready(true);
                let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
                if !guard.finished && guard.failed.is_none() {
                    match emitted {
                        Ok(buffers) => {
                            if let Some(input) = guard.mixed_audio_input.clone() {
                                for buffer in &buffers {
                                    let pts = buffer
                                        .sample_timing_info(0)
                                        .ok()
                                        .and_then(|t| t.presentation_time_stamp.as_seconds());
                                    unsafe {
                                        self.append_sample_ptr(
                                            &mut guard,
                                            &input,
                                            buffer.as_ptr(),
                                            track_labels::MIXED_AUDIO,
                                            pts,
                                        );
                                    }
                                    if guard.failed.is_some() {
                                        break;
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            guard.failed = Some(err);
                        }
                    }
                }
            }
        }

        let (
            writer,
            video_input,
            system_audio_input,
            mic_audio_input,
            mixed_audio_input,
            segment_sink,
            started,
            failed,
        ) = {
            let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
            if guard.finished {
                return guard.failed.clone().map_or(Ok(()), Err);
            }
            guard.finished = true;
            (
                guard.writer.clone(),
                guard.video_input.clone(),
                guard.system_audio_input.clone(),
                guard.mic_audio_input.clone(),
                guard.mixed_audio_input.clone(),
                guard.segment_sink.clone(),
                self.started.load(Ordering::SeqCst),
                guard.failed.clone(),
            )
        };
        if let Some(err) = failed {
            if let Some(sink) = segment_sink.as_ref() {
                sink.cancel_pending("fragment fence cancelled because writer finalization failed");
            }
            return Err(err);
        }
        unsafe {
            use block2::RcBlock;
            use objc2::msg_send;
            use std::sync::mpsc;
            use std::time::Duration as StdDuration;

            if !started {
                let _: () = msg_send![&*writer, cancelWriting];
                if let Some(sink) = segment_sink.as_ref() {
                    sink.cancel_pending(
                        "fragment fence cancelled because writer received no samples",
                    );
                }
                return Err("AVAssetWriter received no samples".into());
            }
            let _: () = msg_send![&*video_input, markAsFinished];
            if let Some(input) = system_audio_input.as_ref() {
                let _: () = msg_send![&**input, markAsFinished];
            }
            if let Some(input) = mic_audio_input.as_ref() {
                let _: () = msg_send![&**input, markAsFinished];
            }
            if let Some(input) = mixed_audio_input.as_ref() {
                let _: () = msg_send![&**input, markAsFinished];
            }

            let (tx, rx) = mpsc::sync_channel::<()>(1);
            let block = RcBlock::new(move || {
                let _ = tx.send(());
            });
            let _: () = msg_send![&*writer, finishWritingWithCompletionHandler: &*block];
            if wait_for_finalize && rx.recv_timeout(StdDuration::from_secs(15)).is_err() {
                let _: () = msg_send![&*writer, cancelWriting];
                if let Some(sink) = segment_sink.as_ref() {
                    sink.cancel_pending(
                        "fragment fence cancelled because writer finalization timed out",
                    );
                }
                return Err("AVAssetWriter finalize timed out".into());
            }
            if wait_for_finalize {
                let status: i64 = msg_send![&*writer, status];
                if status != AV_WRITER_STATUS_COMPLETED {
                    if let Some(sink) = segment_sink.as_ref() {
                        sink.cancel_pending(
                            "fragment fence cancelled because writer finalization failed",
                        );
                    }
                    return Err(format!(
                        "AVAssetWriter finalize failed (status={status}{})",
                        av_writer_error_suffix(&writer)
                    ));
                }
            }
        }
        if let Some(sink) = segment_sink.as_ref() {
            if let Some(err) = sink.failure() {
                sink.cancel_pending("fragment fence cancelled because segment output failed");
                return Err(err);
            }
            sink.cancel_pending(
                "fragment fence reached writer finalization before a media boundary",
            );
        }
        eprintln!("[mixer] writer finish completed (wait={wait_for_finalize})");
        Ok(())
    }
}


const MIX_CHUNK_FRAMES: i64 = 4096;
const MIX_STALL_TIMEOUT: Duration = Duration::from_millis(250);
const MIX_SOURCE_GRACE: Duration = Duration::from_millis(2000);
const AUDIO_FORMAT_LPCM: u32 = 0x6C70_636D; // 'lpcm'
const AUDIO_FORMAT_FLAGS_FLOAT_PACKED: u32 = 1 | 8; // float + packed, interleaved, little-endian

const MIC_AGC_TARGET_RMS: f32 = 0.1;
const MIC_AGC_MIN_GAIN: f32 = 1.0;
const MIC_AGC_MAX_GAIN: f32 = 8.0; // +18 dB
const MIC_AGC_NOISE_FLOOR_RMS: f32 = 0.001;
const MIC_AGC_ENVELOPE_SECONDS: f32 = 0.15;
const MIC_AGC_DUCK_SECONDS: f32 = 0.08;
const MIC_AGC_BOOST_SECONDS: f32 = 1.5;
const MIC_AGC_WARMUP_SECONDS: f32 = 0.2;
const MIC_AGC_CONVERGED_TOLERANCE: f32 = 0.05;
const MIX_LIMIT_CEILING: f32 = 0.891;
const MIX_LIMIT_RELEASE_SECONDS: f32 = 0.15;

fn one_pole_coefficient(tau_seconds: f32, sample_rate: i32) -> f32 {
    if tau_seconds <= 0.0 || sample_rate <= 0 {
        return 1.0;
    }
    -(-1.0 / (tau_seconds * sample_rate as f32)).exp_m1()
}

struct MicAutoGain {
    mean_square: f32,
    gain: f32,
    levelled: bool,
    envelope_coefficient: f32,
    warmup_coefficient: f32,
    duck_coefficient: f32,
    boost_coefficient: f32,
}

impl MicAutoGain {
    fn new(sample_rate: i32) -> Self {
        Self {
            mean_square: 0.0,
            gain: 1.0,
            levelled: false,
            envelope_coefficient: one_pole_coefficient(MIC_AGC_ENVELOPE_SECONDS, sample_rate),
            warmup_coefficient: one_pole_coefficient(MIC_AGC_WARMUP_SECONDS, sample_rate),
            duck_coefficient: one_pole_coefficient(MIC_AGC_DUCK_SECONDS, sample_rate),
            boost_coefficient: one_pole_coefficient(MIC_AGC_BOOST_SECONDS, sample_rate),
        }
    }

    fn next_gain(&mut self, left: f32, right: f32) -> f32 {
        let peak = left.abs().max(right.abs());
        self.mean_square += (peak * peak - self.mean_square) * self.envelope_coefficient;
        let rms = self.mean_square.max(0.0).sqrt();
        if rms >= MIC_AGC_NOISE_FLOOR_RMS {
            let target = (MIC_AGC_TARGET_RMS / rms).clamp(MIC_AGC_MIN_GAIN, MIC_AGC_MAX_GAIN);
            let coefficient = if !self.levelled {
                self.warmup_coefficient
            } else if target < self.gain {
                self.duck_coefficient
            } else {
                self.boost_coefficient
            };
            self.gain += (target - self.gain) * coefficient;
            if !self.levelled && (self.gain - target).abs() <= target * MIC_AGC_CONVERGED_TOLERANCE
            {
                self.levelled = true;
                crate::logfile::diagnostic(&format!(
                    "[capture-health] mic auto-gain levelled: rms={rms:.6} gain={:.2} capped={}",
                    self.gain,
                    self.gain >= MIC_AGC_MAX_GAIN * 0.99
                ));
            }
        }
        self.gain
    }
}

struct MicDenoiser {
    state: Box<nnnoiseless::DenoiseState<'static>>,
    pending: Vec<f32>,
    pending_start_pts: Option<f64>,
    first_frame: bool,
}

impl MicDenoiser {
    const SAMPLE_RATE: f64 = 48_000.0;
    const SCALE: f32 = 32_768.0;

    fn new() -> Self {
        Self {
            state: nnnoiseless::DenoiseState::new(),
            pending: Vec::new(),
            pending_start_pts: None,
            first_frame: true,
        }
    }

    fn reset(&mut self) {
        self.state = nnnoiseless::DenoiseState::new();
        self.pending.clear();
        self.pending_start_pts = None;
        self.first_frame = true;
    }

    fn process(&mut self, interleaved: &[f32], pts_seconds: f64) -> Vec<(Vec<f32>, f64)> {
        let frame_count = interleaved.len() / 2;
        if frame_count == 0 {
            return Vec::new();
        }

        if let Some(start) = self.pending_start_pts {
            let expected = start + self.pending.len() as f64 / Self::SAMPLE_RATE;
            if (pts_seconds - expected).abs() > 0.02 {
                self.reset();
            }
        }
        if self.pending_start_pts.is_none() {
            self.pending_start_pts = Some(pts_seconds);
        }
        self.pending
            .extend(interleaved[..frame_count * 2].chunks_exact(2).map(|frame| {
                ((frame[0] + frame[1]) * 0.5 * Self::SCALE).clamp(-Self::SCALE, Self::SCALE)
            }));

        let frame_size = nnnoiseless::DenoiseState::FRAME_SIZE;
        let mut output = Vec::new();
        while self.pending.len() >= frame_size {
            let start = self.pending_start_pts.unwrap_or(pts_seconds);
            let input = self.pending[..frame_size].to_vec();
            let mut denoised = vec![0.0_f32; frame_size];
            self.state.process_frame(&mut denoised, &input);
            let samples = if self.first_frame { &input } else { &denoised };
            output.push((Self::stereo_samples(samples), start));
            self.first_frame = false;
            self.pending.drain(..frame_size);
            self.pending_start_pts = Some(start + frame_size as f64 / Self::SAMPLE_RATE);
        }
        output
    }

    fn flush(&mut self) -> Vec<(Vec<f32>, f64)> {
        if self.pending.is_empty() {
            return Vec::new();
        }
        let frame_size = nnnoiseless::DenoiseState::FRAME_SIZE;
        let count = self.pending.len();
        let start = self.pending_start_pts.unwrap_or(0.0);
        let mut input = vec![0.0_f32; frame_size];
        input[..count].copy_from_slice(&self.pending);
        let mut denoised = vec![0.0_f32; frame_size];
        self.state.process_frame(&mut denoised, &input);
        let samples = if self.first_frame { &input } else { &denoised };
        let result = vec![(Self::stereo_samples(&samples[..count]), start)];
        self.pending.clear();
        self.pending_start_pts = None;
        self.first_frame = false;
        result
    }

    fn stereo_samples(mono: &[f32]) -> Vec<f32> {
        let mut stereo = Vec::with_capacity(mono.len() * 2);
        for &sample in mono {
            let sample = (sample / Self::SCALE).clamp(-1.0, 1.0);
            stereo.extend([sample, sample]);
        }
        stereo
    }
}

struct PeakLimiter {
    gain: f32,
    release_coefficient: f32,
}

impl PeakLimiter {
    fn new(sample_rate: i32) -> Self {
        Self {
            gain: 1.0,
            release_coefficient: one_pole_coefficient(MIX_LIMIT_RELEASE_SECONDS, sample_rate),
        }
    }

    fn next_gain(&mut self, peak: f32) -> f32 {
        self.gain += (1.0 - self.gain) * self.release_coefficient;
        if peak > MIX_LIMIT_CEILING {
            self.gain = self.gain.min(MIX_LIMIT_CEILING / peak);
        }
        self.gain
    }
}

struct MixGainStage {
    voice_cleanup_enabled: bool,
    mic: MicAutoGain,
    limiter: PeakLimiter,
}

impl MixGainStage {
    fn new(sample_rate: i32, voice_cleanup_enabled: bool) -> Self {
        Self {
            voice_cleanup_enabled,
            mic: MicAutoGain::new(sample_rate),
            limiter: PeakLimiter::new(sample_rate),
        }
    }

    fn frame(&mut self, system: (f32, f32), mic: (f32, f32)) -> (f32, f32) {
        let mic_gain = if self.voice_cleanup_enabled {
            self.mic.next_gain(mic.0, mic.1)
        } else {
            1.0
        };
        let left = system.0 + mic.0 * mic_gain;
        let right = system.1 + mic.1 * mic_gain;
        let limit = self.limiter.next_gain(left.abs().max(right.abs()));
        (
            (left * limit).clamp(-1.0, 1.0),
            (right * limit).clamp(-1.0, 1.0),
        )
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MixSource {
    System,
    Mic,
}

struct MixerTimeline {
    base_frame: i64,
    samples: Vec<f32>,
    started: bool,
    last_push: Option<Instant>,
}

impl MixerTimeline {
    fn new() -> Self {
        Self {
            base_frame: 0,
            samples: Vec::new(),
            started: false,
            last_push: None,
        }
    }

    fn end_frame(&self) -> i64 {
        self.base_frame + (self.samples.len() / 2) as i64
    }

    fn sample_at(&self, frame: i64) -> (f32, f32) {
        if frame < self.base_frame {
            return (0.0, 0.0);
        }
        let offset = ((frame - self.base_frame) as usize) * 2;
        if offset + 1 < self.samples.len() {
            (self.samples[offset], self.samples[offset + 1])
        } else {
            (0.0, 0.0)
        }
    }

    fn push_at(
        &mut self,
        frame_index: i64,
        interleaved: &[f32],
        min_base_frame: i64,
        max_gap: i64,
    ) {
        let frames = interleaved.len() / 2;
        if frames == 0 {
            return;
        }
        if !self.started {
            self.started = true;
            self.base_frame = frame_index.max(min_base_frame);
        }

        let cur_end = self.end_frame();
        if frame_index > cur_end {
            let gap = (frame_index - cur_end).min(max_gap) as usize;
            self.samples
                .extend(std::iter::repeat(0.0_f32).take(gap * 2));
        }

        let overlap_frames = (cur_end - frame_index).max(0) as usize;
        if overlap_frames < frames {
            self.samples
                .extend_from_slice(&interleaved[overlap_frames * 2..]);
        }
    }
}

enum SourceBound {
    Active(i64),
    Stalled,
    Pending,
    Absent,
}

struct LiveAudioMixer {
    format_desc: screencapturekit::cm::CMFormatDescription,
    sample_rate: i32,
    include_microphone: bool,
    capture_system_audio: bool,
    rebase_output: bool,
    session_start_seconds: Option<f64>,
    pause_offset_seconds: f64,
    anchor_seconds: Option<f64>,
    out_pos: i64,
    system: MixerTimeline,
    mic: MixerTimeline,
    mic_denoiser: Option<MicDenoiser>,
    gain: MixGainStage,
    created_at: Instant,
}

impl LiveAudioMixer {
    fn new(
        rebase_output: bool,
        include_microphone: bool,
        capture_system_audio: bool,
        voice_cleanup_enabled: bool,
    ) -> Result<Self, String> {
        let sample_rate = AUDIO_OUTPUT_SAMPLE_RATE as i32;
        let asbd = AudioStreamBasicDescription {
            sample_rate: AUDIO_OUTPUT_SAMPLE_RATE as f64,
            format_id: AUDIO_FORMAT_LPCM,
            format_flags: AUDIO_FORMAT_FLAGS_FLOAT_PACKED,
            bytes_per_packet: 8,
            frames_per_packet: 1,
            bytes_per_frame: 8,
            channels_per_frame: 2,
            bits_per_channel: 32,
            reserved: 0,
        };
        let mut desc: *mut std::ffi::c_void = std::ptr::null_mut();
        let status = unsafe {
            CMAudioFormatDescriptionCreate(
                std::ptr::null(),
                &asbd,
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
                std::ptr::null(),
                &mut desc,
            )
        };
        if status != 0 || desc.is_null() {
            return Err(format!(
                "CMAudioFormatDescriptionCreate failed (status={status})"
            ));
        }
        let format_desc = screencapturekit::cm::CMFormatDescription::from_raw(desc)
            .ok_or_else(|| "CMAudioFormatDescription wrap failed".to_string())?;
        Ok(Self {
            format_desc,
            sample_rate,
            include_microphone,
            capture_system_audio,
            rebase_output,
            session_start_seconds: None,
            pause_offset_seconds: 0.0,
            anchor_seconds: None,
            out_pos: 0,
            system: MixerTimeline::new(),
            mic: MixerTimeline::new(),
            mic_denoiser: voice_cleanup_enabled.then(MicDenoiser::new),
            gain: MixGainStage::new(sample_rate, voice_cleanup_enabled),
            created_at: Instant::now(),
        })
    }

    fn push(&mut self, source: MixSource, interleaved: &[f32], pts_seconds: f64) {
        if source == MixSource::Mic {
            let processed = self
                .mic_denoiser
                .as_mut()
                .map(|denoiser| denoiser.process(interleaved, pts_seconds));
            if let Some(processed) = processed {
                for (processed, processed_pts) in processed {
                    self.push_timeline(MixSource::Mic, &processed, processed_pts);
                }
                return;
            }
        }
        self.push_timeline(source, interleaved, pts_seconds);
    }

    fn push_timeline(&mut self, source: MixSource, interleaved: &[f32], pts_seconds: f64) {
        let frames = interleaved.len() / 2;
        if frames == 0 {
            return;
        }
        let pts_seconds = pts_seconds - self.pause_offset_seconds;
        let anchor = *self.anchor_seconds.get_or_insert(pts_seconds);
        let frame_index =
            (((pts_seconds - anchor) * self.sample_rate as f64).round() as i64).max(0);
        let out_pos = self.out_pos;
        let max_gap = self.sample_rate as i64 * 2;
        let timeline = match source {
            MixSource::System => &mut self.system,
            MixSource::Mic => &mut self.mic,
        };
        timeline.push_at(frame_index, interleaved, out_pos, max_gap);
        timeline.last_push = Some(Instant::now());
    }

    fn set_pause_offset(&mut self, seconds: f64) {
        if seconds > self.pause_offset_seconds + f64::EPSILON {
            if let Some(denoiser) = self.mic_denoiser.as_mut() {
                denoiser.reset();
            }
        }
        self.pause_offset_seconds = seconds;
    }

    fn set_min_start(&mut self, start_seconds: f64) {
        self.session_start_seconds = Some(start_seconds);
        if let Some(anchor) = self.anchor_seconds {
            let floor = (((start_seconds - anchor) * self.sample_rate as f64).ceil() as i64).max(0);
            if floor > self.out_pos {
                self.out_pos = floor;
                self.drain_consumed();
            }
        }
    }

    fn classify(&self, timeline: &MixerTimeline, now: Instant) -> SourceBound {
        if !timeline.started {
            if now.duration_since(self.created_at) < MIX_SOURCE_GRACE {
                SourceBound::Pending
            } else {
                SourceBound::Absent
            }
        } else if timeline
            .last_push
            .map_or(true, |t| now.duration_since(t) >= MIX_STALL_TIMEOUT)
        {
            SourceBound::Stalled
        } else {
            SourceBound::Active(timeline.end_frame())
        }
    }

    fn compute_safe_end(&self, flush: bool) -> i64 {
        if flush {
            let mut end = self.out_pos;
            if self.capture_system_audio {
                end = end.max(self.system.end_frame());
            }
            if self.include_microphone {
                end = end.max(self.mic.end_frame());
            }
            return end;
        }
        let now = Instant::now();
        let sys = self
            .capture_system_audio
            .then(|| self.classify(&self.system, now));
        let mic = self
            .include_microphone
            .then(|| self.classify(&self.mic, now));
        if sys
            .as_ref()
            .is_some_and(|bound| matches!(bound, SourceBound::Pending))
            || mic
                .as_ref()
                .is_some_and(|bound| matches!(bound, SourceBound::Pending))
        {
            return self.out_pos;
        }
        let mut bound = i64::MAX;
        let mut any_active = false;
        for b in [sys.as_ref(), mic.as_ref()].into_iter().flatten() {
            if let SourceBound::Active(end) = b {
                bound = bound.min(*end);
                any_active = true;
            }
        }
        if any_active {
            bound
        } else {
            let mut end = self.out_pos;
            if self.capture_system_audio {
                end = end.max(self.system.end_frame());
            }
            if self.include_microphone {
                end = end.max(self.mic.end_frame());
            }
            end
        }
    }

    fn drain_ready(
        &mut self,
        flush: bool,
    ) -> Result<Vec<screencapturekit::cm::CMSampleBuffer>, String> {
        if flush {
            let processed = self.mic_denoiser.as_mut().map(MicDenoiser::flush);
            if let Some(processed) = processed {
                for (processed, processed_pts) in processed {
                    self.push_timeline(MixSource::Mic, &processed, processed_pts);
                }
            }
        }
        if self.anchor_seconds.is_none() {
            return Ok(Vec::new());
        }
        let safe_end = self.compute_safe_end(flush);
        if safe_end <= self.out_pos {
            return Ok(Vec::new());
        }
        let mut emitted = Vec::new();
        let mut a = self.out_pos;
        while a < safe_end {
            let b = (a + MIX_CHUNK_FRAMES).min(safe_end);
            let n = (b - a) as usize;
            let mut interleaved = vec![0.0_f32; n * 2];
            for f in 0..n {
                let frame = a + f as i64;
                let (left, right) = self
                    .gain
                    .frame(self.system.sample_at(frame), self.mic.sample_at(frame));
                interleaved[f * 2] = left;
                interleaved[f * 2 + 1] = right;
            }
            emitted.push(self.build_sample_buffer(&interleaved, a)?);
            a = b;
        }
        self.out_pos = safe_end;
        self.drain_consumed();
        Ok(emitted)
    }

    fn drain_consumed(&mut self) {
        let out_pos = self.out_pos;
        for timeline in [&mut self.system, &mut self.mic] {
            if out_pos > timeline.base_frame {
                let drop_frames = (out_pos - timeline.base_frame) as usize;
                let drop_samples = (drop_frames * 2).min(timeline.samples.len());
                timeline.samples.drain(0..drop_samples);
                timeline.base_frame = out_pos;
            }
        }
    }

    fn build_sample_buffer(
        &self,
        interleaved: &[f32],
        start_frame: i64,
    ) -> Result<screencapturekit::cm::CMSampleBuffer, String> {
        let frames = interleaved.len() / 2;
        let bytes = unsafe {
            std::slice::from_raw_parts(
                interleaved.as_ptr() as *const u8,
                std::mem::size_of_val(interleaved),
            )
        };
        let block = screencapturekit::cm::CMBlockBuffer::create(bytes)
            .ok_or_else(|| "CMBlockBuffer create failed".to_string())?;
        let anchor = self.anchor_seconds.unwrap_or(0.0);
        let base = if self.rebase_output {
            self.session_start_seconds.unwrap_or(anchor)
        } else {
            0.0
        };
        let pts_value = ((anchor - base) * self.sample_rate as f64).round() as i64 + start_frame;
        let pts = ObjcCMTime {
            value: pts_value,
            timescale: self.sample_rate,
            flags: 1,
            epoch: 0,
        };
        let mut out: *mut std::ffi::c_void = std::ptr::null_mut();
        let status = unsafe {
            CMAudioSampleBufferCreateReadyWithPacketDescriptions(
                std::ptr::null(),
                block.as_ptr(),
                self.format_desc.as_ptr(),
                frames as isize,
                pts,
                std::ptr::null(),
                &mut out,
            )
        };
        if status != 0 || out.is_null() {
            return Err(format!(
                "CMAudioSampleBufferCreate failed (status={status})"
            ));
        }
        screencapturekit::cm::CMSampleBuffer::from_raw(out)
            .ok_or_else(|| "CMSampleBuffer wrap failed".to_string())
    }
}

fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

const K_AUDIO_FLAG_IS_FLOAT: u32 = 1 << 0;
const K_AUDIO_FLAG_IS_SIGNED_INT: u32 = 1 << 2;

fn describe_objc_exception(
    exc: Option<objc2::rc::Retained<objc2::exception::Exception>>,
) -> String {
    match exc {
        Some(e) => format!("{e:?}"),
        None => "unknown Objective-C exception".to_string(),
    }
}

fn source_asbd(
    sample: &screencapturekit::cm::CMSampleBuffer,
) -> Option<AudioStreamBasicDescription> {
    let format = sample.format_description()?;
    let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(format.as_ptr()) };
    if asbd.is_null() {
        return None;
    }
    Some(unsafe { std::ptr::read(asbd) })
}

fn decode_samples_to_f32(bytes: &[u8], is_float: bool, bits: u32) -> Vec<f32> {
    match (is_float, bits) {
        (true, 32) => bytes_to_f32_vec(bytes),
        (true, 64) => bytes
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().unwrap()) as f32)
            .collect(),
        (false, 16) => bytes
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
            .collect(),
        (false, 24) => bytes
            .chunks_exact(3)
            .map(|c| {
                let raw = (c[0] as i32) | ((c[1] as i32) << 8) | ((c[2] as i32) << 16);
                let signed = if raw & 0x800000 != 0 {
                    raw | !0x00FF_FFFFi32
                } else {
                    raw
                };
                signed as f32 / 8_388_608.0
            })
            .collect(),
        (false, 32) => bytes
            .chunks_exact(4)
            .map(|c| i32::from_le_bytes(c.try_into().unwrap()) as f32 / 2_147_483_648.0)
            .collect(),
        _ => bytes_to_f32_vec(bytes),
    }
}

fn resample_interleaved_stereo(input: &[f32], src_rate: f64, dst_rate: f64) -> Vec<f32> {
    let in_frames = input.len() / 2;
    if in_frames == 0 || src_rate <= 0.0 || dst_rate <= 0.0 || (src_rate - dst_rate).abs() < 1.0 {
        return input.to_vec();
    }
    let ratio = dst_rate / src_rate;
    let out_frames = ((in_frames as f64) * ratio).round() as usize;
    if out_frames == 0 {
        return Vec::new();
    }
    let mut out = vec![0.0_f32; out_frames * 2];
    let step = src_rate / dst_rate;
    for f in 0..out_frames {
        let pos = f as f64 * step;
        let i = pos.floor() as usize;
        let frac = (pos - i as f64) as f32;
        let i1 = (i + 1).min(in_frames - 1);
        for ch in 0..2 {
            let a = input[i * 2 + ch];
            let b = input[i1 * 2 + ch];
            out[f * 2 + ch] = a + (b - a) * frac;
        }
    }
    out
}

fn extract_interleaved_stereo(
    sample: &screencapturekit::cm::CMSampleBuffer,
    label: &str,
) -> Option<(Vec<f32>, f64)> {
    let frames = sample.num_samples();
    if frames == 0 {
        return None;
    }
    let timing = sample.sample_timing_info(0).ok()?;
    let pts_seconds = timing.presentation_time_stamp.as_seconds()?;
    let abl = sample.audio_buffer_list()?;
    let num_buffers = abl.num_buffers();
    if num_buffers == 0 {
        return None;
    }

    let asbd = source_asbd(sample);
    let (is_float, bits, src_rate) = match asbd {
        Some(a) => {
            let is_float = a.format_flags & K_AUDIO_FLAG_IS_FLOAT != 0
                || a.format_flags & K_AUDIO_FLAG_IS_SIGNED_INT == 0;
            (is_float, a.bits_per_channel, a.sample_rate)
        }
        None => (true, 32, AUDIO_OUTPUT_SAMPLE_RATE as f64),
    };

    log_audio_format_once(label, &asbd, num_buffers, &abl, frames);

    let mut out = vec![0.0_f32; frames * 2];
    if num_buffers >= 2 {
        let left = decode_samples_to_f32(abl.get(0)?.data(), is_float, bits);
        let right = decode_samples_to_f32(abl.get(1)?.data(), is_float, bits);
        let n = frames.min(left.len()).min(right.len());
        for i in 0..n {
            out[i * 2] = left[i];
            out[i * 2 + 1] = right[i];
        }
    } else {
        let buf = abl.get(0)?;
        let channels = buf.number_channels.max(1) as usize;
        let decoded = decode_samples_to_f32(buf.data(), is_float, bits);
        if channels >= 2 {
            let n = frames.min(decoded.len() / channels);
            for i in 0..n {
                out[i * 2] = decoded[i * channels];
                out[i * 2 + 1] = decoded[i * channels + 1];
            }
        } else {
            let n = frames.min(decoded.len());
            for i in 0..n {
                out[i * 2] = decoded[i];
                out[i * 2 + 1] = decoded[i];
            }
        }
    }

    out = resample_interleaved_stereo(&out, src_rate, AUDIO_OUTPUT_SAMPLE_RATE as f64);
    log_decoded_audio_signal_once(label, &out);
    Some((out, pts_seconds))
}

pub(crate) fn extract_mono_audio(
    sample: &screencapturekit::cm::CMSampleBuffer,
    label: &str,
) -> Option<Vec<f32>> {
    let (interleaved, _) = extract_interleaved_stereo(sample, label)?;
    Some(
        interleaved
            .chunks_exact(2)
            .map(|channels| (channels[0] + channels[1]) * 0.5)
            .collect(),
    )
}

fn log_decoded_audio_signal_once(label: &str, samples: &[f32]) {
    use std::sync::atomic::AtomicBool;
    static SYS_SIGNAL_LOGGED: AtomicBool = AtomicBool::new(false);
    static MIC_SIGNAL_LOGGED: AtomicBool = AtomicBool::new(false);
    let peak = samples
        .iter()
        .copied()
        .map(f32::abs)
        .fold(0.0_f32, f32::max);
    if peak <= 0.000_01 {
        return;
    }
    let flag = if label.contains("mic") {
        &MIC_SIGNAL_LOGGED
    } else {
        &SYS_SIGNAL_LOGGED
    };
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    let rms = if samples.is_empty() {
        0.0
    } else {
        (samples
            .iter()
            .map(|sample| (*sample as f64) * (*sample as f64))
            .sum::<f64>()
            / samples.len() as f64)
            .sqrt()
    };
    crate::logfile::diagnostic(&format!(
        "[capture-health] decoded {label} PCM: samples={} peak={peak:.6} rms={rms:.6}",
        samples.len()
    ));
}

fn log_audio_format_once(
    label: &str,
    asbd: &Option<AudioStreamBasicDescription>,
    num_buffers: usize,
    abl: &screencapturekit::cm::AudioBufferList,
    frames: usize,
) {
    use std::sync::atomic::AtomicBool;
    static SYS_LOGGED: AtomicBool = AtomicBool::new(false);
    static MIC_LOGGED: AtomicBool = AtomicBool::new(false);
    let flag = if label == "mic" {
        &MIC_LOGGED
    } else {
        &SYS_LOGGED
    };
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    let ch0 = abl.get(0).map(|b| (b.number_channels, b.data_byte_size()));
    let ch1 = abl.get(1).map(|b| (b.number_channels, b.data_byte_size()));
    eprintln!(
        "[mixer] {label} format: asbd={asbd:?} num_buffers={num_buffers} frames={frames} buf0={ch0:?} buf1={ch1:?}"
    );
}

#[repr(C)]
#[derive(Copy, Clone, Debug)]
struct AudioStreamBasicDescription {
    sample_rate: f64,
    format_id: u32,
    format_flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
    reserved: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct ObjcCMSampleTimingInfo {
    duration: ObjcCMTime,
    presentation_time_stamp: ObjcCMTime,
    decode_time_stamp: ObjcCMTime,
}

fn rebased_time(
    t: screencapturekit::cm::CMTime,
    base: (i64, i32),
    pause_offset_seconds: f64,
) -> ObjcCMTime {
    const K_CMTIME_FLAG_VALID: u32 = 1;
    if t.flags & K_CMTIME_FLAG_VALID == 0 {
        return ObjcCMTime::from(t);
    }
    let (base_value, base_timescale) = base;
    let base_in_t = if t.timescale == base_timescale {
        base_value
    } else {
        (i128::from(base_value) * i128::from(t.timescale) / i128::from(base_timescale.max(1)))
            as i64
    };
    let pause_in_t = (pause_offset_seconds * f64::from(t.timescale)).round() as i64;
    ObjcCMTime {
        value: t.value - base_in_t - pause_in_t,
        timescale: t.timescale,
        flags: t.flags,
        epoch: t.epoch,
    }
}

fn retimed_sample_copy(
    sample: &screencapturekit::cm::CMSampleBuffer,
    timing: &screencapturekit::cm::CMSampleTimingInfo,
    base: (i64, i32),
    pause_offset_seconds: f64,
) -> Result<screencapturekit::cm::CMSampleBuffer, String> {
    let new_timing = ObjcCMSampleTimingInfo {
        duration: ObjcCMTime::from(timing.duration),
        presentation_time_stamp: rebased_time(
            timing.presentation_time_stamp,
            base,
            pause_offset_seconds,
        ),
        decode_time_stamp: rebased_time(timing.decode_time_stamp, base, pause_offset_seconds),
    };
    let mut out: *mut std::ffi::c_void = std::ptr::null_mut();
    let status = unsafe {
        CMSampleBufferCreateCopyWithNewTiming(
            std::ptr::null(),
            sample.as_ptr(),
            1,
            &new_timing,
            &mut out,
        )
    };
    if status != 0 || out.is_null() {
        return Err(format!(
            "CMSampleBufferCreateCopyWithNewTiming failed (status={status})"
        ));
    }
    screencapturekit::cm::CMSampleBuffer::from_raw(out)
        .ok_or_else(|| "retimed CMSampleBuffer wrap failed".to_string())
}

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMAudioFormatDescriptionCreate(
        allocator: *const std::ffi::c_void,
        asbd: *const AudioStreamBasicDescription,
        layout_size: usize,
        layout: *const std::ffi::c_void,
        magic_cookie_size: usize,
        magic_cookie: *const std::ffi::c_void,
        extensions: *const std::ffi::c_void,
        format_description_out: *mut *mut std::ffi::c_void,
    ) -> i32;

    fn CMAudioSampleBufferCreateReadyWithPacketDescriptions(
        allocator: *const std::ffi::c_void,
        data_buffer: *mut std::ffi::c_void,
        format_description: *mut std::ffi::c_void,
        num_samples: isize,
        presentation_time_stamp: ObjcCMTime,
        packet_descriptions: *const std::ffi::c_void,
        sample_buffer_out: *mut *mut std::ffi::c_void,
    ) -> i32;

    fn CMAudioFormatDescriptionGetStreamBasicDescription(
        format_description: *mut std::ffi::c_void,
    ) -> *const AudioStreamBasicDescription;

    fn CMSampleBufferCreateCopyWithNewTiming(
        allocator: *const std::ffi::c_void,
        original: *mut std::ffi::c_void,
        num_timing_entries: isize,
        timing_array: *const ObjcCMSampleTimingInfo,
        sample_buffer_out: *mut *mut std::ffi::c_void,
    ) -> i32;
}

#[repr(C)]
#[derive(Copy, Clone)]
struct ObjcCMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

unsafe impl objc2::encode::RefEncode for ObjcCMTime {
    const ENCODING_REF: objc2::encode::Encoding =
        objc2::encode::Encoding::Pointer(&<Self as objc2::encode::Encode>::ENCODING);
}

unsafe impl objc2::encode::Encode for ObjcCMTime {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CMTime",
        &[
            <i64 as objc2::encode::Encode>::ENCODING,
            <i32 as objc2::encode::Encode>::ENCODING,
            <u32 as objc2::encode::Encode>::ENCODING,
            <i64 as objc2::encode::Encode>::ENCODING,
        ],
    );
}

impl From<screencapturekit::cm::CMTime> for ObjcCMTime {
    fn from(value: screencapturekit::cm::CMTime) -> Self {
        Self {
            value: value.value,
            timescale: value.timescale,
            flags: value.flags,
            epoch: value.epoch,
        }
    }
}

unsafe fn av_class_named(name: &str) -> Option<&'static objc2::runtime::AnyClass> {
    let bytes = std::ffi::CString::new(name).ok()?;
    objc2::runtime::AnyClass::get(&bytes)
}

unsafe fn av_ns_string_from(s: &str) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let cstr = std::ffi::CString::new(s).ok()?;
    let allocated: *mut AnyObject = msg_send![class!(NSString), alloc];
    if allocated.is_null() {
        return None;
    }
    let inited: *mut AnyObject = msg_send![allocated, initWithUTF8String: cstr.as_ptr()];
    if inited.is_null() {
        let _ = objc2::rc::Retained::from_raw(allocated);
        None
    } else {
        objc2::rc::Retained::from_raw(inited)
    }
}

unsafe fn av_file_url(path: &Path) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let path_str = path.to_str()?;
    let nsstr = av_ns_string_from(path_str)?;
    let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: &*nsstr];
    if url.is_null() {
        None
    } else {
        objc2::rc::Retained::retain(url)
    }
}

unsafe fn av_number_i64(value: i64) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let raw: *mut AnyObject = msg_send![class!(NSNumber), numberWithLongLong: value];
    if raw.is_null() {
        None
    } else {
        objc2::rc::Retained::retain(raw)
    }
}

unsafe fn av_number_bool(value: bool) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let raw: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: value];
    if raw.is_null() {
        None
    } else {
        objc2::rc::Retained::retain(raw)
    }
}

unsafe fn av_dict() -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let raw: *mut AnyObject = msg_send![class!(NSMutableDictionary), dictionary];
    if raw.is_null() {
        Err("NSMutableDictionary allocation failed".into())
    } else {
        objc2::rc::Retained::retain(raw)
            .ok_or_else(|| "NSMutableDictionary retain failed".to_string())
    }
}

unsafe fn av_dict_set(
    dict: &objc2::runtime::AnyObject,
    key: *const objc2::runtime::AnyObject,
    value: &objc2::runtime::AnyObject,
) {
    use objc2::msg_send;

    let _: () = msg_send![dict, setObject: value, forKey: key];
}

unsafe fn av_video_output_settings(
    width: u32,
    height: u32,
) -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::runtime::AnyObject;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVVideoCodecKey: *const AnyObject;
        static AVVideoCodecTypeH264: *const AnyObject;
        static AVVideoHeightKey: *const AnyObject;
        static AVVideoWidthKey: *const AnyObject;
        static AVVideoCompressionPropertiesKey: *const AnyObject;
        static AVVideoAllowFrameReorderingKey: *const AnyObject;
        static AVVideoAverageBitRateKey: *const AnyObject;
        static AVVideoExpectedSourceFrameRateKey: *const AnyObject;
        static AVVideoMaxKeyFrameIntervalKey: *const AnyObject;
    }

    let settings = av_dict()?;
    let width_value =
        av_number_i64(width as i64).ok_or_else(|| "NSNumber width failed".to_string())?;
    let height_value =
        av_number_i64(height as i64).ok_or_else(|| "NSNumber height failed".to_string())?;
    av_dict_set(&settings, AVVideoCodecKey, &*AVVideoCodecTypeH264);
    av_dict_set(&settings, AVVideoWidthKey, &width_value);
    av_dict_set(&settings, AVVideoHeightKey, &height_value);

    let compression = av_dict()?;
    let no_reordering =
        av_number_bool(false).ok_or_else(|| "NSNumber reordering flag failed".to_string())?;
    av_dict_set(&compression, AVVideoAllowFrameReorderingKey, &no_reordering);

    let average_bit_rate =
        (CAPTURE_VIDEO_BPP * f64::from(width) * f64::from(height) * f64::from(NATIVE_CAPTURE_FPS))
            as i64;
    let bit_rate =
        av_number_i64(average_bit_rate).ok_or_else(|| "NSNumber bit rate failed".to_string())?;
    av_dict_set(&compression, AVVideoAverageBitRateKey, &bit_rate);
    let expected_fps = av_number_i64(i64::from(NATIVE_CAPTURE_FPS))
        .ok_or_else(|| "NSNumber expected fps failed".to_string())?;
    av_dict_set(
        &compression,
        AVVideoExpectedSourceFrameRateKey,
        &expected_fps,
    );
    let keyframe_interval = av_number_i64((i64::from(NATIVE_CAPTURE_FPS) * 3 / 4).max(1))
        .ok_or_else(|| "NSNumber keyframe interval failed".to_string())?;
    av_dict_set(
        &compression,
        AVVideoMaxKeyFrameIntervalKey,
        &keyframe_interval,
    );

    av_dict_set(&settings, AVVideoCompressionPropertiesKey, &compression);
    Ok(settings)
}

unsafe fn av_audio_output_settings(
) -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::runtime::AnyObject;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVEncoderBitRateKey: *const AnyObject;
        static AVFormatIDKey: *const AnyObject;
        static AVNumberOfChannelsKey: *const AnyObject;
        static AVSampleRateKey: *const AnyObject;
    }

    let settings = av_dict()?;
    let format = av_number_i64(AUDIO_FORMAT_AAC)
        .ok_or_else(|| "NSNumber audio format failed".to_string())?;
    let sample_rate =
        av_number_i64(48_000).ok_or_else(|| "NSNumber sample rate failed".to_string())?;
    let channels = av_number_i64(2).ok_or_else(|| "NSNumber channels failed".to_string())?;
    let bitrate = av_number_i64(128_000).ok_or_else(|| "NSNumber bitrate failed".to_string())?;
    av_dict_set(&settings, AVFormatIDKey, &format);
    av_dict_set(&settings, AVSampleRateKey, &sample_rate);
    av_dict_set(&settings, AVNumberOfChannelsKey, &channels);
    av_dict_set(&settings, AVEncoderBitRateKey, &bitrate);
    Ok(settings)
}

unsafe fn av_make_audio_writer_input(
    input_cls: &objc2::runtime::AnyClass,
    writer: &objc2::runtime::AnyObject,
) -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVMediaTypeAudio: *const AnyObject;
    }

    let settings = av_audio_output_settings()?;
    let raw: *mut AnyObject = msg_send![
        input_cls,
        assetWriterInputWithMediaType: AVMediaTypeAudio,
        outputSettings: &*settings
    ];
    if raw.is_null() {
        return Err("AVAssetWriterInput audio allocation failed".into());
    }
    let input = objc2::rc::Retained::retain(raw)
        .ok_or_else(|| "AVAssetWriterInput audio retain failed".to_string())?;
    let _: () = msg_send![&*input, setExpectsMediaDataInRealTime: true];
    let can_add: bool = msg_send![writer, canAddInput: &*input];
    if !can_add {
        return Err("AVAssetWriter cannot add audio input".into());
    }
    let _: () = msg_send![writer, addInput: &*input];
    Ok(input)
}

unsafe fn av_error_suffix(err_obj: *mut objc2::runtime::AnyObject) -> String {
    if err_obj.is_null() {
        return String::new();
    }
    let desc_obj: *mut objc2::runtime::AnyObject = objc2::msg_send![err_obj, localizedDescription];
    let mut out = av_string_suffix(desc_obj);

    let domain_obj: *mut objc2::runtime::AnyObject = objc2::msg_send![err_obj, domain];
    let code: i64 = objc2::msg_send![err_obj, code];
    out.push_str(&format!(
        " [domain{} code={code}]",
        av_string_suffix(domain_obj)
    ));

    let reason_obj: *mut objc2::runtime::AnyObject =
        objc2::msg_send![err_obj, localizedFailureReason];
    if !reason_obj.is_null() {
        out.push_str(&format!(" reason{}", av_string_suffix(reason_obj)));
    }

    if let Some(cls) = av_class_named("NSString") {
        let key_cstr = b"NSUnderlyingError\0".as_ptr() as *const i8;
        let key: *mut objc2::runtime::AnyObject =
            objc2::msg_send![cls, stringWithUTF8String: key_cstr];
        if !key.is_null() {
            let user_info: *mut objc2::runtime::AnyObject = objc2::msg_send![err_obj, userInfo];
            if !user_info.is_null() {
                let underlying: *mut objc2::runtime::AnyObject =
                    objc2::msg_send![user_info, objectForKey: key];
                if !underlying.is_null() {
                    let u_domain: *mut objc2::runtime::AnyObject =
                        objc2::msg_send![underlying, domain];
                    let u_code: i64 = objc2::msg_send![underlying, code];
                    out.push_str(&format!(
                        " underlying=[domain{} code={u_code}]",
                        av_string_suffix(u_domain)
                    ));
                }
            }
        }
    }
    out
}

unsafe fn av_writer_error_suffix(writer: &objc2::runtime::AnyObject) -> String {
    let status: i64 = objc2::msg_send![writer, status];
    let err_obj: *mut objc2::runtime::AnyObject = objc2::msg_send![writer, error];
    format!(" (writer status={status}){}", av_error_suffix(err_obj))
}

unsafe fn av_string_suffix(obj: *mut objc2::runtime::AnyObject) -> String {
    if obj.is_null() {
        return String::new();
    }
    let utf8: *const i8 = objc2::msg_send![obj, UTF8String];
    if utf8.is_null() {
        return String::new();
    }
    let cstr = std::ffi::CStr::from_ptr(utf8);
    format!(": {}", cstr.to_string_lossy())
}

#[derive(Clone)]
struct RestartParams {
    include_audio: bool,
    capture_system_audio: bool,
    emit_recorder_stop: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    target_display_id: Option<u32>,
    target_window_id: Option<u32>,
    target_window_dimensions: Option<(u32, u32)>,
    capture_region: Option<NativeCaptureRegion>,
    width: u32,
    height: u32,
}

pub(crate) struct CustomCaptureResume {
    stream: Arc<Mutex<SCStream>>,
    handler: CustomScreenCaptureOutputHandler,
    watch: Arc<CaptureWatch>,
    params: RestartParams,
}

impl CustomCaptureResume {
    pub(crate) fn pause(&self) -> Result<(), String> {
        let guard = self
            .stream
            .lock()
            .map_err(|error| format!("capture pause stream lock failed: {error}"))?;
        guard
            .stop_capture()
            .map_err(|error| format!("capture pause stop_capture failed: {error:?}"))?;
        drop(guard);
        self.watch.set_paused(true);
        self.handler.invalidate_stream();
        eprintln!("[mixer] capture paused; source stream stopped, writer/file kept open");
        Ok(())
    }

    pub(crate) fn resume(&self, paused_for: Duration) -> Result<(), String> {
        let writer = &self.handler.writer;
        let prev_offset = writer.pause_offset();

        let replacement_handler = self.handler.replacement_stream();
        let new_stream =
            build_custom_scstream(&self.params, &replacement_handler, &self.watch, None)?;

        writer.set_pause_offset(prev_offset + paused_for.as_secs_f64());
        if let Err(err) = new_stream.start_capture() {
            writer.set_pause_offset(prev_offset);
            return Err(format!("resume start_capture failed: {err:?}"));
        }

        if let Ok(guard) = self.stream.lock() {
            let _ = guard.stop_capture();
        }
        if let Ok(mut guard) = self.stream.lock() {
            *guard = new_stream;
        }
        let _ = self.watch.take_stream_stopped();
        self.watch.note_activity();
        self.watch.set_paused(false);
        eprintln!(
            "[mixer] capture resumed; fresh stream spliced onto same writer (paused {}ms)",
            paused_for.as_millis()
        );
        Ok(())
    }
}

struct CustomCaptureStreamDelegate {
    watch: Arc<CaptureWatch>,
}

impl SCStreamDelegateTrait for CustomCaptureStreamDelegate {
    fn did_stop_with_error(&self, error: SCError) {
        if error.stream_error_code()
            == Some(screencapturekit::error::SCStreamErrorCode::UserStopped)
        {
            eprintln!("[mixer] capture stopped by the user via macOS");
            self.watch.note_user_stopped();
            return;
        }
        let reason = format!("ScreenCaptureKit stream stopped with error: {error}");
        eprintln!("[mixer] {reason}");
        self.watch.note_stream_stopped(reason);
    }

    fn stream_did_stop(&self, error: Option<String>) {
        let detail = error.unwrap_or_else(|| "no detail".to_string());
        let reason = format!("ScreenCaptureKit stream stopped: {detail}");
        eprintln!("[mixer] {reason}");
        self.watch.note_stream_stopped(reason);
    }
}

fn build_custom_scstream(
    params: &RestartParams,
    handler: &CustomScreenCaptureOutputHandler,
    watch: &Arc<CaptureWatch>,
    prefetched_content: Option<SCShareableContent>,
) -> Result<SCStream, String> {
    let content = match prefetched_content {
        Some(content) => content,
        None => SCShareableContent::get()
            .map_err(|e| format!("shareable content lookup failed: {e:?}"))?,
    };
    let window = params.target_window_id.and_then(|id| {
        content
            .windows()
            .into_iter()
            .find(|candidate| candidate.window_id() == id)
    });
    if params.target_window_id.is_some() && window.is_none() {
        return Err("The selected window is no longer available.".to_string());
    }
    let displays = content.displays();
    let display = if window.is_none() {
        Some(
            params
                .target_display_id
                .and_then(|id| displays.iter().find(|d| d.display_id() == id))
                .or_else(|| displays.first())
                .ok_or_else(|| {
                    "No displays available for ScreenCaptureKit recording.".to_string()
                })?,
        )
    } else {
        None
    };
    let (source_width, source_height) = if let Some(window) = window.as_ref() {
        params.target_window_dimensions.unwrap_or_else(|| {
            let frame = window.frame();
            (
                frame.width.max(1.0).round() as u32,
                frame.height.max(1.0).round() as u32,
            )
        })
    } else {
        let display = display.expect("display is present when no window is selected");
        (display.width(), display.height())
    };
    let region_rect = if window.is_some() {
        None
    } else {
        region_source_rect(params.capture_region, source_width, source_height)?
    };
    let filter = if let Some(window) = window.as_ref() {
        SCContentFilter::create().with_window(window).build()
    } else {
        let display = display.expect("display is present when no window is selected");
        let filter_builder = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[]);
        if let Some((rect, _, _)) = region_rect {
            filter_builder.with_content_rect(rect).build()
        } else {
            filter_builder.build()
        }
    };

    let selected_mic = if params.include_audio {
        resolve_microphone_capture_device(
            params.mic_device_id.as_deref(),
            params.mic_device_label.as_deref(),
        )?
    } else {
        None
    };

    let mut config = SCStreamConfiguration::new()
        .with_width(params.width)
        .with_height(params.height)
        .with_fps(NATIVE_CAPTURE_FPS)
        .with_queue_depth(8)
        .with_shows_cursor(true)
        .with_captures_audio(params.capture_system_audio)
        .with_captures_microphone(params.include_audio)
        .with_excludes_current_process_audio(true)
        .with_sample_rate(48000)
        .with_channel_count(2);
    config.set_pixel_format(screencapturekit::stream::configuration::PixelFormat::YCbCr_420v);
    if let Some((rect, _, _)) = region_rect {
        config.set_source_rect(rect);
    }
    if let Some(device) = selected_mic.as_ref() {
        crate::logfile::diagnostic(&format!(
            "[capture-health] microphone selected: {} ({})",
            device.name, device.id
        ));
        config.set_microphone_capture_device_id(&device.id);
    }
    config.set_stream_name(Some("Clips custom full-screen recording"));

    let delegate = CustomCaptureStreamDelegate {
        watch: Arc::clone(watch),
    };
    let mut stream = SCStream::new_with_delegate(&filter, &config, delegate);
    stream.add_output_handler(handler.clone(), SCStreamOutputType::Screen);
    if params.capture_system_audio {
        stream.add_output_handler(handler.clone(), SCStreamOutputType::Audio);
    }
    if params.include_audio {
        stream.add_output_handler(handler.clone(), SCStreamOutputType::Microphone);
    }
    Ok(stream)
}

fn await_segmented_capture_readiness(
    stream: &SCStream,
    writer: &CustomScreenCaptureWriter,
    watch: &CaptureWatch,
    requested_system_audio: bool,
    requested_microphone: bool,
) -> Result<(), String> {
    let sample_deadline = Instant::now() + CAPTURE_FIRST_SAMPLE_TIMEOUT;
    while Instant::now() < sample_deadline {
        if let Some(error) = watch.take_stream_stopped() {
            return Err(error);
        }
        if let Some(error) = writer.failure() {
            return Err(error);
        }
        let (_, usable_screen, _, _) = watch.sample_counts();
        if usable_screen > 0 && writer.is_started() {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }

    let (screen, usable_screen, system, mic) = watch.sample_counts();
    if usable_screen == 0 || !writer.is_started() {
        let _ = stream.stop_capture();
        let finish_error = writer.finish(true).err();
        return Err(format!(
            "capture startup timed out before the first usable video sample/writer session (screen={screen}, usable_screen={usable_screen}, system_audio={system}, microphone={mic}){}",
            finish_error
                .map(|error| format!("; writer: {error}"))
                .unwrap_or_default()
        ));
    }

    let fragment_deadline = Instant::now() + CAPTURE_FIRST_FRAGMENT_TIMEOUT;
    while Instant::now() < fragment_deadline {
        if let Some(error) = watch.take_stream_stopped() {
            return Err(error);
        }
        if let Some(error) = writer.failure() {
            return Err(error);
        }
        let progress = writer.segment_progress();
        if progress.has_initialization && progress.media_fragments > 0 && progress.bytes_written > 0
        {
            crate::logfile::diagnostic(&format!(
                "[capture-health] segmented capture ready: {} bytes, {} media fragment(s)",
                progress.bytes_written, progress.media_fragments
            ));
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(25));
    }

    let (screen, usable_screen, system, mic) = watch.sample_counts();
    let progress = writer.segment_progress();
    let _ = stream.stop_capture();
    let finish_error = writer.finish(true).err();
    Err(format!(
        "capture startup timed out waiting for the first fragmented-media bytes (screen={screen}, usable_screen={usable_screen}, system_audio={system}, microphone={mic}, requested_system_audio={requested_system_audio}, requested_microphone={requested_microphone}, initialization={}, media_fragments={}, bytes={}){}",
        progress.has_initialization,
        progress.media_fragments,
        progress.bytes_written,
        finish_error
            .map(|error| format!("; writer: {error}"))
            .unwrap_or_default()
    ))
}

fn spawn_capture_watchdog(
    app: AppHandle,
    stream: Arc<Mutex<SCStream>>,
    writer: CustomScreenCaptureWriter,
    handler: CustomScreenCaptureOutputHandler,
    watch: Arc<CaptureWatch>,
    recording_enabled: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    params: RestartParams,
) {
    std::thread::spawn(move || {
        let mut restart_streak: u32 = 0;
        let mut cooldown_until: Option<Instant> = None;

        loop {
            std::thread::sleep(CAPTURE_WATCHDOG_POLL);
            if shutdown.load(Ordering::SeqCst) {
                return;
            }
            if writer.appends_closed.load(Ordering::SeqCst) {
                if shutdown.load(Ordering::SeqCst) {
                    return;
                }
                eprintln!(
                    "[mixer] appends closed without a stop request; treating as fatal capture failure and finalizing partial recording"
                );
                let writer_error = writer
                    .failure()
                    .unwrap_or_else(|| "unknown writer failure".to_string());
                crate::logfile::diagnostic(&format!(
                    "[capture-health] writer closed unexpectedly; finalizing partial recording: {writer_error}"
                ));
                crate::logfile::diagnostic(&format!(
                    "[capture-health] append stats at failure — {}",
                    writer.append_stats_summary()
                ));
                if let Ok(guard) = stream.lock() {
                    let _ = guard.stop_capture();
                }
                if params.emit_recorder_stop {
                    let _ = app.emit("clips:recorder-stop", ());
                }
                return;
            }
            if !recording_enabled.load(Ordering::SeqCst) || !writer.started.load(Ordering::SeqCst) {
                continue;
            }

            if watch.is_paused() {
                restart_streak = 0;
                cooldown_until = None;
                continue;
            }

            if watch.user_stopped() {
                if params.emit_recorder_stop {
                    eprintln!("[mixer] user stopped capture via macOS; emitting recorder stop");
                    let _ = app.emit("clips:recorder-stop", ());
                } else {
                    eprintln!("[mixer] user stopped Screen Memory capture via macOS");
                }
                return;
            }

            if let Some(until) = cooldown_until {
                if Instant::now() < until {
                    continue;
                }
                cooldown_until = None;
                if watch.since_activity() < CAPTURE_STALL_TIMEOUT {
                    restart_streak = 0;
                    continue;
                }
            }

            let reported_stop = watch.take_stream_stopped();
            let stalled = watch.since_activity() >= CAPTURE_STALL_TIMEOUT;
            if reported_stop.is_none() && !stalled {
                restart_streak = 0;
                continue;
            }

            let reason = reported_stop.unwrap_or_else(|| {
                format!(
                    "no capture frames for {:?} (display may have moved to another Space)",
                    watch.since_activity()
                )
            });
            restart_streak += 1;
            if restart_streak > CAPTURE_MAX_RESTARTS {
                eprintln!(
                    "[mixer] capture interrupted ({reason}) and did not recover after {CAPTURE_MAX_RESTARTS} restarts; finalizing partial recording"
                );
                writer.appends_closed.store(true, Ordering::SeqCst);
                if let Ok(guard) = stream.lock() {
                    let _ = guard.stop_capture();
                }
                if params.emit_recorder_stop {
                    let _ = app.emit("clips:recorder-stop", ());
                }
                return;
            }

            eprintln!(
                "[mixer] capture interrupted ({reason}); rebuilding stream (attempt {restart_streak}/{CAPTURE_MAX_RESTARTS})"
            );

            let replacement_handler = handler.replacement_stream();
            if let Ok(guard) = stream.lock() {
                let _ = guard.stop_capture();
            }
            if shutdown.load(Ordering::SeqCst) || writer.appends_closed.load(Ordering::SeqCst) {
                return;
            }

            match build_custom_scstream(&params, &replacement_handler, &watch, None).and_then(|s| {
                s.start_capture()
                    .map(|()| s)
                    .map_err(|e| format!("start_capture failed: {e:?}"))
            }) {
                Ok(new_stream) => {
                    let mut pending_stream = Some(new_stream);
                    let install = if let Ok(mut guard) = stream.lock() {
                        if shutdown.load(Ordering::SeqCst)
                            || writer.appends_closed.load(Ordering::SeqCst)
                            || watch.is_paused()
                            || !replacement_handler.is_current()
                        {
                            false
                        } else {
                            *guard = pending_stream
                                .take()
                                .expect("pending watchdog stream is available");
                            true
                        }
                    } else {
                        false
                    };
                    if !install {
                        if let Some(stream) = pending_stream {
                            let _ = stream.stop_capture();
                        }
                        return;
                    }
                    let _ = watch.take_stream_stopped();
                    cooldown_until = Some(Instant::now() + CAPTURE_STALL_TIMEOUT);
                    eprintln!("[mixer] capture stream rebuilt; waiting for frames");
                }
                Err(err) => {
                    eprintln!("[mixer] capture rebuild failed: {err}");
                    cooldown_until = Some(Instant::now() + CAPTURE_WATCHDOG_POLL);
                }
            }
        }
    });
}

pub(crate) fn start_custom_screencapturekit_backend_at(
    app: &AppHandle,
    output_path: &Path,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<&str>,
    mic_device_label: Option<&str>,
    target_display_id: Option<u32>,
    target_window_id: Option<u32>,
    target_window_dimensions: Option<(u32, u32)>,
    capture_region: Option<NativeCaptureRegion>,
    defer_recording_output: bool,
    force_segmented_output: bool,
    emit_recorder_stop: bool,
    prefetched_content: Option<SCShareableContent>,
) -> Result<(NativeFullscreenBackend, Option<u32>, Option<u32>), String> {
    eprintln!("[clips-tray] starting custom screen capture backend");
    let content = match prefetched_content {
        Some(content) => content,
        None => SCShareableContent::get()
            .map_err(|e| format!("shareable content lookup failed: {e:?}"))?,
    };
    let window = target_window_id.and_then(|id| {
        content
            .windows()
            .into_iter()
            .find(|candidate| candidate.window_id() == id)
    });
    if target_window_id.is_some() && window.is_none() {
        return Err("The selected window is no longer available.".to_string());
    }
    let displays = content.displays();
    let display = if window.is_none() {
        Some(
            target_display_id
                .and_then(|id| displays.iter().find(|d| d.display_id() == id))
                .or_else(|| displays.first())
                .ok_or_else(|| {
                    "No displays available for ScreenCaptureKit recording.".to_string()
                })?,
        )
    } else {
        None
    };
    let (source_width, source_height) = if let Some(window) = window.as_ref() {
        target_window_dimensions.unwrap_or_else(|| {
            let frame = window.frame();
            (
                frame.width.max(1.0).round() as u32,
                frame.height.max(1.0).round() as u32,
            )
        })
    } else {
        let display = display.expect("display is present when no window is selected");
        (display.width(), display.height())
    };
    let region_rect = if window.is_some() {
        None
    } else {
        region_source_rect(capture_region, source_width, source_height)?
    };
    let (capture_width, capture_height) = region_rect
        .as_ref()
        .map(|(_, width, height)| (*width, *height))
        .unwrap_or((source_width, source_height));
    let (width, height) = native_capture_dimensions(capture_width, capture_height);

    let params = RestartParams {
        include_audio,
        capture_system_audio,
        emit_recorder_stop,
        mic_device_id: mic_device_id.map(str::to_string),
        mic_device_label: mic_device_label.map(str::to_string),
        target_display_id,
        target_window_id,
        target_window_dimensions,
        capture_region,
        width,
        height,
    };

    let output = if force_segmented_output {
        CustomWriterOutput::RewindCmaf
    } else {
        CustomWriterOutput::Standard
    };
    let mix_live = live_audio_mixing_enabled(output, include_audio, capture_system_audio);
    let voice_cleanup_enabled = crate::config::feature_config(app).voice_cleanup_enabled;
    let audio_producer = (include_audio || capture_system_audio)
        .then(|| {
            crate::capture_audio_bus::AudioProducer::register(
                crate::capture_audio_bus::AudioSources::new(include_audio, capture_system_audio),
            )
        })
        .transpose()?;
    let writer = CustomScreenCaptureWriter::new(
        output_path,
        width,
        height,
        capture_system_audio,
        include_audio,
        mix_live,
        voice_cleanup_enabled,
        output,
        audio_producer,
    )?;
    let recording_enabled = Arc::new(AtomicBool::new(!defer_recording_output));
    let clip_sink = Arc::new(Mutex::new(None));
    let mic_ready = include_audio.then(|| Arc::new(AtomicBool::new(false)));
    let watch = Arc::new(CaptureWatch::new());
    let handler = CustomScreenCaptureOutputHandler {
        app: app.clone(),
        writer: writer.clone(),
        stream_generation: 0,
        active_stream_generation: Arc::new(AtomicU64::new(0)),
        callback_admission: Arc::new(RwLock::new(())),
        clip_sink: Arc::clone(&clip_sink),
        recording_enabled: Arc::clone(&recording_enabled),
        mic_ready: mic_ready.clone(),
        audio_level_tick: Arc::new(AtomicU32::new(0)),
        watch: Arc::clone(&watch),
    };

    let stream = build_custom_scstream(&params, &handler, &watch, Some(content))?;
    if let Err(err) = stream.start_capture() {
        let _ = std::fs::remove_file(output_path);
        return Err(format!("custom capture start failed: {err:?}"));
    }
    crate::logfile::diagnostic(&format!(
        "[capture-health] ScreenCaptureKit start_capture returned success: system_audio={capture_system_audio} microphone={include_audio} segmented={force_segmented_output} deferred={defer_recording_output}"
    ));
    if force_segmented_output && !defer_recording_output {
        if let Err(error) = await_segmented_capture_readiness(
            &stream,
            &writer,
            &watch,
            capture_system_audio,
            include_audio,
        ) {
            let _ = std::fs::remove_file(output_path);
            let _ = std::fs::remove_file(audio_sidecar_path(output_path, "system"));
            let _ = std::fs::remove_file(audio_sidecar_path(output_path, "microphone"));
            crate::logfile::diagnostic(&format!(
                "[capture-health] segmented capture readiness failed: {error}"
            ));
            return Err(error);
        }
    }
    eprintln!(
        "[clips-tray] custom ScreenCaptureKit recording started: {width}x{height} @ {NATIVE_CAPTURE_FPS}fps from {capture_width}x{capture_height} (display {source_width}x{source_height}), mic={include_audio} system_audio={capture_system_audio} deferred_output={defer_recording_output}"
    );

    let stream = Arc::new(Mutex::new(stream));
    let watchdog_shutdown = Arc::new(AtomicBool::new(false));
    let resume = CustomCaptureResume {
        stream: Arc::clone(&stream),
        handler: handler.clone(),
        watch: Arc::clone(&watch),
        params: params.clone(),
    };
    spawn_capture_watchdog(
        app.clone(),
        Arc::clone(&stream),
        writer.clone(),
        handler,
        Arc::clone(&watch),
        Arc::clone(&recording_enabled),
        Arc::clone(&watchdog_shutdown),
        params,
    );

    Ok((
        NativeFullscreenBackend::CustomScreenCaptureKit {
            stream,
            writer,
            mic_ready,
            recording_enabled,
            watchdog_shutdown,
            resume,
            clip_sink,
        },
        Some(width),
        Some(height),
    ))
}

#[cfg(test)]
mod fragment_fence_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn path(label: &str) -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "clips-fragment-fence-{label}-{}-{}.mp4",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn remove(paths: &[&Path]) {
        for path in paths {
            let _ = std::fs::remove_file(path);
        }
    }

    #[test]
    fn caches_init_and_replays_it_for_each_fenced_file() {
        let first = path("init-first");
        let second = path("init-second");
        let sink = SegmentSink::create(&first).unwrap();
        sink.append(b"INIT", AV_ASSET_WRITER_SEGMENT_TYPE_INITIALIZATION, None);
        sink.append(b"M0", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(0.0));
        let fence = sink.fence(second.clone()).unwrap();
        sink.append(b"M1", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(1.0));
        let closed = fence.wait(Duration::from_secs(1)).unwrap();
        assert_eq!(closed.path, first);
        sink.append(b"M2", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(2.0));
        assert_eq!(std::fs::read(&first).unwrap(), b"INITM0");
        assert_eq!(std::fs::read(&second).unwrap(), b"INITM1M2");
        remove(&[&first, &second]);
    }

    #[test]
    fn routes_each_media_fragment_exactly_once() {
        let first = path("once-first");
        let second = path("once-second");
        let sink = SegmentSink::create(&first).unwrap();
        sink.append(b"I", AV_ASSET_WRITER_SEGMENT_TYPE_INITIALIZATION, None);
        sink.append(b"A", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(0.0));
        let fence = sink.fence(second.clone()).unwrap();
        sink.append(b"B", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(1.0));
        sink.append(b"C", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(2.0));
        assert_eq!(
            fence.wait(Duration::from_secs(1)).unwrap().media_fragments,
            1
        );
        assert_eq!(std::fs::read(&first).unwrap(), b"IA");
        assert_eq!(std::fs::read(&second).unwrap(), b"IBC");
        remove(&[&first, &second]);
    }

    #[test]
    fn repeated_fences_complete_in_fragment_order() {
        let first = path("order-first");
        let second = path("order-second");
        let third = path("order-third");
        let sink = SegmentSink::create(&first).unwrap();
        sink.append(b"I", AV_ASSET_WRITER_SEGMENT_TYPE_INITIALIZATION, None);
        sink.append(b"Z", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(0.0));
        let one = sink.fence(second.clone()).unwrap();
        let two = sink.fence(third.clone()).unwrap();
        sink.append(b"A", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(1.0));
        assert_eq!(one.wait(Duration::from_secs(1)).unwrap().sequence, 0);
        sink.append(b"B", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(2.0));
        assert_eq!(two.wait(Duration::from_secs(1)).unwrap().sequence, 1);
        assert_eq!(std::fs::read(&first).unwrap(), b"IZ");
        assert_eq!(std::fs::read(&second).unwrap(), b"IA");
        assert_eq!(std::fs::read(&third).unwrap(), b"IB");
        remove(&[&first, &second, &third]);
    }

    #[test]
    fn fence_creation_failure_fails_closed() {
        let first = path("error-first");
        let directory = std::env::temp_dir();
        let sink = SegmentSink::create(&first).unwrap();
        sink.append(b"I", AV_ASSET_WRITER_SEGMENT_TYPE_INITIALIZATION, None);
        sink.append(b"Z", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(0.0));
        let fence = sink.fence(directory).unwrap();
        sink.append(b"A", AV_ASSET_WRITER_SEGMENT_TYPE_SEPARABLE, Some(1.0));
        assert!(fence.wait(Duration::from_secs(1)).is_err());
        assert!(sink.failure().is_some());
        remove(&[&first]);
    }

    #[test]
    fn forced_segmented_rewind_disables_live_mix_for_selectable_sidecars() {
        assert!(segmented_output_enabled(
            CustomWriterOutput::RewindCmaf,
            false
        ));
        assert!(!live_audio_mixing_enabled(
            CustomWriterOutput::RewindCmaf,
            true,
            true
        ));
        assert!(live_audio_mixing_enabled(
            CustomWriterOutput::Standard,
            true,
            true
        ));
        assert!(live_audio_mixing_enabled(
            CustomWriterOutput::Standard,
            true,
            false
        ));
        assert!(!live_audio_mixing_enabled(
            CustomWriterOutput::Standard,
            false,
            true
        ));
        assert!(segmented_output_enabled(CustomWriterOutput::ClipHls, false));
        assert!(live_audio_mixing_enabled(
            CustomWriterOutput::ClipHls,
            true,
            true
        ));
    }

    #[test]
    fn mic_denoiser_preserves_frame_boundaries_and_duration() {
        let mut denoiser = MicDenoiser::new();
        let first = vec![0.08_f32; 300 * 2];
        let second = vec![0.12_f32; 300 * 2];

        assert!(denoiser.process(&first, 10.0).is_empty());
        let processed = denoiser.process(&second, 10.0 + 300.0 / 48_000.0);
        assert_eq!(processed.len(), 1);
        assert_eq!(processed[0].0.len(), 480 * 2);
        assert_eq!(processed[0].1, 10.0);
        assert!(processed[0].0.iter().all(|sample| sample.is_finite()));
        assert!(processed[0].0.iter().any(|sample| sample.abs() > 0.01));

        let flushed = denoiser.flush();
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0].0.len(), 120 * 2);
        assert!(flushed[0].0.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn mic_denoiser_resets_pending_audio_after_pause() {
        let mut denoiser = MicDenoiser::new();
        let input = vec![0.1_f32; 120 * 2];
        assert!(denoiser.process(&input, 10.0).is_empty());
        denoiser.reset();
        assert!(denoiser.flush().is_empty());
        assert!(denoiser.process(&input, 20.0).is_empty());
        assert_eq!(denoiser.flush()[0].1, 20.0);
    }

    #[test]
    fn mic_only_mixer_does_not_wait_for_a_disabled_system_source() {
        let mixer = LiveAudioMixer::new(false, true, false, true).unwrap();
        assert_eq!(mixer.compute_safe_end(false), 0);
    }

    #[test]
    fn replacement_stream_rejects_callbacks_from_the_prior_generation() {
        assert!(stream_generation_is_current(1, 1));
        assert!(!stream_generation_is_current(1, 0));
    }

    #[test]
    fn timestamp_admission_rejects_equal_and_regressing_samples() {
        assert!(sample_pts_advances(None, 1.0));
        assert!(sample_pts_advances(Some(1.0), 1.01));
        assert!(!sample_pts_advances(Some(1.0), 1.0));
        assert!(!sample_pts_advances(Some(1.0), 0.99));
    }

    #[test]
    fn clip_sink_gate_orders_prepare_activate_and_logical_close() {
        let gate = ClipSinkGate::new();
        assert!(!gate.accepts(), "prepared sinks ignore callbacks");
        gate.state
            .store(ClipSinkState::Active as u64, Ordering::SeqCst);
        assert!(gate.accepts(), "activated sink accepts callbacks");
        gate.state
            .store(ClipSinkState::Closed as u64, Ordering::SeqCst);
        assert!(!gate.accepts(), "logical close wins before finalization");
    }

    #[test]
    fn clip_sink_slot_rejects_second_install() {
        let mut slot = None;
        install_only_slot(&mut slot, 1_u8).unwrap();
        assert!(install_only_slot(&mut slot, 2_u8).is_err());
        assert_eq!(slot, Some(1));
    }

    #[test]
    fn audio_sidecars_preserve_sources_and_rotate_as_valid_float_wav() {
        let first = path("audio-first");
        let second = path("audio-second");
        let sidecars = AudioSidecarManager::create(
            &first,
            crate::capture_audio_bus::AudioSources::new(true, true),
        )
        .unwrap();
        sidecars.append(false, &[0.25; 480], 48_000.0, 10.010, 10.0);
        sidecars.append(true, &[0.5; 480], 48_000.0, 10.020, 10.0);
        sidecars.begin_fence().unwrap();
        sidecars.append(false, &[0.1; 960], 48_000.0, 10.025, 10.0);
        sidecars.append(true, &[0.2; 960], 48_000.0, 10.025, 10.0);
        sidecars.complete_fence(&second, 0.030).unwrap();
        sidecars.append(false, &[0.1; 480], 48_000.0, 10.040, 10.0);
        sidecars.append(true, &[0.2; 480], 48_000.0, 10.040, 10.0);
        sidecars.finish().unwrap();

        let first_system = audio_sidecar_path(&first, "system");
        let first_microphone = audio_sidecar_path(&first, "microphone");
        let second_system = audio_sidecar_path(&second, "system");
        let second_microphone = audio_sidecar_path(&second, "microphone");
        for wav in [
            &first_system,
            &first_microphone,
            &second_system,
            &second_microphone,
        ] {
            let bytes = std::fs::read(wav).unwrap();
            assert_eq!(&bytes[..4], b"RIFF");
            assert_eq!(&bytes[8..12], b"WAVE");
            assert!(bytes.len() > 44);
        }
        let wav_samples = |path: &Path| (std::fs::metadata(path).unwrap().len() - 44) / 4;
        assert_eq!(wav_samples(&first_system), 1_440);
        assert_eq!(wav_samples(&first_microphone), 1_440);
        assert_eq!(wav_samples(&second_system), 960);
        assert_eq!(wav_samples(&second_microphone), 960);
        remove(&[
            &first_system,
            &first_microphone,
            &second_system,
            &second_microphone,
        ]);
    }
}
