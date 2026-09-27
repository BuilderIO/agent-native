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
//!
//! `refresh` skips the request entirely when neither a cookie nor a bearer
//! token is available (a request would just 401), and `spawn_watcher` backs
//! off a credential pair that did 401 (`UnauthorizedRetry`, shared with
//! `meetings_watcher.rs`) instead of retrying it every poll — otherwise a
//! stuck install with a dead session polls prod forever at the fast-poll
//! cadence.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::meetings_watcher::{
    should_poll, MeetingsWatcherState, SessionCredentials, UnauthorizedRetry,
};

const REMOTE_FLAGS_POLL_SECS: u64 = 60;
const REMOTE_FLAGS_FAST_POLL_SECS: u64 = 5;

fn default_false() -> bool {
    false
}

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

pub(crate) fn current() -> RemoteFeatureFlags {
    *cache().lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug)]
pub(crate) enum RefreshError {
    /// Neither a cookie nor a bearer token was available — the request was
    /// never sent, since it would just 401.
    NoCredentials,
    Unauthorized,
    Other(String),
}

impl std::fmt::Display for RefreshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RefreshError::NoCredentials => write!(f, "no session credentials"),
            RefreshError::Unauthorized => write!(f, "fetch feature flags: HTTP 401/403"),
            RefreshError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

pub(crate) async fn refresh(
    client: &reqwest::Client,
    server_url: &str,
    cookie: Option<&str>,
    auth_token: Option<&str>,
) -> Result<(), RefreshError> {
    if cookie.is_none() && auth_token.is_none() {
        return Err(RefreshError::NoCredentials);
    }
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
        .map_err(|e| RefreshError::Other(format!("fetch feature flags: {e}")))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(RefreshError::Unauthorized);
    }
    if !resp.status().is_success() {
        return Err(RefreshError::Other(format!(
            "fetch feature flags: HTTP {}",
            resp.status()
        )));
    }
    let flags: RemoteFeatureFlags = resp
        .json()
        .await
        .map_err(|e| RefreshError::Other(format!("parse feature flags: {e}")))?;
    *cache().lock().unwrap_or_else(|e| e.into_inner()) = flags;
    Ok(())
}

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
        let mut unauthorized_retry: Option<UnauthorizedRetry> = None;
        loop {
            if let Some(state) = app.try_state::<MeetingsWatcherState>() {
                let snapshot = state.session_snapshot();
                let credentials: SessionCredentials =
                    (snapshot.session_cookie.clone(), snapshot.auth_token.clone());
                let now = Instant::now();
                if should_poll(&unauthorized_retry, &credentials, now) {
                    if let Some(server_url) = snapshot.server_url {
                        match refresh(
                            &client,
                            &server_url,
                            snapshot.session_cookie.as_deref(),
                            snapshot.auth_token.as_deref(),
                        )
                        .await
                        {
                            Ok(()) => {
                                fetched_once = true;
                                unauthorized_retry = None;
                            }
                            Err(RefreshError::NoCredentials) => {}
                            Err(RefreshError::Unauthorized) => {
                                eprintln!("[feature-flags] watcher refresh failed: unauthorized");
                                unauthorized_retry = Some(UnauthorizedRetry::after(
                                    unauthorized_retry.as_ref(),
                                    credentials,
                                    Duration::from_secs(REMOTE_FLAGS_FAST_POLL_SECS),
                                    now,
                                ));
                            }
                            Err(err) => eprintln!("[feature-flags] watcher refresh failed: {err}"),
                        }
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

#[cfg(test)]
mod tests {
    use super::{refresh, RefreshError};

    /// No cookie and no token — `refresh` must return `NoCredentials`
    /// without sending anything. If this ever regressed into an actual
    /// request, the test would hang/fail against `127.0.0.1:1` since
    /// nothing listens there, instead of returning instantly.
    #[tokio::test]
    async fn refresh_skips_the_request_with_no_session_credentials() {
        let client = reqwest::Client::new();
        let result = refresh(&client, "http://127.0.0.1:1", None, None).await;
        assert!(matches!(result, Err(RefreshError::NoCredentials)));
    }
}
