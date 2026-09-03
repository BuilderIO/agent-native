import { createProviderCorpusJobReadAction } from "@agent-native/core/provider-api/corpus-jobs";

import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

// Static action registry marker: createProviderCorpusJobReadAction returns defineAction.
export default createProviderCorpusJobReadAction({
  appId: ANALYTICS_APP_ID,
});
