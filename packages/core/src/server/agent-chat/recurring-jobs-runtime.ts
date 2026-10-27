import { hasCloudflareRuntime } from "../../db/migration-runtime.js";

type RecurringJobsRuntimeEnvKey =
  | "A2A_SECRET"
  | "AGENT_NATIVE_BUILD_RECURRING_JOBS"
  | "AGENT_NATIVE_DISABLE_RECURRING_JOBS"
  | "AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS"
  | "APP_URL"
  | "BETTER_AUTH_URL"
  | "CF_PAGES"
  | "CRON_SECRET"
  | "DEPLOY_URL"
  | "AWS_EXECUTION_ENV"
  | "AWS_LAMBDA_FUNCTION_NAME"
  | "NETLIFY"
  | "NETLIFY_LOCAL"
  | "NITRO_PRESET"
  | "NODE_ENV"
  | "SITE_ID"
  | "URL"
  | "VERCEL"
  | "VERCEL_ENV"
  | "VITE_APP_URL"
  | "VITE_WORKSPACE_GATEWAY_URL"
  | "WORKSPACE_GATEWAY_URL";

type RecurringJobsRuntimeEnv = Partial<
  Record<RecurringJobsRuntimeEnvKey, string | undefined>
>;

/**
 * Runtime facts the environment cannot carry. A Cloudflare Worker exposes its
 * bindings only on the request, so the generated worker entry marks the
 * isolate instead of setting an env var.
 */
export interface RecurringJobsPlatform {
  cloudflareWorker: boolean;
}

function detectRecurringJobsPlatform(): RecurringJobsPlatform {
  return { cloudflareWorker: hasCloudflareRuntime() };
}

function isTruthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function isLoopbackAppUrl(value: string | undefined): boolean {
  const raw = value?.trim();
  if (!raw) return false;

  const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? [raw]
    : [raw, `http://${raw}`];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host === "::1" ||
        host === "tauri.localhost" ||
        host.endsWith(".localhost")
      ) {
        return true;
      }
    } catch {}
  }

  return false;
}

function isServerlessRecurringJobsRuntime(
  env: RecurringJobsRuntimeEnv,
  platform: RecurringJobsPlatform,
): boolean {
  return (
    env.NETLIFY_LOCAL !== "true" &&
    (platform.cloudflareWorker ||
      isTruthyEnv(env.NETLIFY) ||
      env.NITRO_PRESET === "netlify" ||
      Boolean(env.AWS_LAMBDA_FUNCTION_NAME) ||
      env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
      isTruthyEnv(env.CF_PAGES) ||
      isTruthyEnv(env.VERCEL))
  );
}

export function shouldDisableRecurringJobsRuntime(
  env: RecurringJobsRuntimeEnv = process.env,
  platform: RecurringJobsPlatform = detectRecurringJobsPlatform(),
): boolean {
  if (isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)) return true;

  if (isServerlessRecurringJobsRuntime(env, platform)) return true;

  const isLocalRuntime =
    env.NODE_ENV === "development" ||
    env.NODE_ENV === "test" ||
    [
      env.APP_URL,
      env.BETTER_AUTH_URL,
      env.DEPLOY_URL,
      env.URL,
      env.VITE_APP_URL,
      env.VITE_WORKSPACE_GATEWAY_URL,
      env.WORKSPACE_GATEWAY_URL,
    ].some(isLoopbackAppUrl);

  if (
    isLocalRuntime &&
    isTruthyEnv(env.AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS)
  ) {
    return false;
  }

  return isLocalRuntime;
}

export function isNetlifyRecurringJobsRuntime(
  env: RecurringJobsRuntimeEnv = process.env,
): boolean {
  if (env.NETLIFY_LOCAL === "true") return false;
  if (env.NETLIFY === "false") return false;
  return Boolean((env.NETLIFY && env.NETLIFY !== "false") || env.SITE_ID);
}

export type RecurringJobsBuildMarker = "enabled" | "disabled";

export const RECURRING_JOBS_BUILD_MARKER_ENV_VAR =
  "AGENT_NATIVE_BUILD_RECURRING_JOBS";

export function resolveRecurringJobsBuildMarker(
  env: RecurringJobsRuntimeEnv = process.env,
): RecurringJobsBuildMarker {
  return isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)
    ? "disabled"
    : "enabled";
}

function readRecurringJobsBuildMarker(
  env: RecurringJobsRuntimeEnv,
): RecurringJobsBuildMarker | undefined {
  const raw =
    env.AGENT_NATIVE_BUILD_RECURRING_JOBS ??
    // config-ok: this value is INLINED at build time by Vite's `define` /
    // Nitro's `replace`, which rewrite the literal `process.env.<NAME>` member
    // expression and nothing else. A declared app-config field is read at
    // runtime from the deployed environment, which is precisely the scope that
    // cannot see the build's decision — the bug this marker exists to fix.
    // Reading through the aliased `env` parameter would also survive the build
    // unreplaced, so the literal form is load-bearing.
    process.env.AGENT_NATIVE_BUILD_RECURRING_JOBS;
  const value = raw?.trim();
  return value === "enabled" || value === "disabled" ? value : undefined;
}

export type PlatformScheduledTriggerDriver =
  | "netlify-scheduled-function"
  | "vercel-cron"
  | "cloudflare-cron-trigger";

export type ScheduledTriggerDriver =
  | PlatformScheduledTriggerDriver
  | "in-process";

/**
 * The secret each emitted trigger authenticates with. Netlify is absent
 * because its build refuses to emit the scheduled function without
 * `A2A_SECRET`; Vercel and Cloudflare read theirs only at runtime, so a deploy
 * without one has a trigger that fires and is rejected every minute.
 */
const PLATFORM_TRIGGER_SECRET: Partial<
  Record<PlatformScheduledTriggerDriver, "CRON_SECRET" | "A2A_SECRET">
> = {
  "vercel-cron": "CRON_SECRET",
  "cloudflare-cron-trigger": "A2A_SECRET",
};

export type ScheduledTriggerAvailability =
  | { available: true; driver: ScheduledTriggerDriver }
  | {
      available: false;
      reason: "disabled-by-env" | "no-platform-scheduler" | "local-development";
    }
  | {
      available: false;
      reason: "missing-trigger-secret";
      driver: PlatformScheduledTriggerDriver;
      secret: "CRON_SECRET" | "A2A_SECRET";
    };

function platformScheduledTriggerDriver(
  env: RecurringJobsRuntimeEnv,
  platform: RecurringJobsPlatform,
): PlatformScheduledTriggerDriver | null {
  if (isNetlifyRecurringJobsRuntime(env)) return "netlify-scheduled-function";
  if (platform.cloudflareWorker) return "cloudflare-cron-trigger";
  // Vercel invokes cron jobs only on the production deployment.
  if (
    isTruthyEnv(env.VERCEL) &&
    (env.VERCEL_ENV ?? "production") === "production"
  ) {
    return "vercel-cron";
  }
  return null;
}

export function scheduledTriggerAvailability(
  env: RecurringJobsRuntimeEnv = process.env,
  platform: RecurringJobsPlatform = detectRecurringJobsPlatform(),
): ScheduledTriggerAvailability {
  const driver = platformScheduledTriggerDriver(env, platform);

  if (driver) {
    // The emitted trigger fires on the platform's clock whatever the deployed
    // env says, so the build's decision outranks a runtime-only switch.
    const buildMarker = readRecurringJobsBuildMarker(env);
    const disabled = buildMarker
      ? buildMarker === "disabled"
      : isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS);
    if (disabled) return { available: false, reason: "disabled-by-env" };
    const secret = PLATFORM_TRIGGER_SECRET[driver];
    if (secret && !env[secret]?.trim()) {
      return {
        available: false,
        reason: "missing-trigger-secret",
        driver,
        secret,
      };
    }
    return { available: true, driver };
  }

  if (isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)) {
    return { available: false, reason: "disabled-by-env" };
  }

  if (isServerlessRecurringJobsRuntime(env, platform)) {
    return { available: false, reason: "no-platform-scheduler" };
  }

  return shouldDisableRecurringJobsRuntime(env, platform)
    ? { available: false, reason: "local-development" }
    : { available: true, driver: "in-process" };
}
