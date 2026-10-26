import {
  canAuthorizeBuilderApiRequest,
  hasBuilderApiCredentialCustody,
  isBuilderReauthorizationRequired,
} from "../server/builder-api-auth.js";
import { BUILDER_ASSETS_WRITE_SCOPE } from "../server/builder-oauth.js";
import { listFileUploadProviderStatusesForRequest } from "./registry.js";

/** Status probes isolate failures; upload dispatch still fails closed. */
export async function getFileUploadStatusForRequest() {
  const providerStatuses = await listFileUploadProviderStatusesForRequest();
  let builderConfigured = false;
  let builderUploadConfigured = false;
  let builderUnavailable = false;
  let builderReauthorizationRequired = false;
  try {
    builderConfigured = await hasBuilderApiCredentialCustody();
    builderUploadConfigured = await canAuthorizeBuilderApiRequest(
      BUILDER_ASSETS_WRITE_SCOPE,
    );
    builderReauthorizationRequired =
      builderConfigured && !builderUploadConfigured;
  } catch (error) {
    builderUnavailable = true;
    builderReauthorizationRequired = isBuilderReauthorizationRequired(error);
  }

  const providers = providerStatuses.map(
    ({ provider, configured, unavailable }) => ({
      id: provider.id,
      name: provider.name,
      configured:
        provider.id === "builder" ? builderUploadConfigured : configured,
      unavailable: provider.id === "builder" ? builderUnavailable : unavailable,
    }),
  );
  const activeProvider =
    providers.find((provider) => provider.configured) ??
    (builderUploadConfigured ? { id: "builder", name: "Builder.io" } : null);

  return {
    configured: activeProvider !== null,
    activeProvider: activeProvider
      ? { id: activeProvider.id, name: activeProvider.name }
      : null,
    providers,
    builderConfigured,
    builderUploadConfigured,
    builderUnavailable,
    builderReauthorizationRequired,
  };
}
