import { createQueryStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";

import { DISPATCH_APP_ID } from "../server/lib/provider-api.js";

export default createQueryStagedDatasetAction({
  appId: DISPATCH_APP_ID,
  description:
    "Run a filter/aggregate/project query over a staged dataset previously written by provider-api-request (stageAs). Use after staging provider records, messages, documents, issues, events, or search results to count, group, filter, or project rows without re-fetching provider APIs.",
  http: false,
});
