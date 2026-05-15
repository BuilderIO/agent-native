import { eq } from "drizzle-orm";
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
}

type SourceRow = typeof schema.brainSources.$inferSelect;

interface Connector {
  sync(source: SourceRow): Promise<ConnectorSyncResult>;
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
