import { createDeleteStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";

export default {
  ...createDeleteStagedDatasetAction({
    appId: "analytics-2",
    description:
      "Delete a staged dataset, including an imported project CSV. Use only when the user asks to remove that dataset.",
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
};
