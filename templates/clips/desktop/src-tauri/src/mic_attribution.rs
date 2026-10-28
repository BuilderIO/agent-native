
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

#[cfg(target_os = "macos")]
static ACTIVE_CHILD: Mutex<Option<Arc<Mutex<Option<Child>>>>> = Mutex::new(None);

#[cfg(target_os = "macos")]
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

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
    mic_bundle_ids: Option<Vec<String>>,
    observed_at: Instant,
    available: bool,
}

#[cfg(target_os = "macos")]
pub(crate) struct MicAttributionWatcher {
    state: Arc<Mutex<AttributionState>>,
    child: Arc<Mutex<Option<Child>>>,
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

        kill_child(&child_slot);
        mark_unavailable(&state, "log stream process exited");
    });
}

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
