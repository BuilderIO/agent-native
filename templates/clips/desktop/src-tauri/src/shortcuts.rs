use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::clips::{remember_voice_target, toggle_popover};
use crate::dlog;
use crate::state::{DictationActive, VoiceWakePopover};
use crate::util::{
    hide_voice_wake_popover, is_dictation_active, is_recording_active, set_dictation_active,
    show_without_activation,
};

fn escape_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

fn enter_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Enter)
}

fn numpad_enter_shortcut() -> Shortcut {
    Shortcut::new(None, Code::NumpadEnter)
}

fn countdown_return_shortcuts() -> Vec<Shortcut> {
    #[cfg(target_os = "windows")]
    {
        vec![enter_shortcut()]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![enter_shortcut(), numpad_enter_shortcut()]
    }
}

fn countdown_shortcuts() -> Vec<Shortcut> {
    let mut shortcuts = vec![escape_shortcut()];
    shortcuts.extend(countdown_return_shortcuts());
    shortcuts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn countdown_return_shortcuts_match_platform_registration() {
        let shortcuts = countdown_return_shortcuts();
        assert!(shortcuts.contains(&enter_shortcut()));

        #[cfg(target_os = "windows")]
        assert!(!shortcuts.contains(&numpad_enter_shortcut()));

        #[cfg(not(target_os = "windows"))]
        assert!(shortcuts.contains(&numpad_enter_shortcut()));
    }

    #[test]
    fn recording_shortcuts_match_platform_defaults() {
        #[cfg(target_os = "macos")]
        {
            assert!(record_start_stop_shortcuts().contains(&Shortcut::new(
                Some(Modifiers::SUPER | Modifiers::SHIFT),
                Code::KeyL,
            )));
            assert!(record_cancel_shortcuts().contains(&Shortcut::new(
                Some(Modifiers::ALT | Modifiers::SHIFT),
                Code::KeyC,
            )));
            assert!(record_pause_shortcuts().contains(&Shortcut::new(
                Some(Modifiers::ALT | Modifiers::SHIFT),
                Code::KeyP,
            )));
        }

        #[cfg(not(target_os = "macos"))]
        {
            assert!(record_start_stop_shortcuts().contains(&Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::KeyL,
            )));
            assert!(record_cancel_shortcuts().contains(&Shortcut::new(
                Some(Modifiers::ALT | Modifiers::SHIFT),
                Code::KeyC,
            )));
            assert!(record_pause_shortcuts().contains(&Shortcut::new(
                Some(Modifiers::ALT | Modifiers::SHIFT),
                Code::KeyP,
            )));
            assert!(record_pause_shortcuts().contains(&Shortcut::new(
                Some(Modifiers::ALT | Modifiers::SHIFT),
                Code::KeyS,
            )));
        }
    }
}

static CUSTOM_VOICE_SHORTCUT: OnceLock<Mutex<Option<Shortcut>>> = OnceLock::new();
static CUSTOM_POPOVER_SHORTCUT: OnceLock<Mutex<Option<Shortcut>>> = OnceLock::new();
static CUSTOM_RECORD_SHORTCUT: OnceLock<Mutex<Option<Shortcut>>> = OnceLock::new();
static CUSTOM_RECORD_CANCEL_SHORTCUT: OnceLock<Mutex<Option<Shortcut>>> = OnceLock::new();
static CUSTOM_RECORD_PAUSE_SHORTCUT: OnceLock<Mutex<Option<Shortcut>>> = OnceLock::new();
static FN_TAP_ENABLED: AtomicBool = AtomicBool::new(false);
static FN_TAP_INSTALL_STARTED: AtomicBool = AtomicBool::new(false);
static POPOVER_DISMISS_SHORTCUT_ACTIVE: AtomicBool = AtomicBool::new(false);
static POPOVER_VISIBILITY_GENERATION: AtomicU64 = AtomicU64::new(0);
static COUNTDOWN_SHORTCUTS_ACTIVE: AtomicBool = AtomicBool::new(false);
static COUNTDOWN_SHORTCUTS_GENERATION: AtomicU64 = AtomicU64::new(0);
static COUNTDOWN_SHORTCUTS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static DICTATION_ESCAPE_SHORTCUT_ACTIVE: AtomicBool = AtomicBool::new(false);

fn custom_voice_shortcut() -> &'static Mutex<Option<Shortcut>> {
    CUSTOM_VOICE_SHORTCUT.get_or_init(|| Mutex::new(None))
}

fn custom_popover_shortcut() -> &'static Mutex<Option<Shortcut>> {
    CUSTOM_POPOVER_SHORTCUT.get_or_init(|| Mutex::new(None))
}

fn custom_record_shortcut() -> &'static Mutex<Option<Shortcut>> {
    CUSTOM_RECORD_SHORTCUT.get_or_init(|| Mutex::new(None))
}

fn custom_record_cancel_shortcut() -> &'static Mutex<Option<Shortcut>> {
    CUSTOM_RECORD_CANCEL_SHORTCUT.get_or_init(|| Mutex::new(None))
}

fn custom_record_pause_shortcut() -> &'static Mutex<Option<Shortcut>> {
    CUSTOM_RECORD_PAUSE_SHORTCUT.get_or_init(|| Mutex::new(None))
}

fn current_custom_voice_shortcut() -> Option<Shortcut> {
    custom_voice_shortcut().lock().ok().and_then(|g| *g)
}

fn current_custom_popover_shortcut() -> Option<Shortcut> {
    custom_popover_shortcut().lock().ok().and_then(|g| *g)
}

fn current_custom_record_shortcut() -> Option<Shortcut> {
    custom_record_shortcut().lock().ok().and_then(|g| *g)
}

fn current_custom_record_cancel_shortcut() -> Option<Shortcut> {
    custom_record_cancel_shortcut().lock().ok().and_then(|g| *g)
}

fn current_custom_record_pause_shortcut() -> Option<Shortcut> {
    custom_record_pause_shortcut().lock().ok().and_then(|g| *g)
}

fn parse_optional_shortcut(value: Option<String>) -> Result<Option<Shortcut>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    Shortcut::from_str(trimmed)
        .map(Some)
        .map_err(|err| err.to_string())
}

fn swap_custom_shortcut<R: tauri::Runtime>(
    gs: &tauri_plugin_global_shortcut::GlobalShortcut<R>,
    state: &Mutex<Option<Shortcut>>,
    next: Option<Shortcut>,
    label: &str,
) -> Result<Option<Shortcut>, String> {
    let mut current = state
        .lock()
        .map_err(|_| format!("failed to lock {label} shortcut state"))?;
    if *current == next {
        return Ok(*current);
    }
    let old = current.take();
    if let Some(old) = old {
        if gs.is_registered(old) {
            let _ = gs.unregister(old);
        }
    }
    if let Some(next) = next {
        if let Err(err) = gs.register(next) {
            if let Some(old) = old {
                if gs.register(old).is_ok() {
                    *current = Some(old);
                }
            }
            return Err(format!("failed to register {label} shortcut: {err}"));
        }
    }
    *current = next;
    Ok(old)
}

fn swap_custom_recording_shortcut<R: tauri::Runtime>(
    gs: &tauri_plugin_global_shortcut::GlobalShortcut<R>,
    state: &Mutex<Option<Shortcut>>,
    next: Option<Shortcut>,
    defaults: &[Shortcut],
    label: &str,
) -> Result<Option<Shortcut>, String> {
    let current = state
        .lock()
        .map_err(|_| format!("failed to lock {label} shortcut state"))?
        .to_owned();
    if current == next {
        return Ok(current);
    }

    let replacing_default = current.is_none() && next.is_some();
    let restoring_default = current.is_some() && next.is_none();
    if replacing_default {
        for shortcut in defaults {
            if gs.is_registered(*shortcut) {
                let _ = gs.unregister(*shortcut);
            }
        }
    }
    if restoring_default {
        let mut newly_registered = Vec::new();
        for shortcut in defaults {
            if gs.is_registered(*shortcut) {
                continue;
            }
            if let Err(error) = gs.register(*shortcut) {
                for registered in newly_registered {
                    let _ = gs.unregister(registered);
                }
                return Err(format!(
                    "failed to restore default {label} shortcut: {error}"
                ));
            }
            newly_registered.push(*shortcut);
        }
    }

    match swap_custom_shortcut(gs, state, next, label) {
        Ok(previous) => Ok(previous),
        Err(error) => {
            if replacing_default {
                for shortcut in defaults {
                    if !gs.is_registered(*shortcut) {
                        let _ = gs.register(*shortcut);
                    }
                }
            } else if restoring_default {
                for shortcut in defaults {
                    if gs.is_registered(*shortcut) {
                        let _ = gs.unregister(*shortcut);
                    }
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn set_custom_shortcuts(
    app: AppHandle,
    voice: Option<String>,
    popover: Option<String>,
    record: Option<String>,
    record_cancel: Option<String>,
    record_pause: Option<String>,
) -> Result<(), String> {
    let voice = parse_optional_shortcut(voice)?;
    let popover = parse_optional_shortcut(popover)?;
    let record = parse_optional_shortcut(record)?;
    let record_cancel = parse_optional_shortcut(record_cancel)?;
    let record_pause = parse_optional_shortcut(record_pause)?;
    let slots = [
        ("Voice dictation", voice),
        ("Open Clips", popover),
        ("Start/stop recording", record),
        ("Cancel recording", record_cancel),
        ("Pause/resume recording", record_pause),
    ];
    for (index, (label, shortcut)) in slots.iter().enumerate() {
        if shortcut.is_none() {
            continue;
        }
        if slots[..index]
            .iter()
            .any(|(_, other)| other.is_some() && other == shortcut)
        {
            return Err(format!("{label} needs a different shortcut."));
        }
    }
    let gs = app.global_shortcut();
    let record_defaults = record_start_stop_shortcuts();
    let record_cancel_defaults = record_cancel_shortcuts();
    let record_pause_defaults = record_pause_shortcuts();

    let updates = [
        (custom_voice_shortcut(), voice, "voice", None),
        (custom_popover_shortcut(), popover, "Clips", None),
        (
            custom_record_shortcut(),
            record,
            "recording",
            Some(record_defaults.as_slice()),
        ),
        (
            custom_record_cancel_shortcut(),
            record_cancel,
            "recording cancel",
            Some(record_cancel_defaults.as_slice()),
        ),
        (
            custom_record_pause_shortcut(),
            record_pause,
            "recording pause",
            Some(record_pause_defaults.as_slice()),
        ),
    ];
    let mut previous = Vec::with_capacity(updates.len());
    for (state, next, label, defaults) in updates {
        let result = match defaults {
            Some(defaults) => swap_custom_recording_shortcut(gs, state, next, defaults, label),
            None => swap_custom_shortcut(gs, state, next, label),
        };
        match result {
            Ok(old) => previous.push((state, old, label, defaults)),
            Err(err) => {
                for (state, old, label, defaults) in previous.into_iter().rev() {
                    if let Some(defaults) = defaults {
                        let _ = swap_custom_recording_shortcut(gs, state, old, defaults, label);
                    } else {
                        let _ = swap_custom_shortcut(gs, state, old, label);
                    }
                }
                return Err(err);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn set_fn_shortcut_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    FN_TAP_ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        set_dictation_active_and_sync_escape(&app, false);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    ensure_fn_event_tap(app);

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }

    Ok(())
}

fn paste_last_dictation_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    {
        Shortcut::new(Some(Modifiers::SUPER | Modifiers::CONTROL), Code::KeyV)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyV)
    }
}

fn record_start_stop_shortcuts() -> Vec<Shortcut> {
    #[cfg(target_os = "macos")]
    {
        vec![Shortcut::new(
            Some(Modifiers::SUPER | Modifiers::SHIFT),
            Code::KeyL,
        )]
    }
    #[cfg(not(target_os = "macos"))]
    {
        vec![Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::SHIFT),
            Code::KeyL,
        )]
    }
}

fn record_cancel_shortcuts() -> Vec<Shortcut> {
    vec![Shortcut::new(
        Some(Modifiers::ALT | Modifiers::SHIFT),
        Code::KeyC,
    )]
}

fn record_pause_shortcuts() -> Vec<Shortcut> {
    #[cfg(target_os = "macos")]
    {
        vec![Shortcut::new(
            Some(Modifiers::ALT | Modifiers::SHIFT),
            Code::KeyP,
        )]
    }
    #[cfg(not(target_os = "macos"))]
    {
        vec![
            Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyP),
            Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyS),
        ]
    }
}

fn matches_any(shortcut: &Shortcut, candidates: &[Shortcut]) -> bool {
    candidates.iter().any(|candidate| candidate == shortcut)
}

pub fn register_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let voice_cmd_space = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
    let voice_ctrl_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    let gs = app.handle().global_shortcut();
    for shortcut in record_start_stop_shortcuts()
        .into_iter()
        .chain(record_cancel_shortcuts())
        .chain(record_pause_shortcuts())
    {
        if let Err(err) = gs.register(shortcut) {
            eprintln!("[clips-tray] failed to register recording shortcut {shortcut:?}: {err}");
        }
    }
    if let Err(err) = gs.register(voice_cmd_space) {
        eprintln!("[clips-tray] failed to register Cmd+Shift+Space voice shortcut: {err}");
    }
    if let Err(err) = gs.register(voice_ctrl_space) {
        eprintln!("[clips-tray] failed to register Ctrl+Shift+Space voice shortcut: {err}");
    }
    if let Err(err) = gs.register(paste_last_dictation_shortcut()) {
        eprintln!("[clips-tray] failed to register paste-last-dictation shortcut: {err}");
    }

    Ok(())
}

pub fn install_popover_dismiss_handler(app: &tauri::App) {
    #[cfg(target_os = "macos")]
    install_window_picker_escape_monitor(app);

    let handle = app.handle().clone();
    app.listen("clips:popover-visible", move |event| {
        let payload = event.payload().to_string();
        let generation = POPOVER_VISIBILITY_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let handle = handle.clone();
        std::thread::spawn(move || {
            if POPOVER_VISIBILITY_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let visible: bool = serde_json::from_str(&payload).unwrap_or(false);
            let picker_active = crate::native_screen::window_picker_active();
            let recording_flow_active = is_recording_active(&handle);
            POPOVER_DISMISS_SHORTCUT_ACTIVE.store(visible, Ordering::SeqCst);
            let shortcut = escape_shortcut();
            let gs = handle.global_shortcut();
            if visible || picker_active || recording_flow_active {
                if !gs.is_registered(shortcut) {
                    if let Err(err) = gs.register(shortcut) {
                        eprintln!("[clips-tray] failed to register Escape: {err}");
                    }
                }
            } else if !COUNTDOWN_SHORTCUTS_ACTIVE.load(Ordering::SeqCst)
                && !DICTATION_ESCAPE_SHORTCUT_ACTIVE.load(Ordering::SeqCst)
                && gs.is_registered(shortcut)
            {
                let _ = gs.unregister(shortcut);
            }
        });
    });
}

#[cfg(target_os = "macos")]
fn install_window_picker_escape_monitor(app: &tauri::App) {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};

    let app_for_global = app.handle().clone();
    let global_handler = RcBlock::new(move |event: NonNull<NSEvent>| {
        if crate::native_screen::window_picker_active() && unsafe { event.as_ref().keyCode() } == 53
        {
            let app = app_for_global.clone();
            thread::spawn(move || crate::native_screen::cancel_window_picker(&app));
        }
    });
    if NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &global_handler)
        .is_none()
    {
        eprintln!("[clips-tray] failed to install global Window picker Escape monitor");
    }

    let app_for_local = app.handle().clone();
    let local_handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        if crate::native_screen::window_picker_active() && unsafe { event.as_ref().keyCode() } == 53
        {
            let app = app_for_local.clone();
            thread::spawn(move || crate::native_screen::cancel_window_picker(&app));
        }
        event.as_ptr()
    });
    let local_monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &local_handler)
    };
    if local_monitor.is_none() {
        eprintln!("[clips-tray] failed to install local Window picker Escape monitor");
    }
}

pub(crate) async fn arm_window_picker_escape(app: &AppHandle) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let shortcut = escape_shortcut();
        let gs = app.global_shortcut();
        if gs.is_registered(shortcut) {
            return Ok(());
        }
        gs.register(shortcut)
            .map_err(|error| format!("failed to register Window picker Escape: {error}"))
    })
    .await
    .map_err(|error| format!("Window picker Escape registration worker stopped: {error}"))?
}

pub fn set_dictation_active_and_sync_escape(app: &AppHandle, active: bool) {
    set_dictation_active(app, active);
    sync_dictation_escape_shortcut(app.clone(), active);
}

#[tauri::command]
pub fn set_dictation_escape_active(app: AppHandle, active: bool) -> Result<(), String> {
    set_dictation_active_and_sync_escape(&app, active);
    Ok(())
}

fn sync_dictation_escape_shortcut(app: AppHandle, active: bool) {
    DICTATION_ESCAPE_SHORTCUT_ACTIVE.store(active, Ordering::SeqCst);
    thread::spawn(move || {
        let gs = app.global_shortcut();
        let shortcut = escape_shortcut();
        if active {
            if !gs.is_registered(shortcut) {
                if let Err(err) = gs.register(shortcut) {
                    eprintln!("[clips-tray] failed to register dictation-cancel Escape: {err}");
                }
            }
            return;
        }
        if !POPOVER_DISMISS_SHORTCUT_ACTIVE.load(Ordering::SeqCst)
            && !COUNTDOWN_SHORTCUTS_ACTIVE.load(Ordering::SeqCst)
            && gs.is_registered(shortcut)
        {
            let _ = gs.unregister(shortcut);
        }
    });
}

pub(crate) async fn prepare_countdown_shortcuts(app: AppHandle) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = COUNTDOWN_SHORTCUTS_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = COUNTDOWN_SHORTCUTS_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        COUNTDOWN_SHORTCUTS_ACTIVE.store(true, Ordering::SeqCst);
        let gs = app.global_shortcut();
        let mut newly_registered = Vec::new();
        for shortcut in countdown_shortcuts() {
            if !gs.is_registered(shortcut) {
                if let Err(error) = gs.register(shortcut) {
                    for registered in newly_registered {
                        let _ = gs.unregister(registered);
                    }
                    COUNTDOWN_SHORTCUTS_ACTIVE.store(false, Ordering::SeqCst);
                    return Err(format!("failed to register countdown shortcut: {error}"));
                }
                newly_registered.push(shortcut);
            }
        }
        Ok::<u64, String>(generation)
    })
    .await
    .map_err(|error| format!("countdown shortcut worker stopped unexpectedly: {error}"))?
}

pub(crate) async fn finish_countdown_shortcuts(
    app: AppHandle,
    generation: u64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = COUNTDOWN_SHORTCUTS_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if COUNTDOWN_SHORTCUTS_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        COUNTDOWN_SHORTCUTS_ACTIVE.store(false, Ordering::SeqCst);
        let gs = app.global_shortcut();
        for shortcut in countdown_return_shortcuts() {
            if gs.is_registered(shortcut) {
                let _ = gs.unregister(shortcut);
            }
        }
        let escape = escape_shortcut();
        if !POPOVER_DISMISS_SHORTCUT_ACTIVE.load(Ordering::SeqCst)
            && !DICTATION_ESCAPE_SHORTCUT_ACTIVE.load(Ordering::SeqCst)
            && gs.is_registered(escape)
        {
            let _ = gs.unregister(escape);
        }
    })
    .await
    .map_err(|error| format!("countdown shortcut cleanup worker stopped unexpectedly: {error}"))
}

/// Observe key-down events only while Clips itself is the active application.
/// AppKit local monitors need no Input Monitoring permission and never receive
/// keystrokes destined for another app. The active-generation gate keeps this
/// listener inert outside the three-second countdown.
#[cfg(target_os = "macos")]
pub fn install_countdown_local_key_monitor(app: &tauri::App) {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};

    let app = app.handle().clone();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        if COUNTDOWN_SHORTCUTS_ACTIVE.load(Ordering::SeqCst) {
            let key_code = unsafe { event.as_ref().keyCode() };
            let countdown_event = match key_code {
                36 | 76 => Some("clips:countdown-done"),
                53 => Some("clips:countdown-cancel"),
                _ => None,
            };
            if let Some(countdown_event) = countdown_event {
                let app = app.clone();
                thread::spawn(move || finish_countdown_from_shortcut(&app, countdown_event));
            }
        }
        event.as_ptr()
    });
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &handler)
    };
    if monitor.is_none() {
        eprintln!("[clips-tray] failed to install app-local countdown key monitor");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install_countdown_local_key_monitor(_app: &tauri::App) {}

fn finish_countdown_from_shortcut(app: &AppHandle, event: &'static str) {
    dlog!("[clips-tray] countdown shortcut accepted: {event}");
    let cause = if event == "clips:countdown-cancel" {
        "escape"
    } else {
        "return"
    };
    let _ = app.emit(event, serde_json::json!({ "cause": cause }));
    if let Some(window) = app.get_webview_window("countdown") {
        let _ = window.close();
    }
    let app = app.clone();
    let generation = COUNTDOWN_SHORTCUTS_GENERATION.load(Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        let _ = finish_countdown_shortcuts(app, generation).await;
    });
}

pub fn build_shortcut_plugin() -> tauri_plugin_global_shortcut::Builder<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
        let is_voice_cmd_space = shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space);
        let is_voice_ctrl_space =
            shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space);
        let is_custom_voice = current_custom_voice_shortcut()
            .map(|custom| custom == *shortcut)
            .unwrap_or(false);
        let is_custom_popover = current_custom_popover_shortcut()
            .map(|custom| custom == *shortcut)
            .unwrap_or(false);
        let is_custom_record = current_custom_record_shortcut()
            .map(|custom| custom == *shortcut)
            .unwrap_or(false);
        let is_custom_record_cancel = current_custom_record_cancel_shortcut()
            .map(|custom| custom == *shortcut)
            .unwrap_or(false);
        let is_custom_record_pause = current_custom_record_pause_shortcut()
            .map(|custom| custom == *shortcut)
            .unwrap_or(false);
        let is_record_start_stop = matches_any(shortcut, &record_start_stop_shortcuts());
        let is_record_cancel = matches_any(shortcut, &record_cancel_shortcuts());
        let is_record_pause = matches_any(shortcut, &record_pause_shortcuts());
        let is_escape = shortcut.matches(Modifiers::empty(), Code::Escape);
        let is_enter = shortcut.matches(Modifiers::empty(), Code::Enter);
        let is_numpad_enter = shortcut.matches(Modifiers::empty(), Code::NumpadEnter);
        let is_paste_last_dictation = *shortcut == paste_last_dictation_shortcut();
        if (is_escape || is_enter || is_numpad_enter)
            && COUNTDOWN_SHORTCUTS_ACTIVE.load(Ordering::SeqCst)
        {
            if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }
            if app.get_webview_window("countdown").is_some() {
                let event = if is_escape {
                    "clips:countdown-cancel"
                } else {
                    "clips:countdown-done"
                };
                finish_countdown_from_shortcut(app, event);
                return;
            }
            let app = app.clone();
            let generation = COUNTDOWN_SHORTCUTS_GENERATION.load(Ordering::SeqCst);
            tauri::async_runtime::spawn(async move {
                let _ = finish_countdown_shortcuts(app, generation).await;
            });
        }
        if is_escape {
            if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }
            if crate::native_screen::window_picker_active() {
                crate::native_screen::cancel_window_picker(app);
                return;
            }
            if is_dictation_active(app) {
                let _ = app.emit("voice:cancel", ());
                return;
            }
            if is_recording_active(app) && crate::clips::popover_is_parked(app) {
                return;
            }
            crate::clips::hide_popover(app);
            return;
        }
        if is_paste_last_dictation {
            if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = crate::clips::paste_last_dictation(app).await {
                    eprintln!("[clips-tray] paste_last_dictation failed: {err}");
                }
            });
            return;
        }
        if is_voice_cmd_space || is_voice_ctrl_space || is_custom_voice {
            let source = if is_custom_voice {
                "custom"
            } else if is_voice_cmd_space {
                "cmd-shift-space"
            } else {
                "ctrl-shift-space"
            };
            let active_state = app.try_state::<DictationActive>();
            match event.state() {
                tauri_plugin_global_shortcut::ShortcutState::Pressed => {
                    let mut already_active = false;
                    if let Some(state) = active_state.as_ref() {
                        if let Ok(mut g) = state.0.lock() {
                            already_active = *g;
                            *g = true;
                        }
                    }
                    if !already_active {
                        eprintln!("[clips-tray] {source} down — starting voice dictation");
                        sync_dictation_escape_shortcut(app.clone(), true);
                        emit_voice_shortcut(app, "voice:shortcut-start", source, true);
                    }
                }
                tauri_plugin_global_shortcut::ShortcutState::Released => {
                    if let Some(state) = active_state.as_ref() {
                        if let Ok(mut g) = state.0.lock() {
                            *g = false;
                        }
                    }
                    eprintln!("[clips-tray] {source} up — stopping voice dictation");
                    sync_dictation_escape_shortcut(app.clone(), false);
                    emit_voice_shortcut(app, "voice:shortcut-stop", source, false);
                }
            }
            return;
        }

        if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
            return;
        }
        if is_record_cancel || is_custom_record_cancel {
            let _ = app.emit("clips:recorder-cancel", ());
            return;
        }
        if is_record_pause || is_custom_record_pause {
            let _ = app.emit("clips:recorder-toggle-pause", ());
            return;
        }
        if is_record_start_stop || is_custom_record {
            wake_popover_for_recording_shortcut(app);
            let app = app.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(80));
                let _ = app.emit("clips:record-shortcut", ());
            });
            return;
        }
        if is_custom_popover {
            toggle_popover(app);
        }
    })
}

fn wake_popover_for_recording_shortcut(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("popover") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    let _ = window.set_position(PhysicalPosition::new(2_i32, 2_i32));
    let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(2_u32, 2_u32)));
    show_without_activation(&window);
    let _ = app.emit("clips:popover-visible", false);
}

fn emit_voice_shortcut(
    app: &tauri::AppHandle,
    event: &'static str,
    source: &'static str,
    wake: bool,
) {
    if wake {
        remember_voice_target(app);
        wake_popover_for_voice(app);
        let app = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(80));
            if should_emit_delayed_voice_start(&app, source) {
                let _ = app.emit(event, serde_json::json!({ "source": source }));
            } else {
                hide_voice_wake_popover(&app);
            }
        });
        return;
    }
    let _ = app.emit(event, serde_json::json!({ "source": source }));
}

fn should_emit_delayed_voice_start(app: &tauri::AppHandle, source: &'static str) -> bool {
    if !is_dictation_active(app) {
        return false;
    }
    source != "fn" || (FN_TAP_ENABLED.load(Ordering::SeqCst) && current_fn_flag_down())
}

fn wake_popover_for_voice(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("popover") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    if let Some(state) = app.try_state::<VoiceWakePopover>() {
        if let Ok(mut g) = state.0.lock() {
            *g = true;
        }
    }
    let _ = window.set_position(PhysicalPosition::new(2_i32, 2_i32));
    let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(2_u32, 2_u32)));
    show_without_activation(&window);
    let _ = app.emit("clips:popover-visible", false);
}

#[cfg(target_os = "macos")]
fn ensure_fn_event_tap(app: tauri::AppHandle) {
    if FN_TAP_INSTALL_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    install_fn_event_tap(app);
}

#[cfg(target_os = "macos")]
fn fn_event_tap_is_enabled(tap: &core_graphics::event::CGEventTap<'static>) -> bool {
    use core_foundation::base::TCFType;

    extern "C" {
        fn CGEventTapIsEnabled(tap: core_foundation::mach_port::CFMachPortRef) -> bool;
    }

    unsafe { CGEventTapIsEnabled(tap.mach_port().as_concrete_TypeRef()) }
}

#[cfg(target_os = "macos")]
fn schedule_fn_event_tap_restart(app: tauri::AppHandle, reason: &'static str, delay: Duration) {
    eprintln!("[clips-tray][fn-tap] restarting Fn event tap: {reason}");
    FN_TAP_INSTALL_STARTED.store(false, Ordering::SeqCst);
    if !FN_TAP_ENABLED.load(Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        thread::sleep(delay);
        if FN_TAP_ENABLED.load(Ordering::SeqCst) {
            ensure_fn_event_tap(app);
        }
    });
}

#[cfg(target_os = "macos")]
fn install_fn_event_tap(app: tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    use core_foundation::runloop::{
        kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopRunResult,
    };
    use core_graphics::event::{
        CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, CallbackResult,
    };

    let prev_down = Arc::new(AtomicBool::new(false));
    let needs_reenable = Arc::new(AtomicBool::new(false));
    let event_count = Arc::new(AtomicU64::new(0));
    let fn_down_at = Arc::new(AtomicU64::new(0));
    let tap_epoch = std::time::Instant::now();

    let app_for_cancel = app.clone();
    let prev_for_cancel = prev_down.clone();
    app.listen("voice:cancel", move |_event| {
        prev_for_cancel.store(false, Ordering::SeqCst);
        set_dictation_active_and_sync_escape(&app_for_cancel, false);
    });

    dlog!("[clips-tray][fn-tap] install_fn_event_tap called — spawning listener thread");

    if let Err(err) = thread::Builder::new()
        .name("clips-fn-key-tap".into())
        .spawn(move || {
            let app_for_cb = app.clone();
            let prev_for_cb = prev_down.clone();
            let needs_reenable_for_cb = needs_reenable.clone();
            let event_count_for_cb = event_count.clone();
            let fn_down_at_for_cb = fn_down_at.clone();

            dlog!("[clips-tray][fn-tap] thread started; about to call CGEventTap::new");
            let tap_result = CGEventTap::new(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                vec![CGEventType::FlagsChanged],
                move |_proxy, etype, event| {
                    let n = event_count_for_cb.fetch_add(1, Ordering::SeqCst) + 1;
                    if n <= 5 || n % 50 == 0 {
                        dlog!(
                            "[clips-tray][fn-tap] event #{n} type={:?} flags={:?}",
                            etype,
                            event.get_flags()
                        );
                    }
                    match etype {
                        CGEventType::TapDisabledByTimeout => {
                            eprintln!(
                                "[clips-tray] Fn tap disabled by timeout — flagging for re-enable"
                            );
                            prev_for_cb.store(false, Ordering::SeqCst);
                            needs_reenable_for_cb.store(true, Ordering::SeqCst);
                            CFRunLoop::get_current().stop();
                            return CallbackResult::Keep;
                        }
                        CGEventType::TapDisabledByUserInput => {
                            eprintln!(
                                "[clips-tray] Fn tap disabled by user input — flagging for re-enable"
                            );
                            prev_for_cb.store(false, Ordering::SeqCst);
                            needs_reenable_for_cb.store(true, Ordering::SeqCst);
                            CFRunLoop::get_current().stop();
                            return CallbackResult::Keep;
                        }
                        CGEventType::FlagsChanged => {}
                        _ => return CallbackResult::Keep,
                    }

                    if !FN_TAP_ENABLED.load(Ordering::SeqCst) {
                        prev_for_cb.store(false, Ordering::SeqCst);
                        return CallbackResult::Keep;
                    }

                    let fn_down = event
                        .get_flags()
                        .contains(CGEventFlags::CGEventFlagSecondaryFn);
                    let was_down = prev_for_cb.swap(fn_down, Ordering::SeqCst);
                    if fn_down == was_down {
                        return CallbackResult::Keep;
                    }
                    set_dictation_active_and_sync_escape(&app_for_cb, fn_down);
                    if fn_down {
                        dlog!("[clips-tray] Fn down — starting voice dictation");
                        remember_voice_target(&app_for_cb);
                        fn_down_at_for_cb.store(
                            tap_epoch.elapsed().as_millis() as u64,
                            Ordering::SeqCst,
                        );
                        wake_popover_for_voice(&app_for_cb);
                        let app_for_emit = app_for_cb.clone();
                        let prev_for_emit = prev_for_cb.clone();
                        let fn_down_at_for_emit = fn_down_at_for_cb.clone();
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(80));
                            let still_down = prev_for_emit.load(Ordering::SeqCst);
                            let fast_tap = !still_down
                                && fn_down_at_for_emit.load(Ordering::SeqCst) != 0;
                            let should_emit = if fast_tap {
                                FN_TAP_ENABLED.load(Ordering::SeqCst)
                            } else {
                                should_emit_delayed_voice_start(&app_for_emit, "fn")
                            };
                            if (still_down || fast_tap) && should_emit {
                                let _ = app_for_emit.emit(
                                    "voice:shortcut-start",
                                    serde_json::json!({ "source": "fn" }),
                                );
                                if fast_tap {
                                    let _ = app_for_emit.emit(
                                        "voice:shortcut-stop",
                                        serde_json::json!({ "source": "fn" }),
                                    );
                                }
                            } else {
                                hide_voice_wake_popover(&app_for_emit);
                            }
                        });
                        install_fn_release_watchdog(app_for_cb.clone(), prev_for_cb.clone());
                    } else {
                        dlog!("[clips-tray] Fn up — stopping voice dictation");
                        let elapsed_since_down =
                            tap_epoch.elapsed().as_millis() as u64
                                - fn_down_at_for_cb.load(Ordering::SeqCst);
                        fn_down_at_for_cb.store(0, Ordering::SeqCst);
                        if elapsed_since_down < 80 {
                            // Fast tap: the delayed-start thread (still
                            // pending) will emit start+stop together once it
                            // wakes — see the fast_tap branch above. Emitting
                            // our own stop now would race ahead of a start
                            // that hasn't happened yet.
                            return CallbackResult::Keep;
                        }
                        let _ = app_for_cb.emit(
                            "voice:shortcut-stop",
                            serde_json::json!({ "source": "fn" }),
                        );
                    }
                    CallbackResult::Keep
                },
            );

            let tap = match tap_result {
                Ok(t) => {
                    dlog!("[clips-tray][fn-tap] CGEventTap::new succeeded");
                    t
                }
                Err(()) => {
                    eprintln!(
                        "[clips-tray][fn-tap] CGEventTapCreate returned NULL. Most likely cause: \
                         Input Monitoring is not granted to Clips. Open System Settings → \
                         Privacy & Security → Input Monitoring and enable Clips (or the \
                         terminal running `tauri dev`). Note: Accessibility is a separate \
                         permission and is not sufficient for ListenOnly taps."
                    );
                    schedule_fn_event_tap_restart(
                        app,
                        "CGEventTapCreate returned NULL",
                        Duration::from_secs(5),
                    );
                    return;
                }
            };
            let source = match tap.mach_port().create_runloop_source(0) {
                Ok(s) => {
                    dlog!("[clips-tray][fn-tap] runloop source created");
                    s
                }
                Err(()) => {
                    eprintln!("[clips-tray][fn-tap] CFMachPortCreateRunLoopSource failed");
                    schedule_fn_event_tap_restart(
                        app,
                        "CFMachPortCreateRunLoopSource failed",
                        Duration::from_secs(2),
                    );
                    return;
                }
            };
            let runloop = CFRunLoop::get_current();
            runloop.add_source(&source, unsafe { kCFRunLoopCommonModes });
            tap.enable();
            dlog!(
                "[clips-tray][fn-tap] tap enabled; entering runloop — press Fn now to test"
            );

            let mut consecutive_reenable_failures = 0_u8;
            loop {
                if !FN_TAP_ENABLED.load(Ordering::SeqCst) {
                    FN_TAP_INSTALL_STARTED.store(false, Ordering::SeqCst);
                    return;
                }

                let reenable_reason = if needs_reenable.swap(false, Ordering::SeqCst) {
                    Some("disabled callback")
                } else if !fn_event_tap_is_enabled(&tap) {
                    Some("health check")
                } else {
                    None
                };

                if let Some(reason) = reenable_reason {
                    eprintln!("[clips-tray][fn-tap] re-enabling Fn event tap ({reason})");
                    tap.enable();
                    thread::sleep(Duration::from_millis(20));
                    if fn_event_tap_is_enabled(&tap) {
                        consecutive_reenable_failures = 0;
                    } else {
                        consecutive_reenable_failures =
                            consecutive_reenable_failures.saturating_add(1);
                        if consecutive_reenable_failures >= 2 {
                            schedule_fn_event_tap_restart(
                                app.clone(),
                                "tapEnable did not stick",
                                Duration::from_millis(750),
                            );
                            return;
                        }
                    }
                }

                match unsafe {
                    CFRunLoop::run_in_mode(
                        kCFRunLoopDefaultMode,
                        Duration::from_millis(500),
                        true,
                    )
                } {
                    CFRunLoopRunResult::Finished => {
                        schedule_fn_event_tap_restart(
                            app.clone(),
                            "runloop finished",
                            Duration::from_millis(750),
                        );
                        return;
                    }
                    CFRunLoopRunResult::Stopped
                    | CFRunLoopRunResult::TimedOut
                    | CFRunLoopRunResult::HandledSource => {}
                }
            }
        })
    {
        FN_TAP_INSTALL_STARTED.store(false, Ordering::SeqCst);
        eprintln!("[clips-tray][fn-tap] failed to spawn listener thread: {err}");
    }
}

#[cfg(target_os = "macos")]
fn install_fn_release_watchdog(
    app: tauri::AppHandle,
    prev_down: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;
    use std::thread;
    use std::time::Duration;

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(120));
        while prev_down.load(Ordering::SeqCst) {
            if !current_fn_flag_down() {
                if prev_down.swap(false, Ordering::SeqCst) {
                    dlog!("[clips-tray] Fn up missed — synthesizing voice stop");
                    set_dictation_active_and_sync_escape(&app, false);
                    let _ = app.emit(
                        "voice:shortcut-stop",
                        serde_json::json!({ "source": "fn", "synthetic": true }),
                    );
                }
                break;
            }
            thread::sleep(Duration::from_millis(120));
        }
    });
}

#[cfg(target_os = "macos")]
fn current_fn_flag_down() -> bool {
    use core_graphics::event::CGEventFlags;
    use core_graphics::event_source::CGEventSourceStateID;

    extern "C" {
        fn CGEventSourceFlagsState(state_id: CGEventSourceStateID) -> CGEventFlags;
    }

    let flags = unsafe { CGEventSourceFlagsState(CGEventSourceStateID::HIDSystemState) };
    flags.contains(CGEventFlags::CGEventFlagSecondaryFn)
}

#[cfg(not(target_os = "macos"))]
fn current_fn_flag_down() -> bool {
    true
}
