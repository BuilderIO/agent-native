import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { syncGrantsToApp } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Push all granted secrets to an app by calling its env-vars endpoint. Returns the list of synced credential keys.",
  schema: z.object({
    appId: z
      .string()
      .describe("App ID to sync secrets to, e.g. mail, calendar, analytics"),
  }),
  run: async (args) => syncGrantsToApp(args.appId),
});
