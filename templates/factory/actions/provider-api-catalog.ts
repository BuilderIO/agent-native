import { createProviderApiCatalogAction } from "@agent-native/core/provider-api/actions/provider-api";

import { listProviderApiCatalog } from "../server/lib/provider-api.js";

export default createProviderApiCatalogAction(
  { listCatalog: listProviderApiCatalog },
  {
    description:
      "List the provider APIs available through shared workspace integrations. Use this to discover connected capabilities and connection metadata without exposing secret values.",
    guidance:
      "Factory does not own provider keys. Use the workspace integrations configured in Dispatch or the shared app settings. Provider-specific Factory actions are compatibility adapters; use provider-api-docs and provider-api-request for other connected providers or endpoints.",
  },
);
