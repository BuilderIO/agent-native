import {
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
  getMethod,
  getRequestHeader,
} from "h3";
import * as jose from "jose";

import { redactArgsToJson } from "../audit/redact.js";
import {
  extractBearerToken,
  verifyInternalToken,
} from "../integrations/internal-token.js";
import { getH3App } from "../server/framework-request-handler.js";
import { readBody } from "../server/h3-helpers.js";
import { isSameOriginRequest } from "../server/request-origin.js";
import { generateAgentCard } from "./agent-card.js";
import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
} from "./auth-policy.js";
import { handleJsonRpcH3, processA2ATaskFromQueue } from "./handlers.js";
import {
  claimA2AApproval,
  getA2AApprovalForOwner,
  settleA2AApproval,
} from "./task-store.js";
import type { A2AConfig } from "./types.js";

/**
 * One-time warning when A2A is running unauthenticated in development. We
 * don't refuse the request (local templates need to work out of the box),
 * but we log a single noisy line so operators notice if they accidentally
 * deploy with no auth configured.
 */
let _warnedUnauthA2A = false;
function warnA2AUnauthOnce(): void {
  if (_warnedUnauthA2A) return;
  _warnedUnauthA2A = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[a2a] No A2A_SECRET or apiKeyEnv configured — A2A endpoint runs unauthenticated. " +
      "This is allowed in development but blocked in production. Set A2A_SECRET before deploying.",
  );
}

/**
 * Result of verifying an inbound A2A JWT. `email` is the caller identity from
 * the token's `sub` claim (null when verification fails), `orgDomain` mirrors
 * the verified `org_domain` claim when present.
 */
export interface A2ATokenPayload {
  email: string | null;
  orgDomain: string | null;
}

function addSecretCandidate(
  candidates: string[],
  secret: string | undefined,
): void {
  const trimmed = secret?.trim();
  if (!trimmed || candidates.includes(trimmed)) return;
  candidates.push(trimmed);
}

/**
 * Resolve the audience (`aud`) value to expect in an inbound JWT. We use the
 * receiver's app URL — it's the natural identifier of "who this token was
 * minted for". Returns undefined when no app URL is configured and no request
 * host is derivable; `verifyA2AToken` then rejects any token that carries an
 * `aud` claim (fail closed — a correctly signed token minted for another
 * service must not verify here). Only tokens without an `aud` claim (minted
 * before the audience claim shipped) skip the audience check.
 */
function expectedJwtAudience(event: any | undefined): string | undefined {
  const fromEnv =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL;
  if (fromEnv) return String(fromEnv).replace(/\/$/, "");
  // Best-effort: derive from the inbound request host. This is forgeable
  // (Host-header attack), but only useful as a hint when env-derived URL
  // is unset; the rest of the JWT verification still uses the secret.
  try {
    const proto = getRequestHeader(event, "x-forwarded-proto") || "https";
    const host = getRequestHeader(event, "host");
    if (host) return `${proto}://${host}`;
  } catch {}
  return undefined;
}

/**
 * Verify an inbound A2A bearer token (HS256) exactly as the
 * `/_agent-native/a2a` endpoint does: it peeks at the unverified `org_domain`
 * claim to build an ordered candidate-secret set (`process.env.A2A_SECRET`
 * plus any org-level secret for that domain), then verifies the JWT — checking
 * `aud`/`iss` when the token carries them and `exp` always. Returns the
 * caller's email (`sub`) and org domain on success, or `{ email: null,
 * orgDomain: null }` on any failure (malformed, bad signature, expired, or no
 * secret configured), never throwing.
 *
 * Exported so workspaces can accept A2A callers on the HTTP action route with
 * the same routine — including org-level fallback secrets — instead of
 * reimplementing a partial verifier. Pass the H3 `event` to enable org-domain →
 * org-secret lookup and audience derivation; it is optional.
 */
export async function verifyA2AToken(
  token: string,
  event?: any,
): Promise<A2ATokenPayload> {
  // Step 1: Peek at JWT claims WITHOUT verification to get org_domain.
  // This is safe because we only use org_domain to look up the secret,
  // then verify the full JWT with that secret. If someone forges a JWT
  // with a fake org_domain, verification will fail because they don't
  // have the real secret.
  let orgDomainHint: string | undefined;
  let unverifiedPayload: jose.JWTPayload | undefined;
  try {
    unverifiedPayload = jose.decodeJwt(token);
    orgDomainHint = unverifiedPayload.org_domain as string | undefined;
  } catch {
    // Malformed token — fall through to global secret attempt
  }

  // Step 2: Build a small, ordered set of candidate secrets. Tokens minted by
  // current callers prefer the shared A2A_SECRET; older callers may still use
  // an org-level secret. Try both without logging or reflecting secret details.
  const candidateSecrets: string[] = [];
  addSecretCandidate(candidateSecrets, process.env.A2A_SECRET);
  if (orgDomainHint) {
    try {
      const { getA2ASecretByDomain } = await import("../org/context.js");
      const orgSecret = await getA2ASecretByDomain(orgDomainHint);
      addSecretCandidate(candidateSecrets, orgSecret ?? undefined);
    } catch {
      // DB not ready or column doesn't exist yet — fall through
    }
  }
  if (candidateSecrets.length === 0) return { email: null, orgDomain: null };

  // Step 3: Verify JWT with the candidate secrets.
  //
  // - `audience`: passed only when the token carries an `aud` claim
  //   (backward-compat: tokens minted by older `signA2AToken` versions
  //   don't include one).
  // - `issuer`: enforced when the token carries an `iss` claim. The
  //   sender's `signA2AToken` (`a2a/client.ts:42`) sets the issuer to its
  //   own app URL, so a verified token must self-identify a non-empty
  //   string issuer. We accept any string the token claims (we don't pin
  //   a specific expected issuer because dispatchers may legitimately
  //   mint tokens from many sender URLs — dev tunnels, multi-deploy
  //   setups). The pin is "issuer must match the value the token says
  //   it was minted from", which `jose.jwtVerify` validates exactly when
  //   `issuer` is supplied as a string. Backward-compat: when the token
  //   has no `iss`, we skip the check.
  try {
    const verifyOptions: jose.JWTVerifyOptions = {};
    if (unverifiedPayload && typeof unverifiedPayload.aud !== "undefined") {
      // Fail closed: the token was minted for a specific audience, but this
      // receiver can't derive its own expected audience (no APP_URL/URL and no
      // usable request host). Accepting here would let a correctly-signed token
      // whose `aud` targets ANOTHER service verify against a shared secret. A
      // token that self-declares an audience must be checked against ours, so
      // when we have nothing to check it against we reject rather than skip.
      const aud = expectedJwtAudience(event);
      if (!aud) return { email: null, orgDomain: null };
      verifyOptions.audience = aud;
    }
    if (
      unverifiedPayload &&
      typeof unverifiedPayload.iss === "string" &&
      unverifiedPayload.iss.length > 0
    ) {
      verifyOptions.issuer = unverifiedPayload.iss;
    }
    for (const secret of candidateSecrets) {
      try {
        const { payload } = await jose.jwtVerify(
          token,
          new TextEncoder().encode(secret),
          verifyOptions,
        );
        return {
          email: (payload.sub as string) ?? null,
          orgDomain: (payload.org_domain as string) ?? null,
        };
      } catch {
        // Try the next candidate without leaking which secret failed.
      }
    }
  } catch {
    // Keep malformed option construction indistinguishable from auth failure.
  }
  return { email: null, orgDomain: null };
}

/**
 * Mount A2A protocol endpoints on an H3/Nitro app.
 *
 * - GET /.well-known/agent-card.json — public agent card (no auth)
 * - POST /_agent-native/a2a — JSON-RPC endpoint (with optional auth)
 *
 * When A2A_SECRET is set, inbound Bearer tokens are verified as JWTs
 * and the caller's email is extracted from the `sub` claim. This provides
 * cryptographic identity verification for cross-app A2A calls.
 */
export function mountA2A(
  nitroApp: any,
  config: A2AConfig,
  routePrefix = "/_agent-native",
): void {
  // Public agent card endpoint (no auth required).
  //
  // SECURITY: per-user / per-org MCP tools are filtered out of the public
  // skills list. Their merged-key prefix (`mcp__user_<emailhash>_…` or
  // `mcp__org_<orgid>_…`) discloses (a) which users have integrations
  // attached, and (b) what those integrations are — fingerprinting the
  // tenant. Template- and framework-defined skills stay; only the dynamic
  // per-tenant MCP entries are dropped. See finding #7 in
  // /tmp/security-audit/12-mcp-a2a-agent.md.
  getH3App(nitroApp).use(
    "/.well-known/agent-card.json",
    defineEventHandler((event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const protocol =
        getRequestHeader(event, "x-forwarded-proto") ||
        (event.url?.protocol?.replace(":", "") ?? "http");
      const host = getRequestHeader(event, "host") ?? "localhost";
      const baseUrl = `${protocol}://${host}`;

      const filteredSkills = filterPublicAgentCardSkills(config);

      return generateAgentCard(
        { ...config, skills: filteredSkills },
        baseUrl,
        `${routePrefix}/a2a`,
      );
    }),
  );

  // Human-only continuation for consequential A2A tool calls. The opaque id
  // is a lookup handle, not authorization: every read and mutation also
  // requires the task owner's live browser session. Ordinary A2A bearer
  // tokens never reach this control plane and cannot approve themselves.
  getH3App(nitroApp).use(
    `${routePrefix}/a2a/approvals`,
    defineEventHandler(async (event) => {
      const approvalId = (event.path || "")
        .split("?")[0]
        .replace(/^\//, "")
        .split("/")[0];
      if (!approvalId) {
        setResponseStatus(event, 404);
        return { error: "Approval not found" };
      }

      const { getSession } = await import("../server/auth.js");
      const session = await getSession(event);
      if (!session?.email) {
        setResponseStatus(event, 401);
        return { error: "Sign in to review this approval" };
      }

      if (getMethod(event) === "GET") {
        const approval = await getA2AApprovalForOwner(
          approvalId,
          session.email,
          session.orgId ?? null,
        );
        if (!approval) {
          setResponseStatus(event, 404);
          return { error: "Approval not found" };
        }
        const safeInput = redactArgsToJson(approval.input) ?? "{}";
        const esc = (value: string) =>
          value.replace(
            /[&<>"']/g,
            (char) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[char] ?? char,
          );
        setResponseHeader(event, "content-type", "text/html; charset=utf-8");
        setResponseHeader(event, "cache-control", "no-store");
        setResponseHeader(event, "x-frame-options", "DENY");
        setResponseHeader(
          event,
          "content-security-policy",
          "frame-ancestors 'none'",
        );
        setResponseHeader(event, "referrer-policy", "no-referrer");
        const expired = approval.expiresAt <= Date.now();
        const active = approval.status === "pending" && !expired;
        const displayStatus = expired ? "expired" : approval.status;
        return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review agent action</title><style>body{font:15px/1.5 ui-sans-serif,system-ui;background:#f7f7f5;color:#171717;margin:0}.card{max-width:680px;margin:8vh auto;background:white;border:1px solid #ddd;border-radius:14px;padding:28px;box-shadow:0 12px 36px #0001}h1{font-size:22px;margin:0 0 8px}p{color:#555}pre{white-space:pre-wrap;word-break:break-word;background:#f4f4f2;padding:16px;border-radius:9px;max-height:45vh;overflow:auto}button{background:#171717;color:white;border:0;border-radius:8px;padding:11px 16px;font-weight:650;cursor:pointer}button[disabled]{opacity:.5;cursor:default}#status{margin-left:10px;color:#555}</style></head><body><main class="card"><h1>Review agent action</h1><p>This action is paused until you approve it. Approval can be used once.</p><h2>${esc(approval.tool)}</h2><pre>${esc(safeInput)}</pre><button id="approve" ${active ? "" : "disabled"}>${active ? "Approve and run" : esc(displayStatus)}</button><span id="status">${active ? "" : esc(approval.result ?? displayStatus)}</span><script>document.getElementById('approve').onclick=async function(){this.disabled=true;document.getElementById('status').textContent='Running…';try{const r=await fetch(location.href,{method:'POST',credentials:'include',headers:{'content-type':'application/json'}});const j=await r.json();document.getElementById('status').textContent=j.output||j.error||'Done';}catch(e){document.getElementById('status').textContent='Could not run the action.'}}</script></main></body></html>`;
      }

      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      if (!isSameOriginRequest(event)) {
        setResponseStatus(event, 403);
        return { error: "Cross-origin approval denied" };
      }
      if (!config.executeApproval) {
        setResponseStatus(event, 501);
        return { error: "Approval execution is not configured" };
      }

      const approval = await claimA2AApproval(
        approvalId,
        session.email,
        session.orgId ?? null,
      );
      if (!approval) {
        const current = await getA2AApprovalForOwner(
          approvalId,
          session.email,
          session.orgId ?? null,
        );
        setResponseStatus(event, current ? 409 : 404);
        return {
          error: current
            ? `Approval is ${current.status} and cannot be run again`
            : "Approval not found",
        };
      }

      const { runWithRequestContext } =
        await import("../server/request-context.js");
      let execution: { status: "completed" | "failed"; output: string };
      try {
        execution = await runWithRequestContext(
          { userEmail: session.email, orgId: session.orgId ?? undefined },
          () => config.executeApproval!(approval),
        );
      } catch (error) {
        execution = {
          status: "failed",
          output:
            error instanceof Error
              ? error.message
              : "Approval execution failed",
        };
      }
      await settleA2AApproval(approval.id, execution.status, execution.output);
      if (execution.status === "failed") setResponseStatus(event, 500);
      return execution;
    }),
  );

  // Async-mode processor route. MUST be mounted BEFORE the `/a2a` catch-all
  // below, since h3's `.use()` matches by prefix and `/a2a` would otherwise
  // swallow `/a2a/_process-task` and return a JSON-RPC "Invalid token" error
  // (the JSON-RPC handler doesn't know about taskId-only bodies).
  //
  // When `message/send` is called with `async: true`, the JSON-RPC handler
  // enqueues the task and self-fires a POST to this route on the same
  // deployment so the actual handler runs in a fresh function execution (its
  // own full timeout). Authenticated with an HMAC token bound to the task id
  // (5-minute lifetime, signed with A2A_SECRET — same scheme as the
  // integration webhook queue).
  getH3App(nitroApp).use(
    `${routePrefix}/a2a/_process-task`,
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const body = (await readBody(event)) as { taskId?: unknown } | null;
      const taskId = body && typeof body.taskId === "string" ? body.taskId : "";
      if (!taskId) {
        setResponseStatus(event, 400);
        return { error: "taskId required" };
      }

      // When A2A_SECRET is set, require a valid HMAC token bound to this
      // taskId. In production, we REQUIRE A2A_SECRET to be set so unsigned
      // dispatches are never accepted (an attacker who fishes a taskId out
      // of logs / a share link could otherwise force-replay it). In
      // development, a missing secret is permitted so local templates work
      // out of the box, but we log a one-time warning so operators notice.
      if (hasConfiguredA2ASecret()) {
        const auth = getRequestHeader(event, "authorization");
        const tok = extractBearerToken(auth);
        if (!verifyInternalToken(taskId, tok ?? "")) {
          setResponseStatus(event, 401);
          return { error: "Invalid or expired processor token" };
        }
      } else if (isA2AProductionRuntime()) {
        setResponseStatus(event, 503);
        return {
          error:
            "A2A processor not configured — set A2A_SECRET on this deployment to enable async A2A.",
        };
      } else {
        warnA2AUnauthOnce();
      }

      try {
        await processA2ATaskFromQueue(taskId, config, event);
        return { ok: true };
      } catch (err: any) {
        console.error("[a2a] process-task failed:", err);
        setResponseStatus(event, 500);
        return { error: err?.message ?? "process-task failed" };
      }
    }),
  );

  // JSON-RPC A2A endpoint (with optional auth)
  getH3App(nitroApp).use(
    `${routePrefix}/a2a`,
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      // h3 prefix-matches mounts, so a request to `/a2a/_process-task`
      // reaches this handler too. The dedicated mount above runs first and
      // takes the request, but if that returns `undefined` (or h3 ever
      // changes ordering semantics) defensively bail here. event.path is
      // stripped to the remainder after the mount prefix.
      const sub = (event.path || "/").split("?")[0].replace(/^\//, "");
      if (sub.startsWith("_process-task")) return;

      const authHeader = getRequestHeader(event, "authorization");
      const bearerToken = extractBearerToken(authHeader);
      let verifiedCallerEmail: string | null = null;
      let verifiedOrgDomain: string | null = null;
      let verifiedAudienceBound = false;
      let legacyApiKeyAuthenticated = false;
      let bearerTokenRejectedByJwt = false;

      // SECURITY: when neither A2A_SECRET nor an apiKeyEnv is configured,
      // there's no way to authenticate the caller. Default to "auth required"
      // in production — return 503 with a clear message instead of running
      // the agent loop unauthenticated. In development, log a one-time
      // warning but allow so local templates work out of the box.
      const hasA2ASecret = hasConfiguredA2ASecret();
      const hasApiKey = !!(config.apiKeyEnv && process.env[config.apiKeyEnv]);

      // Try JWT verification first (org-level or global A2A_SECRET-based identity)
      if (bearerToken) {
        const tokenPayload = await verifyA2AToken(bearerToken, event);
        verifiedCallerEmail = tokenPayload.email;
        verifiedOrgDomain = tokenPayload.orgDomain;
        if (verifiedCallerEmail) {
          try {
            verifiedAudienceBound =
              typeof jose.decodeJwt(bearerToken).aud !== "undefined";
          } catch {
            verifiedAudienceBound = false;
          }
        }
        bearerTokenRejectedByJwt = !verifiedCallerEmail;
      }

      // Fall back to legacy API key check (exact string match)
      if (!verifiedCallerEmail && config.apiKeyEnv) {
        const expectedKey = process.env[config.apiKeyEnv];
        if (expectedKey) {
          if (!bearerToken) {
            setResponseStatus(event, 401);
            return {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32001, message: "Authentication required" },
            };
          }
          if (bearerToken !== expectedKey) {
            setResponseStatus(event, 401);
            return {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32001, message: "Invalid API key" },
            };
          }
          legacyApiKeyAuthenticated = true;
        }
      }

      if (!verifiedCallerEmail && !legacyApiKeyAuthenticated) {
        // Any supplied bearer token that failed JWT verification is an auth
        // failure after the legacy exact-match apiKeyEnv path has had a
        // chance to succeed. Do not let bad tokens fall through to tasks/get
        // and get reported as lookup misses.
        if (bearerTokenRejectedByJwt) {
          setResponseStatus(event, 401);
          return {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32001,
              message: "Invalid or expired A2A token",
            },
          };
        }

        if (!hasA2ASecret && !hasApiKey) {
          if (isA2AProductionRuntime()) {
            setResponseStatus(event, 503);
            return {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32001,
                message:
                  "A2A authentication not configured. Set A2A_SECRET (preferred) or configure apiKeyEnv to accept inbound A2A traffic.",
              },
            };
          }
          warnA2AUnauthOnce();
        } else if (isA2AProductionRuntime()) {
          setResponseStatus(event, 401);
          return {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32001,
              message: "Authentication required",
            },
          };
        }
      }

      // Store verified caller identity on the event context so the handler
      // can set request context from a trusted source instead of metadata
      if (verifiedCallerEmail) {
        event.context.__a2aVerifiedEmail = verifiedCallerEmail;
      }
      if (verifiedAudienceBound) {
        event.context.__a2aAudienceVerified = true;
      }
      if (verifiedOrgDomain) {
        event.context.__a2aOrgDomain = verifiedOrgDomain;
      }

      const body = await readBody(event);
      return handleJsonRpcH3(body, event, config);
    }),
  );
}

export function filterPublicAgentCardSkills(config: A2AConfig) {
  return (config.skills ?? []).filter((skill) => {
    const id =
      (skill as { id?: string; name?: string }).id ??
      (skill as { name?: string }).name ??
      "";
    if (typeof id === "string") {
      if (id.startsWith("mcp__user_") || id.startsWith("mcp__org_")) {
        return false;
      }
    }

    if (skill.public === false || skill.requiresAuth || skill.isConsequential) {
      return false;
    }

    if (!config.publicSkillsOnly) return true;

    if (skill.publicAgent) {
      return (
        skill.publicAgent.expose === true &&
        skill.publicAgent.readOnly === true &&
        skill.publicAgent.requiresAuth !== true &&
        skill.publicAgent.isConsequential !== true
      );
    }

    return skill.public === true && skill.readOnly !== false;
  });
}
