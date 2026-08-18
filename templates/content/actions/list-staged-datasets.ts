/**
 * Thin content re-export of staged dataset listing, pre-bound to appId="content".
 */
import { createListStagedDatasetsAction } from "@agent-native/core/provider-api/actions/staged-datasets";
import { z } from "zod";

import { CONTENT_APP_ID } from "../server/lib/provider-api.js";

export default createListStagedDatasetsAction({
  description:
    "List staged datasets stored by provider-api-request (stageAs) for the current user. Returns dataset ids, names, row counts, columns, and sizes. Use dataset ids with query-staged-dataset to aggregate, or with delete-staged-dataset to free scratch storage.",
  schema: z.object({}),
  http: { method: "GET" },
  appId: CONTENT_APP_ID,
});
