//! Local, sparse OCR for completed Screen Memory video segments.
//!
//! This module deliberately returns bounded rows for the caller to persist;
//! it never writes frame images and never logs recognized text.
// The capture worker consumes this foundation in the next integration slice.
#![allow(dead_code)]

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::path::Path;

pub const OCR_SCHEMA_VERSION: u32 = 1;
pub const MAX_OCR_FRAMES: usize = 30;
pub const MAX_OCR_TEXT_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScreenMemoryOcrIndexState {
    Pending,
    Indexing,
    Ready,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryOcrIndexStatus {
    pub state: ScreenMemoryOcrIndexState,
    pub attempted_frames: usize,
    pub completed_frames: usize,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<String>,
}

impl ScreenMemoryOcrIndexStatus {
    pub fn pending() -> Self {
        Self {
            state: ScreenMemoryOcrIndexState::Pending,
            attempted_frames: 0,
            completed_frames: 0,
            started_at: None,
            finished_at: None,
            error: None,
        }
    }

    pub fn indexing(started_at: impl Into<String>) -> Self {
        Self {
            state: ScreenMemoryOcrIndexState::Indexing,
            attempted_frames: 0,
            completed_frames: 0,
            started_at: Some(started_at.into()),
            finished_at: None,
            error: None,
        }
    }

    pub fn ready(
        attempted_frames: usize,
        completed_frames: usize,
        started_at: impl Into<String>,
        finished_at: impl Into<String>,
    ) -> Self {
        Self {
            state: ScreenMemoryOcrIndexState::Ready,
            attempted_frames,
            completed_frames,
            started_at: Some(started_at.into()),
            finished_at: Some(finished_at.into()),
            error: None,
        }
    }

    pub fn failed(
        attempted_frames: usize,
        completed_frames: usize,
        started_at: impl Into<String>,
        finished_at: impl Into<String>,
        error: impl Into<String>,
    ) -> Self {
        Self {
            state: ScreenMemoryOcrIndexState::Failed,
            attempted_frames,
            completed_frames,
            started_at: Some(started_at.into()),
            finished_at: Some(finished_at.into()),
            error: Some(error.into()),
        }
    }

    pub fn skipped(finished_at: impl Into<String>) -> Self {
        Self {
            state: ScreenMemoryOcrIndexState::Skipped,
            attempted_frames: 0,
            completed_frames: 0,
            started_at: None,
            finished_at: Some(finished_at.into()),
            error: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryOcrRow {
    pub schema_version: u32,
    pub segment_id: String,
    pub captured_at: String,
    pub offset_ms: i64,
    pub source: String,
    pub ocr_text: String,
    pub confidence: f32,
    pub frame_width: u32,
    pub frame_height: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeOcrFrame {
    offset_ms: i64,
    text: String,
    confidence: f32,
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
struct NativeOcrResponse {
    ok: bool,
    frames: Option<Vec<NativeOcrFrame>>,
    error: Option<String>,
}

/// Maps Vision's actual extracted frame time onto the segment timeline.
pub fn captured_at_for_offset(segment_started_at: DateTime<Utc>, offset_ms: i64) -> String {
    (segment_started_at + Duration::milliseconds(offset_ms.max(0))).to_rfc3339()
}

/// The sparse sampling contract shared with the native helper: start at the
/// segment boundary, use the configured interval, and never request more than
/// thirty video frames.
pub fn requested_frame_offsets(duration_ms: u64, sample_interval_seconds: u64) -> Vec<u64> {
    let interval_ms = sample_interval_seconds.max(1).saturating_mul(1_000);
    (0..MAX_OCR_FRAMES)
        .map(|index| (index as u64).saturating_mul(interval_ms))
        .take_while(|offset_ms| *offset_ms <= duration_ms)
        .collect()
}

/// Retains a bounded, UTF-8-safe prefix without carrying frame images forward.
pub fn bounded_ocr_text(text: &str) -> String {
    if text.len() <= MAX_OCR_TEXT_BYTES {
        return text.to_owned();
    }
    let mut end = MAX_OCR_TEXT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

fn rows_from_frames(
    segment_id: &str,
    segment_started_at: DateTime<Utc>,
    frames: impl IntoIterator<Item = NativeOcrFrame>,
) -> Vec<ScreenMemoryOcrRow> {
    frames
        .into_iter()
        .filter(|frame| !frame.text.trim().is_empty())
        .take(MAX_OCR_FRAMES)
        .map(|frame| ScreenMemoryOcrRow {
            schema_version: OCR_SCHEMA_VERSION,
            segment_id: segment_id.to_owned(),
            captured_at: captured_at_for_offset(segment_started_at, frame.offset_ms),
            offset_ms: frame.offset_ms.max(0),
            source: "ocr".to_owned(),
            ocr_text: bounded_ocr_text(&frame.text),
            confidence: frame.confidence.clamp(0.0, 1.0),
            frame_width: frame.width,
            frame_height: frame.height,
        })
        .collect()
}

/// Runs sparse, on-device OCR on macOS. Callers own persistence and should
/// transition the associated index status from `indexing` to `ready`/`failed`.
#[cfg(target_os = "macos")]
pub fn recognize_segment(
    segment_path: &Path,
    segment_id: &str,
    segment_started_at: DateTime<Utc>,
    sample_interval_seconds: u64,
) -> Result<Vec<ScreenMemoryOcrRow>, String> {
    let path = CString::new(segment_path.as_os_str().as_encoded_bytes())
        .map_err(|_| "segment path contains an interior NUL byte".to_owned())?;
    let response =
        unsafe { clips_screen_memory_ocr_json(path.as_ptr(), sample_interval_seconds.max(1)) };
    if response.is_null() {
        return Err("macOS OCR helper returned no response".to_owned());
    }
    let response_text = unsafe {
        let text = CStr::from_ptr(response).to_string_lossy().into_owned();
        clips_screen_memory_ocr_free(response);
        text
    };
    let response: NativeOcrResponse = serde_json::from_str(&response_text)
        .map_err(|_| "macOS OCR helper returned an invalid response".to_owned())?;
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| "macOS OCR failed".to_owned()));
    }
    Ok(rows_from_frames(
        segment_id,
        segment_started_at,
        response.frames.unwrap_or_default(),
    ))
}

/// Platforms without AVFoundation/Vision do not silently provide a different
/// OCR path. Capture remains usable, while callers can mark OCR as skipped.
#[cfg(not(target_os = "macos"))]
pub fn recognize_segment(
    _segment_path: &Path,
    _segment_id: &str,
    _segment_started_at: DateTime<Utc>,
    _sample_interval_seconds: u64,
) -> Result<Vec<ScreenMemoryOcrRow>, String> {
    Err("local Screen Memory OCR is supported on macOS only".to_owned())
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn clips_screen_memory_ocr_json(
        video_path: *const std::ffi::c_char,
        sample_interval_seconds: u64,
    ) -> *mut std::ffi::c_char;
    fn clips_screen_memory_ocr_free(response: *mut std::ffi::c_char);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(offset_ms: i64, text: impl Into<String>) -> NativeOcrFrame {
        NativeOcrFrame {
            offset_ms,
            text: text.into(),
            confidence: 1.2,
            width: 1920,
            height: 1080,
        }
    }

    #[test]
    fn maps_actual_frame_time_to_segment_timestamp() {
        let started_at = "2026-07-14T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        assert_eq!(
            captured_at_for_offset(started_at, 1_250),
            "2026-07-14T12:00:01.250+00:00"
        );
        assert_eq!(
            captured_at_for_offset(started_at, -1),
            "2026-07-14T12:00:00+00:00"
        );
    }

    #[test]
    fn caps_rows_and_bounds_text_without_splitting_unicode() {
        let started_at = "2026-07-14T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let oversized = "é".repeat(MAX_OCR_TEXT_BYTES);
        let rows = rows_from_frames(
            "segment-1",
            started_at,
            (0..35).map(|index| {
                frame(
                    index * 1_000,
                    if index == 0 {
                        oversized.clone()
                    } else {
                        "text".to_owned()
                    },
                )
            }),
        );
        assert_eq!(rows.len(), MAX_OCR_FRAMES);
        assert!(rows[0].ocr_text.len() <= MAX_OCR_TEXT_BYTES);
        assert!(rows[0].ocr_text.is_char_boundary(rows[0].ocr_text.len()));
        assert_eq!(rows[0].source, "ocr");
        assert_eq!(rows[0].confidence, 1.0);
    }

    #[test]
    fn samples_the_requested_interval_with_a_thirty_frame_cap() {
        assert_eq!(
            requested_frame_offsets(5 * 60 * 1_000, 10),
            (0..MAX_OCR_FRAMES)
                .map(|index| index as u64 * 10_000)
                .collect::<Vec<_>>()
        );
        assert_eq!(requested_frame_offsets(2_500, 0), vec![0, 1_000, 2_000]);
    }

    #[test]
    fn status_shape_serializes_stably() {
        assert_eq!(
            serde_json::to_value(ScreenMemoryOcrIndexStatus::pending()).unwrap(),
            serde_json::json!({
                "state": "pending", "attemptedFrames": 0, "completedFrames": 0,
                "startedAt": null, "finishedAt": null, "error": null
            })
        );
        assert_eq!(
            serde_json::to_value(ScreenMemoryOcrIndexStatus::ready(
                4,
                3,
                "2026-07-14T12:00:00Z",
                "2026-07-14T12:00:01Z",
            ))
            .unwrap(),
            serde_json::json!({
                "state": "ready", "attemptedFrames": 4, "completedFrames": 3,
                "startedAt": "2026-07-14T12:00:00Z", "finishedAt": "2026-07-14T12:00:01Z", "error": null
            })
        );
        assert_eq!(
            serde_json::to_value(ScreenMemoryOcrIndexStatus::indexing("2026-07-14T12:00:00Z"))
                .unwrap(),
            serde_json::json!({
                "state": "indexing", "attemptedFrames": 0, "completedFrames": 0,
                "startedAt": "2026-07-14T12:00:00Z", "finishedAt": null, "error": null
            })
        );
        assert_eq!(
            serde_json::to_value(ScreenMemoryOcrIndexStatus::failed(
                4,
                1,
                "2026-07-14T12:00:00Z",
                "2026-07-14T12:00:01Z",
                "unavailable",
            ))
            .unwrap(),
            serde_json::json!({
                "state": "failed", "attemptedFrames": 4, "completedFrames": 1,
                "startedAt": "2026-07-14T12:00:00Z", "finishedAt": "2026-07-14T12:00:01Z", "error": "unavailable"
            })
        );
        assert_eq!(
            serde_json::to_value(ScreenMemoryOcrIndexStatus::skipped("2026-07-14T12:00:01Z"))
                .unwrap(),
            serde_json::json!({
                "state": "skipped", "attemptedFrames": 0, "completedFrames": 0,
                "startedAt": null, "finishedAt": "2026-07-14T12:00:01Z", "error": null
            })
        );
    }
}
