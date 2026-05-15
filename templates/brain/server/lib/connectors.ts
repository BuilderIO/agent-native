import { eq } from "drizzle-orm";
import { resolveCredential } from "@agent-native/core/credentials";
import { getCredentialContext } from "@agent-native/core/server";
import { getDb, schema } from "../db/index.js";
import {
  createCapture,
  nanoid,
  nowIso,
  parseJson,
  serializeCapture,
  stableJson,
} from "./brain.js";
import type {
  BrainCaptureKind,
  BrainSourceProvider,
} from "../../shared/types.js";

export interface ConnectorSyncResult {
  runId: string;
  sourceId: string;
  provider: BrainSourceProvider;
  status: "success" | "error";
  capturesCreated: number;
  captures: Array<ReturnType<typeof serializeCapture>>;
  message: string;
  stats?: Record<string, unknown>;
}

type SourceRow = typeof schema.brainSources.$inferSelect;

interface Connector {
  sync(source: SourceRow): Promise<ConnectorSyncResult>;
}

interface RetryCursor {
  provider: BrainSourceProvider;
  endpoint: string;
  retryAfterSeconds: number;
  retryAfterAt: string;
  encounteredAt: string;
}

interface SlackChannelCursor {
  latestTs?: string;
  pageCursor?: string;
  pendingLatestTs?: string;
}

interface SlackSyncCursor {
  channels?: Record<string, SlackChannelCursor>;
  retry?: RetryCursor;
  lastRunAt?: string;
}

interface GranolaSyncCursor {
  cursor?: string | null;
  updatedAfter?: string;
  retry?: RetryCursor;
  lastRunAt?: string;
}

interface SlackChannel {
  id: string;
  name?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  is_archived?: boolean;
}

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

interface SlackHistoryResponse {
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

interface SlackInfoResponse {
  channel?: SlackChannel;
}

interface SlackListResponse {
  channels?: SlackChannel[];
  response_metadata?: { next_cursor?: string };
}

interface SlackPermalinkResponse {
  permalink?: string;
}

interface GranolaListNote {
  id?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  web_url?: string;
  owner?: unknown;
}

interface GranolaListResponse {
  notes?: GranolaListNote[];
  hasMore?: boolean;
  has_more?: boolean;
  cursor?: string | null;
}

interface GranolaNote extends GranolaListNote {
  summary?: unknown;
  transcript?: unknown;
  attendees?: unknown;
  calendar_event?: unknown;
}

class ConnectorRateLimitError extends Error {
  constructor(
    public provider: BrainSourceProvider,
    public endpoint: string,
    public retryAfterSeconds: number,
  ) {
    super(
      `${provider} rate limited ${endpoint}; retry after ${retryAfterSeconds}s`,
    );
  }
}

function transcriptItems(config: Record<string, unknown>) {
  const raw = config.transcripts ?? config.sampleTranscripts ?? config.messages;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        return { title: "Imported capture", content: item };
      }
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const content =
        typeof record.content === "string"
          ? record.content
          : typeof record.text === "string"
            ? record.text
            : "";
      if (!content.trim()) return null;
      return {
        externalId:
          typeof record.externalId === "string" ? record.externalId : undefined,
        title:
          typeof record.title === "string" ? record.title : "Imported capture",
        content,
        kind:
          typeof record.kind === "string"
            ? (record.kind as BrainCaptureKind)
            : "transcript",
        capturedAt:
          typeof record.capturedAt === "string" ? record.capturedAt : undefined,
        metadata:
          typeof record.metadata === "object" && record.metadata
            ? (record.metadata as Record<string, unknown>)
            : {},
      };
    })
    .filter(Boolean) as Array<{
    title: string;
    content: string;
    kind: BrainCaptureKind;
    capturedAt?: string;
    metadata: Record<string, unknown>;
    externalId?: string;
  }>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function configuredList(
  config: Record<string, unknown>,
  keys: string[],
  nestedKey?: string,
): string[] {
  const values: string[] = [];
  const configs = nestedKey
    ? [config, objectValue(config[nestedKey])]
    : [config];

  for (const itemConfig of configs) {
    for (const key of keys) {
      const raw = itemConfig[key];
      if (typeof raw === "string") {
        values.push(...raw.split(","));
      } else if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === "string") values.push(item);
        }
      }
    }
  }

  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.replace(/^#/, "")),
    ),
  );
}

function configuredNumber(
  config: Record<string, unknown>,
  keys: string[],
  fallback: number,
  options: { min: number; max: number; nestedKey?: string },
): number {
  const configs = options.nestedKey
    ? [config, objectValue(config[options.nestedKey])]
    : [config];
  for (const itemConfig of configs) {
    for (const key of keys) {
      const raw = itemConfig[key];
      const value =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? Number(raw)
            : Number.NaN;
      if (Number.isFinite(value)) {
        return Math.max(options.min, Math.min(options.max, Math.floor(value)));
      }
    }
  }
  return fallback;
}

function isFixtureConfig(config: Record<string, unknown>) {
  return (
    config.fixture === true ||
    config.testFixture === true ||
    config.useConfiguredItems === true
  );
}

async function requireConnectorCredential(
  key: string,
  label: string,
): Promise<string> {
  const ctx = getCredentialContext();
  if (!ctx) {
    throw new Error(
      `${label} sync requires an authenticated credential context`,
    );
  }
  const value = await resolveCredential(key, ctx);
  if (!value) {
    throw new Error(`${label} credential ${key} is not configured`);
  }
  return value;
}

function retryCursor(
  error: ConnectorRateLimitError,
  provider: BrainSourceProvider,
): RetryCursor {
  const now = Date.now();
  return {
    provider,
    endpoint: error.endpoint,
    retryAfterSeconds: error.retryAfterSeconds,
    retryAfterAt: new Date(now + error.retryAfterSeconds * 1000).toISOString(),
    encounteredAt: new Date(now).toISOString(),
  };
}

function retryAfterSeconds(headers: Headers): number {
  const raw = headers.get("retry-after");
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 60;
}

function buildUrl(
  base: string,
  params: Record<string, string | number | boolean | null | undefined>,
) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function isoFromSlackTs(ts: string | undefined): string | undefined {
  if (!ts) return undefined;
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function newestSlackTs(messages: SlackMessage[]): string | undefined {
  const timestamps = messages
    .map((message) => message.ts)
    .filter((ts): ts is string => typeof ts === "string" && ts.length > 0)
    .sort((a, b) => Number(b) - Number(a));
  return timestamps[0];
}

function readableJson(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  for (const key of ["markdown", "text", "content", "summary"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return JSON.stringify(value, null, 2);
}

async function createRun(source: SourceRow) {
  const db = getDb();
  const runId = nanoid();
  await db.insert(schema.brainSyncRuns).values({
    id: runId,
    sourceId: source.id,
    provider: source.provider,
    status: "running",
    statsJson: "{}",
    error: null,
    startedAt: nowIso(),
    completedAt: null,
  });
  return runId;
}

async function finishRun(
  runId: string,
  status: "success" | "error",
  stats: Record<string, unknown>,
  error?: string | null,
) {
  await getDb()
    .update(schema.brainSyncRuns)
    .set({
      status,
      statsJson: stableJson(stats),
      error: error ?? null,
      completedAt: nowIso(),
    })
    .where(eq(schema.brainSyncRuns.id, runId));
}

async function syncFromConfiguredItems(
  source: SourceRow,
  emptyMessage: string,
): Promise<ConnectorSyncResult> {
  const runId = await createRun(source);
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  const items = transcriptItems(config);
  const captures = [];

  try {
    for (const item of items) {
      const capture = await createCapture({
        sourceId: source.id,
        externalId: item.externalId,
        title: item.title,
        kind: item.kind,
        content: item.content,
        capturedAt: item.capturedAt,
        metadata: {
          ...item.metadata,
          connector: source.provider,
          syncRunId: runId,
        },
      });
      captures.push(serializeCapture(capture));
    }
    await finishRun(runId, "success", { capturesCreated: captures.length });
    await getDb()
      .update(schema.brainSources)
      .set({
        lastSyncedAt: nowIso(),
        lastError: null,
        status: "active",
        updatedAt: nowIso(),
      })
      .where(eq(schema.brainSources.id, source.id));
    return {
      runId,
      sourceId: source.id,
      provider: source.provider as BrainSourceProvider,
      status: "success",
      capturesCreated: captures.length,
      captures,
      message: captures.length ? "Imported configured captures" : emptyMessage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(
      runId,
      "error",
      { capturesCreated: captures.length },
      message,
    );
    await getDb()
      .update(schema.brainSources)
      .set({ lastError: message, status: "error", updatedAt: nowIso() })
      .where(eq(schema.brainSources.id, source.id));
    return {
      runId,
      sourceId: source.id,
      provider: source.provider as BrainSourceProvider,
      status: "error",
      capturesCreated: captures.length,
      captures,
      message,
    };
  }
}

const manualConnector: Connector = {
  sync: (source) =>
    syncFromConfiguredItems(
      source,
      "Manual sources do not have a remote sync. Use import-capture or import-transcript.",
    ),
};

const slackConnector: Connector = {
  sync: (source) =>
    syncFromConfiguredItems(
      source,
      "Slack connector configured. Add transcripts/messages to source config for v1 imports.",
    ),
};

const granolaConnector: Connector = {
  sync: (source) =>
    syncFromConfiguredItems(
      source,
      "Granola connector configured. Add exported transcripts to source config for v1 imports.",
    ),
};

const clipsConnector: Connector = {
  sync: (source) =>
    syncFromConfiguredItems(
      source,
      "Clips connector configured. Export from Clips or add transcript payloads to source config.",
    ),
};

const connectors: Record<BrainSourceProvider, Connector> = {
  manual: manualConnector,
  generic: manualConnector,
  clips: clipsConnector,
  slack: slackConnector,
  granola: granolaConnector,
};

export async function runConnectorSync(source: SourceRow) {
  return connectors[source.provider as BrainSourceProvider].sync(source);
}
