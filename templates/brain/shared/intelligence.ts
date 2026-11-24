import { z } from "zod";

export const intelligenceKindSchema = z.enum([
  "action",
  "decision",
  "feature-request",
]);
export const intelligenceStatusSchema = z.enum([
  "open",
  "completed",
  "dismissed",
]);
export const ownershipConfidenceSchema = z.enum(["explicit", "ambiguous"]);
export const verificationReminderDays = [7, 14, 30, 90, 180, 365] as const;
export const verificationReminderDaysSchema = z.union([
  z.literal(7),
  z.literal(14),
  z.literal(30),
  z.literal(90),
  z.literal(180),
  z.literal(365),
]);
export const verificationSchema = z.object({
  state: z.enum(["verified", "deprecated", "unverified"]),
  verifiedBy: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  remindAt: z.string().nullable().optional(),
});
export const intelligenceEntitySchema = z.object({
  type: z.enum(["person", "project", "customer", "team", "topic"]),
  name: z.string().trim().min(1).max(200),
});
export const intelligenceEvidenceSchema = z.object({
  captureId: z.string(),
  sourceId: z.string(),
  captureTitle: z.string(),
  capturedAt: z.string().optional(),
  quote: z.string(),
  note: z.string().optional(),
  sourceUrl: z.string().optional(),
  timestampMs: z.number().optional(),
});
export const intelligenceItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  kind: intelligenceKindSchema,
  owner: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: intelligenceStatusSchema,
  ownershipConfidence: ownershipConfidenceSchema,
  confidence: z.number(),
  entities: z.array(intelligenceEntitySchema),
  evidence: z.array(intelligenceEvidenceSchema),
  audienceId: z.string(),
  updatedAt: z.string(),
  revision: z.string(),
  verification: verificationSchema,
});
export type IntelligenceItem = z.infer<typeof intelligenceItemSchema>;
export const graphEntitySchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  evidenceCount: z.number(),
  evidenceTruncated: z.boolean(),
  knowledgeIds: z.array(z.string()),
  evidence: z.array(intelligenceEvidenceSchema),
});
export const graphEdgeSchema = z.object({
  title: z.string(),
  structured: z.boolean(),
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relation: z.enum(["mentioned-in", "owns"]),
  knowledgeId: z.string(),
  evidenceCount: z.number(),
  evidenceTruncated: z.boolean(),
  evidence: z.array(intelligenceEvidenceSchema),
});
