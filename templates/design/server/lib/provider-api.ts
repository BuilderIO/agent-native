import {
  createProviderApiRuntime,
  listProviderApiIdsForTemplateUse,
  type ProviderApiDocsOptions,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

import { rethrowFigmaProviderFailure } from "./figma-import-errors.js";

export const DESIGN_APP_ID = "design";
export const DESIGN_PROVIDER_API_IDS = listProviderApiIdsForTemplateUse(
  "design",
) as [ProviderApiId, ...ProviderApiId[]];
export type DesignProviderApiId = (typeof DESIGN_PROVIDER_API_IDS)[number];
export type { ProviderApiMethod, ProviderApiRequestArgs };

const runtime = createProviderApiRuntime({
  appId: DESIGN_APP_ID,
  providerIds: DESIGN_PROVIDER_API_IDS,
  localCredentialSource: `${DESIGN_APP_ID}_local`,
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Design provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
});

export function getDesignProviderApiRuntime() {
  return runtime;
}

export function listProviderApiCatalog(provider?: DesignProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(
  options: ProviderApiDocsOptions & { provider: DesignProviderApiId },
) {
  return runtime.fetchDocs(options);
}

export async function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  try {
    return await runtime.executeRequest(args);
  } catch (error) {
    // Credential resolution throws before any HTTP envelope exists, so the
    // envelope reader never sees it. Classify here, at the one place every
    // Design provider request passes through.
    if (args.provider === "figma") rethrowFigmaProviderFailure(error);
    throw error;
  }
}
