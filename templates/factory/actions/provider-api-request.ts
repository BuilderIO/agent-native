import { createProviderApiRequestAction } from "@agent-native/core/provider-api/actions/provider-api";
import { getCredentialContext } from "@agent-native/core/server/request-context";

import {
  executeProviderApiRequest,
  FACTORY_APP_ID,
} from "../server/lib/provider-api.js";

export default createProviderApiRequestAction(
  { executeRequest: executeProviderApiRequest },
  {
    description:
      "Call a connected provider API with shared workspace credentials. Use this flexible escape hatch when a Factory workflow needs a provider, endpoint, filter, pagination mode, payload, or API version that a compatibility action does not model. Never ask for or store provider keys in Factory.",
    appId: FACTORY_APP_ID,
    getOwnerEmail: () => getCredentialContext()?.userEmail ?? null,
  },
);
