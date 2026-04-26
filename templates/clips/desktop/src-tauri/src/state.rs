use std::sync::Mutex;
use std::time::Instant;
use tauri::Rect;

/// Last-known tray icon rect, updated on every tray event. Used to anchor the
/// popover directly under the icon (Loom-style) instead of floating in the
/// top-right corner of the screen.
#[derive(Default)]
pub struct TrayAnchor(pub Mutex<Option<Rect>>);

/// Timestamp of the most-recent popover show. The blur-to-hide handler checks
/// this — macOS briefly steals focus during the tray click itself, so without
/// this guard the popover would be hidden the instant it's shown.
#[derive(Default)]
pub struct PopoverShownAt(pub Mutex<Option<Instant>>);

/// Whether a recording is currently in progress. Set from JS via
/// `set_recording_state`. Used to re-purpose the tray icon click as a
/// stop-recording shortcut while recording, matching Loom.
#[derive(Default)]
pub struct RecordingActive(pub Mutex<bool>);

#[allow(dead_code)]
/// Whether a meeting recording is in progress.
#[derive(Default)]
pub struct MeetingActive(pub Mutex<bool>);

#[allow(dead_code)]
/// Whether dictation is toggled on.
#[derive(Default)]
pub struct DictationEnabled(pub Mutex<bool>);

#[allow(dead_code)]
/// Last dictation result for "paste last".
#[derive(Default)]
pub struct LastTranscript(pub Mutex<Option<String>>);
