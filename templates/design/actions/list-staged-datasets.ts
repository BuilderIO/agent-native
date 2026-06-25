/**
 * Thin Design re-export of staged dataset listing, pre-bound to appId="design".
 */
import { defineAction } from "@agent-native/core";
import { listStagedDatasets } from "@agent-native/core/provider-api/staged-datasets-store";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { DESIGN_APP_ID } from "../server/lib/provider-api.js";

export default defineAction({
  description:
    "List staged datasets stored by provider-api-request (stageAs) for the current user. Returns dataset ids, names, row counts, columns, and sizes. Use dataset ids with query-staged-dataset to aggregate, or with delete-staged-dataset to free scratch storage.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error("No authenticated context for list-staged-datasets.");
    }

    const datasets = await listStagedDatasets({
      appId: DESIGN_APP_ID,
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
