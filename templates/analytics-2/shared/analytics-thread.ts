import { z } from "zod";

import { operationReceiptSchema } from "./notebook-operations.js";
import {
  draftHeadSchema,
  revisionSchema,
} from "./notebook-snapshot-contract.js";

export const threadId = z.string().min(1).max(128);
const key = z.uuid();
export const threadMode = z.enum(["ask", "notebook", "app"]);
const mention = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), projectId: threadId }),
  z.strictObject({
    kind: z.literal("table"),
    sourceId: threadId,
    tableId: threadId,
  }),
  z.strictObject({ kind: z.literal("model"), modelId: threadId }),
  z.strictObject({
    kind: z.literal("cell"),
    projectId: threadId,
    cellId: threadId,
  }),
]);
const ids = (max: number) =>
  z
    .array(threadId)
    .max(max)
    .refine((items) => new Set(items).size === items.length);
export const analyticsPrompt = z.strictObject({
  text: z.string().trim().min(1).max(32_000),
  attachmentIds: ids(10),
  mentions: z.array(mention).max(20),
  modelId: threadId.optional(),
  approval: z.enum(["ask", "skip"]).default("ask"),
  sourceIds: ids(20),
});
export const uploadManifest = z.strictObject({
  clientFileId: key,
  name: z.string().min(1).max(255),
  byteLength: z.int().positive().max(26_214_400),
  mime: z.string().max(120),
});
export const uploadRef = z.strictObject({
  uploadId: threadId,
  clientFileId: key,
  state: z.enum(["pending", "ready", "failed"]),
});
export const threadBindingRef = z.strictObject({
  threadId,
  projectId: threadId,
  bindingId: threadId,
  workingVersionId: threadId,
  href: z.string().startsWith("/"),
});
export const threadTurnReceipt = z.strictObject({
  threadId,
  messageId: key,
  sequence: revisionSchema,
  phase: z.enum(["queued", "admitted", "complete", "stopped", "failed"]),
  runId: threadId.nullable(),
  acceptedAt: z.iso.datetime(),
});
export const startThreadReceipt = threadBindingRef.extend({
  phase: z.enum(["awaiting_upload", "ready", "submitted"]),
  initialTurn: threadTurnReceipt.nullable(),
  uploadSlots: z.array(uploadRef).max(10),
});
export const threadBootstrapCode = z.enum([
  "ai_provider_unavailable",
  "admission_unreadable",
  "intent_mismatch",
  "source_denied",
]);
export const pendingThreadBootstrap = z.strictObject({
  phase: z.literal("binding"),
  intentId: key,
});
export const threadBootstrapRead = z.discriminatedUnion("phase", [
  pendingThreadBootstrap,
  z.strictObject({ phase: z.literal("ready"), receipt: startThreadReceipt }),
  z.strictObject({ phase: z.literal("failed"), code: threadBootstrapCode }),
]);
export const startThreadInput = z.strictObject({
  intentId: key,
  mode: threadMode.default("ask"),
  trigger: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("submit"), prompt: analyticsPrompt }),
    z.strictObject({
      kind: z.literal("attach"),
      uploads: z
        .array(uploadManifest)
        .min(1)
        .max(10)
        .refine(
          (items) =>
            new Set(items.map((item) => item.clientFileId)).size ===
            items.length,
        ),
    }),
  ]),
});
export const threadInput = z.strictObject({ threadId });
export const bootstrapInput = z.strictObject({ intentId: key });
export const submitThreadTurnInput = threadInput.extend({
  messageId: key,
  prompt: analyticsPrompt,
});
export const recordUploadInput = threadInput.extend({
  uploadId: threadId,
  attachment: threadId.nullable(),
});
export const readThreadTurnsInput = threadInput.extend({
  after: revisionSchema.optional(),
  limit: z.int().min(1).max(50).default(25),
});
export const threadTurnView = z.strictObject({
  receipt: threadTurnReceipt,
  denied: z.boolean(),
  answerBlocks: z
    .array(
      z.strictObject({
        kind: z.literal("markdown"),
        text: z.string().max(32_000),
      }),
    )
    .max(20),
  chartArtifacts: z
    .array(
      z.strictObject({
        id: threadId,
        resultId: threadId,
        title: z.string().max(500),
        widget: z.unknown().optional(),
      }),
    )
    .max(20),
  toolReceipts: z
    .array(
      z.strictObject({
        id: threadId,
        name: threadId,
        state: z.enum(["running", "complete", "failed"]),
        label: z.string().max(500).optional(),
      }),
    )
    .max(100),
  durationMs: z.int().nonnegative().nullable(),
});
export const readThreadTurnsOutput = z.strictObject({
  turns: z.array(threadTurnView).max(50),
  next: revisionSchema.nullable(),
});
export const persistedThreadProjection = threadTurnView
  .omit({ denied: true })
  .extend({
    sourceIds: z.array(threadId).max(100),
    resultIds: z.array(threadId).max(100),
    privateContext: z.boolean(),
  });
export const stopThreadInput = threadInput.extend({
  opId: key,
  throughSequence: revisionSchema,
});
export const stopThreadReceipt = z.strictObject({
  opId: key,
  stoppedMessageIds: z.array(key).max(50),
  activeRunId: threadId.nullable(),
  outcome: z.enum(["requested", "stopped", "completion_won"]),
});
export const setThreadAccessInput = threadInput.extend({
  opId: key,
  expectedRevision: revisionSchema,
  change: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("grant"), memberId: threadId }),
    z.strictObject({ kind: z.literal("revoke"), grantId: threadId }),
  ]),
});
export const threadAccessReceipt = z.strictObject({
  opId: key,
  grantId: threadId,
  revision: revisionSchema,
  effect: z.enum(["added", "removed", "no_change"]),
  href: z.string().startsWith("/"),
});
export const listThreadAccessInput = threadInput.extend({
  cursor: threadId.optional(),
});
export const threadAccessList = z.strictObject({
  grants: z
    .array(
      z.strictObject({
        id: threadId,
        memberId: threadId,
        displayName: z.string(),
        role: z.literal("thread_viewer"),
      }),
    )
    .max(50),
  revision: revisionSchema,
  next: threadId.nullable(),
});
export const searchThreadMembersInput = threadInput.extend({
  search: z.string().trim().max(200),
});
export const searchThreadMembersOutput = z.strictObject({
  members: z
    .array(
      z.strictObject({
        id: threadId,
        displayName: z.string(),
        email: z.string(),
      }),
    )
    .max(25),
});
export const saveThreadProjectInput = threadInput.extend({
  opId: key,
  expectedHead: draftHeadSchema,
});
export const saveThreadProjectReceipt = z.strictObject({
  opId: key,
  projectId: threadId,
  listed: z.literal(true),
  href: z.string().startsWith("/"),
  operation: operationReceiptSchema,
});

export type AnalyticsPrompt = z.infer<typeof analyticsPrompt>;
export type StartThreadInput = z.infer<typeof startThreadInput>;
export type ThreadTurnReceipt = z.infer<typeof threadTurnReceipt>;
