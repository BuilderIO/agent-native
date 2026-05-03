use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::clips::toggle_popover;
use crate::dlog;
use crate::state::TrayAnchor;
use crate::tray_meetings::{build_meetings_section, handle_meeting_menu_click};
use crate::util::is_recording_active;
use crate::TRAY_PNG;

pub fn build_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Upcoming meetings section. The watcher refreshes on its own; we ship
    // the menu with an empty placeholder which the meetings_watcher (or the
    // frontend) can replace on the fly via `tray.set_menu()` when it has
    // fresh data. Building it here keeps the menu structure stable.
    let meetings_submenu = build_meetings_section(&app.handle(), Vec::new())?;

    // Simple tray menu — right-click reveals it.
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

    // Load the tray icon from embedded bytes so the binary is
    // self-contained. `icons/tray.png` ships with the source and is
    // the placeholder users replace with their real icon.
    let tray_icon = tauri::image::Image::from_bytes(TRAY_PNG)?;

    eprintln!(
        "[clips-tray] building tray icon from {} bytes",
        TRAY_PNG.len()
    );
    let _tray = TrayIconBuilder::with_id("main")
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
            // Remember the icon's rect so the popover can anchor
            // directly beneath it. Every tray event carries a fresh
            // rect — even hover/move — so the anchor stays current
            // even if the user drags menu-bar items around.
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
                    // Loom-style: tray click while recording stops it.
                    let _ = app.emit("clips:recorder-stop", ());
                } else {
                    toggle_popover(app);
                }
            }
        })
        .build(app)?;
    eprintln!("[clips-tray] tray built — should be visible in menu bar");
    // Persist the tray so it isn't dropped at the end of setup.
    app.manage(_tray);

    Ok(())
}
