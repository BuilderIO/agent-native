import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageDecisions, triageFeedback } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Mine human feedback on Factory decisions into inspectable rule proposals. This never edits a rule or enables execution.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ limit }, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const decisions = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.orgId, orgId))
      .orderBy(desc(triageDecisions.createdAt))
      .limit(500);
    const feedback = await db
      .select()
      .from(triageFeedback)
      .where(eq(triageFeedback.orgId, orgId))
      .orderBy(desc(triageFeedback.createdAt))
      .limit(500);
    const decisionsById = new Map(
      decisions.map((decision) => [decision.id, decision]),
    );
    const groups = new Map<
      string,
      { notes: string[]; correct: number; incorrect: number; uncertain: number }
    >();
    for (const entry of feedback) {
      const decision = decisionsById.get(entry.decisionId);
      if (!decision) continue;
      const key = `${decision.ruleId ?? "unscoped"}:${decision.outcome}`;
      const group = groups.get(key) ?? {
        notes: [],
        correct: 0,
        incorrect: 0,
        uncertain: 0,
      };
      if (entry.verdict === "correct") group.correct += 1;
      if (entry.verdict === "incorrect") group.incorrect += 1;
      if (entry.verdict === "uncertain") group.uncertain += 1;
      if (entry.note?.trim()) group.notes.push(entry.note.trim());
      groups.set(key, group);
    }
    return [...groups.entries()].slice(0, limit).map(([key, value]) => ({
      proposalKey: key,
      recommendation:
        value.incorrect > value.correct
          ? "Review the rule prompt and tighten its guards before enabling it."
          : "Keep collecting feedback; this rule is not yet decisively wrong.",
      feedback: value,
      mode: "shadow",
    }));
  },
});
