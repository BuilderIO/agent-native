import { createHash } from "node:crypto";

import { IPC } from "../../shared/ipc-channels.js";

/**
 * An opaque key for one signed-in account, so onboarding state saved under it
 * never carries over to another account on the same machine.
 */
export function onboardingIdentityScope(
  identity: { status: string; email: string | null } | null,
): string {
  const email = identity?.email?.trim().toLowerCase();
  if (identity?.status !== "signed-in" || !email)
    throw new Error("A verified desktop identity is required for onboarding");
  return createHash("sha256")
    .update(`desktop-onboarding-v1\0${email}`)
    .digest("hex");
}

export function registerOnboardingIdentityIpc<E>(
  ipc: {
    handle(channel: string, listener: (event: E) => Promise<string>): void;
  },
  options: {
    isShell(event: E): boolean;
    identity(): { status: string; email: string | null } | null;
  },
): void {
  ipc.handle(IPC.IDENTITY_ONBOARDING_SCOPE_GET, async (event) => {
    if (!options.isShell(event))
      throw new Error("Onboarding identity is not available to this sender");
    return onboardingIdentityScope(options.identity());
  });
}
