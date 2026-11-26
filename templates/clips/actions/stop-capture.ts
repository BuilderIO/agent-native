import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { stopCapture } from "../server/lib/motion-capture.js";
import { captureSessionStatusSchema } from "./lib/capture-schemas.js";

export default defineAction({
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Request that the owning Clips recorder stop. Idempotent. Before READY (state recording) the take is discarded and ends cancelled with no Clip; after READY the Clip is kept, so poll get-capture-session for capture completion and media readiness.",
  schema: z.object({ sessionId: z.string().uuid() }),
  outputSchema: captureSessionStatusSchema,
  run: ({ sessionId }) => stopCapture(sessionId),
});
