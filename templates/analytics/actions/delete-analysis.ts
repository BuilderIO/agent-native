import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  deleteOrgSetting,
  deleteSetting,
  deleteUserSetting,
} from "@agent-native/core/settings";

const KEY_PREFIX = "adhoc-analysis-";

export default defineAction({
  description: "Delete a saved ad-hoc analysis by ID.",
  schema: z.object({
    id: z.string().describe("The analysis ID to delete"),
  }),
  http: false,
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID || null;
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const key = `${KEY_PREFIX}${args.id}`;

    if (orgId) {
      await deleteOrgSetting(orgId, key);
    } else if (email !== "local@localhost") {
      await deleteUserSetting(email, key);
    } else {
      await deleteSetting(key);
    }
    return `Analysis "${args.id}" deleted.`;
  },
});
