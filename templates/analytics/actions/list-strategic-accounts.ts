import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { listStrategicAccounts } from "../server/lib/strategic-accounts-store";

export default defineAction({
  description:
    "List the curated Strategic Accounts roster for the current org. This is the source of truth for the Strategic Accounts overview dashboard and extension — the account names live only in the database, never in source. Returns each account's company name, optional HubSpot company id, editable deployment status, notes, and sort order.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: () => ({
    url: buildDeepLink({
      app: "analytics",
      view: "adhoc",
      params: { dashboardId: "strategic-accounts" },
    }),
    label: "Open Strategic Accounts",
    view: "adhoc",
  }),
  run: async () => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const accounts = await listStrategicAccounts({ email, orgId });
    return {
      count: accounts.length,
      accounts,
      /** Comma-separated names (display only — names may contain commas). */
      accountsCsv: accounts.map((a) => a.companyName).join(","),
      /**
       * Pipe-separated names — the value to feed the dashboard `accounts`
       * variable. Pipe avoids collisions with commas inside company names
       * (e.g. "Orgill, Inc."); panels expand it with SPLIT('{{accounts}}', '|').
       */
      accountsPipe: accounts.map((a) => a.companyName).join("|"),
    };
  },
});
