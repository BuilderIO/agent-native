//! Verbose-log gating. Enable with `DEBUG=true` or `CLIPS_DEBUG=true`. Errors
//! and one-time startup messages stay on `eprintln!` directly; per-click /
//! per-frame chatter (toolbar shown, popover blur, capture-excluded applied,
//! …) goes through `dlog!` so it stays quiet by default.

use std::sync::OnceLock;

pub fn debug_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        let truthy = |v: String| matches!(v.as_str(), "1" | "true");
        std::env::var("DEBUG").map(truthy).unwrap_or(false)
            || std::env::var("CLIPS_DEBUG").map(truthy).unwrap_or(false)
    })
}

#[macro_export]
macro_rules! dlog {
    ($($arg:tt)*) => {{
        if $crate::debug::debug_enabled() {
            eprintln!($($arg)*);
        }
    }};
}
