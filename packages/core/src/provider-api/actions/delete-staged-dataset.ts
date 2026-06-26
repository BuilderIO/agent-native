import { z } from "zod";

/**
 * delete-staged-dataset — remove a staged dataset and free its storage.
 */
import { defineAction } from "../../action.js";
import { getCredentialContext } from "../../server/request-context.js";
import { deleteStagedDataset } from "../staged-datasets-store.js";

export default defineAction({
  description:
    "Delete a staged dataset by id, freeing its scratch storage. " +
    "Use after analysis is complete or before re-staging a large dataset under the same name. " +
    "Only the owner who staged the dataset can delete it.",
  schema: z.object({
    datasetId: z
      .string()
      .min(1)
      .describe(
        "Dataset id to delete (from list-staged-datasets or provider-api-request stageAs result).",
      ),
    appId: z.string().min(1).describe("App id that owns the dataset."),
  }),
  http: false,
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx)
      throw new Error("No authenticated context for delete-staged-dataset.");

    const deleted = await deleteStagedDataset({
      id: args.datasetId,
      appId: args.appId,
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
