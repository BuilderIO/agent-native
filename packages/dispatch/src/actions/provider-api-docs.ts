import {
  createProviderApiDocsAction,
  createProviderApiDocsSchema,
} from "@agent-native/core/provider-api/actions/provider-api";
import { z } from "zod";

import { fetchProviderApiDocs } from "../server/lib/provider-api.js";

export default createProviderApiDocsAction(
  { fetchDocs: fetchProviderApiDocs },
  {
    description:
      "Inspect provider API docs/spec metadata, or fetch ANY public API documentation page, OpenAPI spec, changelog, or web page. Registered docs/spec URLs from provider-api-catalog are curated starting points, but any public https/http URL is allowed. Use web-search to find documentation URLs first when uncertain, then fetch them here. SSRF guard still applies — private/internal addresses are blocked.",
    schema: createProviderApiDocsSchema(
      z
        .string()
        .min(1)
        .describe(
          "Provider whose API docs/spec to inspect. Can be a built-in provider id or a custom provider id registered via provider-api-register.",
        ),
    ),
    http: { method: "GET" },
  },
);
