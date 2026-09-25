use std::sync::{atomic::AtomicBool, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager, Rect};

use crate::tray_meetings::MeetingItem;

/// Last-known tray icon rect, updated on every tray event. Used to anchor the
/// popover directly under the icon (Loom-style) instead of floating in the
/// top-right corner of the screen.
#[derive(Default)]
pub struct TrayAnchor(pub Mutex<Option<Rect>>);

/// Last-known upcoming-meetings snapshot. Cached so the tray menu can be
/// rebuilt on demand (e.g. when toggling the region-guides check item)
/// without losing the meetings submenu.
#[derive(Default)]
pub struct TrayMeetings(pub Mutex<Vec<MeetingItem>>);

/// Timestamp of the most-recent popover show. The blur-to-hide handler checks
/// this — macOS briefly steals focus during the tray click itself, so without
/// this guard the popover would be hidden the instant it's shown.
#[derive(Default)]
pub struct PopoverShownAt(pub Mutex<Option<Instant>>);

/// Whether the popover is parked off-screen while a native capture picker or
/// recorder owns the recording flow. This is separate from visibility because
/// the WebKit page stays alive while the native window is parked.
#[derive(Default)]
pub struct PopoverParked(pub AtomicBool);

/// Whether a recording is currently in progress. Set from JS via
/// `set_recording_state`. Keeps the parked popover reachable while recording
/// and enables the explicit Stop item in the tray menu.
#[derive(Default)]
pub struct RecordingActive(pub Mutex<bool>);

/// Whether a meeting recording is in progress. Set from JS via
/// `set_meeting_active`. Gates the `ExitRequested` quit-teardown handler in
/// `lib.rs` so quitting stays instant when no meeting is active.
#[derive(Default)]
pub struct MeetingActive(pub Mutex<bool>);

/// Active meeting id, when meeting notes are currently running. Kept separate
/// from `MeetingActive` so older boolean-only state checks stay simple.
#[derive(Default)]
pub struct ActiveMeetingId(pub Mutex<Option<String>>);

#[allow(dead_code)]
/// Whether dictation is toggled on.
#[derive(Default)]
pub struct DictationEnabled(pub Mutex<bool>);

/// Whether a push-to-talk dictation is currently in progress.
#[derive(Default)]
pub struct DictationActive(pub Mutex<bool>);

/// Whether the hidden popover was temporarily shown as a tiny controller
/// window so background voice dictation could run its WebView-side mic code.
#[derive(Default)]
pub struct VoiceWakePopover(pub Mutex<bool>);

/// Bundle identifier of the app that was focused when voice dictation started.
/// Used to return focus before posting the paste event if a Clips overlay
/// briefly became active while showing the dictation HUD.
#[derive(Default)]
pub struct VoiceTargetBundle(pub Mutex<Option<String>>);

/// Whether a text-capable accessibility element was focused when dictation
/// began. The HUD can receive the later click on its accept button, so the
/// completion path must use the start-time target instead of the current AX
/// focus when deciding between paste and clipboard fallback.
#[derive(Default)]
pub struct VoiceTargetTextField(pub Mutex<Option<bool>>);

#[allow(dead_code)]
/// Last dictation result for "paste last".
#[derive(Default)]
pub struct LastTranscript(pub Mutex<Option<String>>);

/// CGDirectDisplayID the user picked in the multi-monitor screen picker,
/// applying for the whole lifetime of the recording it was picked for (not
/// just the first read) — `tray_display_id` and `tray_monitor_physical_rect`
/// both read it via `get`. Cleared via `set(app, None)` by `show_monitor_picker`
/// (next pick), `hide_recording_chrome` (stop), and
/// `native_fullscreen_recording_cancel` (aborted start) — a stale pick must
/// never leak into a later recording that skipped the picker (e.g. only one
/// monitor connected).
#[derive(Default)]
pub struct SelectedRecordingDisplay(pub Mutex<Option<u32>>);

impl SelectedRecordingDisplay {
    pub fn get(app: &AppHandle) -> Option<u32> {
        app.try_state::<Self>()
            .and_then(|s| s.0.lock().ok().and_then(|g| *g))
    }

    pub fn set(app: &AppHandle, display_id: Option<u32>) {
        if let Some(state) = app.try_state::<Self>() {
            if let Ok(mut guard) = state.0.lock() {
                *guard = display_id;
            }
        }
    }
}

/// The window selected by the native macOS Window picker. The ID is enough to
/// rebuild a ScreenCaptureKit filter after pause/resume or an interruption;
/// dimensions come from the picker so the writer can be sized without another
/// slow shareable-content lookup during the start critical path.
#[derive(Clone, Copy, Debug)]
pub struct RecordingWindowSelection {
    pub window_id: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct SelectedRecordingWindow(pub Mutex<Option<RecordingWindowSelection>>);

impl SelectedRecordingWindow {
    pub fn get(app: &AppHandle) -> Option<RecordingWindowSelection> {
        app.try_state::<Self>()
            .and_then(|s| s.0.lock().ok().and_then(|g| *g))
    }

    pub fn set(app: &AppHandle, selection: Option<RecordingWindowSelection>) {
        if let Some(state) = app.try_state::<Self>() {
            if let Ok(mut guard) = state.0.lock() {
                *guard = selection;
            }
        }
    }
}
