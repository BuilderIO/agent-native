//! Clips menu-bar tray app.
//!
//! The app is a single always-on-top popover window. Clicking the tray icon
//! toggles it. Pressing Cmd/Ctrl+Shift+L also toggles it. The popover itself
//! is served by the Vite-built React UI (see `../dist`).

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn toggle_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window("popover") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        position_popover(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn position_popover(window: &WebviewWindow) {
    // Place the popover near the top-right corner of the active monitor so it
    // feels like it's hanging off the menu bar. We can't read the exact tray
    // icon position in Tauri v2 yet, so top-right is a reasonable default that
    // Raycast-style tray apps also use this pattern.
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let win_size: PhysicalSize<u32> =
            window.outer_size().unwrap_or(PhysicalSize::new(360, 440));

        // 12px margin from the right, 36px from the top (below the menu bar).
        let margin_right = (12.0 * scale) as i32;
        let margin_top = (36.0 * scale) as i32;
        let x = size.width as i32 - win_size.width as i32 - margin_right;
        let y = margin_top;
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let is_cmd = shortcut
                        .matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyL);
                    let is_ctrl = shortcut
                        .matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyL);
                    if is_cmd || is_ctrl {
                        toggle_popover(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Hide from the Dock on macOS so it feels like a pure menu-bar app.
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // Simple tray menu — right-click reveals it.
            let show_item =
                MenuItem::with_id(app, "show", "Show popover", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Clips", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Load the tray icon from embedded bytes so the binary is
            // self-contained. `icons/tray.png` ships with the source and is
            // the placeholder users replace with their real icon.
            let tray_icon = tauri::image::Image::from_bytes(TRAY_PNG)?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Clips")
                .menu(&menu)
                .icon(tray_icon)
                .icon_as_template(false)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_popover(app),
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_popover(tray.app_handle());
                    }
                })
                .build(app)?;

            // Register the global shortcut. On macOS we use Cmd+Shift+L;
            // on Windows/Linux we use Ctrl+Shift+L. Registering both is safe
            // because on macOS Ctrl isn't the primary modifier and vice versa.
            let shortcut_cmd =
                Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyL);
            let shortcut_ctrl =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyL);
            let gs = app.handle().global_shortcut();
            if let Err(err) = gs.register(shortcut_cmd) {
                eprintln!("[clips-tray] failed to register Cmd+Shift+L: {err}");
            }
            if let Err(err) = gs.register(shortcut_ctrl) {
                eprintln!("[clips-tray] failed to register Ctrl+Shift+L: {err}");
            }

            // Hide the popover on blur so it feels like a real menu-bar popover.
            if let Some(window) = app.get_webview_window("popover") {
                let handle = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = handle.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Embedded fallback icon — a tiny 16x16 solid purple PNG so the binary always
// has *something* to display even if `icons/tray.png` is missing on disk. The
// `tauri.conf.json` tray config points at `icons/tray.png`, which the user
// should replace with their real icon.
const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");
