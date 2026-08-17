//! Retention-bound, local-only work chapters for the Rewind buffer.
//!
//! This deliberately stores references and bounded context only. Segments remain
//! the retention authority; a missing or invalid chapter manifest is disposable.

#[cfg(test)]
use crate::config::RewindCaptureMode;
use crate::screen_memory::{ScreenMemoryEvent, ScreenMemorySegmentMetadata};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

const CHAPTERS_FILE: &str = "chapters.json";
const HARD_GAP_MS: i64 = 1_500;
const SCENE_SLICE_MS: i64 = 30_000;
// A safety bound, not a product boundary. Coherent work commonly lasts longer
// than the 15–20 minute acceptance samples and must not split merely by age.
const MAX_CHAPTER_SPAN_MS: i64 = 60 * 60 * 1_000;
const TRANSIENT_SCENE_MS: i64 = 75_000;
const MIN_SEMANTIC_TOPIC_MS: i64 = 120_000;
const SAME_SURFACE_CONTINUITY_OVERLAP: f32 = 0.40;
const MAX_KEYWORDS: usize = 8;
const MAX_EVIDENCE_REFS_PER_SOURCE: usize = 8;
const MAX_EVIDENCE_KEYWORDS: usize = 64;
const MAX_REPRESENTATIVE_MOMENTS: usize = 6;
const MAX_SIDECAR_ROWS: usize = 128;
const MAX_SIDECAR_LINE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindChaptersManifest {
    pub schema_version: u32,
    pub generated_at: String,
    pub state: ChapterIndexState,
    pub coverage: ChapterCoverage,
    #[serde(default)]
    pub scenes: Vec<RewindScene>,
    pub chapters: Vec<RewindChapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ChapterIndexState {
    Pending,
    Partial,
    Ready,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterCoverage {
    pub retained_segments: usize,
    pub omitted_segments: usize,
    pub gap_count: usize,
    #[serde(default)]
    pub gaps: Vec<CoverageGap>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoverageGap {
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindChapter {
    pub id: String,
    #[serde(default = "default_revision")]
    pub revision: u32,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: i64,
    pub label: String,
    pub summary: String,
    pub keywords: Vec<String>,
    pub confidence: f32,
    #[serde(default)]
    pub scene_refs: Vec<String>,
    pub segment_refs: Vec<SegmentRef>,
    pub evidence_refs: Vec<EvidenceRef>,
    pub contexts: Vec<ChapterContext>,
    pub representative_moments: Vec<RepresentativeMoment>,
    #[serde(default)]
    pub representative_coverage: RepresentativeCoverage,
    pub ambiguity_reasons: Vec<String>,
    pub index_state: ChapterIndexState,
}

fn default_revision() -> u32 {
    1
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepresentativeCoverage {
    pub covered_scenes: usize,
    pub total_scenes: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindScene {
    pub id: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: i64,
    pub hard_boundary_before: bool,
    pub segment_refs: Vec<SegmentRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<ChapterContext>,
    pub keywords: Vec<String>,
    pub evidence_refs: Vec<EvidenceRef>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SegmentRef {
    pub id: String,
    pub started_at: String,
    pub ended_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EvidenceRef {
    pub source_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepresentativeMoment {
    pub moment_id: String,
    pub captured_at: String,
    pub segment_id: String,
    pub offset_ms: i64,
    pub reason: String,
}

#[derive(Clone)]
struct Item {
    segment: ScreenMemorySegmentMetadata,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    partial: bool,
    content: ContentSignal,
}

#[derive(Clone, Default)]
struct ContentSignal {
    visual_keywords: BTreeMap<String, usize>,
    system_audio_keywords: BTreeMap<String, usize>,
    microphone_keywords: BTreeMap<String, usize>,
    evidence_refs: Vec<EvidenceRef>,
}

#[derive(Clone)]
struct SceneItem {
    scene: RewindScene,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    visual_keywords: BTreeMap<String, usize>,
    system_audio_keywords: BTreeMap<String, usize>,
    microphone_keywords: BTreeMap<String, usize>,
    partial: bool,
}

pub(crate) fn rebuild(
    dir: &Path,
    segments: Vec<ScreenMemorySegmentMetadata>,
    events: Vec<ScreenMemoryEvent>,
) -> Result<(), String> {
    let content = content_signals(dir, &segments);
    let previous = fs::read(dir.join(CHAPTERS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<RewindChaptersManifest>(&bytes).ok());
    let manifest = build_with_previous(
        segments,
        events,
        pending_segment_ids(dir),
        content,
        previous.as_ref(),
        Utc::now(),
    );
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("chapter manifest encode failed: {e}"))?;
    write_atomic(&dir.join(CHAPTERS_FILE), &bytes)
}

pub(crate) fn clear(dir: &Path) -> Result<(), String> {
    let path = dir.join(CHAPTERS_FILE);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("chapter manifest remove failed: {e}")),
    }
}

fn build(
    segments: Vec<ScreenMemorySegmentMetadata>,
    events: Vec<ScreenMemoryEvent>,
    generated_at: DateTime<Utc>,
) -> RewindChaptersManifest {
    build_with_pending(
        segments,
        events,
        BTreeSet::new(),
        BTreeMap::new(),
        generated_at,
    )
}
fn build_with_pending(
    segments: Vec<ScreenMemorySegmentMetadata>,
    events: Vec<ScreenMemoryEvent>,
    pending: BTreeSet<String>,
    content: BTreeMap<String, ContentSignal>,
    generated_at: DateTime<Utc>,
) -> RewindChaptersManifest {
    build_with_previous(segments, events, pending, content, None, generated_at)
}

fn build_with_previous(
    segments: Vec<ScreenMemorySegmentMetadata>,
    mut events: Vec<ScreenMemoryEvent>,
    pending: BTreeSet<String>,
    content: BTreeMap<String, ContentSignal>,
    previous: Option<&RewindChaptersManifest>,
    generated_at: DateTime<Utc>,
) -> RewindChaptersManifest {
    events.sort_by(|a, b| a.captured_at.cmp(&b.captured_at));
    let mut omitted = 0usize;
    let mut explicit_gaps = Vec::new();
    let mut items = segments
        .into_iter()
        .filter_map(|segment| {
            if segment.exclusion_tainted || segment.corrupt || segment.error.is_some() {
                omitted += 1;
                if let (Ok(start), Ok(end)) = (
                    DateTime::parse_from_rfc3339(&segment.started_at),
                    DateTime::parse_from_rfc3339(&segment.ended_at),
                ) {
                    let start = start.with_timezone(&Utc);
                    let end = end.with_timezone(&Utc);
                    if end > start {
                        explicit_gaps.push(CoverageGap {
                            started_at: start.to_rfc3339(),
                            ended_at: end.to_rfc3339(),
                            duration_ms: (end - start).num_milliseconds(),
                            reason: if segment.exclusion_tainted {
                                "excluded capture interval"
                            } else if segment.corrupt {
                                "corrupt capture interval"
                            } else {
                                "failed capture interval"
                            }
                            .into(),
                        });
                    }
                }
                return None;
            }
            let start = DateTime::parse_from_rfc3339(&segment.started_at)
                .ok()?
                .with_timezone(&Utc);
            let end = DateTime::parse_from_rfc3339(&segment.ended_at)
                .ok()?
                .with_timezone(&Utc);
            if end <= start {
                omitted += 1;
                return None;
            }
            let partial = pending.contains(&segment.id);
            let content = content.get(&segment.id).cloned().unwrap_or_default();
            Some(Item {
                segment,
                start,
                end,
                partial,
                content,
            })
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| (a.start, &a.segment.id).cmp(&(b.start, &b.segment.id)));
    let retained = items.len();
    let mut gaps = timeline_gaps(&items, &events);
    gaps.append(&mut explicit_gaps);
    gaps.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    gaps.dedup_by(|a, b| a.started_at == b.started_at && a.ended_at == b.ended_at);

    let scene_items = build_scene_items(&items, &events);
    let scenes = scene_items
        .iter()
        .map(|item| item.scene.clone())
        .collect::<Vec<_>>();
    let groups = group_semantic_scenes(&scene_items);
    let mut chapters = groups.into_iter().map(chapter).collect::<Vec<_>>();
    apply_previous_identity(&mut chapters, previous);
    let state = if retained == 0 {
        ChapterIndexState::Pending
    } else if chapters
        .iter()
        .any(|c| c.index_state == ChapterIndexState::Partial)
    {
        ChapterIndexState::Partial
    } else {
        ChapterIndexState::Ready
    };
    RewindChaptersManifest {
        schema_version: 2,
        generated_at: generated_at.to_rfc3339(),
        state,
        coverage: ChapterCoverage {
            retained_segments: retained,
            omitted_segments: omitted,
            gap_count: gaps.len(),
            gaps,
        },
        scenes,
        chapters,
    }
}

fn timeline_gaps(items: &[Item], events: &[ScreenMemoryEvent]) -> Vec<CoverageGap> {
    items
        .windows(2)
        .filter_map(|pair| {
            let previous = &pair[0];
            let next = &pair[1];
            let duration_ms = (next.start - previous.end).num_milliseconds();
            (duration_ms > HARD_GAP_MS).then(|| {
                let explicit_reason = events.iter().find_map(|event| {
                    (event.source == "coverage-gap"
                        && DateTime::parse_from_rfc3339(&event.captured_at)
                            .ok()
                            .map(|at| at.with_timezone(&Utc))
                            .is_some_and(|at| at >= previous.end && at <= next.start))
                    .then(|| event.coverage_gap_reason.clone())
                    .flatten()
                });
                CoverageGap {
                    started_at: previous.end.to_rfc3339(),
                    ended_at: next.start.to_rfc3339(),
                    duration_ms,
                    reason: explicit_reason.unwrap_or_else(|| {
                        if previous.segment.graph_epoch_id != next.segment.graph_epoch_id {
                            "capture restart interval"
                        } else {
                            "unretained capture interval"
                        }
                        .into()
                    }),
                }
            })
        })
        .collect()
}

fn build_scene_items(items: &[Item], events: &[ScreenMemoryEvent]) -> Vec<SceneItem> {
    let mut scenes = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        let mut boundaries = vec![item.start, item.end];
        let mut cursor = item.start + Duration::milliseconds(SCENE_SLICE_MS);
        while cursor < item.end {
            boundaries.push(cursor);
            cursor += Duration::milliseconds(SCENE_SLICE_MS);
        }
        let mut last_semantic_key: Option<String> = None;
        for event in events {
            let Some(at) = parse_utc(&event.captured_at) else {
                continue;
            };
            if at < item.start || at > item.end || event.source == "coverage-gap" {
                continue;
            }
            let key = event_semantic_key(event);
            if last_semantic_key.as_ref() != Some(&key) {
                if at > item.start && at < item.end {
                    boundaries.push(at);
                }
                last_semantic_key = Some(key);
            }
        }
        boundaries.sort();
        boundaries.dedup();
        for pair in boundaries.windows(2) {
            let start = pair[0];
            let end = pair[1];
            if end <= start {
                continue;
            }
            let context_event = context_event_at(events, start, end);
            let context = context_event.map(chapter_context_from_event);
            let mut visual_keywords = BTreeMap::new();
            let mut system_audio_keywords = BTreeMap::new();
            let mut microphone_keywords = BTreeMap::new();
            let mut evidence_refs = Vec::new();

            if let Some(event) = context_event {
                if let Some(title) = event.window_title.as_deref() {
                    let repeats_app_name = event
                        .app_name
                        .as_deref()
                        .is_some_and(|app| app.trim().eq_ignore_ascii_case(title.trim()));
                    if !generic_surface_title(title) && !repeats_app_name {
                        add_keywords(title, &mut visual_keywords);
                    }
                }
                let accessibility = accessibility_keywords(event);
                merge_counts(&mut visual_keywords, &accessibility);
                evidence_refs.push(EvidenceRef {
                    source_type: "app-context".into(),
                    source_kind: Some(
                        if event.accessibility.is_some() {
                            "accessibility"
                        } else {
                            "window"
                        }
                        .into(),
                    ),
                    keywords: top_keywords(&accessibility, 12),
                    confidence: Some(if event.accessibility.is_some() {
                        0.9
                    } else {
                        0.55
                    }),
                    segment_id: Some(item.segment.id.clone()),
                    offset_ms: Some((start - item.start).num_milliseconds()),
                    captured_at: Some(start.to_rfc3339()),
                });
            }

            for reference in &item.content.evidence_refs {
                let Some(at) = evidence_time(reference, item.start) else {
                    continue;
                };
                if at < start || at >= end {
                    continue;
                }
                match reference.source_kind.as_deref() {
                    Some("visual" | "accessibility") => {
                        add_keyword_list(&reference.keywords, &mut visual_keywords)
                    }
                    Some("microphone") => {
                        add_keyword_list(&reference.keywords, &mut microphone_keywords)
                    }
                    _ => add_keyword_list(&reference.keywords, &mut system_audio_keywords),
                }
                evidence_refs.push(reference.clone());
            }

            let mut searchable = visual_keywords.clone();
            merge_counts(&mut searchable, &system_audio_keywords);
            if searchable.is_empty() {
                merge_counts(&mut searchable, &microphone_keywords);
            }
            let hard_boundary_before = scenes.is_empty()
                || (start == item.start
                    && item_index > 0
                    && hard_boundary_between(&items[item_index - 1], item));
            let scene_id = format!("scene-{}-{}", item.segment.id, start.timestamp_millis());
            let confidence = if !visual_keywords.is_empty() {
                0.85
            } else if !system_audio_keywords.is_empty() {
                0.65
            } else if context.is_some() {
                0.5
            } else {
                0.3
            };
            let scene = RewindScene {
                id: scene_id,
                started_at: start.to_rfc3339(),
                ended_at: end.to_rfc3339(),
                duration_ms: (end - start).num_milliseconds(),
                hard_boundary_before,
                segment_refs: vec![SegmentRef {
                    id: item.segment.id.clone(),
                    started_at: item.segment.started_at.clone(),
                    ended_at: item.segment.ended_at.clone(),
                }],
                context,
                keywords: top_keywords(&searchable, MAX_KEYWORDS),
                evidence_refs: bounded_evidence_refs(evidence_refs),
                confidence,
            };
            scenes.push(SceneItem {
                scene,
                start,
                end,
                visual_keywords,
                system_audio_keywords,
                microphone_keywords,
                partial: item.partial,
            });
        }
    }
    scenes
}

fn hard_boundary_between(previous: &Item, next: &Item) -> bool {
    previous.segment.graph_epoch_id != next.segment.graph_epoch_id
        || previous.segment.capture_mode != next.segment.capture_mode
        || (next.start - previous.end).num_milliseconds() > HARD_GAP_MS
}

fn context_event_at(
    events: &[ScreenMemoryEvent],
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Option<&ScreenMemoryEvent> {
    events
        .iter()
        .filter_map(|event| parse_utc(&event.captured_at).map(|at| (at, event)))
        .filter(|(at, event)| *at <= end && event.source != "coverage-gap")
        .filter(|(at, _)| *at <= start || (*at >= start && *at < end))
        .max_by_key(|(at, _)| *at)
        .map(|(_, event)| event)
}

fn chapter_context_from_event(event: &ScreenMemoryEvent) -> ChapterContext {
    let document = event
        .accessibility
        .as_ref()
        .and_then(|fingerprint| fingerprint.document.as_ref());
    ChapterContext {
        app_name: event.app_name.clone(),
        window_title: event.window_title.clone(),
        bundle_id: event.bundle_id.clone(),
        document_title: document.and_then(|node| {
            node.title
                .clone()
                .or_else(|| node.document.clone())
                .filter(|value| !value.trim().is_empty())
        }),
        document_url: document.and_then(|node| node.url.clone()),
    }
}

fn event_semantic_key(event: &ScreenMemoryEvent) -> String {
    format!(
        "{}|{}|{}|{}",
        event.app_name.as_deref().unwrap_or_default(),
        event.window_title.as_deref().unwrap_or_default(),
        event.bundle_id.as_deref().unwrap_or_default(),
        top_keywords(&accessibility_keywords(event), 16).join(",")
    )
}

fn accessibility_keywords(event: &ScreenMemoryEvent) -> BTreeMap<String, usize> {
    let mut keywords = BTreeMap::new();
    let Some(accessibility) = event.accessibility.as_ref() else {
        return keywords;
    };
    for node in [
        accessibility.document.as_ref(),
        accessibility.focused.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        // Roles describe the accessibility API, not the user's work. Ingesting
        // them recursively produced labels such as "Working on AXTextArea".
        for text in [
            node.title.as_deref(),
            node.description.as_deref(),
            node.document.as_deref(),
            node.selected_text.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            add_keywords(text, &mut keywords);
            add_semantic_phrases(text, &mut keywords);
        }
    }
    for label in &accessibility.visible_labels {
        add_keywords(label, &mut keywords);
        add_semantic_phrases(label, &mut keywords);
    }
    keywords
}

fn add_keyword_list(keywords: &[String], counts: &mut BTreeMap<String, usize>) {
    for keyword in keywords {
        *counts.entry(keyword.clone()).or_default() += 1;
    }
}

fn evidence_time(reference: &EvidenceRef, segment_start: DateTime<Utc>) -> Option<DateTime<Utc>> {
    reference
        .captured_at
        .as_deref()
        .and_then(parse_utc)
        .or_else(|| {
            reference
                .offset_ms
                .map(|offset| segment_start + Duration::milliseconds(offset.max(0)))
        })
}

fn parse_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

fn bounded_evidence_refs(mut references: Vec<EvidenceRef>) -> Vec<EvidenceRef> {
    references.sort_by(|a, b| {
        (
            &a.source_type,
            &a.source_kind,
            &a.segment_id,
            &a.offset_ms,
            &a.captured_at,
        )
            .cmp(&(
                &b.source_type,
                &b.source_kind,
                &b.segment_id,
                &b.offset_ms,
                &b.captured_at,
            ))
    });
    references.dedup_by(|a, b| {
        a.source_type == b.source_type
            && a.source_kind == b.source_kind
            && a.segment_id == b.segment_id
            && a.offset_ms == b.offset_ms
            && a.captured_at == b.captured_at
    });
    let mut by_source: BTreeMap<String, Vec<EvidenceRef>> = BTreeMap::new();
    for reference in references {
        by_source
            .entry(format!(
                "{}:{}",
                reference.source_type,
                reference.source_kind.as_deref().unwrap_or_default()
            ))
            .or_default()
            .push(reference);
    }
    by_source
        .into_values()
        .flat_map(|references| evenly_bounded(references, MAX_EVIDENCE_REFS_PER_SOURCE))
        .collect()
}

fn evenly_bounded<T: Clone>(values: Vec<T>, limit: usize) -> Vec<T> {
    if values.len() <= limit {
        return values;
    }
    (0..limit)
        .map(|index| {
            let source_index = index * (values.len() - 1) / (limit - 1);
            values[source_index].clone()
        })
        .collect()
}
fn pending_segment_ids(dir: &Path) -> BTreeSet<String> {
    fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let segment_id = name
                .strip_suffix(".ocr-status.json")
                .or_else(|| name.strip_suffix(".transcript-status.json"))?;
            let bytes = fs::read(path).ok()?;
            let state = serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()?
                .get("state")?
                .as_str()?
                .to_owned();
            matches!(
                state.as_str(),
                "pending" | "indexing" | "transcribing" | "failed"
            )
            .then_some(segment_id.to_owned())
        })
        .collect()
}

fn content_signals(
    dir: &Path,
    segments: &[ScreenMemorySegmentMetadata],
) -> BTreeMap<String, ContentSignal> {
    segments
        .iter()
        .filter(|segment| !segment.exclusion_tainted && !segment.corrupt && segment.error.is_none())
        .map(|segment| {
            let mut signal = ContentSignal::default();
            read_sidecar_signal(
                &dir.join(format!("{}.transcript.jsonl", segment.id)),
                "transcript",
                &segment.id,
                &mut signal,
            );
            read_sidecar_signal(
                &dir.join(format!("{}.ocr.jsonl", segment.id)),
                "ocr",
                &segment.id,
                &mut signal,
            );
            (segment.id.clone(), signal)
        })
        .collect()
}

fn read_sidecar_signal(
    path: &Path,
    source_type: &str,
    segment_id: &str,
    signal: &mut ContentSignal,
) {
    let Ok(file) = File::open(path) else {
        return;
    };
    for line in BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .take(MAX_SIDECAR_ROWS)
    {
        if line.len() > MAX_SIDECAR_LINE_BYTES {
            continue;
        }
        let Ok(row) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let text = match source_type {
            "transcript" => row.get("text"),
            "ocr" => row.get("ocrText"),
            _ => None,
        }
        .and_then(|value| value.as_str());
        let source_kind = if source_type == "transcript" {
            row.get("source")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown-audio")
        } else {
            "visual"
        };
        let mut row_keywords = BTreeMap::new();
        if let Some(text) = text {
            add_keywords(text, &mut row_keywords);
            if source_type == "ocr" {
                add_semantic_phrases(text, &mut row_keywords);
            }
            let target = if source_type == "ocr" {
                &mut signal.visual_keywords
            } else if source_kind == "microphone" {
                &mut signal.microphone_keywords
            } else {
                &mut signal.system_audio_keywords
            };
            merge_counts(target, &row_keywords);
        }
        signal.evidence_refs.push(EvidenceRef {
            source_type: source_type.into(),
            source_kind: Some(source_kind.into()),
            keywords: top_keywords(&row_keywords, MAX_EVIDENCE_KEYWORDS),
            confidence: row
                .get("confidence")
                .and_then(|value| value.as_f64())
                .map(|value| value as f32),
            segment_id: Some(segment_id.into()),
            offset_ms: row
                .get("startMs")
                .or_else(|| row.get("offsetMs"))
                .and_then(|value| value.as_i64()),
            captured_at: row
                .get("capturedAt")
                .and_then(|value| value.as_str())
                .map(str::to_owned),
        });
    }
}

fn merge_counts(target: &mut BTreeMap<String, usize>, source: &BTreeMap<String, usize>) {
    for (keyword, count) in source {
        *target.entry(keyword.clone()).or_default() += count;
    }
}

fn top_keywords(counts: &BTreeMap<String, usize>, limit: usize) -> Vec<String> {
    let mut keywords = counts.iter().collect::<Vec<_>>();
    keywords.sort_by(|(left_keyword, left_count), (right_keyword, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_keyword.cmp(right_keyword))
    });
    keywords
        .into_iter()
        .take(limit)
        .map(|(keyword, _)| keyword.clone())
        .collect()
}

fn add_keywords(text: &str, keywords: &mut BTreeMap<String, usize>) {
    let lower = text.to_ascii_lowercase();
    // Skip only the credential-bearing line; a password field elsewhere in a
    // frame must not erase unrelated, safe topic evidence from the whole OCR row.
    for line in lower.lines().take(64) {
        if credential_shaped_text(line) {
            continue;
        }
        for word in line.split(|character: char| !character.is_ascii_alphabetic()) {
            if word.len() < 4 || word.len() > 32 || STOP_WORDS.contains(&word) {
                continue;
            }
            *keywords.entry(word.to_owned()).or_default() += 1;
        }
    }
}

fn add_semantic_phrases(text: &str, keywords: &mut BTreeMap<String, usize>) {
    let lower = text.to_ascii_lowercase();
    for line in lower.lines().take(64) {
        if credential_shaped_text(line) {
            continue;
        }
        let words = line
            .split(|character: char| !character.is_ascii_alphabetic())
            .filter(|word| word.len() >= 4 && word.len() <= 24 && !STOP_WORDS.contains(word))
            .take(12)
            .collect::<Vec<_>>();
        for size in [3usize, 2] {
            for phrase in words.windows(size).take(8) {
                if phrase.iter().all(|word| LABEL_GENERIC_WORDS.contains(word)) {
                    continue;
                }
                *keywords.entry(phrase.join(" ")).or_default() += 1;
            }
        }
    }
}

fn credential_shaped_text(lower: &str) -> bool {
    let marked = [
        "password",
        "secret",
        "api key",
        "api_key",
        "access token",
        "bearer",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    let email_shaped = lower.split_whitespace().any(|word| {
        word.split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'))
    });
    marked || email_shaped
}

const STOP_WORDS: &[&str] = &[
    "about", "after", "again", "also", "been", "could", "from", "have", "into", "just", "like",
    "more", "most", "only", "that", "their", "there", "these", "they", "this", "through", "using",
    "were", "what", "when", "with", "would", "your",
];

fn group_semantic_scenes(scenes: &[SceneItem]) -> Vec<Vec<SceneItem>> {
    let mut groups: Vec<Vec<SceneItem>> = Vec::new();
    for (index, scene) in scenes.iter().cloned().enumerate() {
        let split = groups
            .last()
            .is_some_and(|group| should_split_semantically(group, &scene, &scenes[index + 1..]));
        if split || groups.is_empty() {
            groups.push(vec![scene]);
        } else if let Some(group) = groups.last_mut() {
            group.push(scene);
        }
    }

    // A bounded audit or retained archive can begin in the middle of a task.
    // When the first observed foreground context changes almost immediately,
    // there is no earlier evidence with which to prove a genuine chapter
    // boundary. Keep that open-edge sliver with the first durable chapter and
    // let the next rebuild recover the original boundary if more history exists.
    if groups.len() > 1 {
        let first_duration_ms = groups[0]
            .last()
            .map(|last| (last.end - groups[0][0].start).num_milliseconds())
            .unwrap_or_default();
        let next_has_hard_boundary = groups[1]
            .first()
            .is_some_and(|scene| scene.scene.hard_boundary_before);
        if first_duration_ms < SCENE_SLICE_MS && !next_has_hard_boundary {
            let first = groups.remove(0);
            groups[0].splice(0..0, first);
        }
    }
    groups
}

fn should_split_semantically(
    group: &[SceneItem],
    next: &SceneItem,
    following: &[SceneItem],
) -> bool {
    let previous = group.last().expect("nonempty semantic group");
    if next.scene.hard_boundary_before {
        return true;
    }
    if (next.end - group[0].start).num_milliseconds() > MAX_CHAPTER_SPAN_MS {
        return true;
    }

    // Window titles and accessibility summaries can change every few seconds
    // inside one app. Treat the foreground application as the stable surface;
    // semantic evidence below remains responsible for finding topic changes
    // within that surface.
    let context_changed =
        !same_foreground_context(previous.scene.context.as_ref(), next.scene.context.as_ref());
    let current_group_ms = (previous.end - group[0].start).num_milliseconds();
    if current_group_ms < SCENE_SLICE_MS && (!context_changed || previous.scene.context.is_none()) {
        return false;
    }
    let previous_semantics = if context_changed {
        group
            .iter()
            .rev()
            .map(semantic_keywords)
            .find(|keywords| !keywords.is_empty())
            .unwrap_or_default()
    } else {
        let mut combined = BTreeMap::new();
        for scene in group.iter().rev().take(8) {
            merge_counts(&mut combined, &semantic_keywords(scene));
        }
        combined
    };
    let next_semantics = semantic_keywords(next);
    if previous.scene.context.is_none() && previous_semantics.is_empty() {
        return false;
    }
    let overlap = keyword_overlap(&previous_semantics, &next_semantics);

    if context_changed && returns_after_transient_surface(group, next) {
        return false;
    }

    if context_changed
        && following.iter().any(|later| {
            (later.start - next.start).num_milliseconds() <= TRANSIENT_SCENE_MS
                && group.iter().rev().any(|earlier| {
                    same_foreground_context(
                        later.scene.context.as_ref(),
                        earlier.scene.context.as_ref(),
                    )
                })
        })
    {
        return false;
    }

    if (context_changed && strong_cross_surface_continuity(&previous_semantics, &next_semantics))
        || (!context_changed && overlap >= SAME_SURFACE_CONTINUITY_OVERLAP)
    {
        return false;
    }

    if !context_changed
        && document_context_changed(previous.scene.context.as_ref(), next.scene.context.as_ref())
        && document_context_persists_for(next, following, MIN_SEMANTIC_TOPIC_MS)
    {
        return true;
    }

    let persistent_new_context =
        context_changed && context_persists_for(next, following, TRANSIENT_SCENE_MS);
    if persistent_new_context {
        return true;
    }

    if !context_changed && !previous_semantics.is_empty() && !next_semantics.is_empty() {
        return semantics_persist_for(next, following, MIN_SEMANTIC_TOPIC_MS);
    }

    // A context seen only at the open edge of the retained/audited range is not
    // enough evidence for a new chapter. The next rebuild can split at the
    // original boundary once the foreground change has actually persisted.
    false
}

fn same_foreground_context(left: Option<&ChapterContext>, right: Option<&ChapterContext>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => {
            if let (Some(left_bundle), Some(right_bundle)) =
                (left.bundle_id.as_deref(), right.bundle_id.as_deref())
            {
                return left_bundle.eq_ignore_ascii_case(right_bundle);
            }
            if let (Some(left_app), Some(right_app)) =
                (left.app_name.as_deref(), right.app_name.as_deref())
            {
                return left_app.eq_ignore_ascii_case(right_app);
            }
            left.window_title == right.window_title
        }
        _ => false,
    }
}

fn document_context_key(context: Option<&ChapterContext>) -> Option<String> {
    let context = context?;
    context
        .document_url
        .as_deref()
        .or(context.document_title.as_deref())
        .or_else(|| {
            context
                .window_title
                .as_deref()
                .filter(|title| !generic_surface_title(title) && !transient_surface_title(title))
        })
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

fn document_context_changed(
    previous: Option<&ChapterContext>,
    next: Option<&ChapterContext>,
) -> bool {
    match (document_context_key(previous), document_context_key(next)) {
        (Some(previous), Some(next)) => previous != next,
        _ => false,
    }
}

fn document_context_persists_for(
    next: &SceneItem,
    following: &[SceneItem],
    minimum_ms: i64,
) -> bool {
    let Some(target) = document_context_key(next.scene.context.as_ref()) else {
        return false;
    };
    let mut covered_until = next.end;
    if (covered_until - next.start).num_milliseconds() >= minimum_ms {
        return true;
    }
    for later in following {
        if later.scene.hard_boundary_before
            || document_context_key(later.scene.context.as_ref()).as_deref()
                != Some(target.as_str())
        {
            break;
        }
        covered_until = later.end;
        if (covered_until - next.start).num_milliseconds() >= minimum_ms {
            return true;
        }
    }
    false
}

fn returns_after_transient_surface(group: &[SceneItem], next: &SceneItem) -> bool {
    let Some(trailing) = group.last() else {
        return false;
    };
    let trailing_start = group
        .iter()
        .rposition(|scene| {
            !same_foreground_context(
                scene.scene.context.as_ref(),
                trailing.scene.context.as_ref(),
            )
        })
        .map_or(0, |index| index + 1);
    if trailing_start == 0
        || (trailing.end - group[trailing_start].start).num_milliseconds() > TRANSIENT_SCENE_MS
    {
        return false;
    }
    group[..trailing_start].iter().rev().any(|scene| {
        same_foreground_context(scene.scene.context.as_ref(), next.scene.context.as_ref())
    })
}

fn context_persists_for(next: &SceneItem, following: &[SceneItem], minimum_ms: i64) -> bool {
    let mut covered_until = next.end;
    if (covered_until - next.start).num_milliseconds() >= minimum_ms {
        return true;
    }
    for later in following {
        if later.scene.hard_boundary_before
            || !same_foreground_context(later.scene.context.as_ref(), next.scene.context.as_ref())
        {
            break;
        }
        covered_until = later.end;
        if (covered_until - next.start).num_milliseconds() >= minimum_ms {
            return true;
        }
    }
    false
}

fn semantics_persist_for(next: &SceneItem, following: &[SceneItem], minimum_ms: i64) -> bool {
    let target = semantic_keywords(next);
    let mut covered_until = next.end;
    if (covered_until - next.start).num_milliseconds() >= minimum_ms {
        return true;
    }
    for later in following {
        if later.scene.hard_boundary_before
            || !same_foreground_context(later.scene.context.as_ref(), next.scene.context.as_ref())
            || keyword_overlap(&target, &semantic_keywords(later)) < SAME_SURFACE_CONTINUITY_OVERLAP
        {
            break;
        }
        covered_until = later.end;
        if (covered_until - next.start).num_milliseconds() >= minimum_ms {
            return true;
        }
    }
    false
}

fn semantic_keywords(scene: &SceneItem) -> BTreeMap<String, usize> {
    if !scene.visual_keywords.is_empty() {
        let mut keywords = scene.visual_keywords.clone();
        for keyword in scene.system_audio_keywords.keys() {
            if keywords.contains_key(keyword) {
                *keywords.entry(keyword.clone()).or_default() += 1;
            }
        }
        return keywords;
    }
    if !scene.system_audio_keywords.is_empty() {
        return scene.system_audio_keywords.clone();
    }
    scene.microphone_keywords.clone()
}

fn keyword_overlap(left: &BTreeMap<String, usize>, right: &BTreeMap<String, usize>) -> f32 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let left = semantic_word_set(left);
    let right = semantic_word_set(right);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(&right).count();
    intersection as f32 / left.len().min(right.len()) as f32
}

fn strong_cross_surface_continuity(
    left: &BTreeMap<String, usize>,
    right: &BTreeMap<String, usize>,
) -> bool {
    let left = semantic_word_set(left);
    let right = semantic_word_set(right);
    if left.is_empty() || right.is_empty() {
        return false;
    }
    let shared = left.intersection(&right).count();
    let union = left.union(&right).count();
    shared >= 2 && shared as f32 / union.max(1) as f32 >= 0.60
}

fn semantic_word_set(keywords: &BTreeMap<String, usize>) -> BTreeSet<String> {
    keywords
        .keys()
        .flat_map(|keyword| keyword.split_whitespace())
        .filter(|word| !generic_label_word(word) && plausible_label_word(word))
        .map(str::to_owned)
        .collect()
}

fn chapter(group: Vec<SceneItem>) -> RewindChapter {
    let first = &group[0];
    let last = group.last().unwrap();
    let mut contexts = group
        .iter()
        .filter_map(|item| item.scene.context.clone())
        .collect::<Vec<_>>();
    contexts.sort_by(|a, b| format!("{a:?}").cmp(&format!("{b:?}")));
    contexts.dedup();
    let partial = group.iter().any(|item| item.partial);
    let mut evidence_refs = Vec::new();
    let mut visual_keywords = BTreeMap::new();
    let mut system_audio_keywords = BTreeMap::new();
    let mut microphone_keywords = BTreeMap::new();
    for item in &group {
        merge_counts(&mut visual_keywords, &item.visual_keywords);
        merge_counts(&mut system_audio_keywords, &item.system_audio_keywords);
        merge_counts(&mut microphone_keywords, &item.microphone_keywords);
        evidence_refs.extend(item.scene.evidence_refs.clone());
    }
    let mut label_keywords = visual_keywords.clone();
    merge_counts(&mut label_keywords, &system_audio_keywords);
    if label_keywords.is_empty() {
        label_keywords = microphone_keywords.clone();
    }
    let keywords = top_keywords(&label_keywords, MAX_KEYWORDS);
    let label_terms = top_label_keywords(&label_keywords, 3);
    let label = choose_label(&group, &contexts, &label_terms);
    let scene_refs = group
        .iter()
        .map(|item| item.scene.id.clone())
        .collect::<Vec<_>>();
    let mut segment_refs = group
        .iter()
        .flat_map(|item| item.scene.segment_refs.clone())
        .collect::<Vec<_>>();
    segment_refs.sort_by(|a, b| {
        a.started_at
            .cmp(&b.started_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    segment_refs.dedup_by(|a, b| a.id == b.id);
    let representative_moments = representative_moments(&group);
    let representative_coverage = RepresentativeCoverage {
        covered_scenes: representative_moments.len(),
        total_scenes: group.len(),
        truncated: representative_moments.len() < group.len(),
    };
    let confidence = if !visual_keywords.is_empty() {
        0.85
    } else if !system_audio_keywords.is_empty() {
        0.65
    } else if !contexts.is_empty() {
        0.45
    } else {
        0.3
    };
    RewindChapter {
        id: format!("chapter-{}", first.scene.id),
        revision: 1,
        aliases: Vec::new(),
        started_at: first.scene.started_at.clone(),
        ended_at: last.scene.ended_at.clone(),
        duration_ms: (last.end - first.start).num_milliseconds(),
        summary: if keywords.is_empty() {
            format!("{label}; local semantic evidence is sparse.")
        } else {
            format!(
                "{label}; corroborated local evidence mentions {}.",
                keywords
                    .iter()
                    .take(5)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        },
        keywords,
        label,
        confidence,
        scene_refs,
        segment_refs,
        evidence_refs: bounded_evidence_refs(evidence_refs),
        contexts,
        representative_moments,
        representative_coverage,
        ambiguity_reasons: if partial {
            vec!["local indexing is still catching up".into()]
        } else if visual_keywords.is_empty() && system_audio_keywords.is_empty() {
            vec!["no corroborated visual, accessibility, or system-audio topic was retained".into()]
        } else {
            vec![]
        },
        index_state: if partial {
            ChapterIndexState::Partial
        } else {
            ChapterIndexState::Ready
        },
    }
}

fn choose_label(group: &[SceneItem], contexts: &[ChapterContext], keywords: &[String]) -> String {
    let mut title_duration = BTreeMap::<String, i64>::new();
    for scene in group {
        let Some(title) = scene
            .scene
            .context
            .as_ref()
            .and_then(|context| context.window_title.as_deref())
        else {
            continue;
        };
        let repeats_app_name = scene
            .scene
            .context
            .as_ref()
            .and_then(|context| context.app_name.as_deref())
            .is_some_and(|app| app.trim().eq_ignore_ascii_case(title.trim()));
        if !generic_surface_title(title) && !transient_surface_title(title) && !repeats_app_name {
            *title_duration.entry(title.trim().to_owned()).or_default() += scene.scene.duration_ms;
        }
    }
    if let Some((title, _)) = title_duration
        .into_iter()
        .filter(|(title, duration)| *duration >= SCENE_SLICE_MS && title.len() <= 96)
        .max_by_key(|(_, duration)| *duration)
    {
        return title;
    }
    if !keywords.is_empty() {
        let displayed = if keywords[0].contains(' ') {
            &keywords[..1]
        } else {
            &keywords[..keywords.len().min(3)]
        };
        return format!("Working on {}", natural_keyword_list(displayed));
    }
    contexts
        .iter()
        .find_map(|context| context.app_name.clone())
        .map(|app| format!("Work in {app} (low confidence)"))
        .unwrap_or_else(|| "Recent work (low confidence)".into())
}

fn top_label_keywords(counts: &BTreeMap<String, usize>, limit: usize) -> Vec<String> {
    let weighted = counts
        .iter()
        .filter(|(keyword, count)| {
            let words = keyword.split_whitespace().collect::<Vec<_>>();
            !words.iter().any(|word| generic_label_word(word))
                && words.iter().all(|word| plausible_label_word(word))
                && (words.len() == 1 || **count >= 2)
        })
        .map(|(keyword, count)| {
            // Repeated clean phrases are more human than isolated words, but a
            // fixed bonus prevents long OCR fragments from winning by length.
            let words = keyword.split_whitespace().count();
            let phrase_weight = if words > 1 { words + 2 } else { 1 };
            (keyword.clone(), count.saturating_mul(phrase_weight))
        })
        .collect::<BTreeMap<_, _>>();
    let ranked = top_keywords(&weighted, weighted.len());
    let mut selected = Vec::<String>::new();
    for candidate in ranked {
        let candidate_words = candidate.split_whitespace().collect::<BTreeSet<_>>();
        let duplicates_selected_meaning = selected.iter().any(|selected| {
            let selected_words = selected.split_whitespace().collect::<BTreeSet<_>>();
            let shared = candidate_words.intersection(&selected_words).count();
            shared > 0 && shared * 4 >= candidate_words.len().min(selected_words.len()) * 3
        });
        if !duplicates_selected_meaning {
            selected.push(candidate);
            if selected.len() == limit {
                break;
            }
        }
    }
    selected
}

fn generic_label_word(word: &str) -> bool {
    if word.starts_with("ax") {
        return true;
    }
    LABEL_GENERIC_WORDS.iter().any(|generic| {
        word == *generic
            || (word.len() == generic.len()
                && word
                    .chars()
                    .zip(generic.chars())
                    .filter(|(left, right)| left != right)
                    .count()
                    <= 1)
    })
}

fn plausible_label_word(word: &str) -> bool {
    if word.len() <= 5 {
        return true;
    }
    let mut vowels = 0usize;
    let mut consonant_run = 0usize;
    let mut longest_consonant_run = 0usize;
    for character in word.chars() {
        if matches!(character, 'a' | 'e' | 'i' | 'o' | 'u') {
            vowels += 1;
            consonant_run = 0;
        } else {
            consonant_run += 1;
            longest_consonant_run = longest_consonant_run.max(consonant_run);
        }
    }
    vowels > 0 && longest_consonant_run <= 4
}

const LABEL_GENERIC_WORDS: &[&str] = &[
    "agent",
    "native",
    "content",
    "work",
    "working",
    "created",
    "private",
    "document",
    "start",
    "open",
    "review",
    "changes",
    "should",
    "current",
    "system",
    "local",
    "chatgpt",
    "codex",
    "claude",
    "cursor",
    "browser",
    "terminal",
    "safari",
    "finder",
    "axwindow",
    "axwebarea",
    "axapplication",
];

fn generic_surface_title(title: &str) -> bool {
    let normalized = title.trim().to_ascii_lowercase();
    normalized.is_empty()
        || [
            "chatgpt",
            "codex",
            "claude",
            "claude code",
            "cursor",
            "browser",
            "terminal",
            "google chrome",
            "safari",
            "mail",
            "finder",
        ]
        .contains(&normalized.as_str())
}

fn transient_surface_title(title: &str) -> bool {
    let normalized = title.trim().to_ascii_lowercase();
    normalized.contains("save password")
        || normalized.contains("password manager")
        || normalized == "new tab"
        || normalized == "downloads"
        || normalized.ends_with(" notification")
}

fn natural_keyword_list(keywords: &[String]) -> String {
    match keywords {
        [] => "recent work".into(),
        [one] => one.clone(),
        [one, two] => format!("{one} and {two}"),
        [one, two, rest @ ..] => format!("{one}, {two}, and {}", rest[0]),
    }
}

fn representative_moments(group: &[SceneItem]) -> Vec<RepresentativeMoment> {
    let limit = group.len().min(MAX_REPRESENTATIVE_MOMENTS);
    if limit == 0 {
        return Vec::new();
    }
    let selected = if group.len() <= limit {
        (0..group.len()).collect::<Vec<_>>()
    } else {
        (0..limit)
            .map(|index| index * (group.len() - 1) / (limit - 1))
            .collect::<Vec<_>>()
    };
    selected
        .into_iter()
        .filter_map(|index| {
            let item = &group[index];
            let segment = item.scene.segment_refs.first()?;
            let segment_start = parse_utc(&segment.started_at)?;
            Some(RepresentativeMoment {
                moment_id: format!("moment-{}", item.scene.id),
                captured_at: item.scene.started_at.clone(),
                segment_id: segment.id.clone(),
                offset_ms: (item.start - segment_start).num_milliseconds().max(0),
                reason: if index == 0 {
                    "chapter start"
                } else if index + 1 == group.len() {
                    "chapter end"
                } else {
                    "semantic scene change"
                }
                .into(),
            })
        })
        .collect()
}

fn apply_previous_identity(
    chapters: &mut [RewindChapter],
    previous: Option<&RewindChaptersManifest>,
) {
    let Some(previous) = previous else {
        return;
    };
    for chapter in chapters {
        if let Some(prior) = previous
            .chapters
            .iter()
            .find(|prior| prior.id == chapter.id)
        {
            chapter.aliases = prior.aliases.clone();
            chapter.revision = if chapter_semantics_equal(prior, chapter) {
                prior.revision
            } else {
                prior.revision.saturating_add(1)
            };
        }
        for prior in &previous.chapters {
            let Some(first_scene) = prior.scene_refs.first() else {
                continue;
            };
            if prior.id != chapter.id
                && chapter.scene_refs.contains(first_scene)
                && !chapter.aliases.contains(&prior.id)
            {
                chapter.aliases.push(prior.id.clone());
            }
        }
        chapter.aliases.sort();
        chapter.aliases.dedup();
    }
}

fn chapter_semantics_equal(previous: &RewindChapter, current: &RewindChapter) -> bool {
    previous.started_at == current.started_at
        && previous.ended_at == current.ended_at
        && previous.scene_refs == current.scene_refs
        && previous.label == current.label
        && previous.summary == current.summary
        && previous.keywords == current.keywords
        && previous.ambiguity_reasons == current.ambiguity_reasons
        && previous.representative_moments.len() == current.representative_moments.len()
}
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|e| format!("chapter manifest write failed: {e}"))?;
    fs::rename(temporary, path).map_err(|e| format!("chapter manifest replace failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn segment(id: &str, start: &str, end: &str) -> ScreenMemorySegmentMetadata {
        ScreenMemorySegmentMetadata {
            id: id.into(),
            path: PathBuf::from("/private/media.mp4"),
            file_name: "media.mp4".into(),
            mime_type: "video/mp4".into(),
            started_at: start.into(),
            ended_at: end.into(),
            duration_ms: 60_000,
            width: None,
            height: None,
            bytes: 1,
            system_audio_path: None,
            microphone_path: None,
            corrupt: false,
            error: None,
            capture_mode: RewindCaptureMode::Visuals,
            exclusion_tainted: false,
            graph_epoch_id: Some("a".into()),
            graph_started_elapsed_ms: 0,
            graph_ended_elapsed_ms: 60_000,
        }
    }
    fn event(at: &str, app: &str) -> ScreenMemoryEvent {
        ScreenMemoryEvent {
            captured_at: at.into(),
            app_name: Some(app.into()),
            window_title: Some(app.into()),
            bundle_id: None,
            source: "foreground".into(),
            coverage_gap_reason: None,
            accessibility: None,
        }
    }
    fn evidence(
        segment_id: &str,
        source_type: &str,
        source_kind: &str,
        captured_at: &str,
        words: &[&str],
    ) -> EvidenceRef {
        EvidenceRef {
            source_type: source_type.into(),
            source_kind: Some(source_kind.into()),
            keywords: words.iter().map(|word| (*word).into()).collect(),
            confidence: Some(0.9),
            segment_id: Some(segment_id.into()),
            offset_ms: None,
            captured_at: Some(captured_at.into()),
        }
    }
    fn signal_with(references: Vec<EvidenceRef>) -> ContentSignal {
        let mut signal = ContentSignal::default();
        for reference in references {
            let target = match reference.source_kind.as_deref() {
                Some("visual" | "accessibility") => &mut signal.visual_keywords,
                Some("microphone") => &mut signal.microphone_keywords,
                _ => &mut signal.system_audio_keywords,
            };
            add_keyword_list(&reference.keywords, target);
            signal.evidence_refs.push(reference);
        }
        signal
    }
    #[test]
    fn same_context_merges_and_serialization_has_no_paths() {
        let value = build(
            vec![
                segment("b", "2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z"),
                segment("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z"),
            ],
            vec![event("2026-01-01T00:00:30Z", "Editor")],
            Utc::now(),
        );
        assert_eq!(value.chapters.len(), 1, "{:#?}", value.chapters);
        assert!(!String::from_utf8(serde_json::to_vec(&value).unwrap())
            .unwrap()
            .contains("/private/"));
    }
    #[test]
    fn persistent_context_splits_but_short_switch_does_not() {
        let a = segment("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z");
        let b = segment("b", "2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z");
        let c = segment("c", "2026-01-01T00:02:00Z", "2026-01-01T00:03:00Z");
        assert_eq!(
            build(
                vec![a.clone(), b.clone(), c.clone()],
                vec![
                    event("2026-01-01T00:00:30Z", "A"),
                    event("2026-01-01T00:01:30Z", "B"),
                    event("2026-01-01T00:02:30Z", "B")
                ],
                Utc::now()
            )
            .chapters
            .len(),
            2
        );
        assert_eq!(
            build(
                vec![a, b, c],
                vec![
                    event("2026-01-01T00:00:30Z", "A"),
                    event("2026-01-01T00:01:30Z", "B"),
                    event("2026-01-01T00:02:30Z", "A")
                ],
                Utc::now()
            )
            .chapters
            .len(),
            1
        );
    }

    #[test]
    fn multiple_short_foreground_interruptions_do_not_split_the_underlying_task() {
        let segments = vec![
            segment("before", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z"),
            segment("maps", "2026-01-01T00:01:00Z", "2026-01-01T00:01:30Z"),
            segment("message", "2026-01-01T00:01:30Z", "2026-01-01T00:02:00Z"),
            segment("after", "2026-01-01T00:02:00Z", "2026-01-01T00:03:00Z"),
        ];
        let content = BTreeMap::from([
            (
                "before".into(),
                signal_with(vec![evidence(
                    "before",
                    "ocr",
                    "visual",
                    "2026-01-01T00:00:10Z",
                    &["capability", "catalog"],
                )]),
            ),
            (
                "maps".into(),
                signal_with(vec![evidence(
                    "maps",
                    "ocr",
                    "visual",
                    "2026-01-01T00:01:05Z",
                    &["franklin", "route"],
                )]),
            ),
            (
                "message".into(),
                signal_with(vec![evidence(
                    "message",
                    "ocr",
                    "visual",
                    "2026-01-01T00:01:35Z",
                    &["compose", "message"],
                )]),
            ),
            (
                "after".into(),
                signal_with(vec![evidence(
                    "after",
                    "ocr",
                    "visual",
                    "2026-01-01T00:02:05Z",
                    &["capability", "catalog"],
                )]),
            ),
        ]);
        let manifest = build_with_pending(
            segments,
            vec![
                event("2026-01-01T00:00:01Z", "Browser"),
                event("2026-01-01T00:01:01Z", "Maps"),
                event("2026-01-01T00:01:31Z", "Messages"),
                event("2026-01-01T00:02:01Z", "Browser"),
            ],
            BTreeSet::new(),
            content,
            Utc::now(),
        );

        assert_eq!(manifest.chapters.len(), 1, "{:#?}", manifest.chapters);
    }

    #[test]
    fn window_title_churn_inside_one_foreground_app_does_not_make_micro_chapters() {
        let mut long = segment("maps", "2026-01-01T00:00:00Z", "2026-01-01T00:03:00Z");
        long.duration_ms = 180_000;
        let mut first = event("2026-01-01T00:00:05Z", "Safari");
        first.bundle_id = Some("com.apple.Safari".into());
        first.window_title = Some("Franklin - Google Maps".into());
        let mut second = event("2026-01-01T00:00:15Z", "Safari");
        second.bundle_id = Some("com.apple.Safari".into());
        second.window_title = Some("Directions to Franklin - Google Maps".into());
        let mut third = event("2026-01-01T00:00:25Z", "Safari");
        third.bundle_id = Some("com.apple.Safari".into());
        third.window_title = Some("Fishers to Franklin - Google Maps".into());

        let manifest = build(vec![long], vec![first, second, third], Utc::now());

        assert_eq!(manifest.chapters.len(), 1, "{:#?}", manifest.chapters);
    }

    #[test]
    fn first_observed_context_does_not_leave_a_tiny_open_edge_chapter() {
        let mut long = segment("edge", "2026-01-01T00:00:00Z", "2026-01-01T00:03:00Z");
        long.duration_ms = 180_000;

        let manifest = build(
            vec![long],
            vec![event("2026-01-01T00:00:05Z", "Editor")],
            Utc::now(),
        );

        assert_eq!(manifest.chapters.len(), 1, "{:#?}", manifest.chapters);
    }

    #[test]
    fn bounded_audit_does_not_leave_a_tiny_first_context_chapter() {
        let mut long = segment("edge", "2026-01-01T00:00:00Z", "2026-01-01T00:03:00Z");
        long.duration_ms = 180_000;

        let manifest = build(
            vec![long],
            vec![
                event("2026-01-01T00:00:01Z", "Browser"),
                event("2026-01-01T00:00:08Z", "Messages"),
                event("2026-01-01T00:00:24Z", "Browser"),
            ],
            Utc::now(),
        );

        assert_eq!(manifest.chapters.len(), 1, "{:#?}", manifest.chapters);
    }
    #[test]
    fn gaps_epochs_modes_and_tainted_segments_do_not_bridge() {
        let a = segment("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z");
        let mut b = segment("b", "2026-01-01T00:03:00Z", "2026-01-01T00:04:00Z");
        b.graph_epoch_id = Some("b".into());
        let mut bad = segment("bad", "2026-01-01T00:04:00Z", "2026-01-01T00:05:00Z");
        bad.exclusion_tainted = true;
        let v = build(vec![a, b, bad], vec![], Utc::now());
        assert_eq!(v.chapters.len(), 2);
        assert_eq!(v.coverage.omitted_segments, 1);
    }

    #[test]
    fn pending_indexes_are_partial_and_retention_rebuild_removes_references() {
        let a = segment("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z");
        let b = segment("b", "2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z");
        let mut pending = BTreeSet::new();
        pending.insert("a".into());
        let partial = build_with_pending(
            vec![a.clone(), b.clone()],
            vec![],
            pending,
            BTreeMap::new(),
            Utc::now(),
        );
        assert_eq!(partial.state, ChapterIndexState::Partial);
        let retained = build(vec![a], vec![], Utc::now());
        assert!(retained.chapters.iter().all(|chapter| chapter
            .segment_refs
            .iter()
            .all(|reference| reference.id != "b")));
    }

    #[test]
    fn bounded_content_keywords_are_searchable_without_raw_sidecar_bodies() {
        let segment = segment("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z");
        let mut signal = ContentSignal::default();
        add_keywords(
            "Roadmap launch planning for the customer workshop.",
            &mut signal.system_audio_keywords,
        );
        add_keywords(
            "password=ultra-secret-squirrel should never be retained",
            &mut signal.system_audio_keywords,
        );
        signal.evidence_refs.push(EvidenceRef {
            source_type: "transcript".into(),
            source_kind: Some("system-audio".into()),
            keywords: vec!["roadmap".into(), "workshop".into()],
            confidence: None,
            segment_id: Some("a".into()),
            offset_ms: Some(500),
            captured_at: Some("2026-01-01T00:00:00.500Z".into()),
        });
        let mut content = BTreeMap::new();
        content.insert("a".into(), signal);
        let manifest =
            build_with_pending(vec![segment], vec![], BTreeSet::new(), content, Utc::now());
        let serialized = String::from_utf8(serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(serialized.contains("roadmap"));
        assert!(serialized.contains("workshop"));
        assert!(serialized.contains("\"sourceType\":\"transcript\""));
        assert!(!serialized.contains("ultra-secret-squirrel"));
        assert!(!serialized.contains("password="));
        assert!(!serialized.contains("Roadmap launch planning for the customer workshop."));

        let mut mixed = BTreeMap::new();
        add_keywords(
            "Semantic chapter evaluation\nalice@example.test\nPassword: example-value",
            &mut mixed,
        );
        assert!(mixed.contains_key("semantic") && mixed.contains_key("chapter"));
        assert!(!mixed.contains_key("alice") && !mixed.contains_key("password"));
    }

    #[test]
    fn chapter_labels_do_not_repeat_the_same_word_as_three_phrases() {
        let counts = BTreeMap::from([
            ("account".into(), 10),
            ("account passed".into(), 9),
            ("account passed provisioning".into(), 8),
            ("deploy".into(), 7),
            ("preview".into(), 6),
        ]);

        assert_eq!(
            top_label_keywords(&counts, 3),
            vec!["account passed provisioning", "deploy", "preview"]
        );
    }

    #[test]
    fn accessibility_roles_and_ocr_garble_do_not_become_labels() {
        let mut context = event("2026-01-01T00:00:00Z", "WhatsApp");
        context.accessibility = Some(crate::accessibility::AccessibilityFingerprint {
            document: Some(crate::accessibility::AccessibilitySemanticNode {
                role: "AXWindow".into(),
                title: Some("WhatsApp".into()),
                description: None,
                document: None,
                url: None,
                selected_text: None,
            }),
            focused: Some(crate::accessibility::AccessibilitySemanticNode {
                role: "AXTextArea".into(),
                title: None,
                description: Some("Compose message".into()),
                document: None,
                url: None,
                selected_text: None,
            }),
            visible_labels: vec![],
        });
        let keywords = accessibility_keywords(&context);
        assert!(!keywords.contains_key("axwindow"));
        assert!(!keywords.contains_key("axtextarea"));
        assert!(keywords.contains_key("compose"));
        assert_eq!(
            top_label_keywords(
                &BTreeMap::from([
                    ("axtextarea".into(), 20),
                    ("netltfy".into(), 18),
                    ("capability catalog".into(), 3),
                    ("catalog".into(), 8),
                ]),
                2,
            ),
            vec!["capability catalog"]
        );
    }

    #[test]
    fn sustained_same_app_semantic_change_splits_fixed_scenes() {
        let origin = parse_utc("2026-01-01T00:00:00Z").unwrap();
        let mut long = segment("same-app", "2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z");
        long.duration_ms = 300_000;
        let mut references =
            repeating_evidence("same-app", "visual", origin, 5, &["custom", "blocks"]);
        references.extend(repeating_evidence(
            "same-app",
            "visual",
            origin + Duration::seconds(150),
            5,
            &["daily", "brief"],
        ));
        let signal = signal_with(references);
        let manifest = build_with_pending(
            vec![long],
            vec![event("2026-01-01T00:00:01Z", "ChatGPT")],
            BTreeSet::new(),
            BTreeMap::from([("same-app".into(), signal)]),
            Utc::now(),
        );
        assert_eq!(manifest.chapters.len(), 2, "{:#?}", manifest.chapters);
        assert!(manifest.chapters[0].keywords.contains(&"blocks".into()));
        assert!(manifest.chapters[1].keywords.contains(&"brief".into()));
    }

    #[test]
    fn cross_app_scenes_merge_when_visual_meaning_continues() {
        let browser = segment("browser", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z");
        let mail = segment("mail", "2026-01-01T00:01:00Z", "2026-01-01T00:02:00Z");
        let content = BTreeMap::from([
            (
                "browser".into(),
                signal_with(vec![evidence(
                    "browser",
                    "ocr",
                    "visual",
                    "2026-01-01T00:00:35Z",
                    &["preview", "verification"],
                )]),
            ),
            (
                "mail".into(),
                signal_with(vec![evidence(
                    "mail",
                    "ocr",
                    "visual",
                    "2026-01-01T00:01:05Z",
                    &["preview", "verification"],
                )]),
            ),
        ]);
        let manifest = build_with_pending(
            vec![browser, mail],
            vec![
                event("2026-01-01T00:00:01Z", "Browser"),
                event("2026-01-01T00:01:01Z", "Mail"),
            ],
            BTreeSet::new(),
            content,
            Utc::now(),
        );
        assert_eq!(manifest.chapters.len(), 1, "{:#?}", manifest.chapters);
    }

    #[test]
    fn unrelated_microphone_words_do_not_name_visible_work() {
        let item = segment("visual", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z");
        let signal = signal_with(vec![
            evidence(
                "visual",
                "ocr",
                "visual",
                "2026-01-01T00:00:05Z",
                &["content", "blocks"],
            ),
            evidence(
                "visual",
                "transcript",
                "microphone",
                "2026-01-01T00:00:05Z",
                &["dragons", "kingdom"],
            ),
        ]);
        let manifest = build_with_pending(
            vec![item],
            vec![event("2026-01-01T00:00:01Z", "ChatGPT")],
            BTreeSet::new(),
            BTreeMap::from([("visual".into(), signal)]),
            Utc::now(),
        );
        assert!(
            manifest.chapters[0].label.contains("blocks"),
            "{}",
            manifest.chapters[0].label
        );
        assert!(!manifest.chapters[0].label.contains("dragons"));
        assert!(!manifest.chapters[0].keywords.contains(&"kingdom".into()));
    }

    #[test]
    fn exact_gaps_and_stable_ids_survive_semantic_refinement() {
        let first = segment("first", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z");
        let second = segment("second", "2026-01-01T00:03:00Z", "2026-01-01T00:04:00Z");
        let explicit_pause = ScreenMemoryEvent {
            captured_at: "2026-01-01T00:01:00Z".into(),
            app_name: None,
            window_title: None,
            bundle_id: None,
            source: "coverage-gap".into(),
            coverage_gap_reason: Some("user-paused".into()),
            accessibility: None,
        };
        let initial = build_with_pending(
            vec![first.clone(), second.clone()],
            vec![explicit_pause.clone()],
            BTreeSet::new(),
            BTreeMap::new(),
            Utc::now(),
        );
        assert_eq!(initial.coverage.gap_count, 1);
        assert_eq!(initial.coverage.gaps[0].duration_ms, 120_000);
        assert_eq!(initial.coverage.gaps[0].reason, "user-paused");
        let refined = build_with_previous(
            vec![first, second],
            vec![explicit_pause],
            BTreeSet::new(),
            BTreeMap::from([(
                "first".into(),
                signal_with(vec![evidence(
                    "first",
                    "ocr",
                    "visual",
                    "2026-01-01T00:00:05Z",
                    &["roadmap"],
                )]),
            )]),
            Some(&initial),
            Utc::now(),
        );
        assert_eq!(refined.chapters[0].id, initial.chapters[0].id);
        assert!(refined.chapters[0].revision > initial.chapters[0].revision);
        assert_eq!(refined.coverage.gaps[0].duration_ms, 120_000);
    }

    #[test]
    fn representative_moments_cover_diverse_scenes_with_budget_warning() {
        let mut long = segment("long", "2026-01-01T00:00:00Z", "2026-01-01T00:04:00Z");
        long.duration_ms = 240_000;
        let manifest = build(vec![long], vec![], Utc::now());
        let chapter = &manifest.chapters[0];
        assert_eq!(
            chapter.representative_moments.len(),
            MAX_REPRESENTATIVE_MOMENTS
        );
        assert_eq!(chapter.representative_coverage.total_scenes, 8);
        assert!(chapter.representative_coverage.truncated);
        assert_eq!(chapter.representative_moments[0].reason, "chapter start");
        assert_eq!(
            chapter.representative_moments.last().unwrap().reason,
            "chapter end"
        );
    }

    #[test]
    fn ocr_near_miss_of_generic_product_word_does_not_name_a_chapter() {
        let counts = BTreeMap::from([
            ("agent native conlent".into(), 8),
            ("conlent".into(), 8),
            ("semantic".into(), 5),
            ("chapters".into(), 5),
        ]);
        let labels = top_label_keywords(&counts, 3);
        assert_eq!(labels, vec!["chapters", "semantic"]);
        assert!(top_label_keywords(
            &BTreeMap::from([("chatgpt".into(), 10), ("axwindow".into(), 10)]),
            3
        )
        .is_empty());
    }

    fn long_segment(id: &str, start: &str, end: &str) -> ScreenMemorySegmentMetadata {
        let mut value = segment(id, start, end);
        value.duration_ms = (parse_utc(end).unwrap() - parse_utc(start).unwrap())
            .num_milliseconds()
            .try_into()
            .unwrap();
        value
    }

    fn repeating_evidence(
        segment_id: &str,
        source_kind: &str,
        start: DateTime<Utc>,
        count: usize,
        words: &[&str],
    ) -> Vec<EvidenceRef> {
        (0..count)
            .map(|index| {
                evidence(
                    segment_id,
                    if source_kind == "visual" {
                        "ocr"
                    } else {
                        "transcript"
                    },
                    source_kind,
                    &(start + Duration::seconds(index as i64 * 30 + 5)).to_rfc3339(),
                    words,
                )
            })
            .collect()
    }

    fn boundary_offsets(manifest: &RewindChaptersManifest, origin: DateTime<Utc>) -> Vec<i64> {
        manifest
            .chapters
            .iter()
            .skip(1)
            .filter_map(|chapter| parse_utc(&chapter.started_at))
            .map(|started_at| (started_at - origin).num_milliseconds())
            .collect()
    }

    fn boundary_score(
        predicted: &[i64],
        expected: &[i64],
        tolerance_ms: i64,
    ) -> (usize, usize, usize) {
        let mut used = vec![false; expected.len()];
        let matched = predicted
            .iter()
            .filter(|prediction| {
                expected
                    .iter()
                    .enumerate()
                    .filter(|(index, _)| !used[*index])
                    .min_by_key(|(_, boundary)| (*prediction - **boundary).abs())
                    .filter(|(_, boundary)| (*prediction - **boundary).abs() <= tolerance_ms)
                    .map(|(index, _)| {
                        used[index] = true;
                    })
                    .is_some()
            })
            .count();
        (matched, predicted.len(), expected.len())
    }

    #[test]
    fn three_repository_safe_gold_samples_meet_boundary_precision_and_recall_gate() {
        // These hand-authored annotations preserve only the timing and topic
        // shape of the private dogfood cases: cross-app continuation, a
        // same-app topic change, and a short interruption plus a hard gap.
        let origin = parse_utc("2026-01-01T00:00:00Z").unwrap();

        let cross_app_segments = vec![
            long_segment("browser-a", "2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z"),
            long_segment("mail", "2026-01-01T00:05:00Z", "2026-01-01T00:10:00Z"),
            long_segment("browser-b", "2026-01-01T00:10:00Z", "2026-01-01T00:15:00Z"),
        ];
        let cross_app_content = BTreeMap::from([
            (
                "browser-a".into(),
                signal_with(repeating_evidence(
                    "browser-a",
                    "visual",
                    origin,
                    10,
                    &["account", "verification"],
                )),
            ),
            (
                "mail".into(),
                signal_with(repeating_evidence(
                    "mail",
                    "visual",
                    origin + Duration::minutes(5),
                    10,
                    &["account", "verification"],
                )),
            ),
            (
                "browser-b".into(),
                signal_with(repeating_evidence(
                    "browser-b",
                    "visual",
                    origin + Duration::minutes(10),
                    10,
                    &["account", "verification"],
                )),
            ),
        ]);
        let cross_app = build_with_pending(
            cross_app_segments,
            vec![
                event("2026-01-01T00:00:00Z", "Browser"),
                event("2026-01-01T00:05:00Z", "Mail"),
                event("2026-01-01T00:10:00Z", "Browser"),
            ],
            BTreeSet::new(),
            cross_app_content,
            Utc::now(),
        );

        let same_app_segment =
            long_segment("agent", "2026-01-01T00:00:00Z", "2026-01-01T00:15:00Z");
        let mut same_app_refs =
            repeating_evidence("agent", "visual", origin, 15, &["release", "roadmap"]);
        same_app_refs.extend(repeating_evidence(
            "agent",
            "visual",
            origin + Duration::seconds(450),
            15,
            &["customer", "interview"],
        ));
        let same_app = build_with_pending(
            vec![same_app_segment],
            vec![event("2026-01-01T00:00:00Z", "Agent")],
            BTreeSet::new(),
            BTreeMap::from([("agent".into(), signal_with(same_app_refs))]),
            Utc::now(),
        );

        let interrupted_segments = vec![
            long_segment("before-gap", "2026-01-01T00:00:00Z", "2026-01-01T00:10:00Z"),
            long_segment("after-gap", "2026-01-01T00:11:00Z", "2026-01-01T00:20:00Z"),
        ];
        let mut before_gap =
            repeating_evidence("before-gap", "visual", origin, 20, &["privacy", "review"]);
        before_gap.extend(repeating_evidence(
            "before-gap",
            "microphone",
            origin,
            20,
            &["dragon", "kingdom"],
        ));
        let interrupted = build_with_pending(
            interrupted_segments,
            vec![
                event("2026-01-01T00:00:00Z", "Editor"),
                event("2026-01-01T00:05:00Z", "Messages"),
                event("2026-01-01T00:05:30Z", "Editor"),
                event("2026-01-01T00:11:00Z", "Terminal"),
            ],
            BTreeSet::new(),
            BTreeMap::from([
                ("before-gap".into(), signal_with(before_gap)),
                (
                    "after-gap".into(),
                    signal_with(repeating_evidence(
                        "after-gap",
                        "visual",
                        origin + Duration::minutes(11),
                        18,
                        &["chapter", "tests"],
                    )),
                ),
            ]),
            Utc::now(),
        );

        let scored = [
            (boundary_offsets(&cross_app, origin), vec![]),
            (boundary_offsets(&same_app, origin), vec![450_000]),
            (boundary_offsets(&interrupted, origin), vec![660_000]),
        ];
        let (mut matched, mut predicted, mut expected) = (0, 0, 0);
        for (actual, annotated) in scored {
            let score = boundary_score(&actual, &annotated, 30_000);
            matched += score.0;
            predicted += score.1;
            expected += score.2;
        }
        let precision = matched as f32 / predicted.max(1) as f32;
        let recall = matched as f32 / expected.max(1) as f32;
        assert!(
            precision >= 0.8,
            "precision={precision}, predicted={predicted}"
        );
        assert!(recall >= 0.8, "recall={recall}, expected={expected}");
        assert_eq!(cross_app.chapters.len(), 1, "{:#?}", cross_app.chapters);
        let recognizable_titles = [
            cross_app.chapters[0].label.contains("verification"),
            same_app.chapters[0].label.contains("roadmap"),
            same_app.chapters[1].label.contains("interview"),
            interrupted.chapters[0].label.contains("privacy"),
            interrupted.chapters[1].label.contains("chapter"),
        ];
        assert!(
            recognizable_titles.iter().filter(|clear| **clear).count() as f32
                / recognizable_titles.len() as f32
                >= 0.8,
            "gold titles: cross_app={:?}, same_app={:?}, interrupted={:?}",
            cross_app
                .chapters
                .iter()
                .map(|chapter| &chapter.label)
                .collect::<Vec<_>>(),
            same_app
                .chapters
                .iter()
                .map(|chapter| &chapter.label)
                .collect::<Vec<_>>(),
            interrupted
                .chapters
                .iter()
                .map(|chapter| &chapter.label)
                .collect::<Vec<_>>(),
        );
        assert!(!interrupted.chapters[0].label.contains("dragon"));
    }

    /// Read-only dogfood harness. It is ignored unless a developer explicitly
    /// supplies a local Screen Memory directory; no archive path is committed.
    #[test]
    #[ignore = "requires CLIPS_REWIND_AUDIT_DIR and prints local derived evidence"]
    fn audits_an_explicit_local_store_without_rewriting_it() {
        let directory = std::env::var_os("CLIPS_REWIND_AUDIT_DIR")
            .map(PathBuf::from)
            .expect("set CLIPS_REWIND_AUDIT_DIR");
        let minutes = std::env::var("CLIPS_REWIND_AUDIT_MINUTES")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(20)
            .clamp(1, 120);
        let mut all_segments = fs::read_dir(&directory)
            .expect("read audit directory")
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                (path.extension().and_then(|value| value.to_str()) == Some("json"))
                    .then(|| fs::read(path).ok())
                    .flatten()
                    .and_then(|bytes| {
                        serde_json::from_slice::<ScreenMemorySegmentMetadata>(&bytes).ok()
                    })
            })
            .collect::<Vec<_>>();
        let newest_end = all_segments
            .iter()
            .filter_map(|segment| parse_utc(&segment.ended_at))
            .max()
            .expect("at least one segment");
        let audit_end = std::env::var("CLIPS_REWIND_AUDIT_END_AT")
            .ok()
            .and_then(|value| parse_utc(&value))
            .unwrap_or(newest_end);
        let cutoff = audit_end - Duration::minutes(minutes);
        all_segments.retain(|segment| {
            parse_utc(&segment.started_at).is_some_and(|started_at| started_at <= audit_end)
                && parse_utc(&segment.ended_at).is_some_and(|ended_at| ended_at >= cutoff)
        });
        for segment in &mut all_segments {
            let started_at = parse_utc(&segment.started_at).unwrap_or(cutoff).max(cutoff);
            let ended_at = parse_utc(&segment.ended_at)
                .unwrap_or(audit_end)
                .min(audit_end);
            segment.started_at = started_at.to_rfc3339();
            segment.ended_at = ended_at.to_rfc3339();
            segment.duration_ms = (ended_at - started_at).num_milliseconds().max(0) as u128;
        }
        let events = File::open(directory.join("events.jsonl"))
            .ok()
            .into_iter()
            .flat_map(|file| BufReader::new(file).lines().map_while(Result::ok))
            .filter_map(|line| serde_json::from_str::<ScreenMemoryEvent>(&line).ok())
            .filter(|event| {
                parse_utc(&event.captured_at).is_some_and(|at| at >= cutoff && at <= audit_end)
            })
            .collect::<Vec<_>>();
        let content = content_signals(&directory, &all_segments);
        let manifest =
            build_with_pending(all_segments, events, BTreeSet::new(), content, Utc::now());
        let report = serde_json::json!({
            "coverage": manifest.coverage,
            "chapters": manifest.chapters.iter().map(|chapter| serde_json::json!({
                "id": chapter.id,
                "startedAt": chapter.started_at,
                "endedAt": chapter.ended_at,
                "label": chapter.label,
                "keywords": chapter.keywords,
                "sceneCount": chapter.scene_refs.len(),
                "representativeCoverage": chapter.representative_coverage,
                "ambiguityReasons": chapter.ambiguity_reasons,
            })).collect::<Vec<_>>(),
        });
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
    }
}
