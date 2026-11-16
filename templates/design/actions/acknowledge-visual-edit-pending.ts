import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "KEY HANDOFF: Acknowledge source changes only after verification. A remote visual-edit revision is cleared by exact revision; applied tweak IDs and values advance their source baseline only when included in this verified acknowledgement. Stale revisions are rejected without clearing newer edits.",
  schema: z.object({
    designId: z.string().describe("Visual-edit design ID."),
    revision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "The revision returned by get-visual-edit-pending, when acknowledging a remote visual edit.",
      ),
    appliedTweaks: z
      .array(
        z.object({
          id: z.string().min(1),
          value: z.union([z.string(), z.number(), z.boolean()]),
        }),
      )
      .optional()
      .describe("Tweak source values confirmed after verification."),
  }),
  requiresAuth: false,
  agentTool: false,
  mcpTool: true,
  capabilityScopes: ["visual-edit"],
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: false,
    title: "Mark visual edits applied",
    description:
      "After source verification, clear exactly the remote revision you applied and/or record only the tweak IDs and values confirmed in source.",
  },
  http: { method: "POST" },
  maxBodyBytes: 16 * 1_024,
  run: async ({ designId, revision, appliedTweaks = [] }) => {
    await assertAccess("design", designId, "editor");

    const updated = await getDb().transaction(async (tx) => {
      const acknowledged =
        revision === undefined
          ? []
          : await tx
              .update(schema.designVisualEditPending)
              .set({
                pendingEditCount: 0,
                status: "empty",
                prompt: "",
                updatedAt: new Date().toISOString(),
              })
              .where(
                and(
                  eq(schema.designVisualEditPending.designId, designId),
                  eq(schema.designVisualEditPending.revision, revision),
                ),
              )
              .returning({
                designId: schema.designVisualEditPending.designId,
              });

      if (
        (revision === undefined || acknowledged.length > 0) &&
        appliedTweaks.length > 0
      ) {
        const rows = await tx
          .select({ data: schema.designs.data })
          .from(schema.designs)
          .where(eq(schema.designs.id, designId))
          .limit(1);
        const row = rows.shift();
        if (row === undefined)
          fail(
            `Design ${designId} was not found while acknowledging applied tweaks.`,
            { errorCode: "not_found", statusCode: 404 },
          );
        const data = JSON.parse(row.data) as Record<string, unknown>;
        const baseline = data.tweakSourceBaseline;
        const nextBaseline =
          baseline && typeof baseline === "object" && !Array.isArray(baseline)
            ? { ...(baseline as Record<string, unknown>) }
            : {};
        for (const tweak of appliedTweaks) nextBaseline[tweak.id] = tweak.value;
        const saved = await tx
          .update(schema.designs)
          .set({
            data: JSON.stringify({
              ...data,
              tweakSourceBaseline: nextBaseline,
            }),
          })
          .where(
            and(
              eq(schema.designs.id, designId),
              eq(schema.designs.data, row.data),
            ),
          )
          .returning({ id: schema.designs.id });
        if (saved.length === 0)
          fail(
            "Design data changed while acknowledging applied tweaks; retry after re-reading.",
            { errorCode: "conflict", statusCode: 409 },
          );
      }
      const pending = await tx
        .select({
          status: schema.designVisualEditPending.status,
          pendingEditCount: schema.designVisualEditPending.pendingEditCount,
        })
        .from(schema.designVisualEditPending)
        .where(eq(schema.designVisualEditPending.designId, designId))
        .limit(1);
      return {
        acknowledged,
        tweakAcknowledgedCount:
          (revision === undefined || acknowledged.length > 0) &&
          appliedTweaks.length > 0
            ? appliedTweaks.length
            : 0,
        pending: pending[0] ?? { status: "empty", pendingEditCount: 0 },
      };
    });

    const cleared = updated.acknowledged.length > 0;
    return {
      designId,
      revision: revision ?? null,
      status: cleared
        ? "empty"
        : revision === undefined
          ? updated.pending.status
          : "stale",
      pendingEditCount: cleared
        ? 0
        : revision === undefined
          ? updated.pending.pendingEditCount
          : null,
      tweakAcknowledgedCount: updated.tweakAcknowledgedCount,
      stale: revision !== undefined && !cleared,
      next:
        cleared || revision === undefined
          ? "Call get-visual-edit-pending again to verify the handoff is empty."
          : "A newer handoff replaced this revision; call get-visual-edit-pending and apply the latest revision instead.",
    };
  },
});
