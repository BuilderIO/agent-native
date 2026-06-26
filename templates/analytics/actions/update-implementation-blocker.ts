import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { updateImplementationBlocker } from "../server/lib/implementation-blockers-store";

export default defineAction({
  description:
    "Edit one Implementation Blocker (type, status, summary, details, company, or sort order). Requires editor access to the blocker's org.",
  schema: z.object({
    id: z.string().min(1).describe("Blocker row id."),
    companyName: z.string().optional(),
    blockerType: z.string().optional(),
    status: z.enum(["active", "monitoring", "resolved"]).optional(),
    summary: z.string().optional(),
    details: z.string().optional(),
    sortOrder: z.number().optional(),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const { id, ...patch } = args;
    const updated = await updateImplementationBlocker(id, patch, {
      email,
      orgId,
    });
    if (!updated) {
      throw new Error(
        `implementation blocker "${id}" not found (or you don't have access).`,
      );
    }
    return { ok: true, blocker: updated };
  },
});
