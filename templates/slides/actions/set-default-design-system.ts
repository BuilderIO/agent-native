import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Set or unset a design system as the default for the current user and organization.",
  schema: z.object({
    id: z.string().describe("Design system ID to set as default"),
    isDefault: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether this design system should be the default"),
  }),
  run: async ({ id, isDefault = true }) => {
    await assertAccess("design-system", id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    const [target] = await db
      .select({
        ownerEmail: schema.designSystems.ownerEmail,
        orgId: schema.designSystems.orgId,
      })
      .from(schema.designSystems)
      .where(eq(schema.designSystems.id, id))
      .limit(1);

    if (
      target?.ownerEmail !== userEmail ||
      (target.orgId ?? null) !== (orgId ?? null)
    ) {
      throw new Error("Only the owner can set a design system as default");
    }

    // Use a transaction to atomically unset all defaults then set the new one.
    // Without a transaction, concurrent set-default requests can interleave and
    // leave multiple design systems marked as default.
    // Only unset/set design systems owned by this user — isDefault is a per-owner
    // flag and must not bleed across users when operating on shared resources.
    await db.transaction(async (tx) => {
      const targetScope = orgId
        ? and(
            eq(schema.designSystems.ownerEmail, userEmail),
            eq(schema.designSystems.orgId, orgId),
          )
        : and(
            eq(schema.designSystems.ownerEmail, userEmail),
            isNull(schema.designSystems.orgId),
          );

      if (isDefault) {
        await tx
          .update(schema.designSystems)
          .set({ isDefault: false, updatedAt: now })
          .where(targetScope);
      }

      await tx
        .update(schema.designSystems)
        .set({ isDefault, updatedAt: now })
        .where(and(eq(schema.designSystems.id, id), targetScope));
    });

    return { id, isDefault };
  },
});
