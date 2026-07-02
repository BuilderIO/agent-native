import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ContentDatabaseResponse } from "../shared/api.js";
import {
  findOpenSourceChangeSet,
  getContentDatabaseSourceSnapshotForWrite,
  resolveDatabaseForSourceMutation,
  sourceChangeSetKey,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

export default defineAction({
  description:
    "Stage pending local Builder CMS changes as a local-only save-revision review record. This never calls Builder APIs or performs external writes.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target source ID (defaults to the primary source)"),
  }),
  run: async (args): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const source = await getContentDatabaseSourceSnapshotForWrite(
      database,
      args.sourceId,
    );
    if (!source || source.sourceType !== "builder-cms") {
      throw new Error("Attach a Builder CMS source before staging a revision.");
    }

    const pendingOutboundChanges = source.changeSets.filter(
      (changeSet) =>
        changeSet.direction === "outbound" &&
        changeSet.state === "pending_push",
    );

    if (pendingOutboundChanges.length === 0) {
      throw new Error("No pending local Builder changes to stage.");
    }

    const now = new Date().toISOString();
    for (const changeSet of pendingOutboundChanges) {
      const key = sourceChangeSetKey({
        documentId: changeSet.documentId,
        databaseItemId: changeSet.databaseItemId,
        kind: changeSet.kind,
        direction: "outbound",
        pushMode: "autosave",
        fieldChanges: changeSet.fieldChanges,
        bodyChange: changeSet.bodyChange,
      });
      const existing = await findOpenSourceChangeSet({
        sourceId: source.id,
        key,
        states: ["pending_push", "staged_revision"],
      });
      const summary = changeSet.summary.replace(
        /^Pending local Builder CMS/,
        "Staged local-only Builder CMS",
      );

      if (existing) {
        await getDb()
          .update(schema.contentDatabaseSourceChangeSets)
          .set({
            direction: "outbound",
            state: "staged_revision",
            pushMode: "autosave",
            localOnly: 1,
            summary,
            fieldChangesJson: JSON.stringify(changeSet.fieldChanges),
            bodyChangeJson: changeSet.bodyChange
              ? JSON.stringify(changeSet.bodyChange)
              : null,
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseSourceChangeSets.id, existing.id));
      } else {
        await getDb()
          .insert(schema.contentDatabaseSourceChangeSets)
          .values({
            id: crypto.randomUUID(),
            ownerEmail: database.ownerEmail,
            sourceId: source.id,
            databaseItemId: changeSet.databaseItemId,
            documentId: changeSet.documentId,
            kind: changeSet.kind,
            direction: "outbound",
            state: "staged_revision",
            pushMode: "autosave",
            localOnly: 1,
            summary,
            fieldChangesJson: JSON.stringify(changeSet.fieldChanges),
            bodyChangeJson: changeSet.bodyChange
              ? JSON.stringify(changeSet.bodyChange)
              : null,
            createdAt: now,
            updatedAt: now,
          });
      }
    }

    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    return getContentDatabaseResponse(database.id);
  },
});
