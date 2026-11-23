import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { gitIntegrationsSettingsSchema } from "../app/lib/model/git-integrations-contracts.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { readGitIntegrationsSettings } from "../server/model/git-integrations-store.js";

export default defineAction({
  description:
    "Read the current workspace's Git integration settings: package import repositories, project export targets, and repository sync connections.",
  schema: z.object({}).strict(),
  outputSchema: gitIntegrationsSettingsSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    return readGitIntegrationsSettings(current.orgId);
  },
});
