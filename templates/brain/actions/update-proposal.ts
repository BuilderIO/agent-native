import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  nowIso,
  parseJson,
  serializeProposal,
  stableJson,
} from "../server/lib/brain.js";

export default defineAction({
  description:
    "Update the editable title, body, or rationale of a pending Brain proposal before review.",
  schema: z.object({
    proposalId: z.string().min(1),
    title: z.string().trim().min(1).max(240).optional(),
    body: z.string().trim().min(1).max(20000).optional(),
    rationale: z.string().trim().max(5000).optional(),
  }),
  run: async ({ proposalId, title, body, rationale }) => {
    const access = await assertAccess("brain-proposal", proposalId, "editor");
    const proposal = access.resource;
    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${proposalId} is already ${proposal.status}`);
    }
    if (title === undefined && body === undefined && rationale === undefined) {
      throw new Error("At least one proposal field is required");
    }

    const payload = parseJson<Record<string, unknown>>(
      proposal.payloadJson,
      {},
    );
    const nextTitle = title ?? proposal.title;
    const nextBody = body ?? proposal.body;
    const nextRationale = rationale ?? proposal.rationale;
    const nextPayload = {
      ...payload,
      title: nextTitle,
      body: nextBody,
      rationale: nextRationale,
    };
    const now = nowIso();

    await getDb()
      .update(schema.brainProposals)
      .set({
        title: nextTitle,
        body: nextBody,
        rationale: nextRationale,
        payloadJson: stableJson(nextPayload),
        updatedAt: now,
      })
      .where(eq(schema.brainProposals.id, proposalId));

    const [updated] = await getDb()
      .select()
      .from(schema.brainProposals)
      .where(eq(schema.brainProposals.id, proposalId))
      .limit(1);
    return { proposal: serializeProposal(updated) };
  },
});
