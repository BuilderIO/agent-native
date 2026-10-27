import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getClipsVideoStorageStatus } from "../server/lib/video-storage.js";

export default defineAction({
  description:
    "Return the current Clips recording storage mode, available hosted trial clips, and any reason hosted storage is unavailable. Use this before asking someone to connect Builder.io storage.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, actionContext) =>
    getClipsVideoStorageStatus({
      email: actionContext?.userEmail,
      requestHeaders: actionContext?.requestHeaders,
    }),
});
