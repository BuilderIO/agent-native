/**
 * Thin Design re-export of staged dataset listing, pre-bound to appId="design".
 */
import { createListStagedDatasetsAction } from "@agent-native/core/provider-api/actions/staged-datasets";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { DESIGN_APP_ID } from "../server/lib/provider-api.js";

export default createListStagedDatasetsAction({
  description:
    "List staged datasets stored by provider-api-request (stageAs) for the current user. Returns dataset ids, names, row counts, columns, and sizes. Use dataset ids with query-staged-dataset to aggregate, or with delete-staged-dataset to free scratch storage.",
  schema: z.object({}),
  appId: DESIGN_APP_ID,
  getOwnerEmail: () => getCredentialContext()?.userEmail ?? null,
  http: { method: "GET" },
});
