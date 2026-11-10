import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { deckContentSignature } from "../../shared/deck-content.js";
import { getDb, schema } from "../db/index.js";

export { deckContentSignature as deckVersionContentSignature } from "../../shared/deck-content.js";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/** Stored on each version so a save never re-reads an old body to compare. */
export function deckVersionContentHash(data: unknown): string {
  return createHash("sha256").update(deckContentSignature(data)).digest("hex");
}

export interface DeckVersionChatContext {
  threadId?: string;
  runId?: string;
  turnId?: string;
  phase?: "start" | "end";
}

function contextFromFields(value: {
  threadId?: unknown;
  runId?: unknown;
  turnId?: unknown;
  phase?: unknown;
}): DeckVersionChatContext | undefined {
  const context: DeckVersionChatContext = {};
  for (const key of ["threadId", "runId", "turnId"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) {
      context[key] = value[key];
    }
  }
  if (value.phase === "start" || value.phase === "end") {
    context.phase = value.phase;
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

export function deckVersionChatContextFromAction(
  context?: ActionRunContext,
): DeckVersionChatContext | undefined {
  if (
    !context ||
    (context.caller !== "tool" &&
      context.caller !== "mcp" &&
      context.caller !== "a2a" &&
      context.caller !== "webmcp")
  ) {
    return undefined;
  }
  return contextFromFields(context);
}

export function deckVersionChangeGroupFromAction(
  context?: ActionRunContext,
): string | undefined {
  const chatContext = deckVersionChatContextFromAction(context);
  return chatContext?.turnId ?? chatContext?.runId;
}

export function deckVersionChatContextFromRun(run: {
  threadId?: unknown;
  runId?: unknown;
  turnId?: unknown;
}): DeckVersionChatContext | undefined {
  return contextFromFields(run);
}

export function serializeDeckVersionChatContext(
  context: DeckVersionChatContext | undefined,
): string | null {
  return context ? JSON.stringify(context) : null;
}

export function parseDeckVersionChatContext(
  raw: string | null | undefined,
): DeckVersionChatContext | undefined {
  if (raw == null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Deck version chat metadata is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Deck version chat metadata is invalid.");
  }
  const context = contextFromFields(value as Record<string, unknown>);
  if (!context) throw new Error("Deck version chat metadata is invalid.");
  return context;
}

export interface DeckSnapshotSource {
  id: string;
  title: string;
  data: string;
  ownerEmail: string;
}

function normalizedChatContext(
  raw: string | null | undefined,
): string | null | undefined {
  if (!raw) return undefined;
  try {
    return (
      serializeDeckVersionChatContext(parseDeckVersionChatContext(raw)) ??
      undefined
    );
  } catch {
    console.warn(
      "Deck version chat metadata is unreadable; skipping turn deduplication.",
    );
    return null;
  }
}

/** Versions saved before `content_hash` existed fall back to their body. */
async function legacyVersionContentHash(
  db: ReturnType<typeof getDb>,
  versionId: string,
): Promise<string | null> {
  const row = (
    await db
      .select({ data: schema.deckVersions.data })
      .from(schema.deckVersions)
      .where(eq(schema.deckVersions.id, versionId))
      .limit(1)
  ).at(0);
  return row ? deckVersionContentHash(row.data) : null;
}

export async function createDeckVersionSnapshot(
  source: DeckSnapshotSource,
  options: {
    force?: boolean;
    label?: string;
    chatContext?: DeckVersionChatContext;
    db?: ReturnType<typeof getDb>;
  } = {},
): Promise<{ created: boolean; id?: string; reason?: string }> {
  if (!source.ownerEmail) {
    throw new Error("Cannot snapshot deck version without an owner email");
  }

  const db = options.db ?? getDb();
  const latestVersion = (
    await db
      .select({
        id: schema.deckVersions.id,
        title: schema.deckVersions.title,
        contentHash: schema.deckVersions.contentHash,
        createdAt: schema.deckVersions.createdAt,
        chatContext: schema.deckVersions.chatContext,
      })
      .from(schema.deckVersions)
      .where(
        and(
          eq(schema.deckVersions.deckId, source.id),
          eq(schema.deckVersions.ownerEmail, source.ownerEmail),
        ),
      )
      .orderBy(desc(schema.deckVersions.createdAt))
      .limit(1)
  ).at(0);

  // Most editor saves land inside the interval; they must not pay for
  // fingerprinting either deck inside the write transaction.
  if (!options.force && latestVersion?.createdAt) {
    const latestAt = new Date(latestVersion.createdAt).getTime();
    if (
      Number.isFinite(latestAt) &&
      Date.now() - latestAt < SNAPSHOT_INTERVAL_MS
    ) {
      return { created: false, reason: "interval" };
    }
  }

  const contentHash = deckVersionContentHash(source.data);
  if (
    options.chatContext?.phase !== "start" &&
    latestVersion &&
    latestVersion.title === source.title &&
    (latestVersion.contentHash ??
      (await legacyVersionContentHash(db, latestVersion.id))) === contentHash
  ) {
    return { created: false, reason: "duplicate" };
  }

  const requestedChatContext = serializeDeckVersionChatContext(
    options.chatContext,
  );
  const turnGroup =
    options.chatContext?.turnId ?? options.chatContext?.runId ?? undefined;
  const changeGroup =
    options.chatContext?.phase === "start" && turnGroup
      ? `start:thread:${options.chatContext.threadId ?? turnGroup}`
      : turnGroup;
  if (
    requestedChatContext &&
    requestedChatContext === normalizedChatContext(latestVersion?.chatContext)
  ) {
    return { created: false, reason: "same-agent-turn" };
  }

  const id = nanoid();
  const values = {
    id,
    ownerEmail: source.ownerEmail,
    deckId: source.id,
    title: source.title,
    data: source.data,
    contentHash,
    changeLabel: options.label,
    ...(options.chatContext
      ? { chatContext: JSON.stringify(options.chatContext) }
      : {}),
    ...(changeGroup ? { changeGroup } : {}),
    createdAt: new Date().toISOString(),
  };
  const insert = db.insert(schema.deckVersions).values(values);
  if (!changeGroup) {
    await insert;
    return { created: true, id };
  }

  const [inserted] = await insert
    .onConflictDoNothing()
    .returning({ id: schema.deckVersions.id });
  if (!inserted) return { created: false, reason: "same-agent-turn" };

  return { created: true, id };
}

export async function createDeckChatBeginningSnapshot(
  source: DeckSnapshotSource,
  run: { threadId: string; runId: string },
): Promise<{ created: boolean; id?: string; reason?: string }> {
  const rows = await getDb()
    .select({ id: schema.deckVersions.id })
    .from(schema.deckVersions)
    .where(
      and(
        eq(schema.deckVersions.deckId, source.id),
        eq(schema.deckVersions.ownerEmail, source.ownerEmail),
        eq(schema.deckVersions.changeGroup, `start:thread:${run.threadId}`),
      ),
    )
    .limit(1);
  if (rows.length) {
    return { created: false, reason: "beginning-exists" };
  }
  return createDeckVersionSnapshot(source, {
    force: true,
    label: "Before chat",
    chatContext: { ...run, phase: "start" },
  });
}
