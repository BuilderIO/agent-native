import crypto from "node:crypto";
import type { H3Event } from "h3";
import {
  getCookie,
  getHeader,
  getQuery,
  setCookie,
  setResponseHeader,
} from "h3";
import { getDbExec, intType } from "../db/client.js";
import { getWorkspaceA2ADerivedSecret } from "./derived-secret.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_SESSION_COOKIE,
  EMBED_TARGET_HEADER,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";

const TOKEN_KIND = "agent-native-embed-session";
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_TICKET_TTL_SECONDS = 5 * 60;
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");
const OPEN_ROUTE_PATH = "/_agent-native/open";
const OPEN_ROUTE_VIEW_PATHS: Record<string, string> = {
  ask: "/",
  calendar: "/",
  capture: "/search",
  knowledge: "/knowledge",
  list: "/",
  ops: "/ops",
  proposals: "/review",
  review: "/review",
  search: "/search",
  source: "/sources",
  sources: "/sources",
  settings: "/settings",
};
const EMBED_ROUTE_ALIASES: Record<string, string[]> = {
  // Dispatch's app root redirects to /overview. A ticket minted for the root
  // should survive that first-hop redirect instead of falling back to the
  // private deployment token gate.
  "/": ["/overview"],
  "/dashboard": ["/adhoc/agent-native-templates-first-party"],
  "/dashboards": ["/adhoc/agent-native-templates-first-party"],
  "/traffic": ["/adhoc/agent-native-templates-first-party"],
  "/traffic-dashboard": ["/adhoc/agent-native-templates-first-party"],
};

let _initPromise: Promise<void> | undefined;
let _devSigningKey: string | undefined;

export interface EmbedSessionTicketInput {
  ownerEmail: string;
  orgId?: string | null;
  targetPath: string;
  scope?: string | null;
  ttlSeconds?: number;
}

export interface EmbedSessionTicket {
  ticket: string;
  ticketHash: string;
  expiresAt: number;
}

export interface ConsumeEmbedSessionTicketOptions {
  expectedOrgId?: string | null;
}

export interface ConsumedEmbedSessionTicket {
  ownerEmail: string;
  orgId?: string;
  targetPath: string;
  scope?: string;
  expiresAt: number;
}

export interface EmbedSessionTokenClaims {
  kind: typeof TOKEN_KIND;
  ownerEmail: string;
  orgId?: string;
  targetPath: string;
  scope?: string;
  iat: number;
  exp: number;
}

export type VerifyEmbedSessionTokenResult =
  | { ok: true; claims: EmbedSessionTokenClaims }
  | { ok: false; reason: string };

export type ResolvedEmbedSession = {
  email: string;
  orgId?: string;
  token: string;
  targetPath: string;
  scope?: string;
};

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_native_embed_tickets (
          ticket_hash TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          target_path TEXT NOT NULL,
          scope TEXT,
          created_at ${intType()} NOT NULL,
          expires_at ${intType()} NOT NULL,
          consumed_at ${intType()}
        )
      `);
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function getSigningKey(): string {
  const secret =
    process.env.OAUTH_STATE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    getWorkspaceA2ADerivedSecret("short-lived-token");
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Embed session signing requires a server secret. Set OAUTH_STATE_SECRET, BETTER_AUTH_SECRET, or A2A_SECRET in production workspace deploys.",
    );
  }

  if (!_devSigningKey) {
    _devSigningKey = crypto.randomBytes(32).toString("hex");
  }
  return _devSigningKey;
}

function base64UrlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function signPayload(payload: string): string {
  return base64UrlEncode(
    crypto.createHmac("sha256", getSigningKey()).update(payload).digest(),
  );
}

function hashTicket(ticket: string): string {
  return crypto.createHash("sha256").update(ticket).digest("hex");
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stripConfiguredBasePath(pathname: string): string {
  const base = getConfiguredAppBasePath();
  if (!base) return pathname;
  if (pathname === base) return "/";
  if (pathname.startsWith(`${base}/`))
    return pathname.slice(base.length) || "/";
  return pathname;
}

function pathnameFromPath(path: string): string | null {
  const normalized = normalizeEmbedTargetPath(path);
  if (!normalized) return null;
  try {
    return new URL(normalized, "http://agent-native.invalid").pathname;
  } catch {
    return null;
  }
}

function safePathSegment(value: string | null | undefined): string | null {
  const segment = value?.trim();
  if (!segment || CONTROL_CHARS.test(segment)) return null;
  if (segment === "." || segment === "..") return null;
  if (
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("?")
  ) {
    return null;
  }
  if (segment.includes("#")) return null;
  return segment;
}

function addResolvedOpenRoutePath(
  targets: Set<string>,
  path: string | null | undefined,
): void {
  if (!path) return;
  const pathname = pathnameFromPath(path);
  if (pathname) targets.add(pathname);
}

function openRouteTargetPathnames(targetPath: string): Set<string> {
  const targets = new Set<string>();
  let url: URL;
  try {
    url = new URL(targetPath, "http://agent-native.invalid");
  } catch {
    return targets;
  }
  if (stripConfiguredBasePath(url.pathname) !== OPEN_ROUTE_PATH) {
    return targets;
  }

  const to = normalizeEmbedTargetPath(url.searchParams.get("to"));
  addResolvedOpenRoutePath(targets, to);

  const view = url.searchParams.get("view")?.trim();
  if (!view || CONTROL_CHARS.test(view)) return targets;
  const viewPath = view.startsWith("/") ? view : `/${view}`;
  const viewPathname = pathnameFromPath(viewPath);
  addResolvedOpenRoutePath(targets, viewPathname);
  addResolvedOpenRoutePath(targets, OPEN_ROUTE_VIEW_PATHS[view]);

  const dashboardId = safePathSegment(url.searchParams.get("dashboardId"));
  if (view === "adhoc" && dashboardId) {
    addResolvedOpenRoutePath(
      targets,
      `/adhoc/${encodeURIComponent(dashboardId)}`,
    );
  }
  const analysisId = safePathSegment(url.searchParams.get("analysisId"));
  if (view === "analyses" && analysisId) {
    addResolvedOpenRoutePath(
      targets,
      `/analyses/${encodeURIComponent(analysisId)}`,
    );
  }
  const extensionId = safePathSegment(url.searchParams.get("extensionId"));
  if (view === "extensions" && extensionId) {
    addResolvedOpenRoutePath(
      targets,
      `/extensions/${encodeURIComponent(extensionId)}`,
    );
  }
  const designId = safePathSegment(url.searchParams.get("designId"));
  if (designId) {
    addResolvedOpenRoutePath(
      targets,
      view === "present"
        ? `/present/${encodeURIComponent(designId)}`
        : `/design/${encodeURIComponent(designId)}`,
    );
  }
  const documentId = safePathSegment(url.searchParams.get("documentId"));
  if (documentId) {
    addResolvedOpenRoutePath(
      targets,
      `/page/${encodeURIComponent(documentId)}`,
    );
  }
  const deckId = safePathSegment(url.searchParams.get("deckId"));
  if (deckId) {
    addResolvedOpenRoutePath(
      targets,
      view === "present"
        ? `/deck/${encodeURIComponent(deckId)}/present`
        : `/deck/${encodeURIComponent(deckId)}`,
    );
  }
  if (
    safePathSegment(url.searchParams.get("captureId")) ||
    safePathSegment(url.searchParams.get("knowledgeId")) ||
    safePathSegment(url.searchParams.get("sourceId"))
  ) {
    addResolvedOpenRoutePath(targets, OPEN_ROUTE_VIEW_PATHS[view]);
  }
  if (
    view === "calendar" &&
    (safePathSegment(url.searchParams.get("eventId")) ||
      safePathSegment(url.searchParams.get("eventDraftId")))
  ) {
    addResolvedOpenRoutePath(targets, "/");
  }
  const threadId = safePathSegment(url.searchParams.get("threadId"));
  if (viewPathname && threadId) {
    addResolvedOpenRoutePath(
      targets,
      `${viewPathname}/${encodeURIComponent(threadId)}`,
    );
  }

  return targets;
}

function allowedEmbedTargetPathnames(targetPath: string): Set<string> {
  const allowed = new Set<string>();
  const direct = pathnameFromPath(targetPath);
  if (direct) {
    allowed.add(direct);
    for (const aliasTarget of EMBED_ROUTE_ALIASES[direct] ?? []) {
      allowed.add(aliasTarget);
    }
  }
  for (const openTarget of openRouteTargetPathnames(targetPath)) {
    allowed.add(openTarget);
  }
  return allowed;
}

function requestUrlFromEvent(event: H3Event): string {
  const mountedPathname = (event as any).context?._mountedPathname;
  if (typeof mountedPathname === "string" && mountedPathname) {
    return `${mountedPathname}${(event as any).url?.search ?? ""}`;
  }
  return (
    (event as any).node?.req?.url ??
    ((event as any).req?.url as string | undefined) ??
    ((event as any).request?.url as string | undefined) ??
    (event as any).path ??
    (event as any).url?.toString?.() ??
    "/"
  );
}

function requestPathname(event: H3Event): string | null {
  const raw = requestUrlFromEvent(event);
  try {
    const pathname = new URL(raw, "http://agent-native.invalid").pathname;
    return stripConfiguredBasePath(pathname);
  } catch {
    return null;
  }
}

function headerTargetPathname(event: H3Event): string | null {
  const direct =
    (event as any).request?.headers?.get?.(EMBED_TARGET_HEADER) ??
    (event as any).headers?.get?.(EMBED_TARGET_HEADER) ??
    (event as any).node?.req?.headers?.[EMBED_TARGET_HEADER] ??
    (event as any).node?.req?.headers?.[EMBED_TARGET_HEADER.toLowerCase()];
  if (typeof direct === "string") return pathnameFromPath(direct);
  try {
    const raw = getHeader(event, EMBED_TARGET_HEADER);
    return typeof raw === "string" ? pathnameFromPath(raw) : null;
  } catch {
    return null;
  }
}

function requestHost(event: H3Event): string | null {
  const direct =
    (event as any).request?.headers?.get?.("host") ??
    (event as any).headers?.get?.("host") ??
    (event as any).node?.req?.headers?.host;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  try {
    return getHeader(event, "host") ?? null;
  } catch {
    return null;
  }
}

function referrerTargetPathname(event: H3Event): string | null {
  let raw: string | null =
    (event as any).request?.headers?.get?.("referer") ??
    (event as any).request?.headers?.get?.("referrer") ??
    (event as any).headers?.get?.("referer") ??
    (event as any).headers?.get?.("referrer") ??
    (event as any).node?.req?.headers?.referer ??
    (event as any).node?.req?.headers?.referrer ??
    null;
  try {
    raw =
      raw ??
      getHeader(event, "referer") ??
      getHeader(event, "referrer") ??
      null;
  } catch {
    raw = raw ?? null;
  }
  if (!raw) return null;
  try {
    const referrer = new URL(raw);
    const host = requestHost(event);
    if (host && referrer.host !== host) return null;
    return pathnameFromPath(`${referrer.pathname}${referrer.search}`);
  } catch {
    return pathnameFromPath(raw);
  }
}

export function requestMatchesEmbedTarget(
  event: H3Event,
  targetPath: string,
): boolean {
  const allowed = allowedEmbedTargetPathnames(targetPath);
  if (allowed.size === 0) return false;

  const current = requestPathname(event);
  if (current && allowed.has(current)) return true;

  const headerTarget = headerTargetPathname(event);
  if (headerTarget && allowed.has(headerTarget)) return true;

  const referrerTarget = referrerTargetPathname(event);
  return !!referrerTarget && allowed.has(referrerTarget);
}

function isEmbedRuntimeRequest(event: H3Event): boolean {
  const pathname = requestPathname(event);
  return (
    !!pathname &&
    (pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/@") ||
      pathname.startsWith("/app/") ||
      pathname.startsWith("/node_modules/") ||
      pathname.startsWith("/packages/") ||
      pathname === "/_agent-native" ||
      pathname.startsWith("/_agent-native/"))
  );
}

export function normalizeEmbedTargetPath(
  raw: string | undefined | null,
  requestOrigin?: string,
): string | null {
  const value = String(raw ?? "").trim();
  if (!value || CONTROL_CHARS.test(value)) return null;

  let path = value;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      const parsed = new URL(value);
      if (requestOrigin) {
        const expected = new URL(requestOrigin);
        if (parsed.origin !== expected.origin) return null;
      }
      const base = getConfiguredAppBasePath();
      if (
        base &&
        parsed.pathname !== base &&
        !parsed.pathname.startsWith(`${base}/`)
      ) {
        return null;
      }
      path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return null;
  }

  if (!path.startsWith("/")) path = `/${path}`;
  if (path.startsWith("//") || path.startsWith("/\\")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return stripConfiguredBasePath(path);
}

export async function createEmbedSessionTicket(
  input: EmbedSessionTicketInput,
): Promise<EmbedSessionTicket> {
  const ownerEmail = input.ownerEmail.trim();
  if (!ownerEmail) throw new Error("Embed session ticket requires ownerEmail.");
  const targetPath = normalizeEmbedTargetPath(input.targetPath);
  if (!targetPath)
    throw new Error("Embed session ticket requires a safe path.");

  await ensureTable();
  const ticket = crypto.randomBytes(32).toString("base64url");
  const ticketHash = hashTicket(ticket);
  const now = Date.now();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TICKET_TTL_SECONDS;
  const expiresAt = now + Math.max(1, ttlSeconds) * 1000;
  await getDbExec().execute({
    sql:
      "INSERT INTO agent_native_embed_tickets " +
      "(ticket_hash, owner_email, org_id, target_path, scope, created_at, expires_at, consumed_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      ticketHash,
      ownerEmail,
      input.orgId ?? null,
      targetPath,
      input.scope ?? null,
      now,
      expiresAt,
      null,
    ],
  });
  return { ticket, ticketHash, expiresAt };
}

export async function consumeEmbedSessionTicket(
  ticket: string | undefined | null,
  options: ConsumeEmbedSessionTicketOptions = {},
): Promise<ConsumedEmbedSessionTicket | null> {
  if (!ticket) return null;
  await ensureTable();
  const ticketHash = hashTicket(ticket);
  const now = Date.now();
  const { rows } = await getDbExec().execute({
    sql:
      "SELECT ticket_hash, owner_email, org_id, target_path, scope, expires_at, consumed_at " +
      "FROM agent_native_embed_tickets WHERE ticket_hash = ?",
    args: [ticketHash],
  });
  if (rows.length === 0) return null;
  const row: any = rows[0];
  const expiresAt = numberOrNull(row.expires_at ?? row.expiresAt);
  const consumedAt = numberOrNull(row.consumed_at ?? row.consumedAt);
  const orgId = stringOrUndefined(row.org_id ?? row.orgId);
  if (consumedAt != null) return null;
  if (expiresAt != null && expiresAt < now) return null;
  if (options.expectedOrgId && orgId && orgId !== options.expectedOrgId) {
    return null;
  }

  const result = await getDbExec().execute({
    sql:
      "UPDATE agent_native_embed_tickets SET consumed_at = ? " +
      "WHERE ticket_hash = ? AND consumed_at IS NULL",
    args: [now, ticketHash],
  });
  if (result.rowsAffected === 0) return null;

  const targetPath = normalizeEmbedTargetPath(
    stringOrUndefined(row.target_path ?? row.targetPath),
  );
  const ownerEmail = stringOrUndefined(row.owner_email ?? row.ownerEmail);
  if (!targetPath || !ownerEmail || expiresAt == null) return null;

  return {
    ownerEmail,
    ...(orgId ? { orgId } : {}),
    targetPath,
    ...(stringOrUndefined(row.scope)
      ? { scope: stringOrUndefined(row.scope) }
      : {}),
    expiresAt,
  };
}

export function signEmbedSessionToken(input: {
  ownerEmail: string;
  orgId?: string | null;
  targetPath: string;
  scope?: string | null;
  ttlSeconds?: number;
}): string {
  const targetPath = normalizeEmbedTargetPath(input.targetPath) ?? "/";
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(1, input.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS);
  const claims: EmbedSessionTokenClaims = {
    kind: TOKEN_KIND,
    ownerEmail: input.ownerEmail,
    targetPath,
    iat: now,
    exp: now + ttl,
  };
  if (input.orgId) claims.orgId = input.orgId;
  if (input.scope) claims.scope = input.scope;
  const payload = base64UrlEncode(JSON.stringify(claims));
  return `${payload}.${signPayload(payload)}`;
}

export function verifyEmbedSessionToken(
  token: string | undefined | null,
): VerifyEmbedSessionTokenResult {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing" };
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "shape" };
  }
  const [payload, signature] = parts;
  const expected = signPayload(payload);
  const sig = Buffer.from(signature);
  const exp = Buffer.from(expected);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) {
    return { ok: false, reason: "signature" };
  }

  let claims: EmbedSessionTokenClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payload).toString("utf8"));
  } catch {
    return { ok: false, reason: "payload" };
  }

  if (
    !claims ||
    claims.kind !== TOKEN_KIND ||
    typeof claims.ownerEmail !== "string" ||
    !claims.ownerEmail ||
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp)
  ) {
    return { ok: false, reason: "claims" };
  }
  if (claims.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  claims.targetPath = normalizeEmbedTargetPath(claims.targetPath) ?? "/";
  return { ok: true, claims };
}

function isHttpsRequest(event: H3Event): boolean {
  try {
    const xfProto = getHeader(event, "x-forwarded-proto");
    if (xfProto && String(xfProto).split(",")[0].trim() === "https") {
      return true;
    }
    const url = event.url?.toString?.() ?? "";
    if (url.startsWith("https://")) return true;
    const appUrl = process.env.APP_URL || process.env.BETTER_AUTH_URL || "";
    if (appUrl.startsWith("https://")) return true;
  } catch {
    // ignore
  }
  return false;
}

function cookieDomainAttrs(): { domain?: string } {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return domain ? { domain } : {};
}

function crossSiteCookieAttrs(event: H3Event): {
  sameSite: "lax" | "none";
  secure: boolean;
  partitioned?: boolean;
} {
  return isHttpsRequest(event)
    ? { sameSite: "none", secure: true, partitioned: true }
    : { sameSite: "lax", secure: false };
}

export function setEmbedSessionCookie(event: H3Event, token: string): void {
  setCookie(event, EMBED_SESSION_COOKIE, token, {
    httpOnly: true,
    ...crossSiteCookieAttrs(event),
    ...cookieDomainAttrs(),
    path: "/",
    maxAge: DEFAULT_TOKEN_TTL_SECONDS,
  });
}

function bearerToken(event: H3Event): string | undefined {
  const auth = getHeader(event, "authorization");
  if (!auth) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(String(auth).trim());
  return match?.[1]?.trim();
}

function queryToken(event: H3Event): string | undefined {
  const raw = getQuery(event)?.[EMBED_TOKEN_QUERY_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value) return value;
  try {
    return (
      new URL(
        requestUrlFromEvent(event),
        "http://agent-native.invalid",
      ).searchParams.get(EMBED_TOKEN_QUERY_PARAM) ?? undefined
    );
  } catch {
    return undefined;
  }
}

export async function resolveEmbedSessionFromRequest(
  event: H3Event,
): Promise<ResolvedEmbedSession | null> {
  const candidates = [
    { token: queryToken(event), source: "query" },
    { token: bearerToken(event), source: "bearer" },
    { token: getCookie(event, EMBED_SESSION_COOKIE), source: "cookie" },
  ];
  for (const candidate of candidates) {
    const verified = verifyEmbedSessionToken(candidate.token);
    if (!verified.ok) continue;
    const matchesTarget = requestMatchesEmbedTarget(
      event,
      verified.claims.targetPath,
    );
    const isRuntimeRequest = isEmbedRuntimeRequest(event);
    const isRuntimeCookieRequest =
      candidate.source === "cookie" && isRuntimeRequest;
    const isRuntimeQueryRequest =
      candidate.source === "query" && isRuntimeRequest;
    if (!matchesTarget && !isRuntimeCookieRequest && !isRuntimeQueryRequest) {
      continue;
    }
    if (candidate.source === "query" && candidate.token) {
      try {
        setEmbedSessionCookie(event, candidate.token);
        setResponseHeader(event, "Referrer-Policy", "no-referrer");
      } catch {
        // Some tests and edge runtimes expose read-only request shims. The
        // query token itself is still valid for this request.
      }
    }
    return {
      email: verified.claims.ownerEmail,
      token: candidate.token!,
      targetPath: verified.claims.targetPath,
      ...(verified.claims.orgId ? { orgId: verified.claims.orgId } : {}),
      ...(verified.claims.scope ? { scope: verified.claims.scope } : {}),
    };
  }
  return null;
}

export function requestHasEmbedAuthMarker(event: H3Event): boolean {
  try {
    const q = getQuery(event) ?? {};
    const queryToken = Array.isArray(q[EMBED_TOKEN_QUERY_PARAM])
      ? q[EMBED_TOKEN_QUERY_PARAM][0]
      : q[EMBED_TOKEN_QUERY_PARAM];
    const cookieToken = getCookie(event, EMBED_SESSION_COOKIE);
    const candidates = [
      { token: queryToken, allowRuntime: true },
      { token: bearerToken(event), allowRuntime: false },
      { token: cookieToken, allowRuntime: true },
    ];
    const runtimeRequest = isEmbedRuntimeRequest(event);
    for (const candidate of candidates) {
      const verified = verifyEmbedSessionToken(candidate.token);
      if (
        verified.ok &&
        (requestMatchesEmbedTarget(event, verified.claims.targetPath) ||
          (candidate.allowRuntime && runtimeRequest))
      ) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export function isEmbedModeRequest(event: H3Event): boolean {
  try {
    const q = getQuery(event) ?? {};
    return (
      q[EMBED_MODE_QUERY_PARAM] === "1" || q[EMBED_MODE_QUERY_PARAM] === "true"
    );
  } catch {
    return false;
  }
}
