import { defineAction } from "@agent-native/core";
import {
  deleteAppState,
  listAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import type { CodeLayerSource } from "../shared/code-layer.js";
import {
  DESIGN_REPROMPT_PROPOSAL_STATE_PREFIX,
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
  spliceNodeRewriteVariant,
  type NodeHtmlPreviewBridgeMessage,
  type NodeRewriteProposal,
} from "../shared/node-rewrite.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

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

const proposalSchema = z.object({
  proposalId: z.string().min(1),
  repromptId: z.string().min(1),
  designId: z.string().min(1),
  fileId: z.string().min(1),
  filename: z.string().min(1),
  target: targetSchema,
  resolvedTarget: z.object({
    nodeId: z.string().min(1),
    selector: z.string().min(1),
  }),
  baseVersionHash: z.string().min(1),
  variants: z
    .array(
      z.object({
        html: z.string().min(1).max(250_000),
        summary: z.string().min(1).max(240),
      }),
    )
    .min(1)
    .max(3),
  chosenIndex: z.number().int().min(0),
  createdAt: z.string(),
});

interface EditableDesignFile extends SourceWorkspaceFile {
  designData: string | null;
}

async function resolveProposal(proposalId: string): Promise<{
  key: string;
  proposal: NodeRewriteProposal;
}> {
  const candidates = await listAppState(DESIGN_REPROMPT_PROPOSAL_STATE_PREFIX);
  const matches = candidates.filter(
    ({ value }) => value.proposalId === proposalId,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "Node rewrite proposal not found or already resolved."
        : "Multiple node rewrite proposals matched this id.",
    );
  }
  const match = matches[0]!;
  const proposal = proposalSchema.parse(match.value) as NodeRewriteProposal;
  const expectedKey = designRepromptProposalStateKey(
    proposal.designId,
    proposal.fileId,
  );
  if (match.key !== expectedKey) {
    throw new Error("Node rewrite proposal state is scoped to the wrong file.");
  }
  return { key: match.key, proposal };
}

async function resolveEditableDesignFile(
  proposal: NodeRewriteProposal,
): Promise<EditableDesignFile> {
  const db = getDb();
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
    .where(
      and(
        accessFilter(schema.designs, schema.designShares),
        eq(schema.designFiles.id, proposal.fileId),
        eq(schema.designFiles.designId, proposal.designId),
      ),
    )
    .limit(1);

  if (!file) throw new Error("Design HTML file not found.");
  if (file.filename !== proposal.filename || file.fileType !== "html") {
    throw new Error("Node rewrite proposal no longer matches its HTML file.");
  }
  if (designSourceTypeFromData(file.designData) !== "inline") {
    throw new Error("Node rewrites only support inline design screens.");
  }
  await assertAccess("design", proposal.designId, "editor");
  return file;
}

async function clearProposalState(
  proposalKey: string,
  proposal: NodeRewriteProposal,
): Promise<void> {
  const pendingKey = designRepromptPendingStateKey(
    proposal.designId,
    proposal.fileId,
  );
  const [currentProposal, currentPending] = await Promise.all([
    readAppState(proposalKey),
    readAppState(pendingKey),
  ]);
  await Promise.all([
    currentProposal?.proposalId === proposal.proposalId
      ? deleteAppState(proposalKey)
      : Promise.resolve(false),
    currentPending?.repromptId === proposal.repromptId
      ? deleteAppState(pendingKey)
      : Promise.resolve(false),
  ]);
}

export default defineAction({
  agentTool: false,
  description:
    "Accept or reject a pending scoped Design node rewrite. Accept performs one " +
    "version-checked inline/Yjs content transaction; reject changes no design content. " +
    "Both resolutions clear the proposal and its matching paired pending reprompt.",
  schema: z.object({
    proposalId: z.string().min(1),
    resolution: z.enum(["accept", "reject"]),
    variantIndex: z.number().int().min(0).optional(),
  }),
  run: async ({ proposalId, resolution, variantIndex }) => {
    const { key: proposalKey, proposal } = await resolveProposal(proposalId);
    const restoreMessage: NodeHtmlPreviewBridgeMessage = {
      type: "node-html-preview",
      proposalId,
      target: proposal.resolvedTarget,
      operation: "restore",
    };

    if (resolution === "reject") {
      await assertAccess("design", proposal.designId, "editor");
      await clearProposalState(proposalKey, proposal);
      return {
        proposalId,
        repromptId: proposal.repromptId,
        resolution,
        changed: false,
        bridgeMessages: [restoreMessage],
      };
    }

    const file = await resolveEditableDesignFile(proposal);
    const chosenIndex = variantIndex ?? proposal.chosenIndex;
    const variant = proposal.variants[chosenIndex];
    if (!variant) {
      throw new Error(
        `Variant index ${chosenIndex} is out of range for this proposal.`,
      );
    }

    const live = await readLiveSourceFile(file);
    if (live.versionHash !== proposal.baseVersionHash) {
      throw new Error(
        "Screen changed since proposal — regenerate before accepting.",
      );
    }
    const source: CodeLayerSource = {
      kind: "design-file",
      sourceType: "inline",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };
    const rewrite = spliceNodeRewriteVariant({
      content: live.content,
      target: proposal.resolvedTarget,
      variant,
      source,
      fileType: file.fileType,
    });
    const write = await writeInlineSourceFile({
      designId: file.designId,
      file,
      content: rewrite.content,
      expectedVersionHash: proposal.baseVersionHash,
    });
    await clearProposalState(proposalKey, proposal);

    return {
      proposalId,
      repromptId: proposal.repromptId,
      resolution,
      variantIndex: chosenIndex,
      summary: variant.summary,
      changed: write.changed,
      designId: file.designId,
      fileId: file.id,
      versionHash: write.versionHash,
    };
  },
});
