import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { syncGrantsToApp } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Push vault secrets to an app by calling its env-vars endpoint. In all-apps mode this syncs every vault key; in manual mode it syncs active grants.",
  schema: z.object({
    appId: z
      .string()
      .describe("App ID to sync secrets to, e.g. mail, calendar, analytics"),
  }),
  run: async (args) => syncGrantsToApp(args.appId),
});
