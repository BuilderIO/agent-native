import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { getGenerationCreativeContext } from "@agent-native/creative-context/server";
import type { CreativeContextGenerationRecord } from "@agent-native/creative-context/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  designGenerationSessionKey,
  type DesignGenerationSession,
} from "../shared/generation-session.js";

export interface DesignContextUsageItem {
  itemId: string;
  itemVersionId: string;
  label: string;
  influence: "reused" | "adapted" | "reference-conditioned" | "generated";
}

export interface DesignContextUsageResult {
  /** False when this file has never been generated through the recorded
   *  Creative Context pipeline — distinct from `usedContext: false`, which
   *  means a generation record exists and confirmed no context was used. */
  available: boolean;
  usedContext: boolean;
  contextMode?: CreativeContextGenerationRecord["contextMode"];
  contextPackId?: string | null;
  recordedAt?: string;
  items: DesignContextUsageItem[];
}

/**
 * Element ids that could identify `fileId` in a recorded generation's
 * elementProvenance: the file id itself, plus the frameId a still-live
 * generation session assigned it (see provenanceForSavedFiles in
 * generate-design.ts). A session that has since moved on to a new prompt no
 * longer carries the old frameId mapping — a known gap, not a guess.
 */
function candidateElementIds(
  fileId: string,
  filename: string,
  session: DesignGenerationSession | null,
): Set<string> {
  const ids = new Set([fileId]);
  const frameId = session?.frames.find(
    (frame) => frame.filename === filename,
  )?.frameId;
  if (frameId) ids.add(frameId);
  return ids;
}

/** Pure so it can be unit-tested against constructed records without a DB. */
export function selectDesignContextUsage(
  record: CreativeContextGenerationRecord | null,
  elementIds: ReadonlySet<string>,
): DesignContextUsageResult {
  if (!record) return { available: false, usedContext: false, items: [] };
  const matches = record.elementProvenance.filter((entry) =>
    elementIds.has(entry.elementId),
  );
  const items = matches
    .filter(
      (entry): entry is typeof entry & { itemId: string; itemVersionId: string } =>
        Boolean(entry.itemId && entry.itemVersionId),
    )
    .map((entry) => ({
      itemId: entry.itemId,
      itemVersionId: entry.itemVersionId,
      label: entry.label?.trim() || entry.itemId,
      influence: entry.influence,
    }));
  return {
    available: true,
    usedContext: items.length > 0,
    contextMode: record.contextMode,
    contextPackId: record.contextPackId,
    recordedAt: record.createdAt,
    items,
  };
}

export default defineAction({
  description:
    "Return which Creative Context items, if any, were actually used the " +
    "last time this specific design file was generated or regenerated — " +
    "from the provenance generate-design already records, not a new lookup. " +
    "Use this to answer 'was Creative Context used for this screen' instead " +
    "of re-running a search. Read-only.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    fileId: z.string().describe("Design file ID to check"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, fileId }): Promise<DesignContextUsageResult> => {
    await assertAccess("design", designId, "viewer");

    const db = getDb();
    const [file] = await db
      .select({
        id: schema.designFiles.id,
        filename: schema.designFiles.filename,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.id, fileId),
        ),
      )
      .limit(1);
    if (!file) return { available: false, usedContext: false, items: [] };

    const rawSession = (await readAppState(
      designGenerationSessionKey(designId),
    ).catch(() => null)) as DesignGenerationSession | null;
    const session =
      rawSession?.designId === designId ? rawSession : null;

    const record = await getGenerationCreativeContext({
      appId: "design",
      artifactType: "design",
      artifactId: designId,
    });

    return selectDesignContextUsage(
      record,
      candidateElementIds(fileId, file.filename, session),
    );
  },
});
