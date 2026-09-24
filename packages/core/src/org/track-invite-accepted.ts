export function trackInviteAccepted(input: {
  email: string;
  orgId: string;
  role: string | null;
  invitedBy: string;
  federated: boolean;
}): void {
  try {
    void Promise.all([
      import("../tracking/registry.js"),
      import("../app-config/index.js"),
      import("../server/better-auth-instance.js"),
    ])
      .then(
        async ([
          { track },
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
        },
      )
      .catch(() => {
        console.warn("[org] Could not emit invite acceptance telemetry");
      });
  } catch {
    // Analytics must not turn an accepted invitation into a failed request.
    console.warn("[org] Could not emit invite acceptance telemetry");
  }
}
