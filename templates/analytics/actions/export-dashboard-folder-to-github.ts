import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  exportFolderSync,
  syncCallerFromRequest,
} from "../server/lib/dashboard-github-sync/folder-sync";

export default defineAction({
  description:
    "Export app changes from a linked dashboard folder as one GitHub pull request. Only dashboards " +
    "whose GitHub file is unchanged since the last sync are exported; others are skipped with a reason " +
    "(pull first). The dashboards stay out of sync with GitHub until the PR merges, and the next " +
    "pull or export finishes the bookkeeping. Fails if an export PR is already open.",
  schema: z.object({
    folderId: z.string().min(1).describe("Dashboard folder ID"),
  }),
  http: { method: "POST" },
  run: async ({ folderId }) => exportFolderSync(folderId, syncCallerFromRequest()),
});
