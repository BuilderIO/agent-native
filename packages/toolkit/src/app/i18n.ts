import { createDefaultToolkitI18nCatalog } from "./i18n/default.js";
import type {
  ToolkitCreateI18nCatalogArgs,
  ToolkitI18nCatalog,
} from "./i18n/factory-types.js";
import { createLazyToolkitI18nCatalog } from "./i18n/lazy.js";

declare const __AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__: boolean | undefined;

/** Synchronous access loads every catalog; use the factory for lazy app bundles. */
export { toolkitMessagesForLocale } from "./i18n/catalog.js";

/**
 * Build the Toolkit i18n catalog for an app.
 *
 * Default (no compile-time opt-in): the synchronous aggregate supplies every
 * locale, and a non-English `sourceLocale` keeps working unchanged.
 *
 * When `__AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__` is defined as `true`, the en-US
 * source is static and every other Toolkit catalog is a dynamic chunk. That
 * optimized factory requires `sourceLocale: "en-US"`. Core/Vite builds opt in
 * with `AGENT_NATIVE_LAZY_TOOLKIT_LOCALES=1`; leave it unset for other sources.
 */
export function createToolkitI18nCatalog(
  args: ToolkitCreateI18nCatalogArgs,
): ToolkitI18nCatalog {
  if (
    typeof __AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__ !== "undefined" &&
    __AGENT_NATIVE_LAZY_TOOLKIT_LOCALES__ === true
  ) {
    return createLazyToolkitI18nCatalog(args);
  }
  return createDefaultToolkitI18nCatalog(args);
}
