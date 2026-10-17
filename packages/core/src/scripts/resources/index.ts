import type { SaveMemoryScriptOptions } from "./save-memory.js";

type CoreResourceScript = (args: string[]) => Promise<void>;

export const coreResourceScripts: Record<string, CoreResourceScript> & {
  "save-memory": (
    args: string[],
    options?: SaveMemoryScriptOptions,
  ) => Promise<void>;
} = {
  "resource-list": (args) => import("./list.js").then((m) => m.default(args)),
  "resource-read": (args) => import("./read.js").then((m) => m.default(args)),
  "resource-effective": (args) =>
    import("./effective.js").then((m) => m.default(args)),
  "resource-write": (args) => import("./write.js").then((m) => m.default(args)),
  "resource-delete": (args) =>
    import("./delete.js").then((m) => m.default(args)),
  "migrate-learnings": (args) =>
    import("./migrate-learnings.js").then((m) => m.default(args)),
  "save-memory": (args, options?: SaveMemoryScriptOptions) =>
    import("./save-memory.js").then((m) => m.default(args, options)),
  "delete-memory": (args) =>
    import("./delete-memory.js").then((m) => m.default(args)),
};
