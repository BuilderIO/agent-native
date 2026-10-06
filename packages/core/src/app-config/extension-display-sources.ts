/**
 * What the extension iframe loads for img-src / media-src when a deployment
 * has not narrowed or widened them.
 *
 * This module has no imports on purpose: the client-rendered extension shell
 * (`extensions/html-shell.ts`, used by `ExtensionViewer` and
 * `InlineExtensionFrame` in the browser) builds its default CSP from this list,
 * and must not pull the server app-config store into browser bundles.
 *
 * Frozen so an importing module cannot mutate the shared default. The schema
 * hands out a fresh copy per parse, so a caller mutating its resolved config
 * cannot reach this list either.
 */
export const DEFAULT_EXTENSION_DISPLAY_SOURCES: readonly string[] =
  Object.freeze(["'self'", "data:", "blob:"]);
