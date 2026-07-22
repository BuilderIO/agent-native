import { createDeleteStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { CRM_APP_ID } from "../server/lib/provider-api.js";

export default createDeleteStagedDatasetAction({
  description:
    "Delete a caller-scoped staged dataset after CRM analysis is complete.",
  schema: z.object({ datasetId: z.string().min(1) }),
  appId: CRM_APP_ID,
  getOwnerEmail: () => getCredentialContext()?.userEmail ?? null,
  http: false,
});
