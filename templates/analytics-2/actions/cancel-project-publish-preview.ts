import { defineAction } from "@agent-native/core/action";

import {
  cancelPublishPreview,
  publishActor,
} from "../server/model/publish-previews.js";
import { ANALYTICS_CONTROL_IDS } from "../shared/analytics-control-ids.js";
import {
  cancelPublishPreviewInput,
  cancelPublishPreviewReceiptSchema,
} from "../shared/project-publish.js";

export default defineAction({
  description: "Cancel a publish preview by its original create request ID.",
  schema: cancelPublishPreviewInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: cancelPublishPreviewReceiptSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) =>
    cancelPublishPreview(
      await publishActor(
        input.projectId,
        ANALYTICS_CONTROL_IDS.cancelPublishPreview,
        context?.caller ?? "unknown",
      ),
      input,
    ),
});
