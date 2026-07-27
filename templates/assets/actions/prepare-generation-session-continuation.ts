import { defineAction } from "@agent-native/core";
import { z } from "zod";

import getGenerationSession from "./get-generation-session.js";

export default defineAction({
  description:
    "Prepare a chat-ready continuation prompt for a generation handoff session. Use this when a designer wants to continue refining the selected image with the session context already loaded.",
  schema: z.object({
    id: z.string(),
    feedback: z.string().optional(),
  }),
  readOnly: true,
  run: async ({ id, feedback }) => {
    const detail = (await getGenerationSession.run({ id })) as any;
    const session = detail.session;
    const preset = detail.preset;
    const activeAsset =
      detail.assets?.find((asset: any) => asset.id === session.activeAssetId) ??
      detail.assets?.[0] ??
      null;
    const runIds = (detail.runs ?? []).map((run: any) => run.id).join(", ");
    const assetIds = (detail.assets ?? [])
      .map((asset: any) => asset.id)
      .join(", ");
    const nextFeedback =
      feedback?.trim() ||
      "Ask me what should change, then refine the active image.";
    const message = activeAsset
      ? [
          `Continue generation session ${session.id}.`,
          `Refine active image ${activeAsset.id}.`,
          `Feedback: ${nextFeedback}`,
          "Call refine-image with the active assetId, preserve session context, then add the result back to the session.",
        ].join("\n")
      : [
          `Continue generation session ${session.id}.`,
          `Brief: ${session.brief || session.title}`,
          `Feedback: ${nextFeedback}`,
          "Call generate-image using the session library, preset, and collection context.",
        ].join("\n");
    const context = [
      "## Assets generation handoff",
      `Session: ${session.title} (${session.id})`,
      `Library ID: ${session.libraryId}`,
      `Collection ID: ${session.collectionId || "none"}`,
      `Preset ID: ${session.presetId || "none"}`,
      preset
        ? `Preset: ${preset.title}; ${preset.aspectRatio}; ${preset.textPolicy}`
        : "Preset: none",
      `Brief: ${session.brief || ""}`,
      `Feedback summary: ${session.feedbackSummary || ""}`,
      `Active asset ID: ${activeAsset?.id || "none"}`,
      `Candidate asset IDs: ${assetIds || "none"}`,
      `Run IDs: ${runIds || "none"}`,
      "",
      "When a new candidate is generated, call update-generation-session with the new assetId/runId and keep the session open unless the user approves the result.",
    ].join("\n");
    return {
      sessionId: session.id,
      libraryId: session.libraryId,
      presetId: session.presetId,
      activeAssetId: activeAsset?.id ?? null,
      message,
      context,
    };
  },
});
