import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, serializeProposal } from "../server/lib/brain.js";

export default defineAction({
  description: "Reject a pending Brain proposal with optional reviewer notes.",
  schema: z.object({
    proposalId: z.string().min(1),
    reviewerNotes: z.string().optional(),
  }),
  run: async ({ proposalId, reviewerNotes }) => {
    const access = await assertAccess("brain-proposal", proposalId, "editor");
    if (access.resource.status !== "pending") {
      throw new Error(
        `Proposal ${proposalId} is already ${access.resource.status}`,
      );
    }
    await getDb()
      .update(schema.brainProposals)
      .set({
        status: "rejected",
        reviewerNotes: reviewerNotes ?? null,
        reviewedBy: getRequestUserEmail() ?? null,
        reviewedAt: nowIso(),
        updatedAt: nowIso(),
      })
      .where(eq(schema.brainProposals.id, proposalId));
    const [proposal] = await getDb()
      .select()
      .from(schema.brainProposals)
      .where(eq(schema.brainProposals.id, proposalId))
      .limit(1);
    return { proposal: serializeProposal(proposal) };
  },
});
