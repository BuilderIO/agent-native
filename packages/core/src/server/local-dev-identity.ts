/**
 * The identity every request gets under `AUTH_DISABLED`, which is also the
 * local auto dev account.
 */
export const LOCAL_DEV_IDENTITY_EMAIL = "dev@local.test";

/** The auto dev account's address in older local databases. */
export const LEGACY_LOCAL_DEV_IDENTITY_EMAIL = "dev@local";

/** Whether `email` is the local development identity. */
export function isLocalDevIdentityEmail(email: string | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return (
    normalized === LOCAL_DEV_IDENTITY_EMAIL ||
    normalized === LEGACY_LOCAL_DEV_IDENTITY_EMAIL
  );
}
