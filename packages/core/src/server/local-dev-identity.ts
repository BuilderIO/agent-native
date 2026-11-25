/**
 * The identity every request gets under `AUTH_DISABLED`, which is also the
 * local auto dev account. It belongs to whoever reaches the server, so it is
 * the developer only when the request comes from the developer's own machine
 * (`isLoopbackRequest`).
 */
export const LOCAL_DEV_IDENTITY_EMAIL = "dev@local.test";

const LEGACY_LOCAL_DEV_IDENTITY_EMAIL = "dev@local";

export function isLocalDevIdentityEmail(email: string | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return (
    normalized === LOCAL_DEV_IDENTITY_EMAIL ||
    normalized === LEGACY_LOCAL_DEV_IDENTITY_EMAIL
  );
}

/**
 * Whether a session is the `AUTH_DISABLED` identity or the local dev account.
 * Such a session may be issued MCP or connect credentials only on a loopback
 * request.
 */
export function isLocalDevSession(session: {
  email: string;
  authDisabled?: true;
}): boolean {
  return (
    session.authDisabled === true || isLocalDevIdentityEmail(session.email)
  );
}

export const LOCAL_DEV_CREDENTIAL_REFUSED_MESSAGE =
  "MCP and connect credentials are not issued to the local development identity outside local development. Configure authentication for this deployment, or connect from this machine over localhost.";
