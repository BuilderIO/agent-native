import { createListStagedDatasetsAction } from "@agent-native/core/provider-api/actions/staged-datasets";

export default createListStagedDatasetsAction({
  appId: "analytics-2",
  description:
    "List complete CSV imports and staged provider datasets owned by the signed-in account.",
});
