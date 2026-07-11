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

/**
 * True only when unsigned internal self-dispatch is acceptable: no A2A_SECRET
 * is configured AND we can positively identify a local/dev runtime. Everything
 * else — production, or any UNRECOGNIZED deployed/networked host — must fail
 * closed and require A2A_SECRET. `loopback` should be whether the inbound
 * request arrived over the loopback interface (127.0.0.1/::1); callers that
 * cannot determine the peer address pass `false`.
 *
 * NODE_ENV alone is deliberately NOT a trust grant: a self-hosted deployment
 * that doesn't set NODE_ENV=production and isn't recognized by
 * `isA2AProductionRuntime()` (a bare Docker/VPS/K8s pod) must still fail
 * closed unless the request actually came from loopback or the explicit
 * opt-in flag is set.
 */
export function isTrustedLocalRuntime(opts: { loopback: boolean }): boolean {
  if (isA2AProductionRuntime()) return false;
  if (process.env.A2A_ALLOW_UNSIGNED_INTERNAL === "1") return true;
  return opts.loopback === true;
}

/** True if a socket peer address is a loopback/local address. */
export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const a = addr.trim();
  return (
    a === "127.0.0.1" ||
    a === "::1" ||
    a === "::ffff:127.0.0.1" ||
    a.startsWith("127.") ||
    a === "localhost"
  );
}
