import { and, eq } from "drizzle-orm";

import type { getDb } from "../db/index.js";
import { factoryPollCursors } from "../db/schema.js";
import { factoryConfigRowId } from "./factory-scope.js";

type Db = ReturnType<typeof getDb>;

export type FactoryPollCursor = {
  lastSlackTs: string | null;
  slackHistoryCursor: string | null;
  lastSentrySeenAt: string | null;
};

function pollCursorRowId(
  orgId: string,
  factoryId: string,
  source: string,
  destinationKey: string,
): string {
  return `${factoryConfigRowId(orgId, factoryId)}:${source}:${destinationKey}`;
}

export async function readFactoryPollCursor(
  db: Db,
  orgId: string,
  factoryId: string,
  source: string,
  destinationKey: string,
): Promise<FactoryPollCursor | null> {
  const row = (
    await db
      .select()
      .from(factoryPollCursors)
      .where(
        and(
          eq(factoryPollCursors.orgId, orgId),
          eq(factoryPollCursors.factoryId, factoryId),
          eq(factoryPollCursors.source, source),
          eq(factoryPollCursors.destinationKey, destinationKey),
        ),
      )
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    lastSlackTs: row.lastSlackTs,
    slackHistoryCursor: row.slackHistoryCursor,
    lastSentrySeenAt: row.lastSentrySeenAt,
  };
}

export async function writeFactoryPollCursor(
  db: Db,
  input: {
    orgId: string;
    factoryId: string;
    source: string;
    destinationKey: string;
    ownerEmail: string;
    lastSlackTs?: string | null;
    slackHistoryCursor?: string | null;
    lastSentrySeenAt?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const id = pollCursorRowId(
    input.orgId,
    input.factoryId,
    input.source,
    input.destinationKey,
  );
  await db
    .insert(factoryPollCursors)
    .values({
      id,
      factoryId: input.factoryId,
      source: input.source,
      destinationKey: input.destinationKey,
      lastSlackTs: input.lastSlackTs ?? null,
      slackHistoryCursor: input.slackHistoryCursor ?? null,
      lastSentrySeenAt: input.lastSentrySeenAt ?? null,
      createdAt: now,
      updatedAt: now,
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
    })
    .onConflictDoUpdate({
      target: factoryPollCursors.id,
      set: {
        lastSlackTs: input.lastSlackTs ?? null,
        slackHistoryCursor: input.slackHistoryCursor ?? null,
        lastSentrySeenAt: input.lastSentrySeenAt ?? null,
        updatedAt: now,
        ownerEmail: input.ownerEmail,
      },
    });
}
