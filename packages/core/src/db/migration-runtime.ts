/**
 * Migration duty: the process-local claim that the current call is allowed to
 * create or alter schema.
 *
 * Its own module, and deliberately dependency-free, because both `./client.js`
 * and `./ddl-guard.js` need to read it. Putting the reader on `client.js` would
 * mean every `vi.mock("../db/client.js")` in the codebase has to stub one more
 * export to keep `ensureTable()` working — the exact coupling `ddl-guard.ts`
 * was split out to avoid.
 */

type MigrationRuntimeGlobal = typeof globalThis & {
  __AGENT_NATIVE_MIGRATION_RUNTIME__?: boolean;
};

function isLocalFunctionRuntime(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV === "test" ||
    env.NODE_ENV === "development" ||
    env.NETLIFY_LOCAL === "true" ||
    env.VERCEL_ENV === "development"
  );
}

function isCloudflareProductionRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" && hasCloudflareRuntime();
}

export function hasCloudflareRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __cf_env?: unknown;
    __env__?: unknown;
  };
  return runtime.__cf_env !== undefined || runtime.__env__ !== undefined;
}

export function isProductionServerlessFunctionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isLocalFunctionRuntime(env)) return false;

  return Boolean(
    isCloudflareProductionRuntime(env) ||
    env.NETLIFY_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_VERSION ||
    env.LAMBDA_TASK_ROOT ||
    env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    env.VERCEL_FUNCTION_ID ||
    env.VERCEL_REGION ||
    (env.NODE_ENV === "production" &&
      (env.NETLIFY === "true" || env.VERCEL === "1")),
  );
}

export function isHostedFunctionInvocationRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isLocalFunctionRuntime(env)) return false;

  return Boolean(
    isCloudflareProductionRuntime(env) ||
    env.NETLIFY_FUNCTION_NAME ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.LAMBDA_TASK_ROOT ||
    env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    env.VERCEL_FUNCTION_ID ||
    env.VERCEL_REGION,
  );
}

export function isMigrationAuthorizedRuntime(): boolean {
  return (
    (globalThis as MigrationRuntimeGlobal)
      .__AGENT_NATIVE_MIGRATION_RUNTIME__ === true
  );
}

export async function withMigrationRuntime<T>(
  run: () => Promise<T>,
): Promise<T> {
  const runtime = globalThis as MigrationRuntimeGlobal;
  const previous = runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__;
  runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__ = true;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__;
    } else {
      runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__ = previous;
    }
  }
}
