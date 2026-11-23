import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listProjectFiles,
  projectFileSchema,
} from "../server/model/project-files.js";
export default defineAction({
  description:
    "List the uploaded files in a readable project. File bytes are loaded only on download.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: z.object({ files: z.array(projectFileSchema) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ projectId }) => ({ files: await listProjectFiles(projectId) }),
});
