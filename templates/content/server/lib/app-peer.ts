/**
 * How Content reaches another Agent-Native app whose work a page keeps a
 * copy of (an Analytics chart, a Design screen): where that app is, and the
 * one call that asks it, as the signed-in person, for a read-only action.
 * The other app checks that person's access; Content never sees its data.
 */
import {
  invokeAgentAction,
  resolveA2ACallerAuth,
} from "@agent-native/core/a2a";
import { getAppConfig } from "@agent-native/core/server";
import { getBuiltinAgents } from "@agent-native/core/server/agent-discovery";
import {
  getRequestContext,
  runWithRequestContext,
  type RequestContext,
} from "@agent-native/core/server/request-context";
import {
  resolveEnvironmentTargets,
  resolveLaneEndpoint,
} from "@agent-native/core/shared/environment-lanes";
import type { ZodType } from "zod";

/** The apps a page keeps copies from. */
export type PeerAppId = "analytics" | "design";

function hostnameOf(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).hostname;
}

/** The deployment's built-in app `appId`, on Content's own lane. */
export function resolvePeerAppUrl(appId: PeerAppId): string | null {
  const app = getBuiltinAgents("content").find(
    (candidate) => candidate.id === appId,
  );
  if (!app?.url || !URL.canParse(app.url)) return null;
  return resolveLaneEndpoint(
    app.url,
    hostnameOf(getAppConfig().app.url),
  ).replace(/\/+$/, "");
}

/**
 * The app URLs a pasted link from `appId` may name. Beta and production
 * share one database, so a link from either names the same thing.
 */
export function peerLinkOrigins(appId: PeerAppId): string[] {
  const appUrl = resolvePeerAppUrl(appId);
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

export type PeerAppResult<T, App extends PeerAppId> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | `${App}_signed_out`
        | `${App}_unreachable`
        | `${App}_refused`
        | `${App}_invalid_response`;
      message: string;
    };

/** What a person reads when the other app can't answer. */
export interface PeerAppMessages {
  /** The app's name in log lines, such as "Analytics". */
  appName: string;
  signedOut: string;
  unreachable: string;
  /** When the app refuses without a reason of its own. */
  refused: string;
  invalidResponse: string;
}

const MAX_PEER_MESSAGE_CHARS = 300;

/** The other app's own reason for a refusal, such as a missing panel. */
function peerMessage(output: string): string | null {
  let message: unknown = output;
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      message = record.error ?? record.message;
    }
    // coercion-ok: the app answered in plain text, which is the message itself
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
 * Calls one of `target`'s read-only actions as the signed-in person and
 * checks the answer against `schema`. Never throws for the app's failures.
 * `orgId` is the organization that let them open the page, which for a page
 * in a space can be the space's rather than their current one, so the app
 * checks its resource where the page's readers are.
 */
export async function requestPeerApp<T, App extends PeerAppId>(args: {
  target: App;
  action: string;
  input: Record<string, unknown>;
  schema: ZodType<T>;
  requestTimeoutMs: number;
  orgId: string | null;
  messages: PeerAppMessages;
}): Promise<PeerAppResult<T, App>> {
  const { target, action, messages } = args;
  const logTag = `[content-${target}]`;
  const auth = await runWithRequestContext(inOrganization(args.orgId), () =>
    resolveA2ACallerAuth(),
  );
  if (!auth.userEmail) {
    return {
      ok: false,
      code: `${target}_signed_out`,
      message: messages.signedOut,
    };
  }
  let response;
  try {
    response = await invokeAgentAction({
      target,
      selfAppId: "content",
      action,
      input: args.input,
      userEmail: auth.userEmail,
      ...(auth.orgDomain !== undefined ? { orgDomain: auth.orgDomain } : {}),
      ...(auth.orgSecret !== undefined ? { orgSecret: auth.orgSecret } : {}),
      requestTimeoutMs: args.requestTimeoutMs,
    });
  } catch (error) {
    console.warn(`${logTag} ${messages.appName} request failed`, {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      code: `${target}_unreachable`,
      message: messages.unreachable,
    };
  }
  if (response.result.status !== "completed") {
    return {
      ok: false,
      code: `${target}_refused`,
      message: peerMessage(response.result.output) ?? messages.refused,
    };
  }
  const invalid = {
    ok: false,
    code: `${target}_invalid_response`,
    message: messages.invalidResponse,
  } as const;
  let output: unknown;
  try {
    output = JSON.parse(response.result.output);
  } catch {
    // An answer cut short at the result limit stops being JSON; its length says so.
    console.warn(
      `${logTag} ${messages.appName} answered with text that isn't JSON`,
      { action, chars: response.result.output.length },
    );
    return invalid;
  }
  const parsed = args.schema.safeParse(output);
  if (!parsed.success) {
    // Field paths and reasons only; the values are the person's data.
    console.warn(
      `${logTag} ${messages.appName} answered in a shape Content can't read`,
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
