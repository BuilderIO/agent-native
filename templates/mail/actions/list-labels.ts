import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { gmailListLabels } from "../server/lib/google-api.js";
import { getAccessTokens } from "./helpers.js";

export default defineAction({
  description: "List Gmail labels across the user's connected accounts.",
  schema: z.object({}),
  readOnly: true,
  run: async () => {
    const accounts = await getAccessTokens();
    const labels = [];
    for (const account of accounts) {
      const response = await gmailListLabels(account.accessToken);
      for (const label of response.labels ?? []) {
        labels.push({
          id: label.id,
          name: label.name,
          accountEmail: account.email,
        });
      }
    }
    return labels;
  },
});
