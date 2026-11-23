import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readWorkspaceName } from "./_workspace-name.js";
export default defineAction({
  description:
    "Read the active workspace name and whether the current member can edit it.",
  schema: z.object({}),
  outputSchema: z.object({
    orgId: z.string(),
    name: z.string(),
    canEdit: z.boolean(),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: readWorkspaceName,
});
