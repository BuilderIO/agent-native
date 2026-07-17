import { defineAction } from "@agent-native/core";
import {
  compareAndSetAppState,
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
    const [pendingCancelled, proposalCancelled] = await Promise.all([
      compareAndSetAppState(pendingKey, pending, null),
      isNodeRewriteProposal(proposal)
        ? compareAndSetAppState(proposalKey, proposal, null)
        : Promise.resolve(false),
    ]);
    return {
      cancelled: pendingCancelled,
      proposalCancelled,
      superseded: !pendingCancelled,
    };
  },
});
