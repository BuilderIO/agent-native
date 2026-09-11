use crate::capture_graph::CaptureSource;
use serde::Serialize;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static LEASE_COUNTER: AtomicU64 = AtomicU64::new(0);
static SUSPENSION_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct RewindCaptureSuspensionState {
    inner: Mutex<RewindCaptureSuspensionRuntime>,
}

#[derive(Default)]
struct RewindCaptureSuspensionRuntime {
    leases: BTreeSet<String>,
    suspended_rewind: bool,
}

impl RewindCaptureSuspensionRuntime {
    /// True only when this release removed the final live owner.
    fn release_lease(&mut self, lease_id: &str) -> bool {
        self.leases.remove(lease_id) && self.leases.is_empty()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindCaptureSuspensionLease {
    lease_id: Option<String>,
    suspended_rewind: bool,
}

fn next_lease_id() -> String {
    let sequence = LEASE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("ordinary-capture-{sequence}")
}

fn capture_conflicts(
    requires_screen: bool,
    requires_microphone: bool,
    sources: &[CaptureSource],
) -> bool {
    requires_screen
        || (requires_microphone
            && sources
                .iter()
                .any(|source| *source == CaptureSource::Microphone))
}

pub(crate) fn is_active(app: &AppHandle) -> bool {
    let _ = app;
    SUSPENSION_ACTIVE.load(Ordering::Acquire)
}

/// Hands the one physical capture graph to an ordinary Clip that cannot reuse
/// Rewind. The first lease stops Rewind; nested leases keep it stopped until
/// the final owner releases. Persisted enable/pause/mode settings are untouched.
#[tauri::command]
pub async fn rewind_capture_suspension_acquire(
    app: AppHandle,
    requires_screen: bool,
    requires_microphone: bool,
) -> Result<RewindCaptureSuspensionLease, String> {
    let state = app.state::<RewindCaptureSuspensionState>();
    let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;

    if runtime.leases.is_empty() {
        let sources = crate::screen_memory::rewind_clip_sources(&app);
        let conflicts = capture_conflicts(requires_screen, requires_microphone, &sources);
        let rewind_config = crate::config::feature_config(&app).screen_memory;
        // Enabled, unpaused Rewind may currently be stopped for a privacy
        // exclusion or transient producer transition. Lease the handoff based
        // on its durable ownership intent so its worker cannot resume halfway
        // through an ordinary recording.
        if !conflicts || !rewind_config.enabled || rewind_config.paused {
            return Ok(RewindCaptureSuspensionLease {
                lease_id: None,
                suspended_rewind: false,
            });
        }
        // Publish the reservation before entering the Screen Memory transition
        // lock. Config sync and temporary audio demand can then observe the
        // handoff without taking this module's mutex (avoiding lock inversion).
        SUSPENSION_ACTIVE.store(true, Ordering::Release);
        if let Err(error) = crate::screen_memory::suspend_physical_capture(&app) {
            SUSPENSION_ACTIVE.store(false, Ordering::Release);
            return Err(error);
        }
        runtime.suspended_rewind = true;
    }

    let lease_id = next_lease_id();
    runtime.leases.insert(lease_id.clone());
    Ok(RewindCaptureSuspensionLease {
        lease_id: Some(lease_id),
        suspended_rewind: runtime.suspended_rewind,
    })
}

/// Idempotent release: stale duplicate cleanup cannot resume Rewind while a
/// second logical owner still holds the physical capture handoff.
#[tauri::command]
pub async fn rewind_capture_suspension_release(
    app: AppHandle,
    lease_id: String,
) -> Result<(), String> {
    let should_resume = {
        let state = app.state::<RewindCaptureSuspensionState>();
        let mut runtime = state.inner.lock().map_err(|error| error.to_string())?;
        if !runtime.release_lease(lease_id.trim()) {
            return Ok(());
        }
        let should_resume = std::mem::take(&mut runtime.suspended_rewind);
        SUSPENSION_ACTIVE.store(false, Ordering::Release);
        should_resume
    };
    if should_resume {
        crate::screen_memory::resume_physical_capture(&app)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_capture_always_conflicts_with_rewind() {
        assert!(capture_conflicts(true, false, &[CaptureSource::Screen]));
    }

    #[test]
    fn camera_only_mic_conflicts_only_when_rewind_owns_the_mic() {
        assert!(!capture_conflicts(false, true, &[CaptureSource::Screen]));
        assert!(capture_conflicts(
            false,
            true,
            &[CaptureSource::Screen, CaptureSource::Microphone]
        ));
    }

    #[test]
    fn camera_without_mic_never_suspends_screen_memory() {
        assert!(!capture_conflicts(
            false,
            false,
            &[CaptureSource::Screen, CaptureSource::Microphone]
        ));
    }

    #[test]
    fn nested_leases_resume_only_after_the_final_unique_release() {
        let mut runtime = RewindCaptureSuspensionRuntime {
            leases: BTreeSet::from(["first".to_string(), "second".to_string()]),
            suspended_rewind: true,
        };

        assert!(!runtime.release_lease("first"));
        assert!(!runtime.release_lease("first"));
        assert!(runtime.release_lease("second"));
    }
}
