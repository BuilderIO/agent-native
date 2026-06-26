import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { replaceImplementationBlockers } from "../server/lib/implementation-blockers-store";

const blockerSchema = z.object({
  companyName: z.string().min(1),
  blockerType: z.string().optional(),
  status: z.enum(["active", "monitoring", "resolved"]).optional(),
  summary: z.string().optional(),
  details: z.string().optional(),
  sortOrder: z.number().optional(),
});

export default defineAction({
  description:
    "Seed or replace the org's curated Implementation Blockers in ONE atomic write. Pass the full list — this replaces the org's existing blockers (it does not append). Never hardcode blocker details in source; populate them here. Each blocker needs at least `companyName`; `blockerType`, `status` (active/monitoring/resolved), `summary`, `details`, and `sortOrder` are optional. New rows are created with org visibility.",
  schema: z.object({
    blockers: z.preprocess(
      (v) => (typeof v === "string" ? JSON.parse(v) : v),
      z.array(blockerSchema),
    ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const rows = await replaceImplementationBlockers(args.blockers, {
      email,
      orgId,
    });
    return {
      ok: true,
      count: rows.length,
      blockers: rows,
      summary: `Replaced Implementation Blockers; it now has ${rows.length} blocker(s).`,
      urlPath: "/dashboards/implementation-blockers",
      deepLink: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: "implementation-blockers" },
      }),
    };
  },
});
