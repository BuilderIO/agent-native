import type { H3Event } from "h3";

/**
 * Register a background promise with the request's `waitUntil` when the
 * runtime provides one (Netlify/Cloudflare via the `deploy/build.ts`
 * platform shims), so a serverless function doesn't freeze the instant the
 * response flushes, before a fire-and-forget promise gets to run. Falls back
 * to a plain fire-and-forget when no event is given, or the event's
 * `waitUntil` isn't a function (a long-lived Node process, or a test shim).
 */
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
      // Some local adapters expose a non-functional placeholder. Fall
      // through to a plain fire-and-forget instead of losing the promise.
      void error;
    }
  }
  void promise;
}

/**
 * Fire-and-forget `invite_accepted` telemetry. Pass `event` whenever the
 * caller has an h3 event so the promise is registered with the request's
 * `waitUntil` (see `registerBackgroundWork`) instead of racing serverless
 * shutdown. Callers with no reachable event (the Better Auth signup/SSO
 * hooks that route through `acceptPendingInvitationsForEmail`) still get the
 * returned promise back so they can bound how long they wait on it.
 */
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
          // `track()` only dispatches; hold `waitUntil` until providers deliver.
          await flushTracking();
        },
      )
      .catch(() => {
        console.warn("[org] Could not emit invite acceptance telemetry");
      });
  } catch {
    // Analytics must not turn an accepted invitation into a failed request.
    console.warn("[org] Could not emit invite acceptance telemetry");
    promise = Promise.resolve();
  }
  registerBackgroundWork(input.event, promise);
  return promise;
}
