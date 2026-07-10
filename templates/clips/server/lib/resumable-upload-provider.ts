import {
  builderFileUploadProvider,
  getActiveFileUploadProviderForRequest,
  listFileUploadProviders,
  type FileUploadProvider,
} from "@agent-native/core/file-upload";
import { resolveHasBuilderPrivateKey } from "@agent-native/core/server";

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

/**
 * Resolve the provider that owns a persisted resumable session.
 *
 * Request-scoped S3 credentials live in the encrypted secrets store, so the
 * synchronous registry lookup used by older upload code cannot see them. The
 * provider id is persisted with the session to prevent a newly configured or
 * reordered provider from receiving another provider's opaque session handle.
 */
export async function resolveResumableUploadProvider(
  providerId: string,
): Promise<FileUploadProvider | null> {
  const active = await getActiveFileUploadProviderForRequest();
  if (active?.id === providerId && active.resumable) return active;

  if (providerId === builderFileUploadProvider.id) {
    try {
      if (await resolveHasBuilderPrivateKey()) {
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
