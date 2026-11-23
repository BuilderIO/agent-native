import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  readProjectFile,
  projectFileSchema,
} from "../server/model/project-files.js";
export default defineAction({
  description: "Download the exact bytes of a file in a readable project.",
  schema: z
    .object({ projectId: z.string().min(1), fileId: z.string().uuid() })
    .strict(),
  outputSchema: z.object({ file: projectFileSchema, dataBase64: z.string() }),
  readOnly: true,
  agentTool: false,
  run: ({ projectId, fileId }) => readProjectFile(projectId, fileId),
});
