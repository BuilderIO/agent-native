import type { LDContext } from "@launchdarkly/node-server-sdk";

export interface LaunchDarklyActor {
  userEmail?: string | null;
  orgId?: string | null;
}

// Anonymous callers evaluate with no identity — matching the framework's own
// feature-flags rule that anonymous callers can't participate in
// identity-based targeting.
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
