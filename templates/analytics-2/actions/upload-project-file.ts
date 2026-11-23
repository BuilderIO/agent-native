import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  uploadProjectFile,
  projectFileSchema,
} from "../server/model/project-files.js";
export default defineAction({
  description:
    "Upload a file into an editable project using private file storage. Only metadata is kept in SQL.",
  schema: z
    .object({
      projectId: z.string().min(1),
      filename: z.string().trim().min(1).max(255),
      mimeType: z.string().min(1).max(120),
      dataBase64: z.string().min(1).max(2800000),
    })
    .strict(),
  outputSchema: z.object({ file: projectFileSchema }),
  agentTool: false,
  run: uploadProjectFile,
});
