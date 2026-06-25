import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export interface DeckSnapshotSource {
  id: string;
  title: string;
  data: string;
  ownerEmail: string;
}

export async function createDeckVersionSnapshot(
  source: DeckSnapshotSource,
  options: { force?: boolean; label?: string } = {},
): Promise<{ created: boolean; id?: string; reason?: string }> {
  if (!source.ownerEmail) {
    throw new Error("Cannot snapshot deck version without an owner email");
  }

  const db = getDb();
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
    createdAt: new Date().toISOString(),
  });

  return { created: true, id };
}
