use std::sync::{atomic::AtomicBool, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager, Rect};

use crate::tray_meetings::MeetingItem;

#[derive(Default)]
pub struct TrayAnchor(pub Mutex<Option<Rect>>);

#[derive(Default)]
pub struct TrayMeetings(pub Mutex<Vec<MeetingItem>>);

#[derive(Default)]
pub struct PopoverShownAt(pub Mutex<Option<Instant>>);

#[derive(Default)]
pub struct PopoverParked(pub AtomicBool);

#[derive(Default)]
pub struct RecordingActive(pub Mutex<bool>);

#[derive(Default)]
pub struct MeetingActive(pub Mutex<bool>);

#[derive(Default)]
pub struct ActiveMeetingId(pub Mutex<Option<String>>);

#[allow(dead_code)]
#[derive(Default)]
pub struct DictationEnabled(pub Mutex<bool>);

#[derive(Default)]
pub struct DictationActive(pub Mutex<bool>);

#[derive(Default)]
pub struct VoiceWakePopover(pub Mutex<bool>);

#[derive(Default)]
pub struct VoiceTargetBundle(pub Mutex<Option<String>>);

#[derive(Default)]
pub struct VoiceTargetTextField(pub Mutex<Option<bool>>);

#[allow(dead_code)]
#[derive(Default)]
pub struct LastTranscript(pub Mutex<Option<String>>);

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
