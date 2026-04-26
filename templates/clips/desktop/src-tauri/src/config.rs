use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureConfig {
    pub clips_enabled: bool,
    pub meetings_enabled: bool,
    pub voice_enabled: bool,
    pub onboarding_complete: bool,
}

impl Default for FeatureConfig {
    fn default() -> Self {
        Self {
            clips_enabled: true,
            meetings_enabled: true,
            voice_enabled: true,
            onboarding_complete: false,
        }
    }
}

/// Path to the JSON blob that stores the feature config on disk. Lives in the
/// Tauri app-data dir (platform-specific — `~/Library/Application
/// Support/<bundle-id>/` on macOS). Returns None if the app-data dir cannot be
/// resolved.
fn config_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if let Err(err) = std::fs::create_dir_all(&dir) {
        eprintln!(
            "[clips-tray] config_path mkdir failed: {} ({})",
            err,
            dir.display()
        );
        return None;
    }
    Some(dir.join("feature-config.json"))
}

/// Load the feature config from disk. Returns the default config if the file
/// doesn't exist or can't be parsed.
fn load_config(app: &AppHandle) -> FeatureConfig {
    let Some(path) = config_path(app) else {
        return FeatureConfig::default();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return FeatureConfig::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Persist the feature config to disk (atomic write via temp + rename).
fn save_config(app: &AppHandle, config: &FeatureConfig) -> Result<(), String> {
    let Some(path) = config_path(app) else {
        return Err("no app_data_dir".to_string());
    };
    let body = serde_json::to_vec_pretty(config).map_err(|e| format!("serialize: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    if let Err(err) = std::fs::write(&tmp, &body) {
        eprintln!("[clips-tray] save_config write tmp failed: {err}");
        return Err(format!("write tmp: {err}"));
    }
    if let Err(err) = std::fs::rename(&tmp, &path) {
        eprintln!("[clips-tray] save_config rename failed: {err}");
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("rename: {err}"));
    }
    Ok(())
}

/// Load feature config from disk and return it to the frontend.
#[tauri::command]
pub async fn get_feature_config(app: AppHandle) -> Result<FeatureConfig, String> {
    Ok(load_config(&app))
}

/// Save feature config to disk and emit a change event.
#[tauri::command]
pub async fn set_feature_config(app: AppHandle, config: FeatureConfig) -> Result<(), String> {
    save_config(&app, &config)?;
    let _ = app.emit("app:feature-config-changed", config);
    Ok(())
}
