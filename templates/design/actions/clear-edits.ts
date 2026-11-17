import {
  defineAction,
  defineActionErrors,
  fail,
} from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";

const errors = defineActionErrors(
  "invalid_design_state",
  "design_data_conflict",
);

export default defineAction({
  description:
    "Discard pending design edits without applying them to source: reset tweak selections to tweakSourceBaseline and clear the exact visual-edit handoff revision owned by publisherId. Read get-visual-edit-pending first when a handoff exists and pass its revision and publisherId.",
  schema: z.object({
    designId: z
      .string()
      .min(1)
      .describe("Design whose pending edits to clear."),
    revision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Exact revision from get-visual-edit-pending when clearing its durable handoff.",
      ),
    publisherId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Exact publisherId from get-visual-edit-pending when clearing its durable handoff.",
      ),
  }),
  outputSchema: z.object({
    designId: z.string(),
    cleared: z.boolean(),
    stale: z.boolean(),
    revision: z.number().int().positive().nullable(),
    resetTweakSelections: z.boolean(),
    handoffCleared: z.boolean(),
  }),
  errors,
  requiresAuth: false,
  agentTool: true,
  mcpTool: true,
  capabilityScopes: ["visual-edit"],
  http: { method: "POST" },
  run: async ({ designId, revision, publisherId }) => {
    await assertAccess("design", designId, "editor");
    if ((revision === undefined) !== (publisherId === undefined)) {
      fail("revision and publisherId must be provided together.", {
        errorCode: "invalid_design_state",
        statusCode: 400,
      });
    }

    return getDb().transaction(async (tx) => {
      const designs = await tx
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId))
        .limit(1);
      const design = designs[0];
      if (!design) {
        fail("Design data is unavailable while clearing pending edits.", {
          errorCode: "invalid_design_state",
          statusCode: 404,
        });
      }

      let data: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(design.data);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Design data must be an object.");
        }
        data = parsed as Record<string, unknown>;
      } catch {
        fail("Design data is unreadable; pending edits were not cleared.", {
          errorCode: "invalid_design_state",
          statusCode: 409,
        });
      }

      const baseline = data.tweakSourceBaseline;
      if (
        baseline !== undefined &&
        (!baseline || typeof baseline !== "object" || Array.isArray(baseline))
      ) {
        fail(
          "The tweak source baseline is unreadable; pending edits were not cleared.",
          {
            errorCode: "invalid_design_state",
            statusCode: 409,
          },
        );
      }
      const nextSelections = (baseline ?? {}) as Record<string, unknown>;

      const pendingRows = await tx
        .select({
          revision: schema.designVisualEditPending.revision,
          publisherId: schema.designVisualEditPending.publisherId,
          status: schema.designVisualEditPending.status,
          pendingEditCount: schema.designVisualEditPending.pendingEditCount,
        })
        .from(schema.designVisualEditPending)
        .where(eq(schema.designVisualEditPending.designId, designId))
        .limit(1);
      const pending = pendingRows[0];
      const hasHandoff = Boolean(
        pending && (pending.status !== "empty" || pending.pendingEditCount > 0),
      );
      if (
        hasHandoff &&
        revision !== undefined &&
        publisherId !== undefined &&
        (pending?.revision !== revision || pending.publisherId !== publisherId)
      ) {
        return {
          designId,
          cleared: false,
          stale: true,
          revision: pending?.revision ?? null,
          resetTweakSelections: false,
          handoffCleared: false,
        };
      }

      const nextData = JSON.stringify({
        ...data,
        tweakSelections: nextSelections,
      });
      const updatedDesign = await tx
        .update(schema.designs)
        .set({ data: nextData })
        .where(
          and(
            eq(schema.designs.id, designId),
            eq(schema.designs.data, design.data),
          ),
        )
        .returning({ id: schema.designs.id });
      if (updatedDesign.length === 0) {
        fail(
          "Design data changed while clearing edits; read the latest state and retry.",
          {
            errorCode: "design_data_conflict",
            statusCode: 409,
          },
        );
      }

      const clearHandoff =
        hasHandoff && revision !== undefined && publisherId !== undefined;
      const clearedRows = clearHandoff
        ? await tx
            .update(schema.designVisualEditPending)
            .set({
              pendingEditCount: 0,
              status: "empty",
              prompt: "",
              handoffRecords: "[]",
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(schema.designVisualEditPending.designId, designId),
                eq(schema.designVisualEditPending.revision, revision),
                eq(schema.designVisualEditPending.publisherId, publisherId),
              ),
            )
            .returning({ revision: schema.designVisualEditPending.revision })
        : [];
      if (clearHandoff && clearedRows.length === 0) {
        fail(
          "The visual-edit handoff changed while clearing; read the latest revision and retry.",
          {
            errorCode: "design_data_conflict",
            statusCode: 409,
          },
        );
      }

      return {
        designId,
        cleared: true,
        stale: false,
        revision: clearedRows[0]?.revision ?? pending?.revision ?? null,
        resetTweakSelections: true,
        handoffCleared: clearHandoff,
      };
    });
  },
});
