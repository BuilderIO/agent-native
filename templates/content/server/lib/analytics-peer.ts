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
import {
  getRequestContext,
  runWithRequestContext,
  type RequestContext,
} from "@agent-native/core/server/request-context";
import type { ZodType } from "zod";

import { peerAppLinkOrigins, resolvePeerAppUrl } from "./peer-apps.js";

/** The deployment's built-in Analytics, on Content's own lane. */
export function resolveAnalyticsAppUrl(): string | null {
  return resolvePeerAppUrl("analytics");
}

/**
 * The Analytics app URLs a pasted panel link may name. Beta and production
 * Analytics share one database, so a link from either names the same panel.
 */
export function analyticsLinkOrigins(): string[] {
  return peerAppLinkOrigins("analytics");
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
    // coercion-ok: Analytics answered in plain text, which is the message itself
  } catch {
    // Plain text is the message.
  }
  if (typeof message !== "string") return null;
  const text = message.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_PEER_MESSAGE_CHARS) : null;
}

/** The signed-in person's request, in the organization that opened the page. */
function inOrganization(orgId: string | null): RequestContext {
  const { orgId: _active, ...context } = getRequestContext() ?? {};
  return orgId ? { ...context, orgId } : context;
}

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
  const auth = await runWithRequestContext(inOrganization(orgId), () =>
    resolveA2ACallerAuth(),
  );
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
      ...(auth.orgDomain !== undefined ? { orgDomain: auth.orgDomain } : {}),
      ...(auth.orgSecret !== undefined ? { orgSecret: auth.orgSecret } : {}),
      requestTimeoutMs,
    });
  } catch (error) {
    console.warn("[content-analytics] Analytics request failed", {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
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
  const invalid = {
    ok: false,
    code: "analytics_invalid_response",
    message: "Analytics sent back something Content can't read. Try again.",
  } as const;
  let output: unknown;
  try {
    output = JSON.parse(response.result.output);
  } catch {
    // An answer cut short at the result limit stops being JSON; its length says so.
    console.warn(
      "[content-analytics] Analytics answered with text that isn't JSON",
      {
        action,
        chars: response.result.output.length,
      },
    );
    return invalid;
  }
  const parsed = schema.safeParse(output);
  if (!parsed.success) {
    // Field paths and reasons only; the values are the person's data.
    console.warn(
      "[content-analytics] Analytics answered in a shape Content can't read",
      {
        action,
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      },
    );
    return invalid;
  }
  return { ok: true, data: parsed.data };
}
