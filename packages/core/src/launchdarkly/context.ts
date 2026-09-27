import type { LDContext } from "@launchdarkly/node-server-sdk";

export interface LaunchDarklyActor {
  userEmail?: string | null;
  orgId?: string | null;
  // A stable per-device/session id for a caller with no signed-in identity.
  // Without one, every anonymous caller shares a single "anonymous" bucket,
  // so LaunchDarkly percentage targeting cannot differentiate them.
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
  // Falls back to one shared bucket when the caller has no stable identifier
  // of its own — accurate for a cron/CLI caller, but means percentage
  // targeting won't distinguish anonymous browser visitors unless they pass
  // `anonymousId`.
  const anonymousId = actor.anonymousId?.trim();
  return { kind: "user", key: anonymousId || "anonymous", anonymous: true };
}
