import { createProviderApiDocsAction } from "@agent-native/core/provider-api/actions/provider-api";

import { fetchProviderApiDocs } from "../server/lib/provider-api.js";

export default createProviderApiDocsAction(
  { fetchDocs: fetchProviderApiDocs },
  {
    description:
      "Inspect the public API documentation or capability metadata for a connected workspace provider before making an arbitrary provider request.",
  },
);
