import {
  PROVIDER_API_IDS,
  createProviderApiRuntime,
  type ProviderApiCredentialResolver,
  type ProviderApiDocsOptions,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

import {
  hasCredentialLookupError,
  inspectSourceCredentialAvailability,
  resolveSourceCredentialWithProvenance,
} from "./source-credentials.js";

export const BRAIN_APP_ID = "brain";
export const BRAIN_PROVIDER_API_IDS = PROVIDER_API_IDS;
export type BrainProviderApiId = ProviderApiId;
export type { ProviderApiMethod, ProviderApiRequestArgs };

const resolveBrainCredential: ProviderApiCredentialResolver = async ({
  provider,
  key,
  ctx,
  workspaceProvider,
  connectionId,
}) => {
  const resolvedProvider = workspaceProvider ?? provider;
  const credentialContext =
    resolvedProvider === "gong"
      ? { ...ctx, credentialScope: "org" as const }
      : ctx;
  const credentialOptions = {
    provider: resolvedProvider,
    key,
    ctx: credentialContext,
    workspaceConnectionId: connectionId,
  };
  const isGongCredential = resolvedProvider === "gong";
  const isOptionalGongBaseUrl = isGongCredential && key === "GONG_API_BASE";
  const gongCredentialVerificationError = isOptionalGongBaseUrl
    ? "Brain could not verify the organization Gong API base URL from its credential vault."
    : "Brain could not verify the organization Gong credential from its credential vault.";
  if (isGongCredential) {
    const availability =
      await inspectSourceCredentialAvailability(credentialOptions);
    if (!availability.available) {
      if (hasCredentialLookupError(availability)) {
        throw new Error(gongCredentialVerificationError);
      }
      return null;
    }
  }

  const credential =
    await resolveSourceCredentialWithProvenance(credentialOptions);
  if (!credential) {
    if (isGongCredential) throw new Error(gongCredentialVerificationError);
    return null;
  }
  const { provenance } = credential;
  return {
    key,
    value: credential.value,
    source: provenance.source,
    provider: provenance.provider,
    connectionId: provenance.connectionId,
    connectionLabel: provenance.connectionLabel,
    scope: provenance.scope,
    scopeId: provenance.scopeId,
  };
};

const runtime = createProviderApiRuntime({
  appId: BRAIN_APP_ID,
  localCredentialSource: "brain_local",
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Brain provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
  resolveCredential: resolveBrainCredential,
});

export function listProviderApiCatalog(provider?: BrainProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(
  options: ProviderApiDocsOptions & { provider: BrainProviderApiId },
) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}

export function getBrainProviderApiRuntime() {
  return runtime;
}
