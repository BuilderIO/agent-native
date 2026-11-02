import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { authorizeDiagnosticCapture } from "../server/lib/diagnostic-context.js";
export default defineAction({
  audit: { recordInputs: false },
  description:
    "Authorize explicit private context collection for one recording and capture identity. UI/internal use only.",
  agentTool: false,
  schema: z.object({
    recordingId: z.string(),
    captureId: z.string().min(1).max(200),
    consent: z.literal(true),
  }),
  outputSchema: z.object({
    authorized: z.literal(true),
    ownerEmail: z.string(),
    orgId: z.string(),
    captureAuthorization: z.string(),
  }),
  run: ({ recordingId, captureId, consent }) =>
    authorizeDiagnosticCapture(recordingId, consent, captureId),
});
