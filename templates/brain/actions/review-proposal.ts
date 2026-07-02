import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  nowIso,
  parseJson,
  serializeProposal,
  stableJson,
  writeKnowledgeRecord,
} from "../server/lib/brain.js";
import type { WriteKnowledgeInput } from "../server/lib/brain.js";
import { booleanishSchema } from "./_schemas.js";

export default defineAction({
  description:
    "Approve, reject, or keep a Brain proposal pending with review notes.",
  schema: z.object({
    id: z.string().min(1),
    decision: z.enum(["approve", "reject", "needs_changes"]),
    reviewerNotes: z.string().optional(),
    publishCanonical: booleanishSchema
      .optional()
      .describe(
        "When approving, override whether the resulting knowledge is mirrored into context/company-brain workspace resources.",
      ),
  }),
  run: async ({ id, decision, reviewerNotes, publishCanonical }) => {
    const access = await assertAccess("brain-proposal", id, "editor");
    const proposal = access.resource;
    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${id} is already ${proposal.status}`);
    }

    let result: unknown = null;
    const reviewedBy = getRequestUserEmail() ?? null;
    const reviewedAt = nowIso();
    const nextStatus = decision === "approve" ? "approved" : "rejected";
    let payloadJson = proposal.payloadJson;

    if (decision === "approve") {
      const payload = parseJson<WriteKnowledgeInput>(proposal.payloadJson, {
        title: proposal.title,
        body: proposal.body,
        evidence: [],
        proposalMode: "never",
      });
      const nextPayload: WriteKnowledgeInput = {
        ...payload,
        publishCanonical: publishCanonical ?? payload.publishCanonical,
        proposalMode: "never",
      };
      result = await writeKnowledgeRecord(nextPayload, {
        bypassProposal: true,
      });
      payloadJson = stableJson(nextPayload);
    }

    await getDb()
      .update(schema.brainProposals)
      .set({
        status: nextStatus,
        reviewerNotes:
          reviewerNotes ??
          (decision === "needs_changes" ? "Needs changes" : null),
        payloadJson,
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
