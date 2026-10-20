import { randomUUID } from "node:crypto";

import { and, desc, eq, notInArray, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/**
 * Replaced transcripts kept per recording. Each is a full copy, and a
 * replace is a deliberate act, so ten covers several rounds of replace and
 * undo without letting one recording grow without bound.
 */
export const TRANSCRIPT_VERSION_LIMIT = 10;

const VERSION_PREVIEW_CHARS = 160;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type TranscriptVersionReason =
  (typeof schema.recordingTranscriptVersions.$inferInsert)["reason"];

export interface TranscriptVersionSummary {
  id: string;
  /** When this transcript was replaced. */
  replacedAt: string;
  reason: TranscriptVersionReason;
  source: "imported" | null;
  language: string;
  preview: string;
}

type TranscriptRow = typeof schema.recordingTranscripts.$inferSelect;

/** A ready transcript with words or cues in it: the only kind worth keeping. */
export function hasTranscriptContent(
  row: Pick<TranscriptRow, "status" | "fullText" | "segmentsJson">,
): boolean {
  return (
    row.status === "ready" &&
    (row.fullText.trim() !== "" || row.segmentsJson !== "[]")
  );
}

/**
 * Saves `replaced` as a version inside the transaction that replaces it, so
 * a failed replace keeps no version and a saved replace never loses one.
 */
export async function saveTranscriptVersion(
  tx: Tx,
  replaced: Pick<
    TranscriptRow,
    | "recordingId"
    | "ownerEmail"
    | "language"
    | "segmentsJson"
    | "fullText"
    | "status"
    | "source"
    | "importId"
  >,
  {
    reason,
    replacedBy,
  }: { reason: TranscriptVersionReason; replacedBy: string | null },
): Promise<string> {
  const v = schema.recordingTranscriptVersions;
  const id = randomUUID();
  await tx.insert(v).values({
    id,
    recordingId: replaced.recordingId,
    ownerEmail: replaced.ownerEmail,
    language: replaced.language,
    segmentsJson: replaced.segmentsJson,
    fullText: replaced.fullText,
    status: replaced.status,
    source: replaced.source,
    importId: replaced.importId,
    reason,
    replacedBy,
    createdAt: new Date().toISOString(),
  });
  const kept = tx
    .select({ id: v.id })
    .from(v)
    .where(eq(v.recordingId, replaced.recordingId))
    .orderBy(desc(v.createdAt), desc(v.id))
    .limit(TRANSCRIPT_VERSION_LIMIT);
  await tx
    .delete(v)
    .where(
      and(eq(v.recordingId, replaced.recordingId), notInArray(v.id, kept)),
    );
  return id;
}

/** Newest first. Callers must check the reader may edit the recording. */
export async function listTranscriptVersions(
  db: Db,
  recordingId: string,
): Promise<TranscriptVersionSummary[]> {
  const v = schema.recordingTranscriptVersions;
  const rows = await db
    .select({
      id: v.id,
      replacedAt: v.createdAt,
      reason: v.reason,
      source: v.source,
      language: v.language,
      preview: sql<string>`LEFT(${v.fullText}, ${VERSION_PREVIEW_CHARS})`,
    })
    .from(v)
    .where(eq(v.recordingId, recordingId))
    .orderBy(desc(v.createdAt), desc(v.id))
    .limit(TRANSCRIPT_VERSION_LIMIT);
  return rows.map((row) => ({ ...row, preview: row.preview.trim() }));
}
