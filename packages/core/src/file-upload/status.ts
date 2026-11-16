import {
  canAuthorizeBuilderApiRequest,
  hasBuilderApiCredentialCustody,
  hasStoredBuilderApiOAuthGrant,
  isBuilderReauthorizationRequired,
} from "../server/builder-api-auth.js";
import { BUILDER_ASSETS_WRITE_SCOPE } from "../server/builder-oauth.js";
import { listFileUploadProviderStatusesForRequest } from "./registry.js";

/**
 * Whether this request can upload to Builder and, when it cannot, whether its
 * owner must reconnect. Every storage status surface reads this one answer so
 * the reconnect prompt cannot drift between apps.
 */
export async function getBuilderUploadCredentialStatus() {
  const builderConfigured = await hasBuilderApiCredentialCustody();
  const builderUploadConfigured = await canAuthorizeBuilderApiRequest(
    BUILDER_ASSETS_WRITE_SCOPE,
  );
  // A grant this deployment cannot decrypt is not custody, so it would
  // otherwise read as never connected while every upload fails.
  const builderReauthorizationRequired =
    !builderUploadConfigured &&
    (builderConfigured || (await hasStoredBuilderApiOAuthGrant()));
  return {
    builderConfigured,
    builderUploadConfigured,
    builderReauthorizationRequired,
  };
}

/** Status probes isolate failures; upload dispatch still fails closed. */
export async function getFileUploadStatusForRequest() {
  const providerStatuses = await listFileUploadProviderStatusesForRequest();
  let builderConfigured = false;
  let builderUploadConfigured = false;
  let builderUnavailable = false;
  let builderReauthorizationRequired = false;
  try {
    ({
      builderConfigured,
      builderUploadConfigured,
      builderReauthorizationRequired,
    } = await getBuilderUploadCredentialStatus());
  } catch (error) {
    builderUnavailable = true;
    builderReauthorizationRequired = isBuilderReauthorizationRequired(error);
  }

  const providers = providerStatuses.map(
    ({ provider, configured, unavailable }) => ({
      id: provider.id,
      name: provider.name,
      configured:
        configured && (provider.id !== "builder" || builderUploadConfigured),
      unavailable:
        unavailable || (provider.id === "builder" && builderUnavailable),
    }),
  );
  const first = providerStatuses.find(
    (status) => status.configured || status.unavailable,
  );
  const candidate = first?.provider ?? { id: "builder", name: "Builder.io" };
  const usesBuilder = candidate.id === "builder";
  const unavailable =
    Boolean(first?.unavailable) || (usesBuilder && builderUnavailable);
  // Null keeps an indeterminate read out of existing clients' setup path.
  const configured = unavailable
    ? null
    : usesBuilder
      ? builderUploadConfigured
      : true;

  return {
    configured,
    unavailable,
    activeProvider: configured
      ? { id: candidate.id, name: candidate.name }
      : null,
    providers,
    builderConfigured,
    builderUploadConfigured,
    builderUnavailable,
    builderReauthorizationRequired,
  };
}
