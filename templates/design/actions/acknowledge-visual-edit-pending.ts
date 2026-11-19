import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import "../server/db/index.js";
import { assertVisualEditBoardDataSize } from "../server/lib/visual-edit-capability.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import {
  parseHandoffRecords,
  sameHandoffRecordValue,
} from "../shared/visual-edit-handoff.js";

export default defineAction({
  description:
    "KEY HANDOFF: Acknowledge source changes only after verification. A remote visual-edit revision is cleared by exact revision; an applied tweak advances its source baseline only when that active revision contains a tweak record with the same id and value. Tweaks that do not match stay pending. Cleared or stale revisions are not acknowledged; re-read get-visual-edit-pending and inspect source before retrying.",
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
      "After source verification, acknowledge only the exact active remote revision you applied and/or record only tweak IDs and values confirmed in source. Cleared or stale revisions return stale and do not advance the tweak source baseline.",
  },
  http: { method: "POST" },
  maxBodyBytes: 16 * 1_024,
  run: async ({ designId, revision, appliedTweaks = [] }) => {
    await assertAccess("design", designId, "editor");
    if (appliedTweaks.length > 0 && revision === undefined) {
      fail(
        "A tweak acknowledgement requires the exact pending handoff revision.",
        {
          errorCode: "visual_edit_revision_required",
          statusCode: 400,
        },
      );
    }

    const updated = await withDesignSourceMutationTransaction(
      designId,
      async (tx) => {
        const rows =
          revision === undefined
            ? []
            : await tx
                .select({
                  handoffRecords: schema.designVisualEditPending.handoffRecords,
                  status: schema.designVisualEditPending.status,
                })
                .from(schema.designVisualEditPending)
                .where(
                  and(
                    eq(schema.designVisualEditPending.designId, designId),
                    eq(schema.designVisualEditPending.revision, revision),
                    inArray(schema.designVisualEditPending.status, [
                      "ready",
                      "suggested",
                    ]),
                  ),
                )
                .limit(1);
        const handoff = rows.shift();
        if (handoff?.status === "suggested" && appliedTweaks.length > 0) {
          fail(
            "Suggested visual edits cannot advance the source tweak baseline. Get owner approval and a ready handoff before applying tweaks.",
            { errorCode: "unapproved_visual_edit_suggestion", statusCode: 409 },
          );
        }
        const acknowledged =
          handoff === undefined || revision === undefined
            ? []
            : await tx
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
                    inArray(schema.designVisualEditPending.status, [
                      "ready",
                      "suggested",
                    ]),
                  ),
                )
                .returning({
                  designId: schema.designVisualEditPending.designId,
                });

        const parsedRecords =
          acknowledged.length > 0 && handoff
            ? parseHandoffRecords(handoff.handoffRecords)
            : null;
        const revisionTweaks =
          parsedRecords?.status === "readable"
            ? parsedRecords.records.filter((record) => record.kind === "tweak")
            : [];
        const acknowledgedTweaks = appliedTweaks.filter((tweak) =>
          revisionTweaks.some(
            (record) =>
              record.key === tweak.id &&
              sameHandoffRecordValue(record.value, tweak.value),
          ),
        );
        const notAcknowledgedTweaks = appliedTweaks.filter(
          (tweak) => !acknowledgedTweaks.includes(tweak),
        );
        if (acknowledgedTweaks.length > 0) {
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
          for (const tweak of acknowledgedTweaks)
            nextBaseline[tweak.id] = tweak.value;
          const nextData = JSON.stringify({
            ...data,
            tweakSourceBaseline: nextBaseline,
          });
          assertVisualEditBoardDataSize(nextData);
          const saved = await tx
            .update(schema.designs)
            .set({ data: nextData })
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
            revision: schema.designVisualEditPending.revision,
          })
          .from(schema.designVisualEditPending)
          .where(eq(schema.designVisualEditPending.designId, designId))
          .limit(1);
        const currentPending = pending.length > 0 ? pending[0] : undefined;
        return {
          acknowledged,
          acknowledgedTweaks,
          notAcknowledgedTweaks,
          pending: currentPending ?? {
            status: "empty",
            pendingEditCount: 0,
            revision: null,
          },
        };
      },
    );

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
      tweakAcknowledgedCount: updated.acknowledgedTweaks.length,
      notAcknowledgedTweaks: updated.notAcknowledgedTweaks,
      stale: revision !== undefined && !cleared,
      next:
        cleared || revision === undefined
          ? updated.notAcknowledgedTweaks.length > 0
            ? "Some tweaks were not part of this revision with these values, so they stay pending. Call get-visual-edit-pending again and apply its latest revision."
            : "Call get-visual-edit-pending again to verify the handoff is empty."
          : updated.pending.status === "empty"
            ? `Revision ${revision} is no longer pending (current handoff revision ${updated.pending.revision ?? "unknown"}). Do not treat this response as an acknowledgement. Read get-visual-edit-pending and inspect source; if this discarded revision was applied, revert it.`
            : `A newer handoff replaced revision ${revision}; call get-visual-edit-pending and apply the latest revision instead.`,
    };
  },
});
