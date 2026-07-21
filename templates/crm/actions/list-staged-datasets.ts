import { createListStagedDatasetsAction as defineActionFactory } from "@agent-native/core/provider-api/actions/staged-datasets";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { CRM_APP_ID } from "../server/lib/provider-api.js";

export default defineActionFactory({
  description:
    "List caller-scoped staged HubSpot datasets created by provider-api-request. Use a dataset id with query-staged-dataset to reduce a result, or delete-staged-dataset after analysis.",
  schema: z.object({}),
  appId: CRM_APP_ID,
  getOwnerEmail: () => getCredentialContext()?.userEmail ?? null,
  http: { method: "GET" },
});
