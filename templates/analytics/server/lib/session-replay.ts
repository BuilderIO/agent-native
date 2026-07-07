import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { recordChange, runWithRequestContext } from "@agent-native/core/server";
import {
  accessFilter,
  resolveAccess,
  roleSatisfies,
  type ShareRole,
} from "@agent-native/core/sharing";
import { and, asc, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
  isFailedSessionReplayNetworkStatus,
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
} from "../../shared/session-replay-diagnostics.js";
import { getDb, schema } from "../db/index.js";
import { resolveAnalyticsEventDimensions } from "./first-party-analytics.js";

export type ReplayRange = "24h" | "7d" | "30d" | "90d" | "all";

export interface ReplayScope {
  userEmail: string;
  orgId: string | null;
}

function rangeStartIso(range: ReplayRange): string | null {
  if (range === "all") return null;
  const hours =
    range === "24h"
      ? 24
      : range === "7d"
        ? 24 * 7
        : range === "30d"
          ? 24 * 30
          : 24 * 90;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function replayRangeToIso(range: ReplayRange): string | null {
  return rangeStartIso(range);
}

export type SessionReplayScope = ReplayScope;
export type SessionReplayAccessRole = "owner" | ShareRole;

export interface SessionReplayListFilters {
  query?: string;
  app?: string;
  template?: string;
  sessionId?: string;
  userId?: string;
  anonymousId?: string;
  path?: string;
  from?: string;
  to?: string;
  minDurationMs?: number;
  hasErrors?: boolean;
  hasRageClicks?: boolean;
  status?: "active" | "completed";
  limit?: number;
}

export interface SessionReplayEventReadOptions {
  startSeq?: number;
  endSeq?: number;
  limit?: number;
}

export interface NormalizedSessionReplayChunk {
  seq: number;
  checksum: string;
  byteLength: number;
  eventCount: number;
  startedAt: string | null;
  endedAt: string | null;
  storageKind: "inline" | "blob";
  storageRef: string | null;
  inlineData: string | null;
}

export interface ParsedSessionReplayIngest {
  publicKey: string;
  clientRecordingId: string;
  sessionId: string;
  userId: string | null;
  anonymousId: string | null;
  userKey: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  url: string | null;
  path: string | null;
  hostname: string | null;
  referrer: string | null;
  app: string | null;
  template: string | null;
  pageCount: number;
  errorCount: number;
  networkErrorCount: number;
  rageClickCount: number;
  privacyMode: string;
  status: "active" | "completed";
  metadata: Record<string, unknown>;
  chunks: NormalizedSessionReplayChunk[];
}

export interface SessionRecordingSummary {
  id: string;
  clientRecordingId: string;
  sessionId: string;
  userId: string | null;
  anonymousId: string | null;
  userKey: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  chunkCount: number;
  eventCount: number;
  totalBytes: number;
  pageCount: number;
  errorCount: number;
  networkErrorCount: number;
  rageClickCount: number;
  privacyMode: string;
  firstUrl: string | null;
  lastUrl: string | null;
  path: string | null;
  hostname: string | null;
  referrer: string | null;
  app: string | null;
  template: string | null;
  status: "active" | "completed";
  metadata: Record<string, unknown>;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
  lastIngestedAt: string | null;
  role?: SessionReplayAccessRole;
  canEdit?: boolean;
  canManage?: boolean;
}

export interface AgentSessionRecordingSummary {
  id: string;
  clientRecordingId: string;
  sessionId: string;
  userId: string | null;
  anonymousId: string | null;
  userKey: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  chunkCount: number;
  eventCount: number;
  totalBytes: number;
  pageCount: number;
  errorCount: number;
  networkErrorCount: number;
  rageClickCount: number;
  privacyMode: string;
  firstUrl: string | null;
  lastUrl: string | null;
  path: string | null;
  hostname: string | null;
  referrer: string | null;
  app: string | null;
  template: string | null;
  status: "active" | "completed";
  createdAt: string;
  updatedAt: string;
  lastIngestedAt: string | null;
}

export function compactSessionRecordingSummary(
  recording: SessionRecordingSummary,
): AgentSessionRecordingSummary {
  return {
    id: recording.id,
    clientRecordingId: recording.clientRecordingId,
    sessionId: recording.sessionId,
    userId: recording.userId,
    anonymousId: recording.anonymousId,
    userKey: recording.userKey,
    startedAt: recording.startedAt,
    endedAt: recording.endedAt,
    durationMs: recording.durationMs,
    chunkCount: recording.chunkCount,
    eventCount: recording.eventCount,
    totalBytes: recording.totalBytes,
    pageCount: recording.pageCount,
    errorCount: recording.errorCount,
    networkErrorCount: recording.networkErrorCount,
    rageClickCount: recording.rageClickCount,
    privacyMode: recording.privacyMode,
    firstUrl: recording.firstUrl,
    lastUrl: recording.lastUrl,
    path: recording.path,
    hostname: recording.hostname,
    referrer: recording.referrer,
    app: recording.app,
    template: recording.template,
    status: recording.status,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    lastIngestedAt: recording.lastIngestedAt,
  };
}

const MAX_REPLAY_CHUNKS_PER_REQUEST = 20;
const MAX_REPLAY_CHUNKS_PER_RECORDING = 2_000;
const MAX_INLINE_REPLAY_CHUNK_BYTES = 256 * 1024;
const MAX_BLOB_REPLAY_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_REPLAY_BLOB_REF_LENGTH = 16 * 1024;
const MAX_REPLAY_METADATA_BYTES = 16 * 1024;
const MAX_REPLAY_EVENTS_PER_CHUNK = 1_000;
const DEFAULT_REPLAY_EVENTS_READ = 10_000;
const MAX_REPLAY_EVENTS_READ = 100_000;
const MAX_REPLAY_EVENTS_RESPONSE_BYTES =
  MAX_BLOB_REPLAY_CHUNK_BYTES + 512 * 1024;
const DEFAULT_SESSION_RECORDINGS_LIMIT = 50;
const MAX_SESSION_RECORDINGS_LIMIT = 100;
const DEFAULT_REPLAY_RETENTION_DAYS = 30;
const DEFAULT_ABANDONED_REPLAY_MINUTES = 30;
const DEFAULT_REPLAY_MAX_BYTES_PER_DAY = 100 * 1024 * 1024;
const DEFAULT_REPLAY_MAX_REQUESTS_PER_MINUTE = 120;
const RETENTION_DELETE_BATCH_SIZE = 500;
const REPLAY_PRIVATE_BLOB_REF_KIND = "agent-native.session-replay.private-blob";
const REPLAY_PRIVATE_BLOB_REF_VERSION = 1;
let inlineReplayFallbackWarned = false;

function replayError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function replayNowIso(): string {
  return new Date().toISOString();
}

function replayId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function replaySha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function replayRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function replayString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function replayEmail(value: unknown): string | null {
  const raw = replayString(value);
  return raw && raw.includes("@") ? raw : null;
}

function replayInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }
  return null;
}

function normalizeReplayOrigin(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseAllowedReplayOrigins(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeReplayOrigin(replayString(item)))
      .filter((item): item is string => Boolean(item));
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return parseAllowedReplayOrigins(JSON.parse(value));
  } catch {
    return value
      .split(/[\n,]/)
      .map((item) => normalizeReplayOrigin(item.trim()))
      .filter((item): item is string => Boolean(item));
  }
}

function positiveReplayLimit(value: unknown, fallback: number): number {
  const parsed = replayInteger(value);
  return parsed && parsed > 0 ? parsed : fallback;
}

function replayIngestByteLength(
  input: ParsedSessionReplayIngest,
  context: SessionReplayIngestContext,
): number {
  const requestBytes = Number(context.requestBytes ?? 0);
  if (Number.isFinite(requestBytes) && requestBytes > 0) {
    return Math.ceil(requestBytes);
  }
  return input.chunks.reduce(
    (sum, chunk) => sum + Math.max(0, Number(chunk.byteLength ?? 0)),
    0,
  );
}

function replayTimestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function replayMinIso(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  if (!present.length) return null;
  return present.reduce((min, value) => (value < min ? value : min));
}

function replayMaxIso(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  if (!present.length) return null;
  return present.reduce((max, value) => (value > max ? value : max));
}

function replayClampIso(
  value: string | null | undefined,
  latestIso: string,
): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  const latest = Date.parse(latestIso);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isFinite(latest)) return value;
  return parsed > latest ? latestIso : value;
}

function clampReplayChunkTiming(
  chunk: NormalizedSessionReplayChunk,
  latestIso: string,
): NormalizedSessionReplayChunk {
  const startedAt = replayClampIso(chunk.startedAt, latestIso);
  let endedAt = replayClampIso(chunk.endedAt, latestIso);
  if (startedAt && endedAt && endedAt < startedAt) {
    endedAt = startedAt;
  }
  return { ...chunk, startedAt, endedAt };
}

function clampReplayIngestTiming(
  input: ParsedSessionReplayIngest,
  latestIso: string,
): ParsedSessionReplayIngest {
  const chunks = input.chunks.map((chunk) =>
    clampReplayChunkTiming(chunk, latestIso),
  );
  const startedAt =
    replayMinIso([
      replayClampIso(input.startedAt, latestIso),
      ...chunks.map((chunk) => chunk.startedAt),
    ]) ?? latestIso;
  let endedAt = replayMaxIso([
    replayClampIso(input.endedAt, latestIso),
    ...chunks.map((chunk) => chunk.endedAt),
  ]);
  if (endedAt && endedAt < startedAt) endedAt = startedAt;
  const durationMs = endedAt
    ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
    : input.durationMs;
  return { ...input, startedAt, endedAt, durationMs, chunks };
}

function normalizeReplayUrl(url: string | null): {
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

function assertReplayMetadataCap(value: Record<string, unknown>): void {
  if (
    Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_REPLAY_METADATA_BYTES
  ) {
    throw replayError(
      `Replay metadata must be ${MAX_REPLAY_METADATA_BYTES} bytes or smaller`,
      413,
    );
  }
}

function normalizeReplayInlineData(raw: Record<string, unknown>): {
  inlineData: string | null;
  eventCount: number | null;
} {
  if (Array.isArray(raw.events)) {
    if (raw.events.length > MAX_REPLAY_EVENTS_PER_CHUNK) {
      throw replayError(
        `Replay chunks may contain at most ${MAX_REPLAY_EVENTS_PER_CHUNK} events`,
        413,
      );
    }
    return {
      inlineData: JSON.stringify(raw.events),
      eventCount: raw.events.length,
    };
  }
  if (raw.data !== undefined) {
    return {
      inlineData:
        typeof raw.data === "string" ? raw.data : JSON.stringify(raw.data),
      eventCount: null,
    };
  }
  if (raw.payload !== undefined) {
    return { inlineData: JSON.stringify(raw.payload), eventCount: null };
  }
  return { inlineData: null, eventCount: null };
}

function inferReplayEventCount(inlineData: string | null): number | null {
  if (!inlineData) return null;
  try {
    const parsed = JSON.parse(inlineData);
    if (Array.isArray(parsed)) return parsed.length;
    if (Array.isArray(parsed?.events)) return parsed.events.length;
  } catch {
    return null;
  }
  return null;
}

function inferReplayEventTimes(inlineData: string | null): {
  startedAt: string | null;
  endedAt: string | null;
} {
  if (!inlineData) return { startedAt: null, endedAt: null };
  try {
    const parsed = JSON.parse(inlineData);
    const events = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.events)
        ? parsed.events
        : [];
    const timestamps = events
      .map((event: unknown) => replayTimestamp(replayRecord(event).timestamp))
      .filter((value: string | null): value is string => Boolean(value));
    return {
      startedAt: replayMinIso(timestamps),
      endedAt: replayMaxIso(timestamps),
    };
  } catch {
    return { startedAt: null, endedAt: null };
  }
}

function normalizeReplayBlobRef(value: unknown): string | null {
  const ref = replayString(value);
  if (!ref) return null;
  if (ref.length > MAX_REPLAY_BLOB_REF_LENGTH) {
    throw replayError(
      `Replay blob references must be ${MAX_REPLAY_BLOB_REF_LENGTH} characters or shorter`,
      413,
    );
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
    throw replayError(
      "Replay blob references must be private storage refs, not provider URLs",
      400,
    );
  }
  return ref;
}

interface StoredReplayBlobRef {
  kind: typeof REPLAY_PRIVATE_BLOB_REF_KIND;
  version: typeof REPLAY_PRIVATE_BLOB_REF_VERSION;
  compression: "gzip";
  handle: PrivateBlobHandle;
}

function encodeReplayBlobRef(handle: PrivateBlobHandle): string {
  return JSON.stringify({
    kind: REPLAY_PRIVATE_BLOB_REF_KIND,
    version: REPLAY_PRIVATE_BLOB_REF_VERSION,
    compression: "gzip",
    handle,
  } satisfies StoredReplayBlobRef);
}

function decodeReplayBlobRef(value: string | null): StoredReplayBlobRef | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredReplayBlobRef;
    if (
      parsed?.kind !== REPLAY_PRIVATE_BLOB_REF_KIND ||
      parsed.version !== REPLAY_PRIVATE_BLOB_REF_VERSION ||
      parsed.compression !== "gzip" ||
      !parsed.handle?.opaque
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function deleteReplayBlobHandleQuietly(
  handle: PrivateBlobHandle,
): Promise<void> {
  try {
    await deletePrivateBlob(handle);
  } catch {
    // Best-effort rollback cleanup; the original ingest error is more useful.
  }
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function isoBefore(date: Date, milliseconds: number): string {
  return new Date(date.getTime() - milliseconds).toISOString();
}

function replayRetentionDays(): number {
  return parsePositiveIntegerEnv(
    "ANALYTICS_SESSION_REPLAY_RETENTION_DAYS",
    DEFAULT_REPLAY_RETENTION_DAYS,
  );
}

function abandonedReplayMinutes(): number {
  return parsePositiveIntegerEnv(
    "ANALYTICS_SESSION_REPLAY_ABANDONED_MINUTES",
    DEFAULT_ABANDONED_REPLAY_MINUTES,
  );
}

function productionInlineFallbackAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK === "1";
}

function warnInlineReplayFallback(): void {
  if (inlineReplayFallbackWarned) return;
  inlineReplayFallbackWarned = true;
  console.warn(
    "[session-replay] Private blob storage is not configured; storing capped replay chunks inline in SQL. This is intended only for local/dev use.",
  );
}

async function storeReplayChunkBlob(
  chunk: NormalizedSessionReplayChunk,
  options: {
    publicKeyId: string;
    recordingId: string;
    ownerEmail: string;
    orgId: string | null;
  },
): Promise<NormalizedSessionReplayChunk> {
  if (chunk.storageKind === "blob" || !chunk.inlineData) return chunk;

  const gzipBytes = gzipSync(Buffer.from(chunk.inlineData, "utf8"));
  const handle = await putPrivateBlob({
    data: gzipBytes,
    key: `analytics/session-replay/${options.publicKeyId}/${options.recordingId}/${chunk.seq}.json.gz`,
    filename: `${options.recordingId}-${chunk.seq}.json.gz`,
    mimeType: "application/json+gzip",
    ownerEmail: options.ownerEmail,
    metadata: {
      recordingId: options.recordingId,
      seq: chunk.seq,
      checksum: chunk.checksum,
      orgId: options.orgId,
    },
  });
  if (!handle) {
    if (!productionInlineFallbackAllowed()) {
      throw replayError(
        "Session replay blob storage is required in production. Configure a private blob provider or set ANALYTICS_SESSION_REPLAY_SQL_FALLBACK=1 for a capped temporary fallback.",
        503,
      );
    }
    if (chunk.byteLength > MAX_INLINE_REPLAY_CHUNK_BYTES) {
      throw replayError(
        "Session replay chunk is too large for inline SQL fallback. Configure private blob storage for full snapshot playback.",
        503,
      );
    }
    warnInlineReplayFallback();
    return chunk;
  }

  return {
    ...chunk,
    storageKind: "blob",
    storageRef: encodeReplayBlobRef(handle),
    inlineData: null,
  };
}

function normalizeReplayChunk(rawValue: unknown): NormalizedSessionReplayChunk {
  const raw = replayRecord(rawValue);
  const seq = replayInteger(raw.seq ?? raw.sequence ?? raw.index);
  if (seq === null || seq < 0) {
    throw replayError("Each replay chunk requires a non-negative seq", 400);
  }

  const { inlineData, eventCount: inlineEventCount } =
    normalizeReplayInlineData(raw);
  const storageRef = normalizeReplayBlobRef(raw.blobRef ?? raw.storageRef);
  if (inlineData && storageRef) {
    throw replayError(
      "Replay chunks must use either inline data or a private blob ref, not both",
      400,
    );
  }
  if (!inlineData && !storageRef) {
    throw replayError(
      "Each replay chunk requires inline events/data or a private blob ref",
      400,
    );
  }

  const storageKind = storageRef ? "blob" : "inline";
  const byteLength =
    storageKind === "inline"
      ? Buffer.byteLength(inlineData ?? "", "utf8")
      : (replayInteger(raw.byteLength ?? raw.bytes) ?? 0);
  const maxBytes = MAX_BLOB_REPLAY_CHUNK_BYTES;
  if (byteLength <= 0 || byteLength > maxBytes) {
    throw replayError(
      `Replay ${storageKind} chunks must be between 1 and ${maxBytes} bytes`,
      413,
    );
  }

  const eventCount =
    replayInteger(raw.eventCount) ??
    inlineEventCount ??
    inferReplayEventCount(inlineData) ??
    0;
  if (eventCount < 0 || eventCount > MAX_REPLAY_EVENTS_PER_CHUNK) {
    throw replayError(
      `Replay chunks may contain at most ${MAX_REPLAY_EVENTS_PER_CHUNK} events`,
      413,
    );
  }

  const checksum =
    replayString(raw.checksum) ??
    (inlineData ? replaySha256(inlineData) : null);
  if (!checksum || checksum.length > 128) {
    throw replayError("Each replay chunk requires a valid checksum", 400);
  }
  const inferredTimes = inferReplayEventTimes(inlineData);

  return {
    seq,
    checksum,
    byteLength,
    eventCount,
    startedAt:
      replayTimestamp(raw.startedAt ?? raw.startTime ?? raw.start) ??
      inferredTimes.startedAt,
    endedAt:
      replayTimestamp(raw.endedAt ?? raw.endTime ?? raw.end) ??
      inferredTimes.endedAt,
    storageKind,
    storageRef,
    inlineData,
  };
}

function extractReplayChunks(body: Record<string, unknown>): unknown[] {
  if (Array.isArray(body.chunks)) return body.chunks;
  if (body.chunk !== undefined) return [body.chunk];
  if (
    body.seq !== undefined ||
    body.events !== undefined ||
    body.data !== undefined
  ) {
    return [body];
  }
  return [];
}

function numberFrom(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = replayInteger(value);
    if (parsed !== null && parsed >= 0) return parsed;
  }
  return null;
}

function inlineEventsForSignals(
  chunks: NormalizedSessionReplayChunk[],
): unknown[] {
  const events: unknown[] = [];
  for (const chunk of chunks) {
    if (!chunk.inlineData) continue;
    events.push(...parseInlineReplayEvents(chunk.inlineData));
    if (events.length >= 5_000) return events.slice(0, 5_000);
  }
  return events;
}

function replayDiagnosticsTag(event: unknown): {
  tag: string;
  payload: Record<string, unknown>;
} | null {
  const record = replayRecord(event);
  if (replayInteger(record.type) !== 5) return null;
  const data = replayRecord(record.data);
  const tag = replayString(data.tag);
  if (
    tag !== SESSION_REPLAY_CONSOLE_EVENT_TAG &&
    tag !== SESSION_REPLAY_NETWORK_EVENT_TAG
  ) {
    return null;
  }
  return { tag, payload: replayRecord(data.payload) };
}

function replayConsoleRepeat(payload: Record<string, unknown>): number {
  const repeat = replayInteger(payload.repeat);
  return repeat !== null && repeat > 0 ? repeat : 1;
}

function deriveReplaySignals({
  body,
  metadata,
  chunks,
  url,
}: {
  body: Record<string, unknown>;
  metadata: Record<string, unknown>;
  chunks: NormalizedSessionReplayChunk[];
  url: string | null;
}): {
  pageCount: number;
  errorCount: number;
  networkErrorCount: number;
  rageClickCount: number;
  privacyMode: string;
} {
  const events = inlineEventsForSignals(chunks);
  const pages = new Set<string>();
  if (url) pages.add(url);
  let heuristicErrors = 0;
  let taggedConsoleErrors = 0;
  let taggedNetworkErrors = 0;
  let hasTaggedDiagnostics = false;

  for (const event of events) {
    const record = replayRecord(event);
    const data = replayRecord(record.data);
    const href = replayString(data.href ?? data.url);
    if (href) pages.add(href);

    const tagged = replayDiagnosticsTag(event);
    if (tagged) {
      // Tagged diagnostics are the real signal; never let the substring
      // heuristic below double-count these same events.
      hasTaggedDiagnostics = true;
      if (tagged.tag === SESSION_REPLAY_CONSOLE_EVENT_TAG) {
        if (replayString(tagged.payload.level) === "error") {
          taggedConsoleErrors += replayConsoleRepeat(tagged.payload);
        }
      } else {
        const status = replayInteger(tagged.payload.status);
        if (status !== null && isFailedSessionReplayNetworkStatus(status)) {
          taggedNetworkErrors += 1;
        }
      }
      continue;
    }

    const source = `${replayString(record.type) ?? ""} ${
      replayString(data.type) ?? ""
    } ${replayString(data.message) ?? ""}`.toLowerCase();
    if (
      source.includes("error") ||
      source.includes("exception") ||
      source.includes("unhandledrejection")
    ) {
      heuristicErrors += 1;
    }
  }

  // The substring heuristic predates tagged console/network capture. Once any
  // tagged diagnostics event is present the recorder is diagnostics-aware, so
  // the tagged counts are authoritative and the heuristic stays off.
  const detectedErrors = hasTaggedDiagnostics
    ? taggedConsoleErrors
    : heuristicErrors;

  return {
    pageCount:
      numberFrom(body.pageCount, body.page_count, metadata.pageCount) ??
      pages.size,
    errorCount:
      numberFrom(body.errorCount, body.error_count, metadata.errorCount) ??
      detectedErrors,
    networkErrorCount:
      numberFrom(
        body.networkErrorCount,
        body.network_error_count,
        metadata.networkErrorCount,
      ) ?? taggedNetworkErrors,
    rageClickCount:
      numberFrom(
        body.rageClickCount,
        body.rage_click_count,
        body.rageClicks,
        metadata.rageClickCount,
        metadata.rageClicks,
      ) ?? 0,
    privacyMode:
      replayString(body.privacyMode) ||
      replayString(body.privacy_mode) ||
      replayString(metadata.privacyMode) ||
      "unknown",
  };
}

export function parseSessionReplayIngestPayload(
  raw: unknown,
): ParsedSessionReplayIngest {
  const body =
    typeof raw === "string" && raw.trim() ? JSON.parse(raw) : replayRecord(raw);
  const publicKey =
    replayString(body.publicKey) ||
    replayString(body.writeKey) ||
    replayString(body.apiKey);
  if (!publicKey) throw replayError("Missing publicKey", 400);

  const rawChunks = extractReplayChunks(body);
  if (!rawChunks.length) throw replayError("No replay chunks provided", 400);
  if (rawChunks.length > MAX_REPLAY_CHUNKS_PER_REQUEST) {
    throw replayError(
      `At most ${MAX_REPLAY_CHUNKS_PER_REQUEST} replay chunks are accepted per request`,
      413,
    );
  }
  const chunks = rawChunks.map(normalizeReplayChunk);

  const sessionId =
    replayString(body.sessionId) ||
    replayString(body.session_id) ||
    replayString(replayRecord(body.session).id);
  if (!sessionId) throw replayError("Replay payload requires sessionId", 400);

  const clientRecordingId =
    replayString(body.recordingId) ||
    replayString(body.recording_id) ||
    replayString(body.replayId) ||
    sessionId;
  const metadata = replayRecord(body.metadata);
  assertReplayMetadataCap(metadata);

  const directApp = replayString(body.app);
  const directTemplate = replayString(body.template);
  const properties: Record<string, unknown> = {
    ...replayRecord(body.properties),
    ...(directApp ? { app: directApp } : {}),
    ...(directTemplate ? { template: directTemplate } : {}),
  };
  const context: Record<string, unknown> = replayRecord(body.context);
  const url =
    replayString(body.url) ||
    replayString(properties.url) ||
    replayString(context.url);
  const parts = normalizeReplayUrl(url);
  const signals = deriveReplaySignals({
    body,
    metadata,
    chunks,
    url: parts.url,
  });
  const hostname =
    parts.hostname ||
    replayString(body.hostname) ||
    replayString(properties.hostname) ||
    replayString(context.hostname);
  const { app, template } = resolveAnalyticsEventDimensions({
    properties,
    context,
    hostname,
  });
  const startedAt =
    replayTimestamp(body.startedAt ?? body.startTime ?? body.timestamp) ||
    replayMinIso(chunks.map((chunk) => chunk.startedAt)) ||
    replayNowIso();
  const endedAt =
    replayTimestamp(body.endedAt ?? body.endTime) ||
    replayMaxIso(chunks.map((chunk) => chunk.endedAt));
  const computedDuration = endedAt
    ? Date.parse(endedAt) - Date.parse(startedAt)
    : null;
  const durationMs =
    replayInteger(body.durationMs ?? body.duration_ms) ?? computedDuration;
  const status =
    body.status === "completed" || body.completed === true || endedAt
      ? "completed"
      : "active";
  const userEmail =
    replayEmail(body.userEmail ?? body.user_email) ||
    replayEmail(properties.userEmail ?? properties.user_email) ||
    replayEmail(properties.email) ||
    replayEmail(context.userEmail ?? context.user_email) ||
    replayEmail(body.userId ?? body.user_id);
  const userId =
    userEmail ||
    replayString(body.userId ?? body.user_id) ||
    replayString(properties.userId ?? properties.user_id) ||
    replayString(context.userId ?? context.user_id);
  const anonymousId = replayString(body.anonymousId ?? body.anonymous_id);

  return {
    publicKey,
    clientRecordingId,
    sessionId,
    userId,
    anonymousId,
    userKey: userEmail || userId || anonymousId,
    startedAt,
    endedAt,
    durationMs:
      typeof durationMs === "number" && Number.isFinite(durationMs)
        ? Math.max(0, durationMs)
        : null,
    url: parts.url,
    path:
      parts.path || replayString(body.path) || replayString(properties.path),
    hostname,
    referrer:
      replayString(body.referrer) ||
      replayString(properties.referrer) ||
      replayString(context.referrer),
    app,
    template,
    pageCount: signals.pageCount,
    errorCount: signals.errorCount,
    networkErrorCount: signals.networkErrorCount,
    rageClickCount: signals.rageClickCount,
    privacyMode: signals.privacyMode,
    status,
    metadata,
    chunks,
  };
}

export interface SessionReplayIngestContext {
  origin?: string | null;
  requestBytes?: number | null;
  now?: Date;
}

export async function assertReplayKeyBudget(
  key: {
    id: string;
    replayAllowedOrigins?: string | null;
    replayMaxBytesPerDay?: number | null;
    replayMaxRequestsPerMinute?: number | null;
  },
  context: SessionReplayIngestContext,
): Promise<void> {
  const origin = normalizeReplayOrigin(context.origin);
  const allowedOrigins = parseAllowedReplayOrigins(key.replayAllowedOrigins);
  if (allowedOrigins.length > 0 && !origin) {
    throw replayError(
      "Origin is required for replay ingestion with this analytics public key",
      403,
    );
  }
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin ?? "")) {
    throw replayError(
      "Origin is not allowed for this analytics public key",
      403,
    );
  }

  const requestBytes = Math.max(0, context.requestBytes ?? 0);
  const maxBytesPerDay = positiveReplayLimit(
    key.replayMaxBytesPerDay,
    DEFAULT_REPLAY_MAX_BYTES_PER_DAY,
  );
  if (requestBytes > maxBytesPerDay) {
    throw replayError(
      "Replay ingest request exceeds this key's byte limit",
      413,
    );
  }

  const maxRequestsPerMinute = positiveReplayLimit(
    key.replayMaxRequestsPerMinute,
    DEFAULT_REPLAY_MAX_REQUESTS_PER_MINUTE,
  );
  const now = context.now ?? new Date();
  const sinceDay = isoBefore(now, 24 * 60 * 60_000);
  const sinceMinute = isoBefore(now, 60_000);
  const db = getDb() as any;
  // guard:allow-unscoped — ingest quotas are scoped by the resolved analytics public key and use append-only ingest usage rows.
  const [dailyUsage] = await db
    .select({
      bytes: sql<number>`COALESCE(SUM(${schema.sessionReplayIngests.byteLength}), 0)`,
    })
    .from(schema.sessionReplayIngests)
    .where(
      and(
        eq(schema.sessionReplayIngests.publicKeyId, key.id),
        gte(schema.sessionReplayIngests.createdAt, sinceDay),
      ),
    );

  const bytesToday = Number(dailyUsage?.bytes ?? 0);
  if (bytesToday + requestBytes > maxBytesPerDay) {
    throw replayError(
      "Replay ingest byte quota exceeded for this public key",
      429,
    );
  }

  // guard:allow-unscoped — ingest quotas are scoped by the resolved analytics public key and use append-only ingest usage rows.
  const [minuteUsage] = await db
    .select({
      requests: sql<number>`COUNT(*)`,
    })
    .from(schema.sessionReplayIngests)
    .where(
      and(
        eq(schema.sessionReplayIngests.publicKeyId, key.id),
        gte(schema.sessionReplayIngests.createdAt, sinceMinute),
      ),
    );

  const recentRequests = Number(minuteUsage?.requests ?? 0);
  if (recentRequests >= maxRequestsPerMinute) {
    throw replayError(
      "Replay ingest rate limit exceeded for this public key",
      429,
    );
  }
}

async function resolveReplayPublicKey(
  publicKey: string,
  context: SessionReplayIngestContext = {},
): Promise<{
  id: string;
  ownerEmail: string;
  orgId: string | null;
}> {
  const db = getDb() as any;
  // guard:allow-unscoped -- public replay ingestion must resolve the owning tenant from the submitted write key before it can scope inserts.
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
  if (!key) throw replayError("Invalid analytics public key", 401);
  await assertReplayKeyBudget(key, context);
  return {
    id: key.id,
    ownerEmail: key.ownerEmail,
    orgId: key.orgId ?? null,
  };
}

function parseRecordingMetadata(row: any): Record<string, unknown> {
  try {
    return replayRecord(JSON.parse(row.metadata ?? "{}"));
  } catch {
    return {};
  }
}

function rowToSessionRecordingSummary(
  row: any,
  role?: SessionReplayAccessRole,
): SessionRecordingSummary {
  return {
    id: row.id,
    clientRecordingId: row.clientRecordingId,
    sessionId: row.sessionId,
    userId: row.userId ?? null,
    anonymousId: row.anonymousId ?? null,
    userKey: row.userKey ?? null,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
    durationMs: row.durationMs ?? null,
    chunkCount: row.chunkCount ?? 0,
    eventCount: row.eventCount ?? 0,
    totalBytes: row.totalBytes ?? 0,
    pageCount: row.pageCount ?? 0,
    errorCount: row.errorCount ?? 0,
    networkErrorCount: row.networkErrorCount ?? 0,
    rageClickCount: row.rageClickCount ?? 0,
    privacyMode: row.privacyMode ?? "unknown",
    firstUrl: row.firstUrl ?? null,
    lastUrl: row.lastUrl ?? null,
    path: row.path ?? null,
    hostname: row.hostname ?? null,
    referrer: row.referrer ?? null,
    app: row.app ?? null,
    template: row.template ?? null,
    status: row.status === "completed" ? "completed" : "active",
    metadata: parseRecordingMetadata(row),
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastIngestedAt: row.lastIngestedAt ?? null,
    ...(role
      ? {
          role,
          canEdit: roleSatisfies(role, "editor"),
          canManage: roleSatisfies(role, "admin"),
        }
      : {}),
  };
}

function hasVisibleSessionRecordingIdentity(row: any): boolean {
  // /sessions intentionally lists signed-in, email-backed recordings only (see
  // analytics CLAUDE.md + the "rejects anonymous recordings" spec). Keep this in
  // sync with replayVisibleIdentityCondition().
  return Boolean(replayEmail(row.userId) || replayEmail(row.userKey));
}

function hasPlayableSessionRecordingEvents(row: any): boolean {
  return Number(row.chunkCount ?? 0) > 0 && Number(row.eventCount ?? 0) > 0;
}

function isVisibleSessionRecording(row: any): boolean {
  return (
    hasVisibleSessionRecordingIdentity(row) &&
    hasPlayableSessionRecordingEvents(row)
  );
}

function mergeReplayMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing, ...incoming };
  assertReplayMetadataCap(merged);
  return merged;
}

function replayRecordingChangeScope(row: {
  ownerEmail: string;
  orgId: string | null;
  visibility: string;
}): { owner?: string; orgId?: string } {
  if (row.visibility === "org" && row.orgId) return { orgId: row.orgId };
  return { owner: row.ownerEmail };
}

async function deleteEmptyReplayRecordingPlaceholder(
  db: any,
  recording: { id: string; ownerEmail: string; orgId: string | null },
): Promise<void> {
  await db.delete(schema.sessionRecordings).where(
    and(
      eq(schema.sessionRecordings.id, recording.id),
      eq(schema.sessionRecordings.ownerEmail, recording.ownerEmail),
      recording.orgId
        ? eq(schema.sessionRecordings.orgId, recording.orgId)
        : isNull(schema.sessionRecordings.orgId),
      eq(schema.sessionRecordings.chunkCount, 0),
      eq(schema.sessionRecordings.eventCount, 0),
      sql`not exists (
          select 1 from ${schema.sessionReplayChunks}
          where ${schema.sessionReplayChunks.recordingId} = ${schema.sessionRecordings.id}
        )`,
    ),
  );
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function replayTextContains(column: unknown, query: string) {
  return sql`lower(coalesce(${column}, '')) like ${`%${escapeSqlLike(query.toLowerCase())}%`} escape '\\'`;
}

function replayVisibleIdentityCondition() {
  // Email-backed identity only — /sessions lists signed-in recordings (see
  // analytics CLAUDE.md). Mirror of hasVisibleSessionRecordingIdentity().
  return or(
    replayTextContains(schema.sessionRecordings.userId, "@"),
    replayTextContains(schema.sessionRecordings.userKey, "@"),
  );
}

function replayPlayableEventsCondition() {
  return and(
    gte(schema.sessionRecordings.chunkCount, 1),
    gte(schema.sessionRecordings.eventCount, 1),
  );
}

function replayListSearchCondition(query: string | undefined) {
  const q = query?.trim();
  if (!q) return null;
  return or(
    replayTextContains(schema.sessionRecordings.id, q),
    replayTextContains(schema.sessionRecordings.sessionId, q),
    replayTextContains(schema.sessionRecordings.clientRecordingId, q),
    replayTextContains(schema.sessionRecordings.userId, q),
    replayTextContains(schema.sessionRecordings.userKey, q),
    replayTextContains(schema.sessionRecordings.anonymousId, q),
    replayTextContains(schema.sessionRecordings.app, q),
    replayTextContains(schema.sessionRecordings.template, q),
    replayTextContains(schema.sessionRecordings.path, q),
    replayTextContains(schema.sessionRecordings.firstUrl, q),
    replayTextContains(schema.sessionRecordings.lastUrl, q),
    replayTextContains(schema.sessionRecordings.hostname, q),
  );
}

export async function recordSessionReplayChunks(
  input: ParsedSessionReplayIngest,
  context: SessionReplayIngestContext = {},
): Promise<{
  recordingId: string;
  sessionId: string;
  acceptedChunks: number;
  duplicateChunks: number;
  chunkCount: number;
  eventCount: number;
  totalBytes: number;
}> {
  const key = await resolveReplayPublicKey(input.publicKey, context);
  const db = getDb() as any;
  const ingestedAt = replayTimestamp(context.now) ?? replayNowIso();
  const clampedInput = clampReplayIngestTiming(input, ingestedAt);

  let [recording] = await db
    .select()
    .from(schema.sessionRecordings)
    .where(
      and(
        eq(schema.sessionRecordings.publicKeyId, key.id),
        eq(
          schema.sessionRecordings.clientRecordingId,
          clampedInput.clientRecordingId,
        ),
      ),
    )
    .limit(1);

  if (!recording) {
    const newRecordingId = replayId("sr");
    await db
      .insert(schema.sessionRecordings)
      .values({
        id: newRecordingId,
        publicKeyId: key.id,
        clientRecordingId: clampedInput.clientRecordingId,
        sessionId: clampedInput.sessionId,
        userId: clampedInput.userId,
        anonymousId: clampedInput.anonymousId,
        userKey: clampedInput.userKey,
        startedAt: clampedInput.startedAt,
        endedAt: clampedInput.endedAt,
        durationMs: clampedInput.durationMs,
        pageCount: clampedInput.pageCount,
        errorCount: clampedInput.errorCount,
        networkErrorCount: clampedInput.networkErrorCount,
        rageClickCount: clampedInput.rageClickCount,
        privacyMode: clampedInput.privacyMode,
        firstUrl: clampedInput.url,
        lastUrl: clampedInput.url,
        path: clampedInput.path,
        hostname: clampedInput.hostname,
        referrer: clampedInput.referrer,
        app: clampedInput.app,
        template: clampedInput.template,
        status: clampedInput.status,
        metadata: JSON.stringify(clampedInput.metadata),
        lastIngestedAt: ingestedAt,
        ownerEmail: key.ownerEmail,
        orgId: key.orgId,
        // Session replay is an org-analytics surface: a recording captured under
        // an org-scoped analytics key must be visible to everyone in that org
        // (via accessFilter's "org" branch), not only the key owner. Without an
        // org we fall back to owner-private. This is what makes /sessions show
        // recordings to teammates instead of only the single key owner.
        visibility: key.orgId ? "org" : "private",
      })
      .onConflictDoNothing();

    [recording] = await db
      .select()
      .from(schema.sessionRecordings)
      .where(
        and(
          eq(schema.sessionRecordings.publicKeyId, key.id),
          eq(
            schema.sessionRecordings.clientRecordingId,
            clampedInput.clientRecordingId,
          ),
        ),
      )
      .limit(1);
  }

  if (!recording) throw replayError("Unable to create replay recording", 500);
  if (
    recording.ownerEmail !== key.ownerEmail ||
    (recording.orgId ?? null) !== key.orgId
  ) {
    throw replayError("Replay recording belongs to a different scope", 409);
  }

  const existingChunks = await db
    .select()
    .from(schema.sessionReplayChunks)
    .where(eq(schema.sessionReplayChunks.recordingId, recording.id));
  const existingBySeq = new Map<number, any>(
    existingChunks.map((chunk: any) => [chunk.seq, chunk]),
  );
  const rowsToInsert: any[] = [];
  const uploadedBlobHandles: PrivateBlobHandle[] = [];
  let duplicateChunks = 0;
  const wasEmptyRecording =
    Number(recording.chunkCount ?? 0) === 0 &&
    Number(recording.eventCount ?? 0) === 0 &&
    existingChunks.length === 0;

  try {
    for (const rawChunk of clampedInput.chunks) {
      const existing = existingBySeq.get(rawChunk.seq);
      if (existing) {
        if (existing.checksum !== rawChunk.checksum) {
          throw replayError(
            `Replay chunk ${rawChunk.seq} was already recorded with a different checksum`,
            409,
          );
        }
        duplicateChunks += 1;
        continue;
      }
      if (
        existingChunks.length + rowsToInsert.length >=
        MAX_REPLAY_CHUNKS_PER_RECORDING
      ) {
        throw replayError(
          `Session recordings may contain at most ${MAX_REPLAY_CHUNKS_PER_RECORDING} chunks`,
          413,
        );
      }
      // Replay ingest is anonymous + cross-origin (no session), so blob storage
      // would otherwise have no request context and `resolveBuilderPrivateKey()`
      // (and any S3 provider's scoped-secret lookup) would resolve nothing —
      // every chunk upload then 503s and recordings persist as empty shells.
      // Run the upload in the public key owner's user/org scope so the org's
      // connected Builder (or S3) credential in `app_secrets` resolves. Mirrors
      // the resources upload precedent (core resources/handlers.ts).
      const chunk = await runWithRequestContext(
        { userEmail: key.ownerEmail, orgId: key.orgId ?? undefined },
        () =>
          storeReplayChunkBlob(rawChunk, {
            publicKeyId: key.id,
            recordingId: recording.id,
            ownerEmail: key.ownerEmail,
            orgId: key.orgId,
          }),
      );
      if (rawChunk.storageKind !== "blob" && chunk.storageKind === "blob") {
        const ref = decodeReplayBlobRef(chunk.storageRef);
        if (ref) uploadedBlobHandles.push(ref.handle);
      }
      rowsToInsert.push({
        id: replayId("src"),
        recordingId: recording.id,
        seq: chunk.seq,
        checksum: chunk.checksum,
        byteLength: chunk.byteLength,
        eventCount: chunk.eventCount,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        storageKind: chunk.storageKind,
        storageRef: chunk.storageRef,
        inlineData: chunk.inlineData,
        ownerEmail: key.ownerEmail,
        orgId: key.orgId,
      });
    }

    if (rowsToInsert.length) {
      await db.insert(schema.sessionReplayChunks).values(rowsToInsert);
    }
    uploadedBlobHandles.length = 0;
  } catch (error) {
    await Promise.all(uploadedBlobHandles.map(deleteReplayBlobHandleQuietly));
    if (wasEmptyRecording) {
      await deleteEmptyReplayRecordingPlaceholder(db, {
        id: recording.id,
        ownerEmail: key.ownerEmail,
        orgId: key.orgId,
      });
    }
    throw error;
  }

  await db.insert(schema.sessionReplayIngests).values({
    id: replayId("sri"),
    publicKeyId: key.id,
    recordingId: recording.id,
    byteLength: replayIngestByteLength(clampedInput, context),
    createdAt: ingestedAt,
    ownerEmail: key.ownerEmail,
    orgId: key.orgId,
  });

  const allChunks = [...existingChunks, ...rowsToInsert].map((chunk: any) =>
    clampReplayChunkTiming(chunk, ingestedAt),
  );
  const chunkCount = allChunks.length;
  const eventCount = allChunks.reduce(
    (sum, chunk: any) => sum + Number(chunk.eventCount ?? 0),
    0,
  );
  const totalBytes = allChunks.reduce(
    (sum, chunk: any) => sum + Number(chunk.byteLength ?? 0),
    0,
  );
  const startedAt =
    replayMinIso([
      recording.startedAt,
      clampedInput.startedAt,
      ...allChunks.map((chunk: any) => chunk.startedAt),
    ]) ?? clampedInput.startedAt;
  const endedAt =
    replayMaxIso([
      recording.endedAt,
      clampedInput.endedAt,
      ...allChunks.map((chunk: any) => chunk.endedAt),
    ]) ?? null;
  const durationMs =
    clampedInput.durationMs ??
    (endedAt
      ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
      : (recording.durationMs ?? null));
  const metadata = mergeReplayMetadata(
    parseRecordingMetadata(recording),
    clampedInput.metadata,
  );

  await db
    .update(schema.sessionRecordings)
    .set({
      sessionId: clampedInput.sessionId,
      userId: clampedInput.userId ?? recording.userId ?? null,
      anonymousId: clampedInput.anonymousId ?? recording.anonymousId ?? null,
      userKey: clampedInput.userKey ?? recording.userKey ?? null,
      startedAt,
      endedAt,
      durationMs,
      chunkCount,
      eventCount,
      totalBytes,
      pageCount: Math.max(
        Number(recording.pageCount ?? 0),
        clampedInput.pageCount,
      ),
      errorCount: Math.max(
        Number(recording.errorCount ?? 0),
        clampedInput.errorCount,
      ),
      networkErrorCount: Math.max(
        Number(recording.networkErrorCount ?? 0),
        clampedInput.networkErrorCount,
      ),
      rageClickCount: Math.max(
        Number(recording.rageClickCount ?? 0),
        clampedInput.rageClickCount,
      ),
      privacyMode:
        clampedInput.privacyMode !== "unknown"
          ? clampedInput.privacyMode
          : (recording.privacyMode ?? "unknown"),
      firstUrl: recording.firstUrl ?? clampedInput.url,
      lastUrl: clampedInput.url ?? recording.lastUrl ?? null,
      path: clampedInput.path ?? recording.path ?? null,
      hostname: clampedInput.hostname ?? recording.hostname ?? null,
      referrer: clampedInput.referrer ?? recording.referrer ?? null,
      app: clampedInput.app ?? recording.app ?? null,
      template: clampedInput.template ?? recording.template ?? null,
      status:
        clampedInput.status === "completed" || recording.status === "completed"
          ? "completed"
          : "active",
      metadata: JSON.stringify(metadata),
      updatedAt: ingestedAt,
      lastIngestedAt: ingestedAt,
    })
    .where(eq(schema.sessionRecordings.id, recording.id));

  await db
    .update(schema.analyticsPublicKeys)
    .set({ lastUsedAt: ingestedAt })
    .where(eq(schema.analyticsPublicKeys.id, key.id));

  recordChange({
    source: "session-recordings",
    type: "change",
    key: recording.id,
    ...replayRecordingChangeScope(recording),
  });

  return {
    recordingId: recording.id,
    sessionId: clampedInput.sessionId,
    acceptedChunks: rowsToInsert.length,
    duplicateChunks,
    chunkCount,
    eventCount,
    totalBytes,
  };
}

export async function listSessionRecordings(
  scope: SessionReplayScope,
  filters: SessionReplayListFilters = {},
): Promise<SessionRecordingSummary[]> {
  const db = getDb() as any;
  const limit = Math.min(
    MAX_SESSION_RECORDINGS_LIMIT,
    Math.max(1, filters.limit ?? DEFAULT_SESSION_RECORDINGS_LIMIT),
  );
  const conditions: any[] = [
    accessFilter(schema.sessionRecordings, schema.sessionRecordingShares, {
      userEmail: scope.userEmail,
      orgId: scope.orgId ?? undefined,
    }),
    replayVisibleIdentityCondition(),
    replayPlayableEventsCondition(),
  ];
  if (filters.app)
    conditions.push(eq(schema.sessionRecordings.app, filters.app));
  if (filters.template) {
    conditions.push(eq(schema.sessionRecordings.template, filters.template));
  }
  if (filters.sessionId) {
    conditions.push(eq(schema.sessionRecordings.sessionId, filters.sessionId));
  }
  if (filters.userId) {
    conditions.push(
      or(
        eq(schema.sessionRecordings.userId, filters.userId),
        eq(schema.sessionRecordings.userKey, filters.userId),
      ),
    );
  }
  if (filters.anonymousId) {
    conditions.push(
      eq(schema.sessionRecordings.anonymousId, filters.anonymousId),
    );
  }
  if (filters.path) {
    conditions.push(eq(schema.sessionRecordings.path, filters.path));
  }
  if (filters.from) {
    conditions.push(gte(schema.sessionRecordings.startedAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(schema.sessionRecordings.startedAt, filters.to));
  }
  if (filters.minDurationMs !== undefined) {
    conditions.push(
      gte(schema.sessionRecordings.durationMs, filters.minDurationMs),
    );
  }
  if (filters.hasErrors) {
    conditions.push(gte(schema.sessionRecordings.errorCount, 1));
  }
  if (filters.hasRageClicks) {
    conditions.push(gte(schema.sessionRecordings.rageClickCount, 1));
  }
  if (filters.status) {
    conditions.push(eq(schema.sessionRecordings.status, filters.status));
  }
  const search = replayListSearchCondition(filters.query);
  if (search) conditions.push(search);

  const rows = await db
    .select()
    .from(schema.sessionRecordings)
    .where(and(...conditions))
    .orderBy(desc(schema.sessionRecordings.startedAt))
    .limit(limit);
  return rows.map((row: any) => rowToSessionRecordingSummary(row));
}

export async function getSessionReplaySummary(
  recordingId: string,
  scope: SessionReplayScope,
): Promise<SessionRecordingSummary> {
  const access = await resolveAccess("session-recording", recordingId, {
    userEmail: scope.userEmail,
    orgId: scope.orgId ?? undefined,
  });
  if (!access) throw replayError("Session recording not found", 404);
  if (!isVisibleSessionRecording(access.resource)) {
    throw replayError("Session recording not found", 404);
  }
  return rowToSessionRecordingSummary(access.resource, access.role);
}

export async function getSessionReplayTokenizedSummary(
  recordingId: string,
): Promise<SessionRecordingSummary> {
  const db = getDb() as any;
  // guard:allow-unscoped -- called only after verifySessionReplayAgentAccess(recordingId, token) verifies a signed, recording-scoped agent_access token.
  const [row] = await db
    .select()
    .from(schema.sessionRecordings)
    .where(eq(schema.sessionRecordings.id, recordingId))
    .limit(1);
  if (!row || !isVisibleSessionRecording(row)) {
    throw replayError("Session recording not found", 404);
  }
  return rowToSessionRecordingSummary(row, "viewer");
}

function parseInlineReplayEvents(inlineData: string): unknown[] {
  try {
    const parsed = JSON.parse(inlineData);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.events)) return parsed.events;
    return [parsed];
  } catch {
    return [{ data: inlineData }];
  }
}

async function readStoredReplayEvents(row: any): Promise<unknown[]> {
  if (row.storageKind === "inline" && row.inlineData) {
    return parseInlineReplayEvents(row.inlineData);
  }
  if (row.storageKind !== "blob" || !row.storageRef) return [];
  const ref = decodeReplayBlobRef(row.storageRef);
  if (!ref) return [];
  const blob = await readPrivateBlob(ref.handle);
  const json = gunzipSync(Buffer.from(blob.data)).toString("utf8");
  return parseInlineReplayEvents(json);
}

export async function getSessionReplayManifest(
  recordingId: string,
  scope: SessionReplayScope,
): Promise<{
  recording: SessionRecordingSummary;
  chunks: Array<{
    seq: number;
    checksum: string;
    byteLength: number;
    eventCount: number;
    startedAt: string | null;
    endedAt: string | null;
    bytesPath: string;
  }>;
}> {
  const recording = await getSessionReplaySummary(recordingId, scope);
  return getSessionReplayManifestForRecording(recording);
}

export async function getSessionReplayTokenizedManifest(
  recordingId: string,
): Promise<{
  recording: AgentSessionRecordingSummary;
  chunks: Array<{
    seq: number;
    checksum: string;
    byteLength: number;
    eventCount: number;
    startedAt: string | null;
    endedAt: string | null;
    bytesPath: string;
  }>;
}> {
  const recording = await getSessionReplayTokenizedSummary(recordingId);
  const manifest = await getSessionReplayManifestForRecording(recording);
  return {
    ...manifest,
    recording: compactSessionRecordingSummary(manifest.recording),
  };
}

async function getSessionReplayManifestForRecording(
  recording: SessionRecordingSummary,
): Promise<{
  recording: SessionRecordingSummary;
  chunks: Array<{
    seq: number;
    checksum: string;
    byteLength: number;
    eventCount: number;
    startedAt: string | null;
    endedAt: string | null;
    bytesPath: string;
  }>;
}> {
  const db = getDb() as any;
  // guard:allow-unscoped -- chunk rows are loaded only after resolveAccess("session-recording", recordingId) or a scoped agent token verifies access; chunks are not directly shareable resources.
  const rows = await db
    .select()
    .from(schema.sessionReplayChunks)
    .where(eq(schema.sessionReplayChunks.recordingId, recording.id))
    .orderBy(asc(schema.sessionReplayChunks.seq));

  return {
    recording,
    chunks: rows.map((row: any) => ({
      seq: row.seq,
      checksum: row.checksum,
      byteLength: row.byteLength,
      eventCount: row.eventCount,
      startedAt: row.startedAt ?? null,
      endedAt: row.endedAt ?? null,
      bytesPath: `/api/session-replay/recordings/${encodeURIComponent(
        recording.id,
      )}/chunks/${encodeURIComponent(String(row.seq))}`,
    })),
  };
}

export async function readSessionReplayChunkBytes(
  recordingId: string,
  seq: number,
  scope: SessionReplayScope,
): Promise<{
  recording: SessionRecordingSummary;
  seq: number;
  checksum: string;
  /** Decompressed replay-chunk JSON text (a serialized rrweb events array). */
  json: string;
}> {
  const recording = await getSessionReplaySummary(recordingId, scope);
  return readSessionReplayChunkBytesForRecording(recording, seq);
}

export async function readSessionReplayTokenizedChunkBytes(
  recordingId: string,
  seq: number,
): Promise<{
  recording: AgentSessionRecordingSummary;
  seq: number;
  checksum: string;
  /** Decompressed replay-chunk JSON text (a serialized rrweb events array). */
  json: string;
}> {
  const recording = await getSessionReplayTokenizedSummary(recordingId);
  const chunk = await readSessionReplayChunkBytesForRecording(recording, seq);
  return {
    ...chunk,
    recording: compactSessionRecordingSummary(chunk.recording),
  };
}

async function readSessionReplayChunkBytesForRecording(
  recording: SessionRecordingSummary,
  seq: number,
): Promise<{
  recording: SessionRecordingSummary;
  seq: number;
  checksum: string;
  /** Decompressed replay-chunk JSON text (a serialized rrweb events array). */
  json: string;
}> {
  const db = getDb() as any;
  // guard:allow-unscoped -- chunk rows are loaded only after resolveAccess("session-recording", recordingId) or a scoped agent token verifies access; chunks are not directly shareable resources.
  const [row] = await db
    .select()
    .from(schema.sessionReplayChunks)
    .where(
      and(
        eq(schema.sessionReplayChunks.recordingId, recording.id),
        eq(schema.sessionReplayChunks.seq, seq),
      ),
    )
    .limit(1);
  if (!row) throw replayError("Session replay chunk not found", 404);

  // Return decompressed JSON and let normal Accept-Encoding negotiation handle
  // wire compression. We intentionally do NOT hand back a pre-gzipped body with
  // a manual `Content-Encoding: gzip` header: serverless hosts (Netlify) mangle
  // binary function bodies and re-negotiate compression, which corrupted replay
  // chunk downloads in production and left the player blank. Storing gzip at
  // rest is unchanged — we just gunzip before serving.
  if (row.storageKind === "blob" && row.storageRef) {
    const ref = decodeReplayBlobRef(row.storageRef);
    if (!ref)
      throw replayError("Session replay blob reference is invalid", 500);
    const blob = await readPrivateBlob(ref.handle);
    return {
      recording,
      seq: row.seq,
      checksum: row.checksum,
      json: gunzipSync(Buffer.from(blob.data)).toString("utf8"),
    };
  }
  if (!row.inlineData)
    throw replayError("Session replay chunk is unavailable", 404);
  return {
    recording,
    seq: row.seq,
    checksum: row.checksum,
    json: row.inlineData,
  };
}

export async function getSessionReplayEvents(
  recordingId: string,
  scope: SessionReplayScope,
  options: SessionReplayEventReadOptions = {},
): Promise<{
  recording: SessionRecordingSummary;
  chunks: Array<{
    seq: number;
    checksum: string;
    byteLength: number;
    eventCount: number;
    events: unknown[];
    unavailable?: boolean;
  }>;
  eventCount: number;
  truncated: boolean;
  unavailableChunks: number;
}> {
  const recording = await getSessionReplaySummary(recordingId, scope);
  return getSessionReplayEventsForRecording(recording, options);
}

export async function getSessionReplayTokenizedEvents(
  recordingId: string,
  options: SessionReplayEventReadOptions = {},
): Promise<{
  recording: AgentSessionRecordingSummary;
  chunks: Array<{
    seq: number;
    checksum: string;
    byteLength: number;
    eventCount: number;
    events: unknown[];
    unavailable?: boolean;
  }>;
  eventCount: number;
  truncated: boolean;
  unavailableChunks: number;
}> {
  const recording = await getSessionReplayTokenizedSummary(recordingId);
  const result = await getSessionReplayEventsForRecording(recording, options);
  return {
    ...result,
    recording: compactSessionRecordingSummary(result.recording),
  };
}

async function getSessionReplayEventsForRecording(
  recording: SessionRecordingSummary,
  options: SessionReplayEventReadOptions = {},
): Promise<{
  recording: SessionRecordingSummary;
  chunks: Array<{
    seq: number;
    checksum: string;
    byteLength: number;
    eventCount: number;
    events: unknown[];
    unavailable?: boolean;
  }>;
  eventCount: number;
  truncated: boolean;
  unavailableChunks: number;
}> {
  const maxEvents = Math.min(
    MAX_REPLAY_EVENTS_READ,
    Math.max(1, options.limit ?? DEFAULT_REPLAY_EVENTS_READ),
  );
  const conditions: any[] = [
    eq(schema.sessionReplayChunks.recordingId, recording.id),
  ];
  if (options.startSeq !== undefined) {
    conditions.push(gte(schema.sessionReplayChunks.seq, options.startSeq));
  }
  if (options.endSeq !== undefined) {
    conditions.push(lte(schema.sessionReplayChunks.seq, options.endSeq));
  }

  const db = getDb() as any;
  // guard:allow-unscoped -- chunk rows are loaded only after resolveAccess("session-recording", recordingId) or a scoped agent token verifies access; chunks are not directly shareable resources.
  const rows = await db
    .select()
    .from(schema.sessionReplayChunks)
    .where(and(...conditions))
    .orderBy(asc(schema.sessionReplayChunks.seq));

  const chunks: Array<{
    seq: number;
    checksum: string;
    byteLength: number;
    eventCount: number;
    events: unknown[];
    unavailable?: boolean;
  }> = [];
  let emittedEvents = 0;
  let emittedBytes = 0;
  let truncated = false;
  let unavailableChunks = 0;

  for (const row of rows) {
    const events = await readStoredReplayEvents(row).catch(() => []);
    if (!events.length) {
      unavailableChunks += 1;
      chunks.push({
        seq: row.seq,
        checksum: row.checksum,
        byteLength: row.byteLength,
        eventCount: row.eventCount,
        events: [],
        unavailable: true,
      });
      continue;
    }

    const emittedForChunk: unknown[] = [];
    for (const replayEvent of events) {
      const eventBytes = Buffer.byteLength(JSON.stringify(replayEvent), "utf8");
      if (
        emittedEvents >= maxEvents ||
        emittedBytes + eventBytes > MAX_REPLAY_EVENTS_RESPONSE_BYTES
      ) {
        truncated = true;
        break;
      }
      emittedForChunk.push(replayEvent);
      emittedEvents += 1;
      emittedBytes += eventBytes;
    }
    chunks.push({
      seq: row.seq,
      checksum: row.checksum,
      byteLength: row.byteLength,
      eventCount: row.eventCount,
      events: emittedForChunk,
    });
    if (truncated) break;
  }

  return {
    recording,
    chunks,
    eventCount: emittedEvents,
    truncated,
    unavailableChunks,
  };
}

export async function finalizeAbandonedSessionRecordings(
  now = new Date(),
): Promise<{ finalized: number }> {
  const cutoff = isoBefore(now, abandonedReplayMinutes() * 60_000);
  const db = getDb() as any;
  // guard:allow-unscoped — retention finalizes abandoned replay rows across owners and never returns row data to a caller.
  const rows = await db
    .select()
    .from(schema.sessionRecordings)
    .where(
      and(
        eq(schema.sessionRecordings.status, "active"),
        lt(schema.sessionRecordings.updatedAt, cutoff),
      ),
    )
    .limit(RETENTION_DELETE_BATCH_SIZE);

  let finalized = 0;
  for (const row of rows) {
    const endedAt = row.lastIngestedAt ?? row.updatedAt ?? row.startedAt;
    const started = Date.parse(row.startedAt);
    const ended = Date.parse(endedAt);
    const durationMs =
      Number.isFinite(started) && Number.isFinite(ended)
        ? Math.max(0, ended - started)
        : (row.durationMs ?? null);
    await db
      .update(schema.sessionRecordings)
      .set({
        status: "completed",
        endedAt,
        durationMs,
        updatedAt: now.toISOString(),
      })
      .where(eq(schema.sessionRecordings.id, row.id));
    finalized++;
  }

  return { finalized };
}

async function deleteReplayChunkBlob(row: any): Promise<boolean> {
  if (row.storageKind !== "blob" || !row.storageRef) return true;
  const ref = decodeReplayBlobRef(row.storageRef);
  if (!ref) return false;
  const result = await deletePrivateBlob(ref.handle);
  return result.deleted === true;
}

export async function expireOldSessionRecordings(
  now = new Date(),
): Promise<{ expired: number; chunks: number; blobDeleteFailures: number }> {
  const cutoff = isoBefore(now, replayRetentionDays() * 24 * 60 * 60_000);
  const db = getDb() as any;
  // guard:allow-unscoped — retention expiration intentionally sweeps old replay rows across owners.
  const recordings = await db
    .select({ id: schema.sessionRecordings.id })
    .from(schema.sessionRecordings)
    .where(lt(schema.sessionRecordings.startedAt, cutoff))
    .limit(RETENTION_DELETE_BATCH_SIZE);

  let expired = 0;
  let chunks = 0;
  let blobDeleteFailures = 0;
  for (const recording of recordings) {
    const chunkRows = await db
      .select()
      .from(schema.sessionReplayChunks)
      .where(eq(schema.sessionReplayChunks.recordingId, recording.id));

    let chunkDeleteFailed = false;
    for (const chunk of chunkRows) {
      try {
        const deleted = await deleteReplayChunkBlob(chunk);
        if (!deleted) {
          chunkDeleteFailed = true;
          blobDeleteFailures++;
          console.warn(
            "[session-replay] Private replay blob provider reported no deletion for chunk",
            chunk.id,
          );
        }
      } catch (err) {
        chunkDeleteFailed = true;
        blobDeleteFailures++;
        console.warn("[session-replay] Failed to delete replay blob:", err);
      }
    }

    if (chunkDeleteFailed) continue;

    await db
      .delete(schema.sessionReplayChunks)
      .where(eq(schema.sessionReplayChunks.recordingId, recording.id));
    await db
      .delete(schema.sessionReplayIngests)
      .where(eq(schema.sessionReplayIngests.recordingId, recording.id));
    await db
      .delete(schema.sessionRecordingShares)
      .where(eq(schema.sessionRecordingShares.resourceId, recording.id));
    await db
      .delete(schema.sessionRecordings)
      .where(eq(schema.sessionRecordings.id, recording.id));

    expired++;
    chunks += chunkRows.length;
  }

  return { expired, chunks, blobDeleteFailures };
}

export async function runSessionReplayRetentionSweep(
  now = new Date(),
): Promise<{
  finalized: number;
  expired: number;
  chunks: number;
  blobDeleteFailures: number;
}> {
  const finalized = await finalizeAbandonedSessionRecordings(now);
  const expired = await expireOldSessionRecordings(now);
  return {
    finalized: finalized.finalized,
    expired: expired.expired,
    chunks: expired.chunks,
    blobDeleteFailures: expired.blobDeleteFailures,
  };
}
