
mod accessibility;
mod adhoc_meetings_watcher;
mod call_activity;
mod capture_audio_bus;
mod capture_graph;
mod clips;
mod config;
mod debug;
mod echo_guard;
mod eventkit;
mod logfile;
mod meetings_watcher;
mod mic_attribution;
mod native_screen;
mod native_speech;
mod notifications;
mod permission_status;
mod recording_indicator;
mod remote_flags;
mod rewind_capture_suspension;
mod rewind_chapters;
mod rewind_clip;
mod rewind_egress;
mod rewind_local_ask;
mod rewind_meeting_history;
mod screen_memory;
mod screen_memory_ocr;
mod screen_memory_transcript;
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

use std::time::Duration;

use tauri::{Emitter, Manager};

use clips::{position_popover, toggle_popover};
use state::{
    ActiveMeetingId, DictationActive, DictationEnabled, LastTranscript, MeetingActive,
    PopoverParked, PopoverShownAt, RecordingActive, SelectedRecordingDisplay,
    SelectedRecordingWindow, TrayAnchor, TrayMeetings, VoiceTargetBundle, VoiceTargetTextField,
    VoiceWakePopover,
};
use util::{
    configure_overlay_behavior, is_recording_active, present_interactive_window,
    restart_after_update, set_capture_excluded,
};

pub(crate) const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");

const POPOVER_BLUR_GUARD: Duration = Duration::from_millis(1500);
const POPOVER_BLUR_SETTLE: Duration = Duration::from_millis(100);

fn popover_blur_delay(elapsed: Duration, bubble_dragging: bool) -> Option<Duration> {
    if bubble_dragging {
        None
    } else if elapsed < POPOVER_BLUR_GUARD {
        Some(POPOVER_BLUR_GUARD - elapsed)
    } else {
        Some(POPOVER_BLUR_SETTLE)
    }
}

pub(crate) fn schedule_popover_dismissal(app_handle: &tauri::AppHandle) {
    if is_recording_active(app_handle) && clips::popover_is_parked(app_handle) {
        dlog!("[clips-tray] popover blur ignored — popover parked");
        return;
    }
    if !config::auto_hide_popover_enabled(app_handle) {
        dlog!("[clips-tray] popover blur ignored — auto-hide disabled");
        return;
    }
    let Some(handle) = app_handle.get_webview_window("popover") else {
        return;
    };
    let shown_at = app_handle
        .try_state::<PopoverShownAt>()
        .and_then(|s| s.0.lock().ok().and_then(|g| *g));
    let elapsed = shown_at.map(|t| t.elapsed()).unwrap_or(Duration::MAX);
    let Some(delay) = popover_blur_delay(elapsed, clips::is_bubble_dragging()) else {
        dlog!("[clips-tray] popover blur ignored — camera bubble drag active");
        return;
    };
    dlog!(
        "[clips-tray] popover blur, elapsed_ms={}",
        elapsed.as_millis()
    );
    let delayed_handle = handle.clone();
    let delayed_app_handle = (*app_handle).clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        let still_current = delayed_app_handle
            .try_state::<PopoverShownAt>()
            .and_then(|state| state.0.lock().ok().map(|guard| *guard == shown_at))
            .unwrap_or(false);
        if !still_current
            || clips::is_bubble_dragging()
            || (is_recording_active(&delayed_app_handle)
                && clips::popover_is_parked(&delayed_app_handle))
            || !config::auto_hide_popover_enabled(&delayed_app_handle)
            || delayed_handle.is_focused().unwrap_or(true)
        {
            return;
        }
        clips::hide_popover(&delayed_app_handle);
    });
}

fn present_popover(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("popover") {
        set_capture_excluded(&window);
        configure_overlay_behavior(&window);
        position_popover(app, &window);
        present_interactive_window(&window);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    sentry_report::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            present_popover(app);
        }))
        .on_window_event(|window, event| {
            if window.label() == "toolbar" {
                match event {
                    tauri::WindowEvent::Moved(position) => {
                        let _ = window.emit("clips:toolbar-native-moved", position);
                    }
                    tauri::WindowEvent::Destroyed => {
                        tray::reset_tray_recording(window.app_handle());
                    }
                    _ => {}
                }
            }
            if window.label() == "popover" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let app = window.app_handle();
                        clips::hide_popover(&app);
                    }
                    tauri::WindowEvent::Destroyed => {
                        clips::close_bubble_if_idle(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            clips::show_countdown,
            clips::finish_countdown_shortcuts,
            clips::show_preparing,
            clips::hide_preparing,
            clips::show_finalizing,
            clips::hide_finalizing,
            clips::show_toolbar,
            clips::toolbar_drag_start,
            clips::toolbar_drag_move,
            clips::toolbar_drag_end,
            clips::toolbar_set_bounds,
            clips::toolbar_save_position,
            clips::toolbar_get_dock_preference,
            clips::toolbar_set_visible,
            clips::set_toolbar_finishing,
            tray::tray_recording_status,
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
            clips::show_monitor_picker,
            clips::close_monitor_picker,
            clips::set_recording_display_override,
            clips::close_bubble,
            clips::show_popover,
            clips::park_popover_offscreen,
            clips::open_macos_privacy_settings,
            clips::choose_rewind_excluded_apps,
            clips::resolve_rewind_excluded_apps,
            clips::open_local_recording_folder,
            clips::request_macos_screen_recording_access,
            clips::resize_popover,
            clips::show_signin,
            clips::close_signin,
            clips::show_flow_bar,
            clips::hide_flow_bar,
            clips::complete_voice_dictation,
            clips::paste_last_dictation,
            clips::set_recording_state,
            clips::release_recording_state,
            clips::set_meeting_active,
            clips::get_active_meeting_id,
            clips::quit_teardown_done,
            clips::reset_state,
            clips::save_bubble_position,
            clips::bubble_drag_start,
            clips::bubble_drag_move,
            clips::bubble_drag_end,
            clips::set_bubble_size,
            clips::load_bubble_size,
            config::get_feature_config,
            config::set_feature_config,
            screen_memory::screen_memory_status,
            screen_memory::screen_memory_configure,
            screen_memory::screen_memory_start,
            screen_memory::screen_memory_pause,
            screen_memory::screen_memory_stop,
            screen_memory::screen_memory_delete,
            screen_memory::screen_memory_recent_segments,
            native_speech::native_speech_start,
            native_speech::native_speech_stop,
            native_speech::native_speech_cancel,
            native_speech::native_speech_set_vocabulary,
            native_speech::native_speech_request_permission,
            native_screen::native_fullscreen_recording_available,
            native_screen::show_window_picker,
            native_screen::cancel_native_window_picker,
            native_screen::native_fullscreen_take_upload_finished,
            native_screen::native_fullscreen_claim_upload_open,
            native_screen::native_fullscreen_prefetch_capture_content,
            native_screen::native_fullscreen_recording_warm,
            native_screen::native_fullscreen_recording_begin,
            native_screen::native_fullscreen_recording_stop_and_upload,
            native_screen::native_fullscreen_recording_stop_and_save,
            native_screen::native_fullscreen_recording_cancel,
            native_screen::native_fullscreen_recording_pause,
            native_screen::native_fullscreen_recording_resume,
            native_screen::native_fullscreen_recording_rotate_segment,
            native_screen::native_fullscreen_pending_uploads,
            native_screen::native_fullscreen_recover_orphaned_uploads,
            native_screen::native_fullscreen_recording_retry_upload,
            native_screen::native_fullscreen_recording_cancel_retry,
            native_screen::native_fullscreen_recording_mark_upload_error,
            native_screen::native_fullscreen_recording_clear_upload,
            native_screen::native_fullscreen_recording_dismiss_upload,
            native_screen::native_fullscreen_open_drafts_folder,
            screen_memory::screen_memory_query,
            screen_memory::screen_memory_delete_all,
            screen_memory::screen_memory_export_recent,
            screen_memory::screen_memory_open_folder,
            screen_memory::screen_memory_install_agent_connection,
            screen_memory::screen_memory_next_agent_handoff,
            screen_memory::screen_memory_update_agent_handoff,
            screen_memory::screen_memory_due_agent_handoffs,
            screen_memory::screen_memory_mark_agent_handoff_deleted,
            screen_memory::screen_memory_cancel_agent_handoff_cleanup,
            rewind_egress::rewind_prepare_evidence_egress,
            rewind_egress::rewind_complete_evidence_egress,
            rewind_egress::rewind_fail_evidence_egress,
            rewind_egress::rewind_list_evidence_egress,
            rewind_local_ask::rewind_local_ask,
            rewind_local_ask::rewind_replay_moment,
            rewind_meeting_history::rewind_meeting_history_status,
            rewind_meeting_history::rewind_meeting_history_prepare,
            rewind_meeting_history::rewind_meeting_history_collect,
            rewind_meeting_history::rewind_meeting_history_cancel,
            rewind_clip::rewind_clip_status,
            rewind_clip::rewind_clip_prepare,
            rewind_clip::rewind_clip_start,
            rewind_clip::rewind_clip_extend,
            rewind_clip::rewind_clip_pause,
            rewind_clip::rewind_clip_resume,
            rewind_clip::rewind_clip_stop_and_upload,
            rewind_clip::rewind_clip_stop_and_save,
            rewind_clip::rewind_clip_cancel,
            rewind_clip::rewind_agent_handoff_upload,
            rewind_clip::rewind_agent_handoff_preview,
            rewind_capture_suspension::rewind_capture_suspension_acquire,
            rewind_capture_suspension::rewind_capture_suspension_release,
            recording_indicator::recording_pill_prewarm,
            recording_indicator::recording_pill_show,
            recording_indicator::recording_pill_expand,
            recording_indicator::recording_pill_hide,
            recording_indicator::recording_pill_save_position,
            recording_indicator::recording_pill_save_expanded_size,
            recording_indicator::recording_pill_set_detached,
            notifications::take_pending_meeting_notification,
            notifications::notify_meeting_starting,
            notifications::dismiss_meeting_notification,
            meetings_watcher::meetings_watcher_set_server_url,
            meetings_watcher::meetings_watcher_set_session,
            meetings_watcher::meetings_watcher_set_lab_enabled,
            meetings_watcher::meetings_snooze,
            eventkit::eventkit_request_access,
            eventkit::eventkit_list_events,
            accessibility::active_window_context,
            accessibility::read_focused_field_text,
            accessibility::accessibility_check_permission,
            accessibility::accessibility_request_permission,
            system_audio::system_audio_request_permission,
            system_audio::system_audio_version_status,
            system_audio::system_audio_open_privacy_settings,
            system_audio::audio_transcription_start,
            system_audio::audio_transcription_stop,
            system_audio::audio_transcription_reset_timeline,
            silence_detector::silence_detector_start,
            silence_detector::silence_detector_stop,
            shortcuts::set_custom_shortcuts,
            shortcuts::set_fn_shortcut_enabled,
            shortcuts::set_dictation_escape_active,
            whisper_model::whisper_models,
            whisper_model::whisper_model_status,
            whisper_model::whisper_model_download,
            whisper_model::whisper_downloaded_models,
            whisper_model::whisper_model_delete,
            permission_status::check_permission_statuses,
            logfile::frontend_log,
            logfile::open_logs,
            restart_after_update,
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Clips")
                .args(["--autostart"])
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(shortcuts::build_shortcut_plugin().build())
        .manage(TrayAnchor::default())
        .manage(TrayMeetings::default())
        .manage(PopoverShownAt::default())
        .manage(PopoverParked::default())
        .manage(RecordingActive::default())
        .manage(MeetingActive::default())
        .manage(ActiveMeetingId::default())
        .manage(DictationEnabled::default())
        .manage(DictationActive::default())
        .manage(VoiceWakePopover::default())
        .manage(VoiceTargetBundle::default())
        .manage(VoiceTargetTextField::default())
        .manage(LastTranscript::default())
        .manage(SelectedRecordingDisplay::default())
        .manage(SelectedRecordingWindow::default())
        .manage(native_screen::NativeFullscreenRecordingState::default())
        .manage(screen_memory::ScreenMemoryState::default())
        .manage(capture_graph::CaptureGraphState::default())
        .manage(rewind_clip::RewindClipState::default())
        .manage(rewind_meeting_history::RewindMeetingHistoryState::default())
        .manage(rewind_capture_suspension::RewindCaptureSuspensionState::default())
        .manage(meetings_watcher::MeetingsWatcherState::default())
        .manage(adhoc_meetings_watcher::AdhocMeetingsWatcherState::default())
        .manage(notifications::MeetingNotificationState::default())
        .manage(silence_detector::DetectorState::default())
        .setup(|app| {
            logfile::init(app.handle());

            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            util::build_popover_window(app).map_err(|err| {
                eprintln!("[clips-tray] popover build failed: {err}");
                err
            })?;

            tauri::async_runtime::spawn(async {
                if let Err(err) = native_screen::native_fullscreen_prefetch_capture_content().await
                {
                    eprintln!("[clips-tray] startup capture prefetch failed: {err}");
                }
            });

            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let dl_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                    dlog!("[clips-tray] deep link opened: {:?}", urls);
                    present_popover(&dl_handle);
                    let _ = dl_handle.emit("clips:deep-link", urls);
                });
                #[cfg(any(windows, target_os = "linux"))]
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("[clips-tray] deep link register_all failed: {err}");
                }
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let url_strings: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
                    dlog!("[clips-tray] deep link cold start: {:?}", url_strings);
                    present_popover(app.handle());
                    let _ = app.handle().emit("clips:deep-link", url_strings);
                }
            }

            if let Err(err) = notifications::show_meeting_notification_window(app.handle()) {
                println!("[clips-tray] show meeting notification failed: {err}");
            }

            tray::build_tray(app)?;
            config::sync_launch_at_login(app.handle());
            let feature_config = config::feature_config(app.handle());
            screen_memory::sync_from_config(app.handle(), &feature_config);
            clips::reconcile_region_guides(app.handle());
            shortcuts::register_shortcuts(app)?;
            shortcuts::install_countdown_local_key_monitor(app);
            shortcuts::install_popover_dismiss_handler(app);

            meetings_watcher::spawn_watcher(app.handle().clone());
            adhoc_meetings_watcher::spawn_watcher(app.handle().clone());
            notifications::watch_meeting_notification_acks(app.handle());
            remote_flags::spawn_watcher(app.handle().clone());

            #[cfg(target_os = "macos")]
            {
                let cfg = config::feature_config(app.handle());
                if cfg.whisper_model_enabled && !whisper_model::custom_model_override() {
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        match whisper_model::ensure_model(&app_handle).await {
                            Ok(_) => {
                                let _ = app_handle.emit("whisper:model-ready", ());
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

            if let Some(window) = app.get_webview_window("popover") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        schedule_popover_dismissal(&app_handle);
                    }
                });
            }

            let launched_at_login = std::env::args().any(|arg| arg == "--autostart");
            if !launched_at_login {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    for _ in 0..8 {
                        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                        if tray::refresh_tray_anchor(&app_handle) {
                            break;
                        }
                    }
                    clips::force_show_popover(&app_handle);
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if is_recording_active(_app_handle) && clips::popover_is_parked(_app_handle) {
                    clips::force_show_popover(_app_handle);
                } else {
                    toggle_popover(_app_handle);
                }
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = &_event {
                let meeting_active = _app_handle
                    .try_state::<MeetingActive>()
                    .and_then(|s| s.0.lock().ok().map(|g| *g))
                    .unwrap_or(false);
                let teardown_state =
                    clips::QUIT_TEARDOWN_STATE.load(std::sync::atomic::Ordering::SeqCst);
                if meeting_active && teardown_state == 0 {
                    clips::QUIT_TEARDOWN_STATE.store(1, std::sync::atomic::Ordering::SeqCst);
                    api.prevent_exit();
                    let _ = _app_handle.emit("meetings:quit-requested", ());
                    let watchdog_handle = _app_handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
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
            if let tauri::RunEvent::Exit = _event {
                whisper_speech::shutdown(_app_handle);
                native_speech::shutdown();
                let state = _app_handle.state::<native_screen::NativeFullscreenRecordingState>();
                native_screen::kill_active_screencapture_child(&state);
                mic_attribution::shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{popover_blur_delay, POPOVER_BLUR_GUARD, POPOVER_BLUR_SETTLE};
    use std::time::Duration;

    #[test]
    fn retries_blur_until_guard_expires() {
        assert_eq!(
            popover_blur_delay(Duration::from_millis(400), false),
            Some(Duration::from_millis(1100))
        );
        assert_eq!(
            popover_blur_delay(POPOVER_BLUR_GUARD, false),
            Some(POPOVER_BLUR_SETTLE)
        );
        assert_eq!(popover_blur_delay(Duration::MAX, true), None);
    }
}
