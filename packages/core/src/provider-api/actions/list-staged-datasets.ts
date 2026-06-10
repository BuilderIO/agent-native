/**
 * list-staged-datasets — enumerate scratch datasets staged by the current user.
 */
import { defineAction } from "../../action.js";
import { z } from "zod";
import { getCredentialContext } from "../../server/request-context.js";
import { listStagedDatasets } from "../staged-datasets-store.js";

export default defineAction({
  description:
    "List staged datasets stored by provider-api-request (stageAs) for the current user and app. " +
    "Returns dataset ids, names, row counts, columns, and sizes. " +
    "Use these ids with query-staged-dataset to run aggregations, or with delete-staged-dataset to free space.",
  schema: z.object({
    appId: z
      .string()
      .min(1)
      .describe(
        "App id that owns the datasets (must match the staging context).",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx)
      throw new Error("No authenticated context for list-staged-datasets.");

    const datasets = await listStagedDatasets({
      appId: args.appId,
      ownerEmail: ctx.userEmail,
    });

    return {
      datasets: datasets.map((d) => ({
        id: d.id,
        name: d.name,
        rowCount: d.rowCount,
        columns: d.columns,
        byteSize: d.byteSize,
        updatedAt: new Date(d.updatedAt).toISOString(),
      })),
      total: datasets.length,
    };
  },
});
