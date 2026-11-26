import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { startCapture } from "../server/lib/motion-capture.js";
import { captureSessionSchema } from "./lib/capture-schemas.js";

export default defineAction({
  mcpTool: true,
  description:
    "Request bounded recording on an armed Clips host. Poll get-capture-session until recording; queued, starting and beginning are not READY. Reuse requestId only for retries of the same request.",
  schema: z.object({
    hostId: z.string().uuid(),
    requestId: z.string().min(1).max(100),
    captureMode: z.enum(["normal", "motion"]).default("motion"),
    maxDurationMs: z.number().int().min(1000).max(120000).default(30000),
  }),
  outputSchema: captureSessionSchema,
  run: startCapture,
});
