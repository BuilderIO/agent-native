import { resolveActiveOrgIdForStorageCredential } from "../org/index.js";
import { isAttachmentEncryptionKeyAvailable } from "../private-blob/attachment-ref.js";
import { getPrivateBlobStorageReadinessForRequest } from "../private-blob/registry.js";
import { canAuthorizeBuilderApiRequest } from "../server/builder-api-auth.js";
import { BUILDER_ASSETS_WRITE_SCOPE } from "../server/builder-oauth.js";
import {
  getRequestBuilderStorageCredentialOrgId,
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";

export interface PrivateStorageReadinessStatus {
  selectedOrg: "selected" | "none" | "unavailable";
  provider: "s3" | "builder" | "none" | "other" | "unavailable";
  readiness: "ready" | "unavailable";
  builderAuthorized: "yes" | "no" | "unavailable";
}

const UNAVAILABLE_STATUS: PrivateStorageReadinessStatus = {
  selectedOrg: "unavailable",
  provider: "unavailable",
  readiness: "unavailable",
  builderAuthorized: "unavailable",
};

function toProviderStatus(
  providerId: string | null,
): PrivateStorageReadinessStatus["provider"] {
  if (!providerId) return "none";
  if (providerId === "s3" || providerId === "builder") return providerId;
  return "other";
}

export async function getPrivateStorageReadinessForRequest(): Promise<PrivateStorageReadinessStatus> {
  const context = getRequestContext();
  const storageOrgId = getRequestBuilderStorageCredentialOrgId();
  if (
    !context?.userEmail?.trim() ||
    context.orgScope !== "personal" ||
    !Object.prototype.hasOwnProperty.call(context, "orgId") ||
    context.orgId !== undefined ||
    storageOrgId === undefined ||
    (typeof storageOrgId === "string" && !storageOrgId.trim())
  ) {
    return UNAVAILABLE_STATUS;
  }

  const [storageResult, builderResult, encryptionReady] =
    await Promise.allSettled([
      getPrivateBlobStorageReadinessForRequest(),
      canAuthorizeBuilderApiRequest(BUILDER_ASSETS_WRITE_SCOPE),
      isAttachmentEncryptionKeyAvailable(),
    ]);
  return {
    selectedOrg: storageOrgId === null ? "none" : "selected",
    provider:
      storageResult.status === "fulfilled"
        ? toProviderStatus(storageResult.value.providerId)
        : "unavailable",
    readiness:
      storageResult.status === "fulfilled" &&
      storageResult.value.configured &&
      encryptionReady.status === "fulfilled" &&
      encryptionReady.value
        ? "ready"
        : "unavailable",
    builderAuthorized:
      builderResult.status === "fulfilled"
        ? builderResult.value
          ? "yes"
          : "no"
        : "unavailable",
  };
}

export async function getPrivateStorageReadinessForUser(
  userEmail: string | undefined,
): Promise<PrivateStorageReadinessStatus> {
  const email = userEmail?.trim();
  if (!email) return UNAVAILABLE_STATUS;

  try {
    const storageOrgId = await resolveActiveOrgIdForStorageCredential(email);
    return await runWithRequestContext(
      {
        userEmail: email,
        orgId: undefined,
        orgScope: "personal",
        builderStorageCredentialOrgId: storageOrgId,
      },
      getPrivateStorageReadinessForRequest,
    );
  } catch {
    return UNAVAILABLE_STATUS;
  }
}
