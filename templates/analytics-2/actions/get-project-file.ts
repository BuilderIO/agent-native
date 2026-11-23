import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  readProjectFile,
  projectFileSchema,
} from "../server/model/project-files.js";
export default defineAction({
  description:
    "Read an uploaded project file. Text files return their complete text; binary files return a private attachment reference for file tools. Requires read access to the parent project.",
  schema: z
    .object({ projectId: z.string().min(1), fileId: z.string().uuid() })
    .strict(),
  outputSchema: z.object({
    file: projectFileSchema,
    attachmentRef: z.string(),
    text: z.string().nullable(),
  }),
  http: false,
  readOnly: true,
  run: ({ projectId, fileId }) => readProjectFile(projectId, fileId),
});
