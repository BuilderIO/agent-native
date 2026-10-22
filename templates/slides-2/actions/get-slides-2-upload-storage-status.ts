import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { isSlides2UploadStorageReady } from "../server/lib/upload-storage-status.js";

export default defineAction({
  description:
    "Check whether reference-file storage is available to the signed-in Slides 2 workspace.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: true,
  agentTool: false,
  run: async () => ({
    referenceStorageReady: await isSlides2UploadStorageReady(),
  }),
});
