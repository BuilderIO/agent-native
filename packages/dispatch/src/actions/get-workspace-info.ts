import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getWorkspaceInfo } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Get the current workspace's identity (name and app count) from the workspace root package.json. Surfaced in the Dispatch UI so users can see which workspace their apps belong to.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => getWorkspaceInfo(),
});
