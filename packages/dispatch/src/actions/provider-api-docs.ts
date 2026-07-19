import { createProviderApiDocsAction } from "@agent-native/core/provider-api/actions/provider-api";

import { fetchProviderApiDocs } from "../server/lib/provider-api.js";

export default createProviderApiDocsAction(
  { fetchDocs: fetchProviderApiDocs },
  {
    description:
      "Inspect provider API docs/spec metadata, or fetch ANY public API documentation page, OpenAPI spec, changelog, or web page. Registered docs/spec URLs from provider-api-catalog are curated starting points, but any public https/http URL is allowed. Use web-search to find documentation URLs first when uncertain, then fetch them here. SSRF guard still applies — private/internal addresses are blocked.",
    http: { method: "GET" },
  },
);
