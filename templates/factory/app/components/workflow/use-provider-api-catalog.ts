import { useActionQuery } from "@agent-native/core/client/hooks";

import type { ApiProviderInfo } from "./api-provider-catalog";

/**
 * The provider catalog that Factory's provider API actions read. It holds base
 * URLs and docs links, not credentials, and changes only with a release, so every
 * reader shares one request that stays fresh for a while.
 */
export function useProviderApiCatalog() {
  return useActionQuery<{ providers: ApiProviderInfo[] }>(
    "provider-api-catalog",
    {},
    { staleTime: 10 * 60_000 },
  );
}
