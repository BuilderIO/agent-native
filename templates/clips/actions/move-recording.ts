import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  parseSpaceIds,
  requireActiveOrganizationId,
  sameOwnerEmail,
} from "../server/lib/recordings.js";

const moveRecordingSchema = z
  .object({
    id: z.string().min(1).optional().describe("Recording id"),
    ids: z
      .array(z.string().min(1))
      .optional()
      .describe("Recording ids for a bulk move"),
    folderId: z
      .string()
      .nullish()
      .describe("Target folder id, or null for the library/space root"),
  })
  .refine((args) => Boolean(args.id) || Boolean(args.ids?.length), {
    message: "Provide either id or ids.",
  });

function uniqueRecordingIds(args: z.infer<typeof moveRecordingSchema>) {
  return Array.from(
    new Set([...(args.id ? [args.id] : []), ...(args.ids ?? [])]),
  );
}

export default defineAction({
  description:
    "Move one or more recordings to a different folder (or to the library/space root when folderId is null).",
  schema: moveRecordingSchema,
  run: async (args) => {
    const ids = uniqueRecordingIds(args);
    const primaryId = ids[0];
    if (!primaryId) throw new Error("Provide either id or ids.");

    for (const id of ids) {
      await assertAccess("recording", id, "editor");
    }

    const db = getDb();
    const now = new Date().toISOString();
    const folderId = args.folderId ?? null;
    const ownerEmail = getCurrentOwnerEmail();
    const organizationId = await requireActiveOrganizationId();

    if (folderId) {
      const [folder] = await db
        .select({
          id: schema.folders.id,
          organizationId: schema.folders.organizationId,
          ownerEmail: schema.folders.ownerEmail,
          spaceId: schema.folders.spaceId,
        })
        .from(schema.folders)
        .where(
          and(
            eq(schema.folders.id, folderId),
            eq(schema.folders.organizationId, organizationId),
          ),
        )
        .limit(1);

      if (
        !folder ||
        (!folder.spaceId && !sameOwnerEmail(folder.ownerEmail, ownerEmail))
      ) {
        throw new Error(`Folder not found: ${folderId}`);
      }

      const rows = await db
        .select({
          id: schema.recordings.id,
          organizationId: schema.recordings.organizationId,
          spaceIds: schema.recordings.spaceIds,
        })
        .from(schema.recordings)
        .where(inArray(schema.recordings.id, ids));

      if (rows.length !== ids.length) {
        throw new Error("One or more recordings were not found.");
      }

      const incompatible = rows.some((recording) => {
        if (recording.organizationId !== folder.organizationId) return true;
        return (
          folder.spaceId !== null &&
          !parseSpaceIds(recording.spaceIds).includes(folder.spaceId)
        );
      });
      if (incompatible) {
        throw new Error(
          "Target folder must belong to the same organization and space as every recording.",
        );
      }
    }

    await db
      .update(schema.recordings)
      .set({ folderId, updatedAt: now })
      .where(
        and(
          ids.length === 1
            ? eq(schema.recordings.id, primaryId)
            : inArray(schema.recordings.id, ids),
          eq(schema.recordings.organizationId, organizationId),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: primaryId, ids, count: ids.length, folderId };
  },
});
