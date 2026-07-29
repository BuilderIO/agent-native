import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope } from "./_crm-action-utils.js";
import {
  crmActorFrom,
  indexAttributes,
  loadCrmListAttributes,
  requireCrmList,
  requireCrmListEntry,
  writeCrmListEntryValues,
} from "./_crm-list-utils.js";
import { listEntryValuesSchema } from "./add-crm-record-to-list.js";

export default defineAction({
  description:
    "Set values on a CRM list entry's own attributes and/or reorder it. Moving an entry to another stage is exactly this call: the previous value's row is closed and a new one opened, so time-in-stage is derivable from the entry's own history. Entry attributes belong to the list, not to the record — this never writes to the record or to a provider. An entry's values were copied from the record once, when it was added; they are not bound to it, so changing one here leaves the record's own value alone and a later record change does not reach the entry.",
  schema: z.object({
    entryId: z.string().trim().min(1).max(128),
    values: listEntryValuesSchema.optional(),
    position: z.number().int().min(0).max(100_000).optional(),
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
    summary: (args) => `Updated CRM list entry ${args.entryId}`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const db = getDb();
    const entry = await requireCrmListEntry(db, args.entryId, "editor");
    const list = await requireCrmList(db, entry.listId, "editor");
    const attributes = indexAttributes(
      await loadCrmListAttributes(db, list.id),
    );
    const actor = crmActorFrom(ctx);
    const now = new Date().toISOString();
    // Value rows inherit the ENTRY's ownership, not the caller's, so an editor
    // writing to a shared entry cannot fork its visibility.
    const ownership = {
      ownerEmail: entry.ownerEmail,
      orgId: entry.orgId,
      visibility: entry.visibility,
    };
    // Reject an unauthenticated caller the same way a fresh write would.
    requireCrmScope(ctx);

    const writes = await db.transaction(async (tx) => {
      if (args.position !== undefined) {
        await tx
          .update(schema.crmListEntries)
          .set({ position: args.position, updatedAt: now })
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
      }
      return writeCrmListEntryValues({
        db: tx,
        recordId: entry.recordId,
        entryId: entry.id,
        attributes,
        values: args.values ?? {},
        actor,
        ownership,
        now,
      });
    });

    return {
      entryId: entry.id,
      listId: list.id,
      recordId: entry.recordId,
      position: args.position ?? entry.position,
      values: writes,
      ...ownership,
    };
  },
});
