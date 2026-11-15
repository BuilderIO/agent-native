use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::clips::{remember_voice_target, toggle_popover};
use crate::dlog;
use crate::state::VoiceWakePopover;
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
    fn a_voice_stop_says_how_long_the_key_was_held() {
        assert_eq!(
            voice_stop_payload("fn", Some(Duration::from_millis(240))),
            serde_json::json!({ "source": "fn", "heldMs": 240 }),
        );
        assert_eq!(
            voice_stop_payload("custom", None),
            serde_json::json!({ "source": "custom" }),
        );
    }

    fn ms(millis: u64) -> Duration {
        Duration::from_millis(millis)
    }

    fn names(events: &[(&'static str, serde_json::Value)]) -> Vec<&'static str> {
        events.iter().map(|(name, _)| *name).collect()
    }

    /// The hold time a key-up sends its own stop with, if it sends one.
    fn released(press: &FnPress, at: Instant) -> Option<Duration> {
        let mut stop = None;
        press.release(at, |held| stop = Some(held));
        stop
    }

    #[test]
    fn an_fn_tap_let_go_before_the_start_delay_arrives_as_start_then_stop() {
        let down = Instant::now();
        let press = FnPress::new(down);
        assert_eq!(released(&press, down + ms(40)), None);

        let start = press.start_due(|start| start);
        assert_eq!(start, FnStart::Tap(ms(40)));
        let events = fn_start_events(start, true, || panic!("a tap is not a hold"));
        assert_eq!(
            names(&events),
            ["voice:shortcut-start", "voice:shortcut-stop"]
        );
        assert_eq!(events[1].1["heldMs"], 40);
    }

    #[test]
    fn two_quick_fn_taps_each_arrive_for_the_hands_free_gesture() {
        let first_down = Instant::now();
        let first = FnPress::new(first_down);
        assert_eq!(released(&first, first_down + ms(30)), None);
        let second = FnPress::new(first_down + ms(60));
        assert_eq!(released(&second, first_down + ms(95)), None);

        for (press, held) in [(&first, 30), (&second, 35)] {
            let events = press.start_due(|start| fn_start_events(start, true, || false));
            assert_eq!(
                names(&events),
                ["voice:shortcut-start", "voice:shortcut-stop"]
            );
            assert_eq!(events[1].1["heldMs"], held);
        }
    }

    #[test]
    fn an_fn_hold_starts_at_the_delay_and_stops_at_key_up() {
        let down = Instant::now();
        let press = FnPress::new(down);
        let start = press.start_due(|start| start);
        assert_eq!(start, FnStart::Hold);
        assert_eq!(
            names(&fn_start_events(start, true, || true)),
            ["voice:shortcut-start"]
        );
        assert_eq!(released(&press, down + ms(500)), Some(ms(500)));
    }

    #[test]
    fn an_fn_tap_sends_nothing_while_fn_dictation_is_off() {
        let down = Instant::now();
        let press = FnPress::new(down);
        released(&press, down + ms(40));
        assert!(press
            .start_due(|start| fn_start_events(start, false, || true))
            .is_empty());
    }

    /// Lets a key-up land while `send_start` is partway through sending a
    /// start, and returns the order the events went out in.
    fn sent_with_a_key_up_mid_start(
        send_start: impl FnOnce(Box<dyn FnOnce() + Send>) + Send + 'static,
        key_up: impl FnOnce(Box<dyn FnOnce()>),
    ) -> Vec<&'static str> {
        let sent = std::sync::Arc::new(Mutex::new(Vec::new()));
        let (sending, started_sending) = std::sync::mpsc::channel();
        let start = {
            let sent = sent.clone();
            thread::spawn(move || {
                send_start(Box::new(move || {
                    sending.send(()).unwrap();
                    thread::sleep(ms(50));
                    sent.lock().unwrap().push("start");
                }))
            })
        };
        started_sending.recv().unwrap();
        let stop_sent = sent.clone();
        key_up(Box::new(move || stop_sent.lock().unwrap().push("stop")));
        start.join().unwrap();
        let sent = sent.lock().unwrap().clone();
        sent
    }

    #[test]
    fn an_fn_key_up_waits_for_a_start_already_going_out() {
        let down = Instant::now();
        let press = std::sync::Arc::new(FnPress::new(down));
        let press_for_start = press.clone();
        let sent = sent_with_a_key_up_mid_start(
            move |send| press_for_start.start_due(|_| send()),
            |send| press.release(down + ms(500), |_| send()),
        );
        assert_eq!(sent, ["start", "stop"]);
    }

    #[test]
    fn a_shortcut_key_up_waits_for_a_start_already_going_out() {
        let pending = std::sync::Arc::new(Mutex::new(PendingVoiceStart {
            pending: true,
            ..PendingVoiceStart::default()
        }));
        let pending_for_start = pending.clone();
        let sent = sent_with_a_key_up_mid_start(
            move |send| voice_start_due(&pending_for_start, |_| send()),
            |send| release_voice_start(&pending, Some(ms(500)), send),
        );
        assert_eq!(sent, ["start", "stop"]);
    }

    #[test]
    fn a_shortcut_tap_let_go_before_the_start_delay_goes_out_whole_with_the_start() {
        let pending = Mutex::new(PendingVoiceStart {
            pending: true,
            ..PendingVoiceStart::default()
        });
        release_voice_start(&pending, Some(ms(40)), || {
            panic!("the delayed start sends this tap's stop")
        });
        assert_eq!(
            voice_start_due(&pending, |released| released),
            Some(Some(ms(40)))
        );
        let mut stopped = false;
        release_voice_start(&pending, Some(ms(40)), || stopped = true);
        assert!(stopped, "a key-up after the start sends its own stop");
    }

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
    fn countdown_terminal_events_match_the_active_generation() {
        let attempt = (7, "countdown-attempt-7".to_string());
        assert_eq!(
            countdown_attempt_id_for_generation(Some(&attempt), 7),
            Some("countdown-attempt-7"),
        );
        assert_eq!(countdown_attempt_id_for_generation(Some(&attempt), 8), None);
        assert_eq!(countdown_attempt_id_for_generation(None, 7), None);
    }

    #[test]
    fn countdown_shortcut_state_reads_generation_without_a_lock() {
        assert_eq!(active_countdown_generation_from_state(0), None);
        assert_eq!(active_countdown_generation_from_state(8 << 1), None,);
        assert_eq!(
            active_countdown_generation_from_state((8 << 1) | COUNTDOWN_SHORTCUTS_ACTIVE_BIT),
            Some(8),
        );
    }

    #[test]
    fn countdown_generation_cleanup_matches_only_the_active_generation() {
        assert!(countdown_generation_matches_state(
            (8 << 1) | COUNTDOWN_SHORTCUTS_ACTIVE_BIT,
            8,
        ));
        assert!(!countdown_generation_matches_state(
            (9 << 1) | COUNTDOWN_SHORTCUTS_ACTIVE_BIT,
            8,
        ));
        assert!(!countdown_generation_matches_state(0, 8));
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
const COUNTDOWN_SHORTCUTS_ACTIVE_BIT: u64 = 1;
static COUNTDOWN_SHORTCUTS_STATE: AtomicU64 = AtomicU64::new(0);
static COUNTDOWN_SHORTCUTS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static COUNTDOWN_SHORTCUT_ATTEMPT: OnceLock<Mutex<Option<(u64, String)>>> = OnceLock::new();
static DICTATION_ESCAPE_SHORTCUT_ACTIVE: AtomicBool = AtomicBool::new(false);
static MONITOR_PICKER_ESCAPE_ACTIVE: AtomicBool = AtomicBool::new(false);

fn active_countdown_generation_from_state(state: u64) -> Option<u64> {
    (state & COUNTDOWN_SHORTCUTS_ACTIVE_BIT != 0).then_some(state >> 1)
}

fn countdown_generation_matches_state(state: u64, expected_generation: u64) -> bool {
    active_countdown_generation_from_state(state) == Some(expected_generation)
}
/// Escape has several owners (popover, countdown, dictation, monitor picker).
/// Every register/unregister runs under this lock, and an owner stores its own
/// flag before taking it, so a release can never unregister a shortcut another
/// owner just claimed.
static ESCAPE_SHORTCUT_LOCK: Mutex<()> = Mutex::new(());

fn countdown_attempt_id_for_generation(
    attempt: Option<&(u64, String)>,
    generation: u64,
) -> Option<&str> {
    attempt
        .filter(|(active_generation, _)| *active_generation == generation)
        .map(|(_, attempt_id)| attempt_id.as_str())
}

fn lock_escape() -> std::sync::MutexGuard<'static, ()> {
    ESCAPE_SHORTCUT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn claim_escape(app: &AppHandle, label: &str) {
    let _escape = lock_escape();
    register_escape(app, label);
}

fn release_escape_if_unowned(app: &AppHandle) {
    let _escape = lock_escape();
    unregister_escape_if_unowned(app);
}

/// Follows `owner_flag` as it is under the lock, not as it was when the caller
/// stored it: workers can run out of order.
fn sync_escape_with_flag(app: &AppHandle, owner_flag: &AtomicBool, label: &str) {
    let _escape = lock_escape();
    if owner_flag.load(Ordering::SeqCst) {
        register_escape(app, label);
    } else {
        unregister_escape_if_unowned(app);
    }
}

fn register_escape(app: &AppHandle, label: &str) {
    let shortcut = escape_shortcut();
    let gs = app.global_shortcut();
    if !gs.is_registered(shortcut) {
        if let Err(err) = gs.register(shortcut) {
            eprintln!("[clips-tray] failed to register {label} Escape: {err}");
        }
    }
}

fn unregister_escape_if_unowned(app: &AppHandle) {
    if POPOVER_DISMISS_SHORTCUT_ACTIVE.load(Ordering::SeqCst)
        || active_countdown_generation_from_state(COUNTDOWN_SHORTCUTS_STATE.load(Ordering::SeqCst))
            .is_some()
        || DICTATION_ESCAPE_SHORTCUT_ACTIVE.load(Ordering::SeqCst)
        || MONITOR_PICKER_ESCAPE_ACTIVE.load(Ordering::SeqCst)
    {
        return;
    }
    let shortcut = escape_shortcut();
    let gs = app.global_shortcut();
    if gs.is_registered(shortcut) {
        let _ = gs.unregister(shortcut);
    }
}

#[derive(Default)]
struct PendingVoiceStart {
    pending: bool,
    released: bool,
    held: Option<Duration>,
}

static PENDING_VOICE_START: Mutex<PendingVoiceStart> = Mutex::new(PendingVoiceStart {
    pending: false,
    released: false,
    held: None,
});

/// A push-to-talk link's own delayed start, kept apart from the shortcuts'
/// so a link press can't overwrite a shortcut tap still waiting to go out.
static PENDING_LINK_VOICE_START: Mutex<PendingVoiceStart> = Mutex::new(PendingVoiceStart {
    pending: false,
    released: false,
    held: None,
});

struct VoicePress {
    at: Instant,
    /// Whether a dictation run has already timed itself from this press.
    claimed: bool,
}

static LAST_VOICE_PRESS: Mutex<Option<VoicePress>> = Mutex::new(None);

/// Notes when a dictation key went down; the hold time and the dictation's
/// press-to-first-audio timing both count from it.
fn note_voice_press() {
    if let Ok(mut pressed) = LAST_VOICE_PRESS.lock() {
        *pressed = Some(VoicePress {
            at: Instant::now(),
            claimed: false,
        });
    }
}

/// The press that started the dictation now starting, once: a dictation
/// started from the app, with no press of its own, gets `None` rather than
/// an earlier run's press.
pub(crate) fn claim_voice_press() -> Option<Instant> {
    let mut pressed = LAST_VOICE_PRESS.lock().ok()?;
    let press = pressed.as_mut().filter(|press| !press.claimed)?;
    press.claimed = true;
    Some(press.at)
}

fn held_since_press() -> Option<Duration> {
    LAST_VOICE_PRESS
        .lock()
        .ok()
        .and_then(|pressed| pressed.as_ref().map(|press| press.at.elapsed()))
}

/// `heldMs` is how long the key was down, measured here rather than from the
/// late-arriving start, so a short tap can be told from a dictation.
fn voice_stop_payload(source: &str, held: Option<Duration>) -> serde_json::Value {
    let mut payload = serde_json::json!({ "source": source });
    if let Some(held) = held {
        payload["heldMs"] = serde_json::json!(held.as_millis() as u64);
    }
    payload
}

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
        end_voice_press(&app, PressInput::Fn);
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
            if visible || picker_active || recording_flow_active {
                claim_escape(&handle, "popover");
            } else {
                release_escape_if_unowned(&handle);
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
        let _escape = lock_escape();
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

/// The monitor picker's webviews only see Esc while one of them is focused, so
/// Esc is claimed globally for as long as the picker is open.
pub(crate) fn set_monitor_picker_escape(app: &AppHandle, active: bool) {
    MONITOR_PICKER_ESCAPE_ACTIVE.store(active, Ordering::SeqCst);
    let app = app.clone();
    thread::spawn(move || {
        sync_escape_with_flag(&app, &MONITOR_PICKER_ESCAPE_ACTIVE, "monitor picker");
    });
}

/// The frontend reports a hands-free run starting or ending; the gate
/// applies the held-key flag and Escape from it.
#[tauri::command]
pub fn set_dictation_escape_active(app: AppHandle, active: bool) -> Result<(), String> {
    note_hands_free_active(&app, active);
    Ok(())
}

fn sync_dictation_escape_shortcut(app: AppHandle, active: bool) {
    DICTATION_ESCAPE_SHORTCUT_ACTIVE.store(active, Ordering::SeqCst);
    thread::spawn(move || {
        sync_escape_with_flag(&app, &DICTATION_ESCAPE_SHORTCUT_ACTIVE, "dictation-cancel");
    });
}

pub(crate) async fn prepare_countdown_shortcuts(
    app: AppHandle,
    attempt_id: String,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = COUNTDOWN_SHORTCUTS_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = (COUNTDOWN_SHORTCUTS_STATE.load(Ordering::SeqCst) >> 1).wrapping_add(1);
        let inactive_state = generation << 1;
        COUNTDOWN_SHORTCUTS_STATE.store(inactive_state, Ordering::SeqCst);
        *COUNTDOWN_SHORTCUT_ATTEMPT
            .get_or_init(|| Mutex::new(None))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((generation, attempt_id));
        let _escape = lock_escape();
        let gs = app.global_shortcut();
        let mut newly_registered = Vec::new();
        for shortcut in countdown_shortcuts() {
            if !gs.is_registered(shortcut) {
                if let Err(error) = gs.register(shortcut) {
                    for registered in newly_registered {
                        let _ = gs.unregister(registered);
                    }
                    *COUNTDOWN_SHORTCUT_ATTEMPT
                        .get_or_init(|| Mutex::new(None))
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
                    return Err(format!("failed to register countdown shortcut: {error}"));
                }
                newly_registered.push(shortcut);
            }
        }
        COUNTDOWN_SHORTCUTS_STATE.store(
            inactive_state | COUNTDOWN_SHORTCUTS_ACTIVE_BIT,
            Ordering::SeqCst,
        );
        Ok::<u64, String>(generation)
    })
    .await
    .map_err(|error| format!("countdown shortcut worker stopped unexpectedly: {error}"))?
}

fn cleanup_countdown_shortcuts(app: &AppHandle, expected_generation: Option<u64>) {
    let _guard = COUNTDOWN_SHORTCUTS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = COUNTDOWN_SHORTCUTS_STATE.load(Ordering::SeqCst);
    let generation = state >> 1;
    if expected_generation.is_some_and(|expected| expected != generation) {
        return;
    }
    COUNTDOWN_SHORTCUTS_STATE.store(generation << 1, Ordering::SeqCst);
    *COUNTDOWN_SHORTCUT_ATTEMPT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    let gs = app.global_shortcut();
    for shortcut in countdown_return_shortcuts() {
        if gs.is_registered(shortcut) {
            let _ = gs.unregister(shortcut);
        }
    }
    release_escape_if_unowned(app);
}

pub(crate) async fn finish_countdown_shortcuts(
    app: AppHandle,
    generation: u64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_countdown_shortcuts(&app, Some(generation));
    })
    .await
    .map_err(|error| format!("countdown shortcut cleanup worker stopped unexpectedly: {error}"))
}

pub(crate) async fn retire_countdown_shortcuts(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_countdown_shortcuts(&app, None);
    })
    .await
    .map_err(|error| format!("countdown shortcut retirement worker stopped unexpectedly: {error}"))
}

fn active_countdown_generation() -> Option<u64> {
    active_countdown_generation_from_state(COUNTDOWN_SHORTCUTS_STATE.load(Ordering::SeqCst))
}

pub(crate) fn is_active_countdown_generation(expected_generation: u64) -> bool {
    countdown_generation_matches_state(
        COUNTDOWN_SHORTCUTS_STATE.load(Ordering::SeqCst),
        expected_generation,
    )
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
        if let Some(generation) = active_countdown_generation() {
            let key_code = unsafe { event.as_ref().keyCode() };
            let countdown_event = match key_code {
                36 | 76 => Some("clips:countdown-done"),
                53 => Some("clips:countdown-cancel"),
                _ => None,
            };
            if let Some(countdown_event) = countdown_event {
                let app = app.clone();
                thread::spawn(move || {
                    if let Some(window) = app.get_webview_window("countdown") {
                        finish_countdown_from_shortcut(&app, &window, countdown_event, generation);
                    } else {
                        tauri::async_runtime::spawn(async move {
                            let _ = finish_countdown_shortcuts(app, generation).await;
                        });
                    }
                });
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

fn finish_countdown_from_shortcut(
    app: &AppHandle,
    window: &WebviewWindow,
    event: &'static str,
    generation: u64,
) {
    let active_state = (generation << 1) | COUNTDOWN_SHORTCUTS_ACTIVE_BIT;
    if COUNTDOWN_SHORTCUTS_STATE.load(Ordering::SeqCst) != active_state {
        return;
    }
    let attempt = COUNTDOWN_SHORTCUT_ATTEMPT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let Some(attempt_id) =
        countdown_attempt_id_for_generation(attempt.as_ref(), generation).map(str::to_owned)
    else {
        return;
    };
    if COUNTDOWN_SHORTCUTS_STATE
        .compare_exchange(
            active_state,
            generation << 1,
            Ordering::SeqCst,
            Ordering::SeqCst,
        )
        .is_err()
    {
        return;
    }
    dlog!("[clips-tray] countdown shortcut accepted: {event}");
    let cause = if event == "clips:countdown-cancel" {
        "escape"
    } else {
        "return"
    };
    let _ = app.emit(
        event,
        serde_json::json!({ "attemptId": attempt_id, "cause": cause }),
    );
    let _ = window.close();
    let app = app.clone();
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
        if is_escape || is_enter || is_numpad_enter {
            if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }
            if let Some(generation) = active_countdown_generation() {
                if let Some(window) = app.get_webview_window("countdown") {
                    let event = if is_escape {
                        "clips:countdown-cancel"
                    } else {
                        "clips:countdown-done"
                    };
                    finish_countdown_from_shortcut(app, &window, event, generation);
                    return;
                }
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = finish_countdown_shortcuts(app, generation).await;
                });
            }
        }
        if is_escape {
            if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }
            if crate::native_screen::window_picker_active() {
                crate::native_screen::cancel_window_picker(app);
                return;
            }
            if MONITOR_PICKER_ESCAPE_ACTIVE.load(Ordering::SeqCst) {
                let _ = app.emit("clips:monitor-picker-cancelled", ());
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
            match event.state() {
                tauri_plugin_global_shortcut::ShortcutState::Pressed => {
                    // A held key's repeats, or a press while a push-to-talk
                    // link owns the dictation, start nothing.
                    if begin_voice_press(app, PressInput::Shortcut) == PressClaim::Owns {
                        note_voice_press();
                        eprintln!("[clips-tray] {source} down — starting voice dictation");
                        emit_voice_start(app, source, &PENDING_VOICE_START);
                    }
                }
                tauri_plugin_global_shortcut::ShortcutState::Released => {
                    // Only the release of the press that started the
                    // dictation stops it.
                    if !end_voice_press(app, PressInput::Shortcut) {
                        return;
                    }
                    eprintln!("[clips-tray] {source} up — stopping voice dictation");
                    let held = held_since_press();
                    release_voice_start(&PENDING_VOICE_START, held, || {
                        let _ = app.emit("voice:shortcut-stop", voice_stop_payload(source, held));
                    });
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

fn emit_voice_start(
    app: &tauri::AppHandle,
    source: &'static str,
    pending: &'static Mutex<PendingVoiceStart>,
) {
    remember_voice_target(app);
    wake_popover_for_voice(app);
    *lock_pending_voice_start(pending) = PendingVoiceStart {
        pending: true,
        released: false,
        held: None,
    };
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(80));
        // A tap shorter than the wake delay is still a deliberate press
        // (toggle mode depends on it), so deliver it as start + stop in
        // order rather than dropping it.
        voice_start_due(pending, |released| {
            if released.is_some() || is_dictation_active(&app) {
                let _ = app.emit(
                    "voice:shortcut-start",
                    serde_json::json!({ "source": source }),
                );
                if let Some(held) = released {
                    let _ = app.emit("voice:shortcut-stop", voice_stop_payload(source, held));
                }
            } else {
                hide_voice_wake_popover(&app);
            }
        });
    });
}

fn lock_pending_voice_start(
    pending: &Mutex<PendingVoiceStart>,
) -> std::sync::MutexGuard<'_, PendingVoiceStart> {
    pending.lock().unwrap_or_else(|e| e.into_inner())
}

/// Ends a shortcut press's start delay. `send` gets the hold time when the
/// key was already let go, and sends under the lock the key-up takes, so a
/// stop can't go out before its start.
fn voice_start_due<T>(
    pending: &Mutex<PendingVoiceStart>,
    send: impl FnOnce(Option<Option<Duration>>) -> T,
) -> T {
    let mut pending = lock_pending_voice_start(pending);
    let released = pending.released.then_some(pending.held);
    *pending = PendingVoiceStart::default();
    send(released)
}

/// A shortcut key-up: sends its stop once the delayed start has gone out,
/// or before then leaves the delayed start to send the whole tap.
fn release_voice_start(
    pending: &Mutex<PendingVoiceStart>,
    held: Option<Duration>,
    send_stop: impl FnOnce(),
) {
    let mut pending = lock_pending_voice_start(pending);
    if pending.pending {
        pending.released = true;
        pending.held = held;
        return;
    }
    send_stop();
}

/// One Fn press, shared by its key-up and its delayed start, so a tap let go
/// before the start fires still arrives, as a start and then a stop.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct FnPress {
    down_at: Instant,
    state: Mutex<FnPressState>,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FnPressState {
    Down,
    /// Let go before the delayed start, after this long.
    Released(Duration),
    /// The delayed start has run; the key-up sends the stop.
    StartDue,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FnStart {
    /// Still down when the start came due.
    Hold,
    /// Let go before it, after this long.
    Tap(Duration),
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
impl FnPress {
    fn new(down_at: Instant) -> Self {
        Self {
            down_at,
            state: Mutex::new(FnPressState::Down),
        }
    }

    /// Called once the start delay has passed. `send` sends the start under
    /// the press's lock, so the key-up's stop can't go out before it.
    fn start_due<T>(&self, send: impl FnOnce(FnStart) -> T) -> T {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let start = match *state {
            FnPressState::Released(held) => FnStart::Tap(held),
            FnPressState::Down | FnPressState::StartDue => {
                *state = FnPressState::StartDue;
                FnStart::Hold
            }
        };
        send(start)
    }

    /// Called at key-up. Sends the stop, under the press's lock, once the
    /// delayed start has run; before then the delayed start sends the whole
    /// tap.
    fn release(&self, now: Instant, send_stop: impl FnOnce(Duration)) {
        let held = now.saturating_duration_since(self.down_at);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        match *state {
            FnPressState::Down => *state = FnPressState::Released(held),
            FnPressState::StartDue => send_stop(held),
            FnPressState::Released(_) => {}
        }
    }
}

/// The events an Fn press's delayed start sends. A tap goes out whole even
/// though the key is already up: toggle mode starts on it, and two in a row
/// make the hands-free gesture.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn fn_start_events(
    start: FnStart,
    tap_enabled: bool,
    hold_wanted: impl FnOnce() -> bool,
) -> Vec<(&'static str, serde_json::Value)> {
    let start_event = (
        "voice:shortcut-start",
        serde_json::json!({ "source": "fn" }),
    );
    match start {
        FnStart::Tap(held) if tap_enabled => vec![
            start_event,
            ("voice:shortcut-stop", voice_stop_payload("fn", Some(held))),
        ],
        FnStart::Hold if hold_wanted() => vec![start_event],
        _ => Vec::new(),
    }
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
    let current_press: Arc<Mutex<Option<Arc<FnPress>>>> = Arc::new(Mutex::new(None));

    let app_for_cancel = app.clone();
    let prev_for_cancel = prev_down.clone();
    app.listen("voice:cancel", move |_event| {
        prev_for_cancel.store(false, Ordering::SeqCst);
        // The Fn press no longer holds the cancelled dictation.
        end_voice_press(&app_for_cancel, PressInput::Fn);
    });

    dlog!("[clips-tray][fn-tap] install_fn_event_tap called — spawning listener thread");

    if let Err(err) = thread::Builder::new()
        .name("clips-fn-key-tap".into())
        .spawn(move || {
            let app_for_cb = app.clone();
            let prev_for_cb = prev_down.clone();
            let needs_reenable_for_cb = needs_reenable.clone();
            let event_count_for_cb = event_count.clone();
            let current_press_for_cb = current_press.clone();

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
                    if fn_down {
                        // A press while a push-to-talk link owns the
                        // dictation starts nothing, and its release (which
                        // finds no press of its own) stops nothing.
                        if begin_voice_press(&app_for_cb, PressInput::Fn) != PressClaim::Owns {
                            return CallbackResult::Keep;
                        }
                        dlog!("[clips-tray] Fn down — starting voice dictation");
                        note_voice_press();
                        remember_voice_target(&app_for_cb);
                        let press = Arc::new(FnPress::new(Instant::now()));
                        *current_press_for_cb
                            .lock()
                            .unwrap_or_else(|e| e.into_inner()) = Some(press.clone());
                        wake_popover_for_voice(&app_for_cb);
                        let app_for_emit = app_for_cb.clone();
                        let press_for_start = press.clone();
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(80));
                            press_for_start.start_due(|start| {
                                let events = fn_start_events(
                                    start,
                                    FN_TAP_ENABLED.load(Ordering::SeqCst),
                                    || should_emit_delayed_voice_start(&app_for_emit, "fn"),
                                );
                                if events.is_empty() {
                                    hide_voice_wake_popover(&app_for_emit);
                                }
                                for (name, payload) in events {
                                    let _ = app_for_emit.emit(name, payload);
                                }
                            });
                        });
                        install_fn_release_watchdog(
                            app_for_cb.clone(),
                            prev_for_cb.clone(),
                            press,
                        );
                    } else {
                        if !end_voice_press(&app_for_cb, PressInput::Fn) {
                            return CallbackResult::Keep;
                        }
                        dlog!("[clips-tray] Fn up — stopping voice dictation");
                        let press = current_press_for_cb
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .take();
                        let send_stop = |held: Option<Duration>| {
                            let _ = app_for_cb
                                .emit("voice:shortcut-stop", voice_stop_payload("fn", held));
                        };
                        match press {
                            Some(press) => {
                                press.release(Instant::now(), |held| send_stop(Some(held)))
                            }
                            None => send_stop(held_since_press()),
                        }
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
    press: std::sync::Arc<FnPress>,
) {
    use std::sync::atomic::Ordering;
    use std::thread;
    use std::time::Duration;

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(120));
        while prev_down.load(Ordering::SeqCst) {
            if !current_fn_flag_down() {
                if prev_down.swap(false, Ordering::SeqCst) && end_voice_press(&app, PressInput::Fn)
                {
                    dlog!("[clips-tray] Fn up missed — synthesizing voice stop");
                    press.release(std::time::Instant::now(), |held| {
                        let mut payload = voice_stop_payload("fn", Some(held));
                        payload["synthetic"] = serde_json::json!(true);
                        let _ = app.emit("voice:shortcut-stop", payload);
                    });
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

/// The inputs that can hold a press-to-talk dictation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PressInput {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Fn,
    Shortcut,
    Link,
}

/// What a press may do with the dictation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PressClaim {
    /// It starts the dictation and owns it; its release stops it.
    Owns,
    /// A push link pressed while a dictation it didn't start runs: it may
    /// stop a hands-free run, but claims nothing and starts nothing.
    StopOnly,
    /// A held key's repeat, another input owns the dictation, or (for a
    /// push link) the frontend can't hear a start yet.
    Ignored,
}

/// What a hands-free link press does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct HandsFreePress {
    /// Starts a dictation, so it picks where the text goes. A press that
    /// stops one keeps the app that dictation started in.
    pub capture_target: bool,
    /// Goes to the frontend now; otherwise it's held for its listener.
    pub deliver_now: bool,
}

/// An owner this old, with no dictation running, lost its release (a link
/// up that never came) and gives way to the next press.
const STALE_OWNER_AFTER: Duration = Duration::from_secs(2);

/// A hands-free press held for the listener longer than this is dropped
/// rather than starting dictation long after the button was pressed.
const HANDS_FREE_LINK_HOLD_LIMIT: Duration = Duration::from_secs(30);

/// All native dictation-input state, behind one lock, changed only through
/// the transitions below:
/// - which input holds the press-to-talk dictation (`owner`), so only its
///   release stops it;
/// - whether a hands-free run is on (reported by the frontend);
/// - whether the frontend's dictation is live (recording or processing; an
///   idle flow, a finished one or a recoverable error is not);
/// - whether the frontend's dictation listener is up, and a hands-free
///   press held until it is.
///
/// "Armed" (the held-key flag other code reads, and the Escape shortcut) is
/// derived from it, `owner || hands-free`, and applied under the same lock,
/// so no release, takeover or reset can leave it stale or overwrite a newer
/// press's state.
#[derive(Debug)]
struct DictationGate {
    owner: Option<(PressInput, Instant)>,
    hands_free: bool,
    flow_live: bool,
    listener_ready: bool,
    pending_hands_free: Option<Instant>,
}

impl DictationGate {
    const fn new() -> Self {
        Self {
            owner: None,
            hands_free: false,
            flow_live: false,
            listener_ready: false,
            pending_hands_free: None,
        }
    }

    fn armed(&self) -> bool {
        self.owner.is_some() || self.hands_free
    }

    /// A dictation is running that no press holds: hands-free, or a live
    /// toggle-mode / finishing run.
    fn unheld_run_live(&self) -> bool {
        self.hands_free || self.flow_live
    }

    fn press(&mut self, input: PressInput, now: Instant) -> PressClaim {
        if input == PressInput::Link && !self.listener_ready {
            // A cold start from the link: nothing could hear the start, so
            // change nothing and let the matching up find nothing to stop.
            return PressClaim::Ignored;
        }
        match self.owner {
            Some((_, since))
                if self.unheld_run_live()
                    || now.saturating_duration_since(since) < STALE_OWNER_AFTER =>
            {
                return PressClaim::Ignored;
            }
            // A stale owner (its release was lost): give way.
            Some(_) => {}
            // The dictation key still takes its press (the frontend stops
            // the run on it); a push link never takes over a run it didn't
            // start.
            None if input == PressInput::Link && self.unheld_run_live() => {
                return PressClaim::StopOnly;
            }
            None => {}
        }
        self.owner = Some((input, now));
        PressClaim::Owns
    }

    /// True when `input` owned the dictation, so its release stops it.
    fn release(&mut self, input: PressInput) -> bool {
        if self.owner.is_some_and(|(owner, _)| owner == input) {
            self.owner = None;
            true
        } else {
            false
        }
    }

    fn set_hands_free(&mut self, active: bool) {
        self.hands_free = active;
    }

    /// The frontend's flow state changed. When it settles (not live) an old
    /// owner is dropped too: its dictation is over and its release was lost.
    fn set_flow_live(&mut self, live: bool, now: Instant) {
        self.flow_live = live;
        if !live
            && self
                .owner
                .is_some_and(|(_, since)| now.saturating_duration_since(since) >= STALE_OWNER_AFTER)
        {
            self.owner = None;
        }
    }

    /// The flow bar went away: no hands-free run is left.
    fn flow_hidden(&mut self) {
        self.hands_free = false;
    }

    fn hands_free_link(&mut self, now: Instant) -> HandsFreePress {
        let capture_target = self.owner.is_none() && !self.unheld_run_live();
        // It ends (or replaces) a push link's dictation, so the push link
        // stops holding it; its up then leaves whatever runs next alone.
        if self
            .owner
            .is_some_and(|(owner, _)| owner == PressInput::Link)
        {
            self.owner = None;
        }
        let deliver_now = if self.listener_ready {
            true
        } else {
            // A second press before the listener is up cancels the first,
            // as a start then a stop would.
            self.pending_hands_free = match self.pending_hands_free {
                Some(_) => None,
                None => Some(now),
            };
            false
        };
        HandsFreePress {
            capture_target,
            deliver_now,
        }
    }

    /// The frontend's listener is (re)installed: no hands-free run from an
    /// earlier page load is left, presses go straight to it from now on,
    /// and true when a held hands-free press should start now.
    fn listener_ready(&mut self, now: Instant) -> bool {
        self.listener_ready = true;
        self.hands_free = false;
        self.pending_hands_free
            .take()
            .is_some_and(|at| now.saturating_duration_since(at) < HANDS_FREE_LINK_HOLD_LIMIT)
    }
}

static DICTATION_GATE: Mutex<DictationGate> = Mutex::new(DictationGate::new());

/// Runs one transition under the gate's lock and, under the same lock,
/// applies the armed state it leaves: the held-key flag and the Escape
/// shortcut.
fn with_gate<T>(app: &AppHandle, transition: impl FnOnce(&mut DictationGate, Instant) -> T) -> T {
    let mut gate = DICTATION_GATE.lock().unwrap_or_else(|e| e.into_inner());
    let was_armed = gate.armed();
    let out = transition(&mut gate, Instant::now());
    let armed = gate.armed();
    set_dictation_active(app, armed);
    if armed != was_armed {
        sync_dictation_escape_shortcut(app.clone(), armed);
    }
    out
}

pub(crate) fn begin_voice_press(app: &AppHandle, input: PressInput) -> PressClaim {
    with_gate(app, |gate, now| gate.press(input, now))
}

pub(crate) fn end_voice_press(app: &AppHandle, input: PressInput) -> bool {
    with_gate(app, |gate, _| gate.release(input))
}

/// Hands-free dictation as the frontend reports it (`set_dictation_escape_active`).
pub(crate) fn note_hands_free_active(app: &AppHandle, active: bool) {
    with_gate(app, |gate, _| gate.set_hands_free(active));
}

/// The frontend's dictation flow state (`voice:state-change`).
pub(crate) fn note_voice_flow_state(app: &AppHandle, state: &str) {
    let live = matches!(state, "recording" | "processing");
    with_gate(app, |gate, now| gate.set_flow_live(live, now));
}

/// The flow bar was hidden: the dictation is over.
pub(crate) fn note_flow_hidden(app: &AppHandle) {
    with_gate(app, |gate, _| gate.flow_hidden());
}

/// Called by the frontend once its dictation listener is registered. Returns
/// whether a hands-free link pressed before then should start now.
#[tauri::command]
pub fn take_pending_dictate_link(app: AppHandle) -> bool {
    let pending = with_gate(&app, |gate, now| gate.listener_ready(now));
    if pending {
        eprintln!("[clips-tray] dictate link — delivering the hands-free press held at startup");
        wake_popover_for_voice(&app);
    }
    pending
}

/// `clips://dictate` links. Push-to-talk acts like the dictation key going
/// down and up (source "link", whatever the key's mode setting is), and only
/// its own release stops a dictation its own press started. Hands-free
/// starts a dictation that keeps going until the next press; pressed while
/// one runs, it stops it and keeps the app the dictation started in as the
/// place the text goes.
pub fn dictate_from_link(app: &AppHandle, action: crate::deep_links::DictateLink) {
    use crate::deep_links::DictateLink;
    match action {
        DictateLink::PushDown => match begin_voice_press(app, PressInput::Link) {
            PressClaim::Owns => {
                note_voice_press();
                eprintln!("[clips-tray] dictate link down — starting voice dictation");
                emit_voice_start(app, "link", &PENDING_LINK_VOICE_START);
            }
            PressClaim::StopOnly => {
                // Lets the frontend stop a hands-free run; it starts
                // nothing, and leaves the flags and the paste target.
                let _ = app.emit(
                    "voice:shortcut-start",
                    serde_json::json!({ "source": "link", "stopOnly": true }),
                );
            }
            PressClaim::Ignored => {}
        },
        DictateLink::PushUp => {
            if !end_voice_press(app, PressInput::Link) {
                return;
            }
            eprintln!("[clips-tray] dictate link up — stopping voice dictation");
            let held = held_since_press();
            release_voice_start(&PENDING_LINK_VOICE_START, held, || {
                let _ = app.emit("voice:shortcut-stop", voice_stop_payload("link", held));
            });
        }
        DictateLink::HandsFree => {
            let press = with_gate(app, |gate, now| gate.hands_free_link(now));
            if press.capture_target {
                remember_voice_target(app);
            }
            if !press.deliver_now {
                eprintln!(
                    "[clips-tray] dictate link — hands-free press held until dictation is ready"
                );
                return;
            }
            eprintln!("[clips-tray] dictate link — hands-free start/stop");
            wake_popover_for_voice(app);
            let app = app.clone();
            thread::spawn(move || {
                // Same wake delay as a key press, so the woken popover runs it.
                thread::sleep(Duration::from_millis(80));
                let _ = app.emit(
                    "voice:shortcut-start",
                    serde_json::json!({ "source": "link-hands-free" }),
                );
            });
        }
    }
}

#[cfg(test)]
mod dictation_gate_tests {
    use super::*;
    use PressInput::{Fn, Link, Shortcut};

    /// One input to the gate, at a time offset in milliseconds.
    #[derive(Debug, Clone, Copy)]
    enum Step {
        ListenerReady,
        Press(PressInput),
        Release(PressInput),
        HandsFree(bool),
        Flow(&'static str),
        FlowHidden,
        HandsFreeLink,
    }

    /// What a step returned, for the table.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Out {
        Claim(PressClaim),
        Stops(bool),
        HandsFree { capture: bool, now: bool },
        Pending(bool),
        Done,
    }

    use Out::{Claim, Done, Stops};
    use PressClaim::{Ignored, Owns, StopOnly};

    /// Runs `steps` from a gate whose listener is up, checking each step's
    /// result and the armed state it leaves.
    fn run(steps: &[(u64, Step, Out, bool)]) {
        let t0 = Instant::now();
        let mut gate = DictationGate::new();
        gate.listener_ready(t0);
        run_from(&mut gate, t0, steps);
    }

    fn run_from(gate: &mut DictationGate, t0: Instant, steps: &[(u64, Step, Out, bool)]) {
        for (i, &(at, step, want, armed)) in steps.iter().enumerate() {
            let now = t0 + Duration::from_millis(at);
            let got = match step {
                Step::ListenerReady => Out::Pending(gate.listener_ready(now)),
                Step::Press(input) => Claim(gate.press(input, now)),
                Step::Release(input) => Stops(gate.release(input)),
                Step::HandsFree(active) => {
                    gate.set_hands_free(active);
                    Done
                }
                Step::Flow(state) => {
                    gate.set_flow_live(matches!(state, "recording" | "processing"), now);
                    Done
                }
                Step::FlowHidden => {
                    gate.flow_hidden();
                    Done
                }
                Step::HandsFreeLink => {
                    let press = gate.hands_free_link(now);
                    Out::HandsFree {
                        capture: press.capture_target,
                        now: press.deliver_now,
                    }
                }
            };
            assert_eq!(got, want, "step {i} {step:?}");
            assert_eq!(gate.armed(), armed, "armed after step {i} {step:?}");
        }
    }

    #[test]
    fn only_the_input_that_started_a_dictation_stops_it() {
        use Step::{Flow, Press, Release};
        run(&[
            (0, Press(Link), Claim(Owns), true),
            (100, Flow("recording"), Done, true),
            (200, Press(Shortcut), Claim(Ignored), true),
            (300, Release(Shortcut), Stops(false), true),
            (400, Press(Fn), Claim(Ignored), true),
            (500, Release(Fn), Stops(false), true),
            (600, Release(Link), Stops(true), false),
            (700, Release(Link), Stops(false), false),
        ]);
    }

    #[test]
    fn a_link_pressed_while_the_key_runs_dictation_neither_starts_nor_stops_it() {
        use Step::{Press, Release};
        run(&[
            (0, Press(Shortcut), Claim(Owns), true),
            (50, Press(Shortcut), Claim(Ignored), true),
            (100, Press(Link), Claim(Ignored), true),
            (200, Release(Link), Stops(false), true),
            (300, Release(Shortcut), Stops(true), false),
        ]);
    }

    #[test]
    fn a_hands_free_run_lets_the_key_stop_it_and_a_push_link_claims_nothing() {
        use Step::{Flow, HandsFree, Press, Release};
        run(&[
            (0, HandsFree(true), Done, true),
            (10, Flow("recording"), Done, true),
            (100, Press(Shortcut), Claim(Owns), true),
            // The key's release leaves Escape armed for the hands-free run.
            (200, Release(Shortcut), Stops(true), true),
            (300, Press(Link), Claim(StopOnly), true),
            (400, Release(Link), Stops(false), true),
            (500, HandsFree(false), Done, false),
        ]);
    }

    #[test]
    fn a_recoverable_error_is_not_a_running_dictation() {
        use Step::{Flow, HandsFreeLink, Press};
        run(&[
            (0, Flow("processing"), Done, false),
            (100, Flow("error"), Done, false),
            // The error stays up for recovery, but a link press owns a new
            // run and a hands-free press picks its own target.
            (
                200,
                HandsFreeLink,
                Out::HandsFree {
                    capture: true,
                    now: true,
                },
                false,
            ),
            (300, Press(Link), Claim(Owns), true),
        ]);
    }

    #[test]
    fn a_hands_free_press_takes_over_a_push_links_dictation_and_its_flags() {
        use Step::{Flow, HandsFree, HandsFreeLink, Press, Release};
        run(&[
            (0, Press(Link), Claim(Owns), true),
            (100, Flow("recording"), Done, true),
            // Stops the push link's run; the link no longer holds it, so
            // nothing stays armed for it.
            (
                200,
                HandsFreeLink,
                Out::HandsFree {
                    capture: false,
                    now: true,
                },
                false,
            ),
            (300, Flow("idle"), Done, false),
            // A new hands-free run starts before the push link comes up.
            (
                400,
                HandsFreeLink,
                Out::HandsFree {
                    capture: true,
                    now: true,
                },
                false,
            ),
            (450, HandsFree(true), Done, true),
            (460, Flow("recording"), Done, true),
            // The push link's up neither stops it nor disarms its Escape.
            (500, Release(Link), Stops(false), true),
            // And the next push link press is a stop-only press, not stuck.
            (600, Press(Link), Claim(StopOnly), true),
        ]);
    }

    #[test]
    fn a_new_press_survives_an_older_release_and_flow_settling() {
        use Step::{Flow, FlowHidden, Press, Release};
        run(&[
            (0, Press(Shortcut), Claim(Owns), true),
            (100, Release(Shortcut), Stops(true), false),
            (150, Press(Link), Claim(Owns), true),
            // The first run settling and its flow bar hiding leave the new
            // press's state alone.
            (200, Release(Shortcut), Stops(false), true),
            (250, Flow("idle"), Done, true),
            (260, FlowHidden, Done, true),
            (300, Release(Link), Stops(true), false),
        ]);
    }

    #[test]
    fn a_lost_link_release_does_not_lock_the_key_out() {
        use Step::{Flow, Press, Release};
        run(&[
            (0, Press(Link), Claim(Owns), true),
            (100, Flow("recording"), Done, true),
            (5_000, Flow("idle"), Done, false),
            (5_100, Press(Fn), Claim(Owns), true),
            (5_200, Release(Link), Stops(false), true),
            (5_300, Release(Fn), Stops(true), false),
        ]);
        // Even with no flow change, an old owner gives way once nothing runs.
        run(&[
            (0, Press(Link), Claim(Owns), true),
            (1_000, Press(Shortcut), Claim(Ignored), true),
            (3_000, Press(Shortcut), Claim(Owns), true),
            (3_100, Release(Shortcut), Stops(true), false),
        ]);
    }

    #[test]
    fn hands_free_after_a_reload_does_not_stick() {
        use Step::{HandsFree, HandsFreeLink, ListenerReady};
        run(&[
            (0, HandsFree(true), Done, true),
            (100, ListenerReady, Out::Pending(false), false),
            (
                200,
                HandsFreeLink,
                Out::HandsFree {
                    capture: true,
                    now: true,
                },
                false,
            ),
        ]);
    }

    #[test]
    fn cold_start_links_wait_for_the_listener() {
        use Step::{HandsFreeLink, ListenerReady, Press, Release};
        let t0 = Instant::now();
        // A push link before the listener changes nothing.
        run_from(
            &mut DictationGate::new(),
            t0,
            &[
                (0, Press(Link), Claim(Ignored), false),
                (100, Release(Link), Stops(false), false),
            ],
        );
        // A hands-free press is held and delivered once.
        run_from(
            &mut DictationGate::new(),
            t0,
            &[
                (
                    0,
                    HandsFreeLink,
                    Out::HandsFree {
                        capture: true,
                        now: false,
                    },
                    false,
                ),
                (2_000, ListenerReady, Out::Pending(true), false),
                (3_000, ListenerReady, Out::Pending(false), false),
                (
                    4_000,
                    HandsFreeLink,
                    Out::HandsFree {
                        capture: true,
                        now: true,
                    },
                    false,
                ),
            ],
        );
        // Two presses before the listener cancel out.
        run_from(
            &mut DictationGate::new(),
            t0,
            &[
                (
                    0,
                    HandsFreeLink,
                    Out::HandsFree {
                        capture: true,
                        now: false,
                    },
                    false,
                ),
                (
                    500,
                    HandsFreeLink,
                    Out::HandsFree {
                        capture: true,
                        now: false,
                    },
                    false,
                ),
                (1_000, ListenerReady, Out::Pending(false), false),
            ],
        );
        // A held press too old to act on is dropped.
        run_from(
            &mut DictationGate::new(),
            t0,
            &[
                (
                    0,
                    HandsFreeLink,
                    Out::HandsFree {
                        capture: true,
                        now: false,
                    },
                    false,
                ),
                (30_000, ListenerReady, Out::Pending(false), false),
            ],
        );
    }

    #[test]
    fn inputs_pressed_at_once_never_both_own_the_dictation() {
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;
        for _ in 0..200 {
            let gate = Arc::new(Mutex::new(DictationGate::new()));
            gate.lock().unwrap().listener_ready(Instant::now());
            let owners = Arc::new(AtomicUsize::new(0));
            let barrier = Arc::new(std::sync::Barrier::new(3));
            let handles: Vec<_> = [Fn, Shortcut, Link]
                .into_iter()
                .map(|input| {
                    let (gate, owners, barrier) = (gate.clone(), owners.clone(), barrier.clone());
                    thread::spawn(move || {
                        barrier.wait();
                        if gate.lock().unwrap().press(input, Instant::now()) == Owns {
                            owners.fetch_add(1, Ordering::SeqCst);
                        }
                    })
                })
                .collect();
            for handle in handles {
                handle.join().unwrap();
            }
            assert_eq!(owners.load(Ordering::SeqCst), 1);
        }
    }

    #[test]
    fn a_link_press_keeps_a_shortcut_tap_waiting_to_go_out() {
        let shortcut = Mutex::new(PendingVoiceStart::default());
        let link = Mutex::new(PendingVoiceStart::default());
        // A shortcut tap let go before its delayed start fires.
        *lock_pending_voice_start(&shortcut) = PendingVoiceStart {
            pending: true,
            released: false,
            held: None,
        };
        release_voice_start(&shortcut, Some(Duration::from_millis(90)), || {
            panic!("the stop waits for the delayed start")
        });
        // A link press arrives meanwhile, in its own slot.
        *lock_pending_voice_start(&link) = PendingVoiceStart {
            pending: true,
            released: false,
            held: None,
        };
        assert_eq!(
            voice_start_due(&shortcut, |released| released),
            Some(Some(Duration::from_millis(90)))
        );
        assert_eq!(voice_start_due(&link, |released| released), None);
        let mut stopped = false;
        release_voice_start(&link, None, || stopped = true);
        assert!(stopped);
    }
}
