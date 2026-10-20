/**
 * Builder as the identity provider for Design (spike).
 *
 * When Design runs as the editing surface inside Builder, Builder already knows
 * who the user is and which space they act in. Rather than give every Builder
 * user a second account here and keep the two in sync, Design trusts Builder:
 *
 *   1. The in-process host POSTs the user's Builder (Firebase) ID token once
 *      to `/api/builder-identity/exchange`.
 *   2. We verify it against Google's securetoken keys (no Builder API call).
 *   3. We set a short-lived, HMAC-signed, HttpOnly cookie with the Builder
 *      uid/email/space. `getSession` (core's custom-provider hook) reads it on
 *      every later request, including SSE streams that cannot carry headers.
 *
 * With a custom provider installed, core skips better-auth entirely: no
 * Design-side users, passwords or invites exist for Builder users.
 *
 * Off unless `BUILDER_IDENTITY=1`, so standalone Design is unchanged.
 *
 * Not done in the spike (belongs to the gateway / org provider):
 * - verifying the user is a member of `spaceId` with the right role;
 * - mapping the Builder space onto a Design org for sharing/RBAC.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { ActionContractError } from "@agent-native/core/action";
import { registerHostLabOverrides } from "@agent-native/core/labs/server";
import { registerDelegatedBuilderCredentials } from "@agent-native/core/server";
import { registerHostAccessResolver } from "@agent-native/core/sharing";
import { getCookie, type H3Event } from "h3";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

import { readFusionApp } from "../../shared/full-app.js";

export const BUILDER_IDENTITY_COOKIE = "an_builder_identity";
const COOKIE_TTL_SECONDS = 60 * 60;

const GOOGLE_SECURETOKEN_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

export function isBuilderIdentityEnabled(): boolean {
  return process.env.BUILDER_IDENTITY === "1";
}

// A per-boot secret is fine for a dev spike: restarting just re-runs the
// exchange. Production sets BUILDER_IDENTITY_COOKIE_SECRET.
const cookieSecret =
  process.env.BUILDER_IDENTITY_COOKIE_SECRET || randomBytes(32).toString("hex");

function allowedFirebaseProjects(token: string): string[] {
  const configured = (process.env.BUILDER_FIREBASE_PROJECT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  if (process.env.NODE_ENV === "production") return [];
  // Dev only: accept the token's own project. The signature is still checked
  // against Google's keys, so this pins "a real Firebase token", not "Builder".
  const aud = decodeJwt(token).aud;
  return typeof aud === "string" ? [aud] : [];
}

export interface BuilderIdentity {
  uid: string;
  email: string;
  name?: string;
  spaceId?: string;
}

export async function verifyBuilderIdToken(
  token: string,
): Promise<BuilderIdentity> {
  const projects = allowedFirebaseProjects(token);
  if (projects.length === 0) throw new Error("no Builder Firebase project");
  const { payload } = await jwtVerify(token, GOOGLE_SECURETOKEN_JWKS, {
    issuer: projects.map((id) => `https://securetoken.google.com/${id}`),
    audience: projects,
  });
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!payload.sub || !email) throw new Error("token has no user or email");
  if (payload.email_verified === false) throw new Error("email not verified");
  return {
    uid: payload.sub,
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

function sign(body: string): string {
  return createHmac("sha256", cookieSecret).update(body).digest("base64url");
}

export function encodeIdentityCookie(identity: BuilderIdentity): string {
  const body = Buffer.from(
    JSON.stringify({
      ...identity,
      exp: Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function identityCookieMaxAge(): number {
  return COOKIE_TTL_SECONDS;
}

function decodeIdentityCookie(value: string): BuilderIdentity | null {
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now()) {
      return null;
    }
    if (typeof parsed.uid !== "string" || typeof parsed.email !== "string") {
      return null;
    }
    return parsed as BuilderIdentity;
  } catch {
    // coercion-ok: a cookie that does not decode is no session; the caller
    // treats null as signed out and the host re-runs the exchange.
    return null;
  }
}

/**
 * The caller's own Builder credential, kept server-side (never in the
 * cookie) so Design can call ai-services *as that user*: Builder resolves the
 * user from the token and the space from `apiKey`, so per-user roles, MCP
 * OAuth tokens and credits apply exactly as in Builder. Firebase ID
 * tokens live an hour; the host re-exchanges when Builder refreshes it.
 * In-memory is spike-grade; production keeps this in the session store.
 */
const delegatedCredentials = new Map<
  string,
  { token: string; uid: string; spaceId?: string; expiresAtMs: number }
>();

export function rememberDelegatedCredential(
  identity: BuilderIdentity,
  token: string,
): void {
  const exp = decodeJwt(token).exp;
  delegatedCredentials.set(identity.email.toLowerCase(), {
    token,
    uid: identity.uid,
    spaceId: identity.spaceId,
    expiresAtMs: typeof exp === "number" ? exp * 1000 : Date.now() + 5 * 60_000,
  });
}

if (isBuilderIdentityEnabled()) {
  // One seam: core's Builder credential lookup. The AI gateway engine,
  // Fusion containers, credits and deploys all resolve through it, so the
  // Design agent and its Fusion calls run as this Builder user in this space.
  // Rollout belongs to the host. In production this hook answers from
  // Builder's LaunchDarkly evaluations for the user and space; here Builder
  // hosting simply means full-app editing is on.
  registerHostLabOverrides((key) =>
    key === "full-app-building" ? true : undefined,
  );
  registerDelegatedBuilderCredentials((email) => {
    const entry = delegatedCredentials.get(email.toLowerCase());
    if (!entry || entry.expiresAtMs < Date.now() || !entry.spaceId) return null;
    return { token: entry.token, spaceId: entry.spaceId };
  });
}

/**
 * Who may open a design bound to a Builder project is Builder's decision.
 * Design keeps no copy of Builder's spaces, members or roles: per request it
 * asks Builder, as the requesting user, whether they can see the project
 * (`GET /projects/:id`, which Builder gates with `canUserAccessProject`).
 * A short cache keeps canvas polling from re-asking on every call.
 *
 * See roleFromProject for what the read can and cannot tell. A production
 * version asks Builder for the caller's project permissions (editCode), still
 * without storing them here.
 */
const BUILDER_API_HOST =
  process.env.BUILDER_API_HOST || "https://api.builder.io";
const ACCESS_CACHE_MS = 60_000;
type BuilderProjectRole = "editor" | "viewer" | null;
const accessCache = new Map<string, { role: BuilderProjectRole; at: number }>();

/**
 * What Design can tell from Builder's project read. Builder's 200 means "can
 * see", not "can edit", so only what the response itself shows is used:
 * - a project owned by another space is visible only because it is public,
 *   so it is read-only;
 * - a private project that sets this user's own editCode to false is
 *   read-only.
 * Role-based edit permission is not in the response; until Builder reports
 * the caller's project permissions, everyone else who can see it can edit.
 */
function roleFromProject(
  project: unknown,
  uid: string,
  spaceId: string,
): Exclude<BuilderProjectRole, null> {
  const record = (project ?? {}) as {
    ownerId?: unknown;
    accessMode?: unknown;
    projectAccess?: { users?: Record<string, { editCode?: unknown } | null> };
  };
  if (record.ownerId !== spaceId) return "viewer";
  const own = record.projectAccess?.users?.[uid];
  if (record.accessMode === "private" && own?.editCode === false) {
    return "viewer";
  }
  return "editor";
}

async function builderProjectRole(
  email: string,
  projectId: string,
): Promise<BuilderProjectRole> {
  const entry = delegatedCredentials.get(email.toLowerCase());
  // No usable Builder credential here (it expired, or this instance never
  // saw the exchange, e.g. after a restart) is not Builder saying no.
  if (!entry || entry.expiresAtMs < Date.now() || !entry.spaceId) {
    throw new BuilderSignInRequiredError();
  }
  const cacheKey = `${email.toLowerCase()}:${entry.spaceId}:${projectId}`;
  const cached = accessCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_MS) return cached.role;
  const url = new URL(
    `/projects/${encodeURIComponent(projectId)}`,
    BUILDER_API_HOST,
  );
  url.searchParams.set("includeBranches", "false");
  url.searchParams.set("apiKey", entry.spaceId);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${entry.token}` },
    });
  } catch (error) {
    throw new BuilderUnavailableError(error);
  }
  // Only Builder saying no is a denial worth remembering. Anything else
  // (5xx, a body that is not a project) is Builder being unavailable,
  // which is never cached and never reads as "no access".
  let role: BuilderProjectRole;
  if (response.ok) {
    let project: unknown;
    try {
      project = await response.json();
    } catch (error) {
      throw new BuilderUnavailableError(error);
    }
    role = roleFromProject(project, entry.uid, entry.spaceId);
  } else if ([401, 403, 404].includes(response.status)) {
    role = null;
  } else {
    throw new BuilderUnavailableError(`Builder returned ${response.status}`);
  }
  accessCache.set(cacheKey, { role, at: Date.now() });
  return role;
}

/**
 * Builder could not answer an access question; not the same as "no". Typed
 * (503) so any action that reaches the access check reports it as such.
 */
export class BuilderUnavailableError extends ActionContractError {
  readonly reason: unknown;
  constructor(
    reason: unknown,
    options: { message?: string; errorCode?: string; statusCode?: number } = {},
  ) {
    super(
      options.message ?? "Builder is unavailable right now; try again shortly.",
      {
        errorCode: options.errorCode ?? "builder_unavailable",
        statusCode: options.statusCode ?? 503,
      },
    );
    this.name = "BuilderUnavailableError";
    this.reason = reason;
  }
}

/**
 * This server holds no current Builder credential for the user, so it cannot
 * ask Builder (401). The host re-runs the sign-in exchange to recover.
 */
export class BuilderSignInRequiredError extends BuilderUnavailableError {
  constructor() {
    super("no delegated Builder credential", {
      message: "Sign in to Builder again to open this design.",
      errorCode: "builder_sign_in_required",
      statusCode: 401,
    });
    this.name = "BuilderSignInRequiredError";
  }
}

/**
 * Whether Builder lets this user into the project, asked before a design is
 * bound to it. `undefined` when Builder identity is off (standalone Design),
 * where there is no Builder session to ask.
 */
export async function canAccessBuilderProject(
  email: string,
  projectId: string,
): Promise<boolean | undefined> {
  if (!isBuilderIdentityEnabled()) return undefined;
  return (await builderProjectRole(email, projectId)) !== null;
}

if (isBuilderIdentityEnabled()) {
  registerHostAccessResolver("design", async (resource, ctx) => {
    const app = readFusionApp(resource?.data);
    if (!app || !ctx.userEmail) return undefined; // not Builder-hosted: AN rules
    // A local launch session lives on the user's own machine: no Builder
    // project to ask about, so AN's owner rules apply.
    if (app.projectId === "local") return undefined;
    try {
      return await builderProjectRole(ctx.userEmail, app.projectId);
    } catch (error) {
      // While Builder is unreachable the design's owner keeps Design's own
      // owner access instead of being locked out; nobody else is let in on
      // Design's rules alone.
      const isOwner =
        typeof resource?.ownerEmail === "string" &&
        resource.ownerEmail.toLowerCase() === ctx.userEmail.toLowerCase();
      if (error instanceof BuilderUnavailableError && isOwner) return undefined;
      throw error;
    }
  });
}

/** Core's `AuthOptions.getSession`: the Builder user, or nobody. */
export async function getBuilderIdentitySession(event: H3Event) {
  const cookie = getCookie(event, BUILDER_IDENTITY_COOKIE);
  const identity = cookie ? decodeIdentityCookie(cookie) : null;
  if (!identity) return null;
  return {
    email: identity.email,
    userId: `builder:${identity.uid}`,
    name: identity.name,
    emailVerified: true,
  };
}
