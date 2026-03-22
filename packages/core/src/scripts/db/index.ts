export const coreDbScripts: Record<string, (args: string[]) => Promise<void>> =
  {
    "db-schema": (args) => import("./schema.js").then((m) => m.default(args)),
    "db-query": (args) => import("./query.js").then((m) => m.default(args)),
    "db-exec": (args) => import("./exec.js").then((m) => m.default(args)),
  };
