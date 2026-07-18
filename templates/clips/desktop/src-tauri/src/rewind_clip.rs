use crate::capture_graph::{CaptureConsumer, CaptureGraphState, CaptureInterval, CaptureSource};
use crate::native_screen::{
    self, FinalizedNativeArtifact, NativeAudioSelection, NativeFullscreenSaveResult,
    NativeFullscreenUploadResult, NativeMediaSlice, NativeUploadMode,
};
use crate::screen_memory::{self, ScreenMemorySegmentMetadata};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const RETROSPECTIVE_30_SECONDS: u64 = 30;
const RETROSPECTIVE_5_MINUTES: u64 = 5 * 60;
const REWIND_CLIP_AUDIO_OWNER: &str = "rewind-clip";

#[derive(Default)]
pub(crate) struct RewindClipState(Mutex<Option<ActiveRewindClip>>);

pub(crate) fn is_active(app: &AppHandle) -> bool {
    app.try_state::<RewindClipState>()
        .and_then(|state| state.0.lock().ok().map(|active| active.is_some()))
        .unwrap_or(false)
}

struct ActiveRewindClip {
    lease_id: Option<String>,
    pin_id: String,
    started_elapsed_ms: u64,
    pinned_segments: BTreeSet<String>,
    sources: Vec<CaptureSource>,
    retrospective_seconds: u64,
    intervals: Vec<CaptureInterval>,
    paused: bool,
    include_mic: bool,
    include_system_audio: bool,
    temporary_audio: Option<screen_memory::TemporaryAudioLease>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RewindClipCompatibility {
    Compatible,
    NotCompatible,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindClipStatus {
    compatibility: RewindClipCompatibility,
    active: bool,
    retrospective_seconds: u64,
    paused: bool,
    sources: Vec<CaptureSource>,
}

fn not_compatible(detail: impl AsRef<str>) -> String {
    format!("rewind-not-compatible: {}", detail.as_ref())
}

#[tauri::command]
pub(crate) fn rewind_clip_status(
    app: AppHandle,
    state: State<'_, RewindClipState>,
) -> Result<RewindClipStatus, String> {
    let active_guard = state.0.lock().map_err(|error| error.to_string())?;
    let active = active_guard.is_some();
    let compatible = screen_memory::rewind_clip_compatible(&app)?;
    Ok(RewindClipStatus {
        compatibility: if compatible {
            RewindClipCompatibility::Compatible
        } else {
            RewindClipCompatibility::NotCompatible
        },
        active,
        retrospective_seconds: active_guard
            .as_ref()
            .map(|active| active.retrospective_seconds)
            .unwrap_or(0),
        paused: active_guard.as_ref().is_some_and(|active| active.paused),
        sources: active_guard
            .as_ref()
            .map(|active| active.sources.clone())
            .unwrap_or_else(|| screen_memory::rewind_clip_sources(&app)),
    })
}

/// Called after countdown zero. Requested audio upgrades the one rolling
/// producer before the zero fence; fencing then discards all prior media so
/// the Clip interval begins on a clean successor with the requested sources.
#[tauri::command]
pub(crate) fn rewind_clip_start(
    app: AppHandle,
    state: State<'_, RewindClipState>,
    include_mic: bool,
    include_system_audio: bool,
) -> Result<RewindClipStatus, String> {
    if !screen_memory::rewind_clip_compatible(&app)? {
        return Err(not_compatible(
            "Screen Memory is unavailable or not recording",
        ));
    }
    if state.0.lock().map_err(|error| error.to_string())?.is_some() {
        return Err("a Rewind-derived clip is already active".into());
    }
    let temporary_audio = if include_mic || include_system_audio {
        screen_memory::acquire_temporary_audio_consumer(
            &app,
            REWIND_CLIP_AUDIO_OWNER,
            CaptureConsumer::Clip,
            include_mic,
            include_system_audio,
        )?
    } else {
        None
    };
    if (include_mic || include_system_audio) && temporary_audio.is_none() {
        return Err(not_compatible("Screen Memory has no active audio producer"));
    }
    if let Err(error) = screen_memory::fence_active_for_clip(&app) {
        release_temporary_audio(&app, temporary_audio);
        return Err(error);
    }
    let sources = screen_memory::rewind_clip_sources(&app);
    let lease = match app
        .state::<CaptureGraphState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .start_consumer(CaptureConsumer::Clip, sources.iter().copied())
    {
        Ok(lease) => lease,
        Err(error) => {
            release_temporary_audio(&app, temporary_audio);
            return Err(error.to_string());
        }
    };
    let response_sources = sources.clone();
    let mut active = state.0.lock().map_err(|error| error.to_string())?;
    if active.is_some() {
        end_clip_graph_lease(&app, &lease.id);
        drop(active);
        release_temporary_audio(&app, temporary_audio);
        return Err("a Rewind-derived clip is already active".into());
    }
    *active = Some(ActiveRewindClip {
        pin_id: format!("rewind-clip-{}", lease.id),
        lease_id: Some(lease.id),
        started_elapsed_ms: lease.interval.started_elapsed_ms,
        pinned_segments: BTreeSet::new(),
        sources,
        retrospective_seconds: 0,
        intervals: Vec::new(),
        paused: false,
        include_mic,
        include_system_audio,
        temporary_audio,
    });
    Ok(RewindClipStatus {
        compatibility: RewindClipCompatibility::Compatible,
        active: true,
        retrospective_seconds: 0,
        paused: false,
        sources: response_sources,
    })
}

fn release_temporary_audio(app: &AppHandle, lease: Option<screen_memory::TemporaryAudioLease>) {
    if let Some(lease) = lease {
        if let Err(error) = screen_memory::release_temporary_audio_consumer(app, lease) {
            eprintln!("[clips-tray] Rewind Clip audio lease release failed: {error}");
        }
    }
}

fn end_clip_graph_lease(app: &AppHandle, lease_id: &str) {
    if let Ok(mut graph) = app.state::<CaptureGraphState>().0.lock() {
        let _ = graph.end_consumer(lease_id);
    }
}

#[tauri::command]
pub(crate) fn rewind_clip_extend(
    app: AppHandle,
    state: State<'_, RewindClipState>,
    seconds: u64,
) -> Result<RewindClipStatus, String> {
    if !matches!(seconds, RETROSPECTIVE_30_SECONDS | RETROSPECTIVE_5_MINUTES) {
        return Err("retrospective extension must be exactly 30 or 300 seconds".into());
    }
    let lease_id = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .as_ref()
        .and_then(|active| active.lease_id.clone())
        .ok_or_else(|| "no Rewind-derived clip is active".to_string())?;
    let lease = app
        .state::<CaptureGraphState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .extend_retrospectively(&lease_id, std::time::Duration::from_secs(seconds))
        .map_err(|error| error.to_string())?;
    {
        let mut active = state.0.lock().map_err(|error| error.to_string())?;
        let active = active
            .as_mut()
            .ok_or_else(|| "no Rewind-derived clip is active".to_string())?;
        active.started_elapsed_ms = lease.interval.started_elapsed_ms;
        active.retrospective_seconds = seconds;
        for segment in screen_memory::finalized_segments_in_graph_interval(
            &app,
            lease.interval.started_elapsed_ms,
            lease.interval.ended_elapsed_ms,
        )? {
            screen_memory::pin_segment(&app, &segment.id, &active.pin_id)?;
            active.pinned_segments.insert(segment.id);
        }
    }
    Ok(RewindClipStatus {
        compatibility: RewindClipCompatibility::Compatible,
        active: true,
        retrospective_seconds: lease.retrospective_extension_ms / 1000,
        paused: false,
        sources: state
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .as_ref()
            .map(|active| active.sources.clone())
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub(crate) fn rewind_clip_pause(
    app: AppHandle,
    state: State<'_, RewindClipState>,
) -> Result<RewindClipStatus, String> {
    let lease_id = {
        let active = state.0.lock().map_err(|error| error.to_string())?;
        let active = active
            .as_ref()
            .ok_or_else(|| "no Rewind-derived clip is active".to_string())?;
        if active.paused {
            return Err("Rewind-derived clip is already paused".into());
        }
        active
            .lease_id
            .clone()
            .ok_or_else(|| "active Clip lease is missing".to_string())?
    };
    let fenced = screen_memory::fence_active_for_clip(&app)?;
    let closed = app
        .state::<CaptureGraphState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .end_consumer(&lease_id)
        .map_err(|e| e.to_string())?;
    let mut interval = closed.lease.interval;
    interval.ended_elapsed_ms = interval.ended_elapsed_ms.min(fenced.graph_ended_elapsed_ms);
    let (status, temporary_audio) = {
        let mut active = state.0.lock().map_err(|e| e.to_string())?;
        let active = active
            .as_mut()
            .ok_or_else(|| "no Rewind-derived clip is active".to_string())?;
        active.intervals.push(interval);
        active.lease_id = None;
        active.paused = true;
        let temporary_audio = active.temporary_audio.take();
        (
            RewindClipStatus {
                compatibility: RewindClipCompatibility::Compatible,
                active: true,
                retrospective_seconds: active.retrospective_seconds,
                paused: true,
                sources: active.sources.clone(),
            },
            temporary_audio,
        )
    };
    release_temporary_audio(&app, temporary_audio);
    Ok(status)
}

#[tauri::command]
pub(crate) fn rewind_clip_resume(
    app: AppHandle,
    state: State<'_, RewindClipState>,
) -> Result<RewindClipStatus, String> {
    let (include_mic, include_system_audio) = {
        let active = state.0.lock().map_err(|e| e.to_string())?;
        let active = active
            .as_ref()
            .ok_or_else(|| "no Rewind-derived clip is active".to_string())?;
        if !active.paused {
            return Err("Rewind-derived clip is not paused".into());
        }
        (active.include_mic, active.include_system_audio)
    };
    let temporary_audio = if include_mic || include_system_audio {
        screen_memory::acquire_temporary_audio_consumer(
            &app,
            REWIND_CLIP_AUDIO_OWNER,
            CaptureConsumer::Clip,
            include_mic,
            include_system_audio,
        )?
    } else {
        None
    };
    if (include_mic || include_system_audio) && temporary_audio.is_none() {
        return Err(not_compatible("Screen Memory has no active audio producer"));
    }
    if let Err(error) = screen_memory::fence_active_for_clip(&app) {
        release_temporary_audio(&app, temporary_audio);
        return Err(error);
    }
    let sources = screen_memory::rewind_clip_sources(&app);
    let lease = match app
        .state::<CaptureGraphState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .start_consumer(CaptureConsumer::Clip, sources.iter().copied())
    {
        Ok(lease) => lease,
        Err(error) => {
            release_temporary_audio(&app, temporary_audio);
            return Err(error.to_string());
        }
    };
    let mut active = state.0.lock().map_err(|e| e.to_string())?;
    let active = active
        .as_mut()
        .ok_or_else(|| "no Rewind-derived clip is active".to_string())?;
    active.lease_id = Some(lease.id);
    active.started_elapsed_ms = lease.interval.started_elapsed_ms;
    active.sources = sources;
    active.paused = false;
    active.temporary_audio = temporary_audio;
    Ok(RewindClipStatus {
        compatibility: RewindClipCompatibility::Compatible,
        active: true,
        retrospective_seconds: active.retrospective_seconds,
        paused: false,
        sources: active.sources.clone(),
    })
}

fn take_active(state: &State<'_, RewindClipState>) -> Result<ActiveRewindClip, String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or_else(|| "no Rewind-derived clip is active".to_string())
}

fn artifact_path(app: &AppHandle, label: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("local data directory unavailable: {error}"))?
        .join("pending-recordings");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("pending recording directory unavailable: {error}"))?;
    Ok(dir.join(format!(
        "rewind-{label}-{}.mp4",
        chrono::Utc::now().timestamp_millis()
    )))
}

fn validate_and_plan(
    segments: &[ScreenMemorySegmentMetadata],
    start_ms: u64,
    end_ms: u64,
) -> Result<Vec<NativeMediaSlice>, String> {
    const MAX_SEGMENT_BOUNDARY_QUANTIZATION_MS: u64 = 2;
    let mut segments = segments.to_vec();
    segments.sort_by_key(|segment| segment.graph_started_elapsed_ms);
    let mut cursor = start_ms;
    let mut slices = Vec::new();
    for segment in segments {
        if segment.corrupt || segment.error.is_some() || segment.exclusion_tainted {
            return Err("selected Rewind media is corrupt, tainted, or incomplete".into());
        }
        let overlap_start = start_ms.max(segment.graph_started_elapsed_ms);
        let overlap_end = end_ms.min(segment.graph_ended_elapsed_ms);
        if overlap_start >= overlap_end {
            continue;
        }
        if overlap_start.saturating_sub(cursor) > MAX_SEGMENT_BOUNDARY_QUANTIZATION_MS {
            return Err("selected Rewind interval contains a coverage gap".into());
        }
        slices.push(NativeMediaSlice {
            path: segment.path,
            system_audio_path: segment.system_audio_path,
            microphone_path: segment.microphone_path,
            start_ms: overlap_start - segment.graph_started_elapsed_ms,
            end_ms: overlap_end - segment.graph_started_elapsed_ms,
        });
        cursor = cursor.max(overlap_end);
    }
    if end_ms.saturating_sub(cursor) > MAX_SEGMENT_BOUNDARY_QUANTIZATION_MS || slices.is_empty() {
        return Err("selected Rewind interval is not fully covered".into());
    }
    Ok(slices)
}

fn select_audio(
    sources: &[CaptureSource],
    include_mic: bool,
    include_system_audio: bool,
) -> Result<NativeAudioSelection, String> {
    if (include_mic && !sources.contains(&CaptureSource::Microphone))
        || (include_system_audio && !sources.contains(&CaptureSource::SystemAudio))
    {
        return Err(not_compatible("requested audio was not captured by Rewind"));
    }
    Ok(match (include_mic, include_system_audio) {
        (false, false) => NativeAudioSelection::None,
        (false, true) => NativeAudioSelection::System,
        (true, false) => NativeAudioSelection::Microphone,
        (true, true) => NativeAudioSelection::MixBoth,
    })
}

/// Materialize an explicit recent range as one exact local MP4. This powers
/// “Save what just happened” without copying whole five-minute container
/// segments (which could otherwise retain media from before the chosen range).
pub(crate) fn materialize_recent_exact(
    app: &AppHandle,
    duration: std::time::Duration,
    output: PathBuf,
) -> Result<FinalizedNativeArtifact, String> {
    let duration_ms = u64::try_from(duration.as_millis())
        .map_err(|_| "requested Rewind export is too long".to_string())?;
    if duration_ms == 0 || duration > crate::capture_graph::MAX_RETROSPECTIVE_EXTENSION {
        return Err("Rewind export must be between one millisecond and five minutes".into());
    }
    let fenced = screen_memory::fence_active_for_clip(app)?;
    let end_ms = fenced.graph_ended_elapsed_ms;
    let start_ms = end_ms
        .checked_sub(duration_ms)
        .ok_or_else(|| "Rewind does not yet contain the full requested range".to_string())?;
    materialize_graph_interval_exact(
        app,
        start_ms,
        end_ms,
        fenced.started_at,
        fenced.ended_at,
        output,
        "explicit recent Rewind export",
        None,
    )
}

fn materialize_wall_clock_exact(
    app: &AppHandle,
    started_at: &str,
    ended_at: &str,
    output: PathBuf,
    include_mic: bool,
    include_system_audio: bool,
) -> Result<FinalizedNativeArtifact, String> {
    let started = DateTime::parse_from_rfc3339(started_at)
        .map_err(|_| "Rewind handoff start must be an RFC3339 timestamp.".to_string())?
        .with_timezone(&Utc);
    let ended = DateTime::parse_from_rfc3339(ended_at)
        .map_err(|_| "Rewind handoff end must be an RFC3339 timestamp.".to_string())?
        .with_timezone(&Utc);
    let duration = ended.signed_duration_since(started);
    if duration.num_milliseconds() < 1
        || duration.num_milliseconds()
            > i64::try_from(crate::capture_graph::MAX_RETROSPECTIVE_EXTENSION.as_millis())
                .unwrap_or(i64::MAX)
    {
        return Err("Rewind handoff must be between one millisecond and five minutes.".into());
    }
    let fenced = screen_memory::fence_active_for_clip(app)?;
    let graph_started_at = {
        let graph = app.state::<CaptureGraphState>();
        let graph = graph.0.lock().map_err(|error| error.to_string())?;
        let status = graph
            .status_at(std::time::Instant::now())
            .map_err(|error| error.to_string())?;
        DateTime::parse_from_rfc3339(&status.graph_started_at)
            .map_err(|_| "Rewind graph clock is unavailable.".to_string())?
            .with_timezone(&Utc)
    };
    let start_ms = started
        .signed_duration_since(graph_started_at)
        .num_milliseconds();
    let end_ms = ended
        .signed_duration_since(graph_started_at)
        .num_milliseconds();
    if start_ms < 0 || end_ms < 0 {
        return Err("The requested Rewind range predates this Clips session.".into());
    }
    let start_ms = u64::try_from(start_ms).map_err(|error| error.to_string())?;
    let end_ms = u64::try_from(end_ms).map_err(|error| error.to_string())?;
    if end_ms > fenced.graph_ended_elapsed_ms.saturating_add(1_000) {
        return Err("The requested Rewind range has not finished recording.".into());
    }
    materialize_graph_interval_exact(
        app,
        start_ms,
        end_ms.min(fenced.graph_ended_elapsed_ms),
        started.to_rfc3339(),
        ended.to_rfc3339(),
        output,
        "agent-requested Rewind handoff",
        Some((include_mic, include_system_audio)),
    )
}

fn materialize_graph_interval_exact(
    app: &AppHandle,
    start_ms: u64,
    end_ms: u64,
    started_at: String,
    ended_at: String,
    output: PathBuf,
    label: &str,
    requested_audio: Option<(bool, bool)>,
) -> Result<FinalizedNativeArtifact, String> {
    if end_ms <= start_ms {
        return Err("The selected Rewind handoff range is empty.".into());
    }
    let interval = CaptureInterval {
        started_at,
        ended_at,
        started_elapsed_ms: start_ms,
        ended_elapsed_ms: end_ms,
    };
    let graph_state = app.state::<CaptureGraphState>();
    let (pin_id, has_screen_gap) = {
        let mut graph = graph_state.0.lock().map_err(|error| error.to_string())?;
        let status = graph
            .status_at(std::time::Instant::now())
            .map_err(|error| error.to_string())?;
        let has_gap = status.coverage_gaps.iter().any(|gap| {
            gap.source == CaptureSource::Screen
                && gap.interval.started_elapsed_ms < end_ms
                && gap.interval.ended_elapsed_ms > start_ms
        });
        let pin = graph
            .pin_interval(&interval, Some(label.into()))
            .map_err(|error| error.to_string())?;
        (pin.id, has_gap)
    };
    let mut pinned_segments = Vec::new();
    let outcome = (|| {
        if has_screen_gap {
            return Err("selected Rewind interval contains a recorded coverage gap".into());
        }
        let segments = screen_memory::finalized_segments_in_graph_interval(app, start_ms, end_ms)?;
        for segment in &segments {
            screen_memory::pin_segment(app, &segment.id, &pin_id)?;
            pinned_segments.push(segment.id.clone());
        }
        let slices = validate_and_plan(&segments, start_ms, end_ms)?;
        let audio_available = segments
            .iter()
            .all(|segment| segment.capture_mode == crate::config::RewindCaptureMode::VisualsAudio);
        let (include_mic, include_system_audio) =
            requested_audio.unwrap_or((audio_available, audio_available));
        if (include_mic || include_system_audio) && !audio_available {
            return Err("The selected Rewind range does not contain the requested audio.".into());
        }
        let audio_selection = match (include_mic, include_system_audio) {
            (false, false) => NativeAudioSelection::None,
            (true, false) => NativeAudioSelection::Microphone,
            (false, true) => NativeAudioSelection::System,
            (true, true) => NativeAudioSelection::MixBoth,
        };
        native_screen::materialize_mp4_slices_exact(&slices, &output, audio_selection)?;
        let first = segments
            .first()
            .ok_or_else(|| "no Rewind media selected".to_string())?;
        Ok(FinalizedNativeArtifact::rewind_mp4(
            output,
            u128::from(end_ms.saturating_sub(start_ms)),
            first.width,
            first.height,
            include_mic,
            include_system_audio,
        ))
    })();
    for segment_id in pinned_segments {
        let _ = screen_memory::unpin_segment(app, &segment_id, &pin_id);
    }
    if let Ok(mut graph) = graph_state.0.lock() {
        graph.release_pin(&pin_id);
    }
    outcome
}

#[tauri::command]
pub(crate) async fn rewind_agent_handoff_upload(
    app: AppHandle,
    request_id: String,
    started_at: String,
    ended_at: String,
    server_url: String,
    recording_id: String,
    auth_token: Option<String>,
    cookie: Option<String>,
    upload_mode: Option<String>,
    include_mic: bool,
    include_system_audio: bool,
) -> Result<NativeFullscreenUploadResult, String> {
    let safe_request_id: String = request_id
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
        })
        .collect();
    if safe_request_id != request_id || !safe_request_id.starts_with("handoff-") {
        return Err("Invalid Rewind handoff request ID.".into());
    }
    let output_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data directory unavailable: {error}"))?
        .join("screen-memory")
        .join("agent-handoffs");
    std::fs::create_dir_all(&output_dir)
        .map_err(|error| format!("agent handoff directory unavailable: {error}"))?;
    let output = output_dir.join(format!("{safe_request_id}.mp4"));
    let artifact = materialize_wall_clock_exact(
        &app,
        &started_at,
        &ended_at,
        output.clone(),
        include_mic,
        include_system_audio,
    )?;
    let result = native_screen::upload_finalized_native_artifact(
        &app,
        &artifact,
        server_url,
        recording_id,
        auth_token.unwrap_or_default(),
        cookie.unwrap_or_default(),
        NativeUploadMode::from_option(upload_mode),
        artifact.mic_captured || artifact.system_audio_captured,
        false,
    )
    .await;
    let _ = std::fs::remove_file(output);
    result
}

#[tauri::command]
pub(crate) async fn rewind_agent_handoff_preview(
    app: AppHandle,
    request_id: String,
    started_at: String,
    ended_at: String,
    include_mic: bool,
    include_system_audio: bool,
) -> Result<String, String> {
    let safe_request_id: String = request_id
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
        })
        .collect();
    if safe_request_id != request_id || !safe_request_id.starts_with("handoff-") {
        return Err("Invalid Rewind handoff request ID.".into());
    }
    let output_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("local preview directory unavailable: {error}"))?
        .join("rewind-previews");
    std::fs::create_dir_all(&output_dir)
        .map_err(|error| format!("local preview directory unavailable: {error}"))?;
    let output = output_dir.join(format!("{safe_request_id}-preview.mp4"));
    let preview = output.clone();
    tauri::async_runtime::spawn_blocking(move || {
        materialize_wall_clock_exact(
            &app,
            &started_at,
            &ended_at,
            preview,
            include_mic,
            include_system_audio,
        )
    })
    .await
    .map_err(|error| format!("local handoff preview worker failed: {error}"))??;

    #[cfg(target_os = "macos")]
    Command::new("/usr/bin/open")
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not open Rewind handoff preview: {error}"))?;

    Ok(output.to_string_lossy().to_string())
}

fn materialize(
    app: &AppHandle,
    state: &State<'_, RewindClipState>,
    label: &str,
    include_mic: bool,
    include_system_audio: bool,
) -> Result<FinalizedNativeArtifact, String> {
    let active = take_active(state)?;
    let mut intervals = active.intervals.clone();
    let mut lease_ended = active.lease_id.is_none();
    let mut graph_pin_ids = Vec::new();
    let mut pinned = BTreeSet::new();
    let outcome = (|| -> Result<FinalizedNativeArtifact, String> {
        if let Some(lease_id) = active.lease_id.as_deref() {
            let fenced = screen_memory::fence_active_for_clip(app)?;
            let closed = app
                .state::<CaptureGraphState>()
                .0
                .lock()
                .map_err(|e| e.to_string())?
                .end_consumer(lease_id)
                .map_err(|e| e.to_string())?;
            lease_ended = true;
            let mut interval = closed.lease.interval;
            interval.ended_elapsed_ms =
                interval.ended_elapsed_ms.min(fenced.graph_ended_elapsed_ms);
            intervals.push(interval);
        }
        if intervals.is_empty() {
            return Err("Rewind-derived clip has no recorded intervals".into());
        }
        let graph_status = app
            .state::<CaptureGraphState>()
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .status_at(std::time::Instant::now())
            .map_err(|error| error.to_string())?;
        if graph_status.coverage_gaps.iter().any(|gap| {
            intervals.iter().any(|interval| {
                gap.interval.started_elapsed_ms < interval.ended_elapsed_ms
                    && gap.interval.ended_elapsed_ms > interval.started_elapsed_ms
                    && active.sources.contains(&gap.source)
            })
        }) {
            return Err("selected Rewind interval contains a recorded coverage gap".into());
        }
        let mut slices = Vec::new();
        let mut first_segment = None;
        let mut duration_ms = 0u128;
        for interval in &intervals {
            let pin = app
                .state::<CaptureGraphState>()
                .0
                .lock()
                .map_err(|e| e.to_string())?
                .pin_interval(interval, Some("rewind-derived clip".into()))
                .map_err(|e| e.to_string())?;
            graph_pin_ids.push(pin.id.clone());
            let segments = screen_memory::finalized_segments_in_graph_interval(
                app,
                interval.started_elapsed_ms,
                interval.ended_elapsed_ms,
            )?;
            for segment in &segments {
                screen_memory::pin_segment(app, &segment.id, &pin.id)?;
                pinned.insert((segment.id.clone(), pin.id.clone()));
            }
            if first_segment.is_none() {
                first_segment = segments.first().cloned();
            }
            slices.extend(validate_and_plan(
                &segments,
                interval.started_elapsed_ms,
                interval.ended_elapsed_ms,
            )?);
            duration_ms += (interval.ended_elapsed_ms - interval.started_elapsed_ms) as u128;
        }
        let output = artifact_path(app, label)?;
        let audio = select_audio(&active.sources, include_mic, include_system_audio)?;
        native_screen::materialize_mp4_slices_exact(&slices, &output, audio)?;
        let first = first_segment
            .as_ref()
            .ok_or_else(|| "no Rewind media selected".to_string())?;
        Ok(FinalizedNativeArtifact::rewind_mp4(
            output,
            duration_ms,
            first.width,
            first.height,
            include_mic,
            include_system_audio,
        ))
    })();
    if !lease_ended {
        if let (Some(lease_id), Ok(mut graph)) = (
            active.lease_id.as_deref(),
            app.state::<CaptureGraphState>().0.lock(),
        ) {
            let _ = graph.end_consumer(lease_id);
        }
    }
    for (segment_id, pin_id) in pinned {
        let _ = screen_memory::unpin_segment(app, &segment_id, &pin_id);
    }
    for pin_id in graph_pin_ids {
        if let Ok(mut graph) = app.state::<CaptureGraphState>().0.lock() {
            graph.release_pin(&pin_id);
        }
    }
    for segment_id in &active.pinned_segments {
        let _ = screen_memory::unpin_segment(app, segment_id, &active.pin_id);
    }
    release_temporary_audio(app, active.temporary_audio);
    outcome
}

#[tauri::command]
pub(crate) async fn rewind_clip_stop_and_upload(
    app: AppHandle,
    state: State<'_, RewindClipState>,
    server_url: String,
    recording_id: String,
    auth_token: Option<String>,
    cookie: Option<String>,
    upload_mode: Option<String>,
    include_mic: bool,
    include_system_audio: bool,
    has_camera: bool,
) -> Result<NativeFullscreenUploadResult, String> {
    let artifact = materialize(
        &app,
        &state,
        &recording_id,
        include_mic,
        include_system_audio,
    )?;
    native_screen::upload_finalized_native_artifact(
        &app,
        &artifact,
        server_url,
        recording_id,
        auth_token.unwrap_or_default(),
        cookie.unwrap_or_default(),
        NativeUploadMode::from_option(upload_mode),
        include_mic || include_system_audio,
        has_camera,
    )
    .await
}

#[tauri::command]
pub(crate) async fn rewind_clip_stop_and_save(
    app: AppHandle,
    state: State<'_, RewindClipState>,
    folder_name: String,
    file_role: String,
    include_mic: bool,
    include_system_audio: bool,
) -> Result<NativeFullscreenSaveResult, String> {
    let artifact = materialize(
        &app,
        &state,
        &folder_name,
        include_mic,
        include_system_audio,
    )?;
    native_screen::save_finalized_native_artifact_to_local_export(
        &app,
        &artifact,
        &folder_name,
        &file_role,
    )
}

#[tauri::command]
pub(crate) fn rewind_clip_cancel(
    app: AppHandle,
    state: State<'_, RewindClipState>,
) -> Result<(), String> {
    let active = state.0.lock().map_err(|error| error.to_string())?.take();
    if let Some(active) = active {
        if let Some(lease_id) = active.lease_id.as_deref() {
            let _ = app
                .state::<CaptureGraphState>()
                .0
                .lock()
                .map_err(|error| error.to_string())?
                .end_consumer(lease_id);
        }
        for segment_id in active.pinned_segments {
            let _ = screen_memory::unpin_segment(&app, &segment_id, &active.pin_id);
        }
        release_temporary_audio(&app, active.temporary_audio);
    }
    Ok(())
}

/// Called by Screen Memory whenever a segment becomes finalized. Keeping this
/// hook in the consumer module prevents rotation/pruning from racing a clip
/// whose materialization has not happened yet.
pub(crate) fn pin_finalized_segment_if_active(
    app: &AppHandle,
    segment: &ScreenMemorySegmentMetadata,
) -> Result<(), String> {
    let Some(state) = app.try_state::<RewindClipState>() else {
        return Ok(());
    };
    let Ok(mut active) = state.0.try_lock() else {
        return Ok(());
    };
    let Some(active) = active.as_mut() else {
        return Ok(());
    };
    if active.paused {
        return Ok(());
    }
    if segment.graph_ended_elapsed_ms >= active.started_elapsed_ms {
        screen_memory::pin_segment(app, &segment.id, &active.pin_id)?;
        active.pinned_segments.insert(segment.id.clone());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RewindCaptureMode;

    fn segment(id: &str, start: u64, end: u64) -> ScreenMemorySegmentMetadata {
        ScreenMemorySegmentMetadata {
            id: id.into(),
            path: PathBuf::from(format!("{id}.mp4")),
            file_name: format!("{id}.mp4"),
            mime_type: "video/mp4".into(),
            started_at: String::new(),
            ended_at: String::new(),
            duration_ms: (end - start) as u128,
            width: Some(1280),
            height: Some(720),
            bytes: 1,
            system_audio_path: None,
            microphone_path: None,
            corrupt: false,
            error: None,
            capture_mode: RewindCaptureMode::VisualsAudio,
            exclusion_tainted: false,
            graph_epoch_id: Some("test-epoch".into()),
            graph_started_elapsed_ms: start,
            graph_ended_elapsed_ms: end,
        }
    }

    #[test]
    fn slice_math_has_no_pre_roll_and_exact_overlap() {
        let slices =
            validate_and_plan(&[segment("a", 0, 100), segment("b", 100, 200)], 50, 150).unwrap();
        assert_eq!(
            slices,
            vec![
                NativeMediaSlice {
                    path: PathBuf::from("a.mp4"),
                    system_audio_path: None,
                    microphone_path: None,
                    start_ms: 50,
                    end_ms: 100
                },
                NativeMediaSlice {
                    path: PathBuf::from("b.mp4"),
                    system_audio_path: None,
                    microphone_path: None,
                    start_ms: 0,
                    end_ms: 50
                }
            ]
        );
    }

    #[test]
    fn gaps_and_taint_fail_closed() {
        assert!(validate_and_plan(&[segment("a", 0, 100), segment("b", 101, 200)], 0, 200).is_ok());
        assert!(
            validate_and_plan(&[segment("a", 0, 100), segment("b", 103, 200)], 0, 200).is_err()
        );
        assert!(validate_and_plan(&[segment("a", 0, 90), segment("b", 100, 200)], 0, 200).is_err());
        let mut tainted = segment("a", 0, 100);
        tainted.exclusion_tainted = true;
        assert!(validate_and_plan(&[tainted], 0, 100).is_err());
    }

    #[test]
    fn retrospective_choices_are_strictly_bounded() {
        assert!(matches!(30, RETROSPECTIVE_30_SECONDS));
        assert!(matches!(300, RETROSPECTIVE_5_MINUTES));
    }

    #[test]
    fn visuals_reject_audio_and_audio_mode_preserves_each_choice() {
        assert!(select_audio(&[CaptureSource::Screen], true, false).is_err());
        let sources = [
            CaptureSource::Screen,
            CaptureSource::SystemAudio,
            CaptureSource::Microphone,
        ];
        assert_eq!(
            select_audio(&sources, false, false).unwrap(),
            NativeAudioSelection::None
        );
        assert_eq!(
            select_audio(&sources, false, true).unwrap(),
            NativeAudioSelection::System
        );
        assert_eq!(
            select_audio(&sources, true, false).unwrap(),
            NativeAudioSelection::Microphone
        );
        assert_eq!(
            select_audio(&sources, true, true).unwrap(),
            NativeAudioSelection::MixBoth
        );
    }

    #[test]
    fn ordered_intervals_exclude_paused_media() {
        let segments = [
            segment("before", 0, 100),
            segment("paused", 100, 200),
            segment("after", 200, 300),
        ];
        let mut slices = validate_and_plan(&segments, 0, 100).unwrap();
        slices.extend(validate_and_plan(&segments, 200, 300).unwrap());
        assert_eq!(slices.len(), 2);
        assert_eq!(slices[0].path, PathBuf::from("before.mp4"));
        assert_eq!(slices[1].path, PathBuf::from("after.mp4"));
    }
}
