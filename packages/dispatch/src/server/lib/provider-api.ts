import {
  PROVIDER_API_IDS,
  createProviderApiRuntime,
  listCustomProviders,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

export const DISPATCH_APP_ID = "dispatch";
export const DISPATCH_PROVIDER_API_IDS = PROVIDER_API_IDS;
export type DispatchProviderApiId = ProviderApiId;
export type { ProviderApiMethod, ProviderApiRequestArgs };

function requireCtx(action: string) {
  const ctx = getCredentialContext();
  if (!ctx) {
    throw new Error(
      `Dispatch provider API ${action} requires an authenticated request context.`,
    );
  }
  return ctx;
}

const runtime = createProviderApiRuntime({
  appId: DISPATCH_APP_ID,
  localCredentialSource: "dispatch_local",
  getCredentialContext: () => requireCtx("requests"),
  getCustomProviders: async () => {
    const ctx = getCredentialContext();
    if (!ctx) return [];
    // Load custom providers for both user scope and org scope.
    const results = await Promise.allSettled([
      listCustomProviders("user", ctx.userEmail),
      ctx.orgId ? listCustomProviders("org", ctx.orgId) : Promise.resolve([]),
    ]);
    const userProviders =
      results[0].status === "fulfilled" ? results[0].value : [];
    const orgProviders =
      results[1].status === "fulfilled" ? results[1].value : [];
    // Merge: user-scope providers take precedence over org-scope ones with the
    // same id, and neither can shadow a built-in id.
    const seen = new Set<string>(PROVIDER_API_IDS as unknown as string[]);
    const merged = [];
    for (const p of [...userProviders, ...orgProviders]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        merged.push(p);
      }
    }
    return merged;
  },
});

export function listProviderApiCatalog(provider?: string) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(options: {
  provider: string;
  url?: string;
  maxBytes?: number;
}) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
