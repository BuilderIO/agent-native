//! Second, independent corroboration source for the call-ended heuristic in
//! `silence_detector.rs`: macOS's own mic-in-use indicator.
//!
//! macOS 12+ writes an `Active activity attributions changed to [...]` event
//! to the unified log (subsystem `com.apple.controlcenter`, category
//! `sensor-indicators`) whenever the orange-mic-dot's owner changes. Each
//! entry is prefixed `mic:`, `cam:`, `aud:`, or `scr:` and carries the
//! *responsible app's* bundle id — e.g. `mic:us.zoom.xos` — regardless of
//! which in-call helper process actually opened the device. That is the
//! opposite trade-off from `call_activity`'s CoreAudio scan, which sees the
//! exact helper but only on macOS 14+: the two sources corroborate rather
//! than duplicate each other.

#[cfg(target_os = "macos")]
use std::io::{BufRead, BufReader};
#[cfg(target_os = "macos")]
use std::process::{Child, Command, Stdio};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::{Arc, Mutex};
#[cfg(target_os = "macos")]
use std::time::Instant;

#[cfg(target_os = "macos")]
const LOG_PREDICATE: &str = "subsystem == \"com.apple.controlcenter\" AND category == \"sensor-indicators\" AND eventMessage BEGINSWITH \"Active activity attributions changed to \"";

#[cfg(target_os = "macos")]
const ATTRIBUTION_PREFIX: &str = "Active activity attributions changed to ";

/// The live watcher's child slot, so `RunEvent::Exit` — which skips Rust
/// destructors — can still kill the `log stream` process (see `shutdown`).
#[cfg(target_os = "macos")]
static ACTIVE_CHILD: Mutex<Option<Arc<Mutex<Option<Child>>>>> = Mutex::new(None);

/// Set by `shutdown`; a watcher whose child registers after this point kills
/// it itself, so an exit that races a fresh start cannot orphan a
/// `log stream` process.
#[cfg(target_os = "macos")]
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// Parses one line of `log stream`/`log show --style ndjson` output (or
/// `log show`'s default compact text format) and returns the lowercased
/// `mic:` bundle ids from an attribution-changed event.
///
/// `None` means "not a parsable attribution line" — the ndjson lines carry
/// their message JSON-escaped one level deeper than the compact format, and
/// the `log` tool's own "Filtering the log data using ..." startup banner
/// echoes this predicate's text back, so a naive substring search would
/// misfire on it. Returning `None` here (rather than an empty Vec) keeps
/// "nothing attributed" and "couldn't read this line" distinguishable to the
/// caller.
#[cfg(target_os = "macos")]
fn parse_attribution_line(line: &str) -> Option<Vec<String>> {
    let message = ndjson_event_message(line).unwrap_or_else(|| line.to_string());
    let array_start = message.find(ATTRIBUTION_PREFIX)? + ATTRIBUTION_PREFIX.len();
    let entries: Vec<String> = serde_json::from_str(&message[array_start..]).ok()?;
    Some(
        entries
            .into_iter()
            .filter_map(|entry| entry.strip_prefix("mic:").map(str::to_lowercase))
            .collect(),
    )
}

#[cfg(target_os = "macos")]
fn ndjson_event_message(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    value.get("eventMessage")?.as_str().map(str::to_owned)
}

#[cfg(target_os = "macos")]
struct AttributionState {
    /// Lowercased `mic:` bundle ids from the most recent parsed attribution
    /// event. `None` until the seed read or the first stream line lands —
    /// "unknown", distinct from an empty list meaning "nothing has the mic".
    mic_bundle_ids: Option<Vec<String>>,
    observed_at: Instant,
    /// Cleared once the `log stream` child fails to spawn or exits, so
    /// `mic_in_use_by` reports unknown rather than a stale answer.
    available: bool,
}

/// Streams Control Center's mic-attribution log line by line on a background
/// thread and exposes the latest reading. `start`/`stop` bracket exactly one
/// live `/usr/bin/log stream` child; `Drop` stops it too, so a caller that
/// forgets to call `stop()` explicitly still can't leak the process.
#[cfg(target_os = "macos")]
pub(crate) struct MicAttributionWatcher {
    state: Arc<Mutex<AttributionState>>,
    child: Arc<Mutex<Option<Child>>>,
    /// Set by `stop`; the reader thread checks it right after registering
    /// its child, so a stop that lands before the spawn finishes still kills
    /// the process instead of leaking it.
    stopped: Arc<AtomicBool>,
}

#[cfg(target_os = "macos")]
impl MicAttributionWatcher {
    pub(crate) fn start() -> Self {
        let state = Arc::new(Mutex::new(AttributionState {
            mic_bundle_ids: None,
            observed_at: Instant::now(),
            available: true,
        }));
        seed_from_log_show(&state);

        let child = Arc::new(Mutex::new(None));
        let stopped = Arc::new(AtomicBool::new(false));
        if let Ok(mut active) = ACTIVE_CHILD.lock() {
            *active = Some(child.clone());
        }
        spawn_stream_reader(state.clone(), child.clone(), stopped.clone());
        Self {
            state,
            child,
            stopped,
        }
    }

    pub(crate) fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Ok(mut active) = ACTIVE_CHILD.lock() {
            if active
                .as_ref()
                .is_some_and(|slot| Arc::ptr_eq(slot, &self.child))
            {
                *active = None;
            }
        }
        kill_child(&self.child);
    }

    pub(crate) fn mic_in_use_by(&self, bundle_ids: &[String]) -> Option<bool> {
        let state = self.state.lock().ok()?;
        if !state.available {
            return None;
        }
        let mic_bundle_ids = state.mic_bundle_ids.as_ref()?;
        Some(mic_bundle_ids.iter().any(|mic_id| {
            bundle_ids
                .iter()
                .any(|candidate| crate::call_activity::bundle_id_matches(mic_id, candidate))
        }))
    }
}

#[cfg(target_os = "macos")]
impl Drop for MicAttributionWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Kills the live `log stream` child, if any, on the app-exit path that
/// bypasses `Drop`.
#[cfg(target_os = "macos")]
pub(crate) fn shutdown() {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    let slot = ACTIVE_CHILD
        .lock()
        .ok()
        .and_then(|mut active| active.take());
    if let Some(slot) = slot {
        kill_child(&slot);
    }
}

#[cfg(target_os = "macos")]
fn kill_child(slot: &Arc<Mutex<Option<Child>>>) {
    let Some(mut child) = slot.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    let _ = child.kill();
    let _ = child.wait();
}

/// Best-effort seed from recent log history so a watcher started mid-call
/// doesn't have to wait for the next attribution change to learn who has the
/// mic. Twenty minutes covers a recording started well into a call; older
/// than that, the CoreAudio source carries the session until the next change. Leaves `mic_bundle_ids` at `None` (unknown) on any failure — the live
/// stream reader is the source of truth and will populate it regardless.
#[cfg(target_os = "macos")]
fn seed_from_log_show(state: &Arc<Mutex<AttributionState>>) {
    let Ok(output) = Command::new("/usr/bin/log")
        .args([
            "show",
            "--last",
            "20m",
            "--style",
            "ndjson",
            "--predicate",
            LOG_PREDICATE,
        ])
        .output()
    else {
        return;
    };
    let Ok(text) = String::from_utf8(output.stdout) else {
        return;
    };
    let Some(mic_bundle_ids) = text.lines().rev().find_map(parse_attribution_line) else {
        return;
    };
    if let Ok(mut s) = state.lock() {
        s.mic_bundle_ids = Some(mic_bundle_ids);
        s.observed_at = Instant::now();
    }
}

#[cfg(target_os = "macos")]
fn spawn_stream_reader(
    state: Arc<Mutex<AttributionState>>,
    child_slot: Arc<Mutex<Option<Child>>>,
    stopped: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut child = match Command::new("/usr/bin/log")
            .args([
                "stream",
                "--type",
                "log",
                "--level",
                "default",
                "--style",
                "ndjson",
                "--predicate",
                LOG_PREDICATE,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                mark_unavailable(
                    &state,
                    &format!("failed to spawn /usr/bin/log stream: {err}"),
                );
                return;
            }
        };
        let Some(stdout) = child.stdout.take() else {
            mark_unavailable(&state, "log stream stdout was not piped");
            let _ = child.kill();
            let _ = child.wait();
            return;
        };
        let mut slot = match child_slot.lock() {
            Ok(slot) => slot,
            Err(_) => {
                // Lock poisoned before the watcher could even record the
                // child — nothing else can stop it, so kill it directly
                // rather than leak a live log stream process.
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        };
        *slot = Some(child);
        drop(slot);
        if stopped.load(Ordering::SeqCst) || SHUTTING_DOWN.load(Ordering::SeqCst) {
            kill_child(&child_slot);
            return;
        }

        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Some(mic_bundle_ids) = parse_attribution_line(&line) else {
                continue;
            };
            let Ok(mut s) = state.lock() else { break };
            s.mic_bundle_ids = Some(mic_bundle_ids);
            s.observed_at = Instant::now();
            s.available = true;
        }

        // stdout closed: either `stop()` killed the child, or `log stream`
        // itself exited. Both mean this reading is no longer current; reap
        // the child now so an unexpected exit does not linger as a zombie.
        kill_child(&child_slot);
        mark_unavailable(&state, "log stream process exited");
    });
}

/// Marks the watcher unavailable and logs exactly once on the transition, so
/// callers stop getting a stale answer without every failed tick spamming
/// the log.
#[cfg(target_os = "macos")]
fn mark_unavailable(state: &Arc<Mutex<AttributionState>>, reason: &str) {
    let Ok(mut s) = state.lock() else { return };
    if s.available {
        let last_reading_age = s.mic_bundle_ids.as_ref().map(|_| s.observed_at.elapsed());
        eprintln!(
            "[call-ended] mic attribution watcher unavailable: {reason} (last reading {last_reading_age:?} ago)"
        );
    }
    s.available = false;
}

#[cfg(not(target_os = "macos"))]
pub(crate) struct MicAttributionWatcher;

#[cfg(not(target_os = "macos"))]
impl MicAttributionWatcher {
    pub(crate) fn start() -> Self {
        Self
    }

    pub(crate) fn stop(&self) {}

    pub(crate) fn mic_in_use_by(&self, _bundle_ids: &[String]) -> Option<bool> {
        None
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn shutdown() {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::parse_attribution_line;

    #[test]
    fn parses_ndjson_lines_and_extracts_lowercased_mic_bundle_ids() {
        let with_mic_and_other_kinds = "{\"traceID\":1,\"eventMessage\":\"Active activity attributions changed to [\\\"mic:com.granola.app\\\", \\\"cam:us.zoom.xos\\\", \\\"aud:com.granola.app\\\", \\\"mic:us.zoom.xos\\\", \\\"scr:com.clips.tray\\\"]\",\"eventType\":\"logEvent\",\"subsystem\":\"com.apple.controlcenter\",\"category\":\"sensor-indicators\",\"processImagePath\":\"/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter\",\"messageType\":\"Default\"}";
        assert_eq!(
            parse_attribution_line(with_mic_and_other_kinds),
            Some(vec![
                "com.granola.app".to_string(),
                "us.zoom.xos".to_string()
            ])
        );

        let empty_attribution = "{\"eventMessage\":\"Active activity attributions changed to []\",\"subsystem\":\"com.apple.controlcenter\",\"category\":\"sensor-indicators\"}";
        assert_eq!(parse_attribution_line(empty_attribution), Some(vec![]));

        let camera_only = "{\"eventMessage\":\"Active activity attributions changed to [\\\"cam:us.zoom.xos\\\", \\\"scr:com.clips.tray\\\"]\",\"subsystem\":\"com.apple.controlcenter\",\"category\":\"sensor-indicators\"}";
        assert_eq!(parse_attribution_line(camera_only), Some(vec![]));
    }

    #[test]
    fn rejects_the_log_tool_startup_banner() {
        let filtering_banner = "Filtering the log data using \"(subsystem == \\\"com.apple.controlcenter\\\" AND category == \\\"sensor-indicators\\\" AND composedMessage BEGINSWITH \\\"Active activity attributions changed to \\\") AND type == 1024\"";
        assert_eq!(parse_attribution_line(filtering_banner), None);
    }

    #[test]
    fn parses_the_log_show_compact_text_format() {
        let compact_line = "2026-09-04 11:32:05.266 Df ControlCenter[37737:2e1beeb] [com.apple.controlcenter:sensor-indicators] Active activity attributions changed to [\"mic:com.granola.app\", \"aud:com.clips.tray\", \"scr:com.clips.tray\", \"mic:com.clips.tray\"]";
        assert_eq!(
            parse_attribution_line(compact_line),
            Some(vec![
                "com.granola.app".to_string(),
                "com.clips.tray".to_string()
            ])
        );
    }
}
