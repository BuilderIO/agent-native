use crate::config::{FeatureConfig, ScreenMemoryConfig};
use crate::native_screen::{
    self, NativeFullscreenBackend, DISK_SPACE_BLOCK_BYTES, MP4_RECORDING_MIME_TYPE,
    QUICKTIME_RECORDING_MIME_TYPE,
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const SCREEN_MEMORY_DIR: &str = "screen-memory";
const SCREEN_MEMORY_EVENT: &str = "clips:screen-memory-changed";
const SCREEN_MEMORY_EVENTS_JSONL: &str = "events.jsonl";
const MIN_SEGMENT_SECONDS: u64 = 15;
const MAX_SEGMENT_SECONDS: u64 = 30 * 60;
const MIN_RETENTION_HOURS: u32 = 1;
const MAX_RETENTION_HOURS: u32 = 24 * 30;
const MIN_MAX_BYTES: u64 = 100 * 1024 * 1024;
const MAX_MAX_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
const ROTATOR_TICK: Duration = Duration::from_millis(500);

static SEGMENT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct ScreenMemoryState {
    inner: Mutex<ScreenMemoryRuntime>,
}

#[derive(Default)]
struct ScreenMemoryRuntime {
    active: Option<ActiveScreenMemorySegment>,
    worker_stop: Option<Arc<AtomicBool>>,
    last_error: Option<String>,
}

struct ActiveScreenMemorySegment {
    id: String,
    path: PathBuf,
    mime_type: &'static str,
    backend: NativeFullscreenBackend,
    started_at: Instant,
    started_at_iso: String,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemorySegmentMetadata {
    pub id: String,
    pub path: PathBuf,
    pub file_name: String,
    pub mime_type: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: u128,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bytes: u64,
    pub corrupt: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryEvent {
    pub captured_at: String,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub bundle_id: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryQueryResult {
    pub query: Option<String>,
    pub minutes: u64,
    pub events: Vec<ScreenMemoryEvent>,
    pub segments: Vec<ScreenMemorySegmentMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScreenMemoryRuntimeState {
    Disabled,
    Idle,
    Recording,
    Paused,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryActiveSegment {
    pub id: String,
    pub path: PathBuf,
    pub mime_type: String,
    pub started_at: String,
    pub duration_ms: u128,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryStatus {
    pub available: bool,
    pub state: ScreenMemoryRuntimeState,
    pub config: ScreenMemoryConfig,
    pub storage_dir: PathBuf,
    pub active_segment: Option<ScreenMemoryActiveSegment>,
    pub recent_segments: Vec<ScreenMemorySegmentMetadata>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryDeleteResult {
    pub deleted_segments: usize,
    pub deleted_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryExportFile {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryExportResult {
    pub folder_path: String,
    pub files: Vec<ScreenMemoryExportFile>,
}

/// Keep the local recorder aligned with the persisted feature config. This is
/// called from `set_feature_config`, so any future UI or agent command that
/// writes the config uses the same local-only backend.
pub fn sync_from_config(app: &AppHandle, feature_config: &FeatureConfig) {
    let config = normalize_screen_memory_config(feature_config.screen_memory.clone());
    if !config.enabled || config.paused {
        if let Err(err) = stop_active_segment(app) {
            record_error(app, err);
        }
        return;
    }

    if let Err(err) = ensure_running(app, &config) {
        record_error(app, err);
    }
}

#[tauri::command]
pub async fn screen_memory_status(app: AppHandle) -> Result<ScreenMemoryStatus, String> {
    build_status(&app)
}

#[tauri::command]
pub async fn screen_memory_configure(
    app: AppHandle,
    config: ScreenMemoryConfig,
) -> Result<ScreenMemoryStatus, String> {
    let mut feature_config = crate::config::feature_config(&app);
    feature_config.screen_memory = normalize_screen_memory_config(config);
    crate::config::set_feature_config(app.clone(), feature_config).await?;
    build_status(&app)
}

#[tauri::command]
pub async fn screen_memory_start(app: AppHandle) -> Result<ScreenMemoryStatus, String> {
    let mut feature_config = crate::config::feature_config(&app);
    feature_config.screen_memory.enabled = true;
    feature_config.screen_memory.paused = false;
    feature_config.screen_memory = normalize_screen_memory_config(feature_config.screen_memory);
    crate::config::set_feature_config(app.clone(), feature_config).await?;
    build_status(&app)
}

#[tauri::command]
pub async fn screen_memory_pause(app: AppHandle) -> Result<ScreenMemoryStatus, String> {
    let mut feature_config = crate::config::feature_config(&app);
    feature_config.screen_memory.enabled = true;
    feature_config.screen_memory.paused = true;
    feature_config.screen_memory = normalize_screen_memory_config(feature_config.screen_memory);
    crate::config::set_feature_config(app.clone(), feature_config).await?;
    build_status(&app)
}

#[tauri::command]
pub async fn screen_memory_stop(app: AppHandle) -> Result<ScreenMemoryStatus, String> {
    let mut feature_config = crate::config::feature_config(&app);
    feature_config.screen_memory.enabled = false;
    feature_config.screen_memory.paused = false;
    feature_config.screen_memory = normalize_screen_memory_config(feature_config.screen_memory);
    crate::config::set_feature_config(app.clone(), feature_config).await?;
    build_status(&app)
}

#[tauri::command]
pub async fn screen_memory_recent_segments(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<ScreenMemorySegmentMetadata>, String> {
    recent_segments(&app, limit)
}

#[tauri::command]
pub async fn screen_memory_query(
    app: AppHandle,
    query: Option<String>,
    minutes: Option<u64>,
    limit: Option<usize>,
) -> Result<ScreenMemoryQueryResult, String> {
    query_screen_memory(&app, query, minutes.unwrap_or(30), limit.unwrap_or(40))
}

#[tauri::command]
pub async fn screen_memory_delete_all(app: AppHandle) -> Result<ScreenMemoryStatus, String> {
    let _ = screen_memory_delete(app.clone(), None).await?;
    build_status(&app)
}

#[tauri::command]
pub async fn screen_memory_export_recent(
    app: AppHandle,
    minutes: Option<u64>,
) -> Result<ScreenMemoryExportResult, String> {
    export_recent(&app, minutes.unwrap_or(5))
}

#[tauri::command]
pub async fn screen_memory_open_folder(app: AppHandle) -> Result<(), String> {
    let dir = screen_memory_dir(&app)?;
    crate::clips::open_local_recording_folder(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn screen_memory_delete(
    app: AppHandle,
    segment_id: Option<String>,
) -> Result<ScreenMemoryDeleteResult, String> {
    if let Some(segment_id) = segment_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        stop_active_segment_if_matches(&app, segment_id)?;
        let result = delete_segment(&app, segment_id)?;
        let _ = app.emit(SCREEN_MEMORY_EVENT, ());
        return Ok(result);
    }

    let mut feature_config = crate::config::feature_config(&app);
    feature_config.screen_memory.enabled = false;
    feature_config.screen_memory.paused = false;
    crate::config::set_feature_config(app.clone(), feature_config).await?;

    let result = delete_all_segments(&app)?;
    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
    Ok(result)
}

fn normalize_screen_memory_config(mut config: ScreenMemoryConfig) -> ScreenMemoryConfig {
    config.retention_hours = config
        .retention_hours
        .clamp(MIN_RETENTION_HOURS, MAX_RETENTION_HOURS);
    config.max_bytes = config.max_bytes.clamp(MIN_MAX_BYTES, MAX_MAX_BYTES);
    config.segment_seconds = config
        .segment_seconds
        .clamp(MIN_SEGMENT_SECONDS, MAX_SEGMENT_SECONDS);
    config.sample_interval_seconds = config
        .sample_interval_seconds
        .clamp(1, config.segment_seconds);
    config
}

fn screen_memory_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::path::Path::new("/usr/sbin/screencapture").exists()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn screen_memory_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data directory unavailable: {e}"))?
        .join(SCREEN_MEMORY_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("screen memory directory unavailable: {e}"))?;
    Ok(dir)
}

fn screen_memory_events_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(screen_memory_dir(app)?.join(SCREEN_MEMORY_EVENTS_JSONL))
}

fn segment_metadata_path(app: &AppHandle, segment_id: &str) -> Result<PathBuf, String> {
    Ok(screen_memory_dir(app)?.join(format!("{}.json", sanitize_segment_id(segment_id))))
}

fn segment_media_path(
    app: &AppHandle,
    segment_id: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    Ok(screen_memory_dir(app)?.join(format!(
        "{}.{}",
        sanitize_segment_id(segment_id),
        extension.trim_start_matches('.')
    )))
}

fn sanitize_segment_id(value: &str) -> String {
    let safe: String = value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() {
        "segment".to_string()
    } else {
        safe
    }
}

fn next_segment_id() -> String {
    let counter = SEGMENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("segment-{}-{counter}", Utc::now().timestamp_millis())
}

fn build_status(app: &AppHandle) -> Result<ScreenMemoryStatus, String> {
    let config = normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
    let storage_dir = screen_memory_dir(app)?;
    let (active_segment, last_error) = {
        let state = app.state::<ScreenMemoryState>();
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        (
            guard
                .active
                .as_ref()
                .map(|active| ScreenMemoryActiveSegment {
                    id: active.id.clone(),
                    path: active.path.clone(),
                    mime_type: active.mime_type.to_string(),
                    started_at: active.started_at_iso.clone(),
                    duration_ms: active.started_at.elapsed().as_millis(),
                    width: active.width,
                    height: active.height,
                }),
            guard.last_error.clone(),
        )
    };
    let state = if !config.enabled {
        ScreenMemoryRuntimeState::Disabled
    } else if active_segment.is_some() {
        ScreenMemoryRuntimeState::Recording
    } else if config.paused {
        ScreenMemoryRuntimeState::Paused
    } else {
        ScreenMemoryRuntimeState::Idle
    };

    Ok(ScreenMemoryStatus {
        available: screen_memory_available(),
        state,
        config,
        storage_dir,
        active_segment,
        recent_segments: recent_segments(app, Some(5))?,
        last_error,
    })
}

fn ensure_running(app: &AppHandle, config: &ScreenMemoryConfig) -> Result<(), String> {
    if !screen_memory_available() {
        return Err("Screen Memory capture is currently macOS-only.".to_string());
    }

    {
        let state = app.state::<ScreenMemoryState>();
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        if guard.active.is_some() {
            return Ok(());
        }
    }

    let active = start_new_segment(app)?;
    let stop = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<ScreenMemoryState>();
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        if guard.active.is_some() {
            drop(guard);
            discard_active_segment(active);
            return Ok(());
        }
        guard.active = Some(active);
        guard.worker_stop = Some(Arc::clone(&stop));
        guard.last_error = None;
    }

    spawn_rotator(app.clone(), stop);
    prune_segments(app, config)?;
    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
    Ok(())
}

fn spawn_rotator(app: AppHandle, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || loop {
        let config =
            normalize_screen_memory_config(crate::config::feature_config(&app).screen_memory);
        if wait_for_rotation(&app, &stop, &config) {
            return;
        }
        let config =
            normalize_screen_memory_config(crate::config::feature_config(&app).screen_memory);
        if !config.enabled || config.paused {
            return;
        }
        if let Err(err) = rotate_segment(&app, &config) {
            record_error(&app, err);
        }
    });
}

fn wait_for_rotation(app: &AppHandle, stop: &AtomicBool, config: &ScreenMemoryConfig) -> bool {
    let deadline = Instant::now() + Duration::from_secs(config.segment_seconds);
    let sample_interval = Duration::from_secs(config.sample_interval_seconds.max(1));
    let mut next_sample = Instant::now();
    loop {
        if stop.load(Ordering::Relaxed) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        if Instant::now() >= next_sample {
            append_event(app, sample_active_window());
            next_sample = Instant::now() + sample_interval;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        let until_sample = next_sample.saturating_duration_since(Instant::now());
        std::thread::sleep(remaining.min(until_sample).min(ROTATOR_TICK));
    }
}

fn sample_active_window() -> ScreenMemoryEvent {
    #[cfg(target_os = "macos")]
    {
        let context = crate::accessibility::macos::active_window_context_impl();
        ScreenMemoryEvent {
            captured_at: now_iso(),
            app_name: context.app_name,
            window_title: context.window_title,
            bundle_id: context.bundle_id,
            source: context.source,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        ScreenMemoryEvent {
            captured_at: now_iso(),
            app_name: None,
            window_title: None,
            bundle_id: None,
            source: "unsupported".to_string(),
        }
    }
}

fn append_event(app: &AppHandle, event: ScreenMemoryEvent) {
    if let Err(err) = append_event_inner(app, &event) {
        eprintln!("[clips-tray] Screen Memory event append failed: {err}");
    }
}

fn append_event_inner(app: &AppHandle, event: &ScreenMemoryEvent) -> Result<(), String> {
    let path = screen_memory_events_path(app)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("screen memory events open failed: {e}"))?;
    serde_json::to_writer(&mut file, event)
        .map_err(|e| format!("screen memory event encode failed: {e}"))?;
    file.write_all(b"\n")
        .map_err(|e| format!("screen memory event write failed: {e}"))
}

fn rotate_segment(app: &AppHandle, config: &ScreenMemoryConfig) -> Result<(), String> {
    let active = {
        let state = app.state::<ScreenMemoryState>();
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.active.take()
    };

    if let Some(active) = active {
        match finalize_active_segment(active) {
            Ok(segment) => {
                write_segment_metadata(app, &segment)?;
                prune_segments(app, config)?;
            }
            Err(err) => {
                record_error(app, err);
            }
        }
    }

    let mut next = Some(start_new_segment(app)?);
    let installed = {
        let state = app.state::<ScreenMemoryState>();
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        let still_running = guard
            .worker_stop
            .as_ref()
            .map(|stop| !stop.load(Ordering::Relaxed))
            .unwrap_or(false);
        if still_running && guard.active.is_none() {
            guard.active = next.take();
            guard.last_error = None;
            true
        } else {
            false
        }
    };
    if !installed {
        if let Some(next) = next {
            discard_active_segment(next);
        }
    }

    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
    Ok(())
}

fn stop_active_segment(app: &AppHandle) -> Result<Option<ScreenMemorySegmentMetadata>, String> {
    let active = {
        let state = app.state::<ScreenMemoryState>();
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        if let Some(stop) = guard.worker_stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        guard.active.take()
    };

    let Some(active) = active else {
        return Ok(None);
    };

    let segment = finalize_active_segment(active)?;
    write_segment_metadata(app, &segment)?;
    let config = normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
    prune_segments(app, &config)?;
    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
    Ok(Some(segment))
}

fn stop_active_segment_if_matches(app: &AppHandle, segment_id: &str) -> Result<(), String> {
    let active_matches = {
        let state = app.state::<ScreenMemoryState>();
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard
            .active
            .as_ref()
            .map(|active| active.id == sanitize_segment_id(segment_id))
            .unwrap_or(false)
    };
    if active_matches {
        stop_active_segment(app)?;
    }
    Ok(())
}

fn start_new_segment(app: &AppHandle) -> Result<ActiveScreenMemorySegment, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Screen Memory capture is currently macOS-only.".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        let dir = screen_memory_dir(app)?;
        if let Some(free) = native_screen::free_disk_bytes(&dir) {
            if free < DISK_SPACE_BLOCK_BYTES {
                return Err(format!(
                    "Not enough disk space to start Screen Memory. Free up at least {} and try again (currently {} free).",
                    native_screen::format_mb(DISK_SPACE_BLOCK_BYTES),
                    native_screen::format_mb(free)
                ));
            }
        }

        let id = next_segment_id();
        let target_display_id = native_screen::tray_display_id(app);
        let mp4_path = segment_media_path(app, &id, "mp4")?;
        let _ = std::fs::remove_file(&mp4_path);
        let (fallback_width, fallback_height) = native_screen::primary_monitor_size(app);

        match native_screen::start_screencapturekit_backend_at(
            &mp4_path,
            false,
            false,
            None,
            None,
            target_display_id,
            None,
            false,
        ) {
            Ok((backend, width, height)) => {
                return Ok(ActiveScreenMemorySegment {
                    id,
                    path: mp4_path,
                    mime_type: MP4_RECORDING_MIME_TYPE,
                    backend,
                    started_at: Instant::now(),
                    started_at_iso: now_iso(),
                    width: width.or(fallback_width),
                    height: height.or(fallback_height),
                });
            }
            Err(sck_err) => {
                eprintln!(
                    "[clips-tray] Screen Memory ScreenCaptureKit unavailable; falling back to screencapture: {sck_err}"
                );
                let _ = std::fs::remove_file(&mp4_path);
            }
        }

        let mov_path = segment_media_path(app, &id, "mov")?;
        let _ = std::fs::remove_file(&mov_path);
        let (backend, width, height) = native_screen::start_screencapture_backend_at(
            app,
            &mov_path,
            false,
            target_display_id,
            None,
        )?;
        Ok(ActiveScreenMemorySegment {
            id,
            path: mov_path,
            mime_type: QUICKTIME_RECORDING_MIME_TYPE,
            backend,
            started_at: Instant::now(),
            started_at_iso: now_iso(),
            width: width.or(fallback_width),
            height: height.or(fallback_height),
        })
    }
}

fn discard_active_segment(mut active: ActiveScreenMemorySegment) {
    let _ = native_screen::stop_native_recording(&mut active.backend, false);
    let _ = std::fs::remove_file(active.path);
}

fn finalize_active_segment(
    mut active: ActiveScreenMemorySegment,
) -> Result<ScreenMemorySegmentMetadata, String> {
    let stop_error = native_screen::stop_native_recording(&mut active.backend, true).err();
    let ended_at = now_iso();
    let duration_ms = active.started_at.elapsed().as_millis();
    let bytes = std::fs::metadata(&active.path)
        .map_err(|e| {
            let suffix = stop_error
                .as_ref()
                .map(|err| format!(" after stop error: {err}"))
                .unwrap_or_default();
            format!("Screen Memory segment missing{suffix}: {e}")
        })?
        .len();
    if bytes == 0 {
        let _ = std::fs::remove_file(&active.path);
        return Err("Screen Memory segment produced an empty file.".to_string());
    }

    let corrupt = if active.mime_type == MP4_RECORDING_MIME_TYPE
        || active.mime_type == QUICKTIME_RECORDING_MIME_TYPE
    {
        native_screen::mp4_has_moov(&active.path) == Some(false)
    } else {
        false
    };
    let error =
        if corrupt {
            Some(stop_error.unwrap_or_else(|| {
                "Screen Memory segment is missing playback metadata.".to_string()
            }))
        } else {
            stop_error
        };

    Ok(ScreenMemorySegmentMetadata {
        id: active.id,
        file_name: active
            .path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: active.path,
        mime_type: active.mime_type.to_string(),
        started_at: active.started_at_iso,
        ended_at,
        duration_ms,
        width: active.width,
        height: active.height,
        bytes,
        corrupt,
        error,
    })
}

fn write_segment_metadata(
    app: &AppHandle,
    segment: &ScreenMemorySegmentMetadata,
) -> Result<(), String> {
    let path = segment_metadata_path(app, &segment.id)?;
    let data = serde_json::to_vec_pretty(segment)
        .map_err(|e| format!("screen memory metadata encode failed: {e}"))?;
    std::fs::write(path, data).map_err(|e| format!("screen memory metadata write failed: {e}"))
}

fn read_segment_metadata_path(path: &Path) -> Result<ScreenMemorySegmentMetadata, String> {
    let data =
        std::fs::read(path).map_err(|e| format!("screen memory metadata read failed: {e}"))?;
    serde_json::from_slice(&data).map_err(|e| format!("screen memory metadata decode failed: {e}"))
}

fn recent_segments(
    app: &AppHandle,
    limit: Option<usize>,
) -> Result<Vec<ScreenMemorySegmentMetadata>, String> {
    let dir = screen_memory_dir(app)?;
    let mut segments = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("screen memory directory read failed: {e}"))?
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(segment) = read_segment_metadata_path(&path) else {
            continue;
        };
        if segment.path.exists() {
            segments.push(segment);
        } else {
            let _ = std::fs::remove_file(path);
        }
    }
    segments.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
    if let Some(limit) = limit {
        segments.truncate(limit);
    }
    Ok(segments)
}

fn query_screen_memory(
    app: &AppHandle,
    query: Option<String>,
    minutes: u64,
    limit: usize,
) -> Result<ScreenMemoryQueryResult, String> {
    let minutes = minutes.clamp(1, 24 * 30 * 60);
    let limit = limit.clamp(1, 500);
    let cutoff = Utc::now() - ChronoDuration::minutes(minutes as i64);
    let query = query
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let query_lc = query.as_ref().map(|value| value.to_lowercase());
    let events = recent_events(app, cutoff, query_lc.as_deref(), limit)?;
    let mut segments = recent_segments(app, None)?
        .into_iter()
        .filter(|segment| {
            DateTime::parse_from_rfc3339(&segment.ended_at)
                .map(|value| value.with_timezone(&Utc) >= cutoff)
                .unwrap_or(true)
        })
        .filter(|segment| {
            let Some(query) = query_lc.as_ref() else {
                return true;
            };
            segment.id.to_lowercase().contains(query)
                || segment.file_name.to_lowercase().contains(query)
                || segment
                    .path
                    .to_string_lossy()
                    .to_lowercase()
                    .contains(query)
        })
        .collect::<Vec<_>>();
    segments.truncate(limit);
    Ok(ScreenMemoryQueryResult {
        query,
        minutes,
        events,
        segments,
    })
}

fn recent_events(
    app: &AppHandle,
    cutoff: DateTime<Utc>,
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<ScreenMemoryEvent>, String> {
    let path = screen_memory_events_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(&path).map_err(|e| format!("screen memory events open failed: {e}"))?;
    let reader = BufReader::new(file);
    let mut events = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        let Ok(event) = serde_json::from_str::<ScreenMemoryEvent>(&line) else {
            continue;
        };
        let captured_at = DateTime::parse_from_rfc3339(&event.captured_at)
            .map(|value| value.with_timezone(&Utc))
            .ok();
        if captured_at.map(|value| value < cutoff).unwrap_or(false) {
            continue;
        }
        if let Some(query) = query {
            let haystack = format!(
                "{} {} {}",
                event.app_name.as_deref().unwrap_or(""),
                event.window_title.as_deref().unwrap_or(""),
                event.bundle_id.as_deref().unwrap_or("")
            )
            .to_lowercase();
            if !haystack.contains(query) {
                continue;
            }
        }
        events.push(event);
    }
    events.sort_by(|a, b| b.captured_at.cmp(&a.captured_at));
    events.truncate(limit);
    Ok(events)
}

fn export_recent(app: &AppHandle, minutes: u64) -> Result<ScreenMemoryExportResult, String> {
    let minutes = minutes.clamp(1, 24 * 30 * 60);
    let cutoff = Utc::now() - ChronoDuration::minutes(minutes as i64);
    let segments = recent_segments(app, None)?
        .into_iter()
        .filter(|segment| {
            DateTime::parse_from_rfc3339(&segment.ended_at)
                .map(|value| value.with_timezone(&Utc) >= cutoff)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return Err("No Screen Memory segments are available for that range.".to_string());
    }

    let folder = app
        .path()
        .video_dir()
        .map_err(|e| format!("videos directory unavailable: {e}"))?
        .join("Clips")
        .join("Screen Memory")
        .join(Utc::now().format("%Y-%m-%d-%H%M%S").to_string());
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("screen memory export folder unavailable: {e}"))?;

    let mut files = Vec::new();
    for (index, segment) in segments.iter().rev().enumerate() {
        let extension = segment
            .path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("mp4");
        let file_name = format!("segment-{:02}.{extension}", index + 1);
        let destination = folder.join(&file_name);
        let _ = std::fs::remove_file(&destination);
        std::fs::copy(&segment.path, &destination)
            .map_err(|e| format!("screen memory export copy failed: {e}"))?;
        let bytes = std::fs::metadata(&destination)
            .map_err(|e| format!("screen memory export metadata failed: {e}"))?
            .len();
        files.push(ScreenMemoryExportFile {
            path: destination.to_string_lossy().to_string(),
            file_name,
            bytes,
            mime_type: segment.mime_type.clone(),
        });
    }

    Ok(ScreenMemoryExportResult {
        folder_path: folder.to_string_lossy().to_string(),
        files,
    })
}

fn prune_segments(app: &AppHandle, config: &ScreenMemoryConfig) -> Result<(), String> {
    let segments = recent_segments(app, None)?;
    let cutoff = Utc::now() - ChronoDuration::hours(config.retention_hours as i64);
    let mut kept_bytes = 0_u64;
    for segment in segments {
        let ended_at = DateTime::parse_from_rfc3339(&segment.ended_at)
            .map(|value| value.with_timezone(&Utc))
            .ok();
        let expired = ended_at.map(|value| value < cutoff).unwrap_or(false);
        kept_bytes = kept_bytes.saturating_add(segment.bytes);
        if expired || kept_bytes > config.max_bytes {
            let _ = delete_segment(app, &segment.id);
        }
    }
    Ok(())
}

fn delete_segment(app: &AppHandle, segment_id: &str) -> Result<ScreenMemoryDeleteResult, String> {
    let metadata_path = segment_metadata_path(app, segment_id)?;
    let segment = read_segment_metadata_path(&metadata_path).ok();
    let mut deleted_segments = 0_usize;
    let mut deleted_bytes = 0_u64;
    if let Some(segment) = segment {
        deleted_bytes = segment.bytes;
        remove_file_if_exists(&segment.path)?;
        deleted_segments = 1;
    }
    remove_file_if_exists(&metadata_path)?;
    Ok(ScreenMemoryDeleteResult {
        deleted_segments,
        deleted_bytes,
    })
}

fn delete_all_segments(app: &AppHandle) -> Result<ScreenMemoryDeleteResult, String> {
    let dir = screen_memory_dir(app)?;
    let mut deleted_segments = 0_usize;
    let mut deleted_bytes = 0_u64;
    for segment in recent_segments(app, None)? {
        deleted_bytes = deleted_bytes.saturating_add(segment.bytes);
        remove_file_if_exists(&segment.path)?;
        remove_file_if_exists(&segment_metadata_path(app, &segment.id)?)?;
        deleted_segments += 1;
    }
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("screen memory directory read failed: {e}"))?
        .flatten()
    {
        let path = entry.path();
        if path.is_file() {
            remove_file_if_exists(&path)?;
        }
    }
    Ok(ScreenMemoryDeleteResult {
        deleted_segments,
        deleted_bytes,
    })
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("remove {} failed: {err}", path.display())),
    }
}

fn record_error(app: &AppHandle, error: String) {
    eprintln!("[clips-tray] Screen Memory error: {error}");
    if let Some(state) = app.try_state::<ScreenMemoryState>() {
        if let Ok(mut guard) = state.inner.lock() {
            guard.last_error = Some(error);
        }
    }
    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
