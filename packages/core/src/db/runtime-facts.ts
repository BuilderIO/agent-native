/**
 * Dependency-free database runtime facts. Kept out of `./client.js` so the
 * store runner does not require every `vi.mock("../db/client.js")` to stub them.
 */

export async function retryOnDdlRace<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (!isPgCatalogRace(e)) throw e;
    return await fn();
  }
}

function isPgCatalogRace(e: any): boolean {
  const msg = String(e?.message ?? "");
  if (e?.code === "42P07") return true;
  if (e?.code === "42710") {
    const routine = String(e?.routine ?? "");
    return routine === "TypeCreate" || /type .* already exists/i.test(msg);
  }
  if (e?.code !== "23505") return false;
  const constraint = String(e?.constraint_name ?? e?.constraint ?? "");
  const detail = String(e?.detail ?? "");
  return (
    constraint.startsWith("pg_type") ||
    constraint.startsWith("pg_class") ||
    detail.includes("pg_type") ||
    detail.includes("pg_class") ||
    /relation .* already exists/i.test(msg)
  );
}

export function isProductionServerlessFunctionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
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
    env.VERCEL_REGION ||
    env.VERCEL === "1",
  );
}
