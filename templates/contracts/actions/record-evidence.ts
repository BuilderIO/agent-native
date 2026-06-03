import { defineAction } from "@agent-native/core";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  assertContractEditor,
  evidenceSourceSchema,
  evidenceTypeSchema,
  loadContractBundle,
  newId,
  nowIso,
  redactEvidenceText,
  redactionStatusSchema,
  trustLevelSchema,
  verificationStatusSchema,
  verifiedBySchema,
  writeEvent,
} from "./_contracts.js";

const evidenceInputSchema = z.object({
  id: z.string().optional(),
  linkedItemIds: z.array(z.string()).default([]),
  type: evidenceTypeSchema,
  source: evidenceSourceSchema.default("agent_attestation"),
  trustLevel: trustLevelSchema.default("low"),
  summary: z.string().min(1),
  content: z.string().optional(),
  rawOutputPath: z.string().optional(),
  cwd: z.string().optional(),
  command: z.string().optional(),
  exitCode: z.number().int().optional(),
  timestamp: z.string().optional(),
  redactionStatus: redactionStatusSchema.optional(),
  attachedBy: z.string().optional().default("agent"),
});

const verificationInputSchema = z.object({
  criterionItemId: z.string(),
  evidenceIds: z.array(z.string()).default([]),
  status: verificationStatusSchema,
  verifiedBy: verifiedBySchema.optional(),
  note: z.string().optional(),
});

export default defineAction({
  description:
    "Attach proof artifacts to a Visual Plan. Agents may attach evidence, but verified status requires human, CI, deterministic, or independent verifier provenance.",
  schema: z.object({
    contractId: z.string().describe("Visual Plan ID"),
    evidence: z.array(evidenceInputSchema).default([]),
    verifications: z.array(verificationInputSchema).optional().default([]),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Record Visual Plan proof",
    description:
      "Attach proof artifacts and trusted verification status for plan proof gates.",
  },
  run: async (args) => {
    await assertContractEditor(args.contractId);
    const db = getDb();
    const now = nowIso();
    const insertedEvidenceIds: string[] = [];
    const trustedEvidenceIds = new Set<string>();
    for (const item of args.evidence) {
      const id = item.id ?? newId("evd");
      const redactedContent = redactEvidenceText(item.content);
      const redactionStatus =
        item.redactionStatus ??
        (redactedContent.redacted ? "redacted" : "not_needed");
      const trustLevel =
        item.source === "agent_attestation" && item.trustLevel !== "low"
          ? "low"
          : item.trustLevel;
      await db.insert(schema.contractEvidence).values({
        id,
        contractId: args.contractId,
        linkedItemIds: JSON.stringify(item.linkedItemIds),
        type: item.type,
        source: item.source,
        trustLevel,
        summary: item.summary,
        content: redactedContent.text,
        rawOutputPath: item.rawOutputPath ?? null,
        cwd: item.cwd ?? null,
        command: item.command ?? null,
        exitCode: item.exitCode ?? null,
        timestamp: item.timestamp ?? now,
        redactionStatus,
        attachedBy: item.attachedBy,
        createdAt: now,
      });
      insertedEvidenceIds.push(id);
      if (trustLevel === "high" || trustLevel === "human_confirmed") {
        trustedEvidenceIds.add(id);
      }
    }
    if (
      args.verifications.some((verification) => verification.evidenceIds.length)
    ) {
      const existingEvidence = await db
        .select({
          id: schema.contractEvidence.id,
          source: schema.contractEvidence.source,
          trustLevel: schema.contractEvidence.trustLevel,
        })
        .from(schema.contractEvidence)
        .where(
          and(
            eq(schema.contractEvidence.contractId, args.contractId),
            inArray(
              schema.contractEvidence.id,
              args.verifications.flatMap(
                (verification) => verification.evidenceIds,
              ),
            ),
          ),
        );
      for (const item of existingEvidence) {
        if (
          item.trustLevel === "high" ||
          item.trustLevel === "human_confirmed"
        ) {
          trustedEvidenceIds.add(item.id);
        }
      }
    }
    for (const verification of args.verifications) {
      if (verification.status === "verified" && !verification.verifiedBy) {
        throw new Error("verified criteria require verifiedBy provenance");
      }
      if (
        verification.status === "verified" &&
        verification.verifiedBy !== "human" &&
        !verification.evidenceIds.some((id) => trustedEvidenceIds.has(id))
      ) {
        throw new Error(
          "verified criteria require trusted evidence unless explicitly human-verified",
        );
      }
      await db.insert(schema.contractVerifications).values({
        id: newId("ver"),
        contractId: args.contractId,
        criterionItemId: verification.criterionItemId,
        evidenceIds: JSON.stringify(verification.evidenceIds),
        status: verification.status,
        verifiedBy: verification.verifiedBy ?? null,
        verifiedAt: verification.status === "verified" ? now : null,
        note: verification.note ?? null,
        createdAt: now,
      });
    }
    await writeEvent({
      contractId: args.contractId,
      type: "contract.evidence.recorded",
      message: `Recorded ${insertedEvidenceIds.length} evidence artifact(s).`,
      payload: { evidenceIds: insertedEvidenceIds },
      createdBy: "agent",
    });
    return loadContractBundle(args.contractId);
  },
});
