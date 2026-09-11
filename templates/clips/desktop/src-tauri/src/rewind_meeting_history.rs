//! Explicit, local-only meeting transcript recovery from the rolling Rewind.
//!
//! The normal meeting workflow is still authoritative. This command only
//! prepends locally indexed transcript rows when a person deliberately asks to
//! include the scheduled portion they missed before pressing Start notes.

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
static HISTORY_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct RewindMeetingHistoryState {
    requests: Mutex<HashMap<String, PreparedMeetingHistory>>,
}

#[derive(Clone)]
struct PreparedMeetingHistory {
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

    // Close the current logical fragment without stopping the one physical
    // capture producer. Its transcript is queued locally by the normal segment
    // finalization path; no raw media leaves the Mac.
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
                scheduled_start: requested_start,
                captured_until,
                segments,
                pin_id,
            },
        );

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
    let prepared = app
        .state::<RewindMeetingHistoryState>()
        .requests
        .lock()
        .map_err(|error| error.to_string())?
        .get(&token)
        .cloned()
        .ok_or_else(|| {
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

    if let Ok(mut requests) = app.state::<RewindMeetingHistoryState>().requests.lock() {
        requests.remove(&token);
    }
    for segment in &prepared.segments {
        let _ = screen_memory::unpin_segment(&app, &segment.id, &prepared.pin_id);
    }
    result
}

#[tauri::command]
pub fn rewind_meeting_history_cancel(app: AppHandle, token: String) -> Result<(), String> {
    let prepared = app
        .state::<RewindMeetingHistoryState>()
        .requests
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&token);
    if let Some(prepared) = prepared {
        for segment in &prepared.segments {
            let _ = screen_memory::unpin_segment(&app, &segment.id, &prepared.pin_id);
        }
    }
    Ok(())
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

/// Records that this longer-than-a-normal-Clip retrospective range was an
/// explicit scheduled-meeting choice. The graph's dedicated meeting-start API
/// intentionally permits this while ordinary Rewind extensions remain capped
/// at five minutes.
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
