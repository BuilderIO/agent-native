import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { ensureSampleWorkspace } from "../server/model/seed.js";

/**
 * Give an account that has no work yet the starting projects, cells and the
 * sample collection, then report what it created. Running it twice changes
 * nothing: the seed returns created:false once the workspace has content.
 *
 * The seed had no caller at all in this app, so a new workspace opened with a
 * plain, empty collection and no sample projects; this is the action the app
 * shell calls once on first load.
 */
export type SampleWorkspaceResult = {
  created: boolean;
  projectIds: string[];
};

export default defineAction({
  description:
    "Create the starting sample projects and collection for an account with no work yet. Safe to call repeatedly.",
  schema: z.object({}).strict(),
  outputSchema: z.object({
    created: z.boolean(),
    projectIds: z.array(z.string()),
  }),
  http: { method: "POST" },
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async () => {
    const current = await requireCurrentWorkspace();
    return ensureSampleWorkspace({
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
    });
  },
});
