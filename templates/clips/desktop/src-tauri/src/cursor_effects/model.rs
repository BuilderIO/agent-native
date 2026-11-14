//! Cursor effect settings and the geometry measured from Snagit.

use serde::{Deserialize, Serialize};

pub(crate) const HIGHLIGHT_RADIUS: f64 = 25.0;
pub(crate) const HIGHLIGHT_OPACITY: f32 = 0.5;
pub(crate) const CLICK_RING_LINE_WIDTH: f64 = 2.0;
pub(crate) const CLICK_RING_DURATION_SECS: f64 = 1.0;
pub(crate) const CLICK_RING_GROWTH_PT_PER_SEC: f64 = 45.0;

fn default_true() -> bool {
    true
}

fn default_highlight_color() -> String {
    "#FFFF00".to_string()
}

fn default_click_color() -> String {
    "#FF594B".to_string()
}

fn default_secondary_click_color() -> String {
    "#1DB1FC".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorEffectsConfig {
    #[serde(default = "default_true")]
    pub highlight_enabled: bool,
    #[serde(default = "default_true")]
    pub click_enabled: bool,
    #[serde(default = "default_highlight_color")]
    pub highlight_color: String,
    #[serde(default = "default_click_color")]
    pub click_color: String,
    #[serde(default = "default_secondary_click_color")]
    pub secondary_click_color: String,
}

impl Default for CursorEffectsConfig {
    fn default() -> Self {
        Self {
            highlight_enabled: true,
            click_enabled: true,
            highlight_color: default_highlight_color(),
            click_color: default_click_color(),
            secondary_click_color: default_secondary_click_color(),
        }
    }
}

impl CursorEffectsConfig {
    pub(crate) fn any_enabled(&self) -> bool {
        self.highlight_enabled || self.click_enabled
    }

    /// Rejects malformed colours and stores them as uppercase `#RRGGBB`.
    pub(crate) fn normalized(mut self) -> Result<Self, String> {
        for color in [
            &mut self.highlight_color,
            &mut self.click_color,
            &mut self.secondary_click_color,
        ] {
            if parse_hex_color(color).is_none() {
                return Err(format!("Invalid colour {color:?}; use #RRGGBB."));
            }
            *color = color.to_ascii_uppercase();
        }
        Ok(self)
    }
}

/// Parses `#RRGGBB` into sRGB components in 0..=1.
pub(crate) fn parse_hex_color(value: &str) -> Option<(f64, f64, f64)> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |start: usize| {
        u8::from_str_radix(&hex[start..start + 2], 16)
            .ok()
            .map(|v| f64::from(v) / 255.0)
    };
    Some((channel(0)?, channel(2)?, channel(4)?))
}

/// Ring radius `elapsed` seconds after the click.
pub(crate) fn click_ring_radius(elapsed_secs: f64) -> f64 {
    CLICK_RING_GROWTH_PT_PER_SEC * elapsed_secs.clamp(0.0, CLICK_RING_DURATION_SECS)
}
