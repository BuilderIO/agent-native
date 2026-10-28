import type { H3Event } from "h3";

export function registerBackgroundWork(
  event: H3Event | undefined,
  promise: Promise<unknown>,
): void {
  const waitUntil = (
    event as
      | (H3Event & { waitUntil?: (promise: Promise<unknown>) => void })
      | undefined
  )?.waitUntil;
  if (typeof waitUntil === "function") {
    try {
      waitUntil.call(event, promise);
      return;
    } catch (error) {
      void error;
    }
  }
  void promise;
}

export function trackInviteAccepted(input: {
  email: string;
  orgId: string;
  role: string | null;
  invitedBy: string;
  federated: boolean;
  event?: H3Event;
}): Promise<void> {
  let promise: Promise<void>;
  try {
    promise = Promise.all([
      import("../tracking/registry.js"),
      import("../app-config/index.js"),
      import("../server/better-auth-instance.js"),
    ])
      .then(
        async ([
          { track, flushTracking },
          { getAppConfig },
          { getBetterAuthUserIdForEmail },
        ]) => {
          const app = getAppConfig().app.slug ?? "unknown";
          const referrerUser = await getBetterAuthUserIdForEmail(
            input.invitedBy,
          );
          track(
            "invite_accepted",
            {
              app,
              template: app,
              org_id: input.orgId,
              role: input.role === "admin" ? "admin" : "member",
              ...(referrerUser ? { referrer_user: referrerUser } : {}),
              federated: input.federated,
            },
            { userId: input.email },
          );
          await flushTracking();
        },
      )
      .catch(() => {
        console.warn("[org] Could not emit invite acceptance telemetry");
      });
  } catch {
    console.warn("[org] Could not emit invite acceptance telemetry");
    promise = Promise.resolve();
  }
  registerBackgroundWork(input.event, promise);
  return promise;
}
