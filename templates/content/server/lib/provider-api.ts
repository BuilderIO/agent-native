import {
  createProviderApiRuntime,
  type ProviderApiCredentialResolver,
  type ProviderApiDocsOptions,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

import { getNotionConnectionForOwner } from "./notion.js";

export const CONTENT_APP_ID = "content";
export const CONTENT_PROVIDER_API_IDS = ["notion"] as [
  ProviderApiId,
  ...ProviderApiId[],
];
export type ContentProviderApiId = (typeof CONTENT_PROVIDER_API_IDS)[number];
export type { ProviderApiMethod, ProviderApiRequestArgs };

const resolveContentCredential: ProviderApiCredentialResolver = async (
  options,
) => {
  if (options.provider !== "notion" || options.key !== "NOTION_API_KEY") {
    return null;
  }

  const connection = await getNotionConnectionForOwner(options.ctx.userEmail);
  if (!connection?.accessToken) return null;

  return {
    key: "NOTION_OAUTH_TOKEN",
    value: connection.accessToken,
    source: `${CONTENT_APP_ID}_notion_oauth`,
    provider: "notion",
    accountId: connection.accountId,
    accountLabel: connection.workspaceName,
  };
};

const runtime = createProviderApiRuntime({
  appId: CONTENT_APP_ID,
  providerIds: CONTENT_PROVIDER_API_IDS,
  localCredentialSource: `${CONTENT_APP_ID}_local`,
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Content provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
  resolveCredential: resolveContentCredential,
});

export function getContentProviderApiRuntime() {
  return runtime;
}

export function listProviderApiCatalog(provider?: ContentProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(
  options: ProviderApiDocsOptions & { provider: ContentProviderApiId },
) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
