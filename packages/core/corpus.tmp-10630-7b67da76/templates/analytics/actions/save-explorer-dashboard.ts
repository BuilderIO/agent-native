import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { upsertDashboard } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "Create or update an explorer (BigQuery explorer) dashboard. " +
    "The body is stored as the dashboard config verbatim.",
  schema: z.object({
    id: z.string().describe("The explorer dashboard ID"),
    data: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .describe("The dashboard config object to persist (or a JSON string)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const ctx = { email, orgId };
    await upsertDashboard(args.id, "explorer", args.data, ctx);
    return { id: args.id, success: true };
  },
});
