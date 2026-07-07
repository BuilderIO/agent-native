//! Clips menu-bar tray app.
//!
//! The app is a single always-on-top popover window. Clicking the tray icon
//! toggles it. Pressing Cmd/Ctrl+Shift+L also toggles it. The popover itself
//! is served by the Vite-built React UI (see `../dist`).

mod accessibility;
mod clips;
mod config;
mod debug;
mod eventkit;
mod logfile;
mod meetings_watcher;
mod native_screen;
mod native_speech;
mod notifications;
mod permission_status;
mod recording_indicator;
mod screen_memory;
mod sentry_report;
mod shortcuts;
mod silence_detector;
mod state;
mod system_audio;
mod tray;
mod tray_meetings;
mod util;
mod whisper_model;
mod whisper_speech;

use tauri::{Emitter, Manager};

use clips::{position_popover, toggle_popover};
use state::{
    DictationActive, DictationEnabled, LastTranscript, MeetingActive, PopoverShownAt,
    RecordingActive, TrayAnchor, TrayMeetings, VoiceTargetBundle, VoiceWakePopover,
};
use util::{
    configure_overlay_behavior, is_recording_active, present_interactive_window,
    set_capture_included,
};

// Embedded fallback icon — a tiny 16x16 solid purple PNG so the binary always
// has *something* to display even if `icons/tray.png` is missing on disk. The
// `tauri.conf.json` tray config points at `icons/tray.png`, which the user
// should replace with their real icon.
pub(crate) const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    sentry_report::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch just focuses the popover of the already-running
            // instance. Prevents the "two tray icons" UX where clicks fight
            // over focus and neither popover shows.
            if let Some(window) = app.get_webview_window("popover") {
                set_capture_included(&window);
                configure_overlay_behavior(&window);
                position_popover(app, &window);
                present_interactive_window(&window);
            }
        }))
        .invoke_handler(tauri::generate_handler![
            // clips commands
            clips::show_countdown,
            clips::show_finalizing,
            clips::hide_finalizing,
            clips::show_toolbar,
            clips::show_bubble,
            clips::set_bubble_capture_excluded,
            clips::hide_overlays,
            clips::hide_recording_chrome,
            clips::show_region_guides,
            clips::hide_region_guides,
            clips::show_region_record_border,
            clips::hide_region_record_border,
            clips::show_region_guide_editor,
            clips::show_region_capture_selector,
            clips::close_bubble,
            clips::show_popover,
            clips::park_popover_offscreen,
            clips::open_macos_privacy_settings,
            clips::open_local_recording_folder,
            clips::request_macos_screen_recording_access,
            clips::resize_popover,
            clips::show_signin,
            clips::close_signin,
            clips::show_flow_bar,
            clips::hide_flow_bar,
            clips::hide_onboarding_window,
            clips::complete_voice_dictation,
            clips::paste_last_dictation,
            clips::set_recording_state,
            clips::set_meeting_active,
            clips::quit_teardown_done,
            clips::reset_state,
            clips::save_bubble_position,
            clips::bubble_drag_start,
            clips::bubble_drag_move,
            clips::bubble_drag_end,
            clips::set_bubble_size,
            clips::load_bubble_size,
            // config commands
            config::get_feature_config,
            config::set_feature_config,
            // local-only Screen Memory backend
            screen_memory::screen_memory_status,
            screen_memory::screen_memory_configure,
            screen_memory::screen_memory_start,
            screen_memory::screen_memory_pause,
            screen_memory::screen_memory_stop,
            screen_memory::screen_memory_delete,
            screen_memory::screen_memory_recent_segments,
            // native macOS speech recognition (no-op stubs on other OSes)
            native_speech::native_speech_start,
            native_speech::native_speech_stop,
            native_speech::native_speech_cancel,
            native_speech::native_speech_set_vocabulary,
            native_speech::native_speech_request_permission,
            // native full-screen recording (macOS screencapture, no picker)
            native_screen::native_fullscreen_recording_available,
            native_screen::native_fullscreen_take_upload_finished,
            native_screen::native_fullscreen_claim_upload_open,
            native_screen::native_fullscreen_recording_warm,
            native_screen::native_fullscreen_recording_begin,
            native_screen::native_fullscreen_capture_thumbnail,
            native_screen::native_fullscreen_recording_stop_and_upload,
            native_screen::native_fullscreen_recording_stop_and_save,
            native_screen::native_fullscreen_recording_cancel,
            native_screen::native_fullscreen_recording_pause,
            native_screen::native_fullscreen_recording_resume,
            native_screen::native_fullscreen_recording_rotate_segment,
            native_screen::native_fullscreen_pending_uploads,
            native_screen::native_fullscreen_recording_retry_upload,
            native_screen::native_fullscreen_recording_discard_upload,
            // local-only always-on screen memory compatibility helpers
            screen_memory::screen_memory_query,
            screen_memory::screen_memory_delete_all,
            screen_memory::screen_memory_export_recent,
            screen_memory::screen_memory_open_folder,
            // recording indicator pill
            recording_indicator::recording_pill_show,
            recording_indicator::recording_pill_expand,
            recording_indicator::recording_pill_hide,
            recording_indicator::recording_pill_save_position,
            recording_indicator::recording_pill_set_detached,
            // notifications
            notifications::take_pending_meeting_notification,
            notifications::notify_meeting_starting,
            // meetings watcher (background poller)
            meetings_watcher::meetings_watcher_set_server_url,
            meetings_watcher::meetings_watcher_set_session,
            meetings_watcher::meetings_snooze,
            // EventKit (iCloud calendar)
            eventkit::eventkit_request_access,
            eventkit::eventkit_list_events,
            // Accessibility (read focused field text for personal-vocabulary auto-learn)
            accessibility::active_window_context,
            accessibility::read_focused_field_text,
            accessibility::accessibility_check_permission,
            accessibility::accessibility_request_permission,
            // system audio (ScreenCaptureKit — see system_audio.rs)
            system_audio::system_audio_request_permission,
            system_audio::system_audio_version_status,
            system_audio::system_audio_open_privacy_settings,
            system_audio::audio_transcription_start,
            system_audio::audio_transcription_stop,
            system_audio::audio_transcription_reset_timeline,
            // silence detector — Granola-style auto-stop heuristics
            silence_detector::silence_detector_start,
            silence_detector::silence_detector_stop,
            // custom global shortcuts configured from Settings
            shortcuts::set_custom_shortcuts,
            shortcuts::set_fn_shortcut_enabled,
            shortcuts::set_dictation_escape_active,
            // whisper model management
            whisper_model::whisper_model_status,
            whisper_model::whisper_model_download,
            // permission status (silent checks for all TCC permissions)
            permission_status::check_permission_statuses,
            // persistent log file (production debugging)
            logfile::frontend_log,
            logfile::open_logs,
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Clips")
                // Tag login-launched processes so startup can stay quiet in the
                // tray, while a manual launch auto-opens the popover.
                .args(["--autostart"])
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(shortcuts::build_shortcut_plugin().build())
        .manage(TrayAnchor::default())
        .manage(TrayMeetings::default())
        .manage(PopoverShownAt::default())
        .manage(RecordingActive::default())
        .manage(MeetingActive::default())
        .manage(DictationEnabled::default())
        .manage(DictationActive::default())
        .manage(VoiceWakePopover::default())
        .manage(VoiceTargetBundle::default())
        .manage(LastTranscript::default())
        .manage(native_screen::NativeFullscreenRecordingState::default())
        .manage(screen_memory::ScreenMemoryState::default())
        .manage(meetings_watcher::MeetingsWatcherState::default())
        .manage(notifications::MeetingNotificationState::default())
        .manage(silence_detector::DetectorState::default())
        .setup(|app| {
            // Capture stdout/stderr to a persistent log file before anything
            // else runs so startup errors and panics land on disk too.
            logfile::init(app.handle());

            // Keeps the app from yanking the user out of fullscreen when the
            // popover appears. Production bundles reinforce this with LSUIElement=1.
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            util::build_popover_window(app).map_err(|err| {
                eprintln!("[clips-tray] popover build failed: {err}");
                err
            })?;

            if let Err(err) = notifications::show_meeting_notification_window(app.handle()) {
                println!("[clips-tray] show meeting notification failed: {err}");
            }

            tray::build_tray(app)?;
            config::sync_launch_at_login(app.handle());
            let feature_config = config::feature_config(app.handle());
            // ONBOARD-WINDOW: first-run onboarding never had a Rust-side
            // window to appear in — the `#onboarding` hash route and overlay
            // component existed, but nothing ever called
            // WebviewWindowBuilder for it. Build it here, after the popover
            // exists, gated on the persisted `onboarding_complete` flag so
            // returning users never see it again.
            if !feature_config.onboarding_complete {
                clips::show_onboarding_window(app.handle());
            }
            screen_memory::sync_from_config(app.handle(), &feature_config);
            // Re-show always-on region guides after relaunch/reboot when the
            // setting is on (no-op if a recording owns the window or the
            // toggle is off).
            clips::reconcile_region_guides(app.handle());
            shortcuts::register_shortcuts(app)?;
            shortcuts::install_popover_dismiss_handler(app);
            shortcuts::install_countdown_shortcut_handler(app);

            // Spawn the upcoming-meetings poller. Idempotent — gated by a
            // OnceLock inside `spawn_watcher`. The frontend wires the
            // server URL via `meetings_watcher_set_server_url` once the
            // popover boots.
            meetings_watcher::spawn_watcher(app.handle().clone());

            // Pre-download the Whisper model in the background so the first
            // meeting doesn't pay the ~142 MB download cost mid-call. Skipped
            // when the user has disabled the model in Settings.
            #[cfg(target_os = "macos")]
            {
                let cfg = config::feature_config(app.handle());
                if cfg.whisper_model_enabled && !whisper_model::custom_model_override() {
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        match whisper_model::ensure_model(&app_handle).await {
                            Ok(_) => {
                                let _ = app_handle.emit("whisper:model-ready", ());
                                // Warm the in-memory whisper context now, off
                                // the recording-start path, so the first
                                // recording doesn't block ~hundreds of ms
                                // loading the model into memory. Blocking work
                                // → spawn_blocking
                                let warm_handle = app_handle.clone();
                                let _ = tauri::async_runtime::spawn_blocking(move || {
                                    match whisper_speech::prewarm_context(&warm_handle) {
                                        Ok(_) => {
                                            println!(
                                                "[clips-tray] whisper context prewarm finished"
                                            );
                                            let _ = warm_handle.emit("whisper:context-ready", ());
                                        }
                                        Err(e) => {
                                            eprintln!(
                                                "[clips-tray] whisper context prewarm failed: {e}"
                                            );
                                            let _ = warm_handle.emit(
                                                "whisper:context-error",
                                                serde_json::json!({ "error": e }),
                                            );
                                        }
                                    }
                                })
                                .await;
                            }
                            Err(e) => {
                                eprintln!("[clips-tray] startup model download failed: {e}");
                                let _ = app_handle
                                    .emit("whisper:model-error", serde_json::json!({ "error": e }));
                            }
                        }
                    });
                }
            }

            // Hide the popover on blur so it feels like a real menu-bar popover.
            // The 250ms guard is the important bit — during the tray-click
            // itself macOS briefly steals focus from the popover, which would
            // fire Focused(false) and hide the window we literally just showed.
            if let Some(window) = app.get_webview_window("popover") {
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
                        if !config::auto_hide_popover_enabled(&app_handle) {
                            dlog!("[clips-tray] popover blur ignored — auto-hide disabled");
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

            // Auto-open the popover on a manual launch so the app doesn't sit
            // silently in the tray waiting for a click. Skipped when launched at
            // login (tagged with `--autostart`) so it doesn't pop up every boot.
            let launched_at_login = std::env::args().any(|arg| arg == "--autostart");
            if !launched_at_login {
                toggle_popover(app.handle());
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
            // `app.exit()` (tray Quit, Cmd+Q, OS shutdown) delivers
            // `ExitRequested` first, then `Exit` unless prevented. A live
            // meeting session lives entirely in JS/React state
            // (`useMeetingTranscription`) that Rust has no direct access to,
            // so if a meeting is active we briefly hold the process open and
            // let the popover webview run its normal stop/flush/finalize
            // path before actually exiting — otherwise the last ~1.5s of
            // transcript is lost and the recording is stuck "uploading"
            // forever (nothing else ever stamps `meetings.actualEnd`).
            if let tauri::RunEvent::ExitRequested { api, .. } = &_event {
                let meeting_active = _app_handle
                    .try_state::<MeetingActive>()
                    .and_then(|s| s.0.lock().ok().map(|g| *g))
                    .unwrap_or(false);
                let teardown_state =
                    clips::QUIT_TEARDOWN_STATE.load(std::sync::atomic::Ordering::SeqCst);
                // Gate on MeetingActive so quitting with no active meeting
                // stays instant — zero added latency, no event emitted, no
                // watchdog spawned. teardown_state != 0 means either the
                // teardown handshake is already underway (first pass already
                // ran) or already done (the watchdog's own forced exit —
                // must NOT prevent_exit again, or quit would hang forever).
                if meeting_active && teardown_state == 0 {
                    clips::QUIT_TEARDOWN_STATE.store(1, std::sync::atomic::Ordering::SeqCst);
                    api.prevent_exit();
                    let _ = _app_handle.emit("meetings:quit-requested", ());
                    let watchdog_handle = _app_handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        // If the JS side never called `quit_teardown_done`
                        // (dead webview, hung network call, etc.) force the
                        // exit anyway — quit must never hang indefinitely.
                        // compare_exchange (not load-then-store) so this
                        // watchdog and a concurrent `quit_teardown_done` call
                        // can't both observe state==1, both transition to 2,
                        // and both call app.exit(); only whichever wins the
                        // CAS proceeds.
                        if clips::QUIT_TEARDOWN_STATE
                            .compare_exchange(
                                1,
                                2,
                                std::sync::atomic::Ordering::SeqCst,
                                std::sync::atomic::Ordering::SeqCst,
                            )
                            .is_ok()
                        {
                            eprintln!(
                                "[clips-tray] quit-teardown watchdog fired — forcing exit after 3s"
                            );
                            watchdog_handle.exit(0);
                        }
                    });
                }
            }
            // The app is quitting (tray Quit, Cmd+Q, or OS shutdown). `Exit`
            // fires just before the process actually terminates, which
            // otherwise skips Rust destructors — make sure a live
            // `screencapture` fallback child doesn't survive us.
            if let tauri::RunEvent::Exit = _event {
                let state = _app_handle.state::<native_screen::NativeFullscreenRecordingState>();
                native_screen::kill_active_screencapture_child(&state);
            }
        });
}
