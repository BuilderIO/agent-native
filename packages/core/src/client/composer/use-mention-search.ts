import { useMentionSearch as useToolkitMentionSearch } from "@agent-native/toolkit/composer";

import { agentNativePath } from "../api-path.js";

export function useMentionSearch(query: string, enabled: boolean) {
  return useToolkitMentionSearch(query, enabled, agentNativePath);
}
