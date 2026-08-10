import { defineAction } from "@agent-native/core";
import {
  compareAndSetManyAppState,
  readAppState,
  type AppStateCompareAndSetOperation,
} from "@agent-native/core/application-state";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  readLiveSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
  MAX_NODE_REWRITE_PROPOSAL_BYTES,
  resolveNodeRewriteTarget,
  validateNodeRewriteVariant,
  type NodeHtmlPreviewBridgeMessage,
  type NodeRewriteProposal,
  type NodeRewriteTarget,
} from "../shared/node-rewrite.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

const sourceSchema = z
  .object({
    designId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    filename: z.string().min(1).optional(),
  })
  .superRefine((source, ctx) => {
    if (!source.designId && !source.fileId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["designId"],
        message: "source.designId or source.fileId is required",
      });
    }
  });

const targetSchema = z
  .object({
    nodeId: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
  })
  .superRefine((target, ctx) => {
    if (!target.nodeId && !target.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeId"],
        message: "target.nodeId or target.selector is required",
      });
    }
  });

const variantSchema = z.object({
  html: z
    .string()
    .min(1)
    .max(250_000)
    .describe("Replacement outerHTML for the selected subtree"),
  summary: z.string().trim().min(1).max(240),
});

const pendingRepromptSchema = z.object({
  status: z.literal("pending").optional(),
  repromptId: z.string().min(1),
  designId: z.string().min(1),
  fileId: z.string().min(1),
  target: targetSchema,
  baseVersionHash: z.string().min(1),
  instruction: z.string(),
  createdAt: z.string(),
  priorProposalId: z.string().min(1).optional(),
  priorRepromptId: z.string().min(1).optional(),
});

interface EditableDesignFile extends SourceWorkspaceFile {
  designData: string | null;
}

async function resolveEditableDesignFile(source: {
  designId?: string;
  fileId?: string;
  filename?: string;
}): Promise<EditableDesignFile> {
  const db = getDb();
  const conditions = [
    accessFilter(schema.designs, schema.designShares),
    source.fileId
      ? eq(schema.designFiles.id, source.fileId)
      : eq(schema.designFiles.designId, source.designId ?? ""),
  ];
  if (!source.fileId) {
    conditions.push(
      eq(schema.designFiles.filename, source.filename ?? "index.html"),
    );
  }

  const [file] = await db
    .select({
      id: schema.designFiles.id,
      designId: schema.designFiles.designId,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
      createdAt: schema.designFiles.createdAt,
      updatedAt: schema.designFiles.updatedAt,
      designData: schema.designs.data,
    })
    .from(schema.designFiles)
    .innerJoin(
      schema.designs,
      eq(schema.designFiles.designId, schema.designs.id),
    )
    .where(and(...conditions))
    .limit(1);

  if (!file) throw new Error("Design HTML file not found.");
  if (source.designId && source.designId !== file.designId) {
    throw new Error(
      `source.designId "${source.designId}" does not match file "${file.id}"`,
    );
  }
  if (source.filename && source.filename !== file.filename) {
    throw new Error(
      `source.filename "${source.filename}" does not match file "${file.id}"`,
    );
  }
  if (file.fileType !== "html") {
    throw new Error("Node rewrites only support HTML design files.");
  }
  if (designSourceTypeFromData(file.designData) !== "inline") {
    throw new Error("Node rewrites only support inline design screens.");
  }
  await assertAccess("design", file.designId, "editor");
  return file;
}

function targetsMatch(a: NodeRewriteTarget, b: NodeRewriteTarget): boolean {
  const nodeIdsConflict = a.nodeId && b.nodeId && a.nodeId !== b.nodeId;
  const selectorsConflict =
    a.selector && b.selector && a.selector !== b.selector;
  if (nodeIdsConflict || selectorsConflict) return false;
  return Boolean(
    (a.nodeId && b.nodeId && a.nodeId === b.nodeId) ||
    (a.selector && b.selector && a.selector === b.selector),
  );
}

export default defineAction({
  description:
    "Propose one to three scoped HTML rewrites for a pending Design selection. " +
    "This previews only: it stores proposal state and never changes the design file. " +
    "The target must identify, and the reprompt id and base hash must exactly match, the pending client selection.",
  schema: z.object({
    source: sourceSchema,
    target: targetSchema,
    baseVersionHash: z.string().min(1),
    variants: z.array(variantSchema).min(1).max(3),
    repromptId: z.string().min(1),
  }),
  run: async ({ source, target, baseVersionHash, variants, repromptId }) => {
    const file = await resolveEditableDesignFile(source);
    const sourceDescriptor: CodeLayerSource = {
      kind: "design-file",
      sourceType: "inline",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };
    const live = await readLiveSourceFile(file);
    if (live.versionHash !== baseVersionHash) {
      throw new Error(
        "Screen changed since the selection was captured — regenerate the proposal.",
      );
    }

    const pendingKey = designRepromptPendingStateKey(file.designId, file.id);
    const pending = pendingRepromptSchema.parse(await readAppState(pendingKey));
    if (pending.repromptId !== repromptId) {
      throw new Error("Pending reprompt does not match this request.");
    }
    if (
      pending.designId !== file.designId ||
      pending.fileId !== file.id ||
      !targetsMatch(pending.target, target)
    ) {
      throw new Error(
        "The proposed target does not match the pending selected subtree.",
      );
    }
    if (pending.baseVersionHash !== baseVersionHash) {
      throw new Error(
        "The proposal base hash does not match the pending selection.",
      );
    }

    const authoritativeTarget = pending.target;
    const node = resolveNodeRewriteTarget(
      live.content,
      authoritativeTarget,
      sourceDescriptor,
    );
    const validatedVariants = variants.map((variant) =>
      validateNodeRewriteVariant(variant, sourceDescriptor),
    );
    const proposalId = `node-rewrite-${nanoid()}`;
    const resolvedTarget = {
      nodeId: node.id,
      selector: node.selector,
    };
    const proposal: NodeRewriteProposal = {
      proposalId,
      repromptId,
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      target: authoritativeTarget,
      resolvedTarget,
      baseVersionHash,
      variants: validatedVariants,
      chosenIndex: 0,
      createdAt: new Date().toISOString(),
    };
    const serializedProposal = JSON.stringify(proposal);
    if (
      Buffer.byteLength(serializedProposal, "utf8") >
      MAX_NODE_REWRITE_PROPOSAL_BYTES
    ) {
      throw new Error(
        "Generated candidates are too large to preview safely. Use fewer variants or regenerate a smaller selected subtree.",
      );
    }
    const proposalKey = designRepromptProposalStateKey(
      file.designId,
      file.id,
      repromptId,
    );
    const publishOperations: AppStateCompareAndSetOperation[] = [
      {
        key: pendingKey,
        expectedValue: pending as unknown as Record<string, unknown>,
        nextValue: pending as unknown as Record<string, unknown>,
      },
      {
        key: proposalKey,
        expectedValue: null,
        nextValue: proposal as unknown as Record<string, unknown>,
      },
    ];
    if (pending.priorProposalId && pending.priorRepromptId) {
      const priorProposalKey = designRepromptProposalStateKey(
        file.designId,
        file.id,
        pending.priorRepromptId,
      );
      const priorProposal = await readAppState(priorProposalKey);
      if (priorProposal?.proposalId === pending.priorProposalId) {
        publishOperations.push({
          key: priorProposalKey,
          expectedValue: priorProposal,
          nextValue: null,
        });
      }
    }
    const published = await compareAndSetManyAppState(publishOperations);
    if (!published) {
      throw new Error(
        "This regeneration was superseded by a newer request before its candidates were published.",
      );
    }

    const bridgeMessages: NodeHtmlPreviewBridgeMessage[] = [
      {
        type: "node-html-preview",
        proposalId,
        target: resolvedTarget,
        html: validatedVariants[0]!.html,
        operation: "preview",
      },
    ];
    return {
      proposalId,
      repromptId,
      designId: file.designId,
      fileId: file.id,
      target: resolvedTarget,
      variants: validatedVariants,
      bridgeMessages,
    };
  },
});
