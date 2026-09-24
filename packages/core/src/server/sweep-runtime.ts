// ---------------------------------------------------------------------------
// Gating for the in-process backstop sweep timers (automation redispatch,
// agent-teams orphan reconciliation, durable sandbox executions).
// ---------------------------------------------------------------------------

type SweepRuntimeEnvKey =
  | "AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS"
  | "AWS_LAMBDA_FUNCTION_NAME"
  | "AWS_LAMBDA_FUNCTION_VERSION"
  | "AWS_EXECUTION_ENV"
  | "LAMBDA_TASK_ROOT"
  | "NETLIFY"
  | "NETLIFY_FUNCTION_NAME"
  | "NETLIFY_LOCAL"
  | "NODE_ENV"
  | "VERCEL_FUNCTION_ID"
  | "VERCEL_REGION";

type SweepRuntimeEnv = Partial<Record<SweepRuntimeEnvKey, string | undefined>>;

function isTruthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function isProductionServerlessFunction(env: SweepRuntimeEnv): boolean {
  if (env.NODE_ENV !== "production" || env.NETLIFY_LOCAL === "true") {
    return false;
  }
  return Boolean(
    env.NETLIFY === "true" ||
    env.NETLIFY_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_VERSION ||
    env.LAMBDA_TASK_ROOT ||
    env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    env.VERCEL_FUNCTION_ID ||
    env.VERCEL_REGION,
  );
}

/**
 * Kill switch for the `setInterval` backstop sweeps.
 *
 * These timers are correct on a long-lived Node server: one process, one timer
 * set, one query per tick. On a serverless host they are billed per WARM
 * CONTAINER, not per deployment — every warm instance independently runs the
 * whole timer set, so the sweep query rate scales with instance count, which no
 * in-process backoff or `lastSweep` guard can observe. A production sample
 * showed one 2-minute sweep issuing 237k queries, implying ~11 containers each
 * ticking forever against a database that then never gets to autosuspend.
 *
 * Default OFF (sweeps run), because on every host where the timers are the only
 * thing driving recovery, disabling them silently strands queued work. Turn this
 * on ONLY where a durable platform scheduler already drives the same recovery —
 * the shape `isNetlifyRecurringJobsRuntime` + the emitted scheduled sweep
 * already implement for recurring jobs, and which these three sweeps should
 * eventually adopt instead of needing this switch at all.
 */
export function shouldDisableInProcessSweeps(
  env: SweepRuntimeEnv = process.env,
): boolean {
  if (isProductionServerlessFunction(env)) return true;
  return isTruthyEnv(env.AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS);
}
