/**
 * Thin slides re-export of staged dataset deletion, pre-bound to appId="slides".
 */
import { defineAction } from "@agent-native/core";
import { deleteStagedDataset } from "@agent-native/core/provider-api/staged-datasets-store";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { SLIDES_APP_ID } from "../server/lib/provider-api.js";

export default defineAction({
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
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error("No authenticated context for delete-staged-dataset.");
    }

    const deleted = await deleteStagedDataset({
      id: args.datasetId,
      appId: SLIDES_APP_ID,
      ownerEmail: ctx.userEmail,
    });

    if (!deleted) {
      throw new Error(
        `Dataset ${args.datasetId} not found (or belongs to a different owner/app).`,
      );
    }

    return { deleted: true, datasetId: args.datasetId };
  },
});
