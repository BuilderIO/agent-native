import { createProviderCorpusJobAction } from "@agent-native/core/provider-api/corpus-jobs";

import { getAnalyticsProviderApiRuntime } from "../server/lib/provider-api";
import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

// Static action registry marker: createProviderCorpusJobAction returns defineAction.
export default createProviderCorpusJobAction({
  appId: ANALYTICS_APP_ID,
  getRuntime: getAnalyticsProviderApiRuntime,
});
