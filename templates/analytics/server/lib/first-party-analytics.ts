import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull, lt, or } from "drizzle-orm";

import { FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS } from "../../shared/dashboard-report-timeouts.js";
import { getDb, schema } from "../db/index.js";
import {
  EXCEPTION_EVENT_NAME,
  ingestAnalyticsExceptionEvents,
  type DerivedExceptionFields,
} from "./error-capture.js";
import {
  getFirstPartyAnalyticsBackend,
  getFirstPartyAnalyticsTable,
  insertFirstPartyAnalyticsRows,
  queryFirstPartyAnalyticsInBigQuery,
} from "./first-party-analytics-backend.js";
import {
  firstPartyCacheKey,
  withFirstPartyCache,
} from "./first-party-analytics-cache.js";
import {
  classifyFirstPartyAnalyticsQuery,
  queryOutcomeFromError,
  recordFirstPartyAnalyticsQueryPressure,
} from "./first-party-analytics-health.js";
import { upsertFirstPartyAnalyticsRollups } from "./first-party-analytics-rollups.js";
import { reserveFirstPartyPostgresEventVolume } from "./first-party-analytics-volume.js";

export interface AnalyticsScope {
  userEmail: string;
  orgId: string | null;
}

export interface IncomingAnalyticsEvent {
  event: string;
  properties?: Record<string, unknown>;
  context?: Record<string, unknown>;
  userId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  timestamp?: string | number | Date | null;
}

export interface AnalyticsQueryResult {
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
}

export interface AnalyticsQueryOptions {
  /** Cache only callers with a stable dashboard-panel lifecycle. */
  cache?: boolean;
  /** Bound the database work for callers with a smaller delivery deadline. */
  timeoutMs?: number;
}

const MAX_EVENTS_PER_REQUEST = 100;
const MAX_QUERY_ROWS = 5_000;
const FIRST_PARTY_QUERY_TABLE_NAMES = [
  "analytics_events",
  "analytics_event_daily_rollups",
  "analytics_user_days",
  "session_recordings",
] as const;
const FIRST_PARTY_QUERY_TABLES = new Set<string>(FIRST_PARTY_QUERY_TABLE_NAMES);
const FIRST_PARTY_ROLLUP_TABLES = new Set([
  "analytics_event_daily_rollups",
  "analytics_user_days",
]);
const FIRST_PARTY_QUERY_TABLE_PATTERN = FIRST_PARTY_QUERY_TABLE_NAMES.join("|");
const FIRST_PARTY_QUERY_TABLE_LIST = FIRST_PARTY_QUERY_TABLE_NAMES.join(", ");
const RESERVED_ALIAS_WORDS = new Set([
  "where",
  "on",
  "group",
  "order",
  "limit",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "cross",
  "full",
  "having",
  "union",
]);

function nowIso(): string {
  return new Date().toISOString();
}

function todayIsoDate(): string {
  return nowIso().slice(0, 10);
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random generation is unavailable");
  }
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function id(prefix: string): string {
  return `${prefix}_${randomHex(12)}`;
}

export function generateAnalyticsPublicKey(): string {
  return `anpk_${randomHex(24)}`;
}

export async function createAnalyticsPublicKey(
  scope: AnalyticsScope,
  name: string,
): Promise<Record<string, unknown>> {
  const db = getDb() as any;
  const publicKey = generateAnalyticsPublicKey();
  const createdAt = nowIso();
  const row = {
    id: id("apk"),
    name: name.trim() || "Default key",
    publicKey,
    publicKeyPrefix: publicKey.slice(0, 13),
    replayAllowedOrigins: "[]",
    replayMaxBytesPerDay: 100 * 1024 * 1024,
    replayMaxRequestsPerMinute: 120,
    createdAt,
    ownerEmail: scope.userEmail,
    orgId: scope.orgId,
  };
  await db.insert(schema.analyticsPublicKeys).values(row);
  return {
    id: row.id,
    name: row.name,
    publicKey,
    publicKeyPrefix: row.publicKeyPrefix,
    replayAllowedOrigins: [],
    replayMaxBytesPerDay: row.replayMaxBytesPerDay,
    replayMaxRequestsPerMinute: row.replayMaxRequestsPerMinute,
    createdAt,
    orgId: row.orgId,
    revokedAt: null,
    lastUsedAt: null,
  };
}

export async function listAnalyticsPublicKeys(
  scope: AnalyticsScope,
): Promise<Record<string, unknown>[]> {
  const db = getDb() as any;
  const where = scope.orgId
    ? or(
        eq(schema.analyticsPublicKeys.orgId, scope.orgId),
        and(
          eq(schema.analyticsPublicKeys.ownerEmail, scope.userEmail),
          isNull(schema.analyticsPublicKeys.orgId),
        ),
      )
    : and(
        eq(schema.analyticsPublicKeys.ownerEmail, scope.userEmail),
        isNull(schema.analyticsPublicKeys.orgId),
      );
  const rows = await db
    .select()
    .from(schema.analyticsPublicKeys)
    .where(where)
    .orderBy(schema.analyticsPublicKeys.createdAt);

  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    publicKeyPrefix: row.publicKeyPrefix,
    replayAllowedOrigins: parseReplayAllowedOrigins(row.replayAllowedOrigins),
    replayMaxBytesPerDay: row.replayMaxBytesPerDay ?? 100 * 1024 * 1024,
    replayMaxRequestsPerMinute: row.replayMaxRequestsPerMinute ?? 120,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    orgId: row.orgId ?? null,
  }));
}

/** How stale the last-used stamp must be before a request pays to refresh it. */
const LAST_USED_AT_REFRESH_MS = 60_000;

/**
 * Refresh a public key's last-used stamp without serializing ingest behind it.
 *
 * This UPDATE used to sit inside the ingest transaction, so every concurrent
 * request for one public key took an exclusive row lock on that key's row and
 * held it until the transaction committed — which meant through the rollup
 * upsert. Production stacked 36 writers on three hot rows waiting 38-57s each;
 * that exhausted the connection pool, and the whole app stopped loading while
 * Postgres reported "no server connection available, client being queued". The
 * stamp is bookkeeping: it needs neither atomicity with the events nor
 * second-precision, and losing one is harmless.
 *
 * The staleness predicate throttles in SQL rather than in the caller, because
 * Postgres only locks rows an UPDATE actually matches — a request whose key was
 * stamped seconds ago matches nothing and takes no lock at all. Doing the same
 * check in JS would reintroduce the convoy, since every racing request would
 * still issue its own unconditional write.
 *
 * `last_used_at` is TEXT holding ISO-8601 UTC (always `Z`-suffixed), so `lt` is
 * a lexicographic comparison that happens to be chronological. Storing a local
 * or offset-bearing timestamp here would silently break this ordering.
 */
export async function touchPublicKeyLastUsedAt(
  keyId: string,
  receivedAt: string,
): Promise<void> {
  const parsed = Date.parse(receivedAt);
  if (!Number.isFinite(parsed)) {
    console.warn(
      "[first-party-analytics] Skipping last-used stamp: unparseable receivedAt",
      receivedAt,
    );
    return;
  }
  const staleBefore = new Date(parsed - LAST_USED_AT_REFRESH_MS).toISOString();
  try {
    const db = await getDb();
    await db
      .update(schema.analyticsPublicKeys)
      .set({ lastUsedAt: receivedAt })
      .where(
        and(
          eq(schema.analyticsPublicKeys.id, keyId),
          or(
            isNull(schema.analyticsPublicKeys.lastUsedAt),
            lt(schema.analyticsPublicKeys.lastUsedAt, staleBefore),
          ),
        ),
      );
  } catch (error) {
    // Best-effort by design: a failed stamp must not reject an ingest whose
    // events already committed. Loud enough to see if it starts failing always.
    console.warn(
      "[first-party-analytics] Failed to refresh key last-used stamp:",
      error,
    );
  }
}

function parseReplayAllowedOrigins(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export async function revokeAnalyticsPublicKey(
  scope: AnalyticsScope,
  keyId: string,
): Promise<{ id: string; revokedAt: string }> {
  const db = getDb() as any;
  const where = scope.orgId
    ? and(
        eq(schema.analyticsPublicKeys.id, keyId),
        or(
          eq(schema.analyticsPublicKeys.orgId, scope.orgId),
          and(
            eq(schema.analyticsPublicKeys.ownerEmail, scope.userEmail),
            isNull(schema.analyticsPublicKeys.orgId),
          ),
        ),
      )
    : and(
        eq(schema.analyticsPublicKeys.id, keyId),
        eq(schema.analyticsPublicKeys.ownerEmail, scope.userEmail),
        isNull(schema.analyticsPublicKeys.orgId),
      );
  const revokedAt = nowIso();
  const updated = await db
    .update(schema.analyticsPublicKeys)
    .set({ revokedAt })
    .where(where)
    .returning();
  if (!updated.length) {
    throw new Error("Analytics public key not found");
  }
  return { id: keyId, revokedAt };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function normalizeAnalyticsTimestamp(
  value: unknown,
  receivedAt = nowIso(),
): string {
  const fallback = (() => {
    const date = new Date(receivedAt);
    return Number.isNaN(date.getTime()) ? nowIso() : date.toISOString();
  })();
  const fallbackTime = new Date(fallback).getTime();
  const normalize = (date: Date) => {
    if (Number.isNaN(date.getTime())) return fallback;
    return date.getTime() > fallbackTime ? fallback : date.toISOString();
  };

  if (value instanceof Date) return normalize(value);
  if (typeof value === "number") {
    const d = new Date(value);
    return normalize(d);
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    return normalize(d);
  }
  return fallback;
}

function eventDateFromTimestamp(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function urlParts(url: string | null): {
  url: string | null;
  path: string | null;
  hostname: string | null;
} {
  if (!url) return { url: null, path: null, hostname: null };
  try {
    const parsed = new URL(url, "https://placeholder.agent-native.local");
    const relative = !/^https?:\/\//i.test(url);
    return {
      url: relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url,
      path: parsed.pathname,
      hostname: relative ? null : parsed.hostname,
    };
  } catch {
    return { url, path: null, hostname: null };
  }
}

export function resolveAnalyticsEventDimensions({
  properties,
  context,
  hostname,
}: {
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
  hostname: string | null;
}): { app: string | null; template: string | null } {
  const app =
    asString(properties.app) ||
    asString((properties as any).agent_native_app) ||
    asString((properties as any).agentNativeApp) ||
    asString((context as any).app) ||
    asString((context as any).agent_native_app) ||
    asString((context as any).agentNativeApp) ||
    (hostname ? hostname.split(".")[0] : null);
  const template =
    asString(properties.template) ||
    asString((properties as any).templateId) ||
    asString((properties as any).agent_native_template) ||
    asString((properties as any).agentNativeTemplate) ||
    asString((context as any).template) ||
    asString((context as any).templateId) ||
    asString((context as any).agent_native_template) ||
    asString((context as any).agentNativeTemplate) ||
    app;
  return { app, template };
}

/**
 * The public marketing site does not have a product sign-in surface. It shares
 * the browser analytics write key, though, so its host-derived `www` dimension
 * must never enter signed-in product cohorts when a client sends session
 * telemetry.
 */
export function isMarketingWebsiteSessionEvent({
  eventName,
  hostname,
  app,
  template,
}: {
  eventName: string;
  hostname: string | null;
  app: string | null;
  template: string | null;
}): boolean {
  if (eventName !== "session status") return false;
  const normalizedHostname = hostname?.trim().toLowerCase().replace(/\.$/, "");
  if (
    normalizedHostname === "agent-native.com" ||
    normalizedHostname === "www.agent-native.com"
  ) {
    return true;
  }
  // Some older browser events do not include a URL/hostname. Their only
  // available attribution is the host-derived app/template dimension.
  const normalizedApp = app?.trim().toLowerCase();
  const normalizedTemplate = template?.trim().toLowerCase();
  return (
    !normalizedHostname &&
    (normalizedApp === "www" || normalizedTemplate === "www")
  );
}

export function parseAnalyticsTrackPayload(raw: unknown): {
  publicKey: string;
  events: IncomingAnalyticsEvent[];
} {
  const body =
    typeof raw === "string" && raw.trim() ? JSON.parse(raw) : asRecord(raw);
  const publicKey =
    asString((body as any).publicKey) ||
    asString((body as any).writeKey) ||
    asString((body as any).apiKey);
  if (!publicKey) {
    throw new Error("Missing publicKey");
  }

  const rawEvents = Array.isArray((body as any).events)
    ? (body as any).events
    : [body];
  if (rawEvents.length === 0) {
    throw new Error("No events provided");
  }
  if (rawEvents.length > MAX_EVENTS_PER_REQUEST) {
    throw new Error(`At most ${MAX_EVENTS_PER_REQUEST} events are accepted`);
  }

  const events = rawEvents.map((rawEvent: unknown) => {
    const obj = asRecord(rawEvent);
    const eventName =
      asString((obj as any).event) || asString((obj as any).name);
    if (!eventName) throw new Error("Each event requires an event name");
    return {
      event: eventName,
      properties: asRecord((obj as any).properties),
      context: asRecord((obj as any).context),
      userId: asString((obj as any).userId),
      anonymousId: asString((obj as any).anonymousId),
      sessionId: asString((obj as any).sessionId),
      timestamp: (obj as any).timestamp,
    };
  });

  return { publicKey, events };
}

export async function recordAnalyticsEvents(
  publicKey: string,
  events: IncomingAnalyticsEvent[],
): Promise<{ accepted: number; keyId: string }> {
  const db = getDb() as any;
  // guard:allow-unscoped -- public ingestion must resolve the owning tenant from the submitted write key before it can scope inserts.
  const [key] = await db
    .select()
    .from(schema.analyticsPublicKeys)
    .where(
      and(
        eq(schema.analyticsPublicKeys.publicKey, publicKey),
        isNull(schema.analyticsPublicKeys.revokedAt),
      ),
    )
    .limit(1);
  if (!key) {
    throw new Error("Invalid analytics public key");
  }

  const receivedAt = nowIso();
  const exceptionSources: Array<{
    properties: Record<string, unknown>;
    derived: DerivedExceptionFields;
  }> = [];
  const rows = events.map((event) => {
    const properties = event.properties ?? {};
    const context = event.context ?? {};
    const url =
      asString(properties.url) ||
      asString((context as any).url) ||
      asString((properties as any).href);
    const parts = urlParts(url);
    const hostname =
      parts.hostname ||
      asString(properties.hostname) ||
      asString((context as any).hostname);
    const { app, template } = resolveAnalyticsEventDimensions({
      properties,
      context,
      hostname,
    });
    const reportedSignedIn =
      asString((properties as any).signed_in) ||
      asString((properties as any).signedIn) ||
      asString((context as any).signed_in) ||
      asString((context as any).signedIn);
    const userId = event.userId ?? asString((properties as any).userId);
    const anonymousId =
      event.anonymousId ??
      asString((properties as any).anonymousId) ??
      asString((properties as any).distinctId);
    const userKey = userId || anonymousId;
    const timestamp = normalizeAnalyticsTimestamp(event.timestamp, receivedAt);
    const sessionId =
      event.sessionId ?? asString((properties as any).sessionId);
    const signedIn = isMarketingWebsiteSessionEvent({
      eventName: event.event,
      hostname,
      app,
      template,
    })
      ? "false"
      : reportedSignedIn;

    if (event.event === EXCEPTION_EVENT_NAME) {
      exceptionSources.push({
        properties,
        derived: {
          app,
          template,
          url: parts.url,
          userId,
          anonymousId,
          userKey,
          sessionId,
          timestamp,
        },
      });
    }

    return {
      id: id("evt"),
      publicKeyId: key.id,
      eventName: event.event,
      userId,
      anonymousId,
      userKey,
      sessionId,
      timestamp,
      eventDate: eventDateFromTimestamp(timestamp),
      receivedAt,
      url: parts.url,
      path: parts.path ?? asString(properties.path),
      hostname,
      referrer:
        asString(properties.referrer) || asString((context as any).referrer),
      app,
      template,
      signedIn,
      properties: JSON.stringify(properties),
      context: JSON.stringify(context),
      ownerEmail: key.ownerEmail,
      orgId: key.orgId ?? null,
    };
  });

  const backend = await getFirstPartyAnalyticsBackend({
    userEmail: key.ownerEmail,
    orgId: key.orgId ?? null,
  });

  let bigQueryInsertError: unknown = null;
  if (rows.length && (backend.sink === "dual" || backend.sink === "bigquery")) {
    try {
      await runWithRequestContext(
        {
          userEmail: key.ownerEmail,
          orgId: key.orgId ?? undefined,
        },
        () => insertFirstPartyAnalyticsRows(rows, backend.table),
      );
    } catch (error) {
      if (backend.sink === "bigquery") {
        // Keep SQL-only exception issues, public-key metadata, and session
        // replay links durable even when the warehouse is temporarily down.
        // The request still fails below so callers do not mistake a warehouse
        // outage for a successful BigQuery write.
        bigQueryInsertError = error;
      }
      // Dual-write mode keeps Postgres as the recoverable source until the
      // backfill has completed. A BigQuery outage must not lose live events.
      if (backend.sink === "dual") {
        console.error(
          "[first-party-analytics] BigQuery dual-write failed; retaining Postgres event:",
          error,
        );
      }
    }
  }

  let postgresInsertError: unknown = null;
  if (rows.length && backend.sink !== "bigquery") {
    try {
      await db.transaction(async (tx: any) => {
        if (backend.sink === "postgres") {
          await reserveFirstPartyPostgresEventVolume(
            tx,
            {
              ownerEmail: key.ownerEmail,
              orgId: key.orgId ?? null,
              receivedAt,
            },
            rows.length,
          );
        }
        await tx.insert(schema.analyticsEvents).values(rows);
        await upsertFirstPartyAnalyticsRollups(rows, tx);
      });
    } catch (error) {
      // Preserve SQL-only exception issues and public-key metadata below even
      // when a Postgres volume reservation or insert rejects the batch.
      postgresInsertError = error;
    }
  }
  if (rows.length) {
    await touchPublicKeyLastUsedAt(key.id, receivedAt);
  }

  // Fork captured exceptions into the dedicated error-capture tables. This is
  // best-effort: a malformed `$exception` payload must never reject the whole
  // analytics ingest (the event is still recorded in analytics_events above,
  // which keeps alerting working).
  if (exceptionSources.length) {
    try {
      await ingestAnalyticsExceptionEvents(
        {
          ownerEmail: key.ownerEmail,
          orgId: key.orgId ?? null,
          publicKeyId: key.id,
        },
        exceptionSources,
      );
    } catch (error) {
      console.warn("[first-party-analytics] Exception ingest failed:", error);
    }
  }

  if (bigQueryInsertError) throw bigQueryInsertError;
  if (postgresInsertError) throw postgresInsertError;

  return { accepted: rows.length, keyId: key.id };
}

function stripSqlLiterals(sql: string): string {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inSingle && !inDouble && ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (!inSingle && !inDouble && ch === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (!inDouble && ch === "'") {
      out += " ";
      if (inSingle && next === "'") {
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (!inSingle && ch === '"') {
      out += " ";
      inDouble = !inDouble;
      i++;
      continue;
    }
    out += inSingle || inDouble ? " " : ch;
    i++;
  }
  return out;
}

interface AnalyticsSqlToken {
  value: string;
  quoted: boolean;
  depth: number;
}

interface AnalyticsSqlSource {
  ref: string;
  quoted: boolean;
  commaSeparated: boolean;
}

const SQL_SOURCE_CLAUSE_ENDS = new Set([
  "where",
  "group",
  "order",
  "limit",
  "having",
  "union",
  "except",
  "intersect",
  "window",
  "qualify",
  "returning",
]);

function tokenizeAnalyticsSql(sql: string): AnalyticsSqlToken[] {
  const tokens: AnalyticsSqlToken[] = [];
  let depth = 0;

  for (let i = 0; i < sql.length; ) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "[") {
      const closing = ch === "[" ? "]" : ch;
      let value = "";
      i++;
      while (i < sql.length) {
        if (sql[i] === closing && sql[i + 1] === closing) {
          value += closing;
          i += 2;
          continue;
        }
        if (sql[i] === closing) {
          i++;
          break;
        }
        value += sql[i++];
      }
      tokens.push({ value, quoted: true, depth });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      tokens.push({ value: sql.slice(start, i), quoted: false, depth });
      continue;
    }
    if (ch === "(") {
      tokens.push({ value: ch, quoted: false, depth });
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      tokens.push({ value: ch, quoted: false, depth });
      i++;
      continue;
    }
    if (ch === "." || ch === ",") {
      tokens.push({ value: ch, quoted: false, depth });
    }
    i++;
  }

  return tokens;
}

function isAnalyticsSqlKeyword(
  token: AnalyticsSqlToken | undefined,
  keyword: string,
): boolean {
  return Boolean(
    token && !token.quoted && token.value.toLowerCase() === keyword,
  );
}

function readAnalyticsSqlSource(
  tokens: AnalyticsSqlToken[],
  start: number,
): { source: Omit<AnalyticsSqlSource, "commaSeparated"> | null; next: number } {
  let index = start;
  while (
    isAnalyticsSqlKeyword(tokens[index], "only") ||
    isAnalyticsSqlKeyword(tokens[index], "lateral")
  ) {
    index++;
  }

  const first = tokens[index];
  if (!first) return { source: null, next: index };
  if (first.value === "(") {
    const groupDepth = first.depth;
    index++;
    while (
      index < tokens.length &&
      !(tokens[index].value === ")" && tokens[index].depth === groupDepth)
    ) {
      index++;
    }
    return { source: null, next: Math.min(index + 1, tokens.length) };
  }
  if (!first.quoted && !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(first.value)) {
    return { source: null, next: index + 1 };
  }

  let ref = first.value;
  let quoted = first.quoted;
  if (
    tokens[index + 1]?.value === "." &&
    tokens[index + 2] &&
    (tokens[index + 2].quoted ||
      /^[A-Za-z_][A-Za-z0-9_$]*$/.test(tokens[index + 2].value))
  ) {
    ref += `.${tokens[index + 2].value}`;
    quoted ||= tokens[index + 2].quoted;
    index += 2;
  }
  return { source: { ref, quoted }, next: index + 1 };
}

function collectAnalyticsSqlSources(sql: string): {
  cteNames: Set<string>;
  sources: AnalyticsSqlSource[];
} {
  const tokens = tokenizeAnalyticsSql(sql);
  const cteNames = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (
      tokens[i].value &&
      isAnalyticsSqlKeyword(tokens[i + 1], "as") &&
      tokens[i + 2].value === "("
    ) {
      cteNames.add(tokens[i].value.toLowerCase());
    }
  }

  const sources: AnalyticsSqlSource[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isAnalyticsSqlKeyword(tokens[i], "from")) continue;
    const fromDepth = tokens[i].depth;
    let expectSource = true;
    let inJoinCondition = false;
    let sourceAfterComma = false;

    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j];
      if (token.depth < fromDepth) break;
      if (token.depth > fromDepth) continue;

      const word = token.quoted ? "" : token.value.toLowerCase();
      if (SQL_SOURCE_CLAUSE_ENDS.has(word)) break;
      if (word === "join") {
        expectSource = true;
        inJoinCondition = false;
        sourceAfterComma = false;
        continue;
      }
      if (word === "on" || word === "using") {
        expectSource = false;
        inJoinCondition = true;
        continue;
      }
      if (token.value === "," && !inJoinCondition) {
        expectSource = true;
        sourceAfterComma = true;
        continue;
      }
      if (!expectSource) continue;

      const parsed = readAnalyticsSqlSource(tokens, j);
      if (parsed.source) {
        sources.push({
          ...parsed.source,
          commaSeparated: sourceAfterComma,
        });
      }
      sourceAfterComma = false;
      expectSource = false;
      j = Math.max(j, parsed.next - 1);
    }
  }

  return { cteNames, sources };
}

export function validateFirstPartyAnalyticsSql(sql: string): void {
  const stripped = stripSqlLiterals(sql).trim();
  const lowered = stripped.toLowerCase();
  if (!/^(select|with)\b/.test(lowered)) {
    throw new Error(
      "First-party analytics queries must start with SELECT or WITH",
    );
  }
  if (stripped.includes(";")) {
    throw new Error("Only a single SELECT statement is allowed");
  }
  if (
    /\b(insert|update|delete|drop|alter|truncate|create|replace|pragma|attach|detach|vacuum|grant|revoke)\b/i.test(
      stripped,
    )
  ) {
    throw new Error("Only read-only SELECT queries are allowed");
  }
  if (stripped.includes("?")) {
    throw new Error("Bind placeholders are not supported in dashboard SQL");
  }
  if (/\$\d+\b/.test(stripped)) {
    throw new Error("Bind placeholders are not supported in dashboard SQL");
  }
  if (/\bonly\b/i.test(stripped)) {
    throw new Error(
      "ONLY-qualified table sources are not supported in first-party analytics queries",
    );
  }
  if (/\bsession_replay_chunks\b/i.test(stripped)) {
    throw new Error(
      "First-party analytics queries cannot read session replay chunks",
    );
  }

  const { cteNames, sources } = collectAnalyticsSqlSources(sql);
  let usesAllowedTable = false;
  for (const source of sources) {
    const ref = source.ref.toLowerCase();
    if (source.commaSeparated) {
      throw new Error(
        "Comma-separated table sources are not supported in first-party analytics queries; use an explicit JOIN",
      );
    }
    if (FIRST_PARTY_QUERY_TABLES.has(ref)) {
      if (source.quoted) {
        throw new Error(
          "Quoted table identifiers are not supported in first-party analytics queries",
        );
      }
      usesAllowedTable = true;
      continue;
    }
    if (cteNames.has(ref)) continue;
    throw new Error(
      `First-party analytics queries can only read ${FIRST_PARTY_QUERY_TABLE_LIST} (found ${source.ref})`,
    );
  }
  if (!usesAllowedTable) {
    throw new Error(`Query must read from ${FIRST_PARTY_QUERY_TABLE_LIST}`);
  }
}

function scopedTableSource(
  tableName: string,
  scope: AnalyticsScope,
  today: string,
): {
  sql: string;
  args: Array<string | null>;
} {
  if (FIRST_PARTY_ROLLUP_TABLES.has(tableName)) {
    const tenantKeys = scope.orgId
      ? [`org:${scope.orgId}`, `user:${scope.userEmail}`]
      : [`user:${scope.userEmail}`];
    const branches = tenantKeys.map(
      () =>
        `SELECT * FROM ${tableName} WHERE tenant_key = ? AND event_date <= ?`,
    );
    return {
      // Rollups have a tenant_key/event_date index. Keep the org and personal
      // fallback branches separate so rollup reads stay indexable as well.
      sql: `(${branches.join(" UNION ALL ")})`,
      args: tenantKeys.flatMap((tenantKey) => [tenantKey, today]),
    };
  }

  const freshness = freshnessClause(tableName);
  if (scope.orgId) {
    return {
      // Keep the org and personal fallback as separate branches so Postgres can
      // use each branch's composite tenant/date indexes instead of scanning one
      // broad org index for an OR predicate.
      sql: `(SELECT * FROM ${tableName} WHERE org_id = ? AND ${freshness} UNION ALL SELECT * FROM ${tableName} WHERE org_id IS NULL AND owner_email = ? AND ${freshness})`,
      args: [scope.orgId, today, scope.userEmail, today],
    };
  }
  return {
    sql: `(SELECT * FROM ${tableName} WHERE org_id IS NULL AND owner_email = ? AND ${freshness})`,
    args: [scope.userEmail, today],
  };
}

function freshnessClause(tableName: string): string {
  if (tableName === "analytics_events") {
    return "(COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) <= ?)";
  }
  return "(substr(started_at, 1, 10) <= ?)";
}

export function scopedAnalyticsSql(
  sql: string,
  scope: AnalyticsScope,
  today = todayIsoDate(),
): { sql: string; args: Array<string | null> } {
  const args: Array<string | null> = [];
  const aliasRe = new RegExp(
    `\\b(from|join)\\s+(${FIRST_PARTY_QUERY_TABLE_PATTERN})\\b(\\s+(?:as\\s+)?(?!where\\b|on\\b|group\\b|order\\b|limit\\b|join\\b|left\\b|right\\b|inner\\b|outer\\b|cross\\b|full\\b|having\\b|union\\b)([a-zA-Z_][a-zA-Z0-9_]*))?`,
    "gi",
  );
  const rewritten = sql.replace(
    aliasRe,
    (full, keyword, tableName, aliasPart, alias) => {
      const normalizedTable = String(tableName).toLowerCase();
      const normalizedAlias =
        typeof alias === "string" ? alias.toLowerCase() : "";
      const usableAlias =
        aliasPart &&
        normalizedAlias &&
        !RESERVED_ALIAS_WORDS.has(normalizedAlias)
          ? aliasPart
          : ` AS ${normalizedTable}`;
      const scopedSource = scopedTableSource(normalizedTable, scope, today);
      args.push(...scopedSource.args);
      return `${keyword} ${scopedSource.sql}${usableAlias}`;
    },
  );
  return { sql: rewritten, args };
}

function valueType(value: unknown): string {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function inferSchema(rows: Record<string, unknown>[]): {
  name: string;
  type: string;
}[] {
  const first = rows.find((row) => row && typeof row === "object");
  if (!first) return [];
  return Object.entries(first).map(([name, value]) => ({
    name,
    type: valueType(value),
  }));
}

export async function queryFirstPartyAnalytics(
  sql: string,
  scope: AnalyticsScope,
  options: AnalyticsQueryOptions = {},
): Promise<AnalyticsQueryResult> {
  validateFirstPartyAnalyticsSql(sql);
  const backend = await getFirstPartyAnalyticsBackend(scope);
  if (backend.sink === "bigquery") {
    const usesSessionRecordings = /\bsession_recordings\b/i.test(sql);
    const usesEventTables =
      /\banalytics_events\b|\banalytics_event_daily_rollups\b|\banalytics_user_days\b/i.test(
        sql,
      );
    if (usesSessionRecordings && usesEventTables) {
      throw new Error(
        "Cross-backend joins are not supported; query first-party event tables in BigQuery and session_recordings in the Analytics SQL store separately.",
      );
    }
    if (!usesSessionRecordings) {
      const table = await getFirstPartyAnalyticsTable(backend.table);
      const scoped = scopedAnalyticsSql(sql, scope);
      return queryFirstPartyAnalyticsInBigQuery(scoped.sql, scoped.args, table);
    }
  }
  const scoped = scopedAnalyticsSql(sql, scope);
  const wrappedSql = `SELECT * FROM (${scoped.sql}) AS first_party_analytics_query LIMIT ${MAX_QUERY_ROWS}`;
  const timeoutMs = Math.max(
    1,
    options.timeoutMs ?? FIRST_PARTY_ANALYTICS_QUERY_TIMEOUT_MS,
  );
  // The cache key is the fully scoped SQL + args, which already embeds
  // org_id/owner_email (see scopeClause) — a cache hit can only ever return
  // rows the same tenant was already entitled to query.
  const cacheKey = firstPartyCacheKey(wrappedSql, scoped.args);
  const queryClass = classifyFirstPartyAnalyticsQuery(sql);
  const compute = async (
    queryTimeoutMs = timeoutMs,
  ): Promise<AnalyticsQueryResult> => {
    const exec = getDbExec();
    const startedAt = Date.now();
    try {
      const result = await exec.execute({
        sql: wrappedSql,
        args: scoped.args,
        timeoutMs: queryTimeoutMs,
        maxAttempts: 1,
      });
      const durationMs = Date.now() - startedAt;
      void recordFirstPartyAnalyticsQueryPressure(scope, {
        durationMs,
        outcome: "success",
        queryClass,
      }).catch((error) => {
        console.warn(
          "[first-party-analytics] Query pressure recording failed:",
          error,
        );
      });
      const rows = result.rows as Record<string, unknown>[];
      return { rows, schema: inferSchema(rows) };
    } catch (error) {
      void recordFirstPartyAnalyticsQueryPressure(scope, {
        durationMs: Date.now() - startedAt,
        outcome: queryOutcomeFromError(error),
        queryClass,
      }).catch((recordingError) => {
        console.warn(
          "[first-party-analytics] Query pressure recording failed:",
          recordingError,
        );
      });
      throw error;
    }
  };
  if (!options.cache) return compute();
  return withFirstPartyCache(cacheKey, wrappedSql, compute, { timeoutMs });
}
