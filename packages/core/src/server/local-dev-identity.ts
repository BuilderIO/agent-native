import type { H3Event } from "h3";

import { isLoopbackRequest } from "./loopback.js";

/**
 * The identity every request gets under `AUTH_DISABLED`, which is also the
 * local auto dev account. It belongs to whoever reaches the server, so it is
 * the developer only when the request comes from the developer's own machine.
 */
export const LOCAL_DEV_IDENTITY_EMAIL = "dev@local.test";

/**
 * Pre-`dev@local.test` local dev databases may still hold this account. It is
 * the dev account too, so it never counts as a real signup.
 */
export const LEGACY_LOCAL_DEV_IDENTITY_EMAIL = "dev@local";

export function isLocalDevIdentityEmail(email: string | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return (
    normalized === LOCAL_DEV_IDENTITY_EMAIL ||
    normalized === LEGACY_LOCAL_DEV_IDENTITY_EMAIL
  );
}

/**
 * Whether an MCP or connect credential for `email` must be refused, whether
 * being issued or presented: the local dev identity holds one only on a
 * loopback request, and with no request to check it holds none.
 */
export function refusesLocalDevCredential(
  email: string | undefined,
  event: H3Event | undefined,
): boolean {
  return (
    isLocalDevIdentityEmail(email) && (!event || !isLoopbackRequest(event))
  );
}

export const LOCAL_DEV_CREDENTIAL_REFUSED_MESSAGE =
  "MCP and connect credentials are not issued to the local development identity outside local development. Configure authentication for this deployment, or connect from this machine over localhost.";
