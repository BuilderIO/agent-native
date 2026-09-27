const RELOAD_GUARD_KEY = "slides:export-module-reload-attempted";

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
    return false;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  } catch {
    // sessionStorage unavailable (e.g. private mode) — reload once anyway,
    // worst case we reload more than once instead of not recovering at all.
  }
}

export async function importExportModule<T>(
  loader: () => Promise<T>,
): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isStaleChunkError(error) && !hasAlreadyReloaded()) {
      markReloaded();
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
