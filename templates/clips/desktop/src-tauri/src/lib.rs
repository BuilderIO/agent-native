//! Clips menu-bar tray app.
//!
//! The app is a single always-on-top popover window. Clicking the tray icon
//! toggles it. Pressing Cmd/Ctrl+Shift+L also toggles it. The popover itself
//! is served by the Vite-built React UI (see `../dist`).

mod clips;
mod config;
mod debug;
#[cfg(target_os = "macos")]
mod native_speech;
mod shortcuts;
mod state;
mod tray;
mod util;

use tauri::{Emitter, Manager};

use clips::{position_popover, toggle_popover};
use state::{
    DictationActive, DictationEnabled, LastTranscript, MeetingActive, PopoverShownAt,
    RecordingActive, TrayAnchor, VoiceWakePopover,
};
use util::{is_recording_active, set_capture_excluded};

// Embedded fallback icon — a tiny 16x16 solid purple PNG so the binary always
// has *something* to display even if `icons/tray.png` is missing on disk. The
// `tauri.conf.json` tray config points at `icons/tray.png`, which the user
// should replace with their real icon.
pub(crate) const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch just focuses the popover of the already-running
            // instance. Prevents the "two tray icons" UX where clicks fight
            // over focus and neither popover shows.
            if let Some(window) = app.get_webview_window("popover") {
                position_popover(app, &window);
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            // clips commands
            clips::show_countdown,
            clips::show_finalizing,
            clips::hide_finalizing,
            clips::show_toolbar,
            clips::show_bubble,
            clips::hide_overlays,
            clips::hide_recording_chrome,
            clips::close_bubble,
            clips::show_popover,
            clips::park_popover_offscreen,
            clips::resize_popover,
            clips::show_signin,
            clips::close_signin,
            clips::show_flow_bar,
            clips::hide_flow_bar,
            clips::complete_voice_dictation,
            clips::set_recording_state,
            clips::reset_state,
            clips::save_bubble_position,
            clips::set_bubble_size,
            clips::load_bubble_size,
            // config commands
            config::get_feature_config,
            config::set_feature_config,
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(shortcuts::build_shortcut_plugin().build())
        .manage(TrayAnchor::default())
        .manage(PopoverShownAt::default())
        .manage(RecordingActive::default())
        .manage(MeetingActive::default())
        .manage(DictationEnabled::default())
        .manage(DictationActive::default())
        .manage(VoiceWakePopover::default())
        .manage(LastTranscript::default())
        .setup(|app| {
            // NOTE: we intentionally do NOT call set_activation_policy(Accessory)
            // in dev here. In unbundled dev runs, Accessory mode sometimes
            // prevents the tray icon from registering in the macOS menu bar at
            // all. Production builds (.app bundle) ship with LSUIElement=1 in
            // Info.plist, which is the proper way to get pure menu-bar behavior.
            #[cfg(all(target_os = "macos", not(debug_assertions)))]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            tray::build_tray(app)?;
            shortcuts::register_shortcuts(app)?;
            shortcuts::install_popover_dismiss_handler(app);

            // Hide the popover on blur so it feels like a real menu-bar popover.
            // The 250ms guard is the important bit — during the tray-click
            // itself macOS briefly steals focus from the popover, which would
            // fire Focused(false) and hide the window we literally just showed.
            if let Some(window) = app.get_webview_window("popover") {
                // Exclude the popover from screen recordings and from the macOS
                // screen / window picker. See `set_capture_excluded` docs. This
                // is what lets us keep the popover visible (and its JS alive)
                // during `getDisplayMedia` without the popover leaking into the
                // recorded video.
                set_capture_excluded(&window);
                let handle = window.clone();
                let app_handle = app.handle().clone();
                // NOTE: Intentionally NOT calling window.open_devtools()
                // here. An auto-opened devtools window steals focus from
                // the popover on every render, which flaps onFocusChanged
                // constantly and creates an infinite show_bubble/hide loop
                // in the React effect. Users can right-click -> Inspect
                // Element if they need devtools.
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        // Don't auto-hide while a recording is active or
                        // mid-setup — the macOS screen-picker, devtools,
                        // and other transient windows all steal focus
                        // from the popover during that flow. Hiding
                        // would also kill the RecordingRow UI the user
                        // is relying on to stop.
                        if is_recording_active(&app_handle) {
                            dlog!("[clips-tray] popover blur ignored — recording active");
                            return;
                        }
                        let shown_at = app_handle
                            .try_state::<PopoverShownAt>()
                            .and_then(|s| s.0.lock().ok().and_then(|g| *g));
                        let elapsed_ms = shown_at
                            .map(|t| t.elapsed().as_millis())
                            .unwrap_or(u128::MAX);
                        dlog!("[clips-tray] popover blur, elapsed_ms={}", elapsed_ms);
                        if elapsed_ms >= 1500 {
                            let _ = handle.hide();
                            let _ = app_handle.emit("clips:popover-visible", false);
                        }
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // macOS: clicking the Dock icon ("reopen") toggles the popover.
            // Reopen is macOS-only — gated behind cfg so Windows compiles.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                toggle_popover(_app_handle);
            }
        });
}
