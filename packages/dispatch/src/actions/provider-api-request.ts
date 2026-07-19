import { createProviderApiRequestAction } from "@agent-native/core/provider-api/actions/provider-api";

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
    http: false,
  },
);
