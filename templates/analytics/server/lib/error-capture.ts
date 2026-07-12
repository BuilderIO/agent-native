import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Server-side error capture — OWNED BY THE ERROR CAPTURE FEATURE.
 *
 * This module is the single source of truth for Sentry-style grouping. The
 * browser SDK sends a compact, bounded exception payload (type/message/raw
 * stack/context) through the first-party analytics `$exception` event; the
 * server parses the stack, computes a stable fingerprint, upserts the grouped
 * `error_issues` row, appends an `error_events` occurrence, links it to the
 * session replay it happened in, and prunes occurrences to a bounded retention.
 *
 * Pure helpers (`parseStack`, `fingerprint`, `titleFromException`,
 * `culpritFromFrames`) have no I/O and are unit-tested. Everything is owner
 * scoped: writes derive the tenant from the resolved analytics public key, and
 * reads go through `accessFilter` so an org-scoped key surfaces its issues to
 * the whole org exactly like session recordings.
 */
import { appStateGet } from "@agent-native/core/application-state";
import { notifyWithDelivery } from "@agent-native/core/notifications";
import { recordChange } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export type ExceptionLevel = "fatal" | "error" | "warning" | "info" | "debug";
export type IssueStatus = "unresolved" | "resolved" | "ignored";

const LEVELS: ExceptionLevel[] = ["fatal", "error", "warning", "info", "debug"];
const LEVEL_RANK: Record<ExceptionLevel, number> = {
  fatal: 5,
  error: 4,
  warning: 3,
  info: 2,
  debug: 1,
};

/** Dedicated first-party analytics event name for captured exceptions. */
export const EXCEPTION_EVENT_NAME = "$exception";

const MAX_FRAMES = 50;
const MAX_RAW_STACK = 8_000;
const MAX_MESSAGE = 2_000;
const MAX_TITLE = 300;
const MAX_BREADCRUMBS = 30;
const MAX_TAG_KEYS = 30;
const MAX_EXTRA_KEYS = 50;
/** Per-issue occurrence retention. Older events are pruned at ingest. */
const MAX_EVENTS_PER_ISSUE = 100;
const DEFAULT_ISSUE_LIMIT = 50;
const MAX_ISSUE_LIMIT = 100;
const DEFAULT_EVENTS_PER_ISSUE_READ = 50;
const SPARKLINE_DAYS = 14;
const SOURCE_CONTEXT_BEFORE = 4;
const SOURCE_CONTEXT_AFTER = 4;
const MAX_SOURCE_CONTEXT_FILE_BYTES = 2_000_000;
const MAX_SOURCE_CONTEXT_LINE_CHARS = 500;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export interface ParsedStackFrame {
  function: string | null;
  file: string | null;
  lineno: number | null;
  colno: number | null;
  inApp: boolean;
  raw: string;
  sourceContext?: SourceContextLine[];
}

export interface SourceContextLine {
  line: number;
  text: string;
  highlight: boolean;
}

const VENDOR_FILE_RE =
  /node_modules|\/vendor\/|vendor[-.]|chunk-vendors|\.vite\/deps|webpack-internal|\/deps\/|cdn\.|unpkg\.com|jsdelivr\.net/i;

function isInAppFile(file: string | null): boolean {
  if (!file) return false;
  if (file === "<anonymous>" || file === "[native code]") return false;
  return !VENDOR_FILE_RE.test(file);
}

function parseLocation(loc: string): {
  file: string | null;
  lineno: number | null;
  colno: number | null;
} {
  const cleaned = loc.trim().replace(/^\(/, "").replace(/\)$/, "");
  const withColCol = cleaned.match(/^(.*?):(\d+):(\d+)$/);
  if (withColCol) {
    return {
      file: withColCol[1] || null,
      lineno: Number(withColCol[2]),
      colno: Number(withColCol[3]),
    };
  }
  const withLine = cleaned.match(/^(.*?):(\d+)$/);
  if (withLine) {
    return {
      file: withLine[1] || null,
      lineno: Number(withLine[2]),
      colno: null,
    };
  }
  return { file: cleaned || null, lineno: null, colno: null };
}

function looksLikeLocation(value: string): boolean {
  return /:\d+(?::\d+)?\)?$/.test(value) || /^[a-z]+:\/\//i.test(value);
}

function parseStackLine(rawLine: string): ParsedStackFrame | null {
  const line = rawLine.trim();
  if (!line) return null;

  // V8 / Chrome: "at fn (loc)" or "at loc"
  if (line.startsWith("at ")) {
    let rest = line.slice(3).trim();
    rest = rest.replace(/^async\s+/, "");
    const parenMatch = rest.match(/^(.*?)\s+\((.*)\)$/);
    if (parenMatch) {
      const fn = parenMatch[1].trim();
      const loc = parseLocation(parenMatch[2]);
      return {
        function: fn || null,
        ...loc,
        inApp: isInAppFile(loc.file),
        raw: line,
      };
    }
    const loc = parseLocation(rest);
    return {
      function: null,
      ...loc,
      inApp: isInAppFile(loc.file),
      raw: line,
    };
  }

  // Firefox / Safari: "fn@loc" or "@loc"
  const atIndex = line.lastIndexOf("@");
  if (atIndex >= 0) {
    const fn = line.slice(0, atIndex).trim();
    const loc = parseLocation(line.slice(atIndex + 1));
    return {
      function: fn || null,
      ...loc,
      inApp: isInAppFile(loc.file),
      raw: line,
    };
  }

  // Bare location line.
  if (looksLikeLocation(line)) {
    const loc = parseLocation(line);
    return {
      function: null,
      ...loc,
      inApp: isInAppFile(loc.file),
      raw: line,
    };
  }

  return null;
}

/** Parse a raw stack string into normalized frames (bounded). */
export function parseStack(
  stack: string | null | undefined,
): ParsedStackFrame[] {
  if (!stack || typeof stack !== "string") return [];
  const frames: ParsedStackFrame[] = [];
  for (const line of stack.split("\n")) {
    if (frames.length >= MAX_FRAMES) break;
    const frame = parseStackLine(line);
    if (frame) frames.push(frame);
  }
  return frames;
}

export function sourceContextFromText(
  source: string,
  lineNumber: number | null | undefined,
  options: { before?: number; after?: number } = {},
): SourceContextLine[] | null {
  if (!lineNumber || lineNumber < 1) return null;
  const lines = source.split(/\r?\n/);
  if (lineNumber > lines.length) return null;
  const before = options.before ?? SOURCE_CONTEXT_BEFORE;
  const after = options.after ?? SOURCE_CONTEXT_AFTER;
  const start = Math.max(1, lineNumber - before);
  const end = Math.min(lines.length, lineNumber + after);
  const context: SourceContextLine[] = [];
  for (let line = start; line <= end; line += 1) {
    const text = lines[line - 1] ?? "";
    context.push({
      line,
      text:
        text.length > MAX_SOURCE_CONTEXT_LINE_CHARS
          ? `${text.slice(0, MAX_SOURCE_CONTEXT_LINE_CHARS)}…`
          : text,
      highlight: line === lineNumber,
    });
  }
  return context;
}

const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|json)$/i;
const SOURCE_CONTEXT_ALLOWED_PREFIXES = ["app/"] as const;

function templateRootFrom(value: string): string | null {
  const marker = `${path.sep}templates${path.sep}analytics`;
  const index = value.indexOf(marker);
  if (index < 0) return null;
  return value.slice(0, index + marker.length);
}

function sourceRoots(): string[] {
  const roots = new Set<string>();
  const cwdTemplateRoot = templateRootFrom(process.cwd());
  roots.add(cwdTemplateRoot ?? process.cwd());
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const moduleTemplateRoot = templateRootFrom(modulePath);
    if (moduleTemplateRoot) roots.add(moduleTemplateRoot);
  } catch {
    // import.meta.url is always file: in Node, but source context is best-effort.
  }
  return Array.from(roots).map((root) => path.resolve(root));
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function cleanFrameFile(file: string | null): string | null {
  if (!file) return null;
  let cleaned = file.trim();
  if (!cleaned || cleaned === "<anonymous>" || cleaned === "[native code]") {
    return null;
  }
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      cleaned = new URL(cleaned).pathname;
    } catch {
      return null;
    }
  } else if (cleaned.startsWith("file://")) {
    try {
      cleaned = fileURLToPath(cleaned);
    } catch {
      return null;
    }
  }
  cleaned = cleaned.replace(/[?#].*$/, "");
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // Keep the original path when a browser stack includes malformed escapes.
  }
  return cleaned;
}

export function trustedSourceRelativePath(cleaned: string): string | null {
  const normalized = cleaned.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return null;
  }
  if (
    !SOURCE_CONTEXT_ALLOWED_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
  ) {
    return null;
  }
  return normalized;
}

async function resolveSourcePath(
  frame: ParsedStackFrame,
): Promise<string | null> {
  if (!frame.inApp) return null;
  const cleaned = cleanFrameFile(frame.file);
  if (!cleaned || !SOURCE_EXT_RE.test(cleaned)) return null;
  const relativePath = trustedSourceRelativePath(cleaned);
  if (!relativePath) return null;
  const roots = sourceRoots();
  const candidates = new Set<string>();
  for (const root of roots) candidates.add(path.resolve(root, relativePath));

  for (const candidate of candidates) {
    if (!roots.some((root) => isWithinRoot(candidate, root))) continue;
    try {
      const fileStat = await stat(candidate);
      if (
        fileStat.isFile() &&
        fileStat.size > 0 &&
        fileStat.size <= MAX_SOURCE_CONTEXT_FILE_BYTES
      ) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function sourceContextForFrame(
  frame: ParsedStackFrame,
): Promise<SourceContextLine[] | undefined> {
  if (!frame.lineno) return undefined;
  const sourcePath = await resolveSourcePath(frame);
  if (!sourcePath) return undefined;
  try {
    const source = await readFile(sourcePath, "utf8");
    return (
      sourceContextFromText(source, frame.lineno, {
        before: SOURCE_CONTEXT_BEFORE,
        after: SOURCE_CONTEXT_AFTER,
      }) ?? undefined
    );
  } catch {
    return undefined;
  }
}

async function addSourceContexts(
  frames: ParsedStackFrame[],
): Promise<ParsedStackFrame[]> {
  return Promise.all(
    frames.map(async (frame) => {
      const sourceContext = await sourceContextForFrame(frame);
      return sourceContext?.length ? { ...frame, sourceContext } : frame;
    }),
  );
}

/** Strip content hashes + query/hash from a filename for stable grouping. */
export function normalizeFrameFile(file: string | null): string {
  if (!file) return "";
  let out = file;
  // Drop query string + hash fragment.
  out = out.replace(/[?#].*$/, "");
  // Reduce URLs to pathname so host/port churn doesn't fragment groups.
  const urlMatch = out.match(/^[a-z]+:\/\/[^/]+(\/.*)$/i);
  if (urlMatch) out = urlMatch[1];
  // Strip bundler content hashes in the basename: main.4f3a2b1c.js -> main.js
  out = out.replace(/([._-])[0-9a-fA-F]{8,}(?=\.[a-z0-9]+$)/i, "");
  out = out.replace(/([._-])[0-9a-fA-F]{8,}$/i, "");
  return out;
}

function normalizeMessageForFingerprint(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<uuid>",
    )
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .trim()
    .slice(0, 200);
}

function hashHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function topFrame(frames: ParsedStackFrame[]): ParsedStackFrame | null {
  return frames.find((frame) => frame.inApp) ?? frames[0] ?? null;
}

/**
 * Stable grouping key. Prefers error type + top in-app frame
 * (function + normalized file, ignoring line/col so small edits don't split a
 * group). Falls back to a normalized message when there is no usable stack.
 */
export function fingerprint(
  type: string,
  frames: ParsedStackFrame[],
  message: string,
): string {
  const frame = topFrame(frames);
  const key =
    frame && (frame.file || frame.function)
      ? `${type}|${normalizeFrameFile(frame.file)}|${frame.function ?? ""}`
      : `${type}|${normalizeMessageForFingerprint(message)}`;
  return hashHex(key);
}

/** Human-readable issue title: "Type: first line of message". */
export function titleFromException(type: string, message: string): string {
  const firstLine = (message || "").split("\n")[0]?.trim() ?? "";
  const title = firstLine ? `${type}: ${firstLine}` : type;
  return title.slice(0, MAX_TITLE);
}

/** Best-effort culprit — the top in-app frame as "fn (file:line)". */
export function culpritFromFrames(frames: ParsedStackFrame[]): string | null {
  const frame = topFrame(frames);
  if (!frame) return null;
  const file = normalizeFrameFile(frame.file);
  const base = file ? file.split("/").pop() || file : null;
  const location = base
    ? frame.lineno != null
      ? `${base}:${frame.lineno}`
      : base
    : null;
  const fn = frame.function || "?";
  return location ? `${fn} (${location})` : fn;
}

/**
 * Split a session console/diagnostics error line ("TypeError: x is not a
 * function") back into the `{ type, message }` the SDK sent at capture time.
 * The replay recorder serializes errors as `${name}: ${message}`, which mirrors
 * the SDK's `error.name` / `error.message`, so this recovers the exact
 * fingerprint inputs from what the sessions UI already has on screen.
 */
export function deriveConsoleExceptionIdentity(raw: string): {
  type: string;
  message: string;
} {
  const text = (raw || "").trim();
  const idx = text.indexOf(": ");
  if (idx > 0) {
    const prefix = text.slice(0, idx);
    // Error names are bare identifiers (TypeError, DOMException, FooError); a
    // prefix with spaces is a plain message, not a type.
    if (/^[A-Za-z_$][\w$.]{0,79}$/.test(prefix)) {
      return { type: prefix, message: text.slice(idx + 2) };
    }
  }
  return { type: "Error", message: text };
}

/** A session console error line to resolve back to its grouped issue. */
export interface ConsoleErrorSignature {
  /** Caller-chosen id echoed back in the match result. */
  key: string;
  /** Console source (`window-error` / `unhandledrejection` / `console`). */
  source?: string | null;
  message: string;
  stack?: string | null;
}

/**
 * Candidate fingerprints for a session console error line, computed with the
 * exact same `parseStack` + `fingerprint` helpers as ingest — so a match is
 * authoritative, not a parallel heuristic. Returns the primary fingerprint
 * plus, for an unhandled rejection of a plain `Error`, the `UnhandledRejection`
 * variant the SDK records (it renames a bare `Error` reason at capture time).
 */
export function candidateFingerprintsForConsole(
  signature: ConsoleErrorSignature,
): string[] {
  const frames = parseStack(signature.stack ?? undefined);
  const { type, message } = deriveConsoleExceptionIdentity(signature.message);
  const fingerprints = [fingerprint(type, frames, message)];
  if (signature.source === "unhandledrejection" && type === "Error") {
    fingerprints.push(fingerprint("UnhandledRejection", frames, message));
  }
  return Array.from(new Set(fingerprints));
}

function maxLevel(a: ExceptionLevel, b: ExceptionLevel): ExceptionLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

function coerceLevel(
  value: unknown,
  fallback: ExceptionLevel = "error",
): ExceptionLevel {
  return typeof value === "string" && (LEVELS as string[]).includes(value)
    ? (value as ExceptionLevel)
    : fallback;
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export interface IngestScope {
  ownerEmail: string;
  orgId: string | null;
  /** Resolved analytics public key id, used to link the session replay. */
  publicKeyId?: string | null;
}

/** Analytics-derived dimensions carried on the forked `$exception` event. */
export interface DerivedExceptionFields {
  app: string | null;
  template: string | null;
  url: string | null;
  userId: string | null;
  anonymousId: string | null;
  userKey: string | null;
  sessionId: string | null;
  /** ISO occurrence time (already normalized by the analytics ingest). */
  timestamp: string;
}

export interface RawExceptionInput {
  type: string;
  message: string;
  rawStack: string | null;
  handled: boolean;
  level: ExceptionLevel;
  release: string | null;
  environment: string | null;
  clientRecordingId: string | null;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  breadcrumbs: unknown[];
}

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

function newId(prefix: string): string {
  return `${prefix}_${randomHex(12)}`;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function boundedRecord(
  value: unknown,
  maxKeys: number,
  stringifyValues: boolean,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= maxKeys) break;
    out[key] = stringifyValues ? String(raw) : raw;
    count += 1;
  }
  return out;
}

/** Extract a normalized exception payload from a forked `$exception` event. */
export function extractExceptionInput(
  properties: Record<string, unknown>,
): RawExceptionInput {
  const type = asString(properties.exceptionType) || "Error";
  const message = (asString(properties.exceptionMessage) || "").slice(
    0,
    MAX_MESSAGE,
  );
  const rawStack = asString(properties.exceptionStack);
  const handled = properties.handled === true;
  const level = coerceLevel(properties.level);
  const clientRecordingId =
    asString(properties.sessionReplayId) ||
    asString((properties as any).clientRecordingId);
  const breadcrumbs = Array.isArray(properties.breadcrumbs)
    ? (properties.breadcrumbs as unknown[]).slice(-MAX_BREADCRUMBS)
    : [];
  return {
    type,
    message,
    rawStack: rawStack ? rawStack.slice(0, MAX_RAW_STACK) : null,
    handled,
    level,
    release: asString(properties.release),
    environment: asString(properties.environment),
    clientRecordingId,
    tags: boundedRecord(properties.exceptionTags, MAX_TAG_KEYS, true) as Record<
      string,
      string
    >,
    extra: boundedRecord(properties.exceptionExtra, MAX_EXTRA_KEYS, false),
    breadcrumbs,
  };
}

async function resolveSessionRecordingId(
  scope: IngestScope,
  clientRecordingId: string | null,
): Promise<string | null> {
  if (!clientRecordingId) return null;
  const db = getDb() as any;
  const conditions: any[] = [
    eq(schema.sessionRecordings.clientRecordingId, clientRecordingId),
    eq(schema.sessionRecordings.ownerEmail, scope.ownerEmail),
    scope.orgId
      ? eq(schema.sessionRecordings.orgId, scope.orgId)
      : isNull(schema.sessionRecordings.orgId),
  ];
  if (scope.publicKeyId) {
    conditions.push(
      eq(schema.sessionRecordings.publicKeyId, scope.publicKeyId),
    );
  }
  const [row] = await db
    .select({ id: schema.sessionRecordings.id })
    .from(schema.sessionRecordings)
    .where(and(...conditions))
    .limit(1);
  return row?.id ?? null;
}

function changeScope(scope: IngestScope): { owner?: string; orgId?: string } {
  return scope.orgId ? { orgId: scope.orgId } : { owner: scope.ownerEmail };
}

async function pruneAndCountUsers(
  issueId: string,
  scope: IngestScope,
): Promise<{ usersAffected: number }> {
  const db = getDb() as any;
  const keep = await db
    .select({ id: schema.errorEvents.id })
    .from(schema.errorEvents)
    .where(
      and(
        eq(schema.errorEvents.issueId, issueId),
        eq(schema.errorEvents.ownerEmail, scope.ownerEmail),
        scope.orgId
          ? eq(schema.errorEvents.orgId, scope.orgId)
          : isNull(schema.errorEvents.orgId),
      ),
    )
    .orderBy(
      desc(schema.errorEvents.occurredAt),
      desc(schema.errorEvents.createdAt),
    )
    .limit(MAX_EVENTS_PER_ISSUE);
  const keepIds = keep.map((row: any) => row.id);
  if (keepIds.length >= MAX_EVENTS_PER_ISSUE) {
    await db
      .delete(schema.errorEvents)
      .where(
        and(
          eq(schema.errorEvents.issueId, issueId),
          eq(schema.errorEvents.ownerEmail, scope.ownerEmail),
          scope.orgId
            ? eq(schema.errorEvents.orgId, scope.orgId)
            : isNull(schema.errorEvents.orgId),
          notInArray(schema.errorEvents.id, keepIds),
        ),
      );
  }
  const [row] = await db
    .select({
      users: sql<number>`count(distinct coalesce(${schema.errorEvents.userKey}, ${schema.errorEvents.anonymousId}, ${schema.errorEvents.id}))`,
    })
    .from(schema.errorEvents)
    .where(
      and(
        eq(schema.errorEvents.issueId, issueId),
        eq(schema.errorEvents.ownerEmail, scope.ownerEmail),
        scope.orgId
          ? eq(schema.errorEvents.orgId, scope.orgId)
          : isNull(schema.errorEvents.orgId),
      ),
    );
  return { usersAffected: Number(row?.users ?? 0) };
}

export interface IngestExceptionResult {
  issueId: string;
  eventId: string;
  isNewIssue: boolean;
  sessionRecordingId: string | null;
}

async function findIssueForFingerprint(
  db: any,
  scope: IngestScope,
  fingerprint: string,
) {
  const [issue] = await db
    .select()
    .from(schema.errorIssues)
    .where(
      and(
        eq(schema.errorIssues.ownerEmail, scope.ownerEmail),
        scope.orgId
          ? eq(schema.errorIssues.orgId, scope.orgId)
          : isNull(schema.errorIssues.orgId),
        eq(schema.errorIssues.fingerprint, fingerprint),
      ),
    )
    .limit(1);
  return issue;
}

async function updateIssueForOccurrence(
  db: any,
  existing: any,
  params: {
    raw: RawExceptionInput;
    derived: DerivedExceptionFields;
    eventId: string;
    sessionRecordingId: string | null;
    occurredAt: string;
    now: string;
    title: string;
    culprit: string | null;
  },
): Promise<string> {
  const firstSeenAt =
    params.occurredAt < existing.firstSeenAt
      ? params.occurredAt
      : existing.firstSeenAt;
  const lastSeenAt =
    params.occurredAt > existing.lastSeenAt
      ? params.occurredAt
      : existing.lastSeenAt;
  // Reopen a resolved issue on regression; leave ignored issues muted.
  const status: IssueStatus =
    existing.status === "resolved" ? "unresolved" : existing.status;
  await db
    .update(schema.errorIssues)
    .set({
      title: params.title,
      culprit: params.culprit,
      level: maxLevel(coerceLevel(existing.level), params.raw.level),
      status,
      firstSeenAt,
      lastSeenAt,
      eventCount: sql`${schema.errorIssues.eventCount} + 1`,
      sampleEventId: params.eventId,
      lastSessionRecordingId:
        params.sessionRecordingId ?? existing.lastSessionRecordingId ?? null,
      app: params.derived.app ?? existing.app ?? null,
      template: params.derived.template ?? existing.template ?? null,
      updatedAt: params.now,
    })
    .where(eq(schema.errorIssues.id, existing.id));
  return existing.id;
}

/**
 * Insert one occurrence and upsert its grouped issue. Owner scoped; caller
 * supplies the tenant resolved from the analytics public key.
 */
export async function ingestException(
  scope: IngestScope,
  raw: RawExceptionInput,
  derived: DerivedExceptionFields,
): Promise<IngestExceptionResult> {
  const db = getDb() as any;
  const frames = parseStack(raw.rawStack);
  const fp = fingerprint(raw.type, frames, raw.message);
  const title = titleFromException(raw.type, raw.message);
  const culprit = culpritFromFrames(frames);
  const occurredAt = derived.timestamp || nowIso();
  const now = nowIso();
  const sessionRecordingId = await resolveSessionRecordingId(
    scope,
    raw.clientRecordingId,
  );

  const existing = await findIssueForFingerprint(db, scope, fp);

  const eventId = newId("errev");
  let isNewIssue = !existing;
  let issueId: string;

  if (existing) {
    issueId = await updateIssueForOccurrence(db, existing, {
      raw,
      derived,
      eventId,
      sessionRecordingId,
      occurredAt,
      now,
      title,
      culprit,
    });
  } else {
    issueId = newId("erriss");
    try {
      await db.insert(schema.errorIssues).values({
        id: issueId,
        fingerprint: fp,
        type: raw.type,
        title,
        culprit,
        level: raw.level,
        status: "unresolved",
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
        eventCount: 1,
        usersAffected: 0,
        sampleEventId: eventId,
        lastSessionRecordingId: sessionRecordingId,
        assignee: null,
        app: derived.app,
        template: derived.template,
        createdAt: now,
        updatedAt: now,
        ownerEmail: scope.ownerEmail,
        orgId: scope.orgId,
        visibility: scope.orgId ? "org" : "private",
      });
    } catch (err) {
      const racedIssue = await findIssueForFingerprint(db, scope, fp);
      if (!racedIssue) throw err;
      isNewIssue = false;
      issueId = await updateIssueForOccurrence(db, racedIssue, {
        raw,
        derived,
        eventId,
        sessionRecordingId,
        occurredAt,
        now,
        title,
        culprit,
      });
    }
  }

  await db.insert(schema.errorEvents).values({
    id: eventId,
    issueId,
    fingerprint: fp,
    type: raw.type,
    message: raw.message,
    culprit,
    level: raw.level,
    stack: JSON.stringify(frames),
    rawStack: raw.rawStack,
    handled: raw.handled,
    url: derived.url,
    userId: derived.userId,
    anonymousId: derived.anonymousId,
    userKey: derived.userKey,
    sessionId: derived.sessionId,
    clientRecordingId: raw.clientRecordingId,
    sessionRecordingId,
    release: raw.release,
    environment: raw.environment,
    tags: JSON.stringify(raw.tags ?? {}),
    extra: JSON.stringify(raw.extra ?? {}),
    breadcrumbs: JSON.stringify(raw.breadcrumbs ?? []),
    occurredAt,
    createdAt: now,
    ownerEmail: scope.ownerEmail,
    orgId: scope.orgId,
  });

  const { usersAffected } = await pruneAndCountUsers(issueId, scope);
  await db
    .update(schema.errorIssues)
    .set({ usersAffected })
    .where(eq(schema.errorIssues.id, issueId));

  recordChange({
    source: "error-issues",
    type: isNewIssue ? "add" : "change",
    key: issueId,
    ...changeScope(scope),
  });

  if (isNewIssue) {
    await notifyNewIssue(scope, { issueId, title, level: raw.level }).catch(
      () => {
        // New-issue alerts are best-effort; never fail ingest on delivery.
      },
    );
  }

  return { issueId, eventId, isNewIssue, sessionRecordingId };
}

/**
 * Fork the `$exception` events out of an analytics batch and ingest them.
 * Best-effort: a malformed exception must never reject the analytics ingest.
 */
export async function ingestAnalyticsExceptionEvents(
  scope: IngestScope,
  events: Array<{
    properties: Record<string, unknown>;
    derived: DerivedExceptionFields;
  }>,
): Promise<{ ingested: number }> {
  let ingested = 0;
  for (const item of events) {
    try {
      await ingestException(
        scope,
        extractExceptionInput(item.properties),
        item.derived,
      );
      ingested += 1;
    } catch (error) {
      console.warn("[error-capture] Failed to ingest exception event:", error);
    }
  }
  return { ingested };
}

async function notifyNewIssue(
  scope: IngestScope,
  issue: { issueId: string; title: string; level: ExceptionLevel },
): Promise<void> {
  await notifyWithDelivery(
    {
      severity: issue.level === "fatal" ? "critical" : "warning",
      title: `New error: ${issue.title}`,
      body: "A new JavaScript error was captured in your app.",
      channels: ["inbox"],
      metadata: {
        kind: "error_issue",
        issueId: issue.issueId,
        level: issue.level,
        path: `/monitoring?view=errors&issue=${issue.issueId}`,
      },
    },
    // The notification inbox is owner-scoped; the issue's owner is the analytics
    // key owner, so notify them (org members still see the issue in the UI via
    // `accessFilter`).
    { owner: scope.ownerEmail },
  );
}

// ---------------------------------------------------------------------------
// Reads + triage
// ---------------------------------------------------------------------------

export interface ErrorReadScope {
  userEmail: string;
  orgId: string | null;
}

function accessCtx(scope: ErrorReadScope) {
  return { userEmail: scope.userEmail, orgId: scope.orgId ?? undefined };
}

function issuesAccessFilter(
  scope: ErrorReadScope,
  minRole?: "viewer" | "editor",
) {
  return accessFilter(
    schema.errorIssues,
    schema.errorIssueShares,
    accessCtx(scope),
    minRole ?? "viewer",
  );
}

function textContains(column: any, value: string) {
  const escaped = value.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`);
  return sql`lower(coalesce(${column}, '')) like ${`%${escaped}%`} escape '\\'`;
}

/** A session console error line resolved to its grouped, access-scoped issue. */
export interface MatchedErrorIssue {
  issueId: string;
  status: IssueStatus;
  title: string;
  fingerprint: string;
}

const MAX_MATCH_SIGNATURES = 100;

/**
 * Resolve a batch of session console error lines to their captured issues, in a
 * single access-scoped query. Each signature's fingerprint is computed with the
 * same helpers as ingest, so a hit is the very same group the error was filed
 * under — enabling a session recording to deep-link straight to issue detail.
 * Lines with no matching captured issue are simply omitted from the result.
 */
export async function matchErrorIssuesBySignatures(
  scope: ErrorReadScope,
  signatures: ConsoleErrorSignature[],
): Promise<Record<string, MatchedErrorIssue>> {
  const bounded = (signatures ?? []).slice(0, MAX_MATCH_SIGNATURES);
  const candidatesByKey = new Map<string, string[]>();
  const allFingerprints = new Set<string>();
  for (const signature of bounded) {
    if (!signature?.key || !signature.message) continue;
    const fingerprints = candidateFingerprintsForConsole(signature);
    if (!fingerprints.length) continue;
    candidatesByKey.set(signature.key, fingerprints);
    for (const fp of fingerprints) allFingerprints.add(fp);
  }
  if (!allFingerprints.size) return {};

  const db = getDb() as any;
  const rows = await db
    .select({
      id: schema.errorIssues.id,
      status: schema.errorIssues.status,
      title: schema.errorIssues.title,
      fingerprint: schema.errorIssues.fingerprint,
    })
    .from(schema.errorIssues)
    .where(
      and(
        inArray(schema.errorIssues.fingerprint, Array.from(allFingerprints)),
        issuesAccessFilter(scope),
      ),
    );

  const byFingerprint = new Map<string, MatchedErrorIssue>();
  for (const row of rows) {
    if (byFingerprint.has(row.fingerprint)) continue;
    byFingerprint.set(row.fingerprint, {
      issueId: row.id,
      status: row.status as IssueStatus,
      title: row.title,
      fingerprint: row.fingerprint,
    });
  }

  const result: Record<string, MatchedErrorIssue> = {};
  for (const [key, fingerprints] of candidatesByKey) {
    for (const fp of fingerprints) {
      const match = byFingerprint.get(fp);
      if (match) {
        result[key] = match;
        break;
      }
    }
  }
  return result;
}

export interface ListErrorIssuesFilters {
  status?: IssueStatus | "all";
  query?: string;
  app?: string;
  sessionRecordingId?: string;
  userId?: string;
  sort?: "lastSeen" | "eventCount" | "firstSeen";
  limit?: number;
}

export const ERROR_REPORTING_ANONYMOUS_EMAIL = "anonymous@builder.io";
const ERROR_REPORTING_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Error reports contain emails in identity fields, messages, stacks, URLs,
 * tags, extra context, and breadcrumbs. Redact every string at this owning
 * read seam so demo mode never depends on browser interception timing.
 */
export function anonymizeErrorReportingEmails<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(
      ERROR_REPORTING_EMAIL_PATTERN,
      ERROR_REPORTING_ANONYMOUS_EMAIL,
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => anonymizeErrorReportingEmails(item)) as T;
  }
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = anonymizeErrorReportingEmails(entry);
    }
    return output as T;
  }
  return value;
}

async function isErrorDemoModeEnabled(
  userEmail?: string | null,
): Promise<boolean> {
  if (process.env.DEMO_MODE === "true") return true;
  if (!userEmail) return false;
  try {
    // Keep demo state tied to the caller whose issues are being read.
    const state = await appStateGet(userEmail, "demo-mode");
    return state?.enabled === true;
  } catch {
    return false;
  }
}

function anonymizeErrorReportingEmailsInDemoMode<T>(
  value: T,
  enabled: boolean,
): T {
  return enabled ? anonymizeErrorReportingEmails(value) : value;
}

export interface ErrorIssueSummary {
  id: string;
  fingerprint: string;
  type: string;
  title: string;
  culprit: string | null;
  level: ExceptionLevel;
  status: IssueStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  usersAffected: number;
  lastSessionRecordingId: string | null;
  lastSessionRecordingPath: string | null;
  assignee: string | null;
  app: string | null;
  template: string | null;
  /** Daily occurrence counts for the last SPARKLINE_DAYS, oldest first. */
  sparkline: number[];
}

function recordingPath(recordingId: string | null): string | null {
  return recordingId ? `/sessions/${recordingId}` : null;
}

async function sparklinesForIssues(
  issueIds: string[],
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (!issueIds.length) return result;
  const db = getDb() as any;
  const since = new Date(
    Date.now() - SPARKLINE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await db
    .select({
      issueId: schema.errorEvents.issueId,
      day: sql<string>`substr(${schema.errorEvents.occurredAt}, 1, 10)`,
      count: sql<number>`count(*)`,
    })
    .from(schema.errorEvents)
    .where(
      and(
        inArray(schema.errorEvents.issueId, issueIds),
        sql`${schema.errorEvents.occurredAt} >= ${since}`,
      ),
    )
    .groupBy(
      schema.errorEvents.issueId,
      sql`substr(${schema.errorEvents.occurredAt}, 1, 10)`,
    );

  const days: string[] = [];
  for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
    days.push(
      new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    );
  }
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  for (const id of issueIds) result.set(id, new Array(SPARKLINE_DAYS).fill(0));
  for (const row of rows) {
    const series = result.get(row.issueId);
    const index = dayIndex.get(String(row.day));
    if (series && index !== undefined) series[index] = Number(row.count ?? 0);
  }
  return result;
}

export async function listErrorIssues(
  scope: ErrorReadScope,
  filters: ListErrorIssuesFilters = {},
): Promise<ErrorIssueSummary[]> {
  const demoModeEnabled = isErrorDemoModeEnabled(scope.userEmail);
  const db = getDb() as any;
  const limit = Math.min(
    MAX_ISSUE_LIMIT,
    Math.max(1, filters.limit ?? DEFAULT_ISSUE_LIMIT),
  );
  const conditions: any[] = [issuesAccessFilter(scope)];
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(schema.errorIssues.status, filters.status));
  }
  if (filters.app) conditions.push(eq(schema.errorIssues.app, filters.app));
  const sessionRecordingId = filters.sessionRecordingId?.trim();
  const userId = filters.userId?.trim();
  if (sessionRecordingId || userId) {
    const occurrenceConditions: any[] = [
      eq(schema.errorEvents.issueId, schema.errorIssues.id),
      // Keep the child occurrence in the same tenant as its parent issue even
      // when the issue is visible through an org share.
      eq(schema.errorEvents.ownerEmail, schema.errorIssues.ownerEmail),
      or(
        eq(schema.errorEvents.orgId, schema.errorIssues.orgId),
        and(isNull(schema.errorEvents.orgId), isNull(schema.errorIssues.orgId)),
      ),
    ];
    if (sessionRecordingId) {
      occurrenceConditions.push(
        eq(schema.errorEvents.sessionRecordingId, sessionRecordingId),
      );
    }
    if (userId) {
      occurrenceConditions.push(
        or(
          eq(schema.errorEvents.userId, userId),
          eq(schema.errorEvents.userKey, userId),
        ),
      );
    }
    conditions.push(
      exists(
        db
          .select({ id: schema.errorEvents.id })
          .from(schema.errorEvents)
          .where(and(...occurrenceConditions)),
      ),
    );
  }
  const query = filters.query?.trim();
  if (query) {
    conditions.push(
      or(
        textContains(schema.errorIssues.title, query),
        textContains(schema.errorIssues.type, query),
        textContains(schema.errorIssues.culprit, query),
        textContains(schema.errorIssues.fingerprint, query),
      ),
    );
  }
  const orderColumn =
    filters.sort === "eventCount"
      ? schema.errorIssues.eventCount
      : filters.sort === "firstSeen"
        ? schema.errorIssues.firstSeenAt
        : schema.errorIssues.lastSeenAt;

  const rows = await db
    .select()
    .from(schema.errorIssues)
    .where(and(...conditions))
    .orderBy(desc(orderColumn))
    .limit(limit);

  const sparklines = await sparklinesForIssues(rows.map((row: any) => row.id));
  const issues = rows.map((row: any) => ({
    id: row.id,
    fingerprint: row.fingerprint,
    type: row.type,
    title: row.title,
    culprit: row.culprit ?? null,
    level: coerceLevel(row.level),
    status: row.status as IssueStatus,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    eventCount: Number(row.eventCount ?? 0),
    usersAffected: Number(row.usersAffected ?? 0),
    lastSessionRecordingId: row.lastSessionRecordingId ?? null,
    lastSessionRecordingPath: recordingPath(row.lastSessionRecordingId ?? null),
    assignee: row.assignee ?? null,
    app: row.app ?? null,
    template: row.template ?? null,
    sparkline: sparklines.get(row.id) ?? new Array(SPARKLINE_DAYS).fill(0),
  }));
  return anonymizeErrorReportingEmailsInDemoMode(issues, await demoModeEnabled);
}

export interface ErrorEventDetail {
  id: string;
  type: string;
  message: string;
  culprit: string | null;
  level: ExceptionLevel;
  stack: ParsedStackFrame[];
  rawStack: string | null;
  handled: boolean;
  url: string | null;
  userId: string | null;
  anonymousId: string | null;
  userKey: string | null;
  sessionId: string | null;
  sessionRecordingId: string | null;
  sessionRecordingPath: string | null;
  release: string | null;
  environment: string | null;
  tags: Record<string, unknown>;
  extra: Record<string, unknown>;
  breadcrumbs: unknown[];
  occurredAt: string;
}

export interface ErrorIssueDetail {
  issue: ErrorIssueSummary;
  events: ErrorEventDetail[];
  sessions: Array<{ recordingId: string; path: string }>;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Resolve accessible session recordings for a batch of occurrences. Only
 * returns recordings the caller can actually view (via `accessFilter`), so a
 * "watch replay" link never leaks a recording outside its share scope.
 */
async function resolveAccessibleRecordings(
  scope: ErrorReadScope,
  srIds: string[],
  clientIds: string[],
): Promise<{ byId: Set<string>; byClientId: Map<string, string> }> {
  const byId = new Set<string>();
  const byClientId = new Map<string, string>();
  if (!srIds.length && !clientIds.length) return { byId, byClientId };
  const db = getDb() as any;
  const idClauses: any[] = [];
  if (srIds.length) idClauses.push(inArray(schema.sessionRecordings.id, srIds));
  if (clientIds.length) {
    idClauses.push(
      inArray(schema.sessionRecordings.clientRecordingId, clientIds),
    );
  }
  const rows = await db
    .select({
      id: schema.sessionRecordings.id,
      clientRecordingId: schema.sessionRecordings.clientRecordingId,
    })
    .from(schema.sessionRecordings)
    .where(
      and(
        accessFilter(
          schema.sessionRecordings,
          schema.sessionRecordingShares,
          accessCtx(scope),
        ),
        or(...idClauses),
      ),
    )
    .limit(200);
  for (const row of rows) {
    byId.add(row.id);
    if (row.clientRecordingId) byClientId.set(row.clientRecordingId, row.id);
  }
  return { byId, byClientId };
}

export async function getErrorIssue(
  scope: ErrorReadScope,
  issueId: string,
  options: { eventsLimit?: number } = {},
): Promise<ErrorIssueDetail> {
  const demoModeEnabled = isErrorDemoModeEnabled(scope.userEmail);
  const db = getDb() as any;
  const [issueRow] = await db
    .select()
    .from(schema.errorIssues)
    .where(and(eq(schema.errorIssues.id, issueId), issuesAccessFilter(scope)))
    .limit(1);
  if (!issueRow) {
    throw Object.assign(new Error("Error issue not found"), {
      statusCode: 404,
    });
  }

  const eventsLimit = Math.min(
    200,
    Math.max(1, options.eventsLimit ?? DEFAULT_EVENTS_PER_ISSUE_READ),
  );
  const eventRows = await db
    .select()
    .from(schema.errorEvents)
    .where(
      and(
        eq(schema.errorEvents.issueId, issueId),
        eq(schema.errorEvents.ownerEmail, issueRow.ownerEmail),
        issueRow.orgId
          ? eq(schema.errorEvents.orgId, issueRow.orgId)
          : isNull(schema.errorEvents.orgId),
      ),
    )
    .orderBy(desc(schema.errorEvents.occurredAt))
    .limit(eventsLimit);

  const srIds = Array.from(
    new Set(
      eventRows
        .map((row: any) => row.sessionRecordingId)
        .filter((value: unknown): value is string => Boolean(value)),
    ),
  ) as string[];
  const clientIds = Array.from(
    new Set(
      eventRows
        .filter((row: any) => !row.sessionRecordingId && row.clientRecordingId)
        .map((row: any) => row.clientRecordingId as string),
    ),
  ) as string[];
  const { byId, byClientId } = await resolveAccessibleRecordings(
    scope,
    srIds,
    clientIds,
  );

  const sessions = new Map<string, { recordingId: string; path: string }>();
  const events = await Promise.all(
    eventRows.map(
      async (row: any, index: number): Promise<ErrorEventDetail> => {
        let recordingId: string | null = null;
        if (row.sessionRecordingId && byId.has(row.sessionRecordingId)) {
          recordingId = row.sessionRecordingId;
        } else if (
          row.clientRecordingId &&
          byClientId.has(row.clientRecordingId)
        ) {
          recordingId = byClientId.get(row.clientRecordingId) ?? null;
        }
        if (recordingId && !sessions.has(recordingId)) {
          sessions.set(recordingId, {
            recordingId,
            path: `/sessions/${recordingId}`,
          });
        }
        return {
          id: row.id,
          type: row.type,
          message: row.message ?? "",
          culprit: row.culprit ?? null,
          level: coerceLevel(row.level),
          stack:
            index === 0
              ? await addSourceContexts(
                  parseJson<ParsedStackFrame[]>(row.stack, []),
                )
              : parseJson<ParsedStackFrame[]>(row.stack, []),
          rawStack: row.rawStack ?? null,
          handled: Boolean(row.handled),
          url: row.url ?? null,
          userId: row.userId ?? null,
          anonymousId: row.anonymousId ?? null,
          userKey: row.userKey ?? null,
          sessionId: row.sessionId ?? null,
          sessionRecordingId: recordingId,
          sessionRecordingPath: recordingPath(recordingId),
          release: row.release ?? null,
          environment: row.environment ?? null,
          tags: parseJson<Record<string, unknown>>(row.tags, {}),
          extra: parseJson<Record<string, unknown>>(row.extra, {}),
          breadcrumbs: parseJson<unknown[]>(row.breadcrumbs, []),
          occurredAt: row.occurredAt,
        };
      },
    ),
  );

  const sparklines = await sparklinesForIssues([issueId]);
  const issue: ErrorIssueSummary = {
    id: issueRow.id,
    fingerprint: issueRow.fingerprint,
    type: issueRow.type,
    title: issueRow.title,
    culprit: issueRow.culprit ?? null,
    level: coerceLevel(issueRow.level),
    status: issueRow.status as IssueStatus,
    firstSeenAt: issueRow.firstSeenAt,
    lastSeenAt: issueRow.lastSeenAt,
    eventCount: Number(issueRow.eventCount ?? 0),
    usersAffected: Number(issueRow.usersAffected ?? 0),
    lastSessionRecordingId: issueRow.lastSessionRecordingId ?? null,
    lastSessionRecordingPath: recordingPath(
      issueRow.lastSessionRecordingId ?? null,
    ),
    assignee: issueRow.assignee ?? null,
    app: issueRow.app ?? null,
    template: issueRow.template ?? null,
    sparkline: sparklines.get(issueId) ?? new Array(SPARKLINE_DAYS).fill(0),
  };

  return anonymizeErrorReportingEmailsInDemoMode(
    {
      issue,
      events,
      sessions: Array.from(sessions.values()),
    },
    await demoModeEnabled,
  );
}

export interface UpdateErrorIssueInput {
  status?: IssueStatus;
  assignee?: string | null;
}

export async function updateErrorIssue(
  scope: ErrorReadScope,
  issueId: string,
  patch: UpdateErrorIssueInput,
): Promise<{ id: string; status: IssueStatus; assignee: string | null }> {
  const db = getDb() as any;
  const set: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.status) set.status = patch.status;
  if (patch.assignee !== undefined) set.assignee = patch.assignee;

  const updated = await db
    .update(schema.errorIssues)
    .set(set)
    .where(
      and(
        eq(schema.errorIssues.id, issueId),
        issuesAccessFilter(scope, "editor"),
      ),
    )
    .returning({
      id: schema.errorIssues.id,
      status: schema.errorIssues.status,
      assignee: schema.errorIssues.assignee,
      ownerEmail: schema.errorIssues.ownerEmail,
      orgId: schema.errorIssues.orgId,
      visibility: schema.errorIssues.visibility,
    });
  if (!updated.length) {
    throw Object.assign(new Error("Error issue not found or not editable"), {
      statusCode: 404,
    });
  }
  const row = updated[0];
  recordChange({
    source: "error-issues",
    type: "change",
    key: issueId,
    ...(row.visibility === "org" && row.orgId
      ? { orgId: row.orgId }
      : { owner: row.ownerEmail }),
  });
  return {
    id: row.id,
    status: row.status as IssueStatus,
    assignee: row.assignee ?? null,
  };
}

// ---------------------------------------------------------------------------
// Test helper (drives the pipeline end-to-end without the browser SDK)
// ---------------------------------------------------------------------------

export async function captureTestError(
  scope: ErrorReadScope,
  input: { message?: string; type?: string } = {},
): Promise<IngestExceptionResult> {
  const type = input.type || "Error";
  const message =
    input.message || "Test error from the analytics Error capture pipeline";
  const rawStack = [
    `${type}: ${message}`,
    "    at triggerTestError (app/pages/monitoring/errors/test.ts:12:9)",
    "    at onClick (app/pages/monitoring/ErrorsPanel.tsx:42:5)",
  ].join("\n");
  return ingestException(
    { ownerEmail: scope.userEmail, orgId: scope.orgId },
    {
      type,
      message,
      rawStack,
      handled: true,
      level: "error",
      release: null,
      environment: "test",
      clientRecordingId: null,
      tags: { source: "capture-test-error" },
      extra: {},
      breadcrumbs: [
        {
          timestamp: nowIso(),
          category: "test",
          message: "Generated a sample error to verify the pipeline",
        },
      ],
    },
    {
      app: null,
      template: null,
      url: null,
      userId: scope.userEmail,
      anonymousId: null,
      userKey: scope.userEmail,
      sessionId: null,
      timestamp: nowIso(),
    },
  );
}
