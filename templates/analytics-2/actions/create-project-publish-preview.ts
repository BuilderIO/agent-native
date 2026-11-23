import { defineAction } from "@agent-native/core/action";

import {
  createPublishPreview,
  publishActor,
} from "../server/model/publish-previews.js";
import { ANALYTICS_CONTROL_IDS } from "../shared/analytics-control-ids.js";
import {
  createPublishPreviewInput,
  publishPreviewReceiptSchema,
} from "../shared/project-publish.js";

export default defineAction({
  description:
    "Run an independent app preview for the accepted notebook head and shared defaults.",
  schema: createPublishPreviewInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: publishPreviewReceiptSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async (input, context) =>
    createPublishPreview(
      await publishActor(
        input.projectId,
        ANALYTICS_CONTROL_IDS.createPublishPreview,
        context?.caller ?? "unknown",
      ),
      input,
    ),
});
