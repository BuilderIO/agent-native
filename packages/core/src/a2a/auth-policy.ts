import { getAppConfig } from "../app-config/index.js";

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
  if ("__cf_env" in globalThis || "__env__" in globalThis) return true;
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
