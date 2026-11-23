import { defineAction } from "@agent-native/core/action";

import {
  getPublishPreview,
  publishActor,
} from "../server/model/publish-previews.js";
import { ANALYTICS_CONTROL_IDS } from "../shared/analytics-control-ids.js";
import {
  getPublishPreviewInput,
  publishPreviewDetailSchema,
} from "../shared/project-publish.js";

export default defineAction({
  description:
    "Read app preview progress, immutable app layout, and the notebook comparison.",
  schema: getPublishPreviewInput,
  readOnly: true,
  http: { method: "GET" },
  persistInBrowser: false,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: publishPreviewDetailSchema,
  run: async (input, context) =>
    getPublishPreview(
      await publishActor(
        input.projectId,
        ANALYTICS_CONTROL_IDS.readPublishPreview,
        context?.caller ?? "unknown",
      ),
      input,
    ),
});
