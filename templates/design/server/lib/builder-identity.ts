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
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { ActionContractError } from "@agent-native/core/action";
import { registerHostLabOverrides } from "@agent-native/core/labs/server";
import {
  deleteAppSecret,
  listAppSecretsForScope,
  readAppSecret,
  writeAppSecret,
} from "@agent-native/core/secrets";
import { registerDelegatedBuilderCredentials } from "@agent-native/core/server";
import { registerHostAccessResolver } from "@agent-native/core/sharing";
import { deleteCookie, getCookie, type H3Event } from "h3";
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

/** Every Builder owner key ends with this; nothing else can. */
const BUILDER_OWNER_DOMAIN = "builder-identity.invalid";

export function isBuilderOwnerEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${BUILDER_OWNER_DOMAIN}`);
}

/**
 * The owner key Design uses for a Builder user. Design keys everything it
 * stores by the session's email, so using the Builder email would merge a
 * Builder user into any Design account that shares it, and orphan their work
 * when they change email. The key is derived from the stable Builder uid
 * instead, together with the Firebase project that issued it: a uid is only
 * unique within its project, and tokens from every configured project are
 * accepted. It is not a deliverable address (`.invalid`), and is lowercase so
 * the places that normalize emails cannot make two users collide.
 */
export function builderOwnerEmail(projectId: string, uid: string): string {
  const digest = createHash("sha256")
    .update(`${projectId}\n${uid}`)
    .digest("hex")
    .slice(0, 32);
  return `b-${digest}@${BUILDER_OWNER_DOMAIN}`;
}

export interface BuilderIdentity {
  uid: string;
  /** The Firebase project that issued the token (its `aud`). */
  projectId: string;
  email: string;
  name?: string | undefined;
  spaceId?: string | undefined;
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
  const audience = [payload.aud ?? []].flat();
  const projectId = projects.find((project) => audience.includes(project));
  if (!projectId)
    throw new Error("token is not for a Builder Firebase project");
  return {
    uid: payload.sub,
    projectId,
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

function sign(body: string): string {
  return createHmac("sha256", cookieSecret).update(body).digest("base64url");
}

/** What the signed cookie carries: the identity, and which sign-in it belongs to. */
export interface BuilderCookieIdentity extends BuilderIdentity {
  /** Must be on the server-side list of live sign-ins, so logout can revoke every copy. */
  sid: string;
}

export function encodeIdentityCookie(identity: BuilderCookieIdentity): string {
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

function decodeIdentityCookie(value: string): BuilderCookieIdentity | null {
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
    if (
      typeof parsed.uid !== "string" ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.sid !== "string" ||
      typeof parsed.email !== "string"
    ) {
      return null;
    }
    return parsed as BuilderCookieIdentity;
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
 *
 * It lives in the app secrets store (encrypted, shared by every instance),
 * because serverless requests land on instances that never saw the exchange.
 * A short per-instance cache keeps polling from reading the store each time.
 */
interface DelegatedCredential {
  token: string;
  uid: string;
  spaceId?: string | undefined;
  expiresAtMs: number;
}

const CREDENTIAL_SECRET_KEY = "BUILDER_DELEGATED_CREDENTIAL";
/**
 * One row per sign-in (per cookie session id), so signing in, renewing and
 * signing out never read-modify-write a shared list: each touches only its
 * own row. A row is a live sign-in; deleting it revokes every copy of that
 * sign-in's cookie.
 */
const SIGN_IN_KEY_PREFIX = "BUILDER_SIGN_IN:";
/** A sign-in's absolute lifetime. The host renews the cookie within it. */
const SIGN_IN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Newest sign-ins kept per user; older rows are pruned when a new one is made. */
const MAX_SIGN_IN_ROWS = 20;

function credentialRef(owner: string) {
  return {
    key: CREDENTIAL_SECRET_KEY,
    scope: "user" as const,
    scopeId: owner,
  };
}

function signInRef(owner: string, sid: string) {
  return {
    key: `${SIGN_IN_KEY_PREFIX}${sid}`,
    scope: "user" as const,
    scopeId: owner,
  };
}

class UnreadableCredentialError extends Error {
  constructor() {
    super("The stored Builder credential could not be read");
    this.name = "UnreadableCredentialError";
  }
}

/** A stored row that does not parse is corrupt state, never "no credential". */
function parseStored<T>(
  value: string,
  valid: (parsed: Partial<T>) => boolean,
): T {
  let parsed: Partial<T>;
  try {
    parsed = JSON.parse(value) as Partial<T>;
  } catch {
    throw new UnreadableCredentialError();
  }
  if (!valid(parsed)) throw new UnreadableCredentialError();
  return parsed as T;
}

const parseCredential = (value: string) =>
  parseStored<DelegatedCredential>(
    value,
    (parsed) =>
      typeof parsed.token === "string" &&
      typeof parsed.uid === "string" &&
      typeof parsed.expiresAtMs === "number",
  );

/** The stored row, expired or not; null only when there is no row. */
async function readStoredCredential(
  owner: string,
): Promise<DelegatedCredential | null> {
  const secret = await readAppSecret(credentialRef(owner));
  return secret ? parseCredential(secret.value) : null;
}

/** Whether this sign-in is live: its row exists and is within its lifetime. */
async function isSignInLive(owner: string, sid: string): Promise<boolean> {
  const secret = await readAppSecret(signInRef(owner, sid));
  if (!secret) return false;
  const { expiresAtMs } = parseStored<{ expiresAtMs: number }>(
    secret.value,
    (parsed) => typeof parsed.expiresAtMs === "number",
  );
  return expiresAtMs >= Date.now();
}

/** The user's sign-in rows, newest first. */
async function listSignIns(owner: string) {
  const rows = await listAppSecretsForScope("user", owner);
  return rows.filter((row) => row.key.startsWith(SIGN_IN_KEY_PREFIX));
}

/**
 * The sign-in id for an exchange. A host refreshing a live session (Firebase
 * tokens last an hour) keeps its sign-in rather than minting another, so
 * routine refreshes neither use up slots nor evict another device. Anything
 * else, including a cookie whose sign-in was revoked, is a new sign-in.
 */
export async function resolveSignInId(
  event: H3Event,
  identity: BuilderIdentity,
): Promise<{ sid: string; isNew: boolean }> {
  const cookie = getCookie(event, BUILDER_IDENTITY_COOKIE);
  const presented = cookie ? decodeIdentityCookie(cookie) : null;
  if (
    presented &&
    presented.uid === identity.uid &&
    presented.projectId === identity.projectId &&
    (await isSignInLive(
      builderOwnerEmail(identity.projectId, identity.uid),
      presented.sid,
    ))
  ) {
    return { sid: presented.sid, isNew: false };
  }
  return { sid: randomUUID(), isNew: true };
}

export async function rememberDelegatedCredential(
  identity: BuilderIdentity,
  token: string,
  sid: string,
  options: { isNew?: boolean } = {},
): Promise<void> {
  const exp = decodeJwt(token).exp;
  const owner = builderOwnerEmail(identity.projectId, identity.uid);
  const entry: DelegatedCredential = {
    token,
    uid: identity.uid,
    spaceId: identity.spaceId,
    expiresAtMs: typeof exp === "number" ? exp * 1000 : Date.now() + 5 * 60_000,
  };
  // The token is the user's newest; last writer wins, which is what we want.
  await writeAppSecret({
    ...credentialRef(owner),
    value: JSON.stringify(entry),
    description: "Builder sign-in for Design (renewed hourly)",
  });
  // A renewal never rewrites its sign-in row, so a renewal racing a sign-out
  // cannot bring a revoked sign-in back.
  if (options.isNew === false) return;
  await writeAppSecret({
    ...signInRef(owner, sid),
    value: JSON.stringify({ expiresAtMs: Date.now() + SIGN_IN_LIFETIME_MS }),
    description: "A Builder sign-in to Design",
  });
  // Housekeeping only: failing to prune must not fail a sign-in.
  await pruneSignIns(owner).catch((error) =>
    console.warn("[builder-identity] could not prune old sign-ins:", error),
  );
}

async function pruneSignIns(owner: string): Promise<void> {
  const rows = await listSignIns(owner);
  const cutoff = Date.now() - SIGN_IN_LIFETIME_MS;
  const stale = rows.filter(
    (row, index) => row.createdAt < cutoff || index >= MAX_SIGN_IN_ROWS,
  );
  for (const row of stale) {
    await deleteAppSecret({ key: row.key, scope: "user", scopeId: owner });
  }
}

/**
 * The stored credential, or null when there is none or it has expired. Read
 * from the shared store on every call (the secrets layer already dedupes
 * within a request), so a sign-out on one instance is seen by all of them.
 */
async function readDelegatedCredential(
  owner: string,
): Promise<DelegatedCredential | null> {
  const entry = await readStoredCredential(owner);
  return entry && entry.expiresAtMs >= Date.now() ? entry : null;
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
  registerDelegatedBuilderCredentials(async (email) => {
    // Not a Builder user: ordinary stored credentials apply.
    if (!isBuilderOwnerEmail(email)) return null;
    // A store outage throws, and core reports it as a failed lookup rather
    // than as a user with no credential.
    const entry = await readDelegatedCredential(email);
    // A Builder user without a usable credential must sign in again; no
    // shared credential may stand in for their own.
    if (!entry?.spaceId) return "none";
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
  let entry: DelegatedCredential | null;
  try {
    entry = await readDelegatedCredential(email);
  } catch (error) {
    // The credential store is down: unavailable, not "sign in again".
    throw new BuilderUnavailableError(error);
  }
  // No usable Builder credential (it expired, or was never exchanged) is not
  // Builder saying no.
  if (!entry?.spaceId) throw new BuilderSignInRequiredError();
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
  const owner = builderOwnerEmail(identity.projectId, identity.uid);
  // A correctly signed cookie is not enough: its sign-in must still be live,
  // or a copy taken before logout would keep working until it expired.
  if (!(await isSignInLive(owner, identity.sid))) return null;
  return {
    email: owner,
    // The Firebase project is part of the id: uids repeat across projects, and
    // caches partition on this.
    userId: `builder:${identity.projectId}:${identity.uid}`,
    // The Builder email is for display only, never an owner key.
    name: identity.name ?? identity.email,
    emailVerified: true,
  };
}

/**
 * Sign-out for a Builder session: revoke this sign-in (every copy of its
 * cookie, on every instance), then expire the browser's cookie. The user's
 * other devices stay signed in; the stored Builder credential goes only when
 * no sign-in is left to use it. Revocation comes first, so if the store fails
 * the cookie is kept and the user can retry.
 */
export async function clearBuilderIdentitySession(event: H3Event) {
  const cookie = getCookie(event, BUILDER_IDENTITY_COOKIE);
  const identity = cookie ? decodeIdentityCookie(cookie) : null;
  if (identity) {
    const owner = builderOwnerEmail(identity.projectId, identity.uid);
    await deleteAppSecret(signInRef(owner, identity.sid));
    if ((await listSignIns(owner)).length === 0) {
      await deleteAppSecret(credentialRef(owner));
    }
  }
  deleteCookie(event, BUILDER_IDENTITY_COOKIE, { path: "/" });
}
