import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  assertContractEditor,
  loadContractBundle,
  newId,
  nowIso,
  writeEvent,
} from "./_contracts.js";
import { getDb, schema } from "../server/db/index.js";

const ASSUMPTION_PATTERNS = [
  /\b(?:assume|assuming|likely|probably|appears|seems|based on existing|use existing|should use)\b/i,
  /\b(?:auth|billing|migration|delete|permission|webhook|public api|test expectation|production config)\b/i,
];

export async function addPlanTextDetections(input: {
  contractId: string;
  planText: string;
}) {
  const now = nowIso();
  const lines = input.planText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean);
  const detected = lines
    .filter((line) => ASSUMPTION_PATTERNS.some((pattern) => pattern.test(line)))
    .slice(0, 8);
  const criteria = lines
    .filter((line) =>
      /\b(?:must|should|verify|test|acceptance|done when|ensure)\b/i.test(line),
    )
    .slice(0, 8);
  const rows = [
    ...detected.map((line) => ({
      id: newId("itm"),
      contractId: input.contractId,
      type: "assumption" as const,
      title: line.slice(0, 120),
      body: line,
      status: "detected",
      risk: /\b(?:auth|billing|migration|delete|permission|webhook|public api)\b/i.test(
        line,
      )
        ? ("high" as const)
        : ("medium" as const),
      reviewState: "unreviewed" as const,
      actedOn: "unknown" as const,
      impactSummary: "Detected from plan text; confirm before relying on it.",
      affectedFiles: "[]",
      sourceRefs: JSON.stringify(["plan-text"]),
      linkedItemIds: "[]",
      createdBy: "detector" as const,
      createdAt: now,
      updatedAt: now,
    })),
    ...criteria.map((line) => ({
      id: newId("itm"),
      contractId: input.contractId,
      type: "acceptance_criterion" as const,
      title: line.slice(0, 120),
      body: line,
      status: "missing",
      risk: "medium" as const,
      reviewState: "needs_evidence" as const,
      actedOn: "false" as const,
      impactSummary: "Detected proof obligation from plan text.",
      affectedFiles: "[]",
      sourceRefs: JSON.stringify(["plan-text"]),
      linkedItemIds: "[]",
      createdBy: "detector" as const,
      createdAt: now,
      updatedAt: now,
    })),
  ];
  if (rows.length > 0) {
    await getDb().insert(schema.contractItems).values(rows);
    await getDb()
      .update(schema.contracts)
      .set({ updatedAt: now })
      .where(eq(schema.contracts.id, input.contractId));
  }
  await writeEvent({
    contractId: input.contractId,
    type: "contract.plan.analyzed",
    message: `Detected ${detected.length} possible assumption(s) and ${criteria.length} possible criteria.`,
    createdBy: "detector",
  });
  return { detectedCount: detected.length, criteriaCount: criteria.length };
}

export default defineAction({
  description:
    "Analyze pasted plan text and add detected possible assumptions, decisions, proof gates, and visual-plan items. Detections are suggestions, not verified truth.",
  schema: z.object({
    contractId: z.string().describe("Visual Plan ID"),
    planText: z.string().min(1),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    title: "Analyze Visual Plan text",
    description:
      "Extract possible assumptions, decisions, and proof obligations from plan text.",
  },
  run: async (args) => {
    await assertContractEditor(args.contractId);
    await addPlanTextDetections({
      contractId: args.contractId,
      planText: args.planText,
    });
    return loadContractBundle(args.contractId);
  },
});
