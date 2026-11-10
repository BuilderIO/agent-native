import type { H3Event } from "h3";

import { registerBackgroundWork } from "./track-invite-accepted.js";

export function trackDomainJoined(input: {
  email: string;
  orgId: string;
  federated: boolean;
  event?: H3Event;
}): Promise<void> {
  let promise: Promise<void>;
  try {
    promise = Promise.all([
      import("../tracking/registry.js"),
      import("../app-config/index.js"),
    ])
      .then(async ([{ track, flushTracking }, { getAppConfig }]) => {
        const app = getAppConfig().app.slug ?? "unknown";
        track(
          "org_domain_joined",
          {
            app,
            template: app,
            org_id: input.orgId,
            role: "member",
            federated: input.federated,
          },
          { userId: input.email },
        );
        await flushTracking();
      })
      .catch(() => {
        console.warn("[org] Could not emit domain join telemetry");
      });
  } catch {
    console.warn("[org] Could not emit domain join telemetry");
    promise = Promise.resolve();
  }
  registerBackgroundWork(input.event, promise);
  return promise;
}
