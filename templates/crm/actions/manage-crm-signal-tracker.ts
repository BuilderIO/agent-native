import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const inputSchema = z
  .object({
    trackerId: z.string().trim().min(1).max(128),
    operation: z.enum(["set-enabled", "delete"]),
    enabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.operation === "set-enabled" && value.enabled === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "enabled is required when changing a tracker state.",
      });
    }
    if (value.operation === "delete" && value.enabled !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "enabled cannot be provided when deleting a tracker.",
      });
    }
  });

export default defineAction({
  description:
    "Enable, disable, or delete one access-scoped local CRM signal tracker. This never invokes a model or changes a connected provider.",
  schema: inputSchema,
  audit: {
    target: (_args, result) => {
      const tracker = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-signal-tracker",
        id: tracker.id,
        ownerEmail: tracker.ownerEmail,
        orgId: tracker.orgId,
        visibility: tracker.visibility,
      };
    },
    summary: (args) =>
      args.operation === "delete"
        ? `Deleted CRM signal tracker ${args.trackerId}`
        : `${args.enabled ? "Enabled" : "Disabled"} CRM signal tracker ${args.trackerId}`,
  },
  run: async (args) => {
    await assertAccess("crm-signal-tracker", args.trackerId, "editor");
    const db = getDb();
    const [tracker] = await db
      .select()
      .from(schema.crmSignalTrackers)
      .where(eq(schema.crmSignalTrackers.id, args.trackerId))
      .limit(1);
    if (!tracker) throw new Error("CRM signal tracker was not found.");

    if (args.operation === "delete") {
      await db
        .delete(schema.crmSignalTrackers)
        .where(eq(schema.crmSignalTrackers.id, args.trackerId));
      return { ...tracker, deleted: true };
    }

    const now = new Date().toISOString();
    await db
      .update(schema.crmSignalTrackers)
      .set({ enabled: args.enabled!, updatedAt: now })
      .where(eq(schema.crmSignalTrackers.id, args.trackerId));
    const [updated] = await db
      .select()
      .from(schema.crmSignalTrackers)
      .where(eq(schema.crmSignalTrackers.id, args.trackerId))
      .limit(1);
    if (!updated)
      throw new Error("CRM signal tracker could not be verified after saving.");
    return updated;
  },
});
