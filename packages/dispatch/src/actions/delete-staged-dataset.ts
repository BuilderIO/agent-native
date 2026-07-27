import { createDeleteStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";

import { DISPATCH_APP_ID } from "../server/lib/provider-api.js";

export default createDeleteStagedDatasetAction({
  appId: DISPATCH_APP_ID,
  description:
    "Delete a staged dataset by id, freeing its scratch storage. Use after analysis is complete or before re-staging under the same name. Only the owner who staged the dataset can delete it.",
  http: false,
});
