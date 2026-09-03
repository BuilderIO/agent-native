import type { ActionRunContext } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export interface DeckVersionChatContext {
  threadId?: string;
  runId?: string;
  turnId?: string;
}

function contextFromFields(value: {
  threadId?: unknown;
  runId?: unknown;
  turnId?: unknown;
}): DeckVersionChatContext | undefined {
  const context: DeckVersionChatContext = {};
  for (const key of ["threadId", "runId", "turnId"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) {
      context[key] = value[key];
    }
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
  const [latestVersion] = await db
    .select({
      title: schema.deckVersions.title,
      data: schema.deckVersions.data,
      createdAt: schema.deckVersions.createdAt,
    })
    .from(schema.deckVersions)
    .where(
      and(
        eq(schema.deckVersions.deckId, source.id),
        eq(schema.deckVersions.ownerEmail, source.ownerEmail),
      ),
    )
    .orderBy(desc(schema.deckVersions.createdAt))
    .limit(1);

  if (
    latestVersion &&
    latestVersion.title === source.title &&
    latestVersion.data === source.data
  ) {
    return { created: false, reason: "duplicate" };
  }

  if (!options.force && latestVersion?.createdAt) {
    const latestAt = new Date(latestVersion.createdAt).getTime();
    if (
      Number.isFinite(latestAt) &&
      Date.now() - latestAt < SNAPSHOT_INTERVAL_MS
    ) {
      return { created: false, reason: "interval" };
    }
  }

  const id = nanoid();
  await db.insert(schema.deckVersions).values({
    id,
    ownerEmail: source.ownerEmail,
    deckId: source.id,
    title: source.title,
    data: source.data,
    changeLabel: options.label,
    ...(options.chatContext
      ? { chatContext: JSON.stringify(options.chatContext) }
      : {}),
    createdAt: new Date().toISOString(),
  });

  return { created: true, id };
}
