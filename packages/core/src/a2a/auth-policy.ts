import { getAppConfig } from "../app-config/index.js";
import {
  isDeployedServerRuntime,
  isLocalPlatformEmulator,
} from "../db/server-runtime.js";

export function isA2AProductionRuntime(): boolean {
  // Emulators set deploy markers, and often NODE_ENV=production, on a
  // developer's machine, so they must lose before any signal below wins.
  if (isLocalPlatformEmulator()) return false;
  if (process.env.NODE_ENV === "production") return true;
  // Hosted invocations and started production server builds, the same answer
  // the database and auth secret refusals use.
  if (isDeployedServerRuntime()) return true;
  if (process.env.NETLIFY === "true") return true;
  if (process.env.CF_PAGES === "1") return true;
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
  if (getAppConfig().a2a.allowUnsignedInternal) return true;
  return opts.loopback === true;
}

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
