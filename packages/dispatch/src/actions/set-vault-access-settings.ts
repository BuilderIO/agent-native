import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { setVaultAccessSettings } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Set the Dispatch vault access mode. Use all-apps for the default workspace-wide mode or manual to require explicit per-app grants.",
  schema: z.object({
    mode: z
      .enum(["all-apps", "manual"])
      .describe(
        "all-apps shares every vault key with every app; manual requires grants",
      ),
  }),
  run: async (args) => setVaultAccessSettings(args),
});
