import { defineNitroPlugin } from "@agent-native/core/server";

import { stopSqlFluffRuntime } from "../formatter/sqlfluff.js";

export default defineNitroPlugin((app) => {
  app.hooks.hook("close", stopSqlFluffRuntime);
});
