import {
  createProviderApiRuntime,
  type ProviderApiCredentialResolver,
  type ProviderApiId,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";
import { resolveWorkspaceConnectionCredentialForApp } from "@agent-native/core/workspace-connections";

export const CRM_APP_ID = "crm";
export const CRM_PROVIDER_API_IDS = ["hubspot"] as [ProviderApiId];

const resolveCrmProviderCredential: ProviderApiCredentialResolver = async ({
  provider,
  key,
  ctx,
  workspaceProvider,
  connectionId,
}) => {
  const resolvedProvider = workspaceProvider ?? provider;
  const credential = await resolveWorkspaceConnectionCredentialForApp({
    appId: CRM_APP_ID,
    provider: resolvedProvider,
    key,
    ...(connectionId ? { connectionId } : {}),
    userEmail: ctx.userEmail,
    orgId: ctx.orgId ?? null,
  });
  if (!credential.available || !credential.value || !credential.provenance) {
    return null;
  }

  return {
    key: credential.provenance.resolvedKey,
    value: credential.value,
    source: "workspace_connection",
    provider: resolvedProvider,
    connectionId: credential.provenance.connectionId,
    connectionLabel: credential.provenance.connectionLabel,
    scope: credential.provenance.secretScope,
  };
};

const runtime = createProviderApiRuntime({
  appId: CRM_APP_ID,
  providerIds: CRM_PROVIDER_API_IDS,
  localCredentialSource: "crm_workspace_connection",
  getCredentialContext: () => {
    const context = getCredentialContext();
    if (!context) {
      throw new Error(
        "CRM provider API requests require an authenticated request context.",
      );
    }
    return context;
  },
  resolveCredential: resolveCrmProviderCredential,
});

export function getCrmProviderApiRuntime() {
  return runtime;
}
