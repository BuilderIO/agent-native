/**
 * Client-side mirror of the framework's dev-mode bypass identity.
 *
 * Mirrors `DEV_MODE_USER_EMAIL` from `packages/core/src/server/auth.ts`
 * (the source of truth) so that React components and other client code
 * can compare against it without importing from server-only modules.
 *
 * Use this when a client component needs to show / hide UI that is only
 * meaningful when the user is running in local/dev mode (e.g. the
 * "Migrate local data" prompt, the dev-only sign-in card, or hiding the
 * org switcher when there is no real account yet).
 */
export const DEV_MODE_USER_EMAIL = "local@localhost"; // guard:allow-localhost-fallback — client-side mirror of the framework dev-mode identity defined in server/auth.ts; not a session-pooling fallback
