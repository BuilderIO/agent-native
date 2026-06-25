import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { updateStrategicAccount } from "../server/lib/strategic-accounts-store";

export default defineAction({
  description:
    "Edit one Strategic Account's manual fields (deployment status, notes, company name/id, or sort order). Used by the Strategic Accounts extension to persist deployment-status badge edits. Requires editor access to the account's org.",
  schema: z.object({
    id: z.string().min(1).describe("Strategic account row id."),
    companyName: z.string().optional(),
    companyId: z.string().nullish(),
    deploymentStatus: z.string().optional(),
    notes: z.string().optional(),
    sortOrder: z.number().optional(),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const { id, ...patch } = args;
    const updated = await updateStrategicAccount(id, patch, { email, orgId });
    if (!updated) {
      throw new Error(
        `strategic account "${id}" not found (or you don't have access).`,
      );
    }
    return { ok: true, account: updated };
  },
});
