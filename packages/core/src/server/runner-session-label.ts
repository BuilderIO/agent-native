/** Stored as the Better Auth `session.user_agent` of runner sign-ins. */
export const RUNNER_SESSION_LABEL = "runner";

interface SessionUpdateContext {
  context?: {
    session?: {
      session?: { userAgent?: unknown; expiresAt?: unknown } | null;
    } | null;
  } | null;
}

/**
 * Better Auth's session read pushes `expiresAt` out to the full session max
 * age once a session is older than `updateAge`, and a short session is past
 * that from the moment it is minted. A runner session keeps the expiry it was
 * minted with.
 */
export function keepRunnerSessionExpiry(
  data: { expiresAt?: unknown },
  endpoint: SessionUpdateContext | null | undefined,
): { data: { expiresAt: Date } } | undefined {
  const current = endpoint?.context?.session?.session;
  if (current?.userAgent !== RUNNER_SESSION_LABEL) return undefined;
  if (data.expiresAt === undefined) return undefined;
  const expiresAt =
    current.expiresAt instanceof Date
      ? current.expiresAt
      : new Date(String(current.expiresAt));
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Runner session has no readable expiry.");
  }
  return { data: { expiresAt } };
}
