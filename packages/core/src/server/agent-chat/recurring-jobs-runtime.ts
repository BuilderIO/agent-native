
type RecurringJobsRuntimeEnvKey =
  | "AGENT_NATIVE_BUILD_RECURRING_JOBS"
  | "AGENT_NATIVE_DISABLE_RECURRING_JOBS"
  | "AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS"
  | "APP_URL"
  | "BETTER_AUTH_URL"
  | "CF_PAGES"
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
  | "VITE_APP_URL"
  | "VITE_WORKSPACE_GATEWAY_URL"
  | "WORKSPACE_GATEWAY_URL";

type RecurringJobsRuntimeEnv = Partial<
  Record<RecurringJobsRuntimeEnvKey, string | undefined>
>;

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
): boolean {
  return (
    env.NETLIFY_LOCAL !== "true" &&
    (isTruthyEnv(env.NETLIFY) ||
      env.NITRO_PRESET === "netlify" ||
      Boolean(env.AWS_LAMBDA_FUNCTION_NAME) ||
      env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
      isTruthyEnv(env.CF_PAGES) ||
      isTruthyEnv(env.VERCEL))
  );
}

export function shouldDisableRecurringJobsRuntime(
  env: RecurringJobsRuntimeEnv = process.env,
): boolean {
  if (isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)) return true;

  if (isServerlessRecurringJobsRuntime(env)) return true;

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
    process.env.AGENT_NATIVE_BUILD_RECURRING_JOBS;
  const value = raw?.trim();
  return value === "enabled" || value === "disabled" ? value : undefined;
}

export type ScheduledTriggerAvailability =
  | { available: true; driver: "netlify-scheduled-function" | "in-process" }
  | {
      available: false;
      reason: "disabled-by-env" | "no-platform-scheduler" | "local-development";
    };

/**
 * Whether ANY driver will actually fire a schedule-triggered automation in this
 * deploy. Distinct from `shouldDisableRecurringJobsRuntime`, which answers the
 * narrower "should THIS process run an in-process timer" and is therefore `true`
 * on hosted Netlify even though schedules do fire there via the emitted
 * scheduled function — reporting that value to a user would call the one
 * working production runtime broken.
 *
 * Each branch reads the scope that actually decides its driver. The Netlify
 * driver is a BUILD artifact, so it is answered by the build marker; every other
 * driver is an in-process timer started from the RUNTIME env, so it is answered
 * by the runtime flag. Reading runtime-only platform markers for the Netlify
 * branch would report `available` off a build that emitted no trigger at all.
 */
export function scheduledTriggerAvailability(
  env: RecurringJobsRuntimeEnv = process.env,
): ScheduledTriggerAvailability {
  const buildMarker = readRecurringJobsBuildMarker(env);

  if (isNetlifyRecurringJobsRuntime(env)) {
    if (buildMarker === "disabled") {
      return { available: false, reason: "disabled-by-env" };
    }
    if (buildMarker === "enabled") {
      return { available: true, driver: "netlify-scheduled-function" };
    }
    return isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)
      ? { available: false, reason: "disabled-by-env" }
      : { available: true, driver: "netlify-scheduled-function" };
  }

  if (isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)) {
    return { available: false, reason: "disabled-by-env" };
  }

  if (isServerlessRecurringJobsRuntime(env)) {
    return { available: false, reason: "no-platform-scheduler" };
  }

  return shouldDisableRecurringJobsRuntime(env)
    ? { available: false, reason: "local-development" }
    : { available: true, driver: "in-process" };
}
