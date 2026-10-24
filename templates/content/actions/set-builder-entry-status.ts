import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  SetBuilderEntryStatusRequest,
  SetBuilderEntryStatusResponse,
} from "../shared/api.js";
import { withBuilderCmsPublicationIntent } from "./_builder-cms-unpublished-changes.js";
import {
  builderEntryStatusLockedReason,
  builderEntryStatusPick,
  builderEntryStatusTargets,
  parseBuilderEntrySourceValues,
} from "./_builder-entry-status.js";
import { writeBuilderStatusValues } from "./_builder-status-property.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import { resolveDatabaseForSourceMutation } from "./_database-source-utils.js";

const LOCKED_MESSAGES = {
  publication_transitions_off:
    'Builder status can only be changed when the source is set to "Publish updates" with per-item publish and unpublish allowed.',
  unmatched_entry:
    "This page isn't matched to a Builder entry yet. Refresh the source first.",
  unreadable_row:
    "This page's Builder values can't be read. Refresh the source first.",
  unknown_state:
    "Builder hasn't reported this entry as published or draft. Refresh the source first.",
} as const;

export default defineAction({
  description:
    "Stage a publish or unpublish for one collection page's Builder entry by picking its Builder status. Nothing is sent to Builder: the change waits in the source review, where the push still has to select the publish or unpublish (unpublish also needs confirmUnpublish). Picking the entry's current Builder status clears a staged change. Needs a Builder source in publish updates mode with publication transitions allowed. Published can't be picked while Builder's editor holds unpublished changes Content can't see.",
  schema: z.object({
    databaseId: z.string().describe("Collection ID"),
    documentId: z
      .string()
      .describe(
        "Document ID of the collection page whose Builder entry changes",
      ),
    status: z
      .enum(["published", "draft"])
      .describe("Builder status to stage for the entry"),
    sourceId: z
      .string()
      .optional()
      .describe(
        "Builder source ID; required only when the page belongs to more than one Builder source",
      ),
  }),
  // Staging never calls Builder; execute-builder-source-execution sends the
  // push. It replaces or clears a staged publish or unpublish, so destructive.
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (
    args: SetBuilderEntryStatusRequest,
  ): Promise<SetBuilderEntryStatusResponse> => {
    const database = await resolveDatabaseForSourceMutation({
      databaseId: args.databaseId,
    });
    if (!database) {
      fail("Collection not found.", {
        errorCode: "database_not_found",
        statusCode: 404,
      });
    }
    await assertAccess("document", database.documentId, "editor");

    const db = getDb();
    const targets = (
      await builderEntryStatusTargets(db, {
        databaseId: database.id,
        documentId: args.documentId,
      })
    ).filter((target) => !args.sourceId || target.source.id === args.sourceId);
    if (targets.length === 0) {
      fail("This page has no Builder entry in this collection.", {
        errorCode: "builder_entry_not_found",
        statusCode: 404,
      });
    }
    if (targets.length > 1) {
      fail(
        "This page belongs to more than one Builder source; pass sourceId to pick one.",
        { errorCode: "builder_source_ambiguous", statusCode: 400 },
      );
    }
    const [target] = targets;
    const locked = builderEntryStatusLockedReason(target);
    if (locked) {
      fail(LOCKED_MESSAGES[locked], {
        errorCode: `builder_status_${locked}`,
        statusCode: 409,
      });
    }

    const now = new Date().toISOString();
    const stagedPublicationTransition = await db.transaction(async (tx) => {
      // Refreshes and pushes rewrite the row under this lock, so the staged
      // change is applied to the values they last stored.
      await lockDatabaseMemberships(tx, [target.row.databaseItemId]);
      const [row] = await tx
        .select({
          sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
        })
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.id, target.row.id))
        .limit(1);
      if (!row) {
        fail("This page's Builder entry left the source. Refresh it first.", {
          errorCode: "builder_entry_not_found",
          statusCode: 409,
        });
      }
      const sourceValues = parseBuilderEntrySourceValues(row.sourceValuesJson);
      if (!sourceValues) {
        fail(LOCKED_MESSAGES.unreadable_row, {
          errorCode: "builder_status_unreadable_row",
          statusCode: 409,
        });
      }
      const pick = builderEntryStatusPick(sourceValues, args.status);
      if (!pick.ok) {
        fail(
          pick.reason === "builder_editor_changes"
            ? "This entry has unpublished changes saved in Builder's editor, which Content can't see. Publish it from Builder."
            : LOCKED_MESSAGES.unknown_state,
          { errorCode: `builder_status_${pick.reason}`, statusCode: 409 },
        );
      }
      const next = withBuilderCmsPublicationIntent(
        sourceValues,
        pick.transition,
      );
      await tx
        .update(schema.contentDatabaseSourceRows)
        .set({ sourceValuesJson: JSON.stringify(next), updatedAt: now })
        .where(eq(schema.contentDatabaseSourceRows.id, target.row.id));
      await writeBuilderStatusValues(tx, {
        sourceId: target.source.id,
        rows: [{ documentId: args.documentId, sourceValues: next }],
        now,
      });
      return pick.transition;
    });

    return {
      documentId: args.documentId,
      sourceId: target.source.id,
      stagedPublicationTransition,
    };
  },
});
