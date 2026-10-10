import { builderFileUploadProvider } from "./builder.js";
import { FileUploadReadError } from "./read.js";
import type {
  FileUploadDeleteInput,
  FileUploadInput,
  FileUploadProvider,
  FileUploadResult,
  FileUploadReadInput,
  FileUploadReadResult,
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

/**
 * Every registered provider's configured state for this request, in the same
 * precedence order `getActiveFileUploadProviderForRequest` walks. A status read
 * that needs both the list and the active provider derives the active one from
 * this instead of detecting each provider a second time.
 */
export async function listFileUploadProviderStatusesForRequest(): Promise<
  Array<{ provider: FileUploadProvider; configured: boolean }>
> {
  return Promise.all(
    [...providers.values()].map(async (provider) => ({
      provider,
      configured:
        provider.isConfigured() ||
        (provider.isConfiguredForRequest
          ? await provider.isConfiguredForRequest()
          : false),
    })),
  );
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

export async function readUploadedFile(
  input: FileUploadReadInput,
): Promise<FileUploadReadResult> {
  if (
    !input.ownerEmail.trim() ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 1 ||
    input.maxBytes > 10_000_000
  )
    throw new FileUploadReadError(
      "invalid-reference",
      "Uploaded file read needs a scoped owner and bounded size.",
    );
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new FileUploadReadError(
      "invalid-reference",
      "Uploaded file URL is invalid.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    input.url.length > 2048
  )
    throw new FileUploadReadError(
      "invalid-reference",
      "Uploaded file URL is not a canonical HTTPS URL.",
    );
  const timeout = AbortSignal.timeout(15_000);
  const signal = AbortSignal.any([
    input.signal ?? new AbortController().signal,
    timeout,
  ]);
  const abortError = () =>
    input.signal?.aborted
      ? (input.signal.reason ??
        new FileUploadReadError("unreadable", "Uploaded file read canceled."))
      : new FileUploadReadError("unreadable", "Uploaded file read timed out.");
  if (signal.aborted) throw abortError();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const read = async (): Promise<FileUploadReadResult> => {
    for (const provider of [...providers.values(), builderFileUploadProvider]) {
      if (!provider.isOwnedUrl || !(await provider.isOwnedUrl(input.url)))
        continue;
      if (!provider.read)
        throw new FileUploadReadError(
          "unsupported",
          "The uploaded file provider cannot read assets for export.",
        );
      const result = await provider.read({ ...input, signal });
      if (!(result.data instanceof Uint8Array) || !result.mimeType.trim())
        throw new FileUploadReadError(
          "unreadable",
          "Uploaded file provider returned an invalid result.",
        );
      if (result.data.byteLength > input.maxBytes)
        throw new FileUploadReadError(
          "limit",
          "Uploaded file exceeds the read limit.",
        );
      return result;
    }
    throw new FileUploadReadError(
      "unsupported",
      "No configured provider owns the uploaded file URL.",
    );
  };
  try {
    return await Promise.race([read(), aborted]);
  } catch (error) {
    if (timeout.aborted && !input.signal?.aborted) throw abortError();
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
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
        "Use Builder.io (free tier available) in Settings → File uploads, " +
        "or register a custom provider (S3, R2, GCS, …) via registerFileUploadProvider().",
    );
  }
  return null;
}
