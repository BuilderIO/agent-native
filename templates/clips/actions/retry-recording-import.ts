import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { recordingMediaProvenance } from "../server/lib/recording-media-provenance.js";
import importRecording from "./import-loom-recording.js";
export default defineAction({
  description:
    "Retry an existing imported video by recording ID using its privately stored source. Requires editor access; does not expose source URLs or captured window titles.",
  schema: z.object({ recordingId: z.string() }),
  outputSchema: z.object({ recordingId: z.string(), status: z.string() }),
  audit: { recordInputs: false },
  run: async ({ recordingId }, ctx) => {
    const { resource } = await assertAccess("recording", recordingId, "editor");
    const recording = resource as {
      sourceAppName: string | null;
      sourceWindowTitle: string | null;
      videoUrl?: string | null;
      videoFormat?: string | null;
    };
    if (
      !recordingMediaProvenance(recording).sourceProvider ||
      !recording.sourceWindowTitle
    )
      fail("The recording has no retryable imported source.", {
        errorCode: "import_source_unavailable",
        statusCode: 409,
      });
    const result = await importRecording.run(
      { recordingId, url: recording.sourceWindowTitle },
      ctx,
    );
    return { recordingId: result.recordingId, status: result.status };
  },
});
