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
    "Approve, reject, or keep a Brain proposal pending with review notes.",
  schema: z.object({
    id: z.string().min(1),
    decision: z.enum(["approve", "reject", "needs_changes"]),
    reviewerNotes: z.string().optional(),
  }),
  run: async ({ id, decision, reviewerNotes }) => {
    const access = await assertAccess("brain-proposal", id, "editor");
    const proposal = access.resource;
    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${id} is already ${proposal.status}`);
    }

    let result: unknown = null;
    const reviewedBy = getRequestUserEmail() ?? null;
    const reviewedAt = nowIso();
    const nextStatus = decision === "approve" ? "approved" : "rejected";

    if (decision === "approve") {
      const payload = parseJson<WriteKnowledgeInput>(proposal.payloadJson, {
        title: proposal.title,
        body: proposal.body,
        evidence: [],
        proposalMode: "never",
      });
      result = await writeKnowledgeRecord(
        { ...payload, proposalMode: "never" },
        { bypassProposal: true },
      );
    }

    await getDb()
      .update(schema.brainProposals)
      .set({
        status: nextStatus,
        reviewerNotes:
          reviewerNotes ??
          (decision === "needs_changes" ? "Needs changes" : null),
        reviewedBy,
        reviewedAt,
        updatedAt: reviewedAt,
      })
      .where(eq(schema.brainProposals.id, id));
    const [updated] = await getDb()
      .select()
      .from(schema.brainProposals)
      .where(eq(schema.brainProposals.id, id))
      .limit(1);
    return { proposal: serializeProposal(updated), result };
  },
});
