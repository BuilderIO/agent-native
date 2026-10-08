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

/**
 * One CSP source expression with no whitespace or `;`, so a configured value
 * can extend `img-src` / `media-src` but can never terminate the directive and
 * append a new one. Shared by the app-config schema and the CSP builder, so the
 * value that is validated at config time is validated again where it is
 * interpolated.
 */
export const EXTENSION_DISPLAY_SOURCE_PATTERN =
  /^(?:'self'|'none'|(?:https?|data|blob|mediastream):|https?:\/\/(?:\*\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?::\d{1,5})?)$/;

export const EXTENSION_DISPLAY_SOURCE_MESSAGE =
  "must be one CSP source expression: 'self', 'none', a scheme such as https: or blob:, or an http(s) origin such as https://cdn.example.com";

export const EXTENSION_DISPLAY_SOURCE_NONE_MESSAGE =
  "'none' must be the only source in the list";

/**
 * Returns why `sources` cannot be interpolated into an img-src / media-src
 * directive, or `null` when it can. Mirrors the app-config schema: a non-empty
 * list of single source expressions, with `'none'` only on its own (CSP drops
 * `'none'` when it is mixed with other sources).
 */
export function extensionDisplaySourcesError(sources: unknown): string | null {
  if (!Array.isArray(sources) || sources.length === 0) {
    return "must be a non-empty list of CSP source expressions";
  }
  for (const source of sources) {
    if (
      typeof source !== "string" ||
      !EXTENSION_DISPLAY_SOURCE_PATTERN.test(source)
    ) {
      return `${JSON.stringify(source)} ${EXTENSION_DISPLAY_SOURCE_MESSAGE}`;
    }
  }
  if (sources.includes("'none'") && sources.length !== 1) {
    return EXTENSION_DISPLAY_SOURCE_NONE_MESSAGE;
  }
  return null;
}
