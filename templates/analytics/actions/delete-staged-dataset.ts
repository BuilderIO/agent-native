/**
 * Thin analytics re-export of the core delete-staged-dataset action.
 */
import { createDeleteStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";
import { z } from "zod";

import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

export default createDeleteStagedDatasetAction({
  description:
    "Delete a staged dataset by id, freeing its scratch storage. " +
    "Use after analysis is complete or before re-staging under the same name. " +
    "Only the owner who staged the dataset can delete it.",
  schema: z.object({
    datasetId: z
      .string()
      .min(1)
      .describe(
        "Dataset id to delete (from list-staged-datasets or provider-api-request stageAs result).",
      ),
  }),
  http: false,
  appId: ANALYTICS_APP_ID,
});
