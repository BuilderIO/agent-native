import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const booleanArg = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

async function collectDocumentSubtreeIds({
  db,
  rootId,
  ownerEmail,
}: {
  db: ReturnType<typeof getDb>;
  rootId: string;
  ownerEmail: string;
}) {
  const ids = new Set<string>();
  const queue = [rootId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (ids.has(id)) continue;
    ids.add(id);

    const children = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, ownerEmail),
          eq(schema.documents.parentId, id),
        ),
      );
    for (const child of children) queue.push(child.id);
  }

  return Array.from(ids);
}

export default defineAction({
  description:
    "Control whether an organization-accessible document appears in organization-wide search/sidebar discovery. Hidden documents remain reachable to organization members with the link.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
    hideFromSearch: booleanArg.describe(
      "true hides the document from org search/sidebar discovery while keeping link access; false lists it normally.",
    ),
    includeChildren: booleanArg
      .optional()
      .default(true)
      .describe("Apply the same discoverability setting to child pages."),
  }),
  run: async (args) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");

    const access = await assertAccess("document", id, "admin");
    const existing = access.resource;
    const ownerEmail = existing.ownerEmail as string;
    const db = getDb();
    const ids = args.includeChildren
      ? await collectDocumentSubtreeIds({ db, rootId: id, ownerEmail })
      : [id];
    const now = new Date().toISOString();

    await db
      .update(schema.documents)
      .set({
        hideFromSearch: args.hideFromSearch ? 1 : 0,
        updatedAt: now,
      })
      .where(inArray(schema.documents.id, ids));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      ok: true,
      id,
      hideFromSearch: args.hideFromSearch,
      updated: ids.length,
    };
  },
});
