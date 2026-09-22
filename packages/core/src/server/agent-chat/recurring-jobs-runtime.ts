// ---------------------------------------------------------------------------
// Recurring-jobs runtime gating: decide whether this process should run the
// local recurring-job scheduler loop (disabled by default on hosted/serverless
// runtimes, enabled by default for local/dev).
// ---------------------------------------------------------------------------

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

/** What the BUILD decided about recurring jobs, as carried into the runtime. */
export type RecurringJobsBuildMarker = "enabled" | "disabled";

/**
 * Env name the build embeds its recurring-jobs decision under.
 *
 * Netlify's scheduled function is emitted — or omitted — while the build runs,
 * and a deployed serverless runtime never sees the build environment. So the
 * build has to hand the decision over explicitly; nothing observable at runtime
 * can reconstruct it. Consumed below as a LITERAL `process.env.<name>` member
 * expression because that is the only form Vite's `define` and Nitro's
 * `replace` inline at build time.
 */
export const RECURRING_JOBS_BUILD_MARKER_ENV_VAR =
  "AGENT_NATIVE_BUILD_RECURRING_JOBS";

/**
 * Build-side resolver: what the build environment decided. Shared with
 * `isRecurringJobsDeployEnabled` in the deploy build so the gate that emits the
 * scheduled function and the marker that reports it cannot disagree.
 */
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

  // Netlify: the driver IS the emitted scheduled function. It fires on the
  // platform's clock without consulting the deployed env, and no runtime value
  // can conjure it back once the build omitted it — so the build marker is the
  // only honest input here, in both directions.
  if (isNetlifyRecurringJobsRuntime(env)) {
    if (buildMarker === "disabled") {
      return { available: false, reason: "disabled-by-env" };
    }
    if (buildMarker === "enabled") {
      return { available: true, driver: "netlify-scheduled-function" };
    }
    // No marker: a build predating it, or a caller passing a synthetic env.
    // Fall back to the runtime flag, which only agrees with the build when the
    // pipeline sets the same value in both scopes.
    return isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)
      ? { available: false, reason: "disabled-by-env" }
      : { available: true, driver: "netlify-scheduled-function" };
  }

  // Everything below is driven by an in-process timer, and the runtime flag is
  // what `shouldDisableRecurringJobsRuntime` reads before starting it. A build
  // marker cannot speak for this branch: a build with recurring jobs turned off
  // still starts the timer if the deployed env does not repeat the switch.
  if (isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)) {
    return { available: false, reason: "disabled-by-env" };
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
