import type {
  FileUploadInput,
  FileUploadProvider,
  FileUploadResult,
} from "./types.js";
import { builderFileUploadProvider } from "./builder.js";

const providers = new Map<string, FileUploadProvider>();
let warnedFallback = false;

/**
 * Register a file upload provider. Call from a server plugin or app
 * bootstrap. Idempotent per id — later calls with the same id replace.
 */
export function registerFileUploadProvider(provider: FileUploadProvider): void {
  providers.set(provider.id, provider);
}

export function unregisterFileUploadProvider(id: string): void {
  providers.delete(id);
}

export function listFileUploadProviders(): FileUploadProvider[] {
  return [...providers.values()];
}

/**
 * Returns the first configured provider, checking user-registered ones first
 * and falling back to the built-in Builder.io provider when its env is set.
 * Returns `null` when nothing is configured — callers should then use the
 * SQL fallback.
 */
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
 * Upload a file via the active provider, or `null` if no provider is
 * configured. Callers use `null` as the signal to fall back to SQL
 * storage. On the first fallback we log a one-time warning because
 * storing files in SQL is not optimal for production.
 */
export async function uploadFile(
  input: FileUploadInput,
): Promise<FileUploadResult | null> {
  const provider = getActiveFileUploadProvider();
  if (provider) {
    return provider.upload(input);
  }

  // getActiveFileUploadProvider() uses the synchronous isConfigured() which only
  // checks process.env.BUILDER_PRIVATE_KEY. When the user connected Builder via
  // OAuth, credentials live in app_secrets (DB) and resolveBuilderPrivateKey()
  // finds them — but isConfigured() misses them.
  //
  // Resolve credentials asynchronously first (works when request context is set
  // via runWithRequestContext — actions always have one via action-routes.ts).
  // Two separate try-catch blocks ensure a real upload failure is never
  // silently swallowed as a "no credentials" case.
  let builderKey: string | null = null;
  try {
    const { resolveBuilderPrivateKey } =
      await import("../server/credential-provider.js");
    builderKey = await resolveBuilderPrivateKey();
  } catch (err) {
    // DB unavailable or credential store not ready — can't resolve key.
    // Log and fall through to the SQL fallback below.
    console.warn(
      "[agent-native] Builder credential check failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (builderKey) {
    // Credentials confirmed — attempt the upload. Real errors (network,
    // API, rate-limit) propagate to the caller; do NOT catch them here.
    return await builderFileUploadProvider.upload(input);
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      "[agent-native] No file upload provider configured — storing files in SQL. " +
        "Connect Builder.io in Settings → File uploads, or register a provider, " +
        "for production-grade file storage.",
    );
  }
  return null;
}
