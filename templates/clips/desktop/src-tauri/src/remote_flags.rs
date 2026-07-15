//! Server-controlled feature flags for the desktop capture pipeline
//! (`useCustomSCKPipeline`, `customSCKPipelineLiveUploadEnabled`) — flipping
//! either requires no desktop rebuild. This module fetches the flags from the
//! backend's `get-feature-flags` action and caches them in memory so
//! backend-selection stays a synchronous, zero-latency read.
//!
//! `spawn_watcher` runs its own periodic poll (independent of the meetings
//! watcher's tick, though it reuses the same session credentials via
//! `MeetingsWatcherState::session_snapshot()` rather than tracking its own);
//! recording start also kicks off a best-effort (non-blocking) refresh so the
//! cache stays warm without ever delaying a recording start. A fetch failure
//! (offline, no session yet, 401) just leaves the last-known-good value in
//! place — the cache never resets to defaults once a real value has been
//! fetched.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::meetings_watcher::MeetingsWatcherState;

/// How often the background watcher polls `get-feature-flags` once it has
/// fetched successfully at least once.
const REMOTE_FLAGS_POLL_SECS: u64 = 60;
/// How often it retries before the first successful fetch (e.g. while
/// waiting for the renderer to push session credentials after app launch).
const REMOTE_FLAGS_FAST_POLL_SECS: u64 = 5;

fn default_false() -> bool {
    false
}

// Explicit `rename`s (not `rename_all = "camelCase"`) because serde's
// case conversion would turn `sck` into `Sck`, not `SCK` — these must match
// the JSON keys from the `get-feature-flags` action exactly.
#[derive(Debug, Clone, Copy, Deserialize)]
pub(crate) struct RemoteFeatureFlags {
    #[serde(rename = "useCustomSCKPipeline", default = "default_false")]
    pub(crate) use_custom_sck_pipeline: bool,
    #[serde(
        rename = "customSCKPipelineLiveUploadEnabled",
        default = "default_false"
    )]
    pub(crate) custom_sck_pipeline_live_upload_enabled: bool,
}

impl Default for RemoteFeatureFlags {
    fn default() -> Self {
        Self {
            use_custom_sck_pipeline: false,
            custom_sck_pipeline_live_upload_enabled: false,
        }
    }
}

fn cache() -> &'static Mutex<RemoteFeatureFlags> {
    static CACHE: OnceLock<Mutex<RemoteFeatureFlags>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(RemoteFeatureFlags::default()))
}

/// Last-known-good flags. Synchronous — safe to call from the non-async
/// backend-selection code paths that choose the capture pipeline.
pub(crate) fn current() -> RemoteFeatureFlags {
    *cache().lock().unwrap_or_else(|e| e.into_inner())
}

/// Fetch `get-feature-flags` from the backend and update the in-memory cache
/// on success. Best-effort: any failure just leaves the cache untouched.
pub(crate) async fn refresh(
    client: &reqwest::Client,
    server_url: &str,
    cookie: Option<&str>,
    auth_token: Option<&str>,
) -> Result<(), String> {
    let url = format!("{server_url}/_agent-native/actions/get-feature-flags");
    let mut req = client.get(&url).header("X-Request-Source", "clips-desktop");
    if let Some(c) = cookie {
        req = req.header("Cookie", c);
    }
    if let Some(token) = auth_token {
        req = req.bearer_auth(token);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("fetch feature flags: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("fetch feature flags: HTTP {}", resp.status()));
    }
    let flags: RemoteFeatureFlags = resp
        .json()
        .await
        .map_err(|e| format!("parse feature flags: {e}"))?;
    *cache().lock().unwrap_or_else(|e| e.into_inner()) = flags;
    Ok(())
}

/// Fire a best-effort refresh in the background without blocking the caller
/// (e.g. recording start). No-ops silently without a server URL.
pub(crate) fn spawn_refresh(
    server_url: Option<String>,
    cookie: Option<String>,
    auth_token: Option<String>,
) {
    let Some(server_url) = server_url.filter(|s| !s.trim().is_empty()) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
        {
            Ok(c) => c,
            Err(err) => {
                eprintln!("[feature-flags] reqwest build failed: {err}");
                return;
            }
        };
        if let Err(err) = refresh(
            &client,
            &server_url,
            cookie.as_deref(),
            auth_token.as_deref(),
        )
        .await
        {
            eprintln!("[feature-flags] refresh failed: {err}");
        }
    });
}

/// Spawn the long-running feature-flags poller. Idempotent — gated on a
/// static `OnceLock` so a double-call from setup is safe. Runs on its own
/// loop, entirely separate from the meetings watcher's tick; it only reads
/// that watcher's already-live session credentials (server URL / cookie /
/// auth token) via `session_snapshot()` instead of tracking a second copy.
///
/// Starts immediately (no initial delay) and retries every
/// `REMOTE_FLAGS_FAST_POLL_SECS` until the first successful fetch — session
/// credentials aren't pushed by the renderer until sign-in completes, so this
/// closes that gap without the app needing to notify this loop. Once a fetch
/// succeeds it settles into the slower `REMOTE_FLAGS_POLL_SECS` keep-warm
/// cadence.
pub(crate) fn spawn_watcher(app: AppHandle) {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
        {
            Ok(c) => c,
            Err(err) => {
                eprintln!("[feature-flags] request build failed: {err}");
                return;
            }
        };
        let mut fetched_once = false;
        loop {
            if let Some(state) = app.try_state::<MeetingsWatcherState>() {
                let snapshot = state.session_snapshot();
                if let Some(server_url) = snapshot.server_url {
                    match refresh(
                        &client,
                        &server_url,
                        snapshot.session_cookie.as_deref(),
                        snapshot.auth_token.as_deref(),
                    )
                    .await
                    {
                        Ok(()) => fetched_once = true,
                        Err(err) => eprintln!("[feature-flags] watcher refresh failed: {err}"),
                    }
                }
            }
            let wait_secs = if fetched_once {
                REMOTE_FLAGS_POLL_SECS
            } else {
                REMOTE_FLAGS_FAST_POLL_SECS
            };
            tokio::time::sleep(Duration::from_secs(wait_secs)).await;
        }
    });
}
