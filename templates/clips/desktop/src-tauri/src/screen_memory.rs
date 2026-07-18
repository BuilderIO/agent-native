use crate::capture_graph::{
    CaptureConsumer, CaptureGraphError, CaptureGraphState, CaptureSource, CoverageGapReason,
};
use crate::config::{FeatureConfig, RewindCaptureMode, ScreenMemoryConfig};
use crate::native_screen::{
    self, NativeFullscreenBackend, DISK_SPACE_BLOCK_BYTES, MP4_RECORDING_MIME_TYPE,
    QUICKTIME_RECORDING_MIME_TYPE,
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, VecDeque};
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
const MAX_RETENTION_HOURS: u32 = 24;
const MIN_MAX_BYTES: u64 = 100 * 1024 * 1024;
const MAX_MAX_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
const ROTATOR_TICK: Duration = Duration::from_millis(500);
/// Privacy detection must not inherit the user-facing context sampling cadence.
/// This bounds how long recognized excluded pixels/audio may reach the current
/// logical segment before that entire segment is discarded.
const EXCLUSION_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SCREEN_MEMORY_MCP_NAME: &str = "clips-screen-memory";

static SEGMENT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct ScreenMemoryState {
    inner: Mutex<ScreenMemoryRuntime>,
    /// OCR and Whisper indexing share this gate so completed segments never
    /// fan out into concurrent CPU/memory-heavy post-processing jobs.
    indexing: Mutex<()>,
    /// Serializes physical producer stop/start transitions. Callers that hold
    /// this lock use `rotate_segment_inner`; ordinary callers use
    /// `rotate_segment`, which acquires it for them.
    transition: Mutex<()>,
}

#[derive(Default)]
struct ScreenMemoryRuntime {
    active: Option<ActiveScreenMemorySegment>,
    worker_stop: Option<Arc<AtomicBool>>,
    rewind_lease_id: Option<String>,
    exclusion_active: bool,
    exclusion_gap: Option<ActiveExclusionGap>,
    temporary_audio_consumers: HashMap<String, TemporaryAudioConsumer>,
    last_error: Option<String>,
    ocr_queue: VecDeque<ScreenMemoryOcrJob>,
    ocr_worker_running: bool,
    transcript_queue: VecDeque<ScreenMemoryTranscriptJob>,
    transcript_worker_running: bool,
    transcript_active_segment: Option<String>,
    transcript_cancelled_segments: BTreeSet<String>,
    /// Ephemeral artifact pins. These intentionally do not survive a crash:
    /// callers must have copied any artifact they need before relying on it.
    segment_pins: HashMap<String, BTreeSet<String>>,
}

struct ActiveExclusionGap {
    started_at: Instant,
    sources: Vec<CaptureSource>,
}

fn active_exclusion_gap(
    started_at: Instant,
    capture_mode: RewindCaptureMode,
) -> ActiveExclusionGap {
    ActiveExclusionGap {
        started_at,
        sources: requested_sources(capture_mode),
    }
}

struct TemporaryAudioConsumer {
    graph_lease_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TemporaryAudioLease {
    owner_id: String,
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
    capture_mode: RewindCaptureMode,
    exclusion_tainted: Arc<AtomicBool>,
    graph_epoch_id: String,
    graph_started_elapsed_ms: u64,
}

#[derive(Clone)]
struct ScreenMemoryOcrJob {
    segment: ScreenMemorySegmentMetadata,
    sample_interval_seconds: u64,
}

#[derive(Clone)]
struct ScreenMemoryTranscriptJob {
    segment: ScreenMemorySegmentMetadata,
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
    #[serde(default)]
    pub system_audio_path: Option<PathBuf>,
    #[serde(default)]
    pub microphone_path: Option<PathBuf>,
    pub corrupt: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub capture_mode: RewindCaptureMode,
    #[serde(default)]
    pub exclusion_tainted: bool,
    /// Monotonic offsets from the shared capture graph; wall-clock fields stay
    /// for human-facing local files and backwards compatibility.
    #[serde(default)]
    pub graph_epoch_id: Option<String>,
    #[serde(default)]
    pub graph_started_elapsed_ms: u64,
    #[serde(default)]
    pub graph_ended_elapsed_ms: u64,
}

fn audio_sidecar_path(video_path: &Path, source: &str) -> PathBuf {
    let stem = video_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("segment");
    video_path.with_file_name(format!("{stem}.{source}.wav"))
}

fn existing_audio_sidecars(
    video_path: &Path,
    mode: RewindCaptureMode,
) -> (Option<PathBuf>, Option<PathBuf>) {
    if mode != RewindCaptureMode::VisualsAudio {
        return (None, None);
    }
    let system = audio_sidecar_path(video_path, "system");
    let microphone = audio_sidecar_path(video_path, "microphone");
    (
        system.exists().then_some(system),
        microphone.exists().then_some(microphone),
    )
}

fn media_unit_bytes(video_path: &Path, system: Option<&Path>, microphone: Option<&Path>) -> u64 {
    [Some(video_path), system, microphone]
        .into_iter()
        .flatten()
        .filter_map(|path| std::fs::metadata(path).ok().map(|metadata| metadata.len()))
        .fold(0u64, u64::saturating_add)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryEvent {
    pub captured_at: String,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub bundle_id: Option<String>,
    pub source: String,
    /// Present only for explicit coverage-gap markers. Kept optional so old
    /// event logs remain readable and ordinary context rows stay compact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage_gap_reason: Option<String>,
    /// A small local semantic summary, never a raw accessibility tree. Older
    /// events intentionally deserialize without this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accessibility: Option<crate::accessibility::AccessibilityFingerprint>,
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
    pub exclusion_active: bool,
    pub coverage: String,
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

    let effective_mode = effective_capture_mode(app, config.capture_mode);
    let mode_changed_while_active = app
        .try_state::<ScreenMemoryState>()
        .and_then(|state| {
            state
                .inner
                .lock()
                .ok()
                .and_then(|runtime| runtime.active.as_ref().map(|active| active.capture_mode))
        })
        .is_some_and(|active_mode| active_mode != effective_mode);
    if mode_changed_while_active {
        // Reconfigure the one physical producer at a segment boundary rather
        // than letting its audio contract drift under an existing lease.
        // This is deliberately unlike an ordinary rotation: the requested
        // source set changed, so retaining the old lease would leave the graph
        // claiming the previous mode even after the producer restarts.
        if let Err(err) = rotate_segment(app, &config) {
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
    append_event(&app, coverage_gap_event("user-paused"));
    let _ = refresh_rewind_chapters(&app);
    build_status(&app)
}

#[tauri::command]
pub async fn screen_memory_stop(app: AppHandle) -> Result<ScreenMemoryStatus, String> {
    let mut feature_config = crate::config::feature_config(&app);
    feature_config.screen_memory.enabled = false;
    feature_config.screen_memory.paused = false;
    feature_config.screen_memory = normalize_screen_memory_config(feature_config.screen_memory);
    crate::config::set_feature_config(app.clone(), feature_config).await?;
    append_event(&app, coverage_gap_event("user-disabled"));
    let _ = refresh_rewind_chapters(&app);
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryAgentConnectionStatus {
    pub client: String,
    pub configured: bool,
    pub config_path: String,
    pub store_dir: String,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve the current user's home directory.".to_string())
}

fn toml_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn codex_screen_memory_block(store_dir: &Path) -> String {
    let args = [
        "-y",
        "@agent-native/core@latest",
        "mcp",
        "screen-memory",
        "--dir",
        &store_dir.to_string_lossy(),
    ];
    format!(
        "[mcp_servers.\"{SCREEN_MEMORY_MCP_NAME}\"]\ncommand = \"npx\"\nargs = [{}]\n",
        args.iter()
            .map(|arg| toml_quote(arg))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn table_header(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') {
        return None;
    }
    let end = trimmed.find(']')?;
    Some(trimmed[1..end].trim())
}

fn is_screen_memory_table(header: &str) -> bool {
    header == format!("mcp_servers.\"{SCREEN_MEMORY_MCP_NAME}\"")
        || header == format!("mcp_servers.{SCREEN_MEMORY_MCP_NAME}")
        || header.starts_with(&format!("mcp_servers.\"{SCREEN_MEMORY_MCP_NAME}\"."))
        || header.starts_with(&format!("mcp_servers.{SCREEN_MEMORY_MCP_NAME}."))
}

fn replace_codex_screen_memory_block(existing: &str, block: &str) -> String {
    let lines = existing.lines().collect::<Vec<_>>();
    let mut kept = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        if table_header(lines[index]).is_some_and(is_screen_memory_table) {
            index += 1;
            while index < lines.len() && table_header(lines[index]).is_none() {
                index += 1;
            }
            continue;
        }
        kept.push(lines[index]);
        index += 1;
    }
    let base = kept.join("\n").trim_end().to_string();
    if base.is_empty() {
        format!("{block}\n")
    } else {
        format!("{base}\n\n{block}\n")
    }
}

fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create {}: {err}", parent.display()))?;
    }
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&temporary, contents)
        .map_err(|err| format!("Could not write {}: {err}", temporary.display()))?;
    std::fs::rename(&temporary, path)
        .map_err(|err| format!("Could not replace {}: {err}", path.display()))
}

fn agent_connection_config_path(client: &str) -> Result<PathBuf, String> {
    let home = home_dir()?;
    match client {
        "codex" => Ok(home.join(".codex/config.toml")),
        "claude-code" => Ok(home.join(".claude.json")),
        _ => Err("Supported agents are Codex and Claude Code.".to_string()),
    }
}

fn install_agent_connection(client: &str, store_dir: &Path) -> Result<PathBuf, String> {
    let config_path = agent_connection_config_path(client)?;
    if client == "codex" {
        let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
        let next =
            replace_codex_screen_memory_block(&existing, &codex_screen_memory_block(store_dir));
        write_atomic(&config_path, next.as_bytes())?;
    } else {
        let mut root = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let object = root
            .as_object_mut()
            .ok_or_else(|| format!("{} is not a JSON object.", config_path.display()))?;
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or_else(|| "Claude Code mcpServers is not a JSON object.".to_string())?;
        servers.insert(
            SCREEN_MEMORY_MCP_NAME.to_string(),
            serde_json::json!({
                "command": "npx",
                "args": [
                    "-y",
                    "@agent-native/core@latest",
                    "mcp",
                    "screen-memory",
                    "--dir",
                    store_dir.to_string_lossy()
                ]
            }),
        );
        let bytes = serde_json::to_vec_pretty(&root)
            .map_err(|err| format!("Could not encode Claude Code configuration: {err}"))?;
        write_atomic(&config_path, &bytes)?;
    }
    Ok(config_path)
}

#[tauri::command]
pub async fn screen_memory_install_agent_connection(
    app: AppHandle,
    client: String,
) -> Result<ScreenMemoryAgentConnectionStatus, String> {
    let store_dir = screen_memory_dir(&app)?;
    let config_path = install_agent_connection(&client, &store_dir)?;
    Ok(ScreenMemoryAgentConnectionStatus {
        client,
        configured: true,
        config_path: config_path.to_string_lossy().to_string(),
        store_dir: store_dir.to_string_lossy().to_string(),
    })
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
    config.excluded_bundle_ids = normalize_excluded_bundle_ids(config.excluded_bundle_ids);
    config.exclude_private_windows = false;
    config
}

fn normalize_excluded_bundle_ids(bundle_ids: Vec<String>) -> Vec<String> {
    let mut normalized = bundle_ids
        .into_iter()
        .map(|bundle_id| bundle_id.trim().to_ascii_lowercase())
        .filter(|bundle_id| !bundle_id.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
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
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("screen memory directory protection failed: {e}"))?;
    }
    Ok(dir)
}

fn screen_memory_events_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(screen_memory_dir(app)?.join(SCREEN_MEMORY_EVENTS_JSONL))
}

fn agent_handoffs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = screen_memory_dir(app)?.join("agent-handoffs");
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("agent handoff directory unavailable: {err}"))?;
    Ok(dir)
}

fn agent_handoff_path(app: &AppHandle, request_id: &str) -> Result<PathBuf, String> {
    let safe = sanitize_segment_id(request_id);
    if safe != request_id || !safe.starts_with("handoff-") {
        return Err("Invalid Rewind handoff request ID.".to_string());
    }
    Ok(agent_handoffs_dir(app)?.join(format!("{safe}.json")))
}

fn read_agent_handoff(path: &Path) -> Result<serde_json::Value, String> {
    serde_json::from_slice(
        &std::fs::read(path).map_err(|err| format!("Could not read {}: {err}", path.display()))?,
    )
    .map_err(|err| format!("Could not parse {}: {err}", path.display()))
}

fn write_agent_handoff(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|err| format!("Could not encode agent handoff: {err}"))?;
    write_atomic(path, &bytes)
}

#[tauri::command]
pub async fn screen_memory_next_agent_handoff(
    app: AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    let mut pending = Vec::new();
    for entry in std::fs::read_dir(agent_handoffs_dir(&app)?)
        .map_err(|err| format!("Could not list agent handoffs: {err}"))?
    {
        let path = entry.map_err(|err| err.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let value = match read_agent_handoff(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("status").and_then(|value| value.as_str()) == Some("pending") {
            let requested_at = value
                .get("requestedAt")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            pending.push((requested_at, value));
        }
    }
    pending.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(pending.into_iter().next().map(|(_, value)| value))
}

#[tauri::command]
pub async fn screen_memory_update_agent_handoff(
    app: AppHandle,
    request_id: String,
    status: String,
    result: Option<serde_json::Value>,
    error: Option<String>,
) -> Result<(), String> {
    if !matches!(
        status.as_str(),
        "processing" | "ready" | "declined" | "failed"
    ) {
        return Err("Invalid Rewind handoff status.".to_string());
    }
    let path = agent_handoff_path(&app, &request_id)?;
    let mut value = read_agent_handoff(&path)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Rewind handoff is not an object.".to_string())?;
    object.insert("status".to_string(), serde_json::json!(status));
    object.insert("updatedAt".to_string(), serde_json::json!(now_iso()));
    if let Some(result) = result.and_then(|value| value.as_object().cloned()) {
        for (key, value) in result {
            if matches!(
                key.as_str(),
                "recordingId" | "agentUrl" | "contextUrl" | "expiresAt" | "autoDeleteAt"
            ) {
                object.insert(key, value);
            }
        }
    }
    if let Some(error) = error {
        object.insert(
            "error".to_string(),
            serde_json::json!(error.chars().take(1_000).collect::<String>()),
        );
    }
    write_agent_handoff(&path, &value)
}

#[tauri::command]
pub async fn screen_memory_due_agent_handoffs(
    app: AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let now = Utc::now();
    let mut due = Vec::new();
    for entry in std::fs::read_dir(agent_handoffs_dir(&app)?)
        .map_err(|err| format!("Could not list agent handoffs: {err}"))?
    {
        let path = entry.map_err(|err| err.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let value = match read_agent_handoff(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("status").and_then(|value| value.as_str()) != Some("ready")
            || value.get("autoDeletedAt").is_some()
        {
            continue;
        }
        let Some(auto_delete_at) = value
            .get("autoDeleteAt")
            .and_then(|value| value.as_str())
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        else {
            continue;
        };
        if auto_delete_at.with_timezone(&Utc) <= now {
            due.push(serde_json::json!({
                "requestId": value.get("requestId"),
                "recordingId": value.get("recordingId")
            }));
        }
    }
    Ok(due)
}

#[tauri::command]
pub async fn screen_memory_mark_agent_handoff_deleted(
    app: AppHandle,
    request_id: String,
) -> Result<(), String> {
    let path = agent_handoff_path(&app, &request_id)?;
    let mut value = read_agent_handoff(&path)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Rewind handoff is not an object.".to_string())?;
    object.insert("status".to_string(), serde_json::json!("deleted"));
    object.insert("autoDeletedAt".to_string(), serde_json::json!(now_iso()));
    write_agent_handoff(&path, &value)
}

#[tauri::command]
pub async fn screen_memory_cancel_agent_handoff_cleanup(
    app: AppHandle,
    request_id: String,
) -> Result<(), String> {
    let path = agent_handoff_path(&app, &request_id)?;
    let mut value = read_agent_handoff(&path)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Rewind handoff is not an object.".to_string())?;
    object.remove("autoDeleteAt");
    object.insert(
        "cleanupCanceledAt".to_string(),
        serde_json::json!(now_iso()),
    );
    object.insert(
        "cleanupCanceledReason".to_string(),
        serde_json::json!("promoted"),
    );
    write_agent_handoff(&path, &value)
}

fn segment_metadata_path(app: &AppHandle, segment_id: &str) -> Result<PathBuf, String> {
    Ok(screen_memory_dir(app)?.join(format!("{}.json", sanitize_segment_id(segment_id))))
}

fn segment_ocr_rows_path(app: &AppHandle, segment_id: &str) -> Result<PathBuf, String> {
    Ok(screen_memory_dir(app)?.join(format!("{}.ocr.jsonl", sanitize_segment_id(segment_id))))
}

fn segment_ocr_status_path(app: &AppHandle, segment_id: &str) -> Result<PathBuf, String> {
    Ok(screen_memory_dir(app)?.join(format!(
        "{}.ocr-status.json",
        sanitize_segment_id(segment_id)
    )))
}

fn segment_transcript_rows_path(app: &AppHandle, segment_id: &str) -> Result<PathBuf, String> {
    Ok(transcript_sidecar_paths(&screen_memory_dir(app)?, segment_id).0)
}

fn segment_transcript_status_path(app: &AppHandle, segment_id: &str) -> Result<PathBuf, String> {
    Ok(transcript_sidecar_paths(&screen_memory_dir(app)?, segment_id).1)
}

fn transcript_sidecar_paths(dir: &Path, segment_id: &str) -> (PathBuf, PathBuf) {
    let id = sanitize_segment_id(segment_id);
    (
        dir.join(format!("{id}.transcript.jsonl")),
        dir.join(format!("{id}.transcript-status.json")),
    )
}

fn remove_transcript_sidecars(dir: &Path, segment_id: &str) -> Result<(), String> {
    let (rows, status) = transcript_sidecar_paths(dir, segment_id);
    remove_file_if_exists(&rows)?;
    remove_file_if_exists(&status)
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
    let (active_segment, last_error, exclusion_active) = {
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
            guard.exclusion_active,
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

    let producer_active = active_segment.is_some();
    let coverage = coverage_language(&config, exclusion_active, producer_active);
    Ok(ScreenMemoryStatus {
        available: screen_memory_available(),
        state,
        config,
        storage_dir,
        active_segment,
        recent_segments: recent_segments(app, Some(5))?,
        last_error,
        exclusion_active,
        coverage,
    })
}

fn coverage_language(
    config: &ScreenMemoryConfig,
    exclusion_active: bool,
    producer_active: bool,
) -> String {
    if exclusion_active {
        return "Capture stopped for an excluded app. The entire in-flight media segment was discarded, and this interval is recorded as a source coverage gap.".to_string();
    }
    if !config.enabled {
        return "Rewind capture is disabled. Existing local segments remain available.".to_string();
    }
    if config.paused {
        return "Rewind capture is paused. Existing local segments remain available, and no new source coverage is being retained.".to_string();
    }
    if producer_active {
        return "Rewind is retaining local media coverage. Excluded applications stop capture and create explicit source coverage gaps.".to_string();
    }
    "Rewind is not currently retaining source coverage.".to_string()
}

pub(crate) fn rewind_clip_compatible(app: &AppHandle) -> Result<bool, String> {
    let status = build_status(app)?;
    Ok(status.available
        && matches!(status.state, ScreenMemoryRuntimeState::Recording)
        && status.last_error.is_none())
}

pub(crate) fn rewind_clip_sources(app: &AppHandle) -> Vec<CaptureSource> {
    let capture_mode = app
        .try_state::<ScreenMemoryState>()
        .and_then(|state| {
            state
                .inner
                .lock()
                .ok()
                .and_then(|runtime| runtime.active.as_ref().map(|active| active.capture_mode))
        })
        .unwrap_or_else(|| {
            let base_mode = crate::config::feature_config(app)
                .screen_memory
                .capture_mode;
            effective_capture_mode(app, base_mode)
        });
    requested_sources(capture_mode)
}

fn effective_mode(
    base_mode: RewindCaptureMode,
    temporary_audio_consumers: usize,
) -> RewindCaptureMode {
    if temporary_audio_consumers > 0 {
        RewindCaptureMode::VisualsAudio
    } else {
        base_mode
    }
}

fn effective_capture_mode(app: &AppHandle, base_mode: RewindCaptureMode) -> RewindCaptureMode {
    let temporary_audio_consumers = app
        .try_state::<ScreenMemoryState>()
        .and_then(|state| {
            state
                .inner
                .lock()
                .ok()
                .map(|runtime| runtime.temporary_audio_consumers.len())
        })
        .unwrap_or(0);
    effective_mode(base_mode, temporary_audio_consumers)
}

fn temporary_audio_lease_available(
    enabled: bool,
    paused: bool,
    producer_active: bool,
    include_mic: bool,
    include_system_audio: bool,
) -> bool {
    enabled && !paused && producer_active && (include_mic || include_system_audio)
}

/// Temporarily upgrades the active Rewind producer to its audio-capable mode.
/// The persisted Screen Memory mode is never changed. Repeated acquisition by
/// the same stable owner is idempotent; distinct owners refcount the effective
/// audio demand through separate graph leases.
pub(crate) fn acquire_temporary_audio_consumer(
    app: &AppHandle,
    owner_id: &str,
    consumer: CaptureConsumer,
    include_mic: bool,
    include_system_audio: bool,
) -> Result<Option<TemporaryAudioLease>, String> {
    if owner_id.trim().is_empty() {
        return Err("temporary audio consumer owner id cannot be empty".into());
    }
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    let config = normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
    let (mut producer_active, already_present, exclusion_active) = {
        let runtime = state.inner.lock().map_err(|error| error.to_string())?;
        (
            runtime.active.is_some(),
            runtime.temporary_audio_consumers.contains_key(owner_id),
            runtime.exclusion_active,
        )
    };
    // Config writes become visible before their sync callback completes. If a
    // meeting arrives in that narrow window, finish stopping the old producer
    // under the same transition lock before returning `None`; the caller can
    // then open the legacy recorder without ever overlapping Rewind.
    if !config.enabled || config.paused {
        if producer_active {
            stop_active_segment_inner(app)?;
        }
        return Ok(None);
    }
    if exclusion_active {
        return Ok(None);
    }
    if !producer_active {
        ensure_running_inner(app, &config)?;
        producer_active = true;
    }
    if already_present {
        return Ok(Some(TemporaryAudioLease {
            owner_id: owner_id.to_owned(),
        }));
    }
    if !temporary_audio_lease_available(
        config.enabled,
        config.paused,
        producer_active,
        include_mic,
        include_system_audio,
    ) {
        return Ok(None);
    }

    let mut sources = Vec::new();
    if include_mic {
        sources.push(CaptureSource::Microphone);
    }
    if include_system_audio {
        sources.push(CaptureSource::SystemAudio);
    }
    let graph_lease = app
        .state::<CaptureGraphState>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .start_consumer(consumer, sources)
        .map_err(capture_graph_error)?;
    {
        let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
        runtime.temporary_audio_consumers.insert(
            owner_id.to_owned(),
            TemporaryAudioConsumer {
                graph_lease_id: graph_lease.id.clone(),
            },
        );
    }

    let needs_upgrade = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .active
        .as_ref()
        .is_some_and(|active| active.capture_mode != RewindCaptureMode::VisualsAudio);
    if needs_upgrade {
        if let Err(error) = rotate_segment_inner(app, &config) {
            rollback_temporary_audio_consumer(app, owner_id);
            return Err(format!("rewind-audio-upgrade-failed: {error}"));
        }
    }
    Ok(Some(TemporaryAudioLease {
        owner_id: owner_id.to_owned(),
    }))
}

pub(crate) fn release_temporary_audio_consumer(
    app: &AppHandle,
    lease: TemporaryAudioLease,
) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    let Some(consumer) = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .temporary_audio_consumers
        .remove(&lease.owner_id)
    else {
        return Ok(());
    };
    end_graph_lease(app, &consumer.graph_lease_id);

    let config = normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
    if !config.enabled || config.paused {
        return Ok(());
    }
    let desired = effective_capture_mode(app, config.capture_mode);
    let needs_restore = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .active
        .as_ref()
        .is_some_and(|active| active.capture_mode != desired);
    if needs_restore {
        rotate_segment_inner(app, &config)?;
    }
    Ok(())
}

fn rollback_temporary_audio_consumer(app: &AppHandle, owner_id: &str) {
    let consumer = app
        .state::<ScreenMemoryState>()
        .inner
        .lock()
        .ok()
        .and_then(|mut runtime| runtime.temporary_audio_consumers.remove(owner_id));
    if let Some(consumer) = consumer {
        end_graph_lease(app, &consumer.graph_lease_id);
    }
}

fn end_graph_lease(app: &AppHandle, lease_id: &str) {
    if let Ok(mut graph) = app.state::<CaptureGraphState>().0.lock() {
        if let Err(error) = graph.end_consumer(lease_id) {
            eprintln!("[clips-tray] temporary audio graph lease close failed: {error}");
        }
    }
}

/// Fence the rolling producer at an exact media-fragment edge and persist the
/// closed logical segment while keeping the replacement capture active.
pub(crate) fn fence_active_for_clip(
    app: &AppHandle,
) -> Result<ScreenMemorySegmentMetadata, String> {
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    let active = {
        let active = state
            .inner
            .lock()
            .map_err(|error| error.to_string())?
            .active
            .take();
        active
    }
    .ok_or_else(|| "rewind-not-compatible: Screen Memory is not recording".to_string())?;
    if active.exclusion_tainted.load(Ordering::SeqCst) {
        let gap = active_exclusion_gap(active.started_at, active.capture_mode);
        let segment_id = active.id.clone();
        {
            let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
            runtime.exclusion_active = true;
            runtime.exclusion_gap = Some(gap);
        }
        discard_active_segment(active);
        discard_segment_artifacts(app, &segment_id)?;
        end_rewind_lease(app);
        let _ = app.emit(SCREEN_MEMORY_EVENT, ());
        return Err(
            "rewind-not-compatible: recognized privacy exclusion created a coverage gap".into(),
        );
    }
    match fence_rotate_segment(app, active) {
        Ok((segment, next)) => {
            write_segment_metadata(app, &segment)?;
            install_rotated_segment(app, next)?;
            Ok(segment)
        }
        Err(active) => {
            if let Ok(mut runtime) = app.state::<ScreenMemoryState>().inner.lock() {
                runtime.active = Some(active);
            }
            Err("rewind-not-compatible: active Screen Memory backend cannot fence".into())
        }
    }
}

fn ensure_running(app: &AppHandle, config: &ScreenMemoryConfig) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    ensure_running_inner(app, config)
}

fn ensure_running_inner(app: &AppHandle, config: &ScreenMemoryConfig) -> Result<(), String> {
    // An incompatible ordinary Clip owns the physical capture graph until its
    // final suspension lease releases. Config sync and temporary audio demand
    // must not silently restart Rewind in the middle of that handoff.
    if crate::rewind_capture_suspension::is_active(app) {
        return Ok(());
    }
    let mut config = config.clone();
    config.capture_mode = effective_capture_mode(app, config.capture_mode);
    if !screen_memory_available() {
        return Err("Screen Memory capture is currently macOS-only.".to_string());
    }

    {
        let state = app.state::<ScreenMemoryState>();
        let guard = state.inner.lock().map_err(|e| e.to_string())?;
        if guard.active.is_some() || guard.exclusion_active {
            return Ok(());
        }
    }

    let active = start_new_segment(app, config.capture_mode)?;
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

    if let Err(err) = start_rewind_lease(app, config.capture_mode) {
        let _ = stop_active_segment_inner(app);
        return Err(err);
    }

    spawn_rotator(app.clone(), stop);
    prune_segments(app, &config)?;
    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
    Ok(())
}

fn spawn_rotator(app: AppHandle, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || loop {
        let config =
            normalize_screen_memory_config(crate::config::feature_config(&app).screen_memory);
        match wait_for_rotation(&app, &stop, &config) {
            RotationWait::Stop => return,
            RotationWait::Resumed => continue,
            RotationWait::Rotate => {}
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RotationWait {
    Stop,
    Rotate,
    Resumed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExclusionTransition {
    KeepCapturing,
    Suspend,
    StaySuspended,
    Resume,
}

fn exclusion_transition(exclusion_active: bool, recognized: bool) -> ExclusionTransition {
    match (exclusion_active, recognized) {
        (false, false) => ExclusionTransition::KeepCapturing,
        (false, true) => ExclusionTransition::Suspend,
        (true, true) => ExclusionTransition::StaySuspended,
        (true, false) => ExclusionTransition::Resume,
    }
}

fn exclusion_resume_allowed(
    enabled: bool,
    paused: bool,
    stop_requested: bool,
    recognized: bool,
    exclusion_active: bool,
    producer_active: bool,
) -> bool {
    enabled && !paused && !stop_requested && !recognized && exclusion_active && !producer_active
}

fn wait_for_rotation(
    app: &AppHandle,
    stop: &AtomicBool,
    config: &ScreenMemoryConfig,
) -> RotationWait {
    let deadline = Instant::now() + Duration::from_secs(config.segment_seconds);
    let mut next_sample = Instant::now();
    let mut next_exclusion_poll = Instant::now();
    loop {
        if stop.load(Ordering::Relaxed) {
            return RotationWait::Stop;
        }
        if Instant::now() >= deadline {
            return RotationWait::Rotate;
        }
        let now = Instant::now();
        if now >= next_exclusion_poll {
            // Exclusion edits are privacy controls, so they must take effect on
            // the next 250 ms poll rather than waiting for the current media
            // segment (up to five minutes by default) to rotate.
            let live_config =
                normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
            let (event, exclusion_reason) = sample_active_window(&live_config);
            if exclusion_transition(false, exclusion_reason.is_some())
                == ExclusionTransition::Suspend
            {
                // A concurrent stop/fence that wins the transition lock must
                // still fail closed after recognition.
                mark_active_segment_exclusion_tainted(app);
                append_event(
                    app,
                    coverage_gap_event(exclusion_reason.unwrap_or("privacy-exclusion")),
                );
                if let Err(error) = suspend_for_exclusion(app) {
                    record_error(app, error);
                }
                if wait_for_exclusion_to_clear(app, stop) {
                    return RotationWait::Stop;
                }
                // A resumed producer begins a fresh logical segment and gets a
                // fresh rotation deadline in the outer worker loop.
                return RotationWait::Resumed;
            }
            if now >= next_sample {
                append_event(app, event);
                next_sample = now + Duration::from_secs(live_config.sample_interval_seconds.max(1));
            }
            next_exclusion_poll = now + EXCLUSION_POLL_INTERVAL;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        let until_sample = next_sample.saturating_duration_since(Instant::now());
        let until_exclusion = next_exclusion_poll.saturating_duration_since(Instant::now());
        std::thread::sleep(
            remaining
                .min(until_sample)
                .min(until_exclusion)
                .min(ROTATOR_TICK),
        );
    }
}

fn mark_active_segment_exclusion_tainted(app: &AppHandle) {
    if let Some(state) = app.try_state::<ScreenMemoryState>() {
        if let Ok(runtime) = state.inner.lock() {
            if let Some(active) = runtime.active.as_ref() {
                active.exclusion_tainted.store(true, Ordering::SeqCst);
            }
        }
    }
}

fn sample_active_window(config: &ScreenMemoryConfig) -> (ScreenMemoryEvent, Option<&'static str>) {
    #[cfg(target_os = "macos")]
    {
        let (context, owner_pid) =
            crate::accessibility::macos::active_window_context_with_pid_impl();
        if let Some(reason) = event_exclusion_reason(
            config,
            context.bundle_id.as_deref(),
            context.window_title.as_deref(),
        ) {
            return (coverage_gap_event(reason), Some(reason));
        }
        (
            ScreenMemoryEvent {
                captured_at: now_iso(),
                app_name: context.app_name,
                window_title: context.window_title,
                bundle_id: context.bundle_id,
                source: context.source,
                coverage_gap_reason: None,
                // Exclusion was checked above; this silent AX read never
                // prompts and degrades to None when macOS denies/unreadable.
                accessibility: owner_pid
                    .and_then(crate::accessibility::macos::semantic_fingerprint_for_pid_impl),
            },
            None,
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        (
            ScreenMemoryEvent {
                captured_at: now_iso(),
                app_name: None,
                window_title: None,
                bundle_id: None,
                source: "unsupported".to_string(),
                coverage_gap_reason: None,
                accessibility: None,
            },
            None,
        )
    }
}

fn event_exclusion_reason(
    config: &ScreenMemoryConfig,
    bundle_id: Option<&str>,
    _window_title: Option<&str>,
) -> Option<&'static str> {
    let normalized_bundle_id = bundle_id.map(|value| value.trim().to_ascii_lowercase());
    if normalized_bundle_id.as_deref().is_some_and(|bundle_id| {
        config
            .excluded_bundle_ids
            .iter()
            .any(|excluded| excluded.eq_ignore_ascii_case(bundle_id))
    }) {
        return Some("excluded-bundle-id");
    }

    None
}

fn coverage_gap_event(reason: &str) -> ScreenMemoryEvent {
    ScreenMemoryEvent {
        captured_at: now_iso(),
        app_name: None,
        window_title: None,
        bundle_id: None,
        source: "coverage-gap".to_string(),
        coverage_gap_reason: Some(reason.to_string()),
        accessibility: None,
    }
}

/// Stop the one physical producer and erase the complete logical segment that
/// may contain excluded media. The rotator worker deliberately remains alive:
/// while this state is active it does nothing except poll the recognized-window
/// signal until a safe replacement can be started under the transition lock.
fn suspend_for_exclusion(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    let active = {
        let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
        if runtime.exclusion_active {
            return Ok(());
        }
        let worker_running = runtime
            .worker_stop
            .as_ref()
            .is_some_and(|stop| !stop.load(Ordering::Relaxed));
        let config = crate::config::feature_config(app).screen_memory;
        if !worker_running || !config.enabled || config.paused {
            return Ok(());
        }
        let active = runtime.active.take();
        runtime.exclusion_active = true;
        runtime.exclusion_gap = Some(match active.as_ref() {
            Some(active) => active_exclusion_gap(
                // The whole segment is discarded, so coverage ended when that
                // segment began—not merely when the excluded window was noticed.
                active.started_at,
                active.capture_mode,
            ),
            None => active_exclusion_gap(
                Instant::now(),
                effective_mode(config.capture_mode, runtime.temporary_audio_consumers.len()),
            ),
        });
        active
    };

    if let Some(active) = active {
        let segment_id = active.id.clone();
        discard_active_segment(active);
        discard_segment_artifacts(app, &segment_id)?;
    }
    end_rewind_lease(app);
    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
    Ok(())
}

fn wait_for_exclusion_to_clear(app: &AppHandle, stop: &AtomicBool) -> bool {
    loop {
        if stop.load(Ordering::Relaxed) {
            return true;
        }
        let config =
            normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
        if !config.enabled || config.paused {
            return true;
        }
        let recognized = sample_active_window(&config).1.is_some();
        if exclusion_transition(true, recognized) == ExclusionTransition::Resume {
            match resume_after_exclusion(app, &config, stop) {
                Ok(true) => return false,
                Ok(false) => {}
                Err(error) => record_error(app, error),
            }
        }
        std::thread::sleep(EXCLUSION_POLL_INTERVAL);
    }
}

/// Returns true only after one replacement producer is installed. A second
/// recognition check is made while holding the producer transition lock so a
/// config callback, temporary-audio request, or stop cannot race a second start.
fn resume_after_exclusion(
    app: &AppHandle,
    _config: &ScreenMemoryConfig,
    stop: &AtomicBool,
) -> Result<bool, String> {
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    if crate::rewind_capture_suspension::is_active(app) {
        return Ok(false);
    }
    let current = normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
    let recognized = sample_active_window(&current).1.is_some();
    let (exclusion_active, producer_active) = {
        let runtime = state.inner.lock().map_err(|error| error.to_string())?;
        (runtime.exclusion_active, runtime.active.is_some())
    };
    if !exclusion_resume_allowed(
        current.enabled,
        current.paused,
        stop.load(Ordering::Relaxed),
        recognized,
        exclusion_active,
        producer_active,
    ) {
        return Ok(producer_active);
    }

    let mode = effective_capture_mode(app, current.capture_mode);
    let next = start_new_segment(app, mode)?;
    if let Err(error) = install_rotated_segment(app, next) {
        let failed = state
            .inner
            .lock()
            .ok()
            .and_then(|mut runtime| runtime.active.take());
        if let Some(failed) = failed {
            discard_active_segment(failed);
        }
        end_rewind_lease(app);
        return Err(error);
    }

    let gap = {
        let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
        runtime.exclusion_active = false;
        runtime.exclusion_gap.take()
    };
    if let Some(gap) = gap {
        record_source_coverage_gap(app, gap, Instant::now());
    }
    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
    Ok(true)
}

fn record_source_coverage_gap(app: &AppHandle, gap: ActiveExclusionGap, ended_at: Instant) {
    let graph_state = app.state::<CaptureGraphState>();
    let Ok(mut graph) = graph_state.0.lock() else {
        return;
    };
    for source in gap.sources {
        if let Err(error) = graph.record_coverage_gap_at(
            source,
            CoverageGapReason::PrivacyExclusion,
            gap.started_at,
            ended_at,
        ) {
            eprintln!("[clips-tray] exclusion coverage gap record failed: {error}");
        }
    }
}

fn discard_segment_artifacts(app: &AppHandle, segment_id: &str) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    {
        let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
        runtime.ocr_queue.retain(|job| job.segment.id != segment_id);
        runtime
            .transcript_queue
            .retain(|job| job.segment.id != segment_id);
        runtime
            .transcript_cancelled_segments
            .insert(segment_id.to_string());
    }
    let dir = screen_memory_dir(app)?;
    let (transcript_rows, transcript_status) = transcript_sidecar_paths(&dir, segment_id);
    remove_discarded_sidecars(&[
        segment_metadata_path(app, segment_id)?,
        segment_ocr_rows_path(app, segment_id)?,
        segment_ocr_status_path(app, segment_id)?,
        transcript_rows,
        transcript_status,
    ])
}

fn remove_discarded_sidecars(paths: &[PathBuf]) -> Result<(), String> {
    for path in paths {
        remove_file_if_exists(path)?;
    }
    Ok(())
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
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    rotate_segment_inner(app, config)
}

fn rotate_segment_inner(app: &AppHandle, config: &ScreenMemoryConfig) -> Result<(), String> {
    let mut config = config.clone();
    config.capture_mode = effective_capture_mode(app, config.capture_mode);
    let active = {
        let state = app.state::<ScreenMemoryState>();
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.active.take()
    };

    if let Some(active) = active {
        if active.exclusion_tainted.load(Ordering::SeqCst) {
            let gap = active_exclusion_gap(active.started_at, active.capture_mode);
            let segment_id = active.id.clone();
            {
                let state = app.state::<ScreenMemoryState>();
                let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
                runtime.exclusion_active = true;
                runtime.exclusion_gap = Some(gap);
            }
            discard_active_segment(active);
            discard_segment_artifacts(app, &segment_id)?;
            end_rewind_lease(app);
            let _ = app.emit(SCREEN_MEMORY_EVENT, ());
            return Ok(());
        }
        // A normal rotation on the segmented custom SCK backend only fences
        // the fMP4 writer. The stream and physical producer stay alive; a
        // mode change must still stop/restart because its source contract has
        // changed.
        if active.capture_mode == config.capture_mode {
            match fence_rotate_segment(app, active) {
                Ok((segment, next)) => {
                    // The physical stream is already writing the next file.
                    // Do not let an auxiliary metadata/OCR failure drop it.
                    if let Err(error) = write_segment_metadata(app, &segment) {
                        record_error(app, error);
                    } else {
                        enqueue_segment_ocr(app, segment.clone(), config.sample_interval_seconds);
                        if let Err(error) = prune_segments(app, &config) {
                            record_error(app, error);
                        }
                    }
                    return install_rotated_segment(app, next);
                }
                Err(active) => {
                    // Non-segmented fallback and failed fences retain the
                    // old stop/start behavior. A failed fence never creates
                    // metadata for a path that has not closed.
                    match finalize_active_segment(app, active) {
                        Ok(segment) => {
                            write_segment_metadata(app, &segment)?;
                            enqueue_segment_ocr(
                                app,
                                segment.clone(),
                                config.sample_interval_seconds,
                            );
                            prune_segments(app, &config)?;
                        }
                        Err(err) => {
                            record_error(app, err);
                            end_rewind_lease(app);
                        }
                    }
                }
            }
        } else {
            // The current graph lease must describe the actual producer source
            // set. End it before the safe stop/start mode transition;
            // `install_rotated_segment` starts the replacement lease from the
            // new effective mode.
            end_rewind_lease(app);
            match finalize_active_segment(app, active) {
                Ok(segment) => {
                    write_segment_metadata(app, &segment)?;
                    enqueue_segment_ocr(app, segment.clone(), config.sample_interval_seconds);
                    prune_segments(app, &config)?;
                }
                Err(err) => {
                    record_error(app, err);
                    // The rolling producer has reported an error; its lease must
                    // not imply uninterrupted coverage across the replacement.
                    end_rewind_lease(app);
                }
            }
        }
    }

    let next = match start_new_segment(app, config.capture_mode) {
        Ok(next) => next,
        Err(err) => {
            end_rewind_lease(app);
            return Err(err);
        }
    };
    install_rotated_segment(app, next)
}

fn install_rotated_segment(app: &AppHandle, next: ActiveScreenMemorySegment) -> Result<(), String> {
    let capture_mode = next.capture_mode;
    let mut next = Some(next);
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

    if installed {
        let needs_lease = app
            .state::<ScreenMemoryState>()
            .inner
            .lock()
            .ok()
            .is_some_and(|runtime| runtime.rewind_lease_id.is_none());
        if needs_lease {
            start_rewind_lease(app, capture_mode)?;
        }
    }

    let _ = app.emit(SCREEN_MEMORY_EVENT, ());
    Ok(())
}

/// Returns the fenced metadata plus the replacement logical segment while
/// preserving the one physical custom SCK backend. On unsupported/failing
/// backends it returns the untouched active segment for stop/start fallback.
fn fence_rotate_segment(
    app: &AppHandle,
    active: ActiveScreenMemorySegment,
) -> Result<(ScreenMemorySegmentMetadata, ActiveScreenMemorySegment), ActiveScreenMemorySegment> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(active)
    }
    #[cfg(target_os = "macos")]
    {
        let next_id = next_segment_id();
        let Ok(next_path) = segment_media_path(app, &next_id, "mp4") else {
            return Err(active);
        };
        let Ok(fence) = active.backend.request_fragment_fence(next_path.clone()) else {
            return Err(active);
        };
        let Ok(closed) =
            NativeFullscreenBackend::await_fragment_fence(fence, Duration::from_secs(15))
        else {
            return Err(active);
        };
        let boundary = Instant::now();
        let Ok(segment) = finalize_fenced_segment(&active, closed.path, boundary) else {
            return Err(active);
        };
        let next = ActiveScreenMemorySegment {
            id: next_id,
            path: next_path,
            mime_type: MP4_RECORDING_MIME_TYPE,
            backend: active.backend,
            started_at: boundary,
            started_at_iso: now_iso(),
            width: active.width,
            height: active.height,
            capture_mode: active.capture_mode,
            exclusion_tainted: Arc::new(AtomicBool::new(false)),
            graph_epoch_id: active.graph_epoch_id,
            graph_started_elapsed_ms: graph_elapsed_ms(app, boundary),
        };
        Ok((segment, next))
    }
}

fn stop_active_segment(app: &AppHandle) -> Result<Option<ScreenMemorySegmentMetadata>, String> {
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    stop_active_segment_inner(app)
}

/// Temporarily yields the one physical producer to an ordinary recorder while
/// leaving the persisted Rewind enabled/paused setting untouched. An active
/// privacy exclusion is already physically suspended and remains authoritative.
pub(crate) fn suspend_physical_capture(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    let exclusion_active = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .exclusion_active;
    if !exclusion_active {
        stop_active_segment_inner(app)?;
    }
    Ok(())
}

/// Restores Rewind after an ordinary recorder releases the producer. This is a
/// no-op while disabled, paused, or privacy-excluded and therefore cannot start
/// a competing producer or bypass the exclusion poller.
pub(crate) fn resume_physical_capture(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    let _transition = state.transition.lock().map_err(|error| error.to_string())?;
    let config = normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
    let exclusion_active = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?
        .exclusion_active;
    if config.enabled && !config.paused && !exclusion_active {
        ensure_running_inner(app, &config)?;
    }
    Ok(())
}

fn stop_active_segment_inner(
    app: &AppHandle,
) -> Result<Option<ScreenMemorySegmentMetadata>, String> {
    let (active, exclusion_gap) = {
        let state = app.state::<ScreenMemoryState>();
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        if let Some(stop) = guard.worker_stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        guard.exclusion_active = false;
        (guard.active.take(), guard.exclusion_gap.take())
    };

    if let Some(gap) = exclusion_gap {
        record_source_coverage_gap(app, gap, Instant::now());
    }

    let Some(active) = active else {
        end_rewind_lease(app);
        let _ = app.emit(SCREEN_MEMORY_EVENT, ());
        return Ok(None);
    };

    if active.exclusion_tainted.load(Ordering::SeqCst) {
        let gap = active_exclusion_gap(active.started_at, active.capture_mode);
        let segment_id = active.id.clone();
        discard_active_segment(active);
        discard_segment_artifacts(app, &segment_id)?;
        record_source_coverage_gap(app, gap, Instant::now());
        end_rewind_lease(app);
        let _ = app.emit(SCREEN_MEMORY_EVENT, ());
        return Ok(None);
    }

    let result = finalize_active_segment(app, active).and_then(|segment| {
        write_segment_metadata(app, &segment)?;
        let config =
            normalize_screen_memory_config(crate::config::feature_config(app).screen_memory);
        enqueue_segment_ocr(app, segment.clone(), config.sample_interval_seconds);
        prune_segments(app, &config)?;
        Ok(segment)
    });
    end_rewind_lease(app);
    let segment = result?;
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

fn start_new_segment(
    app: &AppHandle,
    capture_mode: RewindCaptureMode,
) -> Result<ActiveScreenMemorySegment, String> {
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

        let visuals_audio = capture_mode == RewindCaptureMode::VisualsAudio;
        match native_screen::start_segmented_custom_screencapturekit_backend_at(
            app,
            &mp4_path,
            visuals_audio,
            visuals_audio,
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
                    capture_mode,
                    exclusion_tainted: Arc::new(AtomicBool::new(false)),
                    graph_epoch_id: graph_epoch_id(app),
                    graph_started_elapsed_ms: graph_elapsed_ms(app, Instant::now()),
                });
            }
            Err(sck_err) => {
                if visuals_audio {
                    record_requested_source_gaps(app, capture_mode);
                    let _ = std::fs::remove_file(&mp4_path);
                    return Err(format!(
                        "Screen Memory visuals + audio could not start its required ScreenCaptureKit screen, system-audio, and microphone sources: {sck_err}"
                    ));
                }
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
            capture_mode,
            exclusion_tainted: Arc::new(AtomicBool::new(false)),
            graph_epoch_id: graph_epoch_id(app),
            graph_started_elapsed_ms: graph_elapsed_ms(app, Instant::now()),
        })
    }
}

fn requested_sources(capture_mode: RewindCaptureMode) -> Vec<CaptureSource> {
    match capture_mode {
        RewindCaptureMode::Visuals => vec![CaptureSource::Screen],
        RewindCaptureMode::VisualsAudio => vec![
            CaptureSource::Screen,
            CaptureSource::SystemAudio,
            CaptureSource::Microphone,
        ],
    }
}

fn start_rewind_lease(app: &AppHandle, capture_mode: RewindCaptureMode) -> Result<(), String> {
    let lease = {
        let graph = app.state::<CaptureGraphState>();
        let mut graph = graph.0.lock().map_err(|err| err.to_string())?;
        graph
            .start_consumer(CaptureConsumer::Rewind, requested_sources(capture_mode))
            .map_err(capture_graph_error)?
    };
    let state = app.state::<ScreenMemoryState>();
    let mut runtime = state.inner.lock().map_err(|err| err.to_string())?;
    runtime.rewind_lease_id = Some(lease.id);
    Ok(())
}

fn end_rewind_lease(app: &AppHandle) {
    let lease_id = app
        .state::<ScreenMemoryState>()
        .inner
        .lock()
        .ok()
        .and_then(|mut runtime| runtime.rewind_lease_id.take());
    if let Some(lease_id) = lease_id {
        let graph_state = app.state::<CaptureGraphState>();
        if let Ok(mut graph) = graph_state.0.lock() {
            if let Err(err) = graph.end_consumer(&lease_id) {
                eprintln!("[clips-tray] Screen Memory Rewind lease close failed: {err}");
            }
        };
    }
}

fn record_requested_source_gaps(app: &AppHandle, capture_mode: RewindCaptureMode) {
    let now = Instant::now();
    let graph_state = app.state::<CaptureGraphState>();
    let Ok(mut graph) = graph_state.0.lock() else {
        return;
    };
    for source in requested_sources(capture_mode) {
        if let Err(err) =
            graph.record_coverage_gap_at(source, CoverageGapReason::ProducerUnavailable, now, now)
        {
            eprintln!("[clips-tray] Screen Memory coverage gap record failed: {err}");
        }
    }
}

fn capture_graph_error(error: CaptureGraphError) -> String {
    format!("Screen Memory capture graph error: {error}")
}

fn graph_elapsed_ms(app: &AppHandle, instant: Instant) -> u64 {
    app.try_state::<CaptureGraphState>()
        .and_then(|state| {
            state
                .0
                .lock()
                .ok()
                .and_then(|graph| graph.status_at(instant).ok())
        })
        .map(|status| status.graph_elapsed_ms)
        .unwrap_or_default()
}

fn graph_epoch_id(app: &AppHandle) -> String {
    app.try_state::<CaptureGraphState>()
        .and_then(|state| state.0.lock().ok().map(|graph| graph.epoch_id()))
        .unwrap_or_default()
}

fn discard_active_segment(mut active: ActiveScreenMemorySegment) {
    let _ = native_screen::stop_native_recording(&mut active.backend, false);
    let _ = std::fs::remove_file(&active.path);
    let _ = std::fs::remove_file(audio_sidecar_path(&active.path, "system"));
    let _ = std::fs::remove_file(audio_sidecar_path(&active.path, "microphone"));
}

fn finalize_active_segment(
    app: &AppHandle,
    mut active: ActiveScreenMemorySegment,
) -> Result<ScreenMemorySegmentMetadata, String> {
    let stop_error = native_screen::stop_native_recording(&mut active.backend, true).err();
    let ended_at = now_iso();
    let duration_ms = active.started_at.elapsed().as_millis();
    let video_bytes = std::fs::metadata(&active.path)
        .map_err(|e| {
            let suffix = stop_error
                .as_ref()
                .map(|err| format!(" after stop error: {err}"))
                .unwrap_or_default();
            format!("Screen Memory segment missing{suffix}: {e}")
        })?
        .len();
    if video_bytes == 0 {
        let _ = std::fs::remove_file(&active.path);
        return Err(stop_error.unwrap_or_else(|| {
            "Screen Memory segment produced an empty file with no more specific backend error."
                .to_string()
        }));
    }
    let (system_audio_path, microphone_path) =
        existing_audio_sidecars(&active.path, active.capture_mode);
    let bytes = media_unit_bytes(
        &active.path,
        system_audio_path.as_deref(),
        microphone_path.as_deref(),
    );

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
        system_audio_path,
        microphone_path,
        corrupt,
        error,
        capture_mode: active.capture_mode,
        exclusion_tainted: active.exclusion_tainted.load(Ordering::Relaxed),
        graph_epoch_id: Some(active.graph_epoch_id),
        graph_started_elapsed_ms: active.graph_started_elapsed_ms,
        graph_ended_elapsed_ms: graph_elapsed_ms(app, Instant::now()),
    })
}

fn finalize_fenced_segment(
    active: &ActiveScreenMemorySegment,
    closed_path: PathBuf,
    ended_at: Instant,
) -> Result<ScreenMemorySegmentMetadata, String> {
    let video_bytes = std::fs::metadata(&closed_path)
        .map_err(|error| format!("fenced Screen Memory segment missing: {error}"))?
        .len();
    if video_bytes == 0 {
        return Err("fenced Screen Memory segment produced an empty file.".to_string());
    }
    let (system_audio_path, microphone_path) =
        existing_audio_sidecars(&closed_path, active.capture_mode);
    let bytes = media_unit_bytes(
        &closed_path,
        system_audio_path.as_deref(),
        microphone_path.as_deref(),
    );
    Ok(ScreenMemorySegmentMetadata {
        id: active.id.clone(),
        file_name: closed_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: closed_path.clone(),
        mime_type: MP4_RECORDING_MIME_TYPE.to_string(),
        started_at: active.started_at_iso.clone(),
        ended_at: now_iso(),
        duration_ms: active.started_at.elapsed().as_millis(),
        width: active.width,
        height: active.height,
        bytes,
        system_audio_path,
        microphone_path,
        // fMP4 finalization is asynchronous. A fence proves a fragment
        // boundary, not that every player accepts the logical file yet.
        corrupt: native_screen::mp4_has_moov(&closed_path) == Some(false),
        error: None,
        capture_mode: active.capture_mode,
        exclusion_tainted: active.exclusion_tainted.load(Ordering::Relaxed),
        graph_epoch_id: Some(active.graph_epoch_id.clone()),
        graph_started_elapsed_ms: active.graph_started_elapsed_ms,
        graph_ended_elapsed_ms: active
            .graph_started_elapsed_ms
            .saturating_add(ended_at.duration_since(active.started_at).as_millis() as u64),
    })
}

fn enqueue_segment_ocr(
    app: &AppHandle,
    segment: ScreenMemorySegmentMetadata,
    sample_interval_seconds: u64,
) {
    if !segment_derivatives_eligible(&segment) {
        return;
    }
    if let Err(error) = write_ocr_status(
        app,
        &segment.id,
        &crate::screen_memory_ocr::ScreenMemoryOcrIndexStatus::pending(),
    ) {
        record_error(app, error);
        return;
    }
    let should_start = app.try_state::<ScreenMemoryState>().is_some_and(|state| {
        state
            .inner
            .lock()
            .map(|mut runtime| {
                runtime.ocr_queue.push_back(ScreenMemoryOcrJob {
                    segment,
                    sample_interval_seconds,
                });
                if runtime.ocr_worker_running {
                    false
                } else {
                    runtime.ocr_worker_running = true;
                    true
                }
            })
            .unwrap_or(false)
    });
    if should_start {
        let app = app.clone();
        std::thread::spawn(move || run_ocr_queue(app));
    }
}

fn run_ocr_queue(app: AppHandle) {
    loop {
        let job = match app.try_state::<ScreenMemoryState>().and_then(|state| {
            state
                .inner
                .lock()
                .ok()
                .and_then(|mut runtime| runtime.ocr_queue.pop_front())
        }) {
            Some(job) => job,
            None => {
                if let Some(state) = app.try_state::<ScreenMemoryState>() {
                    if let Ok(mut runtime) = state.inner.lock() {
                        runtime.ocr_worker_running = false;
                    }
                }
                return;
            }
        };
        let state = app.state::<ScreenMemoryState>();
        let Ok(_indexing) = state.indexing.lock() else {
            return;
        };
        let _ = run_ocr_job(&app, job);
    }
}

fn write_ocr_status(
    app: &AppHandle,
    segment_id: &str,
    status: &crate::screen_memory_ocr::ScreenMemoryOcrIndexStatus,
) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(status)
        .map_err(|err| format!("screen memory OCR status encode failed: {err}"))?;
    std::fs::write(segment_ocr_status_path(app, segment_id)?, data)
        .map_err(|err| format!("screen memory OCR status write failed: {err}"))
}

fn run_ocr_job(app: &AppHandle, job: ScreenMemoryOcrJob) -> Result<(), String> {
    let started_at = now_iso();
    if job.segment.exclusion_tainted {
        return write_ocr_status(
            app,
            &job.segment.id,
            &crate::screen_memory_ocr::ScreenMemoryOcrIndexStatus::skipped(now_iso()),
        );
    }
    if job.segment.corrupt || job.segment.error.is_some() {
        return write_ocr_status(
            app,
            &job.segment.id,
            &crate::screen_memory_ocr::ScreenMemoryOcrIndexStatus::skipped(now_iso()),
        );
    }
    write_ocr_status(
        app,
        &job.segment.id,
        &crate::screen_memory_ocr::ScreenMemoryOcrIndexStatus::indexing(started_at.clone()),
    )?;
    let attempted = crate::screen_memory_ocr::requested_frame_offsets(
        job.segment.duration_ms as u64,
        job.sample_interval_seconds,
    )
    .len();
    match crate::screen_memory_ocr::recognize_segment(
        &job.segment.path,
        &job.segment.id,
        DateTime::parse_from_rfc3339(&job.segment.started_at)
            .map_err(|_| "segment start timestamp unavailable".to_string())?
            .with_timezone(&Utc),
        job.sample_interval_seconds,
    ) {
        Ok(rows) => {
            let rows_path = segment_ocr_rows_path(app, &job.segment.id)?;
            let mut file = File::create(rows_path)
                .map_err(|err| format!("screen memory OCR rows open failed: {err}"))?;
            for row in &rows {
                serde_json::to_writer(&mut file, row)
                    .map_err(|err| format!("screen memory OCR row encode failed: {err}"))?;
                file.write_all(b"\n")
                    .map_err(|err| format!("screen memory OCR row write failed: {err}"))?;
            }
            let result = write_ocr_status(
                app,
                &job.segment.id,
                &crate::screen_memory_ocr::ScreenMemoryOcrIndexStatus::ready(
                    attempted,
                    rows.len(),
                    started_at,
                    now_iso(),
                ),
            );
            let _ = refresh_rewind_chapters(app);
            result
        }
        Err(error) => {
            let result = write_ocr_status(
                app,
                &job.segment.id,
                &crate::screen_memory_ocr::ScreenMemoryOcrIndexStatus::failed(
                    attempted,
                    0,
                    started_at,
                    now_iso(),
                    error,
                ),
            );
            let _ = refresh_rewind_chapters(app);
            result
        }
    }
}

fn enqueue_segment_transcript(app: &AppHandle, segment: ScreenMemorySegmentMetadata) {
    use crate::screen_memory_transcript::ScreenMemoryTranscriptStatus;

    if !segment_transcript_eligible(&segment) {
        if let Err(error) = write_transcript_status(
            app,
            &segment.id,
            &ScreenMemoryTranscriptStatus::skipped(now_iso()),
        ) {
            record_error(app, error);
        }
        return;
    }
    if let Err(error) =
        write_transcript_status(app, &segment.id, &ScreenMemoryTranscriptStatus::pending())
    {
        record_error(app, error);
        return;
    }
    let should_start = app.try_state::<ScreenMemoryState>().is_some_and(|state| {
        state
            .inner
            .lock()
            .map(|mut runtime| {
                if runtime.transcript_cancelled_segments.contains(&segment.id) {
                    return false;
                }
                runtime
                    .transcript_queue
                    .push_back(ScreenMemoryTranscriptJob { segment });
                if runtime.transcript_worker_running {
                    false
                } else {
                    runtime.transcript_worker_running = true;
                    true
                }
            })
            .unwrap_or(false)
    });
    if should_start {
        let app = app.clone();
        std::thread::spawn(move || run_transcript_queue(app));
    }
}

fn segment_derivatives_eligible(segment: &ScreenMemorySegmentMetadata) -> bool {
    !segment.exclusion_tainted
}

fn segment_transcript_eligible(segment: &ScreenMemorySegmentMetadata) -> bool {
    segment.capture_mode == RewindCaptureMode::VisualsAudio
        && segment_derivatives_eligible(segment)
        && !segment.corrupt
        && segment.error.is_none()
        && segment
            .system_audio_path
            .as_ref()
            .is_some_and(|path| path.exists())
        && segment
            .microphone_path
            .as_ref()
            .is_some_and(|path| path.exists())
}

fn run_transcript_queue(app: AppHandle) {
    loop {
        let job = match app.try_state::<ScreenMemoryState>().and_then(|state| {
            state
                .inner
                .lock()
                .ok()
                .and_then(|mut runtime| runtime.transcript_queue.pop_front())
        }) {
            Some(job) => job,
            None => {
                if let Some(state) = app.try_state::<ScreenMemoryState>() {
                    if let Ok(mut runtime) = state.inner.lock() {
                        runtime.transcript_worker_running = false;
                    }
                }
                return;
            }
        };
        if let Some(state) = app.try_state::<ScreenMemoryState>() {
            if let Ok(mut runtime) = state.inner.lock() {
                runtime.transcript_active_segment = Some(job.segment.id.clone());
            }
        }
        let state = app.state::<ScreenMemoryState>();
        let Ok(_indexing) = state.indexing.lock() else {
            return;
        };
        let _ = run_transcript_job(&app, job);
        if let Ok(mut runtime) = state.inner.lock() {
            if let Some(segment_id) = runtime.transcript_active_segment.take() {
                runtime.transcript_cancelled_segments.remove(&segment_id);
            }
        };
    }
}

fn write_transcript_status(
    app: &AppHandle,
    segment_id: &str,
    status: &crate::screen_memory_transcript::ScreenMemoryTranscriptStatus,
) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(status)
        .map_err(|err| format!("screen memory transcript status encode failed: {err}"))?;
    let state = app.state::<ScreenMemoryState>();
    let runtime = state.inner.lock().map_err(|error| error.to_string())?;
    if runtime.transcript_cancelled_segments.contains(segment_id) {
        return Ok(());
    }
    std::fs::write(segment_transcript_status_path(app, segment_id)?, data)
        .map_err(|err| format!("screen memory transcript status write failed: {err}"))
}

fn write_transcript_rows(
    app: &AppHandle,
    segment_id: &str,
    rows: &[crate::screen_memory_transcript::ScreenMemoryTranscriptRow],
) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    let runtime = state.inner.lock().map_err(|error| error.to_string())?;
    if runtime.transcript_cancelled_segments.contains(segment_id) {
        return Ok(());
    }
    let rows_path = segment_transcript_rows_path(app, segment_id)?;
    let mut file = File::create(rows_path)
        .map_err(|err| format!("screen memory transcript rows open failed: {err}"))?;
    for row in rows {
        serde_json::to_writer(&mut file, row)
            .map_err(|err| format!("screen memory transcript row encode failed: {err}"))?;
        file.write_all(b"\n")
            .map_err(|err| format!("screen memory transcript row write failed: {err}"))?;
    }
    Ok(())
}

fn run_transcript_job(app: &AppHandle, job: ScreenMemoryTranscriptJob) -> Result<(), String> {
    use crate::screen_memory_transcript::ScreenMemoryTranscriptStatus;

    // Re-check eligibility after dequeue: retention/deletion and legacy data
    // may have changed while the serialized worker was occupied with OCR.
    if !segment_transcript_eligible(&job.segment) || !job.segment.path.exists() {
        return write_transcript_status(
            app,
            &job.segment.id,
            &ScreenMemoryTranscriptStatus::skipped(now_iso()),
        );
    }
    let started_at = now_iso();
    write_transcript_status(
        app,
        &job.segment.id,
        &ScreenMemoryTranscriptStatus::transcribing(started_at.clone()),
    )?;
    let segment_started_at = match DateTime::parse_from_rfc3339(&job.segment.started_at) {
        Ok(value) => value.with_timezone(&Utc),
        Err(_) => {
            return write_transcript_status(
                app,
                &job.segment.id,
                &ScreenMemoryTranscriptStatus::failed(
                    started_at,
                    now_iso(),
                    "segment start timestamp unavailable",
                ),
            )
        }
    };
    let duration_ms = u64::try_from(job.segment.duration_ms)
        .unwrap_or(crate::screen_memory_transcript::MAX_DURATION_MS.saturating_add(1));
    let mut rows = Vec::new();
    for (path, source) in [
        (job.segment.system_audio_path.as_ref(), "system-audio"),
        (job.segment.microphone_path.as_ref(), "microphone"),
    ] {
        let Some(path) = path else {
            return write_transcript_status(
                app,
                &job.segment.id,
                &ScreenMemoryTranscriptStatus::failed(
                    started_at,
                    now_iso(),
                    format!("{source} sidecar is unavailable"),
                ),
            );
        };
        match crate::screen_memory_transcript::transcribe_segment(
            app,
            path,
            &job.segment.id,
            source,
            0,
            segment_started_at,
            duration_ms,
            None,
        ) {
            Ok(mut source_rows) => rows.append(&mut source_rows),
            Err(error) => {
                return write_transcript_status(
                    app,
                    &job.segment.id,
                    &ScreenMemoryTranscriptStatus::failed(started_at, now_iso(), error),
                )
            }
        }
    }
    rows.sort_by_key(|row| (row.start_ms, row.end_ms, row.source.clone()));
    write_transcript_rows(app, &job.segment.id, &rows)?;
    let result = write_transcript_status(
        app,
        &job.segment.id,
        &ScreenMemoryTranscriptStatus::ready(rows.len(), started_at, now_iso()),
    );
    let _ = refresh_rewind_chapters(app);
    result
}

fn write_segment_metadata(
    app: &AppHandle,
    segment: &ScreenMemorySegmentMetadata,
) -> Result<(), String> {
    let path = segment_metadata_path(app, &segment.id)?;
    let data = serde_json::to_vec_pretty(segment)
        .map_err(|e| format!("screen memory metadata encode failed: {e}"))?;
    std::fs::write(path, data).map_err(|e| format!("screen memory metadata write failed: {e}"))?;
    crate::rewind_clip::pin_finalized_segment_if_active(app, segment)?;
    enqueue_segment_transcript(app, segment.clone());
    refresh_rewind_chapters(app)?;
    Ok(())
}

fn refresh_rewind_chapters(app: &AppHandle) -> Result<(), String> {
    let events = read_screen_memory_events(app)?;
    crate::rewind_chapters::rebuild(
        &screen_memory_dir(app)?,
        recent_segments(app, None)?,
        events,
    )
}

fn read_screen_memory_events(app: &AppHandle) -> Result<Vec<ScreenMemoryEvent>, String> {
    let path = screen_memory_events_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(path).map_err(|e| format!("screen memory events open failed: {e}"))?;
    Ok(BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect())
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

/// All finalized local segments, newest metadata included. This intentionally
/// exposes no mutation or upload behavior; bounded local consumers apply their
/// own coverage and privacy checks before reading adjacent indexes.
pub(crate) fn finalized_segments(
    app: &AppHandle,
) -> Result<Vec<ScreenMemorySegmentMetadata>, String> {
    recent_segments(app, None)
}

/// Finalized logical segments overlapping a shared capture-graph interval.
/// This is local metadata only; callers must pin before assembling an artifact.
pub(crate) fn finalized_segments_in_graph_interval(
    app: &AppHandle,
    started_elapsed_ms: u64,
    ended_elapsed_ms: u64,
) -> Result<Vec<ScreenMemorySegmentMetadata>, String> {
    if ended_elapsed_ms < started_elapsed_ms {
        return Ok(Vec::new());
    }
    let current_epoch = graph_epoch_id(app);
    recent_segments(app, None).map(|segments| {
        segments
            .into_iter()
            .filter(|segment| {
                segment_overlaps_graph_interval(
                    segment,
                    &current_epoch,
                    started_elapsed_ms,
                    ended_elapsed_ms,
                )
            })
            .collect()
    })
}

fn segment_overlaps_graph_interval(
    segment: &ScreenMemorySegmentMetadata,
    current_epoch: &str,
    started_elapsed_ms: u64,
    ended_elapsed_ms: u64,
) -> bool {
    segment.graph_epoch_id.as_deref() == Some(current_epoch)
        && segment.graph_started_elapsed_ms <= ended_elapsed_ms
        && segment.graph_ended_elapsed_ms >= started_elapsed_ms
}

/// Keep a finalized local segment from retention pruning while an in-flight
/// artifact copies it. Pin state is intentionally process-local.
pub(crate) fn pin_segment(app: &AppHandle, segment_id: &str, pin_id: &str) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
    runtime
        .segment_pins
        .entry(sanitize_segment_id(segment_id))
        .or_default()
        .insert(pin_id.to_owned());
    Ok(())
}

pub(crate) fn unpin_segment(app: &AppHandle, segment_id: &str, pin_id: &str) -> Result<(), String> {
    let state = app.state::<ScreenMemoryState>();
    let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
    let segment_id = sanitize_segment_id(segment_id);
    if let Some(pins) = runtime.segment_pins.get_mut(&segment_id) {
        pins.remove(pin_id);
        if pins.is_empty() {
            runtime.segment_pins.remove(&segment_id);
        }
    }
    Ok(())
}

fn segment_is_pinned(app: &AppHandle, segment_id: &str) -> bool {
    app.try_state::<ScreenMemoryState>()
        .and_then(|state| {
            state.inner.lock().ok().map(|runtime| {
                runtime
                    .segment_pins
                    .get(segment_id)
                    .is_some_and(|pins| !pins.is_empty())
            })
        })
        .unwrap_or(false)
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
    let minutes = minutes.clamp(1, 5);

    let folder = app
        .path()
        .video_dir()
        .map_err(|e| format!("videos directory unavailable: {e}"))?
        .join("Clips")
        .join("Screen Memory")
        .join(Utc::now().format("%Y-%m-%d-%H%M%S").to_string());
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("screen memory export folder unavailable: {e}"))?;
    let file_name = format!("previous-{minutes}-minutes.mp4");
    let destination = folder.join(&file_name);
    let artifact = match crate::rewind_clip::materialize_recent_exact(
        app,
        Duration::from_secs(minutes * 60),
        destination.clone(),
    ) {
        Ok(artifact) => artifact,
        Err(error) => {
            let _ = std::fs::remove_dir(&folder);
            return Err(error);
        }
    };
    let bytes = std::fs::metadata(&artifact.path)
        .map_err(|e| format!("screen memory export metadata failed: {e}"))?
        .len();
    let files = vec![ScreenMemoryExportFile {
        path: artifact.path.to_string_lossy().to_string(),
        file_name,
        bytes,
        mime_type: artifact.mime_type.to_string(),
    }];

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
        if (expired || kept_bytes > config.max_bytes) && !segment_is_pinned(app, &segment.id) {
            let _ = delete_segment(app, &segment.id);
        }
    }
    prune_events(app, cutoff)?;
    refresh_rewind_chapters(app)?;
    Ok(())
}

fn prune_events(app: &AppHandle, cutoff: DateTime<Utc>) -> Result<(), String> {
    let path = screen_memory_events_path(app)?;
    if !path.exists() {
        return Ok(());
    }
    let file = File::open(&path).map_err(|e| format!("screen memory events open failed: {e}"))?;
    let retained = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<ScreenMemoryEvent>(&line).ok())
        .collect::<Vec<_>>();
    let mut coverage = recent_segments(app, None)?
        .into_iter()
        .filter_map(|segment| {
            Some((
                DateTime::parse_from_rfc3339(&segment.started_at)
                    .ok()?
                    .with_timezone(&Utc),
                DateTime::parse_from_rfc3339(&segment.ended_at)
                    .ok()?
                    .with_timezone(&Utc),
            ))
        })
        .collect::<Vec<_>>();
    if let Some(active) = app
        .state::<ScreenMemoryState>()
        .inner
        .lock()
        .ok()
        .and_then(|runtime| {
            runtime
                .active
                .as_ref()
                .map(|active| active.started_at_iso.clone())
        })
        .and_then(|started_at| DateTime::parse_from_rfc3339(&started_at).ok())
    {
        coverage.push((active.with_timezone(&Utc), Utc::now()));
    }
    let retained = retain_events_with_media_coverage(retained, cutoff, &coverage);
    let temporary_path = path.with_extension("jsonl.tmp");
    let mut file = File::create(&temporary_path)
        .map_err(|e| format!("screen memory events rewrite failed: {e}"))?;
    for event in retained {
        serde_json::to_writer(&mut file, &event)
            .map_err(|e| format!("screen memory event encode failed: {e}"))?;
        file.write_all(b"\n")
            .map_err(|e| format!("screen memory event write failed: {e}"))?;
    }
    std::fs::rename(&temporary_path, &path)
        .map_err(|e| format!("screen memory events replace failed: {e}"))
}

fn retain_events_since(
    events: Vec<ScreenMemoryEvent>,
    cutoff: DateTime<Utc>,
) -> Vec<ScreenMemoryEvent> {
    events
        .into_iter()
        .filter(|event| {
            DateTime::parse_from_rfc3339(&event.captured_at)
                .map(|captured_at| captured_at.with_timezone(&Utc) >= cutoff)
                .unwrap_or(false)
        })
        .collect()
}

fn retain_events_with_media_coverage(
    events: Vec<ScreenMemoryEvent>,
    cutoff: DateTime<Utc>,
    coverage: &[(DateTime<Utc>, DateTime<Utc>)],
) -> Vec<ScreenMemoryEvent> {
    retain_events_since(events, cutoff)
        .into_iter()
        .filter(|event| {
            if event.source == "coverage-gap" {
                return true;
            }
            let Ok(captured_at) = DateTime::parse_from_rfc3339(&event.captured_at) else {
                return false;
            };
            let captured_at = captured_at.with_timezone(&Utc);
            coverage.iter().any(|(started_at, ended_at)| {
                captured_at >= *started_at && captured_at <= *ended_at
            })
        })
        .collect()
}

fn delete_segment(app: &AppHandle, segment_id: &str) -> Result<ScreenMemoryDeleteResult, String> {
    if let Some(state) = app.try_state::<ScreenMemoryState>() {
        if let Ok(mut runtime) = state.inner.lock() {
            runtime
                .transcript_queue
                .retain(|job| job.segment.id != segment_id);
            if runtime.transcript_active_segment.as_deref() == Some(segment_id) {
                runtime
                    .transcript_cancelled_segments
                    .insert(segment_id.to_owned());
            }
        }
    }
    let metadata_path = segment_metadata_path(app, segment_id)?;
    let segment = read_segment_metadata_path(&metadata_path).ok();
    let mut deleted_segments = 0_usize;
    let mut deleted_bytes = 0_u64;
    if let Some(segment) = segment {
        deleted_bytes = segment.bytes;
        remove_file_if_exists(&segment.path)?;
        if let Some(path) = segment.system_audio_path.as_ref() {
            remove_file_if_exists(path)?;
        }
        if let Some(path) = segment.microphone_path.as_ref() {
            remove_file_if_exists(path)?;
        }
        deleted_segments = 1;
    }
    remove_file_if_exists(&metadata_path)?;
    remove_file_if_exists(&segment_ocr_rows_path(app, segment_id)?)?;
    remove_file_if_exists(&segment_ocr_status_path(app, segment_id)?)?;
    remove_transcript_sidecars(&screen_memory_dir(app)?, segment_id)?;
    refresh_rewind_chapters(app)?;
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
        if let Some(path) = segment.system_audio_path.as_ref() {
            remove_file_if_exists(path)?;
        }
        if let Some(path) = segment.microphone_path.as_ref() {
            remove_file_if_exists(path)?;
        }
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
    crate::rewind_chapters::clear(&dir)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_agent_connection_replaces_only_its_own_mcp_footprint() {
        let existing = r#"model = "gpt-5.6"

[mcp_servers."clips-screen-memory"]
command = "old"
args = ["old"]

[mcp_servers."clips-screen-memory".env]
OLD = "value"

[mcp_servers.other]
command = "keep"
"#;
        let block = codex_screen_memory_block(Path::new("/tmp/Clips Alpha/screen-memory"));
        let next = replace_codex_screen_memory_block(existing, &block);
        assert_eq!(next.matches("clips-screen-memory").count(), 1);
        assert!(!next.contains("OLD"));
        assert!(next.contains("[mcp_servers.other]"));
        assert!(next.contains("/tmp/Clips Alpha/screen-memory"));
        assert!(next.contains("@agent-native/core@latest"));
    }

    #[test]
    fn codex_agent_connection_appends_to_an_existing_config() {
        let block = codex_screen_memory_block(Path::new("/tmp/screen-memory"));
        let next = replace_codex_screen_memory_block("model = \"gpt-5.6\"\n", &block);
        assert!(next.starts_with("model = \"gpt-5.6\""));
        assert!(next.contains("command = \"npx\""));
        assert!(next.contains("mcp\", \"screen-memory"));
    }

    fn event(captured_at: &str) -> ScreenMemoryEvent {
        ScreenMemoryEvent {
            captured_at: captured_at.to_string(),
            app_name: Some("Example".to_string()),
            window_title: Some("Example window".to_string()),
            bundle_id: Some("example.app".to_string()),
            source: "test".to_string(),
            coverage_gap_reason: None,
            accessibility: None,
        }
    }

    #[test]
    fn normalizes_bounds_and_excluded_bundle_ids() {
        let config = normalize_screen_memory_config(ScreenMemoryConfig {
            retention_hours: 100,
            max_bytes: 1,
            segment_seconds: 1,
            sample_interval_seconds: 100,
            excluded_bundle_ids: vec![
                " COM.Example.Secret ".to_string(),
                "com.example.secret".to_string(),
                " ".to_string(),
            ],
            ..ScreenMemoryConfig::default()
        });

        assert_eq!(config.retention_hours, MAX_RETENTION_HOURS);
        assert_eq!(config.max_bytes, MIN_MAX_BYTES);
        assert_eq!(config.segment_seconds, MIN_SEGMENT_SECONDS);
        assert_eq!(config.sample_interval_seconds, MIN_SEGMENT_SECONDS);
        assert_eq!(config.excluded_bundle_ids, vec!["com.example.secret"]);
    }

    #[test]
    fn excludes_bundle_ids_without_retaining_context() {
        let config = ScreenMemoryConfig::default();
        assert_eq!(
            event_exclusion_reason(&config, Some("COM.1PASSWORD.1PASSWORD"), Some("vault")),
            Some("excluded-bundle-id")
        );
        assert_eq!(
            event_exclusion_reason(
                &config,
                Some("com.example.browser"),
                Some("Search - Incognito")
            ),
            None
        );
        let gap = coverage_gap_event("privacy-exclusion");
        assert_eq!(gap.source, "coverage-gap");
        assert_eq!(
            gap.coverage_gap_reason.as_deref(),
            Some("privacy-exclusion")
        );
        assert!(gap.app_name.is_none() && gap.window_title.is_none() && gap.bundle_id.is_none());
        assert!(gap.accessibility.is_none());
    }

    #[test]
    fn old_event_jsonl_lines_parse_without_accessibility() {
        let event: ScreenMemoryEvent = serde_json::from_str(
            r#"{"capturedAt":"2026-07-18T12:00:00Z","appName":"Mail","windowTitle":"Inbox","bundleId":"com.apple.mail","source":"core-graphics"}"#,
        )
        .expect("old event line remains readable");
        assert_eq!(event.app_name.as_deref(), Some("Mail"));
        assert!(event.coverage_gap_reason.is_none());
        assert!(event.accessibility.is_none());
    }

    #[test]
    fn recognized_exclusion_transitions_suspend_stay_suspended_and_resume() {
        assert_eq!(
            exclusion_transition(false, false),
            ExclusionTransition::KeepCapturing
        );
        assert_eq!(
            exclusion_transition(false, true),
            ExclusionTransition::Suspend
        );
        assert_eq!(
            exclusion_transition(true, true),
            ExclusionTransition::StaySuspended
        );
        assert_eq!(
            exclusion_transition(true, false),
            ExclusionTransition::Resume
        );
    }

    #[test]
    fn exclusion_resume_requires_one_stopped_producer_and_safe_live_config() {
        assert!(exclusion_resume_allowed(
            true, false, false, false, true, false
        ));
        assert!(!exclusion_resume_allowed(
            true, false, false, false, true, true
        ));
        assert!(!exclusion_resume_allowed(
            true, false, false, true, true, false
        ));
        assert!(!exclusion_resume_allowed(
            true, true, false, false, true, false
        ));
        assert!(!exclusion_resume_allowed(
            true, false, true, false, true, false
        ));
    }

    #[test]
    fn exclusion_gap_covers_discarded_segment_start_and_every_effective_source() {
        let started_at = Instant::now() - Duration::from_secs(7);
        let gap = active_exclusion_gap(started_at, RewindCaptureMode::VisualsAudio);
        assert_eq!(gap.started_at, started_at);
        assert_eq!(
            gap.sources,
            vec![
                CaptureSource::Screen,
                CaptureSource::SystemAudio,
                CaptureSource::Microphone
            ]
        );
    }

    #[test]
    fn discarded_segment_sidecars_are_removed_as_one_retention_unit() {
        let dir = std::env::temp_dir().join(format!(
            "clips-exclusion-discard-{}-{}",
            std::process::id(),
            SEGMENT_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let paths: Vec<_> = [
            "segment.json",
            "segment.ocr.jsonl",
            "segment.ocr-status.json",
            "segment.transcript.jsonl",
            "segment.transcript-status.json",
        ]
        .into_iter()
        .map(|name| dir.join(name))
        .collect();
        for path in &paths {
            std::fs::write(path, b"private-derived-data").unwrap();
        }

        remove_discarded_sidecars(&paths).unwrap();

        assert!(paths.iter().all(|path| !path.exists()));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn segment_metadata_preserves_exclusion_taint_and_defaults_legacy_rows() {
        let tainted: ScreenMemorySegmentMetadata = serde_json::from_value(serde_json::json!({
            "id": "segment-1", "path": "/tmp/segment.mp4", "fileName": "segment.mp4",
            "mimeType": "video/mp4", "startedAt": "2026-07-14T12:00:00Z",
            "endedAt": "2026-07-14T12:01:00Z", "durationMs": 60000, "width": 1,
            "height": 1, "bytes": 1, "corrupt": false, "error": null,
            "exclusionTainted": true
        }))
        .unwrap();
        assert!(tainted.exclusion_tainted);
        assert_eq!(tainted.graph_started_elapsed_ms, 0);
        assert_eq!(tainted.graph_ended_elapsed_ms, 0);
        assert_eq!(tainted.capture_mode, RewindCaptureMode::Visuals);

        let legacy: ScreenMemorySegmentMetadata = serde_json::from_value(serde_json::json!({
            "id": "segment-2", "path": "/tmp/segment.mp4", "fileName": "segment.mp4",
            "mimeType": "video/mp4", "startedAt": "2026-07-14T12:00:00Z",
            "endedAt": "2026-07-14T12:01:00Z", "durationMs": 60000, "width": null,
            "height": null, "bytes": 1, "corrupt": false, "error": null
        }))
        .unwrap();
        assert!(!legacy.exclusion_tainted);
        assert_eq!(legacy.capture_mode, RewindCaptureMode::Visuals);
        assert_eq!(legacy.graph_epoch_id, None);
        assert_eq!(legacy.graph_started_elapsed_ms, 0);
        assert_eq!(legacy.graph_ended_elapsed_ms, 0);

        let mut current = legacy.clone();
        current.graph_epoch_id = Some("current-epoch".into());
        current.graph_started_elapsed_ms = 100;
        current.graph_ended_elapsed_ms = 200;
        assert!(segment_overlaps_graph_interval(
            &current,
            "current-epoch",
            150,
            250
        ));
        assert!(!segment_overlaps_graph_interval(
            &current,
            "stale-epoch",
            150,
            250
        ));
        assert!(!segment_overlaps_graph_interval(
            &legacy,
            "current-epoch",
            0,
            1
        ));
    }

    #[test]
    fn transcript_lifecycle_only_indexes_clean_visuals_audio_segments() {
        let system = std::env::temp_dir().join(format!(
            "clips-transcript-system-{}.wav",
            std::process::id()
        ));
        let microphone = std::env::temp_dir().join(format!(
            "clips-transcript-microphone-{}.wav",
            std::process::id()
        ));
        std::fs::write(&system, b"audio").unwrap();
        std::fs::write(&microphone, b"audio").unwrap();
        let mut segment: ScreenMemorySegmentMetadata = serde_json::from_value(serde_json::json!({
            "id": "segment-1", "path": "/tmp/segment.mp4", "fileName": "segment.mp4",
            "mimeType": "video/mp4", "startedAt": "2026-07-14T12:00:00Z",
            "endedAt": "2026-07-14T12:01:00Z", "durationMs": 60000, "width": 1,
            "height": 1, "bytes": 1, "corrupt": false, "error": null,
            "captureMode": "visuals-audio",
            "systemAudioPath": system.clone(),
            "microphonePath": microphone.clone()
        }))
        .unwrap();
        assert!(segment_transcript_eligible(&segment));
        segment.exclusion_tainted = true;
        assert!(!segment_derivatives_eligible(&segment));
        assert!(!segment_transcript_eligible(&segment));
        segment.exclusion_tainted = false;
        segment.corrupt = true;
        assert!(!segment_transcript_eligible(&segment));
        segment.corrupt = false;
        segment.error = Some("capture failed".into());
        assert!(!segment_transcript_eligible(&segment));
        segment.error = None;
        segment.capture_mode = RewindCaptureMode::Visuals;
        assert!(!segment_transcript_eligible(&segment));
        let _ = std::fs::remove_file(system);
        let _ = std::fs::remove_file(microphone);
    }

    #[test]
    fn status_explains_recognized_media_exclusion_and_coverage_gap() {
        let config = ScreenMemoryConfig {
            enabled: true,
            paused: false,
            ..ScreenMemoryConfig::default()
        };
        let coverage = coverage_language(&config, true, false);
        assert!(coverage.contains("entire in-flight media segment was discarded"));
        assert!(coverage.contains("source coverage gap"));
    }

    #[test]
    fn transcript_sidecars_are_deleted_together() {
        let dir = std::env::temp_dir().join(format!(
            "clips-transcript-sidecars-{}-{}",
            std::process::id(),
            SEGMENT_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let (rows, status) = transcript_sidecar_paths(&dir, "segment/one");
        std::fs::write(&rows, b"{}\n").unwrap();
        std::fs::write(&status, b"{}").unwrap();
        remove_transcript_sidecars(&dir, "segment/one").unwrap();
        assert!(!rows.exists());
        assert!(!status.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn retains_only_parseable_events_within_the_retention_window() {
        let cutoff = DateTime::parse_from_rfc3339("2026-07-14T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let events = retain_events_since(
            vec![
                event("2026-07-14T11:59:59Z"),
                event("2026-07-14T12:00:00Z"),
                event("not-a-date"),
            ],
            cutoff,
        );

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].captured_at, "2026-07-14T12:00:00Z");
    }

    #[test]
    fn app_context_is_pruned_with_media_while_coverage_gaps_remain_visible() {
        let cutoff = DateTime::parse_from_rfc3339("2026-07-14T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let coverage = [(
            DateTime::parse_from_rfc3339("2026-07-14T12:05:00Z")
                .unwrap()
                .with_timezone(&Utc),
            DateTime::parse_from_rfc3339("2026-07-14T12:10:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )];
        let mut gap = event("2026-07-14T12:03:00Z");
        gap.source = "coverage-gap".into();
        let events = retain_events_with_media_coverage(
            vec![
                event("2026-07-14T12:02:00Z"),
                gap,
                event("2026-07-14T12:06:00Z"),
            ],
            cutoff,
            &coverage,
        );

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].source, "coverage-gap");
        assert_eq!(events[1].captured_at, "2026-07-14T12:06:00Z");
    }

    #[test]
    fn temporary_audio_refcounts_restore_the_persisted_base_mode() {
        assert_eq!(
            effective_mode(RewindCaptureMode::Visuals, 0),
            RewindCaptureMode::Visuals
        );
        assert_eq!(
            effective_mode(RewindCaptureMode::Visuals, 1),
            RewindCaptureMode::VisualsAudio
        );
        assert_eq!(
            effective_mode(RewindCaptureMode::Visuals, 2),
            RewindCaptureMode::VisualsAudio
        );
        assert_eq!(
            effective_mode(RewindCaptureMode::VisualsAudio, 0),
            RewindCaptureMode::VisualsAudio
        );

        let mut runtime = ScreenMemoryRuntime::default();
        runtime.temporary_audio_consumers.insert(
            "meeting-whisper".into(),
            TemporaryAudioConsumer {
                graph_lease_id: "meeting-lease".into(),
            },
        );
        runtime.temporary_audio_consumers.insert(
            "rewind-clip".into(),
            TemporaryAudioConsumer {
                graph_lease_id: "clip-lease".into(),
            },
        );
        assert_eq!(
            requested_sources(effective_mode(
                RewindCaptureMode::Visuals,
                runtime.temporary_audio_consumers.len()
            )),
            vec![
                CaptureSource::Screen,
                CaptureSource::SystemAudio,
                CaptureSource::Microphone
            ]
        );
        runtime.temporary_audio_consumers.remove("rewind-clip");
        assert_eq!(
            effective_mode(
                RewindCaptureMode::Visuals,
                runtime.temporary_audio_consumers.len()
            ),
            RewindCaptureMode::VisualsAudio
        );
        runtime.temporary_audio_consumers.remove("meeting-whisper");
        assert_eq!(
            effective_mode(
                RewindCaptureMode::Visuals,
                runtime.temporary_audio_consumers.len()
            ),
            RewindCaptureMode::Visuals
        );
    }

    #[test]
    fn temporary_audio_requires_a_live_unpaused_rewind_producer() {
        assert!(temporary_audio_lease_available(
            true, false, true, true, false
        ));
        assert!(!temporary_audio_lease_available(
            false, false, true, true, true
        ));
        assert!(!temporary_audio_lease_available(
            true, true, true, true, true
        ));
        assert!(!temporary_audio_lease_available(
            true, false, false, true, true
        ));
        assert!(!temporary_audio_lease_available(
            true, false, true, false, false
        ));
    }
}
