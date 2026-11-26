import {
  getRequestContext,
  getRequestRunContext,
} from "../server/request-context.js";

const LOCAL_DEV_IDENTITY_EMAILS = new Set(["dev@local.test", "dev@local"]);

export const LOCAL_DEV_ORG_CREDENTIAL_REFUSED_MESSAGE =
  "Organization service tokens are not issued to the local development identity outside local development. Configure authentication for this deployment, or run this from this machine over localhost.";

export class LocalDevOrgCredentialRefusedError extends Error {
  readonly statusCode = 403;
  constructor() {
    super(LOCAL_DEV_ORG_CREDENTIAL_REFUSED_MESSAGE);
    this.name = "LocalDevOrgCredentialRefusedError";
  }
}

function isLocalDevIdentityEmail(email: string | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return !!normalized && LOCAL_DEV_IDENTITY_EMAILS.has(normalized);
}

function isTrustedLoopbackRequest(): boolean {
  if (getRequestContext()?.isLoopbackRequest !== true) return false;
  return getRequestRunContext()?.isBackgroundWorker !== true;
}

/**
 * Throws when `email` is the local development identity (the `AUTH_DISABLED`
 * session, or the local auto dev account) and the current request is not a
 * loopback request. With no request context, or in a background worker, the
 * identity alone is refused. Any other identity passes.
 */
export function assertOrgCredentialIssuableTo(email: string | undefined): void {
  if (isLocalDevIdentityEmail(email) && !isTrustedLoopbackRequest()) {
    throw new LocalDevOrgCredentialRefusedError();
  }
}
