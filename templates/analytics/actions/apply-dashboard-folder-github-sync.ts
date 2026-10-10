import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  applyFolderSync,
  syncCallerFromRequest,
} from "../server/lib/dashboard-github-sync/folder-sync";

export default defineAction({
  description:
    "Pull changes from a linked GitHub folder into its dashboards. Only the panels, order, and " +
    "settings that changed in GitHub are written, so edits made in the app to other panels are kept. " +
    "Units that both sides changed are reported as conflicts and left alone. Creates dashboards for " +
    "files that have no dashboard yet. Fails if an export PR is still open.",
  schema: z.object({
    folderId: z.string().min(1).describe("Dashboard folder ID"),
  }),
  http: { method: "POST" },
  run: async ({ folderId }) =>
    applyFolderSync(folderId, syncCallerFromRequest()),
});
