import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getAppCreationSettings } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "Get Dispatch settings for creating new workspace apps, including the default Builder project.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => getAppCreationSettings(),
});
