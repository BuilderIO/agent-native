import { getAsyncLocalStorageCtor } from "../shared/optional-node-builtins.js";

/**
 * Migration duty and execution context for schema changes.
 *
 * Keep it separate because `./client.js` and `./ddl-guard.js` both read it;
 * putting the reader on `client.js` would force every client mock to stub an
 * extra export just to keep `ensureTable()` working.
 */

type MigrationRuntimeGlobal = typeof globalThis & {
  __AGENT_NATIVE_MIGRATION_RUNTIME__?: boolean;
};

interface MigrationExecutionStorage {
  getStore(): boolean | undefined;
  run<T>(store: boolean, fn: () => T): T;
}

const AsyncLocalStorage = getAsyncLocalStorageCtor();
let migrationExecutionStorage: MigrationExecutionStorage | undefined =
  AsyncLocalStorage ? new AsyncLocalStorage<boolean>() : undefined;
let migrationExecutionStoragePromise:
  | Promise<MigrationExecutionStorage | undefined>
  | undefined;

function loadMigrationExecutionStorage(): Promise<
  MigrationExecutionStorage | undefined
> {
  if (migrationExecutionStorage)
    return Promise.resolve(migrationExecutionStorage);
  migrationExecutionStoragePromise ??= import("node:async_hooks")
    .then(({ AsyncLocalStorage }) => {
      migrationExecutionStorage = new AsyncLocalStorage<boolean>();
      return migrationExecutionStorage;
    })
    .catch(() => undefined);
  return migrationExecutionStoragePromise;
}

function isLocalFunctionRuntime(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV === "test" ||
    env.NETLIFY_LOCAL === "true" ||
    env.NETLIFY_DEV === "true" ||
    env.AWS_SAM_LOCAL === "true" ||
    env.VERCEL_ENV === "development"
  );
}

function isCloudflareProductionRuntime(env: NodeJS.ProcessEnv): boolean {
  const runtime = globalThis as typeof globalThis & {
    __AGENT_NATIVE_CLOUDFLARE_PRODUCTION__?: boolean;
  };
  return (
    hasCloudflareRuntime() &&
    (runtime.__AGENT_NATIVE_CLOUDFLARE_PRODUCTION__ ??
      env.NODE_ENV === "production")
  );
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
    (env.NODE_ENV !== "development" &&
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

export function isMigrationExecutingRuntime(): boolean {
  return migrationExecutionStorage?.getStore() === true;
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

export async function withMigrationExecutionRuntime<T>(
  run: () => Promise<T>,
): Promise<T> {
  const isHosted = isHostedFunctionInvocationRuntime();
  const storage =
    migrationExecutionStorage ??
    (isHosted ? await loadMigrationExecutionStorage() : undefined);
  if (storage) return storage.run(true, run);
  if (isHosted) {
    throw new Error(
      "AsyncLocalStorage is required to run hosted runtime migrations safely",
    );
  }
  return run();
}
