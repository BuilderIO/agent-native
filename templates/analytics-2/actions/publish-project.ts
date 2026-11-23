import { defineAction } from "@agent-native/core/action";

import { publishCheckedPreview } from "../server/model/project-releases.js";
import { publishActor } from "../server/model/publish-previews.js";
import { ANALYTICS_CONTROL_IDS } from "../shared/analytics-control-ids.js";
import {
  publishProjectInput,
  publishProjectReceiptSchema,
} from "../shared/project-publish.js";

export default defineAction({
  description: "Publish the checked preview as an immutable app release.",
  schema: publishProjectInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: publishProjectReceiptSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) =>
    publishCheckedPreview(
      await publishActor(
        input.projectId,
        input.mode === "force"
          ? ANALYTICS_CONTROL_IDS.forcePublishProject
          : ANALYTICS_CONTROL_IDS.publishProject,
        context?.caller ?? "unknown",
      ),
      input,
    ),
});
