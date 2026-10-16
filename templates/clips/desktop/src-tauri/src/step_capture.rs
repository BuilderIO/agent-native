//! Step capture — one screenshot per click while the user walks through a task.
//!
//! The model is Snagit 2026's Step Capture: a passive global mouse monitor
//! (not an event tap — clicks are observed, never intercepted), and for each
//! click a still of the display under the pointer, the window under the
//! pointer, and the Accessibility element that was clicked, which seeds the
//! step's title. The web app turns the manifest into an editable guide.
//!
//! ## Session layout
//!
//! `<app data>/step-captures/<session id>/` holds `step-NNN.png` files and
//! `manifest.json`, the contract in `templates/clips/shared/step-capture.ts`.
//! The manifest is rewritten atomically after every step, so a session that
//! never reaches `step_capture_stop` still leaves a readable manifest with a
//! null `endedAt`.
//!
//! ## Threads
//!
//! AppKit only delivers monitor callbacks on the main thread, so the monitor
//! is installed and removed there and its handler only classifies the event
//! and hands it to a worker thread. The worker does the slow parts
//! (Accessibility hit test, window list, ScreenCaptureKit still) in order, so
//! step numbers follow click order.
//!
//! ## Limits
//!
//! - A global monitor fires after the click is delivered, so a menu or sheet
//!   the click opens can already be in the still. The Accessibility hit test
//!   runs first to keep the label as close to the click as possible.
//! - Global monitors never see clicks in Clips' own windows, and Clips' own
//!   windows are excluded from the still.
//! - Without Screen Recording permission the step is kept with a failed
//!   image; without Accessibility trust it is kept with an unavailable target.
//!
//! Capture itself is shared, not reimplemented: the still comes from
//! `native_screen::capture_display_still_at` (the screen recording module's
//! display lookup and permission handling), and the window and element come
//! from `accessibility`.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};

use crate::accessibility::{element_at_position, AxHitTest};

pub const STEP_CAPTURE_SCHEMA_VERSION: u32 = 1;
const MANIFEST_FILE: &str = "manifest.json";
/// Pointer travel, in points, before a held left button counts as a drag.
const DRAG_THRESHOLD: f64 = 6.0;
/// How far, in points, a second click may land from the first and still be a double-click.
const DOUBLE_CLICK_SLOP: f64 = 4.0;
pub const STEP_EVENT: &str = "step-capture:step";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StepClickType {
    Left,
    Right,
    Double,
    Drag,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct StepPoint {
    pub x: f64,
    pub y: f64,
}

impl StepPoint {
    fn distance(self, other: StepPoint) -> f64 {
        (self.x - other.x).hypot(self.y - other.y)
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct StepRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StepDisplay {
    pub id: u32,
    pub frame: StepRect,
    pub scale: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StepImage {
    Captured {
        file_name: String,
        width: u32,
        height: u32,
    },
    Failed {
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StepWindow {
    Found {
        id: u32,
        frame: StepRect,
        #[serde(skip_serializing_if = "Option::is_none")]
        owner_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        owner_pid: Option<i32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    None,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StepTargetUnavailableReason {
    NotTrusted,
    NoElement,
    AxError,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StepTarget {
    Labeled {
        role: String,
        label: String,
    },
    Unlabeled {
        role: String,
    },
    Redacted {
        role: String,
    },
    Unavailable {
        reason: StepTargetUnavailableReason,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<i32>,
    },
}

impl From<AxHitTest> for StepTarget {
    fn from(hit: AxHitTest) -> Self {
        let unavailable = |reason, code| StepTarget::Unavailable { reason, code };
        match hit {
            AxHitTest::Labeled { role, label } => StepTarget::Labeled { role, label },
            AxHitTest::Unlabeled { role } => StepTarget::Unlabeled { role },
            AxHitTest::Redacted { role } => StepTarget::Redacted { role },
            AxHitTest::NotTrusted => unavailable(StepTargetUnavailableReason::NotTrusted, None),
            AxHitTest::NoElement => unavailable(StepTargetUnavailableReason::NoElement, None),
            AxHitTest::Failed(0) => unavailable(StepTargetUnavailableReason::Unsupported, None),
            AxHitTest::Failed(code) => {
                unavailable(StepTargetUnavailableReason::AxError, Some(code))
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepCaptureStep {
    pub step: u32,
    pub captured_at: String,
    pub click_type: StepClickType,
    pub location: StepPoint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drag_to: Option<StepPoint>,
    pub display: Option<StepDisplay>,
    pub image: StepImage,
    pub window: StepWindow,
    pub target: StepTarget,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepCaptureSession {
    pub schema_version: u32,
    pub session_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub steps: Vec<StepCaptureStep>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepCaptureStatus {
    pub active: bool,
    pub session_id: Option<String>,
    pub directory: Option<String>,
    pub step_count: usize,
}

// ---------------------------------------------------------------------------
// Click classification

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MouseSignal {
    LeftDown { at: StepPoint, click_count: i64 },
    RightDown { at: StepPoint },
    LeftDragged { at: StepPoint },
    LeftUp { at: StepPoint },
}

/// What the worker should do for a mouse signal.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StepAction {
    /// A new step: capture now.
    Capture {
        click_type: StepClickType,
        location: StepPoint,
    },
    /// Re-type the latest step (the second click of a double-click, or the
    /// release of a drag) without capturing again.
    Amend {
        click_type: StepClickType,
        drag_to: Option<StepPoint>,
    },
}

/// Turns raw monitor events into steps. Lives on the main thread.
#[derive(Debug, Default)]
pub struct ClickTracker {
    pressed_at: Option<StepPoint>,
    dragging: bool,
    last_left_click: Option<StepPoint>,
}

impl ClickTracker {
    pub fn handle(&mut self, signal: MouseSignal) -> Option<StepAction> {
        match signal {
            MouseSignal::LeftDown { at, click_count } => {
                self.pressed_at = Some(at);
                self.dragging = false;
                let repeats_last = self
                    .last_left_click
                    .is_some_and(|last| last.distance(at) <= DOUBLE_CLICK_SLOP);
                if click_count >= 2 && repeats_last {
                    // Further clicks of a triple-click stay one double-click step.
                    return (click_count == 2).then_some(StepAction::Amend {
                        click_type: StepClickType::Double,
                        drag_to: None,
                    });
                }
                self.last_left_click = Some(at);
                Some(StepAction::Capture {
                    click_type: StepClickType::Left,
                    location: at,
                })
            }
            MouseSignal::RightDown { at } => {
                self.pressed_at = None;
                self.dragging = false;
                self.last_left_click = None;
                Some(StepAction::Capture {
                    click_type: StepClickType::Right,
                    location: at,
                })
            }
            MouseSignal::LeftDragged { at } => {
                if let Some(start) = self.pressed_at {
                    if start.distance(at) > DRAG_THRESHOLD {
                        self.dragging = true;
                    }
                }
                None
            }
            MouseSignal::LeftUp { at } => {
                let dragged = self.pressed_at.take().is_some() && self.dragging;
                self.dragging = false;
                if !dragged {
                    return None;
                }
                self.last_left_click = None;
                Some(StepAction::Amend {
                    click_type: StepClickType::Drag,
                    drag_to: Some(at),
                })
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Session state

enum WorkerMessage {
    Action {
        action: StepAction,
        at: chrono::DateTime<chrono::Utc>,
    },
    Finish,
}

struct ActiveCapture {
    session_id: String,
    directory: PathBuf,
    sender: Sender<WorkerMessage>,
    worker: JoinHandle<StepCaptureSession>,
    steps: Arc<Mutex<usize>>,
}

static ACTIVE: Mutex<Option<ActiveCapture>> = Mutex::new(None);

fn timestamp(at: chrono::DateTime<chrono::Utc>) -> String {
    at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn step_file_name(step: u32) -> String {
    format!("step-{step:03}.png")
}

fn write_manifest(directory: &Path, session: &StepCaptureSession) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(session)
        .map_err(|error| format!("could not encode the step manifest: {error}"))?;
    let path = directory.join(MANIFEST_FILE);
    let temporary = directory.join(format!("{MANIFEST_FILE}.tmp"));
    std::fs::write(&temporary, json)
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("could not replace {}: {error}", path.display()))
}

/// Apply one action to the session. Capturing is injected so the bookkeeping
/// is testable without a display.
fn apply_action(
    session: &mut StepCaptureSession,
    action: StepAction,
    at: chrono::DateTime<chrono::Utc>,
    capture: impl FnOnce(u32, StepPoint) -> (Option<StepDisplay>, StepImage, StepWindow, StepTarget),
) -> Option<usize> {
    match action {
        StepAction::Capture {
            click_type,
            location,
        } => {
            let step = session.steps.len() as u32 + 1;
            let (display, image, window, target) = capture(step, location);
            session.steps.push(StepCaptureStep {
                step,
                captured_at: timestamp(at),
                click_type,
                location,
                drag_to: None,
                display,
                image,
                window,
                target,
            });
            Some(session.steps.len() - 1)
        }
        StepAction::Amend {
            click_type,
            drag_to,
        } => {
            let index = session.steps.len().checked_sub(1)?;
            let latest = &mut session.steps[index];
            latest.click_type = click_type;
            latest.drag_to = drag_to;
            Some(index)
        }
    }
}

fn run_worker(
    app: AppHandle,
    directory: PathBuf,
    mut session: StepCaptureSession,
    receiver: Receiver<WorkerMessage>,
    steps: Arc<Mutex<usize>>,
) -> StepCaptureSession {
    if let Err(error) = write_manifest(&directory, &session) {
        eprintln!("[clips-tray] step capture: {error}");
    }
    while let Ok(message) = receiver.recv() {
        let WorkerMessage::Action { action, at } = message else {
            break;
        };
        let changed = apply_action(&mut session, action, at, |step, location| {
            capture_step(&directory, step, location)
        });
        let Some(index) = changed else {
            continue;
        };
        *steps
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = session.steps.len();
        if let Err(error) = write_manifest(&directory, &session) {
            eprintln!("[clips-tray] step capture: {error}");
        }
        let _ = app.emit(STEP_EVENT, &session.steps[index]);
    }
    session.ended_at = Some(timestamp(chrono::Utc::now()));
    if let Err(error) = write_manifest(&directory, &session) {
        eprintln!("[clips-tray] step capture: {error}");
    }
    session
}

/// Label first, then window, then the still: the label is the fact most
/// likely to change as the app reacts to the click.
fn capture_step(
    directory: &Path,
    step: u32,
    location: StepPoint,
) -> (Option<StepDisplay>, StepImage, StepWindow, StepTarget) {
    let target = StepTarget::from(element_at_position(location.x, location.y));
    let window = match crate::accessibility::window_at_point(location.x, location.y) {
        Some(found) => StepWindow::Found {
            id: found.id,
            frame: StepRect {
                x: found.x,
                y: found.y,
                width: found.width,
                height: found.height,
            },
            owner_name: found.owner_name,
            owner_pid: found.owner_pid,
            title: found.title,
        },
        None => StepWindow::None,
    };
    let file_name = step_file_name(step);
    let (display, image) = platform::capture_still(&directory.join(&file_name), location);
    let image = match image {
        Ok((width, height)) => StepImage::Captured {
            file_name,
            width,
            height,
        },
        Err(error) => StepImage::Failed { error },
    };
    (display, image, window, target)
}

fn status_of(active: &Option<ActiveCapture>) -> StepCaptureStatus {
    match active {
        Some(capture) => StepCaptureStatus {
            active: true,
            session_id: Some(capture.session_id.clone()),
            directory: Some(capture.directory.display().to_string()),
            step_count: *capture
                .steps
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        },
        None => StepCaptureStatus {
            active: false,
            session_id: None,
            directory: None,
            step_count: 0,
        },
    }
}

#[tauri::command]
pub async fn step_capture_status() -> Result<StepCaptureStatus, String> {
    let active = ACTIVE
        .lock()
        .map_err(|_| "step capture state is poisoned")?;
    Ok(status_of(&active))
}

#[tauri::command]
pub async fn step_capture_start(app: AppHandle) -> Result<StepCaptureStatus, String> {
    let mut active = ACTIVE
        .lock()
        .map_err(|_| "step capture state is poisoned")?;
    if active.is_some() {
        return Err("A step capture is already recording.".to_string());
    }
    if !platform::SUPPORTED {
        return Err("Step capture is only available on macOS.".to_string());
    }

    let started = chrono::Utc::now();
    let session_id = format!("steps-{}", started.format("%Y%m%d-%H%M%S-%3f"));
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve the app data folder: {error}"))?
        .join("step-captures")
        .join(&session_id);
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create {}: {error}", directory.display()))?;

    let session = StepCaptureSession {
        schema_version: STEP_CAPTURE_SCHEMA_VERSION,
        session_id: session_id.clone(),
        started_at: timestamp(started),
        ended_at: None,
        steps: Vec::new(),
    };
    let (sender, receiver) = mpsc::channel();
    let steps = Arc::new(Mutex::new(0));
    let worker = {
        let app = app.clone();
        let directory = directory.clone();
        let steps = steps.clone();
        std::thread::Builder::new()
            .name("clips-step-capture".into())
            .spawn(move || run_worker(app, directory, session, receiver, steps))
            .map_err(|error| format!("could not start the step capture worker: {error}"))?
    };

    if let Err(error) = platform::install_monitor(&app, sender.clone()) {
        let _ = sender.send(WorkerMessage::Finish);
        let _ = worker.join();
        return Err(error);
    }

    *active = Some(ActiveCapture {
        session_id,
        directory,
        sender,
        worker,
        steps,
    });
    Ok(status_of(&active))
}

/// Stop recording and return the finished manifest.
#[tauri::command]
pub async fn step_capture_stop(app: AppHandle) -> Result<StepCaptureSession, String> {
    let capture = ACTIVE
        .lock()
        .map_err(|_| "step capture state is poisoned")?
        .take()
        .ok_or_else(|| "No step capture is recording.".to_string())?;
    if let Err(error) = platform::remove_monitor(&app) {
        eprintln!("[clips-tray] step capture: {error}");
    }
    let _ = capture.sender.send(WorkerMessage::Finish);
    tauri::async_runtime::spawn_blocking(move || capture.worker.join())
        .await
        .map_err(|error| format!("step capture worker could not be joined: {error}"))?
        .map_err(|_| "step capture worker panicked".to_string())
}

// ---------------------------------------------------------------------------
// Platform

#[cfg(target_os = "macos")]
mod platform {
    use super::{ClickTracker, MouseSignal, StepDisplay, StepPoint, StepRect, WorkerMessage};
    use block2::RcBlock;
    use core_graphics::display::CGDisplay;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
    use std::cell::RefCell;
    use std::path::Path;
    use std::ptr::NonNull;
    use std::sync::mpsc::{self, Sender};
    use std::time::Duration;
    use tauri::AppHandle;

    pub const SUPPORTED: bool = true;

    thread_local! {
        // Only touched on the main thread, where AppKit requires monitors to live.
        static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
    }

    /// Cocoa reports global mouse locations bottom-left from the primary
    /// display; everything else here is top-left.
    fn to_top_left(x: f64, y: f64) -> StepPoint {
        let primary_height = CGDisplay::main().bounds().size.height;
        StepPoint {
            x,
            y: primary_height - y,
        }
    }

    fn signal_for(event: &NSEvent) -> Option<MouseSignal> {
        let location = event.locationInWindow();
        let at = to_top_left(location.x, location.y);
        let kind = event.r#type();
        if kind == NSEventType::LeftMouseDown {
            Some(MouseSignal::LeftDown {
                at,
                click_count: event.clickCount() as i64,
            })
        } else if kind == NSEventType::RightMouseDown {
            Some(MouseSignal::RightDown { at })
        } else if kind == NSEventType::LeftMouseDragged {
            Some(MouseSignal::LeftDragged { at })
        } else if kind == NSEventType::LeftMouseUp {
            Some(MouseSignal::LeftUp { at })
        } else {
            None
        }
    }

    fn run_on_main<T: Send + 'static>(
        app: &AppHandle,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, String> {
        let (reply, result) = mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = reply.send(work());
        })
        .map_err(|error| format!("run_on_main_thread failed: {error}"))?;
        result
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "the main thread did not answer in time".to_string())
    }

    pub fn install_monitor(app: &AppHandle, sender: Sender<WorkerMessage>) -> Result<(), String> {
        run_on_main(app, move || {
            let tracker = RefCell::new(ClickTracker::default());
            let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
                let at = chrono::Utc::now();
                let Some(signal) = signal_for(unsafe { event.as_ref() }) else {
                    return;
                };
                if let Some(action) = tracker.borrow_mut().handle(signal) {
                    let _ = sender.send(WorkerMessage::Action { action, at });
                }
            });
            let mask = NSEventMask::LeftMouseDown
                | NSEventMask::RightMouseDown
                | NSEventMask::LeftMouseUp
                | NSEventMask::LeftMouseDragged;
            let monitor = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &handler)
                .ok_or_else(|| "macOS refused the global mouse monitor".to_string())?;
            MONITOR.with(|slot| {
                if let Some(previous) = slot.borrow_mut().replace(monitor) {
                    unsafe { NSEvent::removeMonitor(&previous) };
                }
            });
            Ok(())
        })?
    }

    pub fn remove_monitor(app: &AppHandle) -> Result<(), String> {
        run_on_main(app, || {
            MONITOR.with(|slot| {
                if let Some(monitor) = slot.borrow_mut().take() {
                    unsafe { NSEvent::removeMonitor(&monitor) };
                }
            });
        })
    }

    pub fn capture_still(
        path: &Path,
        location: StepPoint,
    ) -> (Option<StepDisplay>, Result<(u32, u32), String>) {
        let (display, saved) =
            crate::native_screen::capture_display_still_at(location.x, location.y, path);
        let display = display.map(|display| StepDisplay {
            id: display.id,
            frame: StepRect {
                x: display.frame.x,
                y: display.frame.y,
                width: display.frame.width,
                height: display.frame.height,
            },
            scale: display.scale,
        });
        (display, saved)
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{StepDisplay, StepPoint, WorkerMessage};
    use std::path::Path;
    use std::sync::mpsc::Sender;
    use tauri::AppHandle;

    pub const SUPPORTED: bool = false;

    pub fn install_monitor(_app: &AppHandle, _sender: Sender<WorkerMessage>) -> Result<(), String> {
        Err("Step capture is only available on macOS.".to_string())
    }

    pub fn remove_monitor(_app: &AppHandle) -> Result<(), String> {
        Ok(())
    }

    pub fn capture_still(
        _path: &Path,
        _location: StepPoint,
    ) -> (Option<StepDisplay>, Result<(u32, u32), String>) {
        (
            None,
            Err("Step capture is only available on macOS.".to_string()),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(x: f64, y: f64) -> StepPoint {
        StepPoint { x, y }
    }

    fn capture(click_type: StepClickType, location: StepPoint) -> Option<StepAction> {
        Some(StepAction::Capture {
            click_type,
            location,
        })
    }

    #[test]
    fn a_click_is_one_step() {
        let mut tracker = ClickTracker::default();
        let at = point(10.0, 20.0);
        assert_eq!(
            tracker.handle(MouseSignal::LeftDown { at, click_count: 1 }),
            capture(StepClickType::Left, at)
        );
        assert_eq!(tracker.handle(MouseSignal::LeftUp { at }), None);
    }

    #[test]
    fn a_double_click_amends_the_first_click() {
        let mut tracker = ClickTracker::default();
        let at = point(10.0, 20.0);
        tracker.handle(MouseSignal::LeftDown { at, click_count: 1 });
        tracker.handle(MouseSignal::LeftUp { at });
        assert_eq!(
            tracker.handle(MouseSignal::LeftDown {
                at: point(11.0, 21.0),
                click_count: 2
            }),
            Some(StepAction::Amend {
                click_type: StepClickType::Double,
                drag_to: None
            })
        );
        assert_eq!(
            tracker.handle(MouseSignal::LeftDown { at, click_count: 3 }),
            None
        );
    }

    #[test]
    fn a_far_second_click_is_a_new_step() {
        let mut tracker = ClickTracker::default();
        tracker.handle(MouseSignal::LeftDown {
            at: point(10.0, 20.0),
            click_count: 1,
        });
        let far = point(200.0, 20.0);
        assert_eq!(
            tracker.handle(MouseSignal::LeftDown {
                at: far,
                click_count: 2
            }),
            capture(StepClickType::Left, far)
        );
    }

    #[test]
    fn a_drag_past_the_threshold_amends_on_release() {
        let mut tracker = ClickTracker::default();
        let start = point(0.0, 0.0);
        let end = point(40.0, 0.0);
        tracker.handle(MouseSignal::LeftDown {
            at: start,
            click_count: 1,
        });
        assert_eq!(
            tracker.handle(MouseSignal::LeftDragged {
                at: point(3.0, 0.0)
            }),
            None
        );
        assert_eq!(
            tracker.handle(MouseSignal::LeftUp {
                at: point(3.0, 0.0)
            }),
            None
        );

        tracker.handle(MouseSignal::LeftDown {
            at: start,
            click_count: 1,
        });
        tracker.handle(MouseSignal::LeftDragged { at: end });
        assert_eq!(
            tracker.handle(MouseSignal::LeftUp { at: end }),
            Some(StepAction::Amend {
                click_type: StepClickType::Drag,
                drag_to: Some(end)
            })
        );
    }

    fn empty_session() -> StepCaptureSession {
        StepCaptureSession {
            schema_version: STEP_CAPTURE_SCHEMA_VERSION,
            session_id: "s1".into(),
            started_at: "2026-10-16T09:00:00.000Z".into(),
            ended_at: None,
            steps: Vec::new(),
        }
    }

    fn fake_capture(
        step: u32,
        _location: StepPoint,
    ) -> (Option<StepDisplay>, StepImage, StepWindow, StepTarget) {
        (
            None,
            StepImage::Captured {
                file_name: step_file_name(step),
                width: 2,
                height: 2,
            },
            StepWindow::None,
            StepTarget::Unavailable {
                reason: StepTargetUnavailableReason::NotTrusted,
                code: None,
            },
        )
    }

    #[test]
    fn steps_are_numbered_and_amended_in_order() {
        let mut session = empty_session();
        let now = chrono::Utc::now();
        assert_eq!(
            apply_action(
                &mut session,
                StepAction::Amend {
                    click_type: StepClickType::Double,
                    drag_to: None
                },
                now,
                fake_capture
            ),
            None
        );
        for _ in 0..2 {
            apply_action(
                &mut session,
                StepAction::Capture {
                    click_type: StepClickType::Left,
                    location: point(1.0, 2.0),
                },
                now,
                fake_capture,
            );
        }
        apply_action(
            &mut session,
            StepAction::Amend {
                click_type: StepClickType::Double,
                drag_to: None,
            },
            now,
            fake_capture,
        );
        assert_eq!(session.steps.len(), 2);
        assert_eq!(session.steps[1].step, 2);
        assert_eq!(session.steps[1].click_type, StepClickType::Double);
        assert_eq!(
            session.steps[1].image,
            StepImage::Captured {
                file_name: "step-002.png".into(),
                width: 2,
                height: 2
            }
        );
    }

    #[test]
    fn manifest_json_matches_the_shared_contract() {
        let mut session = empty_session();
        session.steps.push(StepCaptureStep {
            step: 1,
            captured_at: "2026-10-16T09:00:01.000Z".into(),
            click_type: StepClickType::Drag,
            location: point(1.0, 2.0),
            drag_to: Some(point(3.0, 4.0)),
            display: Some(StepDisplay {
                id: 1,
                frame: StepRect {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 50.0,
                },
                scale: 2.0,
            }),
            image: StepImage::Failed {
                error: "denied".into(),
            },
            window: StepWindow::Found {
                id: 7,
                frame: StepRect {
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                },
                owner_name: Some("Finder".into()),
                owner_pid: None,
                title: None,
            },
            target: StepTarget::from(AxHitTest::Failed(-25204)),
        });
        let json = serde_json::to_value(&session).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "schemaVersion": 1,
                "sessionId": "s1",
                "startedAt": "2026-10-16T09:00:00.000Z",
                "endedAt": null,
                "steps": [{
                    "step": 1,
                    "capturedAt": "2026-10-16T09:00:01.000Z",
                    "clickType": "drag",
                    "location": { "x": 1.0, "y": 2.0 },
                    "dragTo": { "x": 3.0, "y": 4.0 },
                    "display": {
                        "id": 1,
                        "frame": { "x": 0.0, "y": 0.0, "width": 100.0, "height": 50.0 },
                        "scale": 2.0
                    },
                    "image": { "status": "failed", "error": "denied" },
                    "window": {
                        "status": "found",
                        "id": 7,
                        "frame": { "x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0 },
                        "ownerName": "Finder"
                    },
                    "target": { "status": "unavailable", "reason": "ax-error", "code": -25204 }
                }]
            })
        );
    }

    #[test]
    fn hit_test_outcomes_stay_distinct() {
        assert_eq!(
            StepTarget::from(AxHitTest::NotTrusted),
            StepTarget::Unavailable {
                reason: StepTargetUnavailableReason::NotTrusted,
                code: None
            }
        );
        assert_eq!(
            StepTarget::from(AxHitTest::Unlabeled {
                role: "AXGroup".into()
            }),
            StepTarget::Unlabeled {
                role: "AXGroup".into()
            }
        );
    }
}
