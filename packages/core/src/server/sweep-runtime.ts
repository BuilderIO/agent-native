
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

export function shouldDisableInProcessSweeps(
  env: SweepRuntimeEnv = process.env,
): boolean {
  if (isProductionServerlessFunction(env)) return true;
  return isTruthyEnv(env.AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS);
}
