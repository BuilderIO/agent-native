//! Local post-segment audio transcription for Screen Memory.
//!
//! MP4 audio is decoded directly into bounded memory, transcribed through the
//! process-wide Whisper context, and returned as typed rows. This module does
//! not persist PCM and never logs transcript text; the capture worker owns the
//! adjacent JSONL/status files.
#![allow(dead_code)]

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::AppHandle;

pub const TRANSCRIPT_SCHEMA_VERSION: u32 = 1;
pub const MAX_INPUT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_DURATION_MS: u64 = 30 * 60 * 1_000;
pub const MAX_TRANSCRIPT_ROWS: usize = 2_048;
pub const MAX_ROW_TEXT_BYTES: usize = 8 * 1024;
pub const MAX_TOTAL_TEXT_BYTES: usize = 1024 * 1024;
const SAMPLE_RATE: usize = 16_000;
const BYTES_PER_SAMPLE: usize = std::mem::size_of::<f32>();
const FFMPEG_CANDIDATE_PATHS: &[&str] = &[
    "ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/local/bin/ffmpeg",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScreenMemoryTranscriptState {
    Pending,
    Transcribing,
    Ready,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryTranscriptStatus {
    pub state: ScreenMemoryTranscriptState,
    pub row_count: usize,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<String>,
}

impl ScreenMemoryTranscriptStatus {
    pub fn pending() -> Self {
        Self::new(ScreenMemoryTranscriptState::Pending)
    }

    pub fn transcribing(started_at: impl Into<String>) -> Self {
        Self {
            started_at: Some(started_at.into()),
            ..Self::new(ScreenMemoryTranscriptState::Transcribing)
        }
    }

    pub fn ready(
        row_count: usize,
        started_at: impl Into<String>,
        finished_at: impl Into<String>,
    ) -> Self {
        Self {
            state: ScreenMemoryTranscriptState::Ready,
            row_count: row_count.min(MAX_TRANSCRIPT_ROWS),
            started_at: Some(started_at.into()),
            finished_at: Some(finished_at.into()),
            error: None,
        }
    }

    pub fn failed(
        started_at: impl Into<String>,
        finished_at: impl Into<String>,
        error: impl AsRef<str>,
    ) -> Self {
        Self {
            state: ScreenMemoryTranscriptState::Failed,
            row_count: 0,
            started_at: Some(started_at.into()),
            finished_at: Some(finished_at.into()),
            error: Some(bounded_text(error.as_ref(), MAX_ROW_TEXT_BYTES)),
        }
    }

    pub fn skipped(finished_at: impl Into<String>) -> Self {
        Self {
            finished_at: Some(finished_at.into()),
            ..Self::new(ScreenMemoryTranscriptState::Skipped)
        }
    }

    fn new(state: ScreenMemoryTranscriptState) -> Self {
        Self {
            state,
            row_count: 0,
            started_at: None,
            finished_at: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryTranscriptRow {
    pub schema_version: u32,
    pub segment_id: String,
    pub source: String,
    pub captured_at: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// The exact background-worker entry point intended for `screen_memory.rs`.
/// `duration_ms` comes from finalized segment metadata and is checked before
/// ffmpeg is started. `source` should describe the recorded audio track (for
/// example `mixed-audio`); rows retain that source verbatim after validation.
pub fn transcribe_segment(
    app: &AppHandle,
    segment_path: &Path,
    segment_id: &str,
    source: &str,
    audio_stream_index: usize,
    segment_started_at: DateTime<Utc>,
    duration_ms: u64,
    language: Option<&str>,
) -> Result<Vec<ScreenMemoryTranscriptRow>, String> {
    validate_request(segment_path, segment_id, source, duration_ms)?;
    let samples = decode_audio(segment_path, audio_stream_index, duration_ms)?;
    let raw = crate::whisper_speech::transcribe_offline_file_samples(app, &samples, language)?;
    Ok(clean_rows(
        segment_id,
        source,
        segment_started_at,
        duration_ms,
        raw,
    ))
}

fn validate_request(
    segment_path: &Path,
    segment_id: &str,
    source: &str,
    duration_ms: u64,
) -> Result<(), String> {
    if segment_id.trim().is_empty() || segment_id.len() > 255 {
        return Err("invalid transcript segment id".to_owned());
    }
    if source.trim().is_empty() || source.len() > 128 {
        return Err("invalid transcript source".to_owned());
    }
    if duration_ms == 0 || duration_ms > MAX_DURATION_MS {
        return Err(format!(
            "transcript duration must be between 1 and {MAX_DURATION_MS} ms"
        ));
    }
    let metadata = std::fs::metadata(segment_path)
        .map_err(|e| format!("transcript input unavailable: {e}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_INPUT_BYTES {
        return Err("transcript input size is outside the allowed bounds".to_owned());
    }
    Ok(())
}

fn decode_audio(
    segment_path: &Path,
    audio_stream_index: usize,
    duration_ms: u64,
) -> Result<Vec<f32>, String> {
    let ffmpeg = resolve_ffmpeg_path()
        .ok_or_else(|| "ffmpeg is required for local segment transcription".to_owned())?;
    let max_samples = ((duration_ms as usize)
        .saturating_mul(SAMPLE_RATE)
        .saturating_add(999))
        / 1_000;
    let max_bytes = max_samples.saturating_mul(BYTES_PER_SAMPLE);
    let duration_seconds = format!("{:.3}", duration_ms as f64 / 1_000.0);
    let audio_map = format!("0:a:{audio_stream_index}?");
    let mut child = Command::new(ffmpeg)
        .args(["-v", "error", "-nostdin", "-i"])
        .arg(segment_path)
        .args(["-map", &audio_map, "-vn", "-t", &duration_seconds])
        .args(["-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("ffmpeg audio decode spawn failed: {e}"))?;
    let mut bytes = Vec::with_capacity(max_bytes.min(8 * 1024 * 1024));
    child
        .stdout
        .take()
        .ok_or_else(|| "ffmpeg audio decode stdout unavailable".to_owned())?
        .take((max_bytes as u64).saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| format!("ffmpeg audio decode read failed: {e}"))?;
    if bytes.len() > max_bytes {
        let _ = child.kill();
        let _ = child.wait();
        return Err("decoded audio exceeded the declared segment duration".to_owned());
    }
    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg audio decode wait failed: {e}"))?;
    if !status.success() {
        return Err("ffmpeg could not decode segment audio".to_owned());
    }
    if bytes.is_empty() {
        return Err("segment has no decodable audio track".to_owned());
    }
    if bytes.len() % BYTES_PER_SAMPLE != 0 {
        return Err("ffmpeg returned malformed PCM audio".to_owned());
    }
    let samples = bytes
        .chunks_exact(BYTES_PER_SAMPLE)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("four-byte PCM chunk")))
        .collect::<Vec<_>>();
    if samples.iter().any(|sample| !sample.is_finite()) {
        return Err("ffmpeg returned invalid PCM audio".to_owned());
    }
    Ok(samples)
}

fn clean_rows(
    segment_id: &str,
    source: &str,
    segment_started_at: DateTime<Utc>,
    duration_ms: u64,
    raw: impl IntoIterator<Item = crate::whisper_speech::OfflineTranscriptSegment>,
) -> Vec<ScreenMemoryTranscriptRow> {
    let mut total_text_bytes = 0usize;
    raw.into_iter()
        .filter_map(|segment| {
            let text = clean_text(&segment.text)?;
            let remaining = MAX_TOTAL_TEXT_BYTES.saturating_sub(total_text_bytes);
            if remaining == 0 {
                return None;
            }
            let text = bounded_text(&text, MAX_ROW_TEXT_BYTES.min(remaining));
            if text.is_empty() {
                return None;
            }
            total_text_bytes = total_text_bytes.saturating_add(text.len());
            let start_ms = segment.start_ms.max(0) as u64;
            let end_ms = segment.end_ms.max(segment.start_ms).max(0) as u64;
            Some(ScreenMemoryTranscriptRow {
                schema_version: TRANSCRIPT_SCHEMA_VERSION,
                segment_id: segment_id.to_owned(),
                source: source.to_owned(),
                captured_at: (segment_started_at
                    + Duration::milliseconds(start_ms.min(duration_ms) as i64))
                .to_rfc3339(),
                start_ms: start_ms.min(duration_ms),
                end_ms: end_ms.min(duration_ms),
                text,
            })
        })
        .filter(|row| row.end_ms > row.start_ms)
        .take(MAX_TRANSCRIPT_ROWS)
        .collect()
}

fn clean_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || !trimmed.chars().any(char::is_alphanumeric) {
        return None;
    }
    let normalized = trimmed
        .trim_matches(|character: char| !character.is_alphanumeric() && character != '_')
        .to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "blank_audio" | "silence" | "music" | "no speech"
    ) {
        return None;
    }
    if (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with('(') && trimmed.ends_with(')'))
    {
        return None;
    }
    Some(trimmed.to_owned())
}

fn bounded_text(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_owned();
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

fn resolve_ffmpeg_path() -> Option<String> {
    if let Ok(path) = std::env::var("CLIPS_FFMPEG_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() && command_available(trimmed) {
            return Some(trimmed.to_owned());
        }
    }
    FFMPEG_CANDIDATE_PATHS
        .iter()
        .copied()
        .find(|candidate| command_available(candidate))
        .map(str::to_owned)
}

fn command_available(command: &str) -> bool {
    Command::new(command)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::whisper_speech::OfflineTranscriptSegment;

    fn segment(start_ms: i64, end_ms: i64, text: impl Into<String>) -> OfflineTranscriptSegment {
        OfflineTranscriptSegment {
            start_ms,
            end_ms,
            text: text.into(),
        }
    }

    #[test]
    fn rejects_unbounded_requests_before_decode() {
        let path = Path::new("does-not-matter.mp4");
        assert!(validate_request(path, "segment", "mixed-audio", 0).is_err());
        assert!(validate_request(path, "segment", "mixed-audio", MAX_DURATION_MS + 1).is_err());
        assert!(validate_request(path, "", "mixed-audio", 1).is_err());
        assert!(validate_request(path, "segment", "", 1).is_err());
    }

    #[test]
    fn cleans_rows_and_rejects_silence_placeholders() {
        let rows = clean_rows(
            "segment-1",
            "mixed-audio",
            "2026-07-14T12:00:00Z".parse().unwrap(),
            2_000,
            [
                segment(0, 250, " [BLANK_AUDIO]. "),
                segment(250, 500, "(silence)"),
                segment(-50, 750, " hello there "),
                segment(1_900, 2_500, "last words"),
            ],
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].text, "hello there");
        assert_eq!(rows[0].captured_at, "2026-07-14T12:00:00+00:00");
        assert_eq!((rows[0].start_ms, rows[0].end_ms), (0, 750));
        assert_eq!(rows[1].source, "mixed-audio");
        assert_eq!((rows[1].start_ms, rows[1].end_ms), (1_900, 2_000));
        assert_eq!(rows[1].captured_at, "2026-07-14T12:00:01.900+00:00");
    }

    #[test]
    fn bounds_unicode_row_and_total_output() {
        let text = "é".repeat(MAX_ROW_TEXT_BYTES);
        let rows = clean_rows(
            "segment-1",
            "mixed-audio",
            "2026-07-14T12:00:00Z".parse().unwrap(),
            MAX_DURATION_MS,
            (0..MAX_TRANSCRIPT_ROWS + 10)
                .map(|index| segment(index as i64, index as i64 + 1, text.clone())),
        );
        assert!(rows.len() <= MAX_TRANSCRIPT_ROWS);
        assert!(rows.iter().all(|row| row.text.len() <= MAX_ROW_TEXT_BYTES));
        assert!(rows.iter().map(|row| row.text.len()).sum::<usize>() <= MAX_TOTAL_TEXT_BYTES);
        assert!(rows
            .iter()
            .all(|row| row.text.is_char_boundary(row.text.len())));
    }

    #[test]
    fn status_helpers_have_stable_lifecycle_fields() {
        assert_eq!(
            ScreenMemoryTranscriptStatus::pending().state,
            ScreenMemoryTranscriptState::Pending
        );
        let active = ScreenMemoryTranscriptStatus::transcribing("start");
        assert_eq!(active.started_at.as_deref(), Some("start"));
        let ready = ScreenMemoryTranscriptStatus::ready(MAX_TRANSCRIPT_ROWS + 1, "start", "end");
        assert_eq!(ready.row_count, MAX_TRANSCRIPT_ROWS);
        assert_eq!(ready.finished_at.as_deref(), Some("end"));
        let failed = ScreenMemoryTranscriptStatus::failed("start", "end", "x".repeat(20_000));
        assert_eq!(failed.error.unwrap().len(), MAX_ROW_TEXT_BYTES);
        assert_eq!(
            ScreenMemoryTranscriptStatus::skipped("end").state,
            ScreenMemoryTranscriptState::Skipped
        );
    }
}
