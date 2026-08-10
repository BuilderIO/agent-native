import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageDecisions, triageFeedback } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

const verdictSchema = z.enum(["correct", "incorrect", "uncertain"]);

export default defineAction({
  description:
    "Record human feedback on a Factory shadow decision. Feedback is append-only and changes no provider or executor state.",
  schema: z.object({
    decisionId: z.string().min(1),
    verdict: verdictSchema,
    note: z.string().trim().max(2_000).optional(),
  }),
  http: { method: "POST" },
  run: async ({ decisionId, verdict, note }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const decision = (
      await getDb()
        .select({ id: triageDecisions.id })
        .from(triageDecisions)
        .where(
          and(
            eq(triageDecisions.id, decisionId),
            eq(triageDecisions.orgId, orgId),
          ),
        )
        .limit(1)
    )[0];
    if (!decision) throw new Error("Triage decision not found");

    const createdAt = new Date().toISOString();
    const id = randomUUID();
    await getDb()
      .insert(triageFeedback)
      .values({
        id,
        decisionId,
        verdict,
        note: note ?? null,
        createdAt,
        ownerEmail: userEmail,
        orgId,
      });
    return { ok: true, id };
  },
});
