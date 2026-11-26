import type { H3Event } from "h3";

import { isLoopbackRequest } from "./loopback.js";
import {
  getRequestIsLoopback,
  getRequestRunContext,
} from "./request-context.js";

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
 * Where to read whether the request is loopback: the H3 event, for a route
 * handler, or `"request-context"`, for code running inside the request context
 * (actions and the helpers they call). `undefined` means there is no request to
 * check.
 */
export type LocalDevCredentialRequest = H3Event | "request-context" | undefined;

/**
 * Whether a credential for `email` must be refused, whether being issued or
 * presented: the local dev identity holds one only on a loopback request, and
 * with no request to check it holds none. A background worker's request is
 * server-to-server, so a loopback address on it is not the developer's machine
 * and the identity is refused there too. Every credential path for the dev
 * identity goes through this check.
 */
export function refusesLocalDevCredential(
  email: string | undefined,
  request: LocalDevCredentialRequest,
): boolean {
  if (!isLocalDevIdentityEmail(email)) return false;
  if (getRequestRunContext()?.isBackgroundWorker === true) return true;
  if (request === "request-context") return !getRequestIsLoopback();
  return !request || !isLoopbackRequest(request);
}

export const LOCAL_DEV_CREDENTIAL_REFUSED_MESSAGE =
  "Credentials are not issued to the local development identity outside local development. Configure authentication for this deployment, or connect from this machine over localhost.";

export class LocalDevCredentialRefusedError extends Error {
  readonly statusCode = 403;
  constructor() {
    super(LOCAL_DEV_CREDENTIAL_REFUSED_MESSAGE);
    this.name = "LocalDevCredentialRefusedError";
  }
}

/** Throws `LocalDevCredentialRefusedError` when `refusesLocalDevCredential` refuses. */
export function assertLocalDevCredentialIssuable(
  email: string | undefined,
  request: LocalDevCredentialRequest,
): void {
  if (refusesLocalDevCredential(email, request)) {
    throw new LocalDevCredentialRefusedError();
  }
}
