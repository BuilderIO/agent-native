import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  assertContractEditor,
  feedbackInputSchema,
  itemInputSchema,
  loadContractBundle,
  newId,
  nowIso,
  writeEvent,
} from "./_contracts.js";

export default defineAction({
  description:
    "Bulk create or update contract review items, and optionally add human feedback for the agent to consume.",
  schema: z.object({
    contractId: z.string(),
    items: z.array(itemInputSchema).optional().default([]),
    feedback: z.array(feedbackInputSchema).optional().default([]),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Update contract items",
    description:
      "Add or update material assumptions, decisions, criteria, deviations, and feedback.",
  },
  run: async (args) => {
    await assertContractEditor(args.contractId);
    const db = getDb();
    const now = nowIso();
    for (const item of args.items) {
      const id = item.id ?? newId("itm");
      const values = {
        id,
        contractId: args.contractId,
        type: item.type,
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
        createdBy: item.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      if (item.id) {
        const [existing] = await db
          .select({ id: schema.contractItems.id })
          .from(schema.contractItems)
          .where(
            and(
              eq(schema.contractItems.id, item.id),
              eq(schema.contractItems.contractId, args.contractId),
            ),
          );
        if (existing) {
          await db
            .update(schema.contractItems)
            .set({
              type: values.type,
              title: values.title,
              body: values.body,
              status: values.status,
              risk: values.risk,
              reviewState: values.reviewState,
              actedOn: values.actedOn,
              impactSummary: values.impactSummary,
              affectedFiles: values.affectedFiles,
              sourceRefs: values.sourceRefs,
              linkedItemIds: values.linkedItemIds,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.contractItems.id, item.id),
                eq(schema.contractItems.contractId, args.contractId),
              ),
            );
          continue;
        }
      }
      await db.insert(schema.contractItems).values(values);
    }
    if (args.feedback.length > 0) {
      await db.insert(schema.contractFeedback).values(
        args.feedback.map((feedback) => ({
          id: feedback.id ?? newId("fbk"),
          contractId: args.contractId,
          targetItemId: feedback.targetItemId ?? null,
          kind: feedback.kind,
          message: feedback.message,
          structuredPatch: feedback.structuredPatch
            ? JSON.stringify(feedback.structuredPatch)
            : null,
          consumedAt: null,
          createdAt: now,
        })),
      );
    }
    await db
      .update(schema.contracts)
      .set({ updatedAt: now })
      .where(eq(schema.contracts.id, args.contractId));
    await writeEvent({
      contractId: args.contractId,
      type: "contract.items.updated",
      message: `Updated ${args.items.length} item(s) and added ${args.feedback.length} feedback item(s).`,
      createdBy: "agent",
    });
    return loadContractBundle(args.contractId);
  },
});
