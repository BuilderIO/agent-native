import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireCrmListEntry } from "./_crm-list-utils.js";

export default defineAction({
  description:
    "Remove one entry from a CRM list. This deletes the list membership and the values held on that entry only. The underlying CRM record, its own attributes, and any other entries it has — in this list or another — are left completely intact. It is NOT a way to delete a record.",
  schema: z.object({
    entryId: z.string().trim().min(1).max(128),
  }),
  audit: {
    target: (_args, result) => {
      const entry = result as {
        entryId: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org" | "public";
      };
      return {
        type: "crm-list-entry",
        id: entry.entryId,
        ownerEmail: entry.ownerEmail,
        orgId: entry.orgId,
        visibility: entry.visibility,
      };
    },
    summary: (args) => `Removed CRM list entry ${args.entryId}`,
  },
  run: async (args) => {
    const db = getDb();
    const entry = await requireCrmListEntry(db, args.entryId, "editor");

    await db.transaction(async (tx) => {
      // Entry-scoped value rows only: `entry_id` is the record-vs-entry
      // discriminator, so the record's own attribute history is untouched.
      await tx
        .delete(schema.crmRecordFields)
        .where(
          and(
            eq(schema.crmRecordFields.entryId, entry.id),
            accessFilter(
              schema.crmRecordFields,
              schema.crmRecordFieldShares,
              undefined,
              "editor",
            ),
          ),
        );
      await tx
        .delete(schema.crmListEntries)
        .where(
          and(
            eq(schema.crmListEntries.id, entry.id),
            accessFilter(
              schema.crmListEntries,
              schema.crmListEntryShares,
              undefined,
              "editor",
            ),
          ),
        );
    });

    return {
      entryId: entry.id,
      listId: entry.listId,
      recordId: entry.recordId,
      removed: true as const,
      recordDeleted: false as const,
      ownerEmail: entry.ownerEmail,
      orgId: entry.orgId,
      visibility: entry.visibility,
    };
  },
});
