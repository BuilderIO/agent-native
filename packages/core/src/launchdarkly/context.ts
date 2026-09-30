export interface LaunchDarklyActor {
  userEmail?: string | null;
  orgId?: string | null;
  anonymousId?: string | null;
}

export interface LaunchDarklyContext {
  kind: "user";
  key: string;
  anonymous: boolean;
  orgId?: string;
}

export function buildLaunchDarklyContext(
  actor: LaunchDarklyActor,
): LaunchDarklyContext {
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
