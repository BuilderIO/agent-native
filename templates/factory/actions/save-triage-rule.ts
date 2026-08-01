import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageRules } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  defaultTriagePolicyGuards,
  normalizeTriagePolicyGuards,
  triagePolicyGuardsSchema,
  triageRuleModeSchema,
} from "../server/triage/contracts.js";
import { stableId } from "../server/triage/ids.js";

export default defineAction({
  description:
    "Create or update a Factory rule. Disabled and shadow modes are accepted; execution still requires an explicit approval action.",
  schema: z.object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
    promptText: z.string().trim().min(1).max(10_000),
    mode: triageRuleModeSchema.default("shadow"),
    enabled: z.boolean().default(true),
    guards: triagePolicyGuardsSchema.optional(),
  }),
  http: { method: "POST" },
  run: async (
    { id, name, description, promptText, mode, enabled, guards },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const now = new Date().toISOString();
    const ruleId = id ?? stableId("rule", orgId, name);
    const existing = (
      await getDb()
        .select({ promptVersion: triageRules.promptVersion })
        .from(triageRules)
        .where(and(eq(triageRules.id, ruleId), eq(triageRules.orgId, orgId)))
        .limit(1)
    )[0];
    if (id && !existing) {
      throw new Error("Triage rule not found in the active workspace.");
    }
    const nextPromptVersion = (existing?.promptVersion ?? 0) + 1;
    const policy = normalizeTriagePolicyGuards(
      guards ?? defaultTriagePolicyGuards(),
    );

    await getDb()
      .insert(triageRules)
      .values({
        id: ruleId,
        name,
        description,
        promptText,
        mode,
        enabled: enabled ? 1 : 0,
        guardsJson: JSON.stringify(policy),
        promptVersion: nextPromptVersion,
        createdAt: now,
        updatedAt: now,
        ownerEmail: userEmail,
        orgId,
      })
      .onConflictDoUpdate({
        target: triageRules.id,
        set: {
          name,
          description,
          promptText,
          mode,
          enabled: enabled ? 1 : 0,
          guardsJson: JSON.stringify(policy),
          promptVersion: nextPromptVersion,
          updatedAt: now,
          ownerEmail: userEmail,
        },
      });

    return { ok: true, id: ruleId, mode, promptVersion: nextPromptVersion };
  },
});
