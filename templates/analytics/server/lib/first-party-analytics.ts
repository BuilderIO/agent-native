import { and, eq, isNull, or } from "drizzle-orm";
import { getDbExec } from "@agent-native/core/db";
import { getDb, schema } from "../db/index.js";

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

const MAX_EVENTS_PER_REQUEST = 100;
const MAX_QUERY_ROWS = 5_000;
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
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    orgId: row.orgId ?? null,
  }));
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

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
  }
  return nowIso();
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
    const app =
      asString(properties.app) ||
      asString((context as any).app) ||
      (hostname ? hostname.split(".")[0] : null);
    const template =
      asString(properties.template) ||
      asString((properties as any).templateId) ||
      app;
    const signedIn =
      asString((properties as any).signed_in) ||
      asString((properties as any).signedIn) ||
      asString((context as any).signed_in) ||
      asString((context as any).signedIn);

    return {
      id: id("evt"),
      publicKeyId: key.id,
      eventName: event.event,
      userId: event.userId ?? asString((properties as any).userId),
      anonymousId:
        event.anonymousId ??
        asString((properties as any).anonymousId) ??
        asString((properties as any).distinctId),
      sessionId: event.sessionId ?? asString((properties as any).sessionId),
      timestamp: normalizeTimestamp(event.timestamp),
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

  if (rows.length) {
    await db.insert(schema.analyticsEvents).values(rows);
    await db
      .update(schema.analyticsPublicKeys)
      .set({ lastUsedAt: receivedAt })
      .where(eq(schema.analyticsPublicKeys.id, key.id));
  }

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

  const cteNames = new Set<string>();
  const cteRe = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi;
  for (const match of stripped.matchAll(cteRe)) {
    cteNames.add(match[1].toLowerCase());
  }

  let usesAnalyticsEvents = false;
  const tableRe =
    /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi;
  for (const match of stripped.matchAll(tableRe)) {
    const ref = match[1].toLowerCase();
    if (ref === "analytics_events") {
      usesAnalyticsEvents = true;
      continue;
    }
    if (cteNames.has(ref)) continue;
    throw new Error(
      `First-party analytics queries can only read analytics_events (found ${match[1]})`,
    );
  }
  if (!usesAnalyticsEvents) {
    throw new Error("Query must read from analytics_events");
  }
}

function scopeClause(scope: AnalyticsScope): {
  sql: string;
  args: Array<string | null>;
} {
  if (scope.orgId) {
    return {
      sql: "(org_id = ? OR (org_id IS NULL AND owner_email = ?))",
      args: [scope.orgId, scope.userEmail],
    };
  }
  return {
    sql: "(org_id IS NULL AND owner_email = ?)",
    args: [scope.userEmail],
  };
}

function scopedAnalyticsSql(
  sql: string,
  scope: AnalyticsScope,
): { sql: string; args: Array<string | null> } {
  const args: Array<string | null> = [];
  const aliasRe =
    /\b(from|join)\s+analytics_events\b(\s+(?:as\s+)?(?!where\b|on\b|group\b|order\b|limit\b|join\b|left\b|right\b|inner\b|outer\b|cross\b|full\b|having\b|union\b)([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
  const rewritten = sql.replace(aliasRe, (full, keyword, aliasPart, alias) => {
    const normalizedAlias =
      typeof alias === "string" ? alias.toLowerCase() : "";
    const usableAlias =
      aliasPart && normalizedAlias && !RESERVED_ALIAS_WORDS.has(normalizedAlias)
        ? aliasPart
        : " AS analytics_events";
    const scopeDef = scopeClause(scope);
    args.push(...scopeDef.args);
    return `${keyword} (SELECT * FROM analytics_events WHERE ${scopeDef.sql})${usableAlias}`;
  });
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
): Promise<AnalyticsQueryResult> {
  validateFirstPartyAnalyticsSql(sql);
  const scoped = scopedAnalyticsSql(sql, scope);
  const exec = getDbExec();
  const result = await exec.execute({
    sql: `SELECT * FROM (${scoped.sql}) AS first_party_analytics_query LIMIT ${MAX_QUERY_ROWS}`,
    args: scoped.args,
  });
  const rows = result.rows as Record<string, unknown>[];
  return { rows, schema: inferSchema(rows) };
}
