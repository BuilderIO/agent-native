import { defineAction } from "@agent-native/core";
import {
  compareAndSetAppState,
  compareAndSetManyAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
  isNodeRewriteProposal,
  isPendingDesignReprompt,
} from "../shared/node-rewrite.js";

export default defineAction({
  agentTool: false,
  description:
    "Cancel one pending node rewrite only when it is still the current request.",
  schema: z.object({
    designId: z.string().min(1),
    fileId: z.string().min(1),
    repromptId: z.string().min(1),
  }),
  run: async ({ designId, fileId, repromptId }) => {
    await assertAccess("design", designId, "editor");
    const pendingKey = designRepromptPendingStateKey(designId, fileId);
    const pending = await readAppState(pendingKey);
    if (
      !isPendingDesignReprompt(pending) ||
      pending.repromptId !== repromptId
    ) {
      return { cancelled: false, superseded: true };
    }

    const proposalKey = designRepromptProposalStateKey(
      designId,
      fileId,
      repromptId,
    );
    const proposal = await readAppState(proposalKey);
    const proposalCancelled = isNodeRewriteProposal(proposal);
    const pendingCancelled = proposalCancelled
      ? await compareAndSetManyAppState([
          {
            key: pendingKey,
            expectedValue: pending,
            nextValue: null,
          },
          {
            key: proposalKey,
            expectedValue: proposal,
            nextValue: null,
          },
        ])
      : await compareAndSetAppState(pendingKey, pending, null);
    return {
      cancelled: pendingCancelled,
      proposalCancelled: proposalCancelled && pendingCancelled,
      superseded: !pendingCancelled,
    };
  },
});
