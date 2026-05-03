//! Floating recording indicator pill.
//!
//! A small floating window anchored ~16 px from the top-right of the primary
//! display. Always-on-top, transparent, no decorations, skip-taskbar, and
//! capture-excluded (`NSWindowSharingNone`) so it never appears in the user's
//! own screen recordings — even when they record a full display.
//!
//! Two visual modes (driven entirely from the React side via the URL hash):
//!
//!   - `meeting`  — meeting-aware pill with mic + speaker waveforms.
//!   - `clip`     — solid-mic pill for plain Clips screen-recording sessions.
//!
//! Three commands:
//!
//!   - `recording_pill_show(meeting_id?, mode)` — open at collapsed width.
//!   - `recording_pill_expand(expanded)`        — toggle to ~480 px wide so
//!     the live transcript stream fits.
//!   - `recording_pill_hide()`                  — destroy the window.

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder,
};

use crate::dlog;
use crate::util::{build_overlay_url, primary_monitor_physical_size, set_capture_excluded, show_without_activation};

const PILL_LABEL: &str = "recording-pill";

/// Logical px collapsed width / height. Translated to physical px below.
const PILL_W_LOGICAL: u32 = 280;
const PILL_W_EXPANDED_LOGICAL: u32 = 480;
const PILL_H_LOGICAL: u32 = 56;
const PILL_H_EXPANDED_LOGICAL: u32 = 320;
const PILL_MARGIN_LOGICAL: u32 = 16;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PillMode {
    Meeting,
    Clip,
}

impl Default for PillMode {
    fn default() -> Self {
        PillMode::Clip
    }
}

fn scale_factor(app: &AppHandle) -> f64 {
    app.get_webview_window("popover")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(2.0)
}

fn anchored_rect(app: &AppHandle, expanded: bool) -> (u32, u32, i32, i32) {
    let scale = scale_factor(app);
    let w_log = if expanded {
        PILL_W_EXPANDED_LOGICAL
    } else {
        PILL_W_LOGICAL
    };
    let h_log = if expanded {
        PILL_H_EXPANDED_LOGICAL
    } else {
        PILL_H_LOGICAL
    };
    let w = (w_log as f64 * scale) as u32;
    let h = (h_log as f64 * scale) as u32;
    let margin = (PILL_MARGIN_LOGICAL as f64 * scale) as i32;
    let (mw, _mh) = primary_monitor_physical_size(app).unwrap_or((2880, 1800));
    let x = (mw as i32 - w as i32 - margin).max(0);
    let y = margin;
    (w, h, x, y)
}

#[tauri::command]
pub async fn recording_pill_show(
    app: AppHandle,
    meeting_id: Option<String>,
    mode: Option<PillMode>,
) -> Result<(), String> {
    let mode = mode.unwrap_or_default();
    let mode_str = match mode {
        PillMode::Meeting => "meeting",
        PillMode::Clip => "clip",
    };
    dlog!(
        "[clips-tray] recording_pill_show mode={} meeting_id={:?}",
        mode_str,
        meeting_id
    );

    let (w, h, x, y) = anchored_rect(&app, false);

    if let Some(existing) = app.get_webview_window(PILL_LABEL) {
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
        // Re-emit so the React side picks up new meeting_id / mode.
        use tauri::Emitter;
        let _ = app.emit(
            "clips:pill-context",
            serde_json::json!({
                "meetingId": meeting_id,
                "mode": mode_str,
            }),
        );
        show_without_activation(&existing);
        return Ok(());
    }

    let url = build_overlay_url("recording-pill");
    let win = WebviewWindowBuilder::new(&app, PILL_LABEL, url)
        .title("Recording")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| {
            eprintln!("[clips-tray] recording-pill build failed: {}", e);
            e.to_string()
        })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    set_capture_excluded(&win);
    show_without_activation(&win);

    // Tell the freshly-mounted React side which mode + meeting_id to render.
    use tauri::Emitter;
    let _ = app.emit(
        "clips:pill-context",
        serde_json::json!({
            "meetingId": meeting_id,
            "mode": mode_str,
        }),
    );

    Ok(())
}

#[tauri::command]
pub async fn recording_pill_expand(app: AppHandle, expanded: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PILL_LABEL) else {
        return Ok(());
    };
    let (w, h, x, y) = anchored_rect(&app, expanded);
    let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    Ok(())
}

#[tauri::command]
pub async fn recording_pill_hide(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(PILL_LABEL) {
        let _ = w.close();
    }
    Ok(())
}
