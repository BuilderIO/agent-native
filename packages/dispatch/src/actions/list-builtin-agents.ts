import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listBuiltinApps } from "../server/lib/builtin-apps-store.js";

export default defineAction({
  description:
    "List the built-in first-party apps (Mail, Calendar, Content, ...) this workspace offers and whether each is enabled for the current organization. Built-ins the workspace's agent-native.builtinAgents config does not include are never listed. mode is the builder config mode; canManage says whether the caller may change the setting.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async () => listBuiltinApps(),
});
