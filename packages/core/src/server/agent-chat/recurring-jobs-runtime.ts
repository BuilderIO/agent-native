// ---------------------------------------------------------------------------
// Recurring-jobs runtime gating: decide whether this process should run the
// local recurring-job scheduler loop (disabled by default on hosted/serverless
// runtimes, enabled by default for local/dev).
// ---------------------------------------------------------------------------

type RecurringJobsRuntimeEnvKey =
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

/**
 * A serverless isolate is not a durable scheduler. Shared so
 * `shouldDisableRecurringJobsRuntime` and `scheduledTriggerAvailability` cannot
 * drift on what counts as serverless.
 */
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

  // Keep this check separate from the platform-specific scheduler branch below
  // so a new sweep cannot accidentally start an in-process timer before its
  // platform trigger exists.
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

/**
 * Hosted Netlify deploys get a durable scheduled sweep emitted by the build.
 * The in-process timer must stay off there: a scale-to-zero recycle destroys
 * that timer, which is exactly the failure mode the emitted sweep fixes.
 */
export function isNetlifyRecurringJobsRuntime(
  env: RecurringJobsRuntimeEnv = process.env,
): boolean {
  if (env.NETLIFY_LOCAL === "true") return false;
  if (env.NETLIFY === "false") return false;
  return Boolean((env.NETLIFY && env.NETLIFY !== "false") || env.SITE_ID);
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
 * CAVEAT — this reads the RUNTIME env, so it can only see
 * `AGENT_NATIVE_DISABLE_RECURRING_JOBS` if the deploy pipeline propagated the
 * same value it used at build time into the deployed runtime env. Builder's
 * hosting pipeline does (`applyHostedProdEnvDefaults` layers the identical
 * default into the Netlify site env). A pipeline that sets it only for the build
 * makes this report optimistically — available when nothing will fire — so
 * propagating both scopes is a requirement of this signal, not redundancy.
 */
export function scheduledTriggerAvailability(
  env: RecurringJobsRuntimeEnv = process.env,
): ScheduledTriggerAvailability {
  // The build kill switch removes the emitted scheduled function AND keeps the
  // in-process timer off, so no driver of any kind survives it.
  if (isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)) {
    return { available: false, reason: "disabled-by-env" };
  }

  if (isNetlifyRecurringJobsRuntime(env)) {
    return { available: true, driver: "netlify-scheduled-function" };
  }

  // Every other serverless host: the build emits a scheduled trigger only for
  // Netlify, and a frozen isolate cannot hold a timer.
  if (isServerlessRecurringJobsRuntime(env)) {
    return { available: false, reason: "no-platform-scheduler" };
  }

  // Long-lived host. Whatever is left of the runtime gate here is the
  // local/loopback branch, which needs AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS.
  return shouldDisableRecurringJobsRuntime(env)
    ? { available: false, reason: "local-development" }
    : { available: true, driver: "in-process" };
}
