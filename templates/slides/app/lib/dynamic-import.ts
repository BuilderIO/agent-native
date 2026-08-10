const RELOAD_GUARD_KEY = "slides:export-module-reload-attempted";

// Chrome/Firefox/Safari all use this wording (or close to it) for a dynamic
// `import()` whose chunk 404s — typically because the app was redeployed
// after the page loaded and the browser still references an old, now-missing
// chunk hash. Calling `import()` again with the *same* specifier re-requests
// the same now-missing URL and fails immediately, so a plain retry never
// recovers this case — only a full reload picks up the current chunk map.
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

/**
 * Lazy `import()` calls for export libraries (jsPDF, modern-screenshot,
 * dom-to-pptx) fail with "Failed to fetch dynamically imported module" when
 * the chunk is momentarily unreachable (flaky network) or stale after a
 * redeploy. For the stale-chunk case, retrying the same specifier is a no-op,
 * so we reload the page once to pick up the current chunk map; for anything
 * else, a same-specifier retry can still clear a transient blip.
 */
export async function importExportModule<T>(
  loader: () => Promise<T>,
): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isStaleChunkError(error) && !hasAlreadyReloaded()) {
      markReloaded();
      window.location.reload();
      // The reload navigates away; never resolve so callers don't proceed
      // against a page that's about to unload.
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
