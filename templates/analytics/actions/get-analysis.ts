import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { getOrgSetting, getUserSetting } from "@agent-native/core/settings";

const KEY_PREFIX = "adhoc-analysis-";

export default defineAction({
  description: "Get a saved ad-hoc analysis by ID, including its full results.",
  schema: z.object({
    id: z.string().describe("The analysis ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail() || "local@localhost";
    const key = `${KEY_PREFIX}${args.id}`;

    // Always use a scoped lookup — never fall through to global `getSetting`,
    // which would leak any user's analysis by ID guess. Local-mode analyses
    // live at `u:local@localhost:adhoc-analysis-*`.
    const data =
      (orgId ? await getOrgSetting(orgId, key) : null) ||
      (await getUserSetting(email, key));

    if (!data) {
      return { error: "Analysis not found" };
    }
    return data;
  },
});
