/**
 * Thin slides re-export of staged dataset deletion, pre-bound to appId="slides".
 */
import { createDeleteStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { SLIDES_APP_ID } from "../server/lib/provider-api.js";

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
  appId: SLIDES_APP_ID,
  getOwnerEmail: () => getCredentialContext()?.userEmail ?? null,
  http: false,
});
