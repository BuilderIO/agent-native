import type { LDContext } from "@launchdarkly/node-server-sdk";

/** Minimal identity LaunchDarkly needs to evaluate a flag for a caller. */
export interface LaunchDarklyActor {
  userEmail?: string | null;
  orgId?: string | null;
}

/**
 * Builds the LaunchDarkly evaluation context for the current caller.
 *
 * A signed-in caller evaluates as a `user` context keyed by their normalized
 * email, with `orgId` carried as a custom attribute for org-level targeting in
 * LaunchDarkly. A caller with no resolved identity evaluates as anonymous —
 * matching the framework's own feature-flags rule that anonymous callers
 * cannot participate in identity-based targeting.
 */
export function buildLaunchDarklyContext(actor: LaunchDarklyActor): LDContext {
  const email = actor.userEmail?.trim().toLowerCase();
  if (!email) {
    return { kind: "user", key: "anonymous", anonymous: true };
  }
  return {
    kind: "user",
    key: email,
    anonymous: false,
    ...(actor.orgId ? { orgId: actor.orgId } : {}),
  };
}
