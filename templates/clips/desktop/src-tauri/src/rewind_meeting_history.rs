use crate::capture_graph::{CaptureConsumer, CaptureSource};
use crate::config::RewindCaptureMode;
use crate::screen_memory::{self, ScreenMemoryRuntimeState, ScreenMemorySegmentMetadata};
use crate::screen_memory_transcript::{
    ScreenMemoryTranscriptRow, ScreenMemoryTranscriptState, ScreenMemoryTranscriptStatus,
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const COVERAGE_TOLERANCE_MS: i64 = 2_500;
const MAX_MEETING_HISTORY_HOURS: i64 = 8;
const INDEX_WAIT_TIMEOUT: Duration = Duration::from_secs(45);
const INDEX_POLL_INTERVAL: Duration = Duration::from_millis(200);
// Notes collect within seconds of transcription starting. A Whisper model download can hold
// that start back, so the lifetime counts only while no download runs.
const UNCOLLECTED_REQUEST_LIFETIME: Duration = Duration::from_secs(10 * 60);
const UNCOLLECTED_REQUEST_CHECK_INTERVAL: Duration = Duration::from_secs(30);
static HISTORY_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct RewindMeetingHistoryState {
    requests: Mutex<HashMap<String, PreparedMeetingHistory>>,
}

struct PreparedMeetingHistory {
    waiting_since: Instant,
    scheduled_start: DateTime<Utc>,
    captured_until: DateTime<Utc>,
    segments: Vec<ScreenMemorySegmentMetadata>,
    pin_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindMeetingHistoryAvailability {
    pub available: bool,
    pub reason: Option<String>,
    pub covered_from: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindMeetingTranscriptSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindMeetingHistoryResult {
    pub scheduled_start: String,
    pub captured_until: String,
    pub segments: Vec<RewindMeetingTranscriptSegment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindMeetingHistoryPrepared {
    pub token: String,
    pub scheduled_start: String,
    pub captured_until: String,
}

#[tauri::command]
pub async fn rewind_meeting_history_status(
    app: AppHandle,
    scheduled_start: String,
) -> Result<RewindMeetingHistoryAvailability, String> {
    let requested_start = parse_scheduled_start(&scheduled_start)?;
    availability(&app, requested_start).await
}

#[tauri::command]
pub async fn rewind_meeting_history_prepare(
    app: AppHandle,
    scheduled_start: String,
) -> Result<RewindMeetingHistoryPrepared, String> {
    let requested_start = parse_scheduled_start(&scheduled_start)?;
    let availability = availability(&app, requested_start).await?;
    if !availability.available {
        return Err(availability.reason.unwrap_or_else(|| {
            "Rewind does not have continuous local audio coverage from this meeting's start."
                .to_string()
        }));
    }

    authorize_explicit_meeting_extension(&app, requested_start)?;

    screen_memory::fence_active_for_clip(&app)
        .map_err(|error| format!("Could not include the earlier meeting: {error}"))?;
    let captured_until = Utc::now();

    let segments = relevant_segments(&app, requested_start, captured_until)?;
    validate_continuous_audio_coverage(&segments, requested_start, captured_until)?;
    reject_graph_gaps(&app, requested_start, captured_until)?;
    let token = format!(
        "meeting-history-{}-{}",
        Utc::now().timestamp_millis(),
        HISTORY_REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let pin_id = format!("{token}-segments");
    for segment in &segments {
        if let Err(error) = screen_memory::pin_segment(&app, &segment.id, &pin_id) {
            for pinned in &segments {
                let _ = screen_memory::unpin_segment(&app, &pinned.id, &pin_id);
            }
            return Err(error);
        }
    }
    app.state::<RewindMeetingHistoryState>()
        .requests
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            token.clone(),
            PreparedMeetingHistory {
                waiting_since: Instant::now(),
                scheduled_start: requested_start,
                captured_until,
                segments,
                pin_id,
            },
        );
    let sweeper = app.clone();
    let swept_token = token.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(UNCOLLECTED_REQUEST_CHECK_INTERVAL).await;
            if !release_uncollected_requests(&sweeper, &swept_token) {
                break;
            }
        }
    });

    Ok(RewindMeetingHistoryPrepared {
        token,
        scheduled_start: requested_start.to_rfc3339(),
        captured_until: captured_until.to_rfc3339(),
    })
}

#[tauri::command]
pub async fn rewind_meeting_history_collect(
    app: AppHandle,
    token: String,
) -> Result<RewindMeetingHistoryResult, String> {
    let prepared = take_prepared_request(&app, &token)?.ok_or_else(|| {
        "This prepared meeting-history request is no longer available.".to_string()
    })?;

    let result = async {
        wait_for_local_indexes(&app, &prepared.segments).await?;

        let mut rows = Vec::new();
        for segment in &prepared.segments {
            rows.extend(read_transcript_rows(&app, &segment.id)?);
        }
        let mut mapped =
            map_rows_to_meeting_timeline(rows, prepared.scheduled_start, prepared.captured_until);
        mapped.sort_by_key(|row| (row.start_ms, row.end_ms, row.source.clone()));

        Ok(RewindMeetingHistoryResult {
            scheduled_start: prepared.scheduled_start.to_rfc3339(),
            captured_until: prepared.captured_until.to_rfc3339(),
            segments: mapped,
        })
    }
    .await;

    unpin_prepared_segments(&app, &prepared);
    result
}

#[tauri::command]
pub fn rewind_meeting_history_cancel(app: AppHandle, token: String) -> Result<(), String> {
    if let Some(prepared) = take_prepared_request(&app, &token)? {
        unpin_prepared_segments(&app, &prepared);
    }
    Ok(())
}

fn unpin_prepared_segments(app: &AppHandle, prepared: &PreparedMeetingHistory) {
    for segment in &prepared.segments {
        let _ = screen_memory::unpin_segment(app, &segment.id, &prepared.pin_id);
    }
}

// A webview reload or crash between prepare and collect leaves nothing to collect or cancel the
// request, and its pins would keep the earlier audio past Rewind retention until Clips quits.
// Returns whether `token` is still waiting, so its checker knows to keep going.
fn release_uncollected_requests(app: &AppHandle, token: &str) -> bool {
    let requests = &app.state::<RewindMeetingHistoryState>().requests;
    let expired = take_uncollected_requests(
        requests,
        Instant::now(),
        crate::whisper_model::download_in_progress(),
    );
    let expired = match expired {
        Ok(expired) => expired,
        Err(error) => {
            eprintln!("[clips-tray] could not release uncollected meeting history: {error}");
            return false;
        }
    };
    for prepared in &expired {
        unpin_prepared_segments(app, prepared);
    }
    requests
        .lock()
        .map(|requests| requests.contains_key(token))
        .unwrap_or(false)
}

// A meeting that transcribes with Whisper starts only once the model has downloaded, so the
// lifetime counts from the last moment a download was running.
fn take_uncollected_requests(
    requests: &Mutex<HashMap<String, PreparedMeetingHistory>>,
    now: Instant,
    model_downloading: bool,
) -> Result<Vec<PreparedMeetingHistory>, String> {
    let mut requests = requests.lock().map_err(|error| error.to_string())?;
    if model_downloading {
        for prepared in requests.values_mut() {
            prepared.waiting_since = now;
        }
        return Ok(Vec::new());
    }
    let expired = requests
        .iter()
        .filter(|(_, prepared)| {
            now.saturating_duration_since(prepared.waiting_since) >= UNCOLLECTED_REQUEST_LIFETIME
        })
        .map(|(token, _)| token.clone())
        .collect::<Vec<_>>();
    Ok(expired
        .into_iter()
        .filter_map(|token| requests.remove(&token))
        .collect())
}

fn take_prepared_request(
    app: &AppHandle,
    token: &str,
) -> Result<Option<PreparedMeetingHistory>, String> {
    take_from_requests(&app.state::<RewindMeetingHistoryState>().requests, token)
}

// Whoever takes a request owns its pins, so a concurrent collect or cancel cannot unpin segments
// out from under a collector that is still reading them.
fn take_from_requests(
    requests: &Mutex<HashMap<String, PreparedMeetingHistory>>,
    token: &str,
) -> Result<Option<PreparedMeetingHistory>, String> {
    Ok(requests
        .lock()
        .map_err(|error| error.to_string())?
        .remove(token))
}

fn parse_scheduled_start(value: &str) -> Result<DateTime<Utc>, String> {
    let parsed = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "This meeting does not have a valid scheduled start time.".to_string())?
        .with_timezone(&Utc);
    let now = Utc::now();
    if parsed > now + ChronoDuration::minutes(1) {
        return Err("The meeting has not started yet.".to_string());
    }
    if now - parsed > ChronoDuration::hours(MAX_MEETING_HISTORY_HOURS) {
        return Err(format!(
            "Include from meeting start is limited to the previous {MAX_MEETING_HISTORY_HOURS} hours."
        ));
    }
    Ok(parsed)
}

async fn availability(
    app: &AppHandle,
    requested_start: DateTime<Utc>,
) -> Result<RewindMeetingHistoryAvailability, String> {
    let status = screen_memory::screen_memory_status(app.clone()).await?;
    let unavailable = |reason: &str| RewindMeetingHistoryAvailability {
        available: false,
        reason: Some(reason.to_string()),
        covered_from: None,
    };
    if !status.available || !status.config.enabled || status.config.paused {
        return Ok(unavailable(
            "Turn on Rewind before using Include from meeting start.",
        ));
    }
    if status.config.capture_mode != RewindCaptureMode::VisualsAudio {
        return Ok(unavailable(
            "Include from meeting start needs Rewind set to Visuals + audio.",
        ));
    }
    if status.exclusion_active {
        return Ok(unavailable(
            "Rewind is currently stopped for an excluded app.",
        ));
    }
    if !matches!(status.state, ScreenMemoryRuntimeState::Recording) {
        return Ok(unavailable("Rewind is not currently recording."));
    }

    let now = Utc::now();
    let mut segments = screen_memory::finalized_segments(app)?;
    if let Some(active) = status.active_segment {
        let active_start = parse_time(&active.started_at)?;
        if active_start <= requested_start + ChronoDuration::milliseconds(COVERAGE_TOLERANCE_MS)
            && validate_existing_prefix(&mut segments, requested_start, active_start).is_ok()
        {
            let covered_from = earliest_coverage_start(&segments)
                .unwrap_or(active_start)
                .to_rfc3339();
            if reject_graph_gaps(app, requested_start, now).is_err() {
                return Ok(unavailable(
                    "Rewind recorded a source coverage gap after this meeting started.",
                ));
            }
            return Ok(RewindMeetingHistoryAvailability {
                available: true,
                reason: None,
                covered_from: Some(covered_from),
            });
        }
        if active_start <= now
            && validate_existing_prefix(&mut segments, requested_start, active_start).is_ok()
        {
            let covered_from = earliest_coverage_start(&segments)
                .unwrap_or(active_start)
                .to_rfc3339();
            if reject_graph_gaps(app, requested_start, now).is_err() {
                return Ok(unavailable(
                    "Rewind recorded a source coverage gap after this meeting started.",
                ));
            }
            return Ok(RewindMeetingHistoryAvailability {
                available: true,
                reason: None,
                covered_from: Some(covered_from),
            });
        }
    }
    Ok(unavailable(
        "Rewind does not have continuous local audio coverage from this meeting's start.",
    ))
}

fn authorize_explicit_meeting_extension(
    app: &AppHandle,
    requested_start: DateTime<Utc>,
) -> Result<(), String> {
    let age = (Utc::now() - requested_start)
        .to_std()
        .map_err(|_| "The scheduled meeting start is in the future.".to_string())?;
    let now = Instant::now();
    let requested_instant = now.checked_sub(age).unwrap_or(now);
    let graph = app.state::<crate::capture_graph::CaptureGraphState>();
    let mut graph = graph.0.lock().map_err(|error| error.to_string())?;
    let lease = graph
        .start_consumer(
            CaptureConsumer::Meeting,
            [CaptureSource::SystemAudio, CaptureSource::Microphone],
        )
        .map_err(|error| error.to_string())?;
    if let Err(error) = graph.extend_retrospectively_to_start(&lease.id, requested_instant) {
        let _ = graph.end_consumer(&lease.id);
        return Err(error.to_string());
    }
    graph
        .end_consumer(&lease.id)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_existing_prefix(
    segments: &mut Vec<ScreenMemorySegmentMetadata>,
    requested_start: DateTime<Utc>,
    active_start: DateTime<Utc>,
) -> Result<(), String> {
    let mut relevant = segments
        .iter()
        .filter_map(|segment| {
            let start = parse_time(&segment.started_at).ok()?;
            let end = parse_time(&segment.ended_at).ok()?;
            (end >= requested_start && start <= active_start).then_some(segment.clone())
        })
        .collect::<Vec<_>>();
    relevant.sort_by_key(|segment| segment.started_at.clone());
    if relevant.is_empty() {
        if active_start <= requested_start + ChronoDuration::milliseconds(COVERAGE_TOLERANCE_MS) {
            return Ok(());
        }
        return Err("missing local coverage".to_string());
    }
    validate_continuous_audio_coverage(&relevant, requested_start, active_start)
}

fn earliest_coverage_start(segments: &[ScreenMemorySegmentMetadata]) -> Option<DateTime<Utc>> {
    segments
        .iter()
        .filter_map(|segment| parse_time(&segment.started_at).ok())
        .min()
}

fn relevant_segments(
    app: &AppHandle,
    requested_start: DateTime<Utc>,
    captured_until: DateTime<Utc>,
) -> Result<Vec<ScreenMemorySegmentMetadata>, String> {
    let mut segments = screen_memory::finalized_segments(app)?
        .into_iter()
        .filter_map(|segment| {
            let start = parse_time(&segment.started_at).ok()?;
            let end = parse_time(&segment.ended_at).ok()?;
            (end >= requested_start && start <= captured_until).then_some(segment)
        })
        .collect::<Vec<_>>();
    segments.sort_by_key(|segment| segment.started_at.clone());
    Ok(segments)
}

fn validate_continuous_audio_coverage(
    segments: &[ScreenMemorySegmentMetadata],
    requested_start: DateTime<Utc>,
    captured_until: DateTime<Utc>,
) -> Result<(), String> {
    let first = segments.first().ok_or_else(|| {
        "Rewind has no finalized local audio for the requested meeting range.".to_string()
    })?;
    let first_start = parse_time(&first.started_at)?;
    if first_start > requested_start + ChronoDuration::milliseconds(COVERAGE_TOLERANCE_MS) {
        return Err("Rewind coverage begins after the scheduled meeting start.".to_string());
    }
    let mut prior_end = requested_start;
    for segment in segments {
        if segment.corrupt || segment.exclusion_tainted || !segment.path.exists() {
            return Err(
                "Rewind found an incomplete or privacy-excluded segment in the requested range."
                    .to_string(),
            );
        }
        if segment.capture_mode != RewindCaptureMode::VisualsAudio {
            return Err("Part of this meeting was captured without audio.".to_string());
        }
        let start = parse_time(&segment.started_at)?;
        let end = parse_time(&segment.ended_at)?;
        if start > prior_end + ChronoDuration::milliseconds(COVERAGE_TOLERANCE_MS) {
            return Err("Rewind has a coverage gap after the meeting started.".to_string());
        }
        if end > prior_end {
            prior_end = end;
        }
    }
    if prior_end + ChronoDuration::milliseconds(COVERAGE_TOLERANCE_MS) < captured_until {
        return Err(
            "Rewind could not finalize audio through the moment notes started.".to_string(),
        );
    }
    Ok(())
}

fn reject_graph_gaps(
    app: &AppHandle,
    requested_start: DateTime<Utc>,
    captured_until: DateTime<Utc>,
) -> Result<(), String> {
    let graph = app.state::<crate::capture_graph::CaptureGraphState>();
    let status = graph
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .status_at(Instant::now())
        .map_err(|error| error.to_string())?;
    for gap in status.coverage_gaps {
        let start = parse_time(&gap.interval.started_at)?;
        let end = parse_time(&gap.interval.ended_at)?;
        if start < captured_until && end > requested_start {
            return Err("Rewind recorded a source coverage gap during this meeting.".to_string());
        }
    }
    Ok(())
}

async fn wait_for_local_indexes(
    app: &AppHandle,
    segments: &[ScreenMemorySegmentMetadata],
) -> Result<(), String> {
    let deadline = Instant::now() + INDEX_WAIT_TIMEOUT;
    loop {
        let mut pending = false;
        for segment in segments {
            let status = read_transcript_status(app, &segment.id)?;
            match status.state {
                ScreenMemoryTranscriptState::Ready => {}
                ScreenMemoryTranscriptState::Pending
                | ScreenMemoryTranscriptState::Transcribing => pending = true,
                ScreenMemoryTranscriptState::Failed => {
                    return Err(status.error.unwrap_or_else(|| {
                        "Local transcription failed for part of this meeting.".to_string()
                    }))
                }
                ScreenMemoryTranscriptState::Skipped => {
                    return Err(
                        "Local transcription was unavailable for part of this meeting.".to_string(),
                    )
                }
            }
        }
        if !pending {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("The earlier meeting audio is still being indexed locally. Start notes without including history, or try again in a moment.".to_string());
        }
        tokio::time::sleep(INDEX_POLL_INTERVAL).await;
    }
}

fn screen_memory_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("screen-memory"))
        .map_err(|error| format!("app data directory unavailable: {error}"))
}

fn read_transcript_status(
    app: &AppHandle,
    segment_id: &str,
) -> Result<ScreenMemoryTranscriptStatus, String> {
    let path = screen_memory_dir(app)?.join(format!("{segment_id}.transcript-status.json"));
    let bytes = std::fs::read(&path).map_err(|_| {
        "The earlier meeting audio has not finished indexing locally yet.".to_string()
    })?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "A local transcript status file is malformed.".to_string())
}

fn read_transcript_rows(
    app: &AppHandle,
    segment_id: &str,
) -> Result<Vec<ScreenMemoryTranscriptRow>, String> {
    let path = screen_memory_dir(app)?.join(format!("{segment_id}.transcript.jsonl"));
    read_jsonl(&path)
}

fn read_jsonl<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Vec<T>, String> {
    let file = File::open(path)
        .map_err(|_| "A ready local meeting transcript is missing its rows.".to_string())?;
    BufReader::new(file)
        .lines()
        .filter_map(|line| match line {
            Ok(line) if line.trim().is_empty() => None,
            other => Some(other),
        })
        .map(|line| {
            let line = line.map_err(|error| format!("local transcript read failed: {error}"))?;
            serde_json::from_str(&line)
                .map_err(|_| "A local meeting transcript row is malformed.".to_string())
        })
        .collect()
}

fn map_rows_to_meeting_timeline(
    rows: Vec<ScreenMemoryTranscriptRow>,
    scheduled_start: DateTime<Utc>,
    captured_until: DateTime<Utc>,
) -> Vec<RewindMeetingTranscriptSegment> {
    rows.into_iter()
        .filter_map(|row| {
            let captured_at = parse_time(&row.captured_at).ok()?;
            if captured_at > captured_until
                || captured_at < scheduled_start - ChronoDuration::minutes(1)
            {
                return None;
            }
            let start_ms = (captured_at - scheduled_start).num_milliseconds().max(0) as u64;
            let duration_ms = row.end_ms.saturating_sub(row.start_ms);
            let end_ms = start_ms.saturating_add(duration_ms);
            let source = match row.source.as_str() {
                "system-audio" => "system",
                "microphone" => "mic",
                _ => return None,
            };
            Some(RewindMeetingTranscriptSegment {
                start_ms,
                end_ms,
                text: row.text,
                source: source.to_string(),
            })
        })
        .collect()
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc))
        .map_err(|_| "Rewind found malformed local capture timing metadata.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prepared_request(token: &str, prepared_at: Instant) -> (String, PreparedMeetingHistory) {
        let start = DateTime::parse_from_rfc3339("2026-07-14T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        (
            token.to_string(),
            PreparedMeetingHistory {
                waiting_since: prepared_at,
                scheduled_start: start,
                captured_until: start,
                segments: Vec::new(),
                pin_id: format!("{token}-segments"),
            },
        )
    }

    #[test]
    fn only_one_caller_can_take_a_prepared_request() {
        let requests = Mutex::new(HashMap::from([prepared_request("token", Instant::now())]));

        let first = take_from_requests(&requests, "token").unwrap();
        let second = take_from_requests(&requests, "token").unwrap();

        assert_eq!(first.unwrap().pin_id, "token-segments");
        assert!(second.is_none());
    }

    #[test]
    fn a_request_nothing_collects_is_released_after_ten_minutes() {
        let prepared_at = Instant::now();
        let requests = Mutex::new(HashMap::from([
            prepared_request("abandoned", prepared_at),
            prepared_request("recent", prepared_at + Duration::from_secs(60)),
        ]));
        let expiry = prepared_at + UNCOLLECTED_REQUEST_LIFETIME;

        let released = take_uncollected_requests(&requests, expiry, false).unwrap();

        assert_eq!(released.len(), 1);
        assert_eq!(released[0].pin_id, "abandoned-segments");
        assert!(take_from_requests(&requests, "abandoned")
            .unwrap()
            .is_none());
        assert!(take_from_requests(&requests, "recent").unwrap().is_some());
    }

    #[test]
    fn a_request_is_kept_until_ten_minutes_pass() {
        let prepared_at = Instant::now();
        let requests = Mutex::new(HashMap::from([prepared_request("pending", prepared_at)]));
        let just_before = prepared_at + UNCOLLECTED_REQUEST_LIFETIME - Duration::from_millis(1);

        let released = take_uncollected_requests(&requests, just_before, false).unwrap();

        assert!(released.is_empty());
        assert!(take_from_requests(&requests, "pending").unwrap().is_some());
    }

    #[test]
    fn a_collected_request_is_never_released_again() {
        let prepared_at = Instant::now();
        let requests = Mutex::new(HashMap::from([prepared_request("collected", prepared_at)]));
        let expiry = prepared_at + UNCOLLECTED_REQUEST_LIFETIME;

        let collected = take_from_requests(&requests, "collected").unwrap();
        let released = take_uncollected_requests(&requests, expiry, false).unwrap();

        assert!(collected.is_some());
        assert!(released.is_empty());
    }

    #[test]
    fn a_model_download_restarts_the_ten_minutes() {
        let prepared_at = Instant::now();
        let requests = Mutex::new(HashMap::from([prepared_request("waiting", prepared_at)]));
        let downloading_at = prepared_at + Duration::from_secs(15 * 60);
        let quiet_until = downloading_at + UNCOLLECTED_REQUEST_LIFETIME;
        let just_before = quiet_until - Duration::from_millis(1);

        let during = take_uncollected_requests(&requests, downloading_at, true).unwrap();
        let before = take_uncollected_requests(&requests, just_before, false).unwrap();
        let after = take_uncollected_requests(&requests, quiet_until, false).unwrap();

        assert!(during.is_empty());
        assert!(before.is_empty());
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].pin_id, "waiting-segments");
    }

    #[test]
    fn maps_rows_to_scheduled_meeting_timeline() {
        let scheduled = DateTime::parse_from_rfc3339("2026-07-14T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let rows = vec![ScreenMemoryTranscriptRow {
            schema_version: 1,
            segment_id: "one".to_string(),
            source: "system-audio".to_string(),
            captured_at: "2026-07-14T12:00:03Z".to_string(),
            start_ms: 3_000,
            end_ms: 4_250,
            text: "hello".to_string(),
        }];
        let mapped =
            map_rows_to_meeting_timeline(rows, scheduled, scheduled + ChronoDuration::minutes(1));
        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].start_ms, 3_000);
        assert_eq!(mapped[0].end_ms, 4_250);
        assert_eq!(mapped[0].source, "system");
    }

    #[test]
    fn prepared_history_never_absorbs_rows_after_its_fence() {
        let scheduled = DateTime::parse_from_rfc3339("2026-07-14T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let rows = vec![ScreenMemoryTranscriptRow {
            schema_version: 1,
            segment_id: "replacement-segment".to_string(),
            source: "microphone".to_string(),
            captured_at: "2026-07-14T12:00:11Z".to_string(),
            start_ms: 0,
            end_ms: 1_000,
            text: "already belongs to live capture".to_string(),
        }];
        let mapped =
            map_rows_to_meeting_timeline(rows, scheduled, scheduled + ChronoDuration::seconds(10));
        assert!(mapped.is_empty());
    }
}
