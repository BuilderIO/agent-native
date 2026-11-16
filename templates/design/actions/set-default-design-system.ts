import { defineAction, fail } from "@agent-native/core/action";
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
  run: async ({ id, isDefault }) => {
    await assertAccess("design-system", id, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("Sign in to change the default design system.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId();

    const targets = await db
      .select({
        ownerEmail: schema.designSystems.ownerEmail,
        orgId: schema.designSystems.orgId,
      })
      .from(schema.designSystems)
      .where(eq(schema.designSystems.id, id))
      .limit(1);
    const target = targets.length > 0 ? targets[0] : undefined;

    if (!target) {
      fail("Design system not found.", {
        errorCode: "design_system_not_found",
        statusCode: 404,
      });
    }
    if (
      target.ownerEmail !== userEmail ||
      (target.orgId ?? null) !== (orgId ?? null)
    ) {
      fail("Only the owner can set a design system as default", {
        errorCode: "design_system_not_owner",
        statusCode: 403,
      });
    }

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
