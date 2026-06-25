import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { replaceStrategicAccounts } from "../server/lib/strategic-accounts-store";

const accountSchema = z.object({
  companyName: z.string().min(1),
  companyId: z.string().nullish(),
  deploymentStatus: z.string().optional(),
  notes: z.string().optional(),
  sortOrder: z.number().optional(),
});

export default defineAction({
  description:
    "Seed or replace the org's curated Strategic Accounts roster in ONE atomic write. Pass the full list of accounts — this replaces the org's existing roster (it does not append). Use this to seed the list from a curated set or from a live warehouse query (e.g. top enterprise accounts); never hardcode account names in source. Each account needs at least `companyName`; `companyId`, `deploymentStatus`, `notes`, and `sortOrder` are optional. New rows are created with org visibility so the whole organization sees the list.",
  schema: z.object({
    accounts: z.preprocess(
      (v) => (typeof v === "string" ? JSON.parse(v) : v),
      z.array(accountSchema),
    ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const rows = await replaceStrategicAccounts(args.accounts, {
      email,
      orgId,
    });
    return {
      ok: true,
      count: rows.length,
      accounts: rows,
      summary: `Replaced Strategic Accounts roster; it now has ${rows.length} account(s).`,
      urlPath: "/dashboards/strategic-accounts",
      deepLink: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId: "strategic-accounts" },
      }),
    };
  },
});
