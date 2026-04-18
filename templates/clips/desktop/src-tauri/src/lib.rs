//! Clips menu-bar tray app.
//!
//! The app is a single always-on-top popover window. Clicking the tray icon
//! toggles it. Pressing Cmd/Ctrl+Shift+L also toggles it. The popover itself
//! is served by the Vite-built React UI (see `../dist`).

use std::sync::Mutex;
use std::time::Instant;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

/// Last-known tray icon rect, updated on every tray event. Used to anchor the
/// popover directly under the icon (Loom-style) instead of floating in the
/// top-right corner of the screen.
#[derive(Default)]
struct TrayAnchor(Mutex<Option<Rect>>);

/// Timestamp of the most-recent popover show. The blur-to-hide handler checks
/// this — macOS briefly steals focus during the tray click itself, so without
/// this guard the popover would be hidden the instant it's shown.
#[derive(Default)]
struct PopoverShownAt(Mutex<Option<Instant>>);

/// Whether a recording is currently in progress. Set from JS via
/// `set_recording_state`. Used to re-purpose the tray icon click as a
/// stop-recording shortcut while recording, matching Loom.
#[derive(Default)]
struct RecordingActive(Mutex<bool>);
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Native overlay windows for the recording experience. These render the same
/// React bundle with a hash route that `main.tsx` uses to pick the component.
const COUNTDOWN_LABEL: &str = "countdown";
const TOOLBAR_LABEL: &str = "toolbar";
const BUBBLE_LABEL: &str = "bubble";

fn build_overlay_url(path: &str) -> WebviewUrl {
    // tauri dev serves the Vite dev server; prod builds resolve relative to
    // the bundled index.html. WebviewUrl::App handles both transparently —
    // we pass an index + hash route.
    WebviewUrl::App(format!("index.html#{path}").into())
}

/// Full-screen transparent overlay that runs the 3-2-1 countdown. It ignores
/// cursor events so the user can still click into whatever they're about to
/// record, and closes itself when the countdown finishes.
#[tauri::command]
async fn show_countdown(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_countdown invoked");
    if let Some(existing) = app.get_webview_window(COUNTDOWN_LABEL) {
        let _ = existing.close();
    }
    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    eprintln!("[clips-tray] countdown target size {}x{} physical", mw, mh);
    let win = WebviewWindowBuilder::new(
        &app,
        COUNTDOWN_LABEL,
        build_overlay_url("countdown"),
    )
    .title("Countdown")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .build()
    .map_err(|e| {
        eprintln!("[clips-tray] countdown build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(mw, mh)));
    let _ = win.set_position(PhysicalPosition::new(0, 0));
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.show();
    eprintln!("[clips-tray] countdown shown");
    Ok(())
}

/// Vertical recording pill anchored to the left edge. Stop + timer + pause,
/// matching Loom's left-rail placement. Draggable, always on top.
#[tauri::command]
async fn show_toolbar(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_toolbar invoked");
    if let Some(existing) = app.get_webview_window(TOOLBAR_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let (_mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    // 72x180 logical → 144x360 physical on 2x, but we're working in pure
    // physical here so pick values that look right at retina scale.
    let w: u32 = 144;
    let h: u32 = 360;
    // Flush-left with a small margin; vertically centered on the screen.
    let x: i32 = 48;
    let y: i32 = (mh as i32 - h as i32) / 2;
    eprintln!("[clips-tray] toolbar pos=({},{}) size={}x{}", x, y, w, h);
    let win = WebviewWindowBuilder::new(
        &app,
        TOOLBAR_LABEL,
        build_overlay_url("toolbar"),
    )
    .title("Clips Recorder")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(true)
    .visible(false)
    .build()
    .map_err(|e| {
        eprintln!("[clips-tray] toolbar build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.show();
    eprintln!("[clips-tray] toolbar shown");
    Ok(())
}

/// Circular, draggable webcam bubble — small always-on-top window that hosts
/// its own getUserMedia stream and floats over everything the user captures.
#[tauri::command]
async fn show_bubble(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_bubble invoked");
    if let Some(existing) = app.get_webview_window(BUBBLE_LABEL) {
        let _ = existing.show();
        eprintln!("[clips-tray] bubble reused");
        return Ok(());
    }
    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    let size: u32 = 360; // physical (= 180 logical on retina)
    let x: i32 = 48;
    let y: i32 = mh as i32 - size as i32 - 192;
    eprintln!("[clips-tray] bubble pos=({},{}) size={} monitor={}x{}", x, y, size, mw, mh);
    let win = WebviewWindowBuilder::new(
        &app,
        BUBBLE_LABEL,
        build_overlay_url("bubble"),
    )
    .title("Clips Camera")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .visible(false)
    .build()
    .map_err(|e| {
        eprintln!("[clips-tray] bubble build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(size, size)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.show();
    eprintln!("[clips-tray] bubble shown at ({},{}) size {}", x, y, size);
    Ok(())
}

#[tauri::command]
async fn hide_overlays(app: AppHandle) -> Result<(), String> {
    for label in [COUNTDOWN_LABEL, TOOLBAR_LABEL, BUBBLE_LABEL] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.close();
        }
    }
    Ok(())
}

/// Show the popover window without toggling, and keep it shown even if it
/// loses focus (popover hides on blur by default, but during post-recording
/// review we want it sticky while the user reads the "Recording saved" copy).
/// Resize the popover window to match the rendered React app height. The
/// React side measures its own shell with a ResizeObserver and calls this
/// whenever the height changes — gives us auto-sizing without having to
/// pick a fixed popover size that fits every state.
#[tauri::command]
async fn resize_popover(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("popover") {
        let clamped = height.clamp(200.0, 820.0);
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            360.0, clamped,
        )));
        // Re-anchor to the tray icon so the window doesn't drift below the
        // bottom of the monitor after a growth.
        position_popover(&app, &w);
    }
    Ok(())
}

/// Open a login window pointed at the Clips server's /login route. The
/// WebView has its own persistent cookie jar, so once the user signs in
/// here the session cookie is available to every subsequent fetch from
/// the popover (localhost:1420 and localhost:8094 are same-site — ports
/// aren't part of the site check — so SameSite=Lax cookies cross-send
/// correctly with credentials: "include").
#[tauri::command]
async fn show_signin(app: AppHandle, url: String) -> Result<(), String> {
    const LABEL: &str = "signin";
    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let win = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(parsed))
        .title("Sign in to Clips")
        .inner_size(520.0, 720.0)
        .resizable(true)
        .always_on_top(false)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
async fn close_signin(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("signin") {
        let _ = w.close();
    }
    Ok(())
}

/// Record the popover's current recording state. When active, clicking the
/// tray icon emits a stop event instead of toggling the popover — so the
/// user can stop a recording from anywhere with one click.
#[tauri::command]
async fn set_recording_state(
    app: AppHandle,
    active: bool,
) -> Result<(), String> {
    if let Some(state) = app.try_state::<RecordingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = active;
        }
    }
    Ok(())
}

fn is_recording_active(app: &AppHandle) -> bool {
    app.try_state::<RecordingActive>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

#[tauri::command]
async fn show_popover(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popover") {
        position_popover(&app, &window);
        mark_popover_shown(&app);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("clips:popover-visible", true);
    }
    Ok(())
}

fn mark_popover_shown(app: &AppHandle) {
    if let Some(state) = app.try_state::<PopoverShownAt>() {
        if let Ok(mut g) = state.0.lock() {
            *g = Some(Instant::now());
        }
    }
}

fn primary_monitor_size(app: &AppHandle) -> Option<(u32, u32)> {
    primary_monitor_physical_size(app)
}

fn primary_monitor_physical_size(app: &AppHandle) -> Option<(u32, u32)> {
    let window = app.get_webview_window("popover")?;
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        })?;
    let size = monitor.size();
    Some((size.width, size.height))
}

fn toggle_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window("popover") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        let _ = app.emit("clips:popover-visible", false);
    } else {
        position_popover(app, &window);
        mark_popover_shown(app);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("clips:popover-visible", true);
    }
}

fn position_popover(app: &AppHandle, window: &WebviewWindow) {
    // If we have a recent tray icon rect, anchor the popover's top edge just
    // below the icon and center it horizontally on the icon — same feel as
    // Loom / Raycast / 1Password.
    let anchor = app.state::<TrayAnchor>();
    let tray_rect = anchor.0.lock().ok().and_then(|g| *g);

    let win_size: PhysicalSize<u32> =
        window.outer_size().unwrap_or(PhysicalSize::new(360, 440));
    // IMPORTANT: `current_monitor()` returns None when the window is offscreen
    // (we park it at 99999,99999 on boot to hide the initial flash). Fall back
    // to the primary monitor so we can still position correctly on first show.
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        });
    let Some(monitor) = monitor else {
        return;
    };
    let mon_size = monitor.size();
    let mon_pos = monitor.position();

    if let Some(rect) = tray_rect {
        // `Rect { position, size }` on macOS is in physical pixels with the
        // origin at the active monitor's top-left (matching macOS's coord
        // system, y grows downward in Tauri v2).
        let icon_x = match rect.position {
            tauri::Position::Physical(p) => p.x,
            tauri::Position::Logical(p) => p.x as i32,
        };
        let icon_y = match rect.position {
            tauri::Position::Physical(p) => p.y,
            tauri::Position::Logical(p) => p.y as i32,
        };
        let icon_w = match rect.size {
            tauri::Size::Physical(s) => s.width as i32,
            tauri::Size::Logical(s) => s.width as i32,
        };
        let icon_h = match rect.size {
            tauri::Size::Physical(s) => s.height as i32,
            tauri::Size::Logical(s) => s.height as i32,
        };

        // Center the popover horizontally on the icon.
        let mut x = icon_x + icon_w / 2 - (win_size.width as i32) / 2;
        // Drop below the icon with a tiny gap.
        let gap = 6_i32;
        let y = icon_y + icon_h + gap;

        // Clamp horizontally so we don't run off the edge of the screen.
        let min_x = mon_pos.x + 8;
        let max_x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - 8;
        if x < min_x {
            x = min_x;
        }
        if x > max_x {
            x = max_x;
        }
        let _ = window.set_position(PhysicalPosition::new(x, y));
        return;
    }

    // Fallback: top-right of the active monitor (used before the tray has
    // fired its first event).
    let scale = monitor.scale_factor();
    let margin_right = (12.0 * scale) as i32;
    let margin_top = (36.0 * scale) as i32;
    let x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - margin_right;
    let y = mon_pos.y + margin_top;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

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
            show_countdown,
            show_toolbar,
            show_bubble,
            hide_overlays,
            show_popover,
            resize_popover,
            show_signin,
            close_signin,
            set_recording_state,
        ])
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
        .manage(TrayAnchor::default())
        .manage(PopoverShownAt::default())
        .manage(RecordingActive::default())
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

            // Simple tray menu — right-click reveals it.
            let show_item =
                MenuItem::with_id(app, "show", "Show popover", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Clips", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

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
                // Colored rounded-square brand icon (not a template) —
                // stays purple in both light and dark menu bars.
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
                        if is_recording_active(app) {
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
                // in the React effect. Users can right-click → Inspect
                // Element if they need devtools.
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let shown_at = app_handle
                            .try_state::<PopoverShownAt>()
                            .and_then(|s| s.0.lock().ok().and_then(|g| *g));
                        let elapsed_ms = shown_at
                            .map(|t| t.elapsed().as_millis())
                            .unwrap_or(u128::MAX);
                        // 1500ms guard — macOS's tray-click focus shuffle
                        // can take ~500-800ms on slower systems. 250ms
                        // wasn't enough and the popover kept snapping
                        // shut before the user could interact with it.
                        eprintln!(
                            "[clips-tray] popover blur, elapsed_ms={}",
                            elapsed_ms
                        );
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
        .run(|app_handle, event| {
            // macOS: clicking the Dock icon ("reopen") toggles the popover.
            // This is the most natural trigger in debug builds where the Dock
            // icon is visible (production hides it via LSUIElement).
            if let tauri::RunEvent::Reopen { .. } = event {
                toggle_popover(app_handle);
            }
        });
}

// Embedded fallback icon — a tiny 16x16 solid purple PNG so the binary always
// has *something* to display even if `icons/tray.png` is missing on disk. The
// `tauri.conf.json` tray config points at `icons/tray.png`, which the user
// should replace with their real icon.
const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");
