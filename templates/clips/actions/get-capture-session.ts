import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCaptureSession } from "../server/lib/motion-capture.js";
import { captureSessionStatusSchema } from "./lib/capture-schemas.js";

export default defineAction({
  mcpTool: true,
  description:
    "Read your capture state, media readiness and action markers. A disconnected recorder is not proof capture stopped; pendingOutcome names a result the recorder holds and is still delivering. Marker times are observations, not exact click presentation.",
  schema: z.object({ sessionId: z.string().uuid() }),
  outputSchema: captureSessionStatusSchema,
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: ({ sessionId }) => getCaptureSession(sessionId),
});
