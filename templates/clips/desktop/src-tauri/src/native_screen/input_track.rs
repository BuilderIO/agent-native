//! The input track of a rich recording: the pointer path, clicks, wheel and
//! keys as data, one JSON object per line in time order, gzipped
//! (`input.jsonl.gz`). Each flush appends one complete gzip member, and joined
//! members read as one gzip stream, so the file is valid after every flush and
//! the uploader can send any prefix of it.
//!
//! `t` is recording milliseconds; `x`/`y` are pixels of the screen track: the
//! captured area at its display's native resolution, from the area's top-left.
//! They fall outside it when the pointer is elsewhere.
//!
//! Typing is never kept as characters: only shortcuts (a key pressed with Cmd
//! or Ctrl) and named keys (Enter, Escape, Tab, arrows, Backspace, Delete,
//! Home/End/Page keys, F-keys) are, and every other key press adds to a
//! per-second `typing` count. Option alone doesn't make a shortcut: Option with
//! a letter or digit types a character on macOS (é, ˚). Option with a named key
//! is kept like any named key, with `alt` in its `mods`. While secure input is
//! on, no keys are kept. A kept key's release repeats what its press said, and
//! a key held across a pause, or any stretch the tap may have missed, is
//! forgotten: its release then could be a typed key's.

use std::io::Write;

use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Serialize;

pub(super) const INPUT_TRACK_ID: &str = "input";
pub(super) const INPUT_TRACK_FILE: &str = "input.jsonl.gz";
pub(super) const INPUT_TRACK_CONTENT_TYPE: &str = "application/gzip";

/// The shortest gap between two `move` lines while the pointer moves.
pub(super) const MOVE_INTERVAL_MS: f64 = 10.0;

/// Key presses that aren't kept are counted per window this long, so the file
/// says how much was typed but not the rhythm of it.
const TYPING_WINDOW_MS: f64 = 1000.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MouseButton {
    Left,
    Right,
    Middle,
    Other,
}

impl MouseButton {
    fn label(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
            Self::Middle => "middle",
            Self::Other => "other",
        }
    }

    /// macOS numbers buttons from 0: left, right, then the middle (2).
    pub(super) fn from_number(number: i64) -> Self {
        match number {
            0 => Self::Left,
            1 => Self::Right,
            2 => Self::Middle,
            _ => Self::Other,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Modifiers {
    pub(super) meta: bool,
    pub(super) ctrl: bool,
    pub(super) alt: bool,
    pub(super) shift: bool,
}

impl Modifiers {
    fn makes_shortcut(self) -> bool {
        self.meta || self.ctrl
    }

    fn labels(self) -> Vec<&'static str> {
        [
            (self.meta, "meta"),
            (self.ctrl, "ctrl"),
            (self.alt, "alt"),
            (self.shift, "shift"),
        ]
        .into_iter()
        .filter_map(|(held, label)| held.then_some(label))
        .collect()
    }
}

/// One input event, already through the privacy filter, with positions in the
/// screen track's pixels.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum InputSample {
    Move {
        x: f64,
        y: f64,
    },
    Button {
        down: bool,
        button: MouseButton,
        x: f64,
        y: f64,
        clicks: u32,
    },
    Wheel {
        x: f64,
        y: f64,
        dx: f64,
        dy: f64,
    },
    Key {
        down: bool,
        code: &'static str,
        key: String,
        mods: Modifiers,
    },
    /// A key press the privacy rule only counts.
    TypingPress,
}

#[derive(Serialize)]
struct InputLine<'a> {
    t: f64,
    e: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    down: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    b: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    n: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dx: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dy: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mods: Option<Vec<&'static str>>,
}

impl InputLine<'_> {
    fn bare(t: f64, e: &'static str) -> Self {
        InputLine {
            t: round2(t),
            e,
            down: None,
            b: None,
            x: None,
            y: None,
            n: None,
            dx: None,
            dy: None,
            code: None,
            key: None,
            mods: None,
        }
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// One line of the track, without its newline.
pub(super) fn serialize_sample(t: f64, sample: &InputSample) -> Option<String> {
    let line = match sample {
        InputSample::Move { x, y } => InputLine {
            x: Some(round2(*x)),
            y: Some(round2(*y)),
            ..InputLine::bare(t, "move")
        },
        InputSample::Button {
            down,
            button,
            x,
            y,
            clicks,
        } => InputLine {
            b: Some(button.label()),
            x: Some(round2(*x)),
            y: Some(round2(*y)),
            n: Some(*clicks),
            ..InputLine::bare(t, if *down { "down" } else { "up" })
        },
        InputSample::Wheel { x, y, dx, dy } => InputLine {
            x: Some(round2(*x)),
            y: Some(round2(*y)),
            dx: Some(round2(*dx)),
            dy: Some(round2(*dy)),
            ..InputLine::bare(t, "wheel")
        },
        InputSample::Key {
            down,
            code,
            key,
            mods,
        } => InputLine {
            down: Some(*down),
            code: Some(code),
            key: Some(key),
            mods: Some(mods.labels()),
            ..InputLine::bare(t, "key")
        },
        // Typing presses are written as counts by `InputLog`, never one by one.
        InputSample::TypingPress => return None,
    };
    serde_json::to_string(&line).ok()
}

fn typing_line(t: f64, presses: u32) -> String {
    serde_json::to_string(&InputLine {
        n: Some(presses),
        ..InputLine::bare(t, "typing")
    })
    .unwrap_or_default()
}

/// What the privacy rule keeps of one key event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum KeyDecision {
    Drop,
    Typing,
    /// Kept, with the `key` decided when the key went down.
    Keep {
        code: &'static str,
        key: String,
    },
}

struct KeptKey {
    keycode: u16,
    code: &'static str,
    key: String,
}

/// The privacy filter for keys. Runs in the event tap's callback; the only
/// character it reads is a shortcut's, at its press, so a typed character
/// never leaves it.
#[derive(Default)]
pub(super) struct KeyPrivacy {
    kept_down: Vec<KeptKey>,
    breaks_seen: u64,
}

impl KeyPrivacy {
    /// `breaks` counts the stretches the tap may have missed events in. A key
    /// released during one was never seen to go up, so a release after it
    /// could be a typed key's: no key held from before a break is kept.
    pub(super) fn sync_breaks(&mut self, breaks: u64) {
        if breaks != self.breaks_seen {
            self.breaks_seen = breaks;
            self.kept_down.clear();
        }
    }

    /// `chars` reads the event's character. It is called only for a shortcut
    /// press, never for typing or a release.
    pub(super) fn classify(
        &mut self,
        keycode: u16,
        down: bool,
        autorepeat: bool,
        mods: Modifiers,
        secure_input: bool,
        chars: impl FnOnce() -> Option<String>,
    ) -> KeyDecision {
        if secure_input {
            self.kept_down.clear();
            return KeyDecision::Drop;
        }
        let held = self
            .kept_down
            .iter()
            .position(|kept| kept.keycode == keycode);
        if !down {
            // A key's release is kept only when its press was, whatever the
            // modifiers are by then, and says what the press said.
            let Some(at) = held else {
                return KeyDecision::Drop;
            };
            let kept = self.kept_down.swap_remove(at);
            return KeyDecision::Keep {
                code: kept.code,
                key: kept.key,
            };
        }
        if autorepeat {
            return KeyDecision::Drop;
        }
        // A new press of a key still held here means its release was missed.
        if let Some(at) = held {
            self.kept_down.swap_remove(at);
        }
        let code = key_code_name(keycode).unwrap_or("Unidentified");
        let key = match named_key(keycode) {
            Some(named) => named.to_string(),
            None if mods.makes_shortcut() => shortcut_key_label(chars().as_deref(), code),
            None => return KeyDecision::Typing,
        };
        self.kept_down.push(KeptKey {
            keycode,
            code,
            key: key.clone(),
        });
        KeyDecision::Keep { code, key }
    }
}

/// The `key` of a kept shortcut: the character the event carries when it is a
/// printable one, otherwise the key its code names (Ctrl+K carries a control
/// character, and comes out as "k").
pub(super) fn shortcut_key_label(chars: Option<&str>, code: &str) -> String {
    if let Some(chars) = chars {
        let mut iter = chars.chars();
        if let (Some(ch), None) = (iter.next(), iter.next()) {
            if !ch.is_control() {
                return ch.to_string();
            }
        }
    }
    if let Some(letter) = code.strip_prefix("Key") {
        return letter.to_ascii_lowercase();
    }
    if let Some(digit) = code.strip_prefix("Digit") {
        return digit.to_string();
    }
    code.to_string()
}

/// The `key` value of a named key, by macOS virtual key code.
fn named_key(keycode: u16) -> Option<&'static str> {
    Some(match keycode {
        0x24 | 0x4C => "Enter",
        0x35 => "Escape",
        0x30 => "Tab",
        0x33 => "Backspace",
        0x75 => "Delete",
        0x73 => "Home",
        0x77 => "End",
        0x74 => "PageUp",
        0x79 => "PageDown",
        0x7B => "ArrowLeft",
        0x7C => "ArrowRight",
        0x7D => "ArrowDown",
        0x7E => "ArrowUp",
        0x7A => "F1",
        0x78 => "F2",
        0x63 => "F3",
        0x76 => "F4",
        0x60 => "F5",
        0x61 => "F6",
        0x62 => "F7",
        0x64 => "F8",
        0x65 => "F9",
        0x6D => "F10",
        0x67 => "F11",
        0x6F => "F12",
        0x69 => "F13",
        0x6B => "F14",
        0x71 => "F15",
        0x6A => "F16",
        0x40 => "F17",
        0x4F => "F18",
        0x50 => "F19",
        0x5A => "F20",
        _ => return None,
    })
}

/// The web `KeyboardEvent.code` of a macOS virtual key code (ANSI layout
/// positions, as the web names them).
fn key_code_name(keycode: u16) -> Option<&'static str> {
    if let Some(named) = named_key(keycode) {
        return Some(match keycode {
            0x4C => "NumpadEnter",
            _ => named,
        });
    }
    Some(match keycode {
        0x00 => "KeyA",
        0x01 => "KeyS",
        0x02 => "KeyD",
        0x03 => "KeyF",
        0x04 => "KeyH",
        0x05 => "KeyG",
        0x06 => "KeyZ",
        0x07 => "KeyX",
        0x08 => "KeyC",
        0x09 => "KeyV",
        0x0A => "IntlBackslash",
        0x0B => "KeyB",
        0x0C => "KeyQ",
        0x0D => "KeyW",
        0x0E => "KeyE",
        0x0F => "KeyR",
        0x10 => "KeyY",
        0x11 => "KeyT",
        0x12 => "Digit1",
        0x13 => "Digit2",
        0x14 => "Digit3",
        0x15 => "Digit4",
        0x16 => "Digit6",
        0x17 => "Digit5",
        0x18 => "Equal",
        0x19 => "Digit9",
        0x1A => "Digit7",
        0x1B => "Minus",
        0x1C => "Digit8",
        0x1D => "Digit0",
        0x1E => "BracketRight",
        0x1F => "KeyO",
        0x20 => "KeyU",
        0x21 => "BracketLeft",
        0x22 => "KeyI",
        0x23 => "KeyP",
        0x25 => "KeyL",
        0x26 => "KeyJ",
        0x27 => "Quote",
        0x28 => "KeyK",
        0x29 => "Semicolon",
        0x2A => "Backslash",
        0x2B => "Comma",
        0x2C => "Slash",
        0x2D => "KeyN",
        0x2E => "KeyM",
        0x2F => "Period",
        0x31 => "Space",
        0x32 => "Backquote",
        0x41 => "NumpadDecimal",
        0x43 => "NumpadMultiply",
        0x45 => "NumpadAdd",
        0x47 => "NumLock",
        0x4B => "NumpadDivide",
        0x4E => "NumpadSubtract",
        0x51 => "NumpadEqual",
        0x52 => "Numpad0",
        0x53 => "Numpad1",
        0x54 => "Numpad2",
        0x55 => "Numpad3",
        0x56 => "Numpad4",
        0x57 => "Numpad5",
        0x58 => "Numpad6",
        0x59 => "Numpad7",
        0x5B => "Numpad8",
        0x5C => "Numpad9",
        0x72 => "Insert",
        _ => return None,
    })
}

/// The captured display, in the global coordinate space events report: points
/// from the main display's top-left, y down.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct DisplayGeometry {
    pub(super) id: u32,
    pub(super) x_pt: f64,
    pub(super) y_pt: f64,
    pub(super) width_pt: f64,
    pub(super) height_pt: f64,
    pub(super) width_px: u32,
    pub(super) height_px: u32,
}

impl DisplayGeometry {
    /// Pixels per point. The same on both axes on every Mac display mode.
    pub(super) fn scale(&self) -> f64 {
        if self.width_pt > 0.0 {
            f64::from(self.width_px) / self.width_pt
        } else {
            1.0
        }
    }

    /// The pixels of the screen track: those of this display, from the top-left
    /// of `area` (global points) when only part of it is captured.
    pub(super) fn pixel_space(&self, area_origin_pt: Option<(f64, f64)>) -> PixelSpace {
        let (x_pt, y_pt) = area_origin_pt.unwrap_or((self.x_pt, self.y_pt));
        PixelSpace {
            x_pt,
            y_pt,
            scale: self.scale(),
        }
    }
}

/// The screen track's pixels in the global coordinate space: the captured
/// area's top-left in points, and the display's pixels per point.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct PixelSpace {
    pub(super) x_pt: f64,
    pub(super) y_pt: f64,
    pub(super) scale: f64,
}

impl PixelSpace {
    /// A global point as pixels from the captured area's top-left; outside the
    /// area when the point is.
    pub(super) fn to_px(&self, x_pt: f64, y_pt: f64) -> (f64, f64) {
        (
            (x_pt - self.x_pt) * self.scale,
            (y_pt - self.y_pt) * self.scale,
        )
    }
}

/// An event's timestamp as host nanoseconds (the clock ScreenCaptureKit stamps
/// its frames with: `mach_absolute_time` scaled by its timebase).
///
/// `CGEventGetTimestamp` is documented as "roughly, nanoseconds since startup"
/// (CGEventTypes.h), but on Apple Silicon hardware events can carry raw
/// `mach_absolute_time` ticks (125/3 ns each) while posted events carry
/// nanoseconds, even on one tap. So each value is read both ways and the
/// reading closer to now wins; the two differ by a factor of about 41, so the
/// wrong one is hours or days away. On Intel the timebase is 1/1 and both
/// readings agree.
pub(super) fn event_host_nanos(raw: u64, now_ticks: u64, numer: u32, denom: u32) -> u64 {
    let ticks_to_nanos =
        |ticks: u64| (u128::from(ticks) * u128::from(numer) / u128::from(denom.max(1))) as u64;
    if numer == denom {
        return raw;
    }
    let now = ticks_to_nanos(now_ticks);
    let as_ticks = ticks_to_nanos(raw);
    if now.abs_diff(raw) <= now.abs_diff(as_ticks) {
        raw
    } else {
        as_ticks
    }
}

/// Recording milliseconds of a host time: zero is the flattened recording's
/// first frame, and paused stretches are taken out the way the capture
/// pipeline retimes its frames. `None` before the first frame.
pub(super) fn recording_ms(
    host_nanos: u64,
    session_start_secs: f64,
    pause_offset_secs: f64,
) -> Option<f64> {
    if !session_start_secs.is_finite() {
        return None;
    }
    let ms = (host_nanos as f64 / 1e9 - session_start_secs - pause_offset_secs) * 1000.0;
    (ms >= 0.0).then_some(ms)
}

struct TypingRun {
    started: f64,
    presses: u32,
}

/// Turns samples into the track's lines: moves at most every
/// `MOVE_INTERVAL_MS` while the pointer moves, plus the position it stops at;
/// typing presses as per-second counts at the first press of each second; and
/// every line in time order.
#[derive(Default)]
pub(super) struct InputLog {
    last_move_at: Option<f64>,
    pending_move: Option<(f64, f64, f64)>,
    typing: Option<TypingRun>,
    last_at: f64,
    // Lines in time order, each with its time. A typing count is placed at its
    // first press once its window closes, so lines after that wait for it.
    lines: Vec<(f64, String)>,
}

impl InputLog {
    pub(super) fn push(&mut self, at: f64, sample: InputSample) {
        // The tap delivers in order; clamp the odd late stamp so lines stay so.
        let at = at.max(self.last_at);
        self.last_at = at;
        self.close_typing_before(at);
        if let InputSample::Move { x, y } = sample {
            let due = self
                .last_move_at
                .is_none_or(|last| at - last >= MOVE_INTERVAL_MS);
            if due {
                self.pending_move = None;
                self.write_move(at, x, y);
            } else {
                self.pending_move = Some((at, x, y));
            }
            return;
        }
        self.flush_pending_move();
        match sample {
            InputSample::TypingPress => match self.typing.as_mut() {
                Some(run) => run.presses += 1,
                None => {
                    self.typing = Some(TypingRun {
                        started: at,
                        presses: 1,
                    })
                }
            },
            other => {
                if let Some(line) = serialize_sample(at, &other) {
                    self.lines.push((at, line));
                }
            }
        }
    }

    /// Lines that can be written now, given the recording time is `now`: the
    /// pointer's resting position once it has been still for a move interval,
    /// and typing counts whose second has passed. `None` while paused.
    pub(super) fn take_ready(&mut self, now: Option<f64>) -> String {
        if let Some(now) = now {
            self.close_typing_before(now);
            if self
                .pending_move
                .is_some_and(|(at, _, _)| now - at >= MOVE_INTERVAL_MS)
            {
                self.flush_pending_move();
            }
        }
        let hold_from = self
            .typing
            .as_ref()
            .map_or(f64::INFINITY, |run| run.started);
        let ready = self.lines.partition_point(|(at, _)| *at <= hold_from);
        Self::joined(self.lines.drain(..ready))
    }

    /// Everything left, at the end of the recording.
    pub(super) fn take_all(&mut self) -> String {
        self.flush_pending_move();
        self.close_typing_before(f64::INFINITY);
        Self::joined(self.lines.drain(..))
    }

    fn joined(lines: impl Iterator<Item = (f64, String)>) -> String {
        let mut out = String::new();
        for (_, line) in lines {
            out.push_str(&line);
            out.push('\n');
        }
        out
    }

    fn write_move(&mut self, at: f64, x: f64, y: f64) {
        self.last_move_at = Some(at);
        if let Some(line) = serialize_sample(at, &InputSample::Move { x, y }) {
            self.lines.push((at, line));
        }
    }

    fn flush_pending_move(&mut self) {
        if let Some((at, x, y)) = self.pending_move.take() {
            self.write_move(at, x, y);
        }
    }

    fn close_typing_before(&mut self, at: f64) {
        let closes = self
            .typing
            .as_ref()
            .is_some_and(|run| at >= run.started + TYPING_WINDOW_MS);
        if !closes {
            return;
        }
        if let Some(run) = self.typing.take() {
            let place = self.lines.partition_point(|(t, _)| *t <= run.started);
            self.lines
                .insert(place, (run.started, typing_line(run.started, run.presses)));
        }
    }
}

/// One complete gzip member holding `text`. Members appended one after another
/// read back as one gzip stream.
pub(super) fn gzip_member(text: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut encoder = GzEncoder::new(
        Vec::with_capacity(text.len() / 4 + 64),
        Compression::default(),
    );
    encoder.write_all(text)?;
    encoder.finish()
}

pub(super) use capture::{input_capture_allowed, start_input_capture, InputCapture};

mod capture {
    use super::*;

    use std::fs::OpenOptions;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
        CGEventTapPlacement, CGEventType, CallbackResult, EventField,
    };

    use super::super::rich_recording::RecordingClock;
    use super::super::track_upload::TrackUploadCtrl;

    const FLUSH_INTERVAL: Duration = Duration::from_secs(1);
    const TAP_POLL: Duration = Duration::from_millis(250);
    const SECURE_INPUT_POLL: Duration = Duration::from_millis(100);
    /// Events waiting for the writer. A full queue drops events and marks the
    /// track incomplete rather than ever holding up the tap.
    const QUEUE_DEPTH: usize = 8192;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightListenEventAccess() -> bool;
        fn CGEventGetTimestamp(event: *const std::ffi::c_void) -> u64;
        fn CGEventKeyboardGetUnicodeString(
            event: *const std::ffi::c_void,
            max_len: std::ffi::c_ulong,
            actual_len: *mut std::ffi::c_ulong,
            buffer: *mut u16,
        );
    }

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }

    /// Whether a listen-only tap can run without asking: Input Monitoring or
    /// Accessibility is already granted. Both checks are preflights that never
    /// prompt.
    pub(in super::super) fn input_capture_allowed() -> bool {
        // SAFETY: takes no arguments and only reads the process's access
        // decision; it never prompts.
        let listen = unsafe { CGPreflightListenEventAccess() };
        listen || crate::accessibility::macos::is_trusted(false)
    }

    /// What the input track ended up as, read once its writer has closed.
    #[derive(Clone, Debug, Default)]
    pub(in super::super) struct InputCaptureReport {
        /// Events were lost: the tap was switched off for a while, or the
        /// queue to the writer overflowed.
        pub(in super::super) gaps: bool,
        /// The file could not be written, so what is on disk can't be trusted.
        pub(in super::super) write_failed: bool,
        pub(in super::super) closed: bool,
    }

    /// Shared by the tap thread, its callback and `InputCapture`.
    #[derive(Default)]
    struct TapShared {
        stop: AtomicBool,
        /// Bumped at each stretch the tap may have missed events in: a pause
        /// or resume, the tap switched off, a full queue, secure input.
        breaks: AtomicU64,
        /// Events were lost, so the track is incomplete.
        lost: AtomicBool,
        reenable: AtomicBool,
        runloop: Mutex<Option<CFRunLoop>>,
    }

    impl TapShared {
        fn mark_break(&self) {
            self.breaks.fetch_add(1, Ordering::SeqCst);
        }

        fn mark_lost(&self) {
            self.lost.store(true, Ordering::SeqCst);
            self.mark_break();
        }

        /// Stops the tap thread: its run loop is woken so it exits now rather
        /// than at its next poll.
        fn stop(&self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(runloop) = self
                .runloop
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_ref()
            {
                runloop.stop();
            }
        }
    }

    pub(in super::super) struct InputCapture {
        tap: Arc<TapShared>,
        report: Arc<Mutex<InputCaptureReport>>,
    }

    impl InputCapture {
        /// Stops the tap. The writer then writes what is left, closes the file
        /// and tells the uploader to send the rest; nothing here waits on it.
        pub(in super::super) fn stop(&self) {
            self.tap.stop();
        }

        /// The recording paused or resumed: keys held across it are dropped.
        pub(in super::super) fn mark_break(&self) {
            self.tap.mark_break();
        }

        pub(in super::super) fn report(&self) -> InputCaptureReport {
            self.report
                .lock()
                .map(|report| report.clone())
                .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
        }
    }

    impl Drop for InputCapture {
        fn drop(&mut self) {
            self.tap.stop();
        }
    }

    struct TapEvent {
        at: f64,
        sample: InputSample,
    }

    struct TapContext {
        clock: RecordingClock,
        space: PixelSpace,
        privacy: Mutex<KeyPrivacy>,
        sender: SyncSender<TapEvent>,
        tap: Arc<TapShared>,
    }

    impl TapContext {
        fn handle(&self, kind: CGEventType, event: &CGEvent) {
            // SAFETY: a `&CGEventRef` is the CGEventRef itself (foreign-types),
            // valid for the callback; both calls only read it.
            let raw = &**event as *const _ as *const std::ffi::c_void;
            let stamp = unsafe { CGEventGetTimestamp(raw) };
            // `None` before the first frame, while paused and after Stop.
            let Some(at) = self.clock.at_event_stamp(stamp) else {
                return;
            };
            let Some(sample) = self.sample(kind, event, raw) else {
                return;
            };
            match self.sender.try_send(TapEvent { at, sample }) {
                Ok(()) | Err(TrySendError::Disconnected(_)) => {}
                Err(TrySendError::Full(_)) => self.tap.mark_lost(),
            }
        }
        fn sample(
            &self,
            kind: CGEventType,
            event: &CGEvent,
            raw: *const std::ffi::c_void,
        ) -> Option<InputSample> {
            let point = event.location();
            let (x, y) = self.space.to_px(point.x, point.y);
            let button_event = |down: bool, button: MouseButton| InputSample::Button {
                down,
                button,
                x,
                y,
                clicks: event
                    .get_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE)
                    .clamp(0, i64::from(u32::MAX)) as u32,
            };
            let other_button = || {
                MouseButton::from_number(
                    event.get_integer_value_field(EventField::MOUSE_EVENT_BUTTON_NUMBER),
                )
            };
            Some(match kind {
                CGEventType::MouseMoved
                | CGEventType::LeftMouseDragged
                | CGEventType::RightMouseDragged
                | CGEventType::OtherMouseDragged => InputSample::Move { x, y },
                CGEventType::LeftMouseDown => button_event(true, MouseButton::Left),
                CGEventType::LeftMouseUp => button_event(false, MouseButton::Left),
                CGEventType::RightMouseDown => button_event(true, MouseButton::Right),
                CGEventType::RightMouseUp => button_event(false, MouseButton::Right),
                CGEventType::OtherMouseDown => button_event(true, other_button()),
                CGEventType::OtherMouseUp => button_event(false, other_button()),
                CGEventType::ScrollWheel => {
                    // Point deltas in pixels, signed like a web WheelEvent
                    // (positive scrolls toward the bottom and right), the
                    // opposite of how macOS signs them.
                    let scale = self.space.scale;
                    InputSample::Wheel {
                        x,
                        y,
                        dx: -event.get_double_value_field(
                            EventField::SCROLL_WHEEL_EVENT_POINT_DELTA_AXIS_2,
                        ) * scale,
                        dy: -event.get_double_value_field(
                            EventField::SCROLL_WHEEL_EVENT_POINT_DELTA_AXIS_1,
                        ) * scale,
                    }
                }
                CGEventType::KeyDown | CGEventType::KeyUp => {
                    return self.key_sample(matches!(kind, CGEventType::KeyDown), event, raw);
                }
                _ => return None,
            })
        }

        fn key_sample(
            &self,
            down: bool,
            event: &CGEvent,
            raw: *const std::ffi::c_void,
        ) -> Option<InputSample> {
            let flags = event.get_flags();
            let mods = Modifiers {
                meta: flags.contains(CGEventFlags::CGEventFlagCommand),
                ctrl: flags.contains(CGEventFlags::CGEventFlagControl),
                alt: flags.contains(CGEventFlags::CGEventFlagAlternate),
                shift: flags.contains(CGEventFlags::CGEventFlagShift),
            };
            let keycode = event
                .get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE)
                .clamp(0, i64::from(u16::MAX)) as u16;
            let autorepeat =
                event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT) != 0;
            // SAFETY: takes no arguments; reads whether any process holds
            // secure input (a password field, say).
            let secure_input = unsafe { IsSecureEventInputEnabled() } != 0;
            let decision = {
                let mut privacy = self
                    .privacy
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                privacy.sync_breaks(self.tap.breaks.load(Ordering::SeqCst));
                privacy.classify(keycode, down, autorepeat, mods, secure_input, || {
                    event_chars(raw)
                })
            };
            match decision {
                KeyDecision::Drop => None,
                KeyDecision::Typing => Some(InputSample::TypingPress),
                KeyDecision::Keep { code, key } => Some(InputSample::Key {
                    down,
                    code,
                    key,
                    mods,
                }),
            }
        }
    }

    fn event_chars(raw: *const std::ffi::c_void) -> Option<String> {
        let mut buffer = [0_u16; 4];
        let mut len: std::ffi::c_ulong = 0;
        // SAFETY: the buffer holds `buffer.len()` UTF-16 units and the event is
        // valid for the callback this runs in.
        unsafe {
            CGEventKeyboardGetUnicodeString(
                raw,
                buffer.len() as std::ffi::c_ulong,
                &mut len,
                buffer.as_mut_ptr(),
            );
        }
        let len = (len as usize).min(buffer.len());
        (len > 0).then(|| String::from_utf16_lossy(&buffer[..len]))
    }

    /// Starts the input track: a listen-only tap on its own thread and a writer
    /// that appends to `path` about once a second. Call only after
    /// `input_capture_allowed`.
    pub(in super::super) fn start_input_capture(
        path: &Path,
        clock: RecordingClock,
        space: PixelSpace,
        upload: Arc<TrackUploadCtrl>,
    ) -> Result<InputCapture, String> {
        let tap = Arc::new(TapShared::default());
        let report = Arc::new(Mutex::new(InputCaptureReport::default()));
        let (sender, receiver) = sync_channel(QUEUE_DEPTH);

        let writer_report = Arc::clone(&report);
        let writer_tap = Arc::clone(&tap);
        let writer_clock = clock.clone();
        let writer_path = path.to_path_buf();
        std::thread::Builder::new()
            .name("clips-input-track-writer".into())
            .spawn(move || {
                write_track(
                    receiver,
                    writer_path,
                    || writer_clock.now_ms(),
                    &writer_report,
                    &writer_tap,
                    &upload,
                );
            })
            .map_err(|error| format!("input track writer could not start: {error}"))?;

        let context = TapContext {
            clock,
            space,
            privacy: Mutex::new(KeyPrivacy::default()),
            sender,
            tap: Arc::clone(&tap),
        };
        // Never joined: a stuck run loop must not hold up the recording's stop.
        std::thread::Builder::new()
            .name("clips-input-track-tap".into())
            .spawn(move || run_tap(context))
            .map_err(|error| format!("input track tap could not start: {error}"))?;
        Ok(InputCapture { tap, report })
    }

    /// When the tap thread reads whether secure input is on. A run loop no
    /// event wakes waits out its whole timeout, so the wait never runs past
    /// the next check: a stretch of secure input as long as the poll is
    /// always seen.
    #[derive(Default)]
    struct SecureInputPoll {
        checked_at: Option<Instant>,
    }

    impl SecureInputPoll {
        /// Whether a check is due at `now`; when it is, it counts as made.
        fn due(&mut self, now: Instant) -> bool {
            let due = self
                .checked_at
                .is_none_or(|at| now.saturating_duration_since(at) >= SECURE_INPUT_POLL);
            if due {
                self.checked_at = Some(now);
            }
            due
        }

        /// How long the run loop may wait at `now`.
        fn wait(&self, now: Instant) -> Duration {
            let until_check = self.checked_at.map_or(Duration::ZERO, |at| {
                SECURE_INPUT_POLL.saturating_sub(now.saturating_duration_since(at))
            });
            TAP_POLL.min(until_check)
        }
    }

    fn run_tap(context: TapContext) {
        let tap_shared = Arc::clone(&context.tap);
        let tap = CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::TailAppendEventTap,
            CGEventTapOptions::ListenOnly,
            vec![
                CGEventType::MouseMoved,
                CGEventType::LeftMouseDragged,
                CGEventType::RightMouseDragged,
                CGEventType::OtherMouseDragged,
                CGEventType::LeftMouseDown,
                CGEventType::LeftMouseUp,
                CGEventType::RightMouseDown,
                CGEventType::RightMouseUp,
                CGEventType::OtherMouseDown,
                CGEventType::OtherMouseUp,
                CGEventType::ScrollWheel,
                CGEventType::KeyDown,
                CGEventType::KeyUp,
            ],
            move |_proxy, kind, event| {
                match kind {
                    CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput => {
                        context.tap.mark_lost();
                        context.tap.reenable.store(true, Ordering::SeqCst);
                    }
                    _ => context.handle(kind, event),
                }
                CallbackResult::Keep
            },
        );
        let tap = match tap {
            Ok(tap) => tap,
            Err(()) => {
                eprintln!(
                    "[rich-tracks] input: the event tap could not be created, so this recording has no input track"
                );
                return;
            }
        };
        let source = match tap.mach_port().create_runloop_source(0) {
            Ok(source) => source,
            Err(()) => {
                eprintln!(
                    "[rich-tracks] input: the event tap's run loop source failed, so this recording has no input track"
                );
                return;
            }
        };
        let runloop = CFRunLoop::get_current();
        // SAFETY: the mode constant is a static CFString.
        runloop.add_source(&source, unsafe { kCFRunLoopCommonModes });
        *tap_shared
            .runloop
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(runloop);
        tap.enable();
        let mut secure_poll = SecureInputPoll::default();
        while !tap_shared.stop.load(Ordering::SeqCst) {
            if tap_shared.reenable.swap(false, Ordering::SeqCst) {
                eprintln!(
                    "[rich-tracks] input: the event tap was switched off; switching it back on"
                );
                tap.enable();
            }
            // Under secure input the tap sees no keys at all, so a key let go
            // meanwhile is never seen to go up.
            if secure_poll.due(Instant::now()) {
                // SAFETY: takes no arguments; reads whether any process holds
                // secure input.
                if unsafe { IsSecureEventInputEnabled() } != 0 {
                    tap_shared.mark_break();
                }
            }
            let wait = secure_poll.wait(Instant::now());
            // SAFETY: the mode constant is a static CFString.
            let _ = CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, wait, true);
        }
        tap_shared
            .runloop
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        // Dropping the tap disables it, and dropping its callback closes the
        // writer's queue, which ends the writer.
    }

    /// The writer thread: writes the track until the tap stops, then closes
    /// the file. A file that can't be written ends the track then and there,
    /// as an upload that fails for good does: the tap stops, and the uploader
    /// fails, which deletes the file. Only this track; the other carries on.
    fn write_track(
        receiver: Receiver<TapEvent>,
        path: PathBuf,
        now_ms: impl Fn() -> Option<f64>,
        report: &Mutex<InputCaptureReport>,
        tap: &TapShared,
        upload: &TrackUploadCtrl,
    ) {
        run_writer(receiver, path, now_ms, report);
        let write_failed = {
            let mut report = report
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            report.gaps |= tap.lost.load(Ordering::SeqCst);
            report.closed = true;
            report.write_failed
        };
        if write_failed {
            tap.stop();
            upload.fail_source("its file could not be written".into());
        }
        upload.close_source();
    }

    fn run_writer(
        receiver: Receiver<TapEvent>,
        path: PathBuf,
        now_ms: impl Fn() -> Option<f64>,
        report: &Mutex<InputCaptureReport>,
    ) {
        let mut log = InputLog::default();
        let mut file: Option<std::fs::File> = None;
        let mut next_flush = Instant::now() + FLUSH_INTERVAL;
        let mut events: u64 = 0;
        let write = |text: String, file: &mut Option<std::fs::File>| -> bool {
            if text.is_empty() {
                return true;
            }
            let written = (|| -> std::io::Result<()> {
                let member = gzip_member(text.as_bytes())?;
                if file.is_none() {
                    *file = Some(OpenOptions::new().create(true).append(true).open(&path)?);
                }
                let handle = file.as_mut().expect("opened above");
                handle.write_all(&member)?;
                handle.flush()
            })();
            match written {
                Ok(()) => true,
                Err(error) => {
                    eprintln!(
                        "[rich-tracks] input: writing {} failed, so the input track stops: {error}",
                        path.display()
                    );
                    if let Ok(mut report) = report.lock() {
                        report.write_failed = true;
                    }
                    false
                }
            }
        };
        loop {
            let wait = next_flush.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(wait) {
                Ok(TapEvent { at, sample }) => {
                    events += 1;
                    log.push(at, sample);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if Instant::now() >= next_flush {
                next_flush = Instant::now() + FLUSH_INTERVAL;
                if !write(log.take_ready(now_ms()), &mut file) {
                    return;
                }
            }
        }
        if write(log.take_all(), &mut file) {
            eprintln!(
                "[rich-tracks] input: closed {} after {events} event(s)",
                path.display()
            );
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::native_screen::track_upload::TrackSendGate;

        #[test]
        fn every_gap_in_capture_forgets_held_keys_and_lost_events_mark_the_track() {
            let tap = Arc::new(TapShared::default());
            let capture = InputCapture {
                tap: Arc::clone(&tap),
                report: Arc::default(),
            };
            let mut privacy = KeyPrivacy::default();
            let cmd = Modifiers {
                meta: true,
                ..Modifiers::default()
            };
            let gaps: [(&str, &dyn Fn(), bool); 5] = [
                ("a pause", &|| capture.mark_break(), false),
                ("a resume", &|| capture.mark_break(), false),
                ("secure input", &|| tap.mark_break(), false),
                ("the tap switched off", &|| tap.mark_lost(), true),
                ("a full queue", &|| tap.mark_lost(), true),
            ];
            for (gap, mark, lost) in gaps {
                privacy.sync_breaks(tap.breaks.load(Ordering::SeqCst));
                assert!(
                    matches!(
                        privacy.classify(0x28, true, false, cmd, false, || Some("k".into())),
                        KeyDecision::Keep { .. }
                    ),
                    "{gap}"
                );
                mark();
                privacy.sync_breaks(tap.breaks.load(Ordering::SeqCst));
                assert_eq!(
                    privacy.classify(0x28, false, false, cmd, false, || None),
                    KeyDecision::Drop,
                    "{gap}"
                );
                assert_eq!(tap.lost.load(Ordering::SeqCst), lost, "{gap}");
            }
        }

        #[test]
        fn a_quiet_tap_checks_secure_input_every_poll() {
            let start = Instant::now();
            // Quiet: each pass waits out its whole timeout. Busy: an event
            // wakes the run loop every 30 ms.
            for woken_every in [None, Some(Duration::from_millis(30))] {
                let mut poll = SecureInputPoll::default();
                let mut now = start;
                let mut checks = Vec::new();
                while now - start < Duration::from_secs(2) {
                    if poll.due(now) {
                        checks.push(now);
                    }
                    let wait = poll.wait(now);
                    assert!(wait <= TAP_POLL);
                    now += woken_every.map_or(wait, |every| wait.min(every));
                }
                assert!(checks.len() > 2, "{woken_every:?}");
                for pair in checks.windows(2) {
                    assert_eq!(pair[1] - pair[0], SECURE_INPUT_POLL, "{woken_every:?}");
                }
            }
        }

        #[test]
        fn a_file_that_cannot_be_written_stops_the_tap_and_fails_the_upload() {
            let tap = TapShared::default();
            let report = Mutex::new(InputCaptureReport::default());
            let upload = TrackUploadCtrl::new(
                Arc::new(AtomicBool::new(false)),
                Arc::new(TrackSendGate::new(|| Some(0))),
            );
            // In a folder that isn't there, so the file can't be made.
            let path = std::env::temp_dir()
                .join(format!(
                    "clips-input-track-test-{}-missing",
                    std::process::id()
                ))
                .join(INPUT_TRACK_FILE);
            let (sender, receiver) = sync_channel(4);
            sender
                .send(TapEvent {
                    at: 5.0,
                    sample: InputSample::Move { x: 1.0, y: 2.0 },
                })
                .unwrap();
            drop(sender);
            write_track(
                receiver,
                path.clone(),
                || Some(10.0),
                &report,
                &tap,
                &upload,
            );
            assert!(report.lock().unwrap().write_failed);
            // The tap stops rather than run on with nothing writing its events,
            // and the upload fails, which deletes the file and leaves the
            // other track be.
            assert!(tap.stop.load(Ordering::SeqCst));
            assert_eq!(
                upload.source_failure().as_deref(),
                Some("its file could not be written")
            );
            assert!(upload.source_closed());
            assert!(!path.exists());

            // A track that writes fine only closes.
            let dir = std::env::temp_dir().join(format!(
                "clips-input-track-test-{}-written",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let tap = TapShared::default();
            let report = Mutex::new(InputCaptureReport::default());
            let upload = TrackUploadCtrl::new(
                Arc::new(AtomicBool::new(false)),
                Arc::new(TrackSendGate::new(|| Some(0))),
            );
            let (sender, receiver) = sync_channel(4);
            drop(sender);
            write_track(
                receiver,
                dir.join(INPUT_TRACK_FILE),
                || Some(10.0),
                &report,
                &tap,
                &upload,
            );
            assert!(!tap.stop.load(Ordering::SeqCst));
            assert_eq!(upload.source_failure(), None);
            assert!(upload.source_closed());
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn lines(text: &str) -> Vec<serde_json::Value> {
        text.lines()
            .map(|line| serde_json::from_str(line).expect("each line is JSON"))
            .collect()
    }

    /// The character each test key types on a US layout.
    fn typed(keycode: u16) -> Option<String> {
        match keycode {
            0x00 => Some("a".into()),
            0x0E => Some("e".into()),
            0x12 => Some("1".into()),
            0x28 => Some("k".into()),
            _ => None,
        }
    }

    /// Classifies one key event, checking that its character is read only
    /// when a shortcut goes down.
    fn classify(
        privacy: &mut KeyPrivacy,
        keycode: u16,
        down: bool,
        autorepeat: bool,
        mods: Modifiers,
        secure_input: bool,
    ) -> KeyDecision {
        let read = std::cell::Cell::new(false);
        let decision = privacy.classify(keycode, down, autorepeat, mods, secure_input, || {
            read.set(true);
            typed(keycode)
        });
        let shortcut_press = down
            && mods.makes_shortcut()
            && named_key(keycode).is_none()
            && matches!(decision, KeyDecision::Keep { .. });
        assert_eq!(
            read.get(),
            shortcut_press,
            "key {keycode:#x} down={down}: character read={}",
            read.get()
        );
        decision
    }

    fn keep(code: &'static str, key: &str) -> KeyDecision {
        KeyDecision::Keep {
            code,
            key: key.into(),
        }
    }

    #[test]
    fn serializes_each_event_kind_in_the_track_format() {
        let shortcut = InputSample::Key {
            down: true,
            code: "KeyK",
            key: "k".into(),
            mods: Modifiers {
                meta: true,
                ..Modifiers::default()
            },
        };
        assert_eq!(
            serialize_sample(
                1532.414,
                &InputSample::Move {
                    x: 1204.5,
                    y: 688.0
                }
            )
            .unwrap(),
            r#"{"t":1532.41,"e":"move","x":1204.5,"y":688.0}"#
        );
        assert_eq!(
            serialize_sample(
                1610.02,
                &InputSample::Button {
                    down: true,
                    button: MouseButton::Left,
                    x: 1210.0,
                    y: 690.0,
                    clicks: 1,
                }
            )
            .unwrap(),
            r#"{"t":1610.02,"e":"down","b":"left","x":1210.0,"y":690.0,"n":1}"#
        );
        assert_eq!(
            serialize_sample(
                1650.0,
                &InputSample::Wheel {
                    x: 1210.0,
                    y: 690.0,
                    dx: 0.0,
                    dy: -12.5,
                }
            )
            .unwrap(),
            r#"{"t":1650.0,"e":"wheel","x":1210.0,"y":690.0,"dx":0.0,"dy":-12.5}"#
        );
        assert_eq!(
            serialize_sample(4100.5, &shortcut).unwrap(),
            r#"{"t":4100.5,"e":"key","down":true,"code":"KeyK","key":"k","mods":["meta"]}"#
        );
        assert_eq!(
            serialize_sample(
                4200.0,
                &InputSample::Key {
                    down: true,
                    code: "ArrowLeft",
                    key: "ArrowLeft".into(),
                    mods: Modifiers {
                        alt: true,
                        ..Modifiers::default()
                    },
                }
            )
            .unwrap(),
            r#"{"t":4200.0,"e":"key","down":true,"code":"ArrowLeft","key":"ArrowLeft","mods":["alt"]}"#
        );
        assert_eq!(serialize_sample(1.0, &InputSample::TypingPress), None);
        assert_eq!(MouseButton::from_number(2), MouseButton::Middle);
        assert_eq!(MouseButton::from_number(4), MouseButton::Other);
    }

    #[test]
    fn privacy_keeps_shortcuts_and_named_keys_and_counts_the_rest() {
        let mut privacy = KeyPrivacy::default();
        let none = Modifiers::default();
        let shift = Modifiers {
            shift: true,
            ..none
        };
        let cmd = Modifiers { meta: true, ..none };
        let option = Modifiers { alt: true, ..none };
        let ctrl = Modifiers { ctrl: true, ..none };
        // Letters, digits, space and shifted letters are typing.
        assert_eq!(
            classify(&mut privacy, 0x28, true, false, none, false),
            KeyDecision::Typing
        );
        assert_eq!(
            classify(&mut privacy, 0x12, true, false, shift, false),
            KeyDecision::Typing
        );
        assert_eq!(
            classify(&mut privacy, 0x31, true, false, none, false),
            KeyDecision::Typing
        );
        // Their releases are dropped.
        assert_eq!(
            classify(&mut privacy, 0x28, false, false, none, false),
            KeyDecision::Drop
        );
        // Option with a letter or digit types a character (é, ˚), so it is
        // typing, and its release is dropped.
        for keycode in [0x0E, 0x28, 0x12] {
            assert_eq!(
                classify(&mut privacy, keycode, true, false, option, false),
                KeyDecision::Typing
            );
            assert_eq!(
                classify(&mut privacy, keycode, false, false, option, false),
                KeyDecision::Drop
            );
        }
        assert_eq!(
            classify(
                &mut privacy,
                0x0E,
                true,
                false,
                Modifiers {
                    shift: true,
                    ..option
                },
                false
            ),
            KeyDecision::Typing
        );
        // Cmd and Ctrl make a shortcut, with Option held too or not.
        for mods in [cmd, ctrl, Modifiers { alt: true, ..cmd }] {
            assert_eq!(
                classify(&mut privacy, 0x28, true, false, mods, false),
                keep("KeyK", "k")
            );
            assert!(matches!(
                classify(&mut privacy, 0x28, false, false, none, false),
                KeyDecision::Keep { code: "KeyK", .. }
            ));
        }
        // Named keys are kept with or without modifiers, Option included.
        assert_eq!(
            classify(&mut privacy, 0x7B, true, false, option, false),
            keep("ArrowLeft", "ArrowLeft")
        );
        assert!(matches!(
            classify(&mut privacy, 0x7B, false, false, option, false),
            KeyDecision::Keep {
                code: "ArrowLeft",
                ..
            }
        ));
        assert_eq!(
            classify(&mut privacy, 0x33, true, false, option, false),
            keep("Backspace", "Backspace")
        );
        assert_eq!(
            classify(&mut privacy, 0x24, true, false, none, false),
            keep("Enter", "Enter")
        );
        assert_eq!(
            classify(&mut privacy, 0x30, true, false, shift, false),
            keep("Tab", "Tab")
        );
        assert_eq!(
            classify(&mut privacy, 0x4C, true, false, none, false),
            keep("NumpadEnter", "Enter")
        );
        for (keycode, name) in [
            (0x35, "Escape"),
            (0x33, "Backspace"),
            (0x75, "Delete"),
            (0x7B, "ArrowLeft"),
            (0x7E, "ArrowUp"),
            (0x73, "Home"),
            (0x79, "PageDown"),
            (0x7A, "F1"),
            (0x5A, "F20"),
        ] {
            assert_eq!(
                classify(&mut privacy, keycode, true, false, none, false),
                keep(name, name),
                "{name}"
            );
        }
        // Held keys repeat; repeats are not presses.
        assert_eq!(
            classify(&mut privacy, 0x7B, true, true, none, false),
            KeyDecision::Drop
        );
        assert_eq!(
            classify(&mut privacy, 0x28, true, true, none, false),
            KeyDecision::Drop
        );
    }

    #[test]
    fn secure_input_keeps_no_keys_at_all() {
        let mut privacy = KeyPrivacy::default();
        let cmd = Modifiers {
            meta: true,
            ..Modifiers::default()
        };
        assert!(matches!(
            classify(&mut privacy, 0x28, true, false, cmd, false),
            KeyDecision::Keep { .. }
        ));
        // Not even a shortcut, a named key, a typing count or a release.
        assert_eq!(
            classify(&mut privacy, 0x28, true, false, cmd, true),
            KeyDecision::Drop
        );
        assert_eq!(
            classify(&mut privacy, 0x24, true, false, Modifiers::default(), true),
            KeyDecision::Drop
        );
        assert_eq!(
            classify(&mut privacy, 0x00, true, false, Modifiers::default(), true),
            KeyDecision::Drop
        );
        assert_eq!(
            classify(&mut privacy, 0x28, false, false, cmd, true),
            KeyDecision::Drop
        );
        // A release after secure input ends belongs to no kept press.
        assert_eq!(
            classify(&mut privacy, 0x28, false, false, cmd, false),
            KeyDecision::Drop
        );
    }

    #[test]
    fn a_key_held_across_a_pause_is_forgotten_so_typing_it_later_stays_a_count() {
        let mut privacy = KeyPrivacy::default();
        let none = Modifiers::default();
        let cmd = Modifiers { meta: true, ..none };
        assert_eq!(
            classify(&mut privacy, 0x00, true, false, cmd, false),
            keep("KeyA", "a")
        );
        // The recording pauses, A comes up unseen while paused, and the
        // recording resumes.
        privacy.sync_breaks(1);
        privacy.sync_breaks(2);
        // Typing A afterwards is a count, press and release.
        assert_eq!(
            classify(&mut privacy, 0x00, true, false, none, false),
            KeyDecision::Typing
        );
        assert_eq!(
            classify(&mut privacy, 0x00, false, false, none, false),
            KeyDecision::Drop
        );
        // A break the filter has already seen forgets nothing new.
        assert_eq!(
            classify(&mut privacy, 0x28, true, false, cmd, false),
            keep("KeyK", "k")
        );
        privacy.sync_breaks(2);
        assert_eq!(
            classify(&mut privacy, 0x28, false, false, none, false),
            keep("KeyK", "k")
        );
    }

    #[test]
    fn a_new_press_of_a_key_still_held_drops_the_release_that_was_missed() {
        let mut privacy = KeyPrivacy::default();
        let none = Modifiers::default();
        let cmd = Modifiers { meta: true, ..none };
        assert_eq!(
            classify(&mut privacy, 0x00, true, false, cmd, false),
            keep("KeyA", "a")
        );
        // A went up unseen with no break noticed; the next press of A is
        // typing, so its release is not kept either.
        assert_eq!(
            classify(&mut privacy, 0x00, true, false, none, false),
            KeyDecision::Typing
        );
        assert_eq!(
            classify(&mut privacy, 0x00, false, false, none, false),
            KeyDecision::Drop
        );
        // Pressed again as a shortcut, it is kept once, not twice.
        for _ in 0..2 {
            assert_eq!(
                classify(&mut privacy, 0x28, true, false, cmd, false),
                keep("KeyK", "k")
            );
        }
        assert_eq!(
            classify(&mut privacy, 0x28, false, false, none, false),
            keep("KeyK", "k")
        );
        assert_eq!(
            classify(&mut privacy, 0x28, false, false, none, false),
            KeyDecision::Drop
        );
    }

    #[test]
    fn a_kept_release_repeats_its_press_and_never_reads_its_own_character() {
        let mut privacy = KeyPrivacy::default();
        let cmd = Modifiers {
            meta: true,
            ..Modifiers::default()
        };
        assert_eq!(
            privacy.classify(0x28, true, false, cmd, false, || Some("k".into())),
            keep("KeyK", "k")
        );
        // Whatever the event would type by the time the key comes up.
        assert_eq!(
            privacy.classify(0x28, false, false, Modifiers::default(), false, || {
                panic!("a release never reads its character")
            }),
            keep("KeyK", "k")
        );
        // Typing and named keys never read it either.
        privacy.classify(0x00, true, false, Modifiers::default(), false, || {
            panic!("typing never reads its character")
        });
        privacy.classify(0x7B, true, false, cmd, false, || {
            panic!("a named key never reads its character")
        });
    }

    #[test]
    fn shortcut_labels_come_from_printable_characters_or_the_code() {
        assert_eq!(shortcut_key_label(Some("k"), "KeyK"), "k");
        // Ctrl+K carries a control character.
        assert_eq!(shortcut_key_label(Some("\u{b}"), "KeyK"), "k");
        assert_eq!(shortcut_key_label(None, "Digit4"), "4");
        assert_eq!(shortcut_key_label(Some(""), "Space"), "Space");
        assert_eq!(shortcut_key_label(Some("ab"), "Comma"), "Comma");
    }

    #[test]
    fn moves_are_throttled_to_one_per_interval_and_keep_the_resting_position() {
        let mut log = InputLog::default();
        for step in 0..=20 {
            let at = 100.0 + f64::from(step) * 2.0;
            log.push(at, InputSample::Move { x: at, y: 0.0 });
        }
        // 100..=140 every 2 ms: written at 100, 110, 120, 130, 140.
        let written = lines(&log.take_ready(Some(141.0)));
        let times: Vec<f64> = written
            .iter()
            .map(|line| line["t"].as_f64().unwrap())
            .collect();
        assert_eq!(times, [100.0, 110.0, 120.0, 130.0, 140.0]);

        // The pointer stops between intervals: its last position is written
        // once it has been still for an interval, not before.
        log.push(143.0, InputSample::Move { x: 143.0, y: 5.0 });
        log.push(145.0, InputSample::Move { x: 145.0, y: 5.0 });
        assert_eq!(log.take_ready(Some(150.0)), "");
        let rest = lines(&log.take_ready(Some(155.0)));
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0]["t"], 145.0);
        assert_eq!(rest[0]["x"], 145.0);

        // A click writes the pending position first.
        log.push(160.0, InputSample::Move { x: 1.0, y: 1.0 });
        log.push(162.0, InputSample::Move { x: 2.0, y: 2.0 });
        log.push(
            163.0,
            InputSample::Button {
                down: true,
                button: MouseButton::Left,
                x: 2.0,
                y: 2.0,
                clicks: 1,
            },
        );
        let kinds: Vec<String> = lines(&log.take_ready(Some(163.0)))
            .iter()
            .map(|line| format!("{}@{}", line["e"].as_str().unwrap(), line["t"]))
            .collect();
        assert_eq!(kinds, ["move@160.0", "move@162.0", "down@163.0"]);
    }

    #[test]
    fn typing_is_counted_per_second_and_lines_stay_in_time_order() {
        let mut log = InputLog::default();
        log.push(1000.0, InputSample::TypingPress);
        log.push(1100.0, InputSample::Move { x: 1.0, y: 1.0 });
        log.push(1200.0, InputSample::TypingPress);
        log.push(1300.0, InputSample::TypingPress);
        // The count's second is still open, so nothing after it is written.
        assert_eq!(log.take_ready(Some(1500.0)), "");
        // A press past the second starts the next count.
        log.push(2100.0, InputSample::TypingPress);
        let first = lines(&log.take_ready(Some(2200.0)));
        assert_eq!(first.len(), 2);
        assert_eq!(
            first[0],
            serde_json::json!({"t": 1000.0, "e": "typing", "n": 3})
        );
        assert_eq!(first[1]["e"], "move");
        let rest = lines(&log.take_all());
        assert_eq!(
            rest,
            [serde_json::json!({"t": 2100.0, "e": "typing", "n": 1})]
        );

        // Late stamps are clamped so the file stays in order.
        let mut log = InputLog::default();
        log.push(50.0, InputSample::Move { x: 0.0, y: 0.0 });
        log.push(40.0, InputSample::Move { x: 9.0, y: 9.0 });
        let all = lines(&log.take_all());
        let times: Vec<f64> = all.iter().map(|line| line["t"].as_f64().unwrap()).collect();
        assert!(times.windows(2).all(|pair| pair[0] <= pair[1]), "{times:?}");
    }

    #[test]
    fn appended_gzip_members_read_back_as_one_stream() {
        let mut file = Vec::new();
        file.extend(gzip_member(b"{\"t\":1.0,\"e\":\"move\",\"x\":1.0,\"y\":2.0}\n").unwrap());
        file.extend(gzip_member(b"{\"t\":2.0,\"e\":\"typing\",\"n\":4}\n").unwrap());
        let mut text = String::new();
        flate2::read::MultiGzDecoder::new(&file[..])
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(
            text,
            "{\"t\":1.0,\"e\":\"move\",\"x\":1.0,\"y\":2.0}\n{\"t\":2.0,\"e\":\"typing\",\"n\":4}\n"
        );
        // Any prefix that ends between members is itself a whole file.
        let first_len = gzip_member(b"{\"t\":1.0,\"e\":\"move\",\"x\":1.0,\"y\":2.0}\n")
            .unwrap()
            .len();
        let mut prefix = String::new();
        flate2::read::MultiGzDecoder::new(&file[..first_len])
            .read_to_string(&mut prefix)
            .unwrap();
        assert_eq!(prefix.lines().count(), 1);
    }

    #[test]
    fn event_times_are_read_as_nanoseconds_or_ticks_whichever_is_now() {
        // Apple Silicon: 125/3 ns per tick, about 35 days of uptime.
        let now_ticks: u64 = 72_541_582_675_928;
        let now_nanos = now_ticks * 125 / 3;
        // A hardware event 3 ms ago, stamped in ticks.
        let ticks_stamp = now_ticks - 72_000;
        assert_eq!(
            event_host_nanos(ticks_stamp, now_ticks, 125, 3),
            ticks_stamp * 125 / 3
        );
        // A posted event 3 ms ago, stamped in nanoseconds.
        let nanos_stamp = now_nanos - 3_000_000;
        assert_eq!(
            event_host_nanos(nanos_stamp, now_ticks, 125, 3),
            nanos_stamp
        );
        // Intel: ticks are nanoseconds.
        assert_eq!(event_host_nanos(5_000, 6_000, 1, 1), 5_000);
    }

    #[test]
    fn recording_time_starts_at_the_first_frame_and_skips_pauses() {
        let start = 2_000_000.0;
        let at = |seconds_after_start: f64| ((start + seconds_after_start) * 1e9) as u64;
        // Before the first frame there is no recording time.
        assert_eq!(recording_ms(at(1.0), f64::NAN, 0.0), None);
        assert_eq!(recording_ms(at(-0.5), start, 0.0), None);
        let ms = recording_ms(at(1.5324), start, 0.0).unwrap();
        assert!((ms - 1532.4).abs() < 0.01, "{ms}");
        // After a 4-second pause, the pipeline subtracts 4 seconds from its
        // frames' times; events are retimed the same way.
        let ms = recording_ms(at(10.0), start, 4.0).unwrap();
        assert!((ms - 6000.0).abs() < 0.01, "{ms}");
    }

    #[test]
    fn global_points_become_pixels_of_the_captured_area() {
        // A 1512x982-point Retina display at 3024x1964 pixels, to the right of
        // the main display.
        let display = DisplayGeometry {
            id: 2,
            x_pt: 1728.0,
            y_pt: 0.0,
            width_pt: 1512.0,
            height_pt: 982.0,
            width_px: 3024,
            height_px: 1964,
        };
        assert_eq!(display.scale(), 2.0);
        let space = display.pixel_space(None);
        assert_eq!(space.to_px(1728.0, 0.0), (0.0, 0.0));
        assert_eq!(space.to_px(2330.25, 344.0), (1204.5, 688.0));
        // On the main display, to its left: negative x.
        assert_eq!(space.to_px(100.0, 50.0), (-3256.0, 100.0));
        // Above a display arranged lower than the main one: negative y.
        let lower = DisplayGeometry {
            y_pt: 200.0,
            ..display
        };
        assert_eq!(lower.pixel_space(None).to_px(1728.0, 100.0), (0.0, -200.0));
        // A region counts from its own top-left.
        let region = display.pixel_space(Some((2106.0, 491.0)));
        assert_eq!(region.to_px(2106.0, 491.0), (0.0, 0.0));
        assert_eq!(region.to_px(2330.25, 344.0), (448.5, -294.0));
    }
}
