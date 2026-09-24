export const coreDocsScripts: Record<
  string,
  (args: string[]) => Promise<void>
> = {
  "framework-search": (args) =>
    import("./framework-search.js").then((m) => m.default(args)),
  "docs-search": (args) => import("./search.js").then((m) => m.default(args)),
  "source-search": (args) =>
    import("./source-search.js").then((m) => m.default(args)),
};
