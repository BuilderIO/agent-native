//! First-party, fully local Rewind search and replay.
//!
//! This module reads local indexes inside Clips, returns bounded text-only evidence to the
//! renderer, and never performs a network request. Raw archive paths stay on
//! the Rust side of the command boundary.

use crate::capture_graph::{CaptureGraphState, CaptureSource};
use crate::config::RewindCaptureMode;
use crate::native_screen::{self, NativeAudioSelection, NativeMediaSlice};
use crate::screen_memory::{self, ScreenMemoryEvent, ScreenMemorySegmentMetadata};
use crate::screen_memory_ocr::ScreenMemoryOcrRow;
use crate::screen_memory_transcript::ScreenMemoryTranscriptRow;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

const MAX_QUERY_BYTES: usize = 500;
const DEFAULT_EVIDENCE_LIMIT: usize = 12;
const MAX_EVIDENCE_LIMIT: usize = 20;
const MAX_EXCERPT_BYTES: usize = 600;
const REPLAY_BEFORE_MS: u64 = 5_000;
const REPLAY_AFTER_MS: u64 = 10_000;
const MAX_REPLAY_MS: u64 = 30_000;
const PREVIEW_MAX_FILES: usize = 8;
const PREVIEW_MAX_AGE: Duration = Duration::from_secs(60 * 60);

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
enum LocalEvidenceSource {
    AppContext,
    Transcript,
    Ocr,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindLocalEvidence {
    id: String,
    source_type: LocalEvidenceSource,
    captured_at: String,
    excerpt: String,
    confidence: Option<f32>,
    segment_id: String,
    offset_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindLocalCoverageGap {
    kind: String,
    source: String,
    started_at: Option<String>,
    ended_at: Option<String>,
    detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindLocalCoverage {
    segments_considered: usize,
    transcript_indexes_ready: usize,
    ocr_indexes_ready: usize,
    gaps: Vec<RewindLocalCoverageGap>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindLocalAskResult {
    query: String,
    answer_summary: String,
    evidence: Vec<RewindLocalEvidence>,
    coverage: RewindLocalCoverage,
    confidence: String,
    truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindReplayResult {
    opened: bool,
    segment_id: String,
    offset_ms: u64,
    preview_started_ms: u64,
    preview_ended_ms: u64,
}

#[derive(Clone, Debug)]
struct ScoredEvidence {
    score: usize,
    evidence: RewindLocalEvidence,
}

#[derive(Debug, Deserialize)]
struct IndexStatus {
    state: String,
}

fn bounded_text(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", value[..end].trim_end())
}

fn normalized_terms(query: &str) -> Vec<String> {
    let stop_words = [
        "a", "about", "an", "and", "did", "do", "for", "from", "i", "in", "is", "it", "me", "my",
        "of", "on", "the", "to", "was", "what", "when", "where", "with",
    ];
    let mut terms = query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.len() >= 2)
        .map(str::to_lowercase)
        .filter(|term| !stop_words.contains(&term.as_str()))
        .collect::<Vec<_>>();
    terms.sort();
    terms.dedup();
    if terms.is_empty() {
        let fallback = query.trim().to_lowercase();
        if !fallback.is_empty() {
            terms.push(fallback);
        }
    }
    terms
}

fn match_score(text: &str, terms: &[String]) -> usize {
    let haystack = text.to_lowercase();
    let counts = terms
        .iter()
        .map(|term| haystack.matches(term).count())
        .collect::<Vec<_>>();
    let matched_terms = counts.iter().filter(|count| **count > 0).count();
    let minimum_terms = if terms.len() <= 1 {
        1
    } else {
        terms.len().div_ceil(2)
    };
    if matched_terms < minimum_terms {
        return 0;
    }
    matched_terms * 1_000 + counts.into_iter().sum::<usize>()
}

fn matching_excerpt(text: &str, terms: &[String], max_bytes: usize) -> String {
    let lines = text.lines().collect::<Vec<_>>();
    let Some((best_index, _)) = lines
        .iter()
        .enumerate()
        .map(|(index, line)| (index, match_score(line, terms)))
        .max_by_key(|(_, score)| *score)
        .filter(|(_, score)| *score > 0)
    else {
        return bounded_text(text.trim(), max_bytes);
    };
    let start = best_index.saturating_sub(1);
    let end = (best_index + 2).min(lines.len());
    bounded_text(lines[start..end].join("\n").trim(), max_bytes)
}

fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn event_segment<'a>(
    event: &ScreenMemoryEvent,
    segments: &'a [ScreenMemorySegmentMetadata],
) -> Option<(&'a ScreenMemorySegmentMetadata, u64)> {
    let captured = parse_time(&event.captured_at)?;
    segments.iter().find_map(|segment| {
        let started = parse_time(&segment.started_at)?;
        let ended = parse_time(&segment.ended_at)?;
        if captured < started || captured > ended {
            return None;
        }
        let offset = captured
            .signed_duration_since(started)
            .num_milliseconds()
            .max(0) as u64;
        Some((segment, offset.min(segment.duration_ms as u64)))
    })
}

fn read_jsonl<T: for<'de> Deserialize<'de>>(path: &Path) -> Vec<T> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

fn index_ready(path: &Path) -> bool {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<IndexStatus>(&bytes).ok())
        .is_some_and(|status| status.state == "ready")
}

fn adjacent_path(segment: &ScreenMemorySegmentMetadata, suffix: &str) -> Option<PathBuf> {
    segment
        .path
        .parent()
        .map(|directory| directory.join(format!("{}.{suffix}", segment.id)))
}

fn evidence_id(source: LocalEvidenceSource, segment_id: &str, offset_ms: u64) -> String {
    let source = match source {
        LocalEvidenceSource::AppContext => "app",
        LocalEvidenceSource::Transcript => "transcript",
        LocalEvidenceSource::Ocr => "ocr",
    };
    format!("{source}:{segment_id}:{offset_ms}")
}

fn push_match(
    matches: &mut Vec<ScoredEvidence>,
    terms: &[String],
    source_type: LocalEvidenceSource,
    captured_at: String,
    text: String,
    confidence: Option<f32>,
    segment_id: String,
    offset_ms: u64,
) {
    let score = match_score(&text, terms);
    if score == 0 {
        return;
    }
    matches.push(ScoredEvidence {
        score,
        evidence: RewindLocalEvidence {
            id: evidence_id(source_type, &segment_id, offset_ms),
            source_type,
            captured_at,
            excerpt: matching_excerpt(&text, terms, MAX_EXCERPT_BYTES),
            confidence,
            segment_id,
            offset_ms,
        },
    });
}

fn local_query(
    directory: &Path,
    segments: Vec<ScreenMemorySegmentMetadata>,
    query: &str,
    limit: usize,
    mut gaps: Vec<RewindLocalCoverageGap>,
) -> RewindLocalAskResult {
    let terms = normalized_terms(query);
    let valid_segments = segments
        .into_iter()
        .filter(|segment| {
            segment.path.exists()
                && !segment.corrupt
                && segment.error.is_none()
                && !segment.exclusion_tainted
        })
        .collect::<Vec<_>>();
    let mut matches = Vec::new();

    for event in read_jsonl::<ScreenMemoryEvent>(&directory.join("events.jsonl")) {
        if event.source == "coverage-gap" {
            continue;
        }
        let Some((segment, offset_ms)) = event_segment(&event, &valid_segments) else {
            continue;
        };
        let text = [
            event.app_name.as_deref(),
            event.window_title.as_deref(),
            event.bundle_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" — ");
        push_match(
            &mut matches,
            &terms,
            LocalEvidenceSource::AppContext,
            event.captured_at,
            text,
            None,
            segment.id.clone(),
            offset_ms,
        );
    }

    let mut transcript_ready = 0;
    let mut ocr_ready = 0;
    for segment in &valid_segments {
        let transcript_status = adjacent_path(segment, "transcript-status.json");
        let transcript_rows = adjacent_path(segment, "transcript.jsonl");
        if transcript_status.as_deref().is_some_and(index_ready) {
            transcript_ready += 1;
            if let Some(path) = transcript_rows {
                for row in read_jsonl::<ScreenMemoryTranscriptRow>(&path) {
                    push_match(
                        &mut matches,
                        &terms,
                        LocalEvidenceSource::Transcript,
                        row.captured_at,
                        row.text,
                        None,
                        segment.id.clone(),
                        row.start_ms.min(segment.duration_ms as u64),
                    );
                }
            }
        } else {
            gaps.push(RewindLocalCoverageGap {
                kind: "index".into(),
                source: "transcript".into(),
                started_at: Some(segment.started_at.clone()),
                ended_at: Some(segment.ended_at.clone()),
                detail: "Local transcript is not ready for this segment.".into(),
            });
        }

        let ocr_status = adjacent_path(segment, "ocr-status.json");
        let ocr_rows = adjacent_path(segment, "ocr.jsonl");
        if ocr_status.as_deref().is_some_and(index_ready) {
            ocr_ready += 1;
            if let Some(path) = ocr_rows {
                for row in read_jsonl::<ScreenMemoryOcrRow>(&path) {
                    push_match(
                        &mut matches,
                        &terms,
                        LocalEvidenceSource::Ocr,
                        row.captured_at,
                        row.ocr_text,
                        Some(row.confidence),
                        segment.id.clone(),
                        row.offset_ms.max(0) as u64,
                    );
                }
            }
        } else {
            gaps.push(RewindLocalCoverageGap {
                kind: "index".into(),
                source: "ocr".into(),
                started_at: Some(segment.started_at.clone()),
                ended_at: Some(segment.ended_at.clone()),
                detail: "Local visual index is not ready for this segment.".into(),
            });
        }
    }

    matches.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.evidence.captured_at.cmp(&left.evidence.captured_at))
    });
    let total_matches = matches.len();
    let limit = limit.clamp(1, MAX_EVIDENCE_LIMIT);
    let evidence = matches
        .into_iter()
        .take(limit)
        .map(|item| item.evidence)
        .collect::<Vec<_>>();
    let truncated = total_matches > evidence.len();
    let answer_summary = match evidence.first() {
        Some(_) => format!(
            "Found {total_matches} local match{} in Rewind. The strongest match is shown first; this is search evidence, not a generated conclusion.",
            if total_matches == 1 { "" } else { "es" }
        ),
        None => "No matching local evidence was found in the indexed Rewind coverage. This does not prove the event did not happen; coverage or indexes may be incomplete.".into(),
    };
    let confidence = if evidence.is_empty() {
        "No matching evidence".into()
    } else if gaps.is_empty() && !truncated {
        "Direct local matches; complete for the indexed segments shown".into()
    } else {
        "Direct local matches; incomplete coverage or indexing".into()
    };
    RewindLocalAskResult {
        query: query.to_owned(),
        answer_summary,
        evidence,
        coverage: RewindLocalCoverage {
            segments_considered: valid_segments.len(),
            transcript_indexes_ready: transcript_ready,
            ocr_indexes_ready: ocr_ready,
            gaps,
        },
        confidence,
        truncated,
    }
}

fn graph_coverage_gaps(app: &AppHandle) -> Vec<RewindLocalCoverageGap> {
    let graph_state = app.state::<CaptureGraphState>();
    let Ok(graph) = graph_state.0.lock() else {
        return vec![RewindLocalCoverageGap {
            kind: "capture".into(),
            source: "screen".into(),
            started_at: None,
            ended_at: None,
            detail: "Capture coverage state is unavailable.".into(),
        }];
    };
    let Ok(status) = graph.status_at(std::time::Instant::now()) else {
        return Vec::new();
    };
    status
        .coverage_gaps
        .into_iter()
        .map(|gap| RewindLocalCoverageGap {
            kind: "capture".into(),
            source: match gap.source {
                CaptureSource::Screen => "screen",
                CaptureSource::SystemAudio => "system-audio",
                CaptureSource::Microphone => "microphone",
                CaptureSource::Camera => "camera",
            }
            .into(),
            started_at: Some(gap.interval.started_at),
            ended_at: Some(gap.interval.ended_at),
            detail: format!("Capture gap: {:?}.", gap.reason),
        })
        .collect()
}

#[tauri::command]
pub(crate) fn rewind_local_ask(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<RewindLocalAskResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Ask Rewind needs a question or search phrase.".into());
    }
    if query.len() > MAX_QUERY_BYTES {
        return Err(format!(
            "Ask Rewind queries must be at most {MAX_QUERY_BYTES} bytes."
        ));
    }
    let segments = screen_memory::finalized_segments(&app)?;
    let directory = segments
        .first()
        .and_then(|segment| segment.path.parent().map(Path::to_path_buf))
        .or_else(|| {
            app.path()
                .app_data_dir()
                .ok()
                .map(|path| path.join("screen-memory"))
        })
        .ok_or_else(|| "Rewind storage directory is unavailable.".to_string())?;
    Ok(local_query(
        &directory,
        segments,
        query,
        limit.unwrap_or(DEFAULT_EVIDENCE_LIMIT),
        graph_coverage_gaps(&app),
    ))
}

fn replay_slice(duration_ms: u64, offset_ms: u64) -> Result<(u64, u64), String> {
    if duration_ms == 0 || offset_ms >= duration_ms {
        return Err("Replay moment is outside the retained segment.".into());
    }
    let started_ms = offset_ms.saturating_sub(REPLAY_BEFORE_MS);
    let ended_ms = offset_ms.saturating_add(REPLAY_AFTER_MS).min(duration_ms);
    if ended_ms <= started_ms || ended_ms - started_ms > MAX_REPLAY_MS {
        return Err("Replay moment could not be bounded safely.".into());
    }
    Ok((started_ms, ended_ms))
}

fn cleanup_previews(directory: &Path) {
    let now = SystemTime::now();
    let mut files = std::fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some((
                entry.path(),
                metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            ))
        })
        .collect::<Vec<_>>();
    for (path, modified) in &files {
        if now.duration_since(*modified).unwrap_or_default() > PREVIEW_MAX_AGE {
            let _ = std::fs::remove_file(path);
        }
    }
    files.retain(|(path, _)| path.exists());
    files.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
    for (path, _) in files.into_iter().skip(PREVIEW_MAX_FILES.saturating_sub(1)) {
        let _ = std::fs::remove_file(path);
    }
}

fn slice_overlaps_graph_gap(
    app: &AppHandle,
    segment: &ScreenMemorySegmentMetadata,
    started_ms: u64,
    ended_ms: u64,
) -> bool {
    let selected_start = segment.graph_started_elapsed_ms.saturating_add(started_ms);
    let selected_end = segment.graph_started_elapsed_ms.saturating_add(ended_ms);
    app.state::<CaptureGraphState>()
        .0
        .lock()
        .ok()
        .and_then(|graph| graph.status_at(std::time::Instant::now()).ok())
        .is_some_and(|status| {
            status.coverage_gaps.iter().any(|gap| {
                gap.source == CaptureSource::Screen
                    && gap.interval.started_elapsed_ms < selected_end
                    && gap.interval.ended_elapsed_ms > selected_start
            })
        })
}

fn validate_replay_candidate(
    segment: &ScreenMemorySegmentMetadata,
    overlaps_gap: bool,
) -> Result<(), String> {
    if segment.corrupt || segment.error.is_some() || segment.exclusion_tainted {
        return Err("Replay evidence is corrupt, incomplete, or privacy-tainted.".into());
    }
    if segment.graph_ended_elapsed_ms <= segment.graph_started_elapsed_ms {
        return Err("Replay evidence has no trustworthy capture coverage mapping.".into());
    }
    if overlaps_gap {
        return Err("Replay evidence overlaps a recorded capture gap.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn rewind_replay_moment(
    app: AppHandle,
    segment_id: String,
    offset_ms: u64,
) -> Result<RewindReplayResult, String> {
    if segment_id.trim().is_empty()
        || segment_id.len() > 255
        || !segment_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Replay segment ID is invalid.".into());
    }
    let segment = screen_memory::finalized_segments(&app)?
        .into_iter()
        .find(|segment| segment.id == segment_id)
        .ok_or_else(|| "Replay segment is missing from retained Rewind coverage.".to_string())?;
    let duration_ms = u64::try_from(segment.duration_ms)
        .map_err(|_| "Replay segment duration is invalid.".to_string())?;
    let (started_ms, ended_ms) = replay_slice(duration_ms, offset_ms)?;
    validate_replay_candidate(
        &segment,
        slice_overlaps_graph_gap(&app, &segment, started_ms, ended_ms),
    )?;

    let preview_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("local preview directory unavailable: {error}"))?
        .join("rewind-previews");
    std::fs::create_dir_all(&preview_dir)
        .map_err(|error| format!("local preview directory unavailable: {error}"))?;
    cleanup_previews(&preview_dir);
    let output = preview_dir.join(format!(
        "moment-{}-{}-{}.mp4",
        segment.id,
        offset_ms,
        Utc::now().timestamp_millis()
    ));
    let slice = NativeMediaSlice {
        path: segment.path.clone(),
        system_audio_path: segment.system_audio_path.clone(),
        microphone_path: segment.microphone_path.clone(),
        start_ms: started_ms,
        end_ms: ended_ms,
    };
    let audio = if segment.capture_mode == RewindCaptureMode::VisualsAudio {
        NativeAudioSelection::MixBoth
    } else {
        NativeAudioSelection::None
    };
    let materialized = output.clone();
    tauri::async_runtime::spawn_blocking(move || {
        native_screen::materialize_mp4_slices_exact(&[slice], &materialized, audio)
    })
    .await
    .map_err(|error| format!("local replay worker failed: {error}"))??;

    #[cfg(target_os = "macos")]
    Command::new("/usr/bin/open")
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not open local replay: {error}"))?;
    #[cfg(not(target_os = "macos"))]
    return Err("Local Rewind replay is currently available on macOS.".into());

    Ok(RewindReplayResult {
        opened: true,
        segment_id,
        offset_ms,
        preview_started_ms: started_ms,
        preview_ended_ms: ended_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "clips-rewind-local-{label}-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn segment(directory: &Path, id: &str, tainted: bool) -> ScreenMemorySegmentMetadata {
        let path = directory.join(format!("{id}.mp4"));
        fs::write(&path, b"media").unwrap();
        ScreenMemorySegmentMetadata {
            id: id.into(),
            path,
            file_name: format!("{id}.mp4"),
            mime_type: "video/mp4".into(),
            started_at: "2026-07-14T12:00:00Z".into(),
            ended_at: "2026-07-14T12:05:00Z".into(),
            duration_ms: 300_000,
            width: Some(1920),
            height: Some(1080),
            bytes: 5,
            system_audio_path: None,
            microphone_path: None,
            corrupt: false,
            error: None,
            capture_mode: RewindCaptureMode::Visuals,
            exclusion_tainted: tainted,
            graph_epoch_id: Some("test-epoch".into()),
            graph_started_elapsed_ms: 1_000,
            graph_ended_elapsed_ms: 301_000,
        }
    }

    #[test]
    fn query_matches_all_local_sources_and_stays_bounded() {
        let directory = test_dir("query");
        let segment = segment(&directory, "segment-one", false);
        fs::write(
            directory.join("events.jsonl"),
            r#"{"capturedAt":"2026-07-14T12:00:10Z","appName":"Zoom","windowTitle":"Lilian audience review","bundleId":"us.zoom.xos","source":"accessibility"}
"#,
        )
        .unwrap();
        fs::write(
            directory.join("segment-one.transcript-status.json"),
            r#"{"state":"ready"}"#,
        )
        .unwrap();
        fs::write(
            directory.join("segment-one.transcript.jsonl"),
            r#"{"schemaVersion":1,"segmentId":"segment-one","source":"microphone","capturedAt":"2026-07-14T12:00:20Z","startMs":20000,"endMs":22000,"text":"Lilian explained the audience"}
"#,
        )
        .unwrap();
        fs::write(
            directory.join("segment-one.ocr-status.json"),
            r#"{"state":"ready"}"#,
        )
        .unwrap();
        fs::write(
            directory.join("segment-one.ocr.jsonl"),
            r#"{"schemaVersion":1,"segmentId":"segment-one","capturedAt":"2026-07-14T12:00:30Z","offsetMs":30000,"source":"ocr","ocrText":"Audience segments by Lilian","confidence":0.91,"frameWidth":1920,"frameHeight":1080}
"#,
        )
        .unwrap();

        let result = local_query(&directory, vec![segment], "Lilian audience", 2, vec![]);
        assert_eq!(result.evidence.len(), 2);
        assert!(result.truncated);
        assert_eq!(result.coverage.transcript_indexes_ready, 1);
        assert_eq!(result.coverage.ocr_indexes_ready, 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn renderer_result_has_no_archive_path_field() {
        let directory = test_dir("path-denial");
        let segment = segment(&directory, "secret-segment", false);
        fs::write(
            directory.join("events.jsonl"),
            r#"{"capturedAt":"2026-07-14T12:00:10Z","appName":"Zoom","windowTitle":"needle","bundleId":null,"source":"accessibility"}
"#,
        )
        .unwrap();
        let result = local_query(&directory, vec![segment], "needle", 5, vec![]);
        let json = serde_json::to_value(result).unwrap();
        assert!(json.get("path").is_none());
        assert!(json["evidence"][0].get("path").is_none());
        assert_eq!(json["evidence"][0]["segmentId"], "secret-segment");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn tainted_segments_are_excluded_and_report_no_match() {
        let directory = test_dir("tainted");
        let segment = segment(&directory, "tainted", true);
        fs::write(
            directory.join("events.jsonl"),
            r#"{"capturedAt":"2026-07-14T12:00:10Z","appName":"Secrets","windowTitle":"needle","bundleId":null,"source":"accessibility"}
"#,
        )
        .unwrap();
        let result = local_query(&directory, vec![segment], "needle", 5, vec![]);
        assert!(result.evidence.is_empty());
        assert_eq!(result.coverage.segments_considered, 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn replay_slice_clamps_without_pre_range_leakage() {
        assert_eq!(replay_slice(60_000, 20_000).unwrap(), (15_000, 30_000));
        assert_eq!(replay_slice(60_000, 2_000).unwrap(), (0, 12_000));
        assert_eq!(replay_slice(60_000, 58_000).unwrap(), (53_000, 60_000));
        assert!(replay_slice(60_000, 60_000).is_err());
        assert!(replay_slice(0, 0).is_err());
    }

    #[test]
    fn replay_rejects_invalid_segment_ids_before_path_lookup() {
        for id in ["../segment", "/tmp/archive.mp4", "a b", ""] {
            assert!(
                id.is_empty()
                    || id.len() > 255
                    || !id.chars().all(|character| character.is_ascii_alphanumeric()
                        || matches!(character, '-' | '_'))
            );
        }
    }

    #[test]
    fn replay_rejects_tainted_and_gapped_evidence() {
        let directory = test_dir("replay-rejection");
        let tainted = segment(&directory, "tainted", true);
        assert!(validate_replay_candidate(&tainted, false)
            .unwrap_err()
            .contains("privacy-tainted"));
        let clean = segment(&directory, "clean", false);
        assert!(validate_replay_candidate(&clean, true)
            .unwrap_err()
            .contains("capture gap"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn query_terms_and_excerpts_are_bounded() {
        let oversized = "x".repeat(MAX_EXCERPT_BYTES + 100);
        let bounded = bounded_text(&oversized, MAX_EXCERPT_BYTES);
        assert!(bounded.len() <= MAX_EXCERPT_BYTES + '…'.len_utf8());
        assert_eq!(
            normalized_terms("What did I do in the meeting?"),
            vec!["meeting"]
        );
        let terms = normalized_terms("orchid submarine 731");
        let ocr = "unrelated Plaud content\norchid subnlfv 731\nmore unrelated content";
        assert!(match_score(ocr, &terms) > 0);
        assert_eq!(matching_excerpt(ocr, &terms, MAX_EXCERPT_BYTES), ocr);
        assert_eq!(match_score("unrelated item 731", &terms), 0);
    }
}
