use std::sync::OnceLock;
use std::time::Duration;

static SENTRY_GUARD: OnceLock<&'static sentry::ClientInitGuard> = OnceLock::new();

const DIRECT_DSN_ENV: [(&str, Option<&str>); 7] = [
    (
        "CLIPS_DESKTOP_SENTRY_DSN",
        option_env!("CLIPS_DESKTOP_SENTRY_DSN"),
    ),
    ("TAURI_SENTRY_DSN", option_env!("TAURI_SENTRY_DSN")),
    ("SENTRY_DESKTOP_DSN", option_env!("SENTRY_DESKTOP_DSN")),
    ("SENTRY_CLIENT_DSN", option_env!("SENTRY_CLIENT_DSN")),
    (
        "VITE_SENTRY_CLIENT_DSN",
        option_env!("VITE_SENTRY_CLIENT_DSN"),
    ),
    ("VITE_SENTRY_DSN", option_env!("VITE_SENTRY_DSN")),
    ("SENTRY_DSN", option_env!("SENTRY_DSN")),
];

const KEY_ENV: [(&str, Option<&str>); 3] = [
    (
        "CLIPS_DESKTOP_SENTRY_CLIENT_KEY",
        option_env!("CLIPS_DESKTOP_SENTRY_CLIENT_KEY"),
    ),
    ("SENTRY_CLIENT_KEY", option_env!("SENTRY_CLIENT_KEY")),
    (
        "VITE_SENTRY_CLIENT_KEY",
        option_env!("VITE_SENTRY_CLIENT_KEY"),
    ),
];

const PROJECT_ENV: [(&str, Option<&str>); 3] = [
    (
        "CLIPS_DESKTOP_SENTRY_PROJECT_ID",
        option_env!("CLIPS_DESKTOP_SENTRY_PROJECT_ID"),
    ),
    ("SENTRY_PROJECT_ID", option_env!("SENTRY_PROJECT_ID")),
    (
        "VITE_SENTRY_PROJECT_ID",
        option_env!("VITE_SENTRY_PROJECT_ID"),
    ),
];

const HOST_ENV: [(&str, Option<&str>); 3] = [
    (
        "CLIPS_DESKTOP_SENTRY_INGEST_HOST",
        option_env!("CLIPS_DESKTOP_SENTRY_INGEST_HOST"),
    ),
    ("SENTRY_INGEST_HOST", option_env!("SENTRY_INGEST_HOST")),
    (
        "VITE_SENTRY_INGEST_HOST",
        option_env!("VITE_SENTRY_INGEST_HOST"),
    ),
];

const ENVIRONMENT_ENV: [(&str, Option<&str>); 5] = [
    (
        "CLIPS_DESKTOP_SENTRY_ENVIRONMENT",
        option_env!("CLIPS_DESKTOP_SENTRY_ENVIRONMENT"),
    ),
    ("SENTRY_ENVIRONMENT", option_env!("SENTRY_ENVIRONMENT")),
    ("NETLIFY_CONTEXT", option_env!("NETLIFY_CONTEXT")),
    ("VERCEL_ENV", option_env!("VERCEL_ENV")),
    ("NODE_ENV", option_env!("NODE_ENV")),
];

pub fn init() {
    if SENTRY_GUARD.get().is_some() {
        return;
    }

    let Some(dsn) = resolve_sentry_dsn() else {
        return;
    };
    let Ok(dsn) = dsn.parse() else {
        eprintln!("[clips-tray] ignoring invalid Sentry DSN");
        return;
    };

    let guard = sentry::init(sentry::ClientOptions {
        dsn: Some(dsn),
        environment: Some(resolve_sentry_environment().into()),
        release: Some(format!("clips-desktop@{}", env!("CARGO_PKG_VERSION")).into()),
        send_default_pii: false,
        before_send: Some(std::sync::Arc::new(|mut event| {
            event.user = None;
            Some(event)
        })),
        ..Default::default()
    });

    if guard.is_enabled() {
        sentry::configure_scope(|scope| {
            scope.set_tag("app", "agent-native-clips");
            scope.set_tag("template", "clips");
            scope.set_tag("runtime", "tauri-native");
        });
    }

    let _ = SENTRY_GUARD.set(Box::leak(Box::new(guard)));
}

pub fn flush(timeout: Duration) {
    if let Some(guard) = SENTRY_GUARD.get() {
        guard.close(Some(timeout));
    }
}

fn resolve_sentry_dsn() -> Option<String> {
    if let Some(dsn) = first_env(&DIRECT_DSN_ENV) {
        return Some(dsn);
    }

    let key = first_env(&KEY_ENV)?;
    let project = first_env(&PROJECT_ENV)?;
    let host = first_env(&HOST_ENV)?;
    Some(format!("https://{key}@{host}/{project}"))
}

fn resolve_sentry_environment() -> String {
    first_env(&ENVIRONMENT_ENV).unwrap_or_else(|| "production".to_string())
}

fn first_env(values: &[(&str, Option<&str>)]) -> Option<String> {
    for (name, embedded) in values {
        if let Ok(value) = std::env::var(name) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if let Some(value) = embedded {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}
