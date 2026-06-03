import { defineAction } from "@agent-native/core";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  assertContractEditor,
  contractStatusSchema,
  itemInputSchema,
  loadContractBundle,
  nowIso,
  writeEvent,
} from "./_contracts.js";

export default defineAction({
  description:
    "Record agent progress against a Visual Plan, update status/phase, and mark feedback as consumed after incorporating it.",
  schema: z.object({
    contractId: z.string().describe("Visual Plan ID"),
    status: contractStatusSchema.optional(),
    currentPhase: z.string().optional(),
    items: z.array(itemInputSchema).optional().default([]),
    consumedFeedbackIds: z.array(z.string()).optional().default([]),
    note: z.string().optional(),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Record Visual Plan progress",
    description:
      "Record task progress and acknowledge feedback consumed by the coding agent.",
  },
  run: async (args) => {
    await assertContractEditor(args.contractId);
    const db = getDb();
    const now = nowIso();
    if (args.status || args.currentPhase) {
      await db
        .update(schema.contracts)
        .set({
          ...(args.status ? { status: args.status } : {}),
          ...(args.currentPhase ? { currentPhase: args.currentPhase } : {}),
          updatedAt: now,
          ...(args.status === "approved" ? { approvedAt: now } : {}),
        })
        .where(eq(schema.contracts.id, args.contractId));
    }
    for (const item of args.items) {
      if (!item.id) continue;
      await db
        .update(schema.contractItems)
        .set({
          title: item.title,
          body: item.body,
          status: item.status,
          risk: item.risk,
          reviewState: item.reviewState,
          actedOn: item.actedOn,
          impactSummary: item.impactSummary ?? null,
          affectedFiles: JSON.stringify(item.affectedFiles),
          sourceRefs: JSON.stringify(item.sourceRefs),
          linkedItemIds: JSON.stringify(item.linkedItemIds),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.contractItems.id, item.id),
            eq(schema.contractItems.contractId, args.contractId),
          ),
        );
    }
    if (args.consumedFeedbackIds.length > 0) {
      await db
        .update(schema.contractFeedback)
        .set({ consumedAt: now })
        .where(
          and(
            eq(schema.contractFeedback.contractId, args.contractId),
            inArray(schema.contractFeedback.id, args.consumedFeedbackIds),
          ),
        );
    }
    await writeEvent({
      contractId: args.contractId,
      type: "contract.progress.recorded",
      message: args.note || "Progress recorded.",
      createdBy: "agent",
    });
    return loadContractBundle(args.contractId);
  },
});
