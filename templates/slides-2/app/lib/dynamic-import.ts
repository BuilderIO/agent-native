import { appStorageKey } from "@shared/app-storage";

const RELOAD_GUARD_KEY = appStorageKey("export-module-reload-attempted");

const STALE_CHUNK_PATTERN =
  /fetch dynamically imported module|error loading dynamically imported module/i;

function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return STALE_CHUNK_PATTERN.test(message);
}

function hasAlreadyReloaded(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY) === "1";
  } catch {
    // Avoid a reload loop when sessionStorage cannot persist the retry marker.
    return true;
  }
}

function markReloaded(): boolean {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
    return true;
  } catch {
    // coercion-ok: without a durable marker, the importer reports its normal retry error instead of reloading.
    return false;
  }
}

export async function importExportModule<T>(
  loader: () => Promise<T>,
): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isStaleChunkError(error) && !hasAlreadyReloaded() && markReloaded()) {
      window.location.reload();
      return new Promise<T>(() => {});
    }
    try {
      return await loader();
    } catch {
      throw new Error(
        "Couldn't load the export module. Refresh the page and try again.",
      );
    }
  }
}
