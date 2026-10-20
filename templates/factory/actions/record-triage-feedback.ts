import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageDecisions, triageFeedback } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  factoryIdSchema,
  orgFactoryDecisionFilter,
} from "../server/lib/factory-scope.js";
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
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
    verdict: verdictSchema,
    note: z.string().trim().max(2_000).optional(),
  }),
  http: { method: "POST" },
  run: async ({ decisionId, factoryId, verdict, note }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const decision = (
      await getDb()
        .select({
          id: triageDecisions.id,
          factoryId: triageDecisions.factoryId,
        })
        .from(triageDecisions)
        .where(
          and(
            eq(triageDecisions.id, decisionId),
            orgFactoryDecisionFilter(orgId, factoryId),
          ),
        )
        .limit(1)
    )[0];
    if (!decision) throw new Error("Triage decision not found");
    const resolvedFactoryId = decision.factoryId ?? factoryId;

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
        factoryId: resolvedFactoryId,
      });
    return { ok: true, id };
  },
});
