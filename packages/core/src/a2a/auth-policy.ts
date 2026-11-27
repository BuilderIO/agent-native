import type { H3Event } from "h3";

import { getAppConfig } from "../app-config/index.js";
import {
  isDeployedServerRuntime,
  isLocalPlatformEmulator,
} from "../db/server-runtime.js";
import {
  isLoopbackRequest,
  isLoopbackTrustedEnvironment,
  isLoopbackUrl,
} from "../server/loopback.js";

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
 * True only when an unsigned request may be served: no secret can
 * authenticate it, so it must come from this machine in a local runtime.
 * Production never qualifies. `A2A_ALLOW_UNSIGNED_INTERNAL=1` is the explicit
 * opt-in for an unrecognized non-production host.
 */
export function isTrustedLocalRequest(event: H3Event | undefined): boolean {
  if (isA2AProductionRuntime()) return false;
  if (getAppConfig().a2a.allowUnsignedInternal) return true;
  return event !== undefined && isLoopbackRequest(event);
}

/**
 * Whether this server's processor routes will accept an unsigned handoff
 * sent to `baseUrl`. `canSendProcessorHandoff` is the check a dispatcher runs.
 */
export function acceptsUnsignedSelfDispatch(baseUrl: string): boolean {
  if (isA2AProductionRuntime()) return false;
  if (getAppConfig().a2a.allowUnsignedInternal) return true;
  return isLoopbackTrustedEnvironment() && isLoopbackUrl(baseUrl);
}

export const UNSIGNED_REMOTE_REQUEST_REFUSED =
  "A2A_SECRET is not set, so this app accepts unsigned requests only from this machine. Set A2A_SECRET to accept requests from other hosts.";
