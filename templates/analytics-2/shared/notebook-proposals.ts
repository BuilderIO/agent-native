import { z } from "zod";

import {
  notebookCommandSchema,
  notebookDeltaSchema,
} from "./notebook-operations.js";
import {
  draftHeadSchema,
  revisionSchema,
} from "./notebook-snapshot-contract.js";

const id = z.string().min(1).max(128);
const key = z.uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);

export const notebookThreadInputSchema = z.strictObject({
  projectId: id,
  threadId: id,
});
export const bindNotebookThreadSchema = notebookThreadInputSchema.extend({
  opId: key,
  head: draftHeadSchema,
});
export const createNotebookThreadSchema = bindNotebookThreadSchema.partial({
  threadId: true,
});
export const notebookThreadBindingSchema = notebookThreadInputSchema.extend({
  bindingId: id,
  workingVersionId: id,
  overlayRevision: revisionSchema,
});
export const notebookThreadListSchema = z.strictObject({
  threads: z.array(z.strictObject({ id, title: z.string() })).max(200),
});
export const stageNotebookProposalSchema = notebookThreadInputSchema.extend({
  command: notebookCommandSchema,
  expectedOverlayRevision: revisionSchema,
});
export const stagedNotebookProposalSchema = z.strictObject({
  status: z.literal("proposed"),
  proposalIds: z.array(id).min(1).max(200),
  overlayRevision: revisionSchema,
  acceptedHead: draftHeadSchema,
  cursor: revisionSchema,
  runIntentId: id.nullable(),
});

export const proposalStatusSchema = z.enum([
  "pending",
  "conflicted",
  "confirmed",
  "undone",
]);
export const proposalViewSchema = z.strictObject({
  id,
  cellId: id,
  status: proposalStatusSchema,
  kind: z.enum(["insert", "edit", "move", "delete"]),
  before: notebookDeltaSchema.nullable(),
  after: notebookDeltaSchema.nullable(),
  dependsOn: z.array(id).max(200),
  runId: id.nullable(),
  resultIds: z.array(id).max(200),
});
export const getNotebookPendingChangesSchema = notebookThreadInputSchema.extend(
  {
    after: revisionSchema.optional(),
  },
);
export const notebookPendingChangesSchema = z.strictObject({
  bindingId: id,
  acceptedHead: draftHeadSchema,
  overlayRevision: revisionSchema,
  cursor: revisionSchema,
  reviewedSetDigest: digest,
  changes: z.array(proposalViewSchema).max(200),
  hasMore: z.boolean(),
  reset: z.boolean(),
});
export const decideNotebookPendingChangesSchema =
  notebookThreadInputSchema.extend({
    opId: key,
    expectedOverlayRevision: revisionSchema,
    observedHead: draftHeadSchema,
    selection: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("selected"),
        ids: z.array(id).min(1).max(200),
      }),
      z.strictObject({ kind: z.literal("all"), reviewedSetDigest: digest }),
    ]),
    decision: z.enum(["confirm", "undo"]),
  });
export const notebookProposalDecisionSchema = z.strictObject({
  opId: key,
  decision: z.enum(["confirm", "undo"]),
  proposalIds: z.array(id).max(200),
  acceptedHead: draftHeadSchema,
  overlayRevision: revisionSchema,
  cursor: revisionSchema,
  checkpointId: id.nullable(),
  rerunIntentId: id.nullable(),
  promotedResultIds: z.array(id).max(200),
});

export type NotebookThreadInput = z.infer<typeof notebookThreadInputSchema>;
export type StageNotebookProposal = z.infer<typeof stageNotebookProposalSchema>;
export type DecideNotebookPendingChanges = z.infer<
  typeof decideNotebookPendingChangesSchema
>;
export type NotebookProposalDecision = z.infer<
  typeof notebookProposalDecisionSchema
>;
export type NotebookProposalView = z.infer<typeof proposalViewSchema>;

const legacyProposalSchema = z.strictObject({
  cellId: id,
  legacyId: id,
  baseSource: z.string(),
  source: z.string(),
});
export const notebookLegacyProposalsSchema = z.strictObject({
  head: draftHeadSchema,
  changes: z.array(legacyProposalSchema).max(200),
  hasMore: z.boolean(),
});
const recoveryBase = {
  projectId: id,
  cellId: id,
  legacyId: id,
  head: draftHeadSchema,
  opId: key,
};
export const recoverNotebookLegacyProposalSchema = z.discriminatedUnion(
  "decision",
  [
    z.strictObject({ ...recoveryBase, decision: z.literal("discard") }),
    z.strictObject({
      ...recoveryBase,
      decision: z.literal("re-propose"),
      threadId: id,
    }),
  ],
);
export const notebookLegacyProposalRecoverySchema = legacyProposalSchema
  .pick({ cellId: true, legacyId: true })
  .extend({
    decision: z.enum(["discard", "re-propose"]),
    proposalIds: z.array(id).max(1),
  });
export type LegacyProposalRecovery = z.infer<
  typeof recoverNotebookLegacyProposalSchema
>;
