import { createQueryStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";

export default createQueryStagedDatasetAction({
  appId: "analytics-2",
  description:
    "Filter, project, sort, or aggregate rows from an imported project CSV or other staged dataset. Use list-staged-datasets to find its id; results include row counts and remain owner-scoped.",
});
