import { createProviderCorpusJobReadAction } from "@agent-native/core/provider-api/corpus-jobs";
import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

export default createProviderCorpusJobReadAction({
  appId: ANALYTICS_APP_ID,
});
