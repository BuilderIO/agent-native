import { defineAction } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { CLIPS_AI_REQUEST_KINDS } from "../shared/ai-request-status.js";

export default defineAction({
  description:
    "Remove a queued Clips AI request only when its kind and timestamp still match.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    kind: z.enum(CLIPS_AI_REQUEST_KINDS).describe("Queued request kind"),
    requestedAt: z.string().datetime(),
  }),
  run: async ({ recordingId, kind, requestedAt }) => {
    await assertAccess("recording", recordingId, "editor");
    const requestKey = `clips-ai-request-${recordingId}`;
    const request = await readAppState(requestKey);
    if (
      !request ||
      request.recordingId !== recordingId ||
      request.kind !== kind ||
      request.requestedAt !== requestedAt
    ) {
      return { recordingId, kind, requestedAt, consumed: false };
    }

    const consumed = await compareAndSetAppState(requestKey, request, null);
    if (consumed) {
      try {
        await writeAppState("refresh-signal", { ts: Date.now() });
      } catch (error) {
        console.warn("[clips] failed to publish AI request refresh signal", {
          recordingId,
          kind,
          error,
        });
      }
    }
    return { recordingId, kind, requestedAt, consumed };
  },
});
