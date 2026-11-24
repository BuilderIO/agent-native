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

export type PeerAppId = "analytics" | "clips" | "design" | "slides";

function hostnameOf(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).hostname;
}

function builtinPeerAppUrl(appId: PeerAppId): string | null {
  const app = getBuiltinAgents("content").find(
    (candidate) => candidate.id === appId,
  );
  if (!app?.url || !URL.canParse(app.url)) return null;
  return app.url.replace(/\/+$/, "");
}

export function resolvePeerAppUrl(appId: PeerAppId): string | null {
  const builtinUrl = builtinPeerAppUrl(appId);
  if (!builtinUrl) return null;
  return resolveLaneEndpoint(
    builtinUrl,
    hostnameOf(getAppConfig().app.url),
  ).replace(/\/+$/, "");
}

export function peerAppTarget(appId: PeerAppId): string {
  const builtinUrl = builtinPeerAppUrl(appId);
  const appUrl = resolvePeerAppUrl(appId);
  return appUrl && appUrl !== builtinUrl ? appUrl : appId;
}

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
      peerCode?: string;
    };

export interface PeerAppMessages {
  appName: string;
  signedOut: string;
  unreachable: string;
  refused: string;
  invalidResponse: string;
}

const MAX_PEER_MESSAGE_CHARS = 300;

function peerMessage(output: string): string | null {
  let message: unknown = output;
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      message = record.error ?? record.message;
    }
    // coercion-ok: the app answered in plain text, which is the message itself
  } catch {}
  if (typeof message !== "string") return null;
  const text = message.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_PEER_MESSAGE_CHARS) : null;
}

function peerErrorCode(output: string): string | undefined {
  let code: string | undefined;
  for (const match of output.matchAll(/\(errorCode: ([a-z0-9_]+)\)/gi)) {
    code = match[1];
  }
  return code;
}

function inOrganization(orgId: string | null): RequestContext {
  const { orgId: _active, ...context } = getRequestContext() ?? {};
  return orgId ? { ...context, orgId } : context;
}

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
      target: peerAppTarget(target),
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
    const peerCode = peerErrorCode(response.result.output);
    return {
      ok: false,
      code: `${target}_refused`,
      message: peerMessage(response.result.output) ?? messages.refused,
      ...(peerCode ? { peerCode } : {}),
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
    console.warn(
      `${logTag} ${messages.appName} answered with text that isn't JSON`,
      { action, chars: response.result.output.length },
    );
    return invalid;
  }
  const parsed = args.schema.safeParse(output);
  if (!parsed.success) {
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
