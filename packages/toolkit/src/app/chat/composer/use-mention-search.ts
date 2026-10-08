import { agentNativePath } from "@agent-native/core/client/api-path";
import { useMentionSearch as useToolkitMentionSearch } from "@agent-native/toolkit/composer";

export function useMentionSearch(query: string, enabled: boolean) {
  return useToolkitMentionSearch(query, enabled, agentNativePath);
}
