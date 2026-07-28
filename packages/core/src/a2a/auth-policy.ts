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
 * True when the process is a positively-identified developer/test runtime
 * (NODE_ENV explicitly `development` or `test`). We deliberately do NOT treat
 * an *unset* NODE_ENV as dev: a bare self-hosted Docker/VPS/K8s deployment
 * that forgot to set NODE_ENV must fall through to the fail-closed path so
 * that a local reverse proxy (Nginx/Caddy) forwarding public traffic to an
 * app bound on 127.0.0.1 cannot silently satisfy the loopback gate.
 */
function isExplicitDevRuntime(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

/**
 * True only when unsigned internal self-dispatch is acceptable. This is the
 * gate for anonymous A2A/JSON-RPC when no `A2A_SECRET` and no `apiKeyEnv` is
 * configured. To pass:
 *
 *   - the runtime must NOT look like production/a recognized cloud host, AND
 *   - EITHER the operator explicitly opted in with
 *     `A2A_ALLOW_UNSIGNED_INTERNAL=1` (documented, deliberate),
 *   - OR the request arrived over the loopback interface AND `NODE_ENV` is
 *     explicitly `development` / `test` (positive dev signal, not just
 *     "unrecognized runtime").
 *
 * The `NODE_ENV=development|test` requirement is what closes the
 * reverse-proxy hole: on a self-hosted VPS/Docker box where the operator
 * runs the app bound to 127.0.0.1 behind Nginx/Caddy WITHOUT setting
 * NODE_ENV, every public request would otherwise appear as a loopback peer
 * and satisfy an "is-local" check. Requiring an explicit dev signal makes
 * the operator opt in either through NODE_ENV or through
 * A2A_ALLOW_UNSIGNED_INTERNAL — an unset NODE_ENV alone is not a trust
 * grant.
 */
export function isTrustedLocalRuntime(opts: { loopback: boolean }): boolean {
  if (isA2AProductionRuntime()) return false;
  if (process.env.A2A_ALLOW_UNSIGNED_INTERNAL === "1") return true;
  return opts.loopback === true && isExplicitDevRuntime();
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
