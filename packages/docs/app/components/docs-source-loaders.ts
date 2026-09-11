/**
 * The single glob map over the docs corpus.
 *
 * `docs-content` and `docs-availability` both need it, and declaring it twice
 * made Rollup emit two byte-identical copies of the 1447-entry lazy-import map
 * into the server bundle. One module, one map.
 *
 * Keep these loaders LAZY. Eagerly importing and parsing the whole corpus makes
 * every SSR cold start pay for documents unrelated to the requested page, and
 * pulls the full markdown corpus into the root layout's module graph.
 */
export const docSourceLoaders = {
  ...import.meta.glob("../../../core/docs/content/*.md", {
    query: "?raw",
    import: "default",
  }),
  ...import.meta.glob("../../../core/docs/content/*.mdx", {
    query: "?raw",
    import: "default",
  }),
} as Record<string, () => Promise<string>>;

/**
 * Optional locale-specific docs under `packages/core/docs/content/locales/`.
 * Lazy for the same reason: translated Markdown should load per locale + route,
 * never all at startup.
 */
export const localizedDocLoaders = {
  ...import.meta.glob("../../../core/docs/content/locales/*/*.md", {
    query: "?raw",
    import: "default",
  }),
  ...import.meta.glob("../../../core/docs/content/locales/*/*.mdx", {
    query: "?raw",
    import: "default",
  }),
} as Record<string, () => Promise<string>>;
