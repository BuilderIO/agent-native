import { isCloudflareRuntime } from "../shared/runtime.js";
import { builderFileUploadProvider } from "./builder.js";
import {
  CLOUDFLARE_R2_SETUP_GUIDANCE,
  cloudflareR2FileUploadProvider,
} from "./cloudflare-r2.js";
import { FileUploadStorageNotConfiguredError } from "./errors.js";
import type {
  FileUploadInput,
  FileUploadProvider,
  FileUploadResult,
} from "./types.js";

// Why globalThis: in dev (Vite HMR) and in some Nitro/Rollup bundle splits,
// this module can be evaluated more than once — the plugin file that
// registers a provider lands in one module instance and the request handler
// that reads providers lands in another, so the call site sees an empty map
// even though `registerFileUploadProvider` succeeded. Pinning the singletons
// on `globalThis` guarantees one set of providers per Node process,
// independent of how the bundler split the chunks.
interface FileUploadGlobals {
  __agentNativeFileUploadProviders?: Map<string, FileUploadProvider>;
  __agentNativeFileUploadWarnedFallback?: { value: boolean };
}
const globals = globalThis as typeof globalThis & FileUploadGlobals;
const providers: Map<string, FileUploadProvider> =
  (globals.__agentNativeFileUploadProviders ??= new Map());
const warnedFallbackRef: { value: boolean } =
  (globals.__agentNativeFileUploadWarnedFallback ??= { value: false });

/**
 * Register a file upload provider. Call from a server plugin or app
 * bootstrap. Idempotent per id — later calls with the same id replace.
 */
export function registerFileUploadProvider(provider: FileUploadProvider): void {
  providers.set(provider.id, provider);
}

// Cloudflare object storage is a property of the host, not of the app: on a
// Worker the bound bucket is the only writable blob store there is. Registering
// it here rather than from a plugin means a generated app gets it without
// having to know the platform it was deployed onto. It reports itself
// unconfigured everywhere else, so no other host's provider order changes.
registerFileUploadProvider(cloudflareR2FileUploadProvider);

export function unregisterFileUploadProvider(id: string): void {
  providers.delete(id);
}

export function listFileUploadProviders(): FileUploadProvider[] {
  return [...providers.values()];
}

/**
 * Whether this host still has somewhere other than SQL to put a payload the
 * providers could not take. On Cloudflare it does not — no filesystem, and the
 * architecture contract rules out SQL — so every "no provider" answer there is
 * a failure rather than a fallback. One predicate rather than a host test at
 * each decision, so the two cannot drift apart.
 */
export function isObjectStorageRequired(): boolean {
  return isCloudflareRuntime();
}

/**
 * App-registered providers before the platform built-in. An app that went to
 * the trouble of registering S3 on a Worker asked for S3; registering R2 at
 * module load puts it first in insertion order, which would otherwise silently
 * overrule that.
 */
function providersByPreference(): FileUploadProvider[] {
  const registered = [...providers.values()];
  return [
    ...registered.filter((p) => p !== cloudflareR2FileUploadProvider),
    ...registered.filter((p) => p === cloudflareR2FileUploadProvider),
  ];
}

/**
 * Returns the first configured provider, checking user-registered ones first
 * and falling back to the built-in Builder.io provider when its env is set.
 * Returns `null` when nothing is configured — callers should then use the
 * SQL fallback.
 */
export function getActiveFileUploadProvider(): FileUploadProvider | null {
  for (const provider of providersByPreference()) {
    if (provider.isConfigured()) return provider;
  }
  if (builderFileUploadProvider.isConfigured()) {
    return builderFileUploadProvider;
  }
  return null;
}

export async function getActiveFileUploadProviderForRequest(): Promise<FileUploadProvider | null> {
  for (const provider of providersByPreference()) {
    if (provider.isConfigured()) return provider;
    if (provider.isConfiguredForRequest) {
      try {
        if (await provider.isConfiguredForRequest()) return provider;
      } catch {
        // Treat failed scoped credential lookups as unavailable. The upload
        // call will surface real provider errors after a provider is selected.
      }
    }
  }
  if (builderFileUploadProvider.isConfigured()) {
    return builderFileUploadProvider;
  }
  try {
    const { resolveHasBuilderPrivateKey } =
      await import("../server/credential-provider.js");
    if (await resolveHasBuilderPrivateKey()) {
      return builderFileUploadProvider;
    }
  } catch {
    // Treat failed scoped credential lookups as unavailable.
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
  const provider = await getActiveFileUploadProviderForRequest();
  // User-registered providers (S3, etc.) may be configured by sync runtime
  // state or request-scoped DB secrets. Builder still gets an explicit async
  // credential check below because its sync isConfigured() only checks env.
  if (provider && provider !== builderFileUploadProvider) {
    return provider.upload(input);
  }

  // Resolve credentials asynchronously (works when request context is set
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

  // No provider answered. Where object storage is required that cannot be
  // reported as "use your SQL fallback": SQL is where the raw payload would
  // land, and the caller would report a stored file while the architecture
  // contract was being broken underneath it.
  if (isObjectStorageRequired()) {
    throw new FileUploadStorageNotConfiguredError(CLOUDFLARE_R2_SETUP_GUIDANCE);
  }

  if (!warnedFallbackRef.value) {
    warnedFallbackRef.value = true;
    console.warn(
      "[agent-native] No file upload provider configured. " +
        "Connect or reconnect Builder.io in Settings → File uploads, " +
        "or register a custom provider (S3, R2, GCS, …) via registerFileUploadProvider().",
    );
  }
  return null;
}
