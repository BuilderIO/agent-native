import type { LDContext } from "@launchdarkly/node-server-sdk";

export interface LaunchDarklyActor {
  userEmail?: string | null;
  orgId?: string | null;
  anonymousId?: string | null;
}

export function buildLaunchDarklyContext(actor: LaunchDarklyActor): LDContext {
  const email = actor.userEmail?.trim().toLowerCase();
  if (email) {
    return {
      kind: "user",
      key: email,
      anonymous: false,
      ...(actor.orgId ? { orgId: actor.orgId } : {}),
    };
  }
  const anonymousId = actor.anonymousId?.trim();
  return { kind: "user", key: anonymousId || "anonymous", anonymous: true };
}
