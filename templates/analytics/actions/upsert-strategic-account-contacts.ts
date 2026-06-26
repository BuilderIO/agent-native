import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { replaceStrategicAccountContacts } from "../server/lib/strategic-account-contacts-store";

const contactSchema = z.object({
  companyName: z.string().min(1),
  role: z.enum(["champion", "enabler", "exec_sponsor"]).optional(),
  contactName: z.string().optional(),
  title: z.string().optional(),
  email: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  rationale: z.string().optional(),
  sortOrder: z.number().optional(),
});

export default defineAction({
  description:
    "Seed or replace the org's curated Strategic Account Coverage contacts in ONE atomic write. Pass the full list — this replaces the org's existing contacts (it does not append). Never hardcode contact details in source; populate them here. Each contact needs at least `companyName`; `role` (champion/enabler/exec_sponsor), `contactName`, `title`, `email`, `confidence` (high/medium/low), `rationale`, and `sortOrder` are optional. New rows are created with org visibility.",
  schema: z.object({
    contacts: z.preprocess(
      (v) => (typeof v === "string" ? JSON.parse(v) : v),
      z.array(contactSchema),
    ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const rows = await replaceStrategicAccountContacts(args.contacts, {
      email,
      orgId,
    });
    return {
      ok: true,
      count: rows.length,
      contacts: rows,
      summary: `Replaced Strategic Account Coverage contacts; it now has ${rows.length} contact(s).`,
      urlPath: "/dashboards/strategic-account-coverage",
      deepLink: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: "strategic-account-coverage" },
      }),
    };
  },
});
