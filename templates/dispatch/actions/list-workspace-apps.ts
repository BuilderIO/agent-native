import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listWorkspaceApps } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "List apps installed in this workspace, including their mounted paths.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listWorkspaceApps(),
});
