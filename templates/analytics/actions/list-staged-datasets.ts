/**
 * Thin analytics re-export of the core list-staged-datasets action.
 */
import { createListStagedDatasetsAction } from "@agent-native/core/provider-api/actions/staged-datasets";
import { z } from "zod";

import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

export default createListStagedDatasetsAction({
  description:
    "List staged datasets stored by provider-api-request (stageAs) for the current user. " +
    "Returns dataset ids, names, row counts, columns, and sizes. " +
    "Use dataset ids with query-staged-dataset to aggregate, or with delete-staged-dataset to free space.",
  schema: z.object({}),
  http: { method: "GET" },
  appId: ANALYTICS_APP_ID,
});
