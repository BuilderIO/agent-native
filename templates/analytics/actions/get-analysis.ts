import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getOrgSetting,
  getSetting,
  getUserSetting,
} from "@agent-native/core/settings";

const KEY_PREFIX = "adhoc-analysis-";

export default defineAction({
  description: "Get a saved ad-hoc analysis by ID, including its full results.",
  schema: z.object({
    id: z.string().describe("The analysis ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID || null;
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const key = `${KEY_PREFIX}${args.id}`;

    const data =
      (orgId ? await getOrgSetting(orgId, key) : null) ||
      (email !== "local@localhost" ? await getUserSetting(email, key) : null) ||
      (await getSetting(key));

    if (!data) {
      return { error: "Analysis not found" };
    }
    return data;
  },
});
