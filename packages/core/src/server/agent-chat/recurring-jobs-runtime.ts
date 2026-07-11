// ---------------------------------------------------------------------------
// Recurring-jobs runtime gating: decide whether this process should run the
// local recurring-job scheduler loop (disabled by default on hosted runtimes
// that already run a dedicated sweep, enabled by default for local/dev).
// ---------------------------------------------------------------------------

type RecurringJobsRuntimeEnvKey =
  | "AGENT_NATIVE_DISABLE_RECURRING_JOBS"
  | "AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS"
  | "APP_URL"
  | "BETTER_AUTH_URL"
  | "DEPLOY_URL"
  | "NODE_ENV"
  | "URL"
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

export function shouldDisableRecurringJobsRuntime(
  env: RecurringJobsRuntimeEnv = process.env,
): boolean {
  if (isTruthyEnv(env.AGENT_NATIVE_DISABLE_RECURRING_JOBS)) return true;

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
