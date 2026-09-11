import {
  createProviderApiRuntime,
  type ProviderApiDocsOptions,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

export const FACTORY_APP_ID = "factory";

const runtime = createProviderApiRuntime({
  appId: FACTORY_APP_ID,
  localCredentialSource: "factory_local",
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Factory provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
});

export function listProviderApiCatalog(provider?: string) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(options: ProviderApiDocsOptions) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
