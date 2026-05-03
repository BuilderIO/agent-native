use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager,
};

use crate::clips::toggle_popover;
use crate::dlog;
use crate::state::TrayAnchor;
use crate::tray_meetings::{build_meetings_section, handle_meeting_menu_click, MeetingItem};
use crate::util::is_recording_active;
use crate::TRAY_PNG;

/// Build the full tray menu with the given upcoming-meetings list. Used both
/// at startup (with `Vec::new()`) and at refresh time when the meetings
/// watcher pushes a new snapshot — `TrayIcon::set_menu(Some(...))` swaps the
/// menu atomically.
fn build_menu_with_meetings(
    app: &tauri::AppHandle,
    meetings: Vec<MeetingItem>,
) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let meetings_submenu = build_meetings_section(app, meetings)?;
    let show_item = MenuItem::with_id(app, "show", "Show popover", true, None::<&str>)?;
    let devtools_item =
        MenuItem::with_id(app, "devtools", "Toggle DevTools", true, Some("Cmd+Alt+I"))?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Clips", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &meetings_submenu,
            &separator,
            &show_item,
            &devtools_item,
            &quit_item,
        ],
    )?;
    Ok(menu)
}

pub fn build_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Initial build with an empty meetings list — the watcher will push real
    // data via the `meetings:updated` event below and we'll rebuild then.
    let menu = build_menu_with_meetings(app.handle(), Vec::new())?;

    // Load the tray icon from embedded bytes so the binary is self-contained.
    let tray_icon = tauri::image::Image::from_bytes(TRAY_PNG)?;

    eprintln!(
        "[clips-tray] building tray icon from {} bytes",
        TRAY_PNG.len()
    );
    let tray = TrayIconBuilder::with_id("main")
        .tooltip("Clips")
        .menu(&menu)
        .icon(tray_icon)
        .icon_as_template(true)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id_ref = event.id.as_ref();
            // Meeting click → open popover + emit `meetings:open`.
            if handle_meeting_menu_click(app, id_ref) {
                return;
            }
            match id_ref {
            "show" => toggle_popover(app),
            "devtools" => {
                #[cfg(debug_assertions)]
                {
                    if let Some(w) = app.get_webview_window("popover") {
                        if w.is_devtools_open() {
                            w.close_devtools();
                        } else {
                            w.open_devtools();
                        }
                    }
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Remember the icon's rect so the popover can anchor below it.
            let rect = match &event {
                TrayIconEvent::Click { rect, .. }
                | TrayIconEvent::DoubleClick { rect, .. }
                | TrayIconEvent::Enter { rect, .. }
                | TrayIconEvent::Move { rect, .. }
                | TrayIconEvent::Leave { rect, .. } => Some(*rect),
                _ => None,
            };
            if let Some(rect) = rect {
                let app = tray.app_handle();
                if let Some(anchor) = app.try_state::<TrayAnchor>() {
                    if let Ok(mut g) = anchor.0.lock() {
                        *g = Some(rect);
                    }
                }
            }

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let active = is_recording_active(app);
                dlog!("[clips-tray] tray click — is_recording_active={}", active);
                if active {
                    let _ = app.emit("clips:recorder-stop", ());
                } else {
                    toggle_popover(app);
                }
            }
        })
        .build(app)?;
    eprintln!("[clips-tray] tray built — should be visible in menu bar");
    // Persist the tray so it isn't dropped at the end of setup.
    app.manage(tray);

    // Listen for meetings:updated and rebuild the menu live. Uses
    // `tray_by_id("main")` to fetch the persisted handle from the
    // resource table. `set_menu` is atomic — replacing the entire menu
    // is the documented Tauri 2 way to update a tray (there's no
    // partial-update API for items).
    let app_handle = app.handle().clone();
    app.handle()
        .listen("meetings:updated", move |event| {
            #[derive(serde::Deserialize)]
            struct Payload {
                #[serde(default)]
                meetings: Vec<MeetingItem>,
            }
            let parsed: Payload = match serde_json::from_str(event.payload()) {
                Ok(p) => p,
                Err(err) => {
                    eprintln!("[clips-tray] meetings:updated parse failed: {err}");
                    return;
                }
            };
            let app = app_handle.clone();
            // Tauri 2 menu APIs are main-thread-only on macOS; hop back via
            // run_on_main_thread before touching the tray.
            let _ = app_handle.run_on_main_thread(move || {
                let new_menu = match build_menu_with_meetings(&app, parsed.meetings) {
                    Ok(m) => m,
                    Err(err) => {
                        eprintln!("[clips-tray] rebuild menu failed: {err}");
                        return;
                    }
                };
                if let Some(tray) = app.tray_by_id("main") {
                    if let Err(err) = tray.set_menu(Some(new_menu)) {
                        eprintln!("[clips-tray] set_menu failed: {err}");
                    } else {
                        dlog!("[clips-tray] tray menu rebuilt with fresh meetings");
                    }
                }
            });
        });

    Ok(())
}
