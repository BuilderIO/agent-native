//! Local validation and activity trail for bounded Rewind evidence.
//!
//! This module never sends a network request. It only validates a bounded text
//! packet and records intent before a future caller is allowed to send it.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const EGRESS_LOG_NAME: &str = "egress.jsonl";
const MAX_QUESTION_CHARS: usize = 4_000;
const MAX_EVIDENCE_ITEMS: usize = 20;
const MAX_EXCERPT_CHARS: usize = 1_200;
const MAX_ID_CHARS: usize = 200;
const MAX_TIMESTAMP_CHARS: usize = 80;
const MAX_ERROR_CHARS: usize = 1_000;
const MAX_LIST_LIMIT: usize = 500;

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);
static EGRESS_IO_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RewindEvidenceSource {
    AppContext,
    Transcript,
    Ocr,
    Chapter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindEvidenceForEgress {
    pub id: String,
    pub moment_id: String,
    pub source_type: RewindEvidenceSource,
    pub captured_at: Option<String>,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindEvidencePacket {
    pub question: String,
    pub evidence: Vec<RewindEvidenceForEgress>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RewindEgressState {
    Prepared,
    Completed,
    Failed,
    LocalEvidenceRead,
    HandoffRequested,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindEgressEvent {
    pub request_id: String,
    pub occurred_at: String,
    pub state: RewindEgressState,
    #[serde(default)]
    pub packet: Option<RewindEvidencePacket>,
    #[serde(default)]
    pub operation: Option<String>,
    #[serde(default)]
    pub receipt: Option<Value>,
    pub evidence_count: usize,
    #[serde(default)]
    pub packet_bytes: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindEgressPrepared {
    pub request_id: String,
    pub packet: RewindEvidencePacket,
    pub evidence_count: usize,
    pub packet_bytes: usize,
}

struct EgressStore {
    path: PathBuf,
}

impl EgressStore {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn append(&self, event: &RewindEgressEvent) -> Result<(), String> {
        let _guard = EGRESS_IO_LOCK
            .lock()
            .map_err(|err| format!("Rewind egress log lock failed: {err}"))?;
        self.append_unlocked(event)
    }

    fn append_unlocked(&self, event: &RewindEgressEvent) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Rewind egress log directory unavailable: {err}"))?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|err| format!("Rewind egress log unavailable: {err}"))?;
        serde_json::to_writer(&mut file, event)
            .map_err(|err| format!("Rewind egress event encoding failed: {err}"))?;
        file.write_all(b"\n")
            .and_then(|_| file.flush())
            .map_err(|err| format!("Rewind egress event write failed: {err}"))
    }

    fn scrub_legacy_content(&self) -> Result<(), String> {
        let _guard = EGRESS_IO_LOCK
            .lock()
            .map_err(|err| format!("Rewind egress log lock failed: {err}"))?;
        if !self.path.exists() {
            return Ok(());
        }
        let file = File::open(&self.path)
            .map_err(|err| format!("Rewind egress log unavailable: {err}"))?;
        let mut changed = false;
        let events = BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| {
                let mut event: Value = serde_json::from_str(&line).ok()?;
                let object = event.as_object_mut()?;
                if let Some(packet) = object.remove("packet") {
                    changed = true;
                    if !object.contains_key("receipt") {
                        let evidence = packet
                            .get("evidence")
                            .and_then(Value::as_array)
                            .map(|items| {
                                items
                                    .iter()
                                    .map(|item| {
                                        json!({
                                            "id": item.get("id"),
                                            "momentId": item.get("momentId"),
                                            "sourceType": item.get("sourceType"),
                                            "capturedAt": item.get("capturedAt").unwrap_or(&Value::Null),
                                        })
                                    })
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        object.insert("receipt".to_string(), json!({ "evidence": evidence }));
                    }
                }
                if object.remove("reason").is_some() {
                    changed = true;
                }
                object
                    .entry("packetBytes".to_string())
                    .or_insert(json!(0));
                Some(event)
            })
            .collect::<Vec<_>>();
        if !changed {
            return Ok(());
        }
        let temporary_path = self
            .path
            .with_extension(format!("jsonl.sanitize-{}", std::process::id()));
        let mut temporary = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|err| format!("Rewind egress migration unavailable: {err}"))?;
        for event in events {
            serde_json::to_writer(&mut temporary, &event)
                .map_err(|err| format!("Rewind egress migration encoding failed: {err}"))?;
            temporary
                .write_all(b"\n")
                .map_err(|err| format!("Rewind egress migration write failed: {err}"))?;
        }
        temporary
            .flush()
            .map_err(|err| format!("Rewind egress migration write failed: {err}"))?;
        std::fs::rename(&temporary_path, &self.path)
            .map_err(|err| format!("Rewind egress migration failed: {err}"))
    }

    fn read_all(&self) -> Result<Vec<RewindEgressEvent>, String> {
        let _guard = EGRESS_IO_LOCK
            .lock()
            .map_err(|err| format!("Rewind egress log lock failed: {err}"))?;
        self.read_all_unlocked()
    }

    fn read_all_unlocked(&self) -> Result<Vec<RewindEgressEvent>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let file = File::open(&self.path)
            .map_err(|err| format!("Rewind egress log unavailable: {err}"))?;
        Ok(BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str(&line).ok())
            .collect())
    }

    fn terminal_event(
        &self,
        request_id: &str,
        state: RewindEgressState,
        error: Option<String>,
    ) -> Result<RewindEgressEvent, String> {
        validate_id("request id", request_id)?;
        let _guard = EGRESS_IO_LOCK
            .lock()
            .map_err(|err| format!("Rewind egress log lock failed: {err}"))?;
        let events = self.read_all_unlocked()?;
        let prepared = events.iter().find(|event| {
            event.request_id == request_id && event.state == RewindEgressState::Prepared
        });
        let Some(prepared) = prepared else {
            return Err("Unknown Rewind egress request id.".to_string());
        };
        if events.iter().any(|event| {
            event.request_id == request_id && event.state != RewindEgressState::Prepared
        }) {
            return Err("Rewind egress request is already complete.".to_string());
        }
        let event = RewindEgressEvent {
            request_id: request_id.to_string(),
            occurred_at: now_iso(),
            state,
            packet: None,
            operation: prepared.operation.clone(),
            receipt: None,
            evidence_count: prepared.evidence_count,
            packet_bytes: prepared.packet_bytes,
            error,
        };
        self.append_unlocked(&event)?;
        Ok(event)
    }
}

fn egress_store(app: &AppHandle) -> Result<EgressStore, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("app data directory unavailable: {err}"))?
        .join("screen-memory");
    let store = EgressStore::new(dir.join(EGRESS_LOG_NAME));
    store.scrub_legacy_content()?;
    Ok(store)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn next_request_id() -> String {
    let counter = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("egress-{}-{counter}", Utc::now().timestamp_millis())
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

fn validate_id(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() || char_count(value) > MAX_ID_CHARS {
        return Err(format!("{label} must be 1-{MAX_ID_CHARS} characters."));
    }
    Ok(())
}

fn contains_encoded_media(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    ["data:image/", "data:video/", "data:audio/", ";base64,"]
        .iter()
        .any(|marker| value.contains(marker))
}

fn looks_like_credential_token(value: &str) -> bool {
    let trimmed = value.trim_matches(|ch: char| {
        ch.is_ascii_whitespace() || matches!(ch, ',' | ';' | '"' | '\'' | '(' | ')' | '[' | ']')
    });
    (trimmed.starts_with("sk-") && trimmed.len() >= 15)
        || (["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]
            .iter()
            .any(|prefix| trimmed.starts_with(prefix))
            && trimmed.len() >= 16)
        || (trimmed.starts_with("AKIA")
            && trimmed.len() == 20
            && trimmed
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit()))
}

fn redact_obvious_credentials(value: &str) -> String {
    let mut redact_next_bearer = false;
    value
        .split_whitespace()
        .map(|token| {
            if redact_next_bearer {
                redact_next_bearer = false;
                return "[REDACTED]".to_string();
            }
            if token.eq_ignore_ascii_case("bearer") {
                redact_next_bearer = true;
                return token.to_string();
            }
            let lower = token.to_ascii_lowercase();
            let assignment = [
                "api_key=",
                "api-key=",
                "access_token=",
                "access-token=",
                "password=",
                "secret=",
            ]
            .iter()
            .find(|prefix| lower.starts_with(**prefix));
            if let Some(prefix) = assignment {
                return format!("{}[REDACTED]", &token[..prefix.len()]);
            }
            if looks_like_credential_token(token) {
                "[REDACTED CREDENTIAL]".to_string()
            } else {
                token.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn validate_packet(
    mut packet: RewindEvidencePacket,
    includes_frames: bool,
) -> Result<RewindEvidencePacket, String> {
    if includes_frames {
        return Err(
            "Frame egress requires per-question approval and is not supported by this text gate."
                .to_string(),
        );
    }
    packet.question = packet.question.trim().to_string();
    if packet.question.is_empty() || char_count(&packet.question) > MAX_QUESTION_CHARS {
        return Err(format!(
            "Question must be 1-{MAX_QUESTION_CHARS} characters."
        ));
    }
    if contains_encoded_media(&packet.question) {
        return Err("Rewind text packets cannot contain encoded media.".to_string());
    }
    packet.question = redact_obvious_credentials(&packet.question);
    if packet.evidence.is_empty() || packet.evidence.len() > MAX_EVIDENCE_ITEMS {
        return Err(format!(
            "Evidence packet must contain 1-{MAX_EVIDENCE_ITEMS} text items."
        ));
    }
    for evidence in &mut packet.evidence {
        evidence.id = evidence.id.trim().to_string();
        evidence.moment_id = evidence.moment_id.trim().to_string();
        evidence.excerpt = evidence.excerpt.trim().to_string();
        validate_id("Evidence id", &evidence.id)?;
        validate_id("Moment id", &evidence.moment_id)?;
        if evidence.excerpt.is_empty() || char_count(&evidence.excerpt) > MAX_EXCERPT_CHARS {
            return Err(format!(
                "Evidence excerpt must be 1-{MAX_EXCERPT_CHARS} characters."
            ));
        }
        if contains_encoded_media(&evidence.excerpt) {
            return Err("Rewind text packets cannot contain encoded media.".to_string());
        }
        evidence.excerpt = redact_obvious_credentials(&evidence.excerpt);
        if let Some(timestamp) = &mut evidence.captured_at {
            *timestamp = timestamp.trim().to_string();
            if timestamp.is_empty() || char_count(timestamp) > MAX_TIMESTAMP_CHARS {
                return Err("Evidence timestamp is invalid.".to_string());
            }
            chrono::DateTime::parse_from_rfc3339(timestamp)
                .map_err(|_| "Evidence timestamp must be RFC3339.".to_string())?;
        }
    }
    Ok(packet)
}

fn prepare_evidence(
    store: &EgressStore,
    packet: RewindEvidencePacket,
    includes_frames: bool,
) -> Result<RewindEgressPrepared, String> {
    let packet = validate_packet(packet, includes_frames)?;
    let packet_bytes = serde_json::to_vec(&packet)
        .map_err(|err| format!("Rewind evidence packet encoding failed: {err}"))?
        .len();
    let request_id = next_request_id();
    let event = RewindEgressEvent {
        request_id: request_id.clone(),
        occurred_at: now_iso(),
        state: RewindEgressState::Prepared,
        packet: None,
        operation: Some("agent-query".to_string()),
        receipt: Some(json!({
            "evidence": packet.evidence.iter().map(|evidence| json!({
                "id": evidence.id,
                "momentId": evidence.moment_id,
                "sourceType": evidence.source_type,
                "capturedAt": evidence.captured_at,
            })).collect::<Vec<_>>(),
        })),
        evidence_count: packet.evidence.len(),
        packet_bytes,
        error: None,
    };
    // This durable append is deliberately before the packet is returned to a
    // caller that might send it.
    store.append(&event)?;
    Ok(RewindEgressPrepared {
        request_id,
        evidence_count: packet.evidence.len(),
        packet_bytes,
        packet,
    })
}

#[tauri::command]
pub async fn rewind_prepare_evidence_egress(
    app: AppHandle,
    packet: RewindEvidencePacket,
    includes_frames: Option<bool>,
) -> Result<RewindEgressPrepared, String> {
    prepare_evidence(
        &egress_store(&app)?,
        packet,
        includes_frames.unwrap_or(false),
    )
}

#[tauri::command]
pub async fn rewind_complete_evidence_egress(
    app: AppHandle,
    request_id: String,
) -> Result<RewindEgressEvent, String> {
    egress_store(&app)?.terminal_event(&request_id, RewindEgressState::Completed, None)
}

#[tauri::command]
pub async fn rewind_fail_evidence_egress(
    app: AppHandle,
    request_id: String,
    error: String,
) -> Result<RewindEgressEvent, String> {
    let error = error.trim();
    if error.is_empty() || char_count(error) > MAX_ERROR_CHARS {
        return Err(format!("Error must be 1-{MAX_ERROR_CHARS} characters."));
    }
    egress_store(&app)?.terminal_event(
        &request_id,
        RewindEgressState::Failed,
        Some(error.to_string()),
    )
}

#[tauri::command]
pub async fn rewind_list_evidence_egress(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<RewindEgressEvent>, String> {
    let mut events = egress_store(&app)?.read_all()?;
    events.reverse();
    events.truncate(limit.unwrap_or(100).clamp(1, MAX_LIST_LIMIT));
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> EgressStore {
        let dir = std::env::temp_dir().join(format!(
            "clips-rewind-egress-{name}-{}-{}",
            std::process::id(),
            REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        EgressStore::new(dir.join(EGRESS_LOG_NAME))
    }

    fn packet() -> RewindEvidencePacket {
        RewindEvidencePacket {
            question: "What happened?".to_string(),
            evidence: vec![RewindEvidenceForEgress {
                id: "evidence-1".to_string(),
                moment_id: "moment-1".to_string(),
                source_type: RewindEvidenceSource::Transcript,
                captured_at: Some("2026-07-14T12:00:00Z".to_string()),
                excerpt: "A bounded local excerpt.".to_string(),
            }],
        }
    }

    #[test]
    fn redacts_obvious_credentials_before_logging_or_returning_packets() {
        let store = temp_store("redaction");
        let mut packet = packet();
        packet.evidence[0].excerpt =
            "api_key=super-secret Bearer abcdefghijklmnop sk-abcdefghijklmnop".into();
        let prepared = prepare_evidence(&store, packet, false).unwrap();
        assert_eq!(
            prepared.packet.evidence[0].excerpt,
            "api_key=[REDACTED] Bearer [REDACTED] [REDACTED CREDENTIAL]"
        );
        let logged = store.read_all().unwrap();
        assert!(logged[0].packet.is_none());
        assert_eq!(logged[0].operation.as_deref(), Some("agent-query"));
        assert_eq!(
            logged[0].receipt.as_ref().unwrap()["evidence"][0]["id"],
            "evidence-1"
        );
    }

    #[test]
    fn reads_agent_neutral_chapter_and_local_evidence_activity() {
        let chapter: RewindEgressEvent = serde_json::from_str(
            r#"{"requestId":"chapter-1","occurredAt":"2026-01-01T00:00:00Z","state":"prepared","packet":{"question":"recent work","evidence":[{"id":"c1","momentId":"c1","sourceType":"chapter","capturedAt":"2026-01-01T00:00:00Z","excerpt":"Editor work"}]},"evidenceCount":1,"packetBytes":10,"error":null}"#,
        )
        .unwrap();
        assert_eq!(
            chapter.packet.unwrap().evidence[0].source_type,
            RewindEvidenceSource::Chapter
        );
        let local: RewindEgressEvent = serde_json::from_str(
            r#"{"requestId":"local-1","occurredAt":"2026-01-01T00:00:00Z","state":"local-evidence-read","packet":{"question":"inspect frame","evidence":[]},"evidenceCount":1,"packetBytes":0,"error":null}"#,
        )
        .unwrap();
        assert_eq!(local.state, RewindEgressState::LocalEvidenceRead);
    }

    #[test]
    fn frames_fail_before_writing() {
        let store = temp_store("frames");
        assert!(prepare_evidence(&store, packet(), true)
            .unwrap_err()
            .contains("approval"));
        assert!(store.read_all().unwrap().is_empty());
    }

    #[test]
    fn prepared_event_precedes_one_terminal_event() {
        let store = temp_store("complete");
        let prepared = prepare_evidence(&store, packet(), false).unwrap();
        let completed = store
            .terminal_event(&prepared.request_id, RewindEgressState::Completed, None)
            .unwrap();
        let events = store.read_all().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].state, RewindEgressState::Prepared);
        assert_eq!(events[1].state, RewindEgressState::Completed);
        assert!(events[0].packet.is_none());
        assert!(events[0].receipt.is_some());
        assert!(completed.packet.is_none());
        assert!(store
            .terminal_event(
                &prepared.request_id,
                RewindEgressState::Failed,
                Some("late".into())
            )
            .is_err());
    }

    #[test]
    fn scrubs_legacy_packet_text_while_preserving_provenance() {
        let store = temp_store("legacy-scrub");
        if let Some(parent) = store.path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(
            &store.path,
            r#"{"requestId":"legacy-1","occurredAt":"2026-01-01T00:00:00Z","state":"prepared","packet":{"question":"private question","evidence":[{"id":"e1","momentId":"m1","sourceType":"transcript","capturedAt":"2026-01-01T00:00:00Z","excerpt":"private excerpt"}]},"evidenceCount":1,"packetBytes":42,"error":null}
"#,
        )
        .unwrap();

        store.scrub_legacy_content().unwrap();

        let raw = std::fs::read_to_string(&store.path).unwrap();
        assert!(!raw.contains("private question"));
        assert!(!raw.contains("private excerpt"));
        let events = store.read_all().unwrap();
        assert_eq!(
            events[0].receipt.as_ref().unwrap()["evidence"][0]["id"],
            "e1"
        );
    }

    #[test]
    fn failure_and_unknown_ids_are_auditable_and_bounded() {
        let store = temp_store("failure");
        assert!(store
            .terminal_event("missing", RewindEgressState::Failed, Some("no".into()))
            .is_err());
        let prepared = prepare_evidence(&store, packet(), false).unwrap();
        store
            .terminal_event(
                &prepared.request_id,
                RewindEgressState::Failed,
                Some("network unavailable".into()),
            )
            .unwrap();
        assert_eq!(
            store.read_all().unwrap()[1].state,
            RewindEgressState::Failed
        );

        let mut too_many = packet();
        too_many.evidence = (0..=MAX_EVIDENCE_ITEMS)
            .map(|index| RewindEvidenceForEgress {
                id: format!("e-{index}"),
                moment_id: format!("m-{index}"),
                source_type: RewindEvidenceSource::Ocr,
                captured_at: None,
                excerpt: "text".into(),
            })
            .collect();
        assert!(prepare_evidence(&store, too_many, false).is_err());

        let mut encoded = packet();
        encoded.evidence[0].excerpt = "data:image/png;base64,example".into();
        assert!(prepare_evidence(&store, encoded, false).is_err());
    }
}
