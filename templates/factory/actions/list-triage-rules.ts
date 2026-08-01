import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageRules } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { normalizeTriagePolicyGuards } from "../server/triage/contracts.js";

export default defineAction({
  description:
    "List editable Factory rules for the active workspace. Rules are disabled or shadow-only until the owner explicitly promotes them.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const rows = await getDb()
      .select()
      .from(triageRules)
      .where(eq(triageRules.orgId, orgId))
      .orderBy(desc(triageRules.updatedAt));
    return rows.map((row) => ({
      ...row,
      enabled: row.enabled === 1,
      guards: parseGuards(row.guardsJson),
    }));
  },
});

function parseGuards(value: string) {
  try {
    return normalizeTriagePolicyGuards(JSON.parse(value));
  } catch (error) {
    throw new Error(
      `Triage rule guards are unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
