declare const __AGENT_NATIVE_DESKTOP_SENTRY_DSN__: string | undefined;
declare const __AGENT_NATIVE_DESKTOP_SENTRY_ENVIRONMENT__: string | undefined;
declare const __AGENT_NATIVE_DESKTOP_SENTRY_RELEASE__: string | undefined;
declare const __AGENT_NATIVE_DESKTOP_SENTRY_DEBUG__: string | undefined;

type Env = Record<string, string | undefined>;

const DSN_ENV_KEYS = [
  "SENTRY_DESKTOP_DSN",
  "SENTRY_ELECTRON_DSN",
  "SENTRY_CLIENT_DSN",
  "VITE_SENTRY_CLIENT_DSN",
  "VITE_SENTRY_DSN",
  "SENTRY_DSN",
] as const;
const CLIENT_KEY_ENV_KEYS = [
  "SENTRY_DESKTOP_CLIENT_KEY",
  "SENTRY_ELECTRON_CLIENT_KEY",
  "SENTRY_CLIENT_KEY",
  "VITE_SENTRY_CLIENT_KEY",
] as const;
const PROJECT_ID_ENV_KEYS = [
  "SENTRY_DESKTOP_PROJECT_ID",
  "SENTRY_ELECTRON_PROJECT_ID",
  "SENTRY_PROJECT_ID",
  "VITE_SENTRY_PROJECT_ID",
] as const;
const INGEST_HOST_ENV_KEYS = [
  "SENTRY_DESKTOP_INGEST_HOST",
  "SENTRY_ELECTRON_INGEST_HOST",
  "SENTRY_INGEST_HOST",
  "VITE_SENTRY_INGEST_HOST",
] as const;
const ENVIRONMENT_ENV_KEYS = [
  "SENTRY_DESKTOP_ENVIRONMENT",
  "SENTRY_ELECTRON_ENVIRONMENT",
  "NETLIFY_CONTEXT",
  "VERCEL_ENV",
  "SENTRY_ENVIRONMENT",
  "NODE_ENV",
] as const;
const RELEASE_ENV_KEYS = [
  "SENTRY_DESKTOP_RELEASE",
  "SENTRY_ELECTRON_RELEASE",
  "SENTRY_RELEASE",
] as const;
const ENABLED_ENV_KEYS = [
  "SENTRY_DESKTOP_ENABLED",
  "SENTRY_ELECTRON_ENABLED",
] as const;
const DEBUG_ENV_KEYS = [
  "SENTRY_DESKTOP_DEBUG",
  "SENTRY_ELECTRON_DEBUG",
  "SENTRY_DEBUG",
] as const;

export interface DesktopSentryConfig {
  enabled: boolean;
  dsn?: string;
  environment: string;
  release?: string;
  debug: boolean;
}

export interface DesktopSentryConfigOptions {
  isPackaged?: boolean;
  version?: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function firstEnv(env: Env, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = clean(env[key]);
    if (value) return value;
  }
  return undefined;
}

function buildConstant(read: () => string | undefined): string | undefined {
  try {
    return clean(read());
  } catch {
    return undefined;
  }
}

function buildTimeDsn(): string | undefined {
  return buildConstant(() =>
    typeof __AGENT_NATIVE_DESKTOP_SENTRY_DSN__ === "string"
      ? __AGENT_NATIVE_DESKTOP_SENTRY_DSN__
      : undefined,
  );
}

function buildTimeEnvironment(): string | undefined {
  return buildConstant(() =>
    typeof __AGENT_NATIVE_DESKTOP_SENTRY_ENVIRONMENT__ === "string"
      ? __AGENT_NATIVE_DESKTOP_SENTRY_ENVIRONMENT__
      : undefined,
  );
}

function buildTimeRelease(): string | undefined {
  return buildConstant(() =>
    typeof __AGENT_NATIVE_DESKTOP_SENTRY_RELEASE__ === "string"
      ? __AGENT_NATIVE_DESKTOP_SENTRY_RELEASE__
      : undefined,
  );
}

function buildTimeDebug(): string | undefined {
  return buildConstant(() =>
    typeof __AGENT_NATIVE_DESKTOP_SENTRY_DEBUG__ === "string"
      ? __AGENT_NATIVE_DESKTOP_SENTRY_DEBUG__
      : undefined,
  );
}

function resolveDsn(env: Env): string | undefined {
  const direct = firstEnv(env, DSN_ENV_KEYS) ?? buildTimeDsn();
  if (direct) return direct;

  const key = firstEnv(env, CLIENT_KEY_ENV_KEYS);
  const projectId = firstEnv(env, PROJECT_ID_ENV_KEYS);
  const host = firstEnv(env, INGEST_HOST_ENV_KEYS);
  return key && projectId && host
    ? `https://${key}@${host}/${projectId}`
    : undefined;
}

function isDisabled(value: string | undefined): boolean {
  if (!value) return false;
  return ["0", "false", "off", "no", "disabled"].includes(value.toLowerCase());
}

function isEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "on", "yes", "enabled"].includes(value.toLowerCase());
}

export function resolveDesktopSentryConfig(
  env: Env,
  options: DesktopSentryConfigOptions = {},
): DesktopSentryConfig {
  const dsn = resolveDsn(env);
  const enabledOverride = firstEnv(env, ENABLED_ENV_KEYS);
  const debugValue = firstEnv(env, DEBUG_ENV_KEYS) ?? buildTimeDebug();
  const version = clean(options.version);
  const release =
    firstEnv(env, RELEASE_ENV_KEYS) ??
    buildTimeRelease() ??
    (version ? `agent-native-desktop@${version}` : undefined);

  return {
    enabled: Boolean(dsn) && !isDisabled(enabledOverride),
    dsn,
    environment:
      firstEnv(env, ENVIRONMENT_ENV_KEYS) ??
      buildTimeEnvironment() ??
      (options.isPackaged ? "production" : "development"),
    release,
    debug: isEnabled(debugValue),
  };
}

export function isDesktopSentryConfigured(env: Env): boolean {
  return resolveDesktopSentryConfig(env).enabled;
}
