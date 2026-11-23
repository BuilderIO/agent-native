import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { archiveSettingsSchema } from "../app/lib/model/archive-settings-contracts.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { readArchiveSettings } from "../server/model/archive-settings-store.js";

export default defineAction({
  description:
    "Read the current workspace's auto-archive criteria: days without an edit and days without a view before a project is archived. Null means the rule is off.",
  schema: z.object({}).strict(),
  outputSchema: archiveSettingsSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    return readArchiveSettings(current.orgId);
  },
});
