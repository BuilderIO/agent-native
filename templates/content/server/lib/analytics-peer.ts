/**
 * Content's side of an Analytics chart kept in a page: where Analytics is,
 * and the one call that asks it, as the signed-in person, for a panel's
 * numbers or a dashboard's sharing. Analytics checks that person's access to
 * the dashboard; Content never sees the data source.
 */
import type { ZodType } from "zod";

import {
  peerLinkOrigins,
  requestPeerApp,
  resolvePeerAppUrl,
  type PeerAppResult,
} from "./app-peer.js";

/** The deployment's built-in Analytics, on Content's own lane. */
export function resolveAnalyticsAppUrl(): string | null {
  return resolvePeerAppUrl("analytics");
}

/**
 * The Analytics app URLs a pasted panel link may name. Beta and production
 * Analytics share one database, so a link from either names the same panel.
 */
export function analyticsLinkOrigins(): string[] {
  return peerLinkOrigins("analytics");
}

export type AnalyticsPeerResult<T> = PeerAppResult<T, "analytics">;

/**
 * Calls one of Analytics' read-only actions as the signed-in person and
 * checks the answer against `schema`. Never throws for Analytics' failures.
 * `orgId` is the organization that let them open the page, which for a page
 * in a space can be the space's rather than their current one, so Analytics
 * checks the dashboard where the page's readers are.
 */
export async function requestAnalytics<T>(
  action: "capture-dashboard-panel" | "get-dashboard-panel-status",
  input: Record<string, unknown>,
  schema: ZodType<T>,
  requestTimeoutMs: number,
  orgId: string | null,
): Promise<AnalyticsPeerResult<T>> {
  return requestPeerApp({
    target: "analytics",
    action,
    input,
    schema,
    requestTimeoutMs,
    orgId,
    messages: {
      appName: "Analytics",
      signedOut: "Sign in to use Analytics charts.",
      unreachable: "Analytics didn't answer. Try again in a minute.",
      refused:
        "Analytics couldn't read this panel. Check that you can open the dashboard.",
      invalidResponse:
        "Analytics sent back something Content can't read. Try again.",
    },
  });
}
