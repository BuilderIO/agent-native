/**
 * Lazy `import()` calls for export libraries (jsPDF, modern-screenshot,
 * dom-to-pptx) fail with "Failed to fetch dynamically imported module" when
 * the chunk is momentarily unreachable (flaky network) or when the app was
 * redeployed after the page loaded and the browser still references an old,
 * now-missing chunk hash. A single retry clears the transient case; when it
 * still fails we throw a message that tells the user what to actually do
 * instead of surfacing the raw browser error.
 */
export async function importExportModule<T>(
  loader: () => Promise<T>,
): Promise<T> {
  try {
    return await loader();
  } catch {
    try {
      return await loader();
    } catch {
      throw new Error(
        "Couldn't load the export module. Refresh the page and try again.",
      );
    }
  }
}
