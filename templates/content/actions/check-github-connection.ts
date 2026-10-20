import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readGitHubConnected } from "../server/lib/github-source-client.js";

export default defineAction({
  description:
    "Check whether the current user has a GitHub connection Content can read folders through, before linking one. Reads no repository. `connected` is null when GitHub couldn't be asked.",
  schema: z.object({}).strict(),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<{ connected: boolean | null }> => ({
    connected: await readGitHubConnected(),
  }),
});
