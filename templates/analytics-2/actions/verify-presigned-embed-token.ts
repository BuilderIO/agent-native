import { defineAction } from "@agent-native/core/action";

import { verifyPresignedEmbedToken } from "../server/model/app-embedding.js";
import {
  verifyPresignedEmbedTokenInput,
  verifyPresignedEmbedTokenOutput,
} from "../shared/app-embedding.js";

export default defineAction({
  description:
    "Verify a presigned embed token for a published app and return its status and user attributes.",
  schema: verifyPresignedEmbedTokenInput,
  outputSchema: verifyPresignedEmbedTokenOutput,
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  persistInBrowser: false,
  run: async (input) => verifyPresignedEmbedToken(input),
});
