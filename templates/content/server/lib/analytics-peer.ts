/**
 * Content's side of an Analytics chart kept in a page: where Analytics is,
 * and the one call that asks it, as the signed-in person, for a panel's
 * numbers or a dashboard's sharing. Analytics checks that person's access to
 * the dashboard; Content never sees the data source.
 */
import {
  invokeAgentAction,
  resolveA2ACallerAuth,
} from "@agent-native/core/a2a";
import { getAppConfig } from "@agent-native/core/server";
import { getBuiltinAgents } from "@agent-native/core/server/agent-discovery";
import {
  resolveEnvironmentTargets,
  resolveLaneEndpoint,
} from "@agent-native/core/shared/environment-lanes";
import type { ZodType } from "zod";

function hostnameOf(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).hostname;
}

/** The deployment's built-in Analytics, on Content's own lane. */
export function resolveAnalyticsAppUrl(): string | null {
  const analytics = getBuiltinAgents("content").find(
    (app) => app.id === "analytics",
  );
  if (!analytics?.url || !URL.canParse(analytics.url)) return null;
  return resolveLaneEndpoint(
    analytics.url,
    hostnameOf(getAppConfig().app.url),
  ).replace(/\/+$/, "");
}

/**
 * The Analytics app URLs a pasted panel link may name. Beta and production
 * Analytics share one database, so a link from either names the same panel.
 */
export function analyticsLinkOrigins(): string[] {
  const appUrl = resolveAnalyticsAppUrl();
  if (!appUrl) return [];
  const url = new URL(appUrl);
  const lanes = resolveEnvironmentTargets(url.hostname);
  const origins = [appUrl];
  for (const host of lanes ? [lanes.betaHost, lanes.productionHost] : []) {
    const lane = new URL(appUrl);
    lane.hostname = host;
    origins.push(lane.toString().replace(/\/+$/, ""));
  }
  return [...new Set(origins)];
}

export type AnalyticsPeerResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | "analytics_signed_out"
        | "analytics_unreachable"
        | "analytics_refused"
        | "analytics_invalid_response";
      message: string;
    };

const MAX_PEER_MESSAGE_CHARS = 300;

/** Analytics' own reason for a refusal, such as a missing panel. */
function peerMessage(output: string): string | null {
  let message: unknown = output;
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      message = record.error ?? record.message;
    }
  } catch {
    // Plain text is the message.
  }
  if (typeof message !== "string") return null;
  const text = message.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_PEER_MESSAGE_CHARS) : null;
}

/**
 * Calls one of Analytics' read-only actions as the signed-in person and
 * checks the answer against `schema`. Never throws for Analytics' failures.
 */
export async function requestAnalytics<T>(
  action: "capture-dashboard-panel" | "get-dashboard-panel-status",
  input: Record<string, unknown>,
  schema: ZodType<T>,
  requestTimeoutMs: number,
): Promise<AnalyticsPeerResult<T>> {
  const auth = await resolveA2ACallerAuth();
  if (!auth.userEmail) {
    return {
      ok: false,
      code: "analytics_signed_out",
      message: "Sign in to use Analytics charts.",
    };
  }
  let response;
  try {
    response = await invokeAgentAction({
      target: "analytics",
      selfAppId: "content",
      action,
      input,
      userEmail: auth.userEmail,
      orgDomain: auth.orgDomain,
      orgSecret: auth.orgSecret,
      requestTimeoutMs,
    });
  } catch {
    return {
      ok: false,
      code: "analytics_unreachable",
      message: "Analytics didn't answer. Try again in a minute.",
    };
  }
  if (response.result.status !== "completed") {
    return {
      ok: false,
      code: "analytics_refused",
      message:
        peerMessage(response.result.output) ??
        "Analytics couldn't read this panel. Check that you can open the dashboard.",
    };
  }
  let output: unknown;
  try {
    output = JSON.parse(response.result.output);
  } catch {
    output = undefined;
  }
  const parsed = schema.safeParse(output);
  if (!parsed.success) {
    return {
      ok: false,
      code: "analytics_invalid_response",
      message: "Analytics sent back something Content can't read. Try again.",
    };
  }
  return { ok: true, data: parsed.data };
}
