import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { checkDiagnosticCaptureAuthorization } from "../server/lib/diagnostic-context.js";
export default defineAction({
  audit: { recordInputs: false },
  description:
    "Check an existing capture receipt against the current account and organization before resuming an approved upload. Grants no permission for new collection. UI/internal use only.",
  agentTool: false,
  readOnly: true,
  schema: z.object({
    recordingId: z.string(),
    captureId: z.string(),
    captureAuthorization: z.string().max(8000),
  }),
  outputSchema: z.object({ ownerEmail: z.string(), orgId: z.string() }),
  run: ({ recordingId, captureId, captureAuthorization }) =>
    checkDiagnosticCaptureAuthorization(
      recordingId,
      captureId,
      captureAuthorization,
    ),
});
