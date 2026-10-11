import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  previewFolderSync,
  syncCallerFromRequest,
} from "../server/lib/dashboard-github-sync/folder-sync";

export default defineAction({
  description:
    "Compare a linked dashboard folder with its GitHub folder without writing anything. " +
    "Returns each dashboard's status: in-sync, github-changed, app-changed, both-changed, conflict, " +
    "not-exported, new-in-github, removed-in-github, export-pending, or no-access, plus the units " +
    "(panel:<id>, order, meta) that pull or export would change or that conflict.",
  schema: z.object({
    folderId: z.string().min(1).describe("Dashboard folder ID"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ folderId }) =>
    previewFolderSync(folderId, syncCallerFromRequest()),
});
