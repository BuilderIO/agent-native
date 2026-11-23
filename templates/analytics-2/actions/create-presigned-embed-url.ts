import { defineAction } from "@agent-native/core/action";

import { createPresignedEmbedUrl } from "../server/model/app-embedding.js";
import {
  createPresignedEmbedUrlInput,
  createPresignedEmbedUrlOutput,
} from "../shared/app-embedding.js";

export default defineAction({
  description:
    "Create a time-limited presigned embed URL for a published app with signed embedding enabled.",
  schema: createPresignedEmbedUrlInput,
  outputSchema: createPresignedEmbedUrlOutput,
  http: { method: "POST" },
  persistInBrowser: false,
  run: async (input) => createPresignedEmbedUrl(input),
});
