import {
  createProviderApiRequestAction,
  createProviderApiRequestSchema,
} from "@agent-native/core/provider-api/actions/provider-api";
import { z } from "zod";

import {
  DISPATCH_APP_ID,
  executeProviderApiRequest,
} from "../server/lib/provider-api.js";

export default createProviderApiRequestAction(
  { executeRequest: executeProviderApiRequest },
  {
    appId: DISPATCH_APP_ID,
    description:
      "Make an arbitrary authenticated HTTP request to a shared workspace integration, configured provider API, or custom provider registered via provider-api-register. Use this as the flexible escape hatch when Dispatch needs a provider endpoint, filter, pagination mode, payload, or API version that no canned action models. The request is constrained to the provider host, uses configured credentials automatically, blocks private/internal URLs, and redacts secrets from responses.",
    schema: createProviderApiRequestSchema(
      z
        .string()
        .min(1)
        .describe(
          "Provider id to call — built-in (e.g. slack, github, notion, hubspot, gmail, google_drive, google_calendar, granola, stripe, jira) or a custom provider id registered via provider-api-register. Use provider-api-catalog to list available providers.",
        ),
    ),
    http: false,
  },
);
