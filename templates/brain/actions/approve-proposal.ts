import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { assertAccess } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";
import {
  nowIso,
  parseJson,
  serializeProposal,
  writeKnowledgeRecord,
} from "../server/lib/brain.js";
import type { WriteKnowledgeInput } from "../server/lib/brain.js";

export default defineAction({
  description:
    "Approve a pending Brain proposal and publish its knowledge payload.",
  schema: z.object({
    proposalId: z.string().min(1),
    reviewerNotes: z.string().optional(),
  }),
  run: async ({ proposalId, reviewerNotes }) => {
    const access = await assertAccess("brain-proposal", proposalId, "editor");
    const proposal = access.resource;
    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${proposalId} is already ${proposal.status}`);
    }
    const payload = parseJson<WriteKnowledgeInput>(proposal.payloadJson, {
      title: proposal.title,
      body: proposal.body,
      evidence: [],
      proposalMode: "never",
    });
    const result = await writeKnowledgeRecord(
      { ...payload, proposalMode: "never" },
      { bypassProposal: true },
    );
    await getDb()
      .update(schema.brainProposals)
      .set({
        status: "approved",
        reviewerNotes: reviewerNotes ?? null,
        reviewedBy: getRequestUserEmail() ?? null,
        reviewedAt: nowIso(),
        updatedAt: nowIso(),
      })
      .where(eq(schema.brainProposals.id, proposalId));
    const [updated] = await getDb()
      .select()
      .from(schema.brainProposals)
      .where(eq(schema.brainProposals.id, proposalId))
      .limit(1);
    return { proposal: serializeProposal(updated), result };
  },
});
