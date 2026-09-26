import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  createError,
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getQuery,
  getHeader,
  readBody as readH3Body,
} from "h3";

import "../authorization/check-action.js";
import { verifyA2ATokenWithClaims } from "../a2a-claims.js";
import {
  ActionContractError,
  isActionContractError,
  isActionExposedToExternalAgents,
  isAgentActionStopError,
  validateActionArgs,
} from "../action.js";
import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { isTransientDatabaseError } from "../db/client.js";
import { declaresFeatureFlagDelegation } from "../feature-flags/a2a-action-route.js";
import { isFeatureFlagAdminEmail } from "../feature-flags/permissions.js";
import {
  isFederationMembershipValidatedForEvent,
  resolveOrgByDomain,
  resolveOrgIdForEmail,
} from "../org/context.js";
import {
  agentNativeMcpInstructions,
  agentNativeToolTitle,
} from "../shared/agent-mcp-metadata.js";
import { EMBED_TARGET_HEADER } from "../shared/embed-auth.js";
import {
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  shouldAllowMcpEmbedCredentials,
} from "../shared/mcp-embed-headers.js";
import { actionCallIsReadOnly, notifyActionChange } from "./action-change.js";
import {
  readBrowserSessionIdHeader,
  readBrowserTabIdHeader,
  readAnalyticsClientPlatformHeader,
  readSyntheticTrafficHeader,
  seedAgentRunOwnerContext,
  type AgentRunOwnerContext,
} from "./agent-run-context.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import { captureError } from "./capture-error.js";
import {
  getAllowedCorsOrigin as resolveAllowedCorsOrigin,
  readCorsAllowedOrigins,
} from "./cors-origins.js";
import {
  resolveEmbedSessionFromRequest,
  resolvedEmbedCapabilityScope,
} from "./embed-session.js";
import {
  getHttpRequestTelemetryId,
  registerHttpRequestTelemetryActionRoute,
  setHttpRequestTelemetryActionName,
} from "./http-response-telemetry.js";
import { consumeOneTimeJti } from "./identity-sso-store.js";
import {
  getForwardedRequestOrigin,
  isSameOriginRequest,
} from "./request-origin.js";
import { hasUiActionCapability } from "./ui-action-capability.js";

declare const __AGENT_NATIVE_BUILD_ID__: string | undefined;
declare const __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__: string | undefined;

function requiredClientCompatibilityVersion(): string {
  const configured =
    typeof __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__ === "string"
      ? __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__
      : process.env.AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION;
  return configured?.trim() ?? "";
}

function currentBuildId(): string {
  const configured =
    typeof __AGENT_NATIVE_BUILD_ID__ === "string"
      ? __AGENT_NATIVE_BUILD_ID__
      : process.env.AGENT_NATIVE_BUILD_ID;
  return configured?.trim() || "unknown";
}

import { isLoopbackRequest, registerAuthPublicPaths } from "./auth.js";
import { getH3App } from "./framework-request-handler.js";
import {
  hasExplicitPersonalOrgScope,
  markExplicitPersonalOrgScope,
  runWithRequestContext,
} from "./request-context.js";

const ROUTE_PREFIX = "/_agent-native/actions";
const FRONTEND_MUTATION_METHODS = new Set(["POST", "PUT", "DELETE"]);

async function resolveFeatureFlagA2ACaller(event: any, actionName: string) {
  const required =
    actionName === "list-feature-flags"
      ? "flags:read"
      : actionName === "set-feature-flag"
        ? "flags:write"
        : null;
  if (!required) return null;
  const authorization = getHeader(event, "authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  if (!declaresFeatureFlagDelegation(token)) return null;
  const claims = await verifyA2ATokenWithClaims(token, event);
  if (!claims || !claims.scope.includes(required))
    throw new Error("Invalid feature flag delegation");
  const localOrg = await resolveOrgByDomain(claims.orgDomain);
  if (!localOrg && !isFeatureFlagAdminEmail(claims.email))
    throw new Error("Invalid feature flag delegation");
  if (
    actionName === "set-feature-flag" &&
    (await consumeOneTimeJti(claims.jti))
  ) {
    throw new Error("Invalid feature flag delegation");
  }
  return {
    owner: claims.email,
    orgId: localOrg?.orgId ?? null,
    anonymous: false,
    delegationJti: claims.jti,
    delegationIssuer: claims.issuer,
  } as ActionRouteResolvedCaller;
}

export function parseActionSearchParams(
  searchParams: URLSearchParams,
): Record<string, any> {
  const params: Record<string, any> = {};
  for (const [rawKey, value] of searchParams.entries()) {
    appendActionParam(params, rawKey, value);
  }
  return params;
}

function parseActionQueryObject(
  query: Record<string, unknown>,
): Record<string, any> {
  const params: Record<string, any> = {};
  for (const [rawKey, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value != null) appendActionParam(params, rawKey, String(value));
    }
  }
  return params;
}

function appendActionParam(
  params: Record<string, any>,
  rawKey: string,
  value: any,
) {
  const isArrayKey = rawKey.endsWith("[]");
  const key = isArrayKey ? rawKey.slice(0, -2) : rawKey;
  const current = params[key];
  if (current === undefined) {
    params[key] = isArrayKey ? [value] : value;
  } else if (Array.isArray(current)) {
    current.push(value);
  } else {
    params[key] = [current, value];
  }
}

function readTimezoneHeader(event: any): string | undefined {
  try {
    const raw = getHeader(event, "x-user-timezone");
    if (!raw || typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 && trimmed.length < 64 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function isFrontendActionRequest(event: any): boolean {
  try {
    return getHeader(event, "x-agent-native-frontend") === "1";
  } catch {
    return false;
  }
}

type CorsOrigin = {
  origin: string;
  credentials: boolean;
};

function getAllowedCorsOrigin(origin: string | undefined): CorsOrigin | null {
  const allowedOrigin = resolveAllowedCorsOrigin(origin, {
    allowedOrigins: readCorsAllowedOrigins(),
    // Let the cors-origins default apply (dev-only). Omitting this option
    // keeps production from trusting arbitrary localhost callers.
  });
  if (allowedOrigin) {
    return {
      origin: allowedOrigin,
      credentials: shouldAllowMcpEmbedCredentials(allowedOrigin),
    };
  }
  if (origin && isMcpEmbedCorsOrigin(origin)) {
    return {
      origin,
      credentials: shouldAllowMcpEmbedCredentials(origin),
    };
  }
  return null;
}

function handleOptionsRequest(event: any): string {
  const origin = getHeader(event, "origin");
  const cors = getAllowedCorsOrigin(
    typeof origin === "string" ? origin : undefined,
  );

  if (origin && !cors) {
    setResponseStatus(event, 403);
    return "";
  }

  if (cors) {
    setResponseHeader(event, "Access-Control-Allow-Origin", cors.origin);
    setResponseHeader(event, "Vary", "Origin");
    if (cors.credentials) {
      setResponseHeader(event, "Access-Control-Allow-Credentials", "true");
    }
    setResponseHeader(
      event,
      "Access-Control-Allow-Methods",
      "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    setResponseHeader(
      event,
      "Access-Control-Allow-Headers",
      cors.credentials
        ? `Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-Browser-Tab,X-Agent-Native-CSRF,X-User-Timezone,X-Agent-Native-Session-Id,X-Agent-Native-Client-Platform,X-Agent-Native-Tool-Bridge,X-Agent-Native-Tool-Id,X-Agent-Native-Frontend,X-Agent-Native-Client-Compatibility,X-Agent-Native-Build-Id,${EMBED_TARGET_HEADER}`
        : `${MCP_EMBED_CORS_ALLOW_HEADERS},X-Agent-Native-Tool-Bridge,X-Agent-Native-Tool-Id,X-Agent-Native-Frontend,X-Agent-Native-Client-Compatibility,X-Agent-Native-Build-Id`,
    );
  }

  setResponseStatus(event, 204);
  return "";
}

export type ActionRouteResolvedCaller = AgentRunOwnerContext & {
  /**
   * Org to scope the request to, verified from the same credential as the
   * caller identity (e.g. the A2A token's org claim). When omitted, the org
   * is derived from the verified owner email via the framework's owner→org
   * membership lookup. An explicit `null` means the verified caller has no
   * org and must not fall back to another membership. The ambient session/org
   * state on the request is never consulted for adapter-resolved callers: a
   * request can carry both a valid A2A bearer and an unrelated browser cookie,
   * and the cookie user's org must not leak into the token caller's request
   * context.
   */
  orgId?: string | null;
  delegationJti?: string;
  delegationIssuer?: string;
};

export interface ActionRouteAuthAdapter {
  /**
   * Resolve a caller from the raw event before the cookie/bearer chain.
   *
   * - Return the resolved caller to run the action scoped to that identity.
   *   Org scoping comes exclusively from the caller: the returned `orgId` if
   *   set, otherwise the owner-email membership lookup — never from the
   *   request's session cookie or org context.
   * - Return `null` when the credential isn't yours to judge — the request
   *   defers to `getOwnerFromEvent` / `getSession`.
   * - THROW to hard-reject: the credential is present but invalid (e.g. an
   *   expired or forged A2A bearer). The action route responds 401 and does
   *   NOT fall through to the cookie/session chain, so a valid same-origin
   *   session cookie can't be used to execute the request as the logged-in
   *   user. Do not throw merely to signal "not mine" — return `null` for that.
   */
  resolveCaller?: (
    event: any,
  ) =>
    | ActionRouteResolvedCaller
    | null
    | Promise<ActionRouteResolvedCaller | null>;
}

export interface MountActionRoutesOptions {
  getOwnerFromEvent?: (event: any) => string | Promise<string>;
  getAuthUserIdFromEvent?: (
    event: any,
  ) => string | undefined | Promise<string | undefined>;
  appId?: string;
  getUserNameFromEvent?: (
    event: any,
  ) => string | undefined | Promise<string | undefined>;
  resolveOrgId?: (event: any) => string | null | Promise<string | null>;
  actionRouteAuth?: ActionRouteAuthAdapter;
}

export interface WebMcpManifestOptions {
  name: string;
  description: string;
  title?: string;
  instructions?: string;
  keyToolNames?: readonly string[];
  version?: string;
  websiteUrl?: string;
  icons?: Array<{
    src: string;
    mimeType?: string;
    sizes?: string[];
    theme?: "light" | "dark";
  }>;
}

export interface MountWebMcpActionRoutesOptions extends MountActionRoutesOptions {
  manifest?: WebMcpManifestOptions;
  getOwnerContextFromEvent?: (
    event: any,
  ) => AgentRunOwnerContext | Promise<AgentRunOwnerContext>;
}

interface MountActionRoutesInternalOptions extends MountActionRoutesOptions {
  routePrefix?: string;
  includeAgentOnly?: boolean;
  forcePost?: boolean;
  caller?: "webmcp";
  allowDelegatedCaller?: boolean;
  getOwnerContextFromEvent?: MountWebMcpActionRoutesOptions["getOwnerContextFromEvent"];
}

function normalizeOrgId(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isFirstBootMissingOrgTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /relation\s+["'`]?org_members["'`]?\s+does not exist/i.test(
    error.message,
  );
}

async function storedActiveOrgId(email: string): Promise<string | undefined> {
  try {
    return normalizeOrgId(await resolveOrgIdForEmail(email));
  } catch (error) {
    if (
      isTransientDatabaseError(error) ||
      !isFirstBootMissingOrgTableError(error)
    ) {
      throw error;
    }
    return undefined;
  }
}

function isAuthResolutionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeStatus = error as {
    status?: unknown;
    statusCode?: unknown;
    statusMessage?: unknown;
  };
  const status =
    typeof maybeStatus.statusCode === "number"
      ? maybeStatus.statusCode
      : typeof maybeStatus.status === "number"
        ? maybeStatus.status
        : undefined;
  if (status === 401 || status === 403) return true;
  return (
    typeof maybeStatus.statusMessage === "string" &&
    /unauthenticated|forbidden/i.test(maybeStatus.statusMessage)
  );
}

function isPublicWebMcpAction(entry: ActionEntry): boolean {
  const publicAgent = entry.publicAgent;
  return (
    entry.requiresAuth === false &&
    entry.readOnly === true &&
    publicAgent?.expose === true &&
    publicAgent.readOnly === true &&
    publicAgent.requiresAuth !== true &&
    publicAgent.isConsequential !== true
  );
}

function allowsWebMcpCapability(
  entry: ActionEntry,
  authCapability: string | undefined,
): boolean {
  if (!authCapability || !Array.isArray(entry.capabilityScopes)) return false;
  return entry.capabilityScopes.some(
    (scope) =>
      typeof scope === "string" &&
      scope.length > 0 &&
      authCapability.startsWith(`capability:${scope}:`),
  );
}

function allowsWebMcpCapabilityResource(
  authCapability: string | undefined,
  params: Record<string, unknown>,
): boolean {
  const prefix = "capability:visual-edit:";
  if (!authCapability?.startsWith(prefix)) return true;
  const match = /^design:([^:]+)$/.exec(authCapability.slice(prefix.length));
  if (!match || typeof params.designId !== "string") return false;
  try {
    return decodeURIComponent(match[1]) === params.designId;
  } catch {
    // coercion-ok: malformed capability scope is invalid and must fail closed.
    return false;
  }
}

async function resolveRequestAuthCapability(
  event: any,
): Promise<string | undefined> {
  try {
    return resolvedEmbedCapabilityScope(
      await resolveEmbedSessionFromRequest(event),
    );
  } catch {
    return undefined;
  }
}

function mountActionRoutesInternal(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options?: MountActionRoutesInternalOptions,
) {
  const mounted: string[] = [];
  const app = getH3App(nitroApp);

  for (const [name, entry] of Object.entries(actions)) {
    if (entry.http === false && !options?.includeAgentOnly) continue;

    const http = entry.http || undefined;
    const method = options?.forcePost ? "POST" : (http?.method ?? "POST");
    const path = options?.forcePost ? name : (http?.path ?? name);
    const routePrefix = options?.routePrefix ?? ROUTE_PREFIX;
    const routePath = `${routePrefix}/${path}`;
    const routeTemplate =
      !options?.forcePost && http?.path ? routePath : `${routePrefix}/:action`;
    registerHttpRequestTelemetryActionRoute(
      routePath,
      name,
      routeTemplate,
      nitroApp,
    );

    if (
      (entry.requiresAuth === false && !options?.caller) ||
      (Array.isArray(entry.capabilityScopes) && entry.capabilityScopes.length)
    ) {
      registerAuthPublicPaths([routePath], app);
    }

    if (
      !options?.caller &&
      (name === "list-feature-flags" || name === "set-feature-flag")
    ) {
      registerAuthPublicPaths([routePath], app);
    }

    app.use(
      routePath,
      defineEventHandler(async (event) => {
        setHttpRequestTelemetryActionName(event, name, routeTemplate);
        const reqMethod = getMethod(event);
        const effectiveMethod =
          reqMethod === "HEAD" && method === "GET" ? "GET" : reqMethod;

        if (reqMethod === "OPTIONS") {
          return handleOptionsRequest(event);
        }

        setResponseHeader(event, "Cache-Control", "no-store");
        setResponseHeader(
          event,
          "Access-Control-Expose-Headers",
          "X-Agent-Native-Client-Mismatch,X-Agent-Native-Build-Id,X-Agent-Native-Client-Compatibility,Retry-After",
        );

        const isFrontendMutation =
          isFrontendActionRequest(event) &&
          FRONTEND_MUTATION_METHODS.has(method) &&
          FRONTEND_MUTATION_METHODS.has(effectiveMethod);
        if (effectiveMethod !== method && !isFrontendMutation) {
          setResponseStatus(event, 405);
          return { error: `Method not allowed. Use ${method}.` };
        }

        const requiredCompatibility = requiredClientCompatibilityVersion();
        if (isFrontendActionRequest(event) && requiredCompatibility) {
          const receivedCompatibility = getHeader(
            event,
            "x-agent-native-client-compatibility",
          );
          if (receivedCompatibility !== requiredCompatibility) {
            const serverBuildId = currentBuildId();
            setResponseStatus(event, 409);
            setResponseHeader(event, "X-Agent-Native-Client-Mismatch", "1");
            setResponseHeader(event, "X-Agent-Native-Build-Id", serverBuildId);
            setResponseHeader(
              event,
              "X-Agent-Native-Client-Compatibility",
              requiredCompatibility,
            );
            return {
              error: "This browser tab must reload before it can use this app.",
              code: "client_build_mismatch",
              serverBuildId,
              requiredCompatibility,
            };
          }
        }

        const fromToolBridge =
          getHeader(event, "x-agent-native-tool-bridge") === "1";
        if (fromToolBridge && entry.toolCallable === false) {
          setResponseStatus(event, 403);
          return {
            error: `Action '${name}' is not callable from tools.`,
          };
        }

        let userEmail: string | undefined;
        let userName: string | undefined;
        let authUserId: string | undefined;
        const authCapability = await resolveRequestAuthCapability(event);
        // through, so a live same-origin session cookie can't silently execute
        let resolvedCaller: ActionRouteResolvedCaller | null = null;
        const capabilityAllowed =
          (options?.caller === "webmcp" || isFrontendActionRequest(event)) &&
          allowsWebMcpCapability(entry, authCapability);
        if (options?.allowDelegatedCaller !== false) {
          let caller: ActionRouteResolvedCaller | null;
          try {
            caller = options?.actionRouteAuth?.resolveCaller
              ? await options.actionRouteAuth.resolveCaller(event)
              : null;
            if (!caller)
              caller = await resolveFeatureFlagA2ACaller(event, name);
          } catch {
            throw createError({
              statusCode: 401,
              statusMessage: "Unauthorized",
            });
          }
          if (caller) {
            if (caller.orgId === null) markExplicitPersonalOrgScope(event);
            seedAgentRunOwnerContext(event, {
              owner: caller.owner,
              anonymous: caller.anonymous,
              name: caller.name,
            });
            userEmail = caller.owner;
            userName = caller.name;
            resolvedCaller = caller;
          }
        }
        let ownerContextResolved = false;
        if (
          !resolvedCaller &&
          options?.caller === "webmcp" &&
          options?.getOwnerContextFromEvent
        ) {
          ownerContextResolved = true;
          try {
            const ownerContext = await options.getOwnerContextFromEvent(event);
            if (
              ownerContext.anonymous &&
              !isPublicWebMcpAction(entry) &&
              !capabilityAllowed
            ) {
              throw createError({
                statusCode: 401,
                statusMessage: "Unauthorized",
              });
            }
            if (!ownerContext.anonymous) {
              userEmail = ownerContext.owner;
              userName = ownerContext.name;
              authUserId = ownerContext.authUserId;
            }
          } catch (error) {
            if (
              isAuthResolutionFailure(error) &&
              (capabilityAllowed ||
                (entry.requiresAuth === false && isPublicWebMcpAction(entry)))
            ) {
              userEmail = undefined;
              userName = undefined;
            } else {
              throw error;
            }
          }
        }
        if (
          !resolvedCaller &&
          !ownerContextResolved &&
          options?.getOwnerFromEvent
        ) {
          try {
            userEmail = await options.getOwnerFromEvent(event);
            userName = options?.getUserNameFromEvent
              ? await options.getUserNameFromEvent(event)
              : undefined;
          } catch (error) {
            if (
              isAuthResolutionFailure(error) &&
              (capabilityAllowed ||
                (entry.requiresAuth === false &&
                  (options?.caller !== "webmcp" ||
                    isPublicWebMcpAction(entry))))
            ) {
              userEmail = undefined;
              userName = undefined;
            } else {
              throw error;
            }
          }
        }
        if (userEmail && !resolvedCaller && options?.getAuthUserIdFromEvent) {
          try {
            authUserId = await options.getAuthUserIdFromEvent(event);
          } catch {
            console.warn(
              "[agent-actions] Could not resolve canonical tracking identity; continuing without auth_user_id.",
            );
          }
        }
        // cookie, and the cookie user's org must not become the org the
        let orgId: string | undefined;
        if (resolvedCaller) {
          orgId = normalizeOrgId(resolvedCaller.orgId);
          if (
            resolvedCaller.orgId !== null &&
            !orgId &&
            resolvedCaller.owner &&
            !resolvedCaller.anonymous
          ) {
            orgId = await storedActiveOrgId(resolvedCaller.owner);
          }
        } else if (!capabilityAllowed || userEmail) {
          orgId = options?.resolveOrgId
            ? ((await options.resolveOrgId(event)) ?? undefined)
            : undefined;
          if (!hasExplicitPersonalOrgScope(event) && !orgId && userEmail) {
            orgId = await storedActiveOrgId(userEmail);
          }
        }
        const frontendCaller =
          !options?.caller && !resolvedCaller && isFrontendActionRequest(event);
        if (
          entry.uiOnly === true &&
          (!frontendCaller ||
            !userEmail ||
            !isSameOriginRequest(event) ||
            !hasUiActionCapability(event, userEmail))
        ) {
          setResponseStatus(event, 403);
          return {
            error: "This action can only be called from the signed-in app UI.",
            errorCode: "ui_capability_required",
          };
        }
        const timezone = readTimezoneHeader(event);
        const browserSessionId = readBrowserSessionIdHeader(event);
        const clientPlatform = readAnalyticsClientPlatformHeader(event);
        const isSyntheticTraffic = readSyntheticTrafficHeader(event);
        const browserTabId = readBrowserTabIdHeader(event);
        const requestWaitUntil =
          typeof event.req?.waitUntil === "function"
            ? event.req.waitUntil.bind(event.req)
            : undefined;

        return runWithRequestContext(
          {
            userEmail,
            ...(authUserId ? { authUserId } : {}),
            userName,
            orgId,
            ...(hasExplicitPersonalOrgScope(event)
              ? { orgScope: "personal" as const }
              : {}),
            authCapability,
            timezone,
            browserSessionId,
            clientPlatform,
            ...(browserTabId || requestWaitUntil
              ? {
                  run: {
                    ...(browserTabId ? { browserTabId } : {}),
                    ...(requestWaitUntil
                      ? { waitUntil: requestWaitUntil }
                      : {}),
                  },
                }
              : {}),
            ...(isSyntheticTraffic ? { isSyntheticTraffic: true } : {}),
            requestOrigin: getForwardedRequestOrigin(event),
            federationMembershipValidated:
              isFederationMembershipValidatedForEvent(event, userEmail, orgId),
            isLoopbackRequest: isLoopbackRequest(event),
          },
          async () => {
            if (typeof entry.maxBodyBytes === "number" && method !== "GET") {
              const clRaw = getHeader(event, "content-length");
              if (clRaw) {
                const declared = parseInt(clRaw, 10);
                if (!Number.isNaN(declared) && declared > entry.maxBodyBytes) {
                  setResponseStatus(event, 413);
                  return {
                    error: `Request body too large (max ${entry.maxBodyBytes} bytes)`,
                  };
                }
              }
            }
            let params: Record<string, any>;
            let paramsError: string | undefined;
            try {
              if (method === "GET") {
                const webReq = (event as any).req;
                if (webReq?.url) {
                  const url = new URL(webReq.url);
                  params = parseActionSearchParams(url.searchParams);
                } else {
                  params = parseActionQueryObject(
                    getQuery(event) as Record<string, any>,
                  );
                }
              } else {
                const webReq = (event as any).req;
                if (webReq && typeof webReq.json === "function") {
                  params = await webReq.json();
                } else {
                  params = (await readH3Body(event)) as Record<string, any>;
                }
                if (
                  !params ||
                  typeof params !== "object" ||
                  Array.isArray(params)
                ) {
                  throw new Error("request body is not an object");
                }
              }
            } catch {
              params = {};
              paramsError = "Request body must be a valid JSON object.";
            }

            try {
              if (paramsError) {
                throw new ActionContractError(paramsError, {
                  errorCode: "invalid_action_request_body",
                  statusCode: 400,
                });
              }
              if (
                capabilityAllowed &&
                !userEmail &&
                !allowsWebMcpCapabilityResource(authCapability, params)
              ) {
                throw createError({
                  statusCode: 401,
                  statusMessage: "Unauthorized",
                });
              }
              const caller =
                options?.caller ??
                (resolvedCaller
                  ? "a2a"
                  : isFrontendActionRequest(event)
                    ? "frontend"
                    : "http");
              const runContext: ActionRunContext = {
                userEmail,
                orgId: orgId ?? null,
                appId: options?.appId,
                caller,
                requestHeaders: event.headers,
                actionName: name,
                ...(resolvedCaller?.delegationJti
                  ? {
                      networkProtocol: "a2a" as const,
                      networkId: resolvedCaller.delegationJti,
                      networkPeer: resolvedCaller.delegationIssuer,
                    }
                  : {}),
              };
              if (caller === "webmcp" && entry.needsApproval !== undefined) {
                if (
                  entry.schema &&
                  typeof entry.schema === "object" &&
                  "~standard" in entry.schema
                ) {
                  params = await validateActionArgs(
                    entry.schema as StandardSchemaV1,
                    params,
                    entry.tool.parameters,
                    runContext,
                  );
                }
                let mustApprove = false;
                try {
                  mustApprove =
                    typeof entry.needsApproval === "function"
                      ? Boolean(
                          await entry.needsApproval(params, {
                            userEmail,
                            orgId: orgId ?? null,
                            appId: options?.appId,
                            caller,
                          }),
                        )
                      : entry.needsApproval === true;
                } catch {
                  mustApprove = true;
                }
                if (mustApprove) {
                  throw new ActionContractError(
                    `"${name}" requires human approval for these arguments. WebMCP tool calls cannot grant that approval themselves — ask the user to confirm this action in chat, then call it there.`,
                    { errorCode: "approval_required", statusCode: 409 },
                  );
                }
              }
              const result = await entry.run(params, runContext);

              const isReadOnly = actionCallIsReadOnly(
                entry,
                params,
                method === "GET",
              );
              if (!isReadOnly) {
                try {
                  await notifyActionChange({
                    actionName: name,
                    ...(userEmail ? { owner: userEmail } : {}),
                    ...(getHeader(event, "x-request-source")
                      ? {
                          requestSource: getHeader(
                            event,
                            "x-request-source",
                          ) as string,
                        }
                      : {}),
                  });
                } catch {
                  // ignore
                }
              }

              if (typeof result === "string") {
                try {
                  return JSON.parse(result);
                } catch {
                  setResponseHeader(event, "Content-Type", "application/json");
                  return JSON.stringify(result);
                }
              }

              return result;
            } catch (err: any) {
              const msg = err?.message ?? String(err);
              const isValidationError = msg.startsWith(
                "Invalid action parameters",
              );
              const explicitStatus =
                typeof err?.statusCode === "number"
                  ? err.statusCode
                  : undefined;
              const status = isValidationError ? 400 : (explicitStatus ?? 500);
              setResponseStatus(event, status);

              const errorDetails =
                err?.details &&
                typeof err.details === "object" &&
                !Array.isArray(err.details)
                  ? err.details
                  : undefined;
              const retryAfterSeconds = errorDetails?.retryAfterSeconds;
              if (
                status === 429 &&
                typeof retryAfterSeconds === "number" &&
                Number.isInteger(retryAfterSeconds) &&
                retryAfterSeconds > 0
              ) {
                setResponseHeader(
                  event,
                  "Retry-After",
                  String(Math.min(retryAfterSeconds, 300)),
                );
              }

              // Only echo the raw message for known-safe cases:
              //  - validation errors (deterministic, parameter-shape only)
              //  - action contract errors, which `fail()` also raises
              //    (explicitly safe on every transport)
              //  - AgentActionStopError (an explicit user-facing stop)
              //  - errors with an explicit statusCode < 500 (client errors)
              // A bare `throw new Error(...)` is deliberately absent: it is
              // indistinguishable from a driver or upstream blowup, so it stays
              // a generic 500 and the real detail — which can contain DB/
              // driver/upstream text — never leaves the server.
              const isUserFacing =
                isValidationError ||
                isActionContractError(err) ||
                isAgentActionStopError(err) ||
                (explicitStatus !== undefined && explicitStatus < 500);
              if (isUserFacing) {
                return isActionContractError(err) || isAgentActionStopError(err)
                  ? {
                      error: msg,
                      ...(typeof err.errorCode === "string"
                        ? { errorCode: err.errorCode }
                        : {}),
                      ...(err.details === undefined
                        ? {}
                        : { details: err.details }),
                    }
                  : {
                      error: msg,
                      ...(typeof err?.errorCode === "string"
                        ? { errorCode: err.errorCode }
                        : {}),
                      ...(status === 429 &&
                      typeof retryAfterSeconds === "number" &&
                      Number.isInteger(retryAfterSeconds) &&
                      retryAfterSeconds > 0
                        ? { details: { retryAfterSeconds } }
                        : {}),
                    };
              }
              const requestId = getHttpRequestTelemetryId(event);
              const captureId = captureError(err, {
                route: routePath,
                method: reqMethod,
                tags: {
                  action: name,
                  caller:
                    options?.caller ??
                    (resolvedCaller
                      ? "a2a"
                      : isFrontendActionRequest(event)
                        ? "frontend"
                        : "http"),
                  status_code: String(status),
                },
                ...(requestId ? { extra: { request_id: requestId } } : {}),
              });
              console.error(`[agent-native] action '${name}' failed:`, {
                action: name,
                ...(requestId ? { requestId } : {}),
                ...(captureId ? { captureId } : {}),
                error: err?.stack ?? String(err),
              });
              return { error: "Internal server error" };
            }
          },
        );
      }),
    );

    mounted.push(`${method} ${routePath}`);
  }

  if (mounted.length > 0 && process.env.DEBUG)
    console.log(
      `[action-routes] Mounted ${mounted.length} action route(s): ${mounted.join(", ")}`,
    );
}

export function mountActionRoutes(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options?: MountActionRoutesOptions,
) {
  mountActionRoutesInternal(nitroApp, actions, options);
}

function buildWebMcpCompatibilityManifest(
  event: any,
  actions: Record<string, ActionEntry>,
  options?: WebMcpManifestOptions,
) {
  const baseUrl = `${getForwardedRequestOrigin(event)}${getConfiguredAppBasePath()}`;
  const urlFor = (path: string) => `${baseUrl}${path}`;
  const tools = Object.entries(actions).map(([name, entry]) => {
    const inputSchema = entry.tool.parameters ?? {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
    return {
      name,
      title: agentNativeToolTitle(name, entry.tool.title),
      description: entry.tool.description,
      parameters: inputSchema,
      inputSchema,
      endpoint: urlFor(`/mcp/tool/${encodeURIComponent(name)}`),
      method: "POST" as const,
      readOnly: entry.readOnly === true,
      requiresAuth: entry.requiresAuth !== false,
    };
  });

  const servedKeyToolNames = options?.keyToolNames?.filter(
    (name) => name in actions,
  );

  return {
    schema_version: "v1" as const,
    protocol: "WebMCP" as const,
    name: options?.name ?? "Agent",
    ...(options?.title ? { title: options.title } : {}),
    description: options?.description ?? "Agent-Native app agent",
    instructions: agentNativeMcpInstructions(
      options?.instructions,
      servedKeyToolNames,
    ),
    version: options?.version ?? "1.0.0",
    ...(options?.websiteUrl ? { website_url: options.websiteUrl } : {}),
    ...(options?.icons ? { icons: options.icons } : {}),
    endpoints: {
      mcp: urlFor("/mcp"),
      httpTools: urlFor("/mcp/tool"),
      authenticatedWebMcp: urlFor("/_agent-native/webmcp/manifest"),
      a2a: urlFor("/.well-known/agent-card.json"),
    },
    webmcp: {
      scope: "page-local" as const,
      browserRequired: true,
    },
    tools,
  };
}

export function mountWebMcpActionRoutes(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options?: MountWebMcpActionRoutesOptions,
) {
  const eligible = Object.fromEntries(
    Object.entries(actions).filter(
      ([name, entry]) =>
        /^[A-Za-z0-9_.-]{1,128}$/.test(name) &&
        isActionExposedToExternalAgents(entry) &&
        entry.agentTool !== false &&
        entry.uiOnly !== true,
    ),
  );
  const publicEligible = Object.fromEntries(
    Object.entries(eligible).filter(([, entry]) => isPublicWebMcpAction(entry)),
  );
  const capabilityEligible = Object.fromEntries(
    Object.entries(eligible).filter(([, entry]) =>
      Array.isArray(entry.capabilityScopes),
    ),
  );

  const app = getH3App(nitroApp);
  const actionRoutePrefixes = ["/_agent-native/webmcp/actions", "/mcp/tool"];
  const actionRoutePaths = actionRoutePrefixes.flatMap((routePrefix) =>
    Object.keys(eligible).map(
      (name) => `${routePrefix}/${encodeURIComponent(name)}`,
    ),
  );
  registerAuthPublicPaths(
    ["/_agent-native/webmcp/manifest", ...actionRoutePaths],
    app,
  );
  app.use(
    "/.well-known/mcp.json",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed. Use GET." };
      }
      setResponseHeader(event, "Cache-Control", "no-store");
      setResponseHeader(event, "X-Content-Type-Options", "nosniff");
      return buildWebMcpCompatibilityManifest(
        event,
        eligible,
        options?.manifest,
      );
    }),
  );

  if (Object.keys(eligible).length === 0) return;

  app.use(
    "/_agent-native/webmcp/manifest",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed. Use GET." };
      }
      let authenticated = false;
      if (options?.getOwnerContextFromEvent) {
        try {
          const ownerContext = await options.getOwnerContextFromEvent(event);
          authenticated = !ownerContext.anonymous;
        } catch (error) {
          if (!isAuthResolutionFailure(error)) throw error;
        }
      } else if (options?.getOwnerFromEvent) {
        try {
          await options.getOwnerFromEvent(event);
          authenticated = true;
        } catch (error) {
          if (!isAuthResolutionFailure(error)) throw error;
        }
      }
      const authCapability = await resolveRequestAuthCapability(event);
      const visibleCapabilityActions = authCapability
        ? Object.fromEntries(
            Object.entries(capabilityEligible).filter(([, entry]) =>
              allowsWebMcpCapability(entry, authCapability),
            ),
          )
        : {};
      if (
        !authenticated &&
        Object.keys(publicEligible).length === 0 &&
        Object.keys(visibleCapabilityActions).length === 0
      ) {
        throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
      }
      setResponseHeader(event, "Cache-Control", "no-store");
      const visible = authenticated
        ? eligible
        : { ...publicEligible, ...visibleCapabilityActions };
      return Object.entries(visible).map(([name, entry]) => ({
        name,
        title: agentNativeToolTitle(name, entry.tool.title),
        description: entry.tool.description,
        inputSchema: entry.tool.parameters,
        readOnly: entry.readOnly === true,
      }));
    }),
  );

  for (const routePrefix of actionRoutePrefixes) {
    mountActionRoutesInternal(nitroApp, eligible, {
      ...options,
      routePrefix,
      includeAgentOnly: true,
      forcePost: true,
      caller: "webmcp",
      actionRouteAuth: undefined,
      allowDelegatedCaller: false,
    });
  }
}
