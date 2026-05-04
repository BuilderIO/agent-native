export const coreDbScripts: Record<string, (args: string[]) => Promise<void>> =
  {
    "db-schema": (args) => import("./schema.js").then((m) => m.default(args)),
    "db-query": (args) => import("./query.js").then((m) => m.default(args)),
    "db-exec": (args) => import("./exec.js").then((m) => m.default(args)),
    "db-patch": (args) => import("./patch.js").then((m) => m.default(args)),
    "db-check-scoping": (args) =>
      import("./check-scoping.js").then((m) => m.default(args)),
    "db-wipe-leaked-builder-keys": (args) =>
      import("./wipe-leaked-builder-keys.js").then((m) => m.default(args)),
    "db-migrate-user-api-keys": (args) =>
      import("./migrate-user-api-keys.js").then((m) => m.default(args)),
    "db-reset-dev-owner": (args) =>
      import("./reset-dev-owner.js").then((m) => m.default(args)),
  };
