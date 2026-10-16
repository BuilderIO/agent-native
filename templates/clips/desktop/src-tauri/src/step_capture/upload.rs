//! Upload a finished step capture to Clips.
//!
//! A session becomes a library folder with one screenshot per step, through
//! the same `create-folder` and `create-screenshot` actions the web app uses,
//! so each step inherits sharing, editing and annotations as an ordinary
//! image recording. The outcome is written to `upload.json` next to the
//! manifest: which step became which recording, and which were skipped or
//! failed, so a partial upload is visible rather than silently short.
//!
//! Credentials come from the session the renderer keeps warm in
//! `MeetingsWatcherState`, like the native screen recording upload.

use base64::Engine as _;
use serde::Serialize;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use super::{
    StepCaptureSession, StepCaptureStep, StepClickType, StepImage, StepTarget, StepWindow,
};
use crate::meetings_watcher::{MeetingsSessionSnapshot, MeetingsWatcherState};

const UPLOAD_FILE: &str = "upload.json";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StepUpload {
    Uploaded {
        step: u32,
        recording_id: String,
    },
    /// The step has no screenshot to upload; its capture had already failed.
    Skipped {
        step: u32,
        reason: String,
    },
    Failed {
        step: u32,
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepCaptureUpload {
    pub session_id: String,
    pub folder_id: String,
    pub folder_url: String,
    pub uploaded_at: String,
    pub steps: Vec<StepUpload>,
}

const ROLE_NOUNS: &[(&str, &str)] = &[
    ("AXButton", "button"),
    ("AXCheckBox", "checkbox"),
    ("AXLink", "link"),
    ("AXMenuBarItem", "menu"),
    ("AXMenuButton", "menu"),
    ("AXMenuItem", "menu item"),
    ("AXPopUpButton", "menu"),
    ("AXRadioButton", "option"),
    ("AXTab", "tab"),
    ("AXTextField", "field"),
    ("AXTextArea", "field"),
    ("AXSearchField", "search field"),
    ("AXSecureTextField", "password field"),
    ("AXComboBox", "field"),
];

fn role_noun(role: &str) -> Option<&'static str> {
    ROLE_NOUNS
        .iter()
        .find(|(candidate, _)| *candidate == role)
        .map(|(_, noun)| *noun)
}

/// Mirror of `defaultStepTitle` in `shared/step-capture.ts`; both must change
/// together. The tests below use the same cases.
pub fn default_step_title(step: &StepCaptureStep) -> String {
    let verb = match step.click_type {
        StepClickType::Left => "Click",
        StepClickType::Right => "Right-click",
        StepClickType::Double => "Double-click",
        StepClickType::Drag => "Drag",
    };
    match &step.target {
        StepTarget::Labeled { role, label } => {
            return match role_noun(role) {
                Some(noun) => format!("{verb} \"{label}\" {noun}"),
                None => format!("{verb} \"{label}\""),
            };
        }
        StepTarget::Unlabeled { role } | StepTarget::Redacted { role } => {
            if let Some(noun) = role_noun(role) {
                return format!("{verb} the {noun}");
            }
        }
        StepTarget::Unavailable { .. } => {}
    }
    if let StepWindow::Found {
        owner_name: Some(owner),
        ..
    } = &step.window
    {
        if !owner.is_empty() {
            return format!("{verb} in {owner}");
        }
    }
    verb.to_string()
}

/// The library folder name, in local time so it matches the user's clock.
fn folder_name(started_at: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(started_at) {
        Ok(at) => format!(
            "Step capture {}",
            at.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M")
        ),
        Err(_) => "Step capture".to_string(),
    }
}

fn folder_url(server_url: &str, folder_id: &str) -> String {
    format!(
        "{}/library/folder/{folder_id}",
        server_url.trim_end_matches('/')
    )
}

struct Target {
    client: reqwest::Client,
    server_url: String,
    session: MeetingsSessionSnapshot,
}

impl Target {
    async fn call(&self, name: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
        let url = format!(
            "{}/_agent-native/actions/{name}",
            self.server_url.trim_end_matches('/')
        );
        let mut request = self
            .client
            .post(&url)
            .header("X-Request-Source", "clips-desktop")
            .json(&body);
        if let Some(cookie) = self.session.session_cookie.as_deref() {
            request = request.header("Cookie", cookie);
        }
        if let Some(token) = self.session.auth_token.as_deref() {
            request = request.bearer_auth(token);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("{name}: {error}"))?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(format!("{name}: sign in to Clips again (HTTP {status})"));
        }
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(format!(
                "{name}: HTTP {status} {}",
                text.chars().take(180).collect::<String>()
            ));
        }
        response
            .json()
            .await
            .map_err(|error| format!("{name} response: {error}"))
    }
}

fn response_id(name: &str, body: &serde_json::Value) -> Result<String, String> {
    body.get("id")
        .and_then(|id| id.as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{name} response has no id"))
}

async fn upload_step(
    target: &Target,
    directory: &Path,
    folder_id: &str,
    step: &StepCaptureStep,
) -> StepUpload {
    let (file_name, width, height) = match &step.image {
        StepImage::Captured {
            file_name,
            width,
            height,
        } => (file_name, *width, *height),
        StepImage::Failed { error } => {
            return StepUpload::Skipped {
                step: step.step,
                reason: format!("screenshot failed: {error}"),
            }
        }
    };
    let path = directory.join(file_name);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return StepUpload::Failed {
                step: step.step,
                error: format!("could not read {}: {error}", path.display()),
            }
        }
    };
    let (source_app, source_title) = match &step.window {
        StepWindow::Found {
            owner_name, title, ..
        } => (owner_name.clone(), title.clone()),
        StepWindow::None => (None, None),
    };
    let body = serde_json::json!({
        "dataUrl": format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        "title": format!("{}. {}", step.step, default_step_title(step)),
        "width": width,
        "height": height,
        "sourceAppName": source_app,
        "sourceWindowTitle": source_title,
        "folderId": folder_id,
    });
    match target
        .call("create-screenshot", body)
        .await
        .and_then(|response| response_id("create-screenshot", &response))
    {
        Ok(recording_id) => StepUpload::Uploaded {
            step: step.step,
            recording_id,
        },
        Err(error) => StepUpload::Failed {
            step: step.step,
            error,
        },
    }
}

fn write_upload(directory: &Path, upload: &StepCaptureUpload) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(upload)
        .map_err(|error| format!("could not encode the upload record: {error}"))?;
    let path = directory.join(UPLOAD_FILE);
    let temporary = directory.join(format!("{UPLOAD_FILE}.tmp"));
    std::fs::write(&temporary, json)
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("could not replace {}: {error}", path.display()))
}

/// Upload every captured step into a new library folder. Errors only when
/// nothing could be uploaded at all (no session, no folder); a step that fails
/// on its own is recorded in `upload.json` and the rest still go up.
pub async fn upload_session(
    app: &AppHandle,
    directory: &Path,
    session: &StepCaptureSession,
) -> Result<StepCaptureUpload, String> {
    let snapshot = app
        .try_state::<MeetingsWatcherState>()
        .map(|state| state.session_snapshot())
        .unwrap_or_default();
    let server_url = snapshot
        .server_url
        .clone()
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| "Sign in to Clips to upload step captures.".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("step capture upload client failed: {error}"))?;
    let target = Target {
        client,
        server_url: server_url.clone(),
        session: snapshot,
    };

    let folder = target
        .call(
            "create-folder",
            serde_json::json!({ "name": folder_name(&session.started_at) }),
        )
        .await?;
    let folder_id = response_id("create-folder", &folder)?;

    let mut steps = Vec::with_capacity(session.steps.len());
    for step in &session.steps {
        steps.push(upload_step(&target, directory, &folder_id, step).await);
    }
    let upload = StepCaptureUpload {
        session_id: session.session_id.clone(),
        folder_url: folder_url(&server_url, &folder_id),
        folder_id,
        uploaded_at: chrono::Utc::now().to_rfc3339(),
        steps,
    };
    write_upload(directory, &upload)?;
    Ok(upload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::step_capture::{StepPoint, StepRect, StepTargetUnavailableReason};

    fn step(click_type: StepClickType, target: StepTarget) -> StepCaptureStep {
        StepCaptureStep {
            step: 1,
            captured_at: "2026-10-16T09:00:00.000Z".to_string(),
            click_type,
            location: StepPoint { x: 120.0, y: 48.0 },
            drag_to: None,
            display: None,
            image: StepImage::Captured {
                file_name: "step-001.png".to_string(),
                width: 3024,
                height: 1964,
            },
            window: StepWindow::Found {
                id: 42,
                frame: StepRect {
                    x: 0.0,
                    y: 25.0,
                    width: 900.0,
                    height: 700.0,
                },
                owner_name: Some("Finder".to_string()),
                owner_pid: Some(501),
                title: None,
            },
            target,
        }
    }

    fn labeled(role: &str, label: &str) -> StepTarget {
        StepTarget::Labeled {
            role: role.to_string(),
            label: label.to_string(),
        }
    }

    // Same cases as `shared/step-capture.test.ts`.
    #[test]
    fn titles_name_the_control_that_was_clicked() {
        assert_eq!(
            default_step_title(&step(StepClickType::Left, labeled("AXButton", "Save"))),
            "Click \"Save\" button"
        );
        assert_eq!(
            default_step_title(&step(
                StepClickType::Double,
                labeled("AXStaticText", "Report.pdf")
            )),
            "Double-click \"Report.pdf\""
        );
    }

    #[test]
    fn titles_never_echo_a_redacted_label() {
        let redacted = |role: &str| StepTarget::Redacted {
            role: role.to_string(),
        };
        assert_eq!(
            default_step_title(&step(StepClickType::Left, redacted("AXSecureTextField"))),
            "Click the password field"
        );
        assert_eq!(
            default_step_title(&step(StepClickType::Left, redacted("AXTextField"))),
            "Click the field"
        );
    }

    #[test]
    fn titles_fall_back_to_the_window_owner_then_the_verb() {
        let unavailable = |reason| StepTarget::Unavailable { reason, code: None };
        assert_eq!(
            default_step_title(&step(
                StepClickType::Left,
                unavailable(StepTargetUnavailableReason::NotTrusted)
            )),
            "Click in Finder"
        );
        let mut bare = step(
            StepClickType::Right,
            unavailable(StepTargetUnavailableReason::NoElement),
        );
        bare.window = StepWindow::None;
        assert_eq!(default_step_title(&bare), "Right-click");
    }

    #[test]
    fn folder_links_point_at_the_library_folder_route() {
        assert_eq!(
            folder_url("https://clips.example.com/", "f1"),
            "https://clips.example.com/library/folder/f1"
        );
    }

    #[test]
    fn upload_record_keeps_skipped_and_failed_steps_distinct() {
        let json = serde_json::to_value(vec![
            StepUpload::Uploaded {
                step: 1,
                recording_id: "r1".to_string(),
            },
            StepUpload::Skipped {
                step: 2,
                reason: "screenshot failed: denied".to_string(),
            },
            StepUpload::Failed {
                step: 3,
                error: "create-screenshot: HTTP 500".to_string(),
            },
        ])
        .unwrap();
        assert_eq!(json[0]["status"], "uploaded");
        assert_eq!(json[0]["recordingId"], "r1");
        assert_eq!(json[1]["status"], "skipped");
        assert_eq!(json[2]["status"], "failed");
    }
}
