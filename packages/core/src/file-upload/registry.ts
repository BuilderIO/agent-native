import { builderFileUploadProvider } from "./builder.js";
import type {
  FileUploadDeleteInput,
  FileUploadInput,
  FileUploadProvider,
  FileUploadResult,
} from "./types.js";

interface FileUploadGlobals {
  __agentNativeFileUploadProviders?: Map<string, FileUploadProvider>;
  __agentNativeFileUploadWarnedFallback?: { value: boolean };
}
const globals = globalThis as typeof globalThis & FileUploadGlobals;
const providers: Map<string, FileUploadProvider> =
  (globals.__agentNativeFileUploadProviders ??= new Map());
const warnedFallbackRef: { value: boolean } =
  (globals.__agentNativeFileUploadWarnedFallback ??= { value: false });

export function registerFileUploadProvider(provider: FileUploadProvider): void {
  providers.set(provider.id, provider);
}

export function unregisterFileUploadProvider(id: string): void {
  providers.delete(id);
}

export function listFileUploadProviders(): FileUploadProvider[] {
  return [...providers.values()];
}

export function getActiveFileUploadProvider(): FileUploadProvider | null {
  for (const provider of providers.values()) {
    if (provider.isConfigured()) return provider;
  }
  if (builderFileUploadProvider.isConfigured()) {
    return builderFileUploadProvider;
  }
  return null;
}

export async function getActiveFileUploadProviderForRequest(): Promise<FileUploadProvider | null> {
  for (const provider of providers.values()) {
    if (provider.isConfigured()) return provider;
    if (provider.isConfiguredForRequest) {
      if (await provider.isConfiguredForRequest()) return provider;
    }
  }
  const [{ canAuthorizeBuilderApiRequest }, { BUILDER_ASSETS_WRITE_SCOPE }] =
    await Promise.all([
      import("../server/builder-api-auth.js"),
      import("../server/builder-oauth.js"),
    ]);
  if (await canAuthorizeBuilderApiRequest(BUILDER_ASSETS_WRITE_SCOPE)) {
    return builderFileUploadProvider;
  }
  return null;
}

export async function deleteUploadedFile(
  providerId: string,
  input: FileUploadDeleteInput,
): Promise<boolean> {
  const provider =
    providerId === builderFileUploadProvider.id
      ? builderFileUploadProvider
      : providers.get(providerId);
  if (!provider?.delete) return false;
  return provider.delete(input);
}

export async function uploadFile(
  input: FileUploadInput,
): Promise<FileUploadResult | null> {
  const provider = await getActiveFileUploadProviderForRequest();
  // User-registered providers (S3, etc.) may be configured by sync runtime
  // state or request-scoped DB secrets. Builder still gets an explicit async
  // credential check below because its sync isConfigured() only checks env.
  if (provider && provider !== builderFileUploadProvider) {
    return provider.upload(input);
  }

  let hasBuilderCredential = false;
  try {
    const [{ canAuthorizeBuilderApiRequest }, { BUILDER_ASSETS_WRITE_SCOPE }] =
      await Promise.all([
        import("../server/builder-api-auth.js"),
        import("../server/builder-oauth.js"),
      ]);
    hasBuilderCredential = await canAuthorizeBuilderApiRequest(
      BUILDER_ASSETS_WRITE_SCOPE,
    );
  } catch (err) {
    // DB unavailable or credential store not ready — can't resolve a
    // credential. Return an unavailable-provider state below; never fall back
    // to SQL.
    console.warn(
      "[agent-native] Builder credential check failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (hasBuilderCredential) {
    return await builderFileUploadProvider.upload(input);
  }

  if (!warnedFallbackRef.value) {
    warnedFallbackRef.value = true;
    console.warn(
      "[agent-native] No file upload provider configured. " +
        "Connect or reconnect Builder.io (free tier available) in Settings → File uploads, " +
        "or register a custom provider (S3, R2, GCS, …) via registerFileUploadProvider().",
    );
  }
  return null;
}
