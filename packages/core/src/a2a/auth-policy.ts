/**
 * A2A auth policy helpers shared by discovery, the JSON-RPC gate, and task
 * handlers. Serverless providers do not always expose `NODE_ENV=production`
 * consistently at runtime, so production-like A2A checks also look at the
 * provider flags those platforms set in deployed functions.
 */
export function isA2AProductionRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.NETLIFY === "true" && process.env.NETLIFY_LOCAL !== "true") {
    return true;
  }
  if (
    process.env.AWS_LAMBDA_FUNCTION_NAME &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  if (process.env.CF_PAGES === "1") return true;
  if ("__cf_env" in globalThis) return true;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return true;
  if (process.env.RENDER || process.env.FLY_APP_NAME || process.env.K_SERVICE) {
    return true;
  }
  return false;
}

export function hasConfiguredA2ASecret(): boolean {
  return !!process.env.A2A_SECRET?.trim();
}

export function shouldAdvertiseJwtA2AAuth(): boolean {
  return hasConfiguredA2ASecret() || isA2AProductionRuntime();
}
