import {
  createError,
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getMethod,
  getQuery,
  getHeader,
} from "h3";

import { verifyA2ATokenWithClaims } from "../a2a-claims.js";
import { isActionContractError, isAgentActionStopError } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { isTransientDatabaseError } from "../db/client.js";
import { declaresFeatureFlagDelegation } from "../feature-flags/a2a-action-route.js";
import { isFeatureFlagAdminEmail } from "../feature-flags/permissions.js";
import { resolveOrgByDomain, resolveOrgIdForEmail } from "../org/context.js";
import { readBody } from "../server/h3-helpers.js";
import { EMBED_TARGET_HEADER } from "../shared/embed-auth.js";
import {
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  shouldAllowMcpEmbedCredentials,
} from "../shared/mcp-embed-headers.js";
import { actionCallIsReadOnly, notifyActionChange } from "./action-change.js";
import {
  readBrowserSessionIdHeader,
  readAnalyticsClientPlatformHeader,
  seedAgentRunOwnerContext,
  type AgentRunOwnerContext,
} from "./agent-run-context.js";
import { captureError } from "./capture-error.js";
import {
  getAllowedCorsOrigin as resolveAllowedCorsOrigin,
  readCorsAllowedOrigins,
} from "./cors-origins.js";
import {
  resolveEmbedSessionFromRequest,
  resolvedEmbedCapabilityScope,
} from "./embed-session.js";
import { getHttpRequestTelemetryId } from "./http-response-telemetry.js";
import { consumeOneTimeJti } from "./identity-sso-store.js";
import { getForwardedRequestOrigin } from "./request-origin.js";

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

/**
 * Auto-mount actions as HTTP endpoints under /_agent-native/actions/:name.
 *
 * Actions are exposed as POST by default. Use `http: { method: "GET" }` in
 * defineAction to expose as GET. Use `http: false` to mark as agent-only.
 */
import { isLoopbackRequest, registerAuthPublicPaths } from "./auth.js";
import { getH3App } from "./framework-request-handler.js";
import { runWithRequestContext } from "./request-context.js";

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
  // The core client serializes arrays as `key[]=value` so even a single
  // value can validate against z.array() action schemas.
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

/**
 * Read the caller's IANA timezone from the `x-user-timezone` header. The core
 * client sends this on every action request so server-side "today" fallbacks
 * can honor the user's local day.
 */
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

/**
 * True when the request originated from the browser action client
 * (`useActionQuery` / `useActionMutation` / `callAction`), which tags every
 * call with `X-Agent-Native-Frontend: 1`. Used to set `ctx.caller` to
 * `"frontend"` vs a bare programmatic `"http"` POST. The header carries no
 * auth weight — it only narrows the caller tag for tracking/branching.
 */
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
        ? `Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-CSRF,X-User-Timezone,X-Agent-Native-Session-Id,X-Agent-Native-Client-Platform,X-Agent-Native-Tool-Bridge,X-Agent-Native-Tool-Id,X-Agent-Native-Frontend,X-Agent-Native-Client-Compatibility,X-Agent-Native-Build-Id,${EMBED_TARGET_HEADER}`
        : `${MCP_EMBED_CORS_ALLOW_HEADERS},X-Agent-Native-Tool-Bridge,X-Agent-Native-Tool-Id,X-Agent-Native-Frontend,X-Agent-Native-Client-Compatibility,X-Agent-Native-Build-Id`,
    );
  }

  setResponseStatus(event, 204);
  return "";
}

/**
 * Declarative auth adapter for the HTTP action route. Its `resolveCaller` runs
 * BEFORE the framework's `getOwnerFromEvent` / `getSession` chain, letting an
 * app accept caller identities `getSession` doesn't understand (e.g. an A2A
 * JWT) without reaching into request context from a Nitro `request` hook.
 *
 * Scoped to `/_agent-native/actions/*` only — it does not affect other routes.
 */
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
  /** Verified A2A correlation and issuer metadata for the audit row. */
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
  /** Resolve owner email from the H3 event (for data scoping). */
  getOwnerFromEvent?: (event: any) => string | Promise<string>;
  /** Hosting app/template id used for app-owned action resources. */
  appId?: string;
  /** Resolve display name from the H3 event, when available. */
  getUserNameFromEvent?: (
    event: any,
  ) => string | undefined | Promise<string | undefined>;
  /** Resolve org ID from the H3 event (for org scoping). */
  resolveOrgId?: (event: any) => string | null | Promise<string | null>;
  /**
   * Optional caller resolver that runs before the `getOwnerFromEvent` /
   * `getSession` chain. Lets apps accept A2A JWTs (or other bearer schemes) on
   * the action route declaratively. See {@link ActionRouteAuthAdapter}.
   */
  actionRouteAuth?: ActionRouteAuthAdapter;
}

function normalizeOrgId(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isFirstBootMissingOrgTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /no such table:?\s*["'`]?org_members["'`]?/i.test(error.message) ||
    /relation\s+["'`]?org_members["'`]?\s+does not exist/i.test(error.message)
  );
}

/**
 * The user's stored active org, for a request whose own org resolution came
 * back empty. An empty `orgId` is not "this user has no org": it silently
 * narrows every scoped read to rows with a null `org_id`, so a session minted
 * before org selection — or one whose membership read failed — stops seeing
 * the user's own org-scoped dashboards, credentials, and resources. This
 * honors an explicit Personal selection by returning undefined, so it can
 * never promote a user into an org they left. A transient database failure is
 * not an answer and propagates.
 */
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

async function resolveRequestAuthCapability(
  event: any,
): Promise<string | undefined> {
  try {
    return resolvedEmbedCapabilityScope(
      await resolveEmbedSessionFromRequest(event),
    );
  } catch {
    // Invalid or unavailable embed auth must fail closed as no capability.
    return undefined;
  }
}

/**
 * Mount discovered actions as HTTP endpoints.
 *
 * Only actions from `autoDiscoverActions` (template actions) are mounted.
 * Built-in actions (resource-*, chat-*, shell, etc.) are NOT passed here.
 */
export function mountActionRoutes(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options?: MountActionRoutesOptions,
) {
  const mounted: string[] = [];
  const app = getH3App(nitroApp);

  for (const [name, entry] of Object.entries(actions)) {
    // Skip agent-only actions
    if (entry.http === false) continue;

    const method = entry.http?.method ?? "POST";
    const path = entry.http?.path ?? name;
    const routePath = `${ROUTE_PREFIX}/${path}`;

    // These two actions authenticate with a scoped A2A bearer rather than a
    // browser session. Let that verifier see the request before the cookie
    // auth guard rejects it; the action route still fails closed on invalid
    // or missing credentials.
    if (name === "list-feature-flags" || name === "set-feature-flag") {
      registerAuthPublicPaths([routePath], app);
    }

    app.use(
      routePath,
      defineEventHandler(async (event) => {
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
          "X-Agent-Native-Client-Mismatch,X-Agent-Native-Build-Id,X-Agent-Native-Client-Compatibility",
        );

        // Browser action calls are RPCs over the framework transport. The
        // action's HTTP method remains authoritative for direct HTTP callers,
        // but frontend callers must not have to duplicate it in every hook.
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

        // (audit H5) Per-action `toolCallable` opt-out for the tools-iframe
        // bridge. The bridge tags every outbound action call with
        // X-Agent-Native-Tool-Bridge: 1. When that header is present and the
        // action declares `toolCallable: false`, we 403 — used by the
        // framework's share-resource / unshare-resource /
        // set-resource-visibility for defense-in-depth on auth-adjacent
        // operations. Undefined defaults to allow: tools are intra-org and
        // typically authored by trusted teammates, so the default is to
        // trust the org-level access controls.
        // The header is set by the parent (the React host), not by the
        // iframe's user-authored content; sanitizeToolRequestOptions strips
        // iframe attempts to spoof it.
        const fromToolBridge =
          getHeader(event, "x-agent-native-tool-bridge") === "1";
        if (fromToolBridge && entry.toolCallable === false) {
          setResponseStatus(event, 403);
          return {
            error: `Action '${name}' is not callable from tools.`,
          };
        }

        // Resolve auth context for per-request scoping
        let userEmail: string | undefined;
        let userName: string | undefined;
        const authCapability = await resolveRequestAuthCapability(event);
        // An app-supplied auth adapter runs first: it can accept caller
        // identities the framework's getSession chain doesn't understand (e.g.
        // an A2A JWT). A resolved caller is seeded onto the event context so any
        // downstream resolveAgentRunOwnerContext (nested agent runs) sees the
        // same identity. The adapter is only consulted for the action route, so
        // it can't affect other surfaces.
        //
        // Contract: `resolveCaller` returning `null` means "this credential
        // isn't mine — defer to the cookie/session chain below". THROWING means
        // "the credential is mine but invalid" (e.g. an expired/forged A2A
        // bearer) and is a hard rejection: we surface a 401 instead of falling
        // through, so a live same-origin session cookie can't silently execute
        // the request as the logged-in user.
        let resolvedCaller: ActionRouteResolvedCaller | null = null;
        {
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
        if (!resolvedCaller && options?.getOwnerFromEvent) {
          try {
            userEmail = await options.getOwnerFromEvent(event);
            userName = options?.getUserNameFromEvent
              ? await options.getUserNameFromEvent(event)
              : undefined;
          } catch (error) {
            if (
              entry.requiresAuth === false &&
              isAuthResolutionFailure(error)
            ) {
              userEmail = undefined;
              userName = undefined;
            } else {
              throw error;
            }
          }
        }
        // Org scoping. For adapter-resolved callers the org must come
        // exclusively from the verified credential: the adapter-asserted
        // orgId when present, explicit null when the caller has no org,
        // otherwise the owner-email membership lookup.
        // The request's ambient session/org state (`resolveOrgId`, usually
        // getSession-backed) is deliberately NOT consulted — a request can
        // carry both a valid A2A bearer and an unrelated same-origin browser
        // cookie, and the cookie user's org must not become the org the
        // token caller's actions execute under. Non-adapter callers keep the
        // original resolveOrgId-only behavior.
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
        } else {
          orgId = options?.resolveOrgId
            ? ((await options.resolveOrgId(event)) ?? undefined)
            : undefined;
          if (!orgId && userEmail) orgId = await storedActiveOrgId(userEmail);
        }
        const timezone = readTimezoneHeader(event);
        const browserSessionId = readBrowserSessionIdHeader(event);
        const clientPlatform = readAnalyticsClientPlatformHeader(event);

        return runWithRequestContext(
          {
            userEmail,
            userName,
            orgId,
            authCapability,
            timezone,
            browserSessionId,
            clientPlatform,
            requestOrigin: getForwardedRequestOrigin(event),
            // Captured here because this is the last layer that still holds
            // the h3 event; everything below reads it off the request store.
            isLoopbackRequest: isLoopbackRequest(event),
          },
          async () => {
            // Reject oversize bodies from Content-Length before parsing, so a
            // public no-auth POST can't force parse work on a huge request.
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
            // Parse params based on method. On web-standard runtimes (Netlify
            // Functions, CF Workers), event.req IS the web Request — use .json()
            // directly. H3's readBody fails on those runtimes because it expects
            // a Node.js stream on event.node.req.
            let params: Record<string, any>;
            try {
              if (method === "GET") {
                // H3 v2: prefer web Request URL, fallback to getQuery
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
                  // H3 v2: event.req is the web Request — use .json() directly
                  params = (await webReq.json().catch(() => null)) ?? {};
                } else {
                  // Fallback: H3's readBody (Node.js dev)
                  params = (await readBody(event)) ?? {};
                }
              }
            } catch {
              params = {};
            }

            // Run the action. Tag the caller: browser calls (useActionQuery /
            // useActionMutation / callAction) send X-Agent-Native-Frontend: 1,
            // so they become "frontend"; bare programmatic POSTs are "http".
            // userEmail / orgId mirror the request context resolved above (do
            // NOT inject a dev identity — leave undefined when unauthenticated).
            try {
              const caller = resolvedCaller
                ? "a2a"
                : isFrontendActionRequest(event)
                  ? "frontend"
                  : "http";
              const result = await entry.run(params, {
                userEmail,
                orgId: orgId ?? null,
                appId: options?.appId,
                caller,
                requestHeaders: event.headers,
                actionName: name,
                ...(resolvedCaller?.delegationJti
                  ? {
                      networkProtocol: "a2a",
                      networkId: resolvedCaller.delegationJti,
                      networkPeer: resolvedCaller.delegationIssuer,
                    }
                  : {}),
              });

              // Auto-refresh the UI after a successful mutating action. GET
              // actions and actions explicitly flagged readOnly are skipped.
              // Other tabs' useDbSync will see source:"action" and invalidate
              // their action queries. The calling tab already refetches via
              // useActionMutation's onSuccess, so this is mainly cross-tab
              // sync (and parity with the agent's tool-call path).
              // A per-call Plan-mode effect wins over entry.readOnly, which
              // wins (true OR false) over the method heuristic. defineAction
              // already auto-infers GET → readOnly=true, so for actions
              // registered through that path entry.readOnly is always set and
              // the fallback just guards legacy wrap paths.
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

              // If the action returned a string, try to parse as JSON for a
              // clean response. Plain strings still need to go over the HTTP
              // action transport as JSON, otherwise H3 sends text/plain and the
              // browser action client rejects the successful 2xx response.
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
              // Return 400 for validation errors, the explicit statusCode if
              // set, otherwise 500.
              const status = isValidationError ? 400 : (explicitStatus ?? 500);
              setResponseStatus(event, status);

              // Only echo the raw message for known-safe cases:
              //  - validation errors (deterministic, parameter-shape only)
              //  - action contract errors (explicitly safe on every transport)
              //  - explicit user-facing errors (AgentActionStopError / fail())
              //  - errors with an explicit statusCode < 500 (client errors)
              // For uncategorized 500s, return a generic message and keep the
              // real detail server-side only — it can contain DB/driver/
              // upstream text we must not leak to HTTP callers.
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
                  : { error: msg };
              }
              const requestId = getHttpRequestTelemetryId(event);
              const captureId = captureError(err, {
                route: routePath,
                method: reqMethod,
                tags: {
                  action: name,
                  caller: resolvedCaller
                    ? "a2a"
                    : isFrontendActionRequest(event)
                      ? "frontend"
                      : "http",
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
        ); // end runWithRequestContext
      }),
    );

    mounted.push(`${method} ${routePath}`);
  }

  if (mounted.length > 0 && process.env.DEBUG)
    console.log(
      `[action-routes] Mounted ${mounted.length} action route(s): ${mounted.join(", ")}`,
    );
}
