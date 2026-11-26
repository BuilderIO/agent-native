import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { addCaptureMarker } from "../server/lib/motion-capture.js";
import { captureMarkerSchema } from "./lib/capture-schemas.js";

export default defineAction({
  mcpTool: true,
  description:
    "Mark action intent or an observed endpoint during recording. Wait for the returned marker to receive mediaTimeMs via get-capture-session before relying on its timeline position.",
  schema: z.object({
    sessionId: z.string().uuid(),
    requestId: z.string().min(1).max(100),
    label: z.string().trim().min(1).max(200),
    kind: z.enum(["action-intent", "observed-endpoint", "note"]),
  }),
  outputSchema: captureMarkerSchema,
  run: addCaptureMarker,
});
