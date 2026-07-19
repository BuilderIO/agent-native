/**
 * Thin calendar re-export of staged dataset deletion, pre-bound to appId="calendar".
 */
import { createDeleteStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";
import { z } from "zod";

import { CALENDAR_APP_ID } from "../server/lib/provider-api.js";

export default createDeleteStagedDatasetAction({
  description:
    "Delete a staged dataset by id, freeing its scratch storage. Use after analysis is complete or before re-staging under the same name. Only the owner who staged the dataset can delete it.",
  schema: z.object({
    datasetId: z
      .string()
      .min(1)
      .describe(
        "Dataset id to delete (from list-staged-datasets or provider-api-request stageAs result).",
      ),
  }),
  http: false,
  appId: CALENDAR_APP_ID,
});
