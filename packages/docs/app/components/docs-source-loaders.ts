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
