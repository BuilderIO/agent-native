export const coreResourceScripts: Record<
  string,
  (args: string[]) => Promise<void>
> = {
  "resource-list": (args) => import("./list.js").then((m) => m.default(args)),
  "resource-read": (args) => import("./read.js").then((m) => m.default(args)),
  "resource-write": (args) => import("./write.js").then((m) => m.default(args)),
  "resource-delete": (args) =>
    import("./delete.js").then((m) => m.default(args)),
  "migrate-learnings": (args) =>
    import("./migrate-learnings.js").then((m) => m.default(args)),
};
