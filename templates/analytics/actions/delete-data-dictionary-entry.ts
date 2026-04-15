import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  deleteOrgSetting,
  deleteUserSetting,
} from "@agent-native/core/settings";

const KEY_PREFIX = "data-dict-";

export default defineAction({
  description: "Delete a data dictionary entry by id.",
  schema: z.object({
    id: z.string().describe("ID of the entry to delete"),
  }),
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID || null;
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    const key = `${KEY_PREFIX}${args.id}`;
    if (orgId) {
      await deleteOrgSetting(orgId, key);
    } else {
      await deleteUserSetting(email, key);
    }
    return `Deleted data dictionary entry ${args.id}.`;
  },
});
