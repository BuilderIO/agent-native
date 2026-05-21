import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getVaultAccessSettings } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Get the Dispatch vault access mode. Defaults to all-apps, where every workspace app can use every vault key.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => getVaultAccessSettings(),
});
