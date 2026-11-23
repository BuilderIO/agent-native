import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { trashProjectFile } from "../server/model/project-files.js";
export default defineAction({
  description:
    "Move an uploaded file to Trash without permanently deleting its private bytes.",
  schema: z
    .object({ projectId: z.string().min(1), fileId: z.string().uuid() })
    .strict(),
  outputSchema: z.object({ trashed: z.boolean() }),

  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: ({ projectId, fileId }) => trashProjectFile(projectId, fileId),
});
