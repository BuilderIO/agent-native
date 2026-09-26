import {
  builderFileUploadProvider,
  getActiveFileUploadProviderForRequest,
  listFileUploadProviders,
  type FileUploadProvider,
} from "@agent-native/core/file-upload";
import {
  BUILDER_ASSETS_WRITE_SCOPE,
  canAuthorizeBuilderApiRequest,
} from "@agent-native/core/server";

async function isConfiguredForRequest(
  provider: FileUploadProvider,
): Promise<boolean> {
  if (provider.isConfigured()) return true;
  if (!provider.isConfiguredForRequest) return false;
  try {
    return await provider.isConfiguredForRequest();
  } catch {
    return false;
  }
}

export async function resolveResumableUploadProvider(
  providerId: string,
): Promise<FileUploadProvider | null> {
  const active = await getActiveFileUploadProviderForRequest();
  if (active?.id === providerId && active.resumable) return active;

  if (providerId === builderFileUploadProvider.id) {
    try {
      if (await canAuthorizeBuilderApiRequest(BUILDER_ASSETS_WRITE_SCOPE)) {
        return builderFileUploadProvider;
      }
    } catch {
      return null;
    }
  }

  const registered = listFileUploadProviders().find(
    (provider) => provider.id === providerId,
  );
  if (registered?.resumable && (await isConfiguredForRequest(registered))) {
    return registered;
  }
  return null;
}
