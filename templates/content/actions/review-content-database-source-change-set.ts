import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseResponse,
  ReviewContentDatabaseSourceChangeSetRequest,
} from "../shared/api.js";
import {
  getExistingSource,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const reviewableStates = new Set([
  "proposed",
  "pending_push",
  "staged_revision",
  "approved",
]);

export default defineAction({
  description:
    "Approve or reject a local source change-set review record. This only records review state and never calls external providers.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    changeSetId: z.string().describe("Source change-set ID"),
    decision: z
      .enum(["approve", "reject"])
      .describe("Local review decision to record"),
    note: z.string().optional().describe("Optional local review note"),
  }),
  run: async (
    args: ReviewContentDatabaseSourceChangeSetRequest,
  ): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const source = await getExistingSource(database.id);
    if (!source) throw new Error("Attach a source before reviewing changes.");

    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        and(
          eq(schema.contentDatabaseSourceChangeSets.id, args.changeSetId),
          eq(schema.contentDatabaseSourceChangeSets.sourceId, source.id),
        ),
      );
    if (!changeSet) throw new Error("Source change-set not found.");
    if (!reviewableStates.has(changeSet.state)) {
      throw new Error(`Change-set state is not reviewable: ${changeSet.state}`);
    }

    if (changeSet.state === "approved" && args.decision === "reject") {
      const [execution] = await getDb()
        .select({ id: schema.contentDatabaseSourceExecutions.id })
        .from(schema.contentDatabaseSourceExecutions)
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.sourceId, source.id),
            eq(
              schema.contentDatabaseSourceExecutions.changeSetId,
              changeSet.id,
            ),
          ),
        )
        .limit(1);
      if (execution) {
        throw new Error(
          "Cannot reject an approved change-set after an execution gate has been prepared.",
        );
      }
    }

    const now = new Date().toISOString();
    const stateTo = args.decision === "approve" ? "approved" : "rejected";
    const reviewerEmail =
      getRequestUserEmail() ?? "agent-runtime@agent-native.local";

    await getDb()
      .insert(schema.contentDatabaseSourceChangeReviews)
      .values({
        id: crypto.randomUUID(),
        ownerEmail: database.ownerEmail,
        sourceId: source.id,
        changeSetId: changeSet.id,
        reviewerEmail,
        decision: stateTo,
        stateFrom: changeSet.state,
        stateTo,
        note: args.note?.trim() || null,
        createdAt: now,
      });

    await getDb()
      .update(schema.contentDatabaseSourceChangeSets)
      .set({
        state: stateTo,
        updatedAt: now,
      })
      .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSet.id));

    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    return getContentDatabaseResponse(database.id);
  },
});
