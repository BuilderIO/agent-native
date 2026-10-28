//! Cursor highlight and click animation for screen recordings.
//!
//! Matches Snagit 2026's video cursor effects. Snagit draws them live: a
//! transparent, click-through window per display holds Core Animation layers,
//! and the screen recorder captures that window like any other. Clips does the
//! same, so effects land in the recorded pixels without post-processing.
//!
//! Geometry and timing come from Snagit 2026.4.2 (`TSCScreenDrawKit`
//! `DWCursorLayer` / `DWCursorAnimationLayer`, configured by `SnagitHelper`)
//! and were checked against Snagit recordings:
//! - highlight: a filled circle of radius 25 pt at 50% layer opacity, with no
//!   outline, centred on the pointer and following it;
//! - click: on mouse down, a 2 pt ring with a clear fill grows from the click
//!   point at about 45 pt/s while fading from opaque to clear over 1 s. Left
//!   and right clicks use separate colours.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Only the macOS overlay draws; elsewhere the geometry is unused.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod model;
#[cfg(target_os = "macos")]
mod overlay;

pub use model::CursorEffectsConfig;
#[cfg(test)]
use model::*;

const CONFIG_FILE: &str = "cursor-effects.json";

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(CONFIG_FILE))
}

pub fn load_config(app: &AppHandle) -> CursorEffectsConfig {
    config_path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<CursorEffectsConfig>(&bytes).ok())
        .and_then(|config| config.normalized().ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, config: &CursorEffectsConfig) -> Result<(), String> {
    let path = config_path(app).ok_or_else(|| "no app_data_dir".to_string())?;
    let body = serde_json::to_vec_pretty(config).map_err(|e| format!("serialize: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &body).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename: {e}")
    })
}

#[tauri::command]
pub async fn get_cursor_effects(app: AppHandle) -> Result<CursorEffectsConfig, String> {
    Ok(load_config(&app))
}

#[tauri::command]
pub async fn set_cursor_effects(
    app: AppHandle,
    config: CursorEffectsConfig,
) -> Result<CursorEffectsConfig, String> {
    let config = config.normalized()?;
    save_config(&app, &config)?;
    reconfigure(&app, config.clone());
    Ok(config)
}

/// Shows the effects for a screen recording that just began capturing.
pub fn start(app: &AppHandle) {
    let config = load_config(app);
    if !config.any_enabled() {
        stop(app);
        return;
    }
    run_on_main(app, move || overlay::start(config));
}

/// Removes the effects. Safe to call when they are not showing.
pub fn stop(app: &AppHandle) {
    run_on_main(app, overlay::stop);
}

/// Hides the effects while a recording is paused.
pub fn set_paused(app: &AppHandle, paused: bool) {
    run_on_main(app, move || overlay::set_paused(paused));
}

fn reconfigure(app: &AppHandle, config: CursorEffectsConfig) {
    run_on_main(app, move || overlay::reconfigure(config));
}

fn run_on_main(app: &AppHandle, task: impl FnOnce() + Send + 'static) {
    if let Err(err) = app.run_on_main_thread(task) {
        eprintln!("[clips-tray] cursor effects: run_on_main_thread failed: {err}");
    }
}

#[cfg(not(target_os = "macos"))]
mod overlay {
    use super::CursorEffectsConfig;

    pub fn start(_config: CursorEffectsConfig) {}
    pub fn stop() {}
    pub fn set_paused(_paused: bool) {}
    pub fn reconfigure(_config: CursorEffectsConfig) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_snagit_colours_with_both_effects_on() {
        let config = CursorEffectsConfig::default();
        assert!(config.highlight_enabled);
        assert!(config.click_enabled);
        assert_eq!(config.highlight_color, "#FFFF00");
        assert_eq!(config.click_color, "#FF594B");
        assert_eq!(config.secondary_click_color, "#1DB1FC");
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let config: CursorEffectsConfig =
            serde_json::from_str(r#"{"highlightEnabled":false}"#).unwrap();
        assert!(!config.highlight_enabled);
        assert!(config.click_enabled);
        assert_eq!(config.click_color, "#FF594B");
    }

    #[test]
    fn parses_hex_colours() {
        assert_eq!(parse_hex_color("#FFFF00"), Some((1.0, 1.0, 0.0)));
        assert_eq!(parse_hex_color("#000000"), Some((0.0, 0.0, 0.0)));
        assert_eq!(parse_hex_color("FFFF00"), None);
        assert_eq!(parse_hex_color("#FFF"), None);
        assert_eq!(parse_hex_color("#GGGGGG"), None);
    }

    #[test]
    fn normalizes_colours_and_rejects_bad_ones() {
        let config = CursorEffectsConfig {
            highlight_color: "#ffff00".to_string(),
            ..CursorEffectsConfig::default()
        }
        .normalized()
        .unwrap();
        assert_eq!(config.highlight_color, "#FFFF00");

        let bad = CursorEffectsConfig {
            click_color: "red".to_string(),
            ..CursorEffectsConfig::default()
        };
        assert!(bad.normalized().is_err());
    }

    #[test]
    fn click_ring_grows_linearly_and_stops_at_the_fade() {
        assert_eq!(click_ring_radius(0.0), 0.0);
        assert!((click_ring_radius(0.5) - 22.5).abs() < f64::EPSILON);
        assert!((click_ring_radius(1.0) - 45.0).abs() < f64::EPSILON);
        assert!((click_ring_radius(3.0) - 45.0).abs() < f64::EPSILON);
    }

    #[test]
    fn highlight_matches_snagit_size_and_opacity() {
        assert_eq!(HIGHLIGHT_RADIUS * 2.0, 50.0);
        assert_eq!(HIGHLIGHT_OPACITY, 0.5);
        assert_eq!(CLICK_RING_LINE_WIDTH, 2.0);
    }
}
