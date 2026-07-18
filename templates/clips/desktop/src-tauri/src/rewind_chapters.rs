//! Retention-bound, local-only work chapters for the Rewind buffer.
//!
//! This deliberately stores references and bounded context only. Segments remain
//! the retention authority; a missing or invalid chapter manifest is disposable.

#[cfg(test)]
use crate::config::RewindCaptureMode;
use crate::screen_memory::{ScreenMemoryEvent, ScreenMemorySegmentMetadata};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

const CHAPTERS_FILE: &str = "chapters.json";
const GAP_MS: i64 = 75_000;
const MAX_SPAN_MS: i64 = 20 * 60 * 1_000;
const MIN_CHAPTER_MS: i64 = 60_000;
const MAX_KEYWORDS: usize = 8;
const MAX_EVIDENCE_REFS_PER_SOURCE: usize = 8;
const MAX_SIDECAR_ROWS: usize = 128;
const MAX_SIDECAR_LINE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindChaptersManifest {
    pub schema_version: u32,
    pub generated_at: String,
    pub state: ChapterIndexState,
    pub coverage: ChapterCoverage,
    pub chapters: Vec<RewindChapter>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ChapterIndexState {
    Pending,
    Partial,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterCoverage {
    pub retained_segments: usize,
    pub omitted_segments: usize,
    pub gap_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindChapter {
    pub id: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: i64,
    pub label: String,
    pub summary: String,
    pub keywords: Vec<String>,
    pub confidence: f32,
    pub segment_refs: Vec<SegmentRef>,
    pub evidence_refs: Vec<EvidenceRef>,
    pub contexts: Vec<ChapterContext>,
    pub representative_moments: Vec<RepresentativeMoment>,
    pub ambiguity_reasons: Vec<String>,
    pub index_state: ChapterIndexState,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SegmentRef {
    pub id: String,
    pub started_at: String,
    pub ended_at: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EvidenceRef {
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
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
    context: Option<ChapterContext>,
    partial: bool,
    content: ContentSignal,
}

#[derive(Clone, Default)]
struct ContentSignal {
    keywords: BTreeMap<String, usize>,
    evidence_refs: Vec<EvidenceRef>,
}

pub(crate) fn rebuild(
    dir: &Path,
    segments: Vec<ScreenMemorySegmentMetadata>,
    events: Vec<ScreenMemoryEvent>,
) -> Result<(), String> {
    let content = content_signals(dir, &segments);
    let manifest = build_with_pending(
        segments,
        events,
        pending_segment_ids(dir),
        content,
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
    mut events: Vec<ScreenMemoryEvent>,
    pending: BTreeSet<String>,
    content: BTreeMap<String, ContentSignal>,
    generated_at: DateTime<Utc>,
) -> RewindChaptersManifest {
    events.sort_by(|a, b| a.captured_at.cmp(&b.captured_at));
    let mut omitted = 0usize;
    let mut items = segments
        .into_iter()
        .filter_map(|segment| {
            if segment.exclusion_tainted || segment.corrupt || segment.error.is_some() {
                omitted += 1;
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
            let context = context_for(&events, start, end);
            let partial = pending.contains(&segment.id);
            let content = content.get(&segment.id).cloned().unwrap_or_default();
            Some(Item {
                segment,
                start,
                end,
                context,
                partial,
                content,
            })
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| (a.start, &a.segment.id).cmp(&(b.start, &b.segment.id)));
    let retained = items.len();
    let mut groups: Vec<Vec<Item>> = Vec::new();
    for index in 0..items.len() {
        let item = items[index].clone();
        let split = groups
            .last()
            .is_some_and(|group| should_split(group, &item, items.get(index + 1)));
        if split {
            groups.push(vec![item]);
        } else if let Some(group) = groups.last_mut() {
            group.push(item);
        } else {
            groups.push(vec![item]);
        }
    }
    // A transient context switch is already suppressed by look-ahead; retain
    // conservative short chapters only when a hard coverage boundary forced it.
    let chapters = groups
        .into_iter()
        .filter(|g| duration(g) >= MIN_CHAPTER_MS || g.len() > 1)
        .enumerate()
        .map(|(i, g)| chapter(i, g))
        .collect::<Vec<_>>();
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
        schema_version: 1,
        generated_at: generated_at.to_rfc3339(),
        state,
        coverage: ChapterCoverage {
            retained_segments: retained,
            omitted_segments: omitted,
            gap_count: omitted,
        },
        chapters,
    }
}

fn should_split(group: &[Item], next: &Item, following: Option<&Item>) -> bool {
    let previous = group.last().expect("nonempty chapter group");
    let hard = previous.segment.graph_epoch_id != next.segment.graph_epoch_id
        || previous.segment.capture_mode != next.segment.capture_mode
        || (next.start - previous.end).num_milliseconds() > GAP_MS;
    hard || (next.end - group[0].start).num_milliseconds() > MAX_SPAN_MS
        || context_changed_persistently(previous, next, following)
}
fn context_changed_persistently(previous: &Item, next: &Item, following: Option<&Item>) -> bool {
    previous.context != next.context
        && next.context.is_some()
        && following.is_some_and(|later| later.context == next.context)
}
fn duration(group: &[Item]) -> i64 {
    (group.last().unwrap().end - group[0].start).num_milliseconds()
}
fn context_for(
    events: &[ScreenMemoryEvent],
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Option<ChapterContext> {
    events
        .iter()
        .filter_map(|event| {
            let at = DateTime::parse_from_rfc3339(&event.captured_at)
                .ok()?
                .with_timezone(&Utc);
            (at >= start && at <= end).then_some((at, event))
        })
        .max_by_key(|(at, _)| *at)
        .map(|(_, e)| ChapterContext {
            app_name: e.app_name.clone(),
            window_title: e.window_title.clone(),
            bundle_id: e.bundle_id.clone(),
        })
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
        if let Some(text) = text {
            add_keywords(text, &mut signal.keywords);
        }
        signal.evidence_refs.push(EvidenceRef {
            source_type: source_type.into(),
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

fn add_keywords(text: &str, keywords: &mut BTreeMap<String, usize>) {
    let lower = text.to_ascii_lowercase();
    // Credential-looking lines never become durable search terms.
    if [
        "password",
        "secret",
        "api key",
        "api_key",
        "access token",
        "bearer",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return;
    }
    for word in lower.split(|character: char| !character.is_ascii_alphabetic()) {
        if word.len() < 4 || word.len() > 32 || STOP_WORDS.contains(&word) {
            continue;
        }
        *keywords.entry(word.to_owned()).or_default() += 1;
    }
}

const STOP_WORDS: &[&str] = &[
    "about", "after", "again", "also", "been", "could", "from", "have", "into", "just", "like",
    "more", "most", "only", "that", "their", "there", "these", "they", "this", "through", "using",
    "were", "what", "when", "with", "would", "your",
];

fn chapter(index: usize, group: Vec<Item>) -> RewindChapter {
    let first = &group[0];
    let last = group.last().unwrap();
    let mut contexts = group
        .iter()
        .filter_map(|item| item.context.clone())
        .collect::<Vec<_>>();
    contexts.sort_by(|a, b| format!("{:?}", a).cmp(&format!("{:?}", b)));
    contexts.dedup();
    let dominant = contexts.first().cloned();
    let label = dominant
        .as_ref()
        .and_then(|c| c.window_title.clone().or(c.app_name.clone()))
        .unwrap_or_else(|| "Recent work".into());
    let partial = group.iter().any(|item| item.partial);
    let mut evidence_refs = Vec::new();
    let mut keyword_counts: BTreeMap<String, usize> = BTreeMap::new();
    for _context in &contexts {
        evidence_refs.push(EvidenceRef {
            source_type: "app-context".into(),
            segment_id: None,
            offset_ms: None,
            captured_at: Some(first.segment.started_at.clone()),
        });
    }
    for item in &group {
        for (keyword, count) in &item.content.keywords {
            *keyword_counts.entry(keyword.clone()).or_default() += count;
        }
        evidence_refs.extend(item.content.evidence_refs.clone());
    }
    evidence_refs.sort_by(|a, b| {
        (&a.source_type, &a.segment_id, &a.offset_ms, &a.captured_at).cmp(&(
            &b.source_type,
            &b.segment_id,
            &b.offset_ms,
            &b.captured_at,
        ))
    });
    evidence_refs.dedup_by(|a, b| {
        a.source_type == b.source_type
            && a.segment_id == b.segment_id
            && a.offset_ms == b.offset_ms
            && a.captured_at == b.captured_at
    });
    let mut refs_by_source: BTreeMap<String, Vec<EvidenceRef>> = BTreeMap::new();
    for reference in evidence_refs {
        refs_by_source
            .entry(reference.source_type.clone())
            .or_default()
            .push(reference);
    }
    let evidence_refs = refs_by_source
        .into_values()
        .flat_map(|references| {
            if references.len() <= MAX_EVIDENCE_REFS_PER_SOURCE {
                return references;
            }
            (0..MAX_EVIDENCE_REFS_PER_SOURCE)
                .map(|index| {
                    let source_index =
                        index * (references.len() - 1) / (MAX_EVIDENCE_REFS_PER_SOURCE - 1);
                    references[source_index].clone()
                })
                .collect()
        })
        .collect();
    let mut keywords = keyword_counts.into_iter().collect::<Vec<_>>();
    keywords.sort_by(|(left_keyword, left_count), (right_keyword, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_keyword.cmp(right_keyword))
    });
    let keywords = keywords
        .into_iter()
        .take(MAX_KEYWORDS)
        .map(|(keyword, _)| keyword)
        .collect::<Vec<_>>();
    let representative = RepresentativeMoment {
        moment_id: format!("chapter-{}-start", index + 1),
        captured_at: first.segment.started_at.clone(),
        segment_id: first.segment.id.clone(),
        offset_ms: 0,
        reason: "chapter start".into(),
    };
    RewindChapter {
        id: format!("chapter-{}-{}", index + 1, first.segment.id),
        started_at: first.segment.started_at.clone(),
        ended_at: last.segment.ended_at.clone(),
        duration_ms: duration(&group),
        summary: if keywords.is_empty() {
            format!("Work in {label}.")
        } else {
            format!(
                "Work in {label}; local evidence mentions {}.",
                keywords.join(", ")
            )
        },
        keywords,
        label,
        confidence: if contexts.is_empty() { 0.35 } else { 0.65 },
        segment_refs: group
            .iter()
            .map(|item| SegmentRef {
                id: item.segment.id.clone(),
                started_at: item.segment.started_at.clone(),
                ended_at: item.segment.ended_at.clone(),
            })
            .collect(),
        evidence_refs,
        contexts,
        representative_moments: vec![representative],
        ambiguity_reasons: if partial {
            vec!["local indexing is still catching up".into()]
        } else if dominant.is_none() {
            vec!["no foreground-app context was retained".into()]
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
        }
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
        assert_eq!(value.chapters.len(), 1);
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
            &mut signal.keywords,
        );
        add_keywords(
            "password=ultra-secret-squirrel should never be retained",
            &mut signal.keywords,
        );
        signal.evidence_refs.push(EvidenceRef {
            source_type: "transcript".into(),
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
    }
}
