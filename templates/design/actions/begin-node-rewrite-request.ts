import { defineAction } from "@agent-native/core";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  designRepromptPendingStateKey,
  isNodeRewriteResolutionClaim,
  isPendingDesignReprompt,
  type PendingDesignReprompt,
} from "../shared/node-rewrite.js";

const targetSchema = z
  .object({
    nodeId: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
  })
  .refine((target) => target.nodeId || target.selector, {
    message: "target.nodeId or target.selector is required",
  });

export default defineAction({
  agentTool: false,
  description:
    "Atomically starts or supersedes one pending node rewrite unless its current proposal is being accepted.",
  schema: z.object({
    repromptId: z.string().min(1),
    designId: z.string().min(1),
    fileId: z.string().min(1),
    target: targetSchema,
    baseVersionHash: z.string().min(1),
    instruction: z.string().trim().min(1),
    createdAt: z.string().min(1),
    priorProposalId: z.string().min(1).optional(),
    priorRepromptId: z.string().min(1).optional(),
  }),
  run: async (request) => {
    await assertAccess("design", request.designId, "editor");
    const pendingKey = designRepromptPendingStateKey(
      request.designId,
      request.fileId,
    );
    const current = await readAppState(pendingKey);
    if (isNodeRewriteResolutionClaim(current)) {
      throw new Error(
        "This candidate is currently being accepted. Wait for it to finish before regenerating.",
      );
    }
    if (
      request.priorRepromptId &&
      (!isPendingDesignReprompt(current) ||
        current.repromptId !== request.priorRepromptId)
    ) {
      throw new Error(
        "The candidates changed before refinement started. Review the latest candidates instead.",
      );
    }

    const pending: PendingDesignReprompt = {
      ...request,
      status: "pending",
    };
    const started = await compareAndSetAppState(
      pendingKey,
      current,
      pending as unknown as Record<string, unknown>,
    );
    if (!started) {
      throw new Error(
        "The regeneration request changed concurrently. Try again with the latest candidates.",
      );
    }
    return { started: true, repromptId: request.repromptId };
  },
});
