import {
  defineAction,
  defineActionErrors,
  fail,
} from "@agent-native/core/action";
import { visualEditCapabilityDesignId } from "@agent-native/core/server";
import {
  getRequestAuthCapability,
  getRequestCapabilitySessionId,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import "../server/db/index.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import { readTweakSelectionsRevision } from "../shared/resolve-tweaks.js";

const errors = defineActionErrors(
  "invalid_design_state",
  "design_data_conflict",
);

function firstOrUndefined<T>(rows: T[]): T | undefined {
  return rows.length > 0 ? rows[0] : undefined;
}

export default defineAction({
  description:
    "Discard pending design edits without applying them to source: reset tweak selections to tweakSourceBaseline and clear the exact visual-edit handoff revision and publisherId. Read get-visual-edit-pending first and pass its tweakSelectionsRevision as expectedTweakSelectionsRevision; the action rejects a stale selection snapshot instead of discarding a newer collaborator tweak. The handoff author or design owner can clear it; a design-scoped browser capability can clear only the handoff published by that same browser session. Clearing another publisher's handoff requires owner access. A frontend-only local-preview clear returns cleared=false and handoffPending=true when a collaborator's handoff remains; it does not discard that shared handoff or its tweaks.",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
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
    expectedTweakSelectionsRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .describe(
        "Exact tweakSelectionsRevision from get-visual-edit-pending, or the editor's current persisted tweak revision for a local-only clear.",
      ),
  }),
  outputSchema: z.object({
    designId: z.string(),
    cleared: z.boolean(),
    stale: z.boolean(),
    revision: z.number().int().positive().nullable(),
    resetTweakSelections: z.boolean(),
    handoffCleared: z.boolean(),
    handoffPending: z.boolean(),
  }),
  errors,
  requiresAuth: false,
  agentTool: true,
  mcpTool: true,
  capabilityScopes: ["visual-edit"],
  http: { method: "POST" },
  run: async (
    { designId, revision, publisherId, expectedTweakSelectionsRevision },
    ctx,
  ) => {
    const access = await assertAccess("design", designId, "editor");
    if ((revision === undefined) !== (publisherId === undefined)) {
      fail("revision and publisherId must be provided together.", {
        errorCode: "invalid_design_state",
        statusCode: 400,
      });
    }

    return withDesignSourceMutationTransaction(designId, async (tx) => {
      const designs = await tx
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId))
        .limit(1);
      const design = firstOrUndefined(designs);
      if (!design) {
        fail("Design data is unavailable while clearing pending edits.", {
          errorCode: "invalid_design_state",
          statusCode: 404,
        });
      }

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(design.data);
      } catch {
        fail("Design data is unreadable; pending edits were not cleared.", {
          errorCode: "invalid_design_state",
          statusCode: 409,
        });
      }
      if (
        !parsedData ||
        typeof parsedData !== "object" ||
        Array.isArray(parsedData)
      ) {
        fail("Design data is unreadable; pending edits were not cleared.", {
          errorCode: "invalid_design_state",
          statusCode: 409,
        });
      }
      const data = parsedData as Record<string, unknown>;

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
      const tweakSelectionsRevision = readTweakSelectionsRevision(data);
      if (
        tweakSelectionsRevision === null ||
        tweakSelectionsRevision === Number.MAX_SAFE_INTEGER
      ) {
        fail(
          "The tweak selection revision is unreadable; pending edits were not cleared.",
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
          authorEmail: schema.designVisualEditPending.authorEmail,
          publisherSessionHash:
            schema.designVisualEditPending.publisherSessionHash,
          status: schema.designVisualEditPending.status,
          pendingEditCount: schema.designVisualEditPending.pendingEditCount,
        })
        .from(schema.designVisualEditPending)
        .where(eq(schema.designVisualEditPending.designId, designId))
        .limit(1);
      const pending = firstOrUndefined(pendingRows);
      const hasHandoff =
        pending !== undefined &&
        (pending.status !== "empty" || pending.pendingEditCount > 0);
      const handoffMatches =
        pending !== undefined &&
        (pending.status !== "empty" || pending.pendingEditCount > 0) &&
        pending.revision === revision &&
        pending.publisherId === publisherId;
      if (
        (revision !== undefined || publisherId !== undefined) &&
        !handoffMatches
      ) {
        return {
          designId,
          cleared: false,
          stale: true,
          revision: pending?.revision ?? null,
          resetTweakSelections: false,
          handoffCleared: false,
          handoffPending: hasHandoff,
        };
      }
      const capabilityOwnsHandoff =
        ctx?.caller === "frontend" &&
        visualEditCapabilityDesignId(getRequestAuthCapability()) === designId &&
        Boolean(getRequestCapabilitySessionId()) &&
        pending?.publisherSessionHash === getRequestCapabilitySessionId() &&
        pending !== undefined &&
        revision !== undefined &&
        revision === pending.revision &&
        publisherId === pending.publisherId;
      if (
        pending &&
        hasHandoff &&
        (revision === undefined || publisherId === undefined) &&
        ctx?.caller === "frontend" &&
        access.role !== "owner" &&
        (!ctx.userEmail || pending.authorEmail !== ctx.userEmail)
      ) {
        return {
          designId,
          cleared: false,
          stale: false,
          revision: pending.revision,
          resetTweakSelections: false,
          handoffCleared: false,
          handoffPending: true,
        };
      }
      if (hasHandoff && (revision === undefined || publisherId === undefined)) {
        fail("Read the current handoff before clearing it.", {
          errorCode: "invalid_design_state",
          statusCode: 409,
        });
      }
      if (
        hasHandoff &&
        pending &&
        access.role !== "owner" &&
        (!ctx?.userEmail || pending.authorEmail !== ctx.userEmail) &&
        !capabilityOwnsHandoff
      ) {
        fail("Only the handoff author or design owner can clear these edits.", {
          errorCode: "invalid_design_state",
          statusCode: 403,
        });
      }
      if (tweakSelectionsRevision !== expectedTweakSelectionsRevision) {
        return {
          designId,
          cleared: false,
          stale: true,
          revision: pending?.revision ?? null,
          resetTweakSelections: false,
          handoffCleared: false,
          handoffPending: hasHandoff,
        };
      }
      const nextData = JSON.stringify({
        ...data,
        tweakSelections: nextSelections,
        tweakSelectionsRevision: tweakSelectionsRevision + 1,
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
              revision: sql`${schema.designVisualEditPending.revision} + 1`,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(schema.designVisualEditPending.designId, designId),
                eq(schema.designVisualEditPending.revision, revision),
                eq(schema.designVisualEditPending.publisherId, publisherId),
                eq(schema.designVisualEditPending.status, pending.status),
                eq(
                  schema.designVisualEditPending.pendingEditCount,
                  pending.pendingEditCount,
                ),
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
        handoffPending: hasHandoff && !clearHandoff,
      };
    });
  },
});
