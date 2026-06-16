import {
  PROVIDER_API_IDS,
  createProviderApiRuntime,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

export const DISPATCH_APP_ID = "dispatch";
export const DISPATCH_PROVIDER_API_IDS = PROVIDER_API_IDS;
export type DispatchProviderApiId = ProviderApiId;
export type { ProviderApiMethod, ProviderApiRequestArgs };

const runtime = createProviderApiRuntime({
  appId: DISPATCH_APP_ID,
  localCredentialSource: "dispatch_local",
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Dispatch provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
});

export function listProviderApiCatalog(provider?: DispatchProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(options: {
  provider: DispatchProviderApiId;
  url?: string;
  maxBytes?: number;
}) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
