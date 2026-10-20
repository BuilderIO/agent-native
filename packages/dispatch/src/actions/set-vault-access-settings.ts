import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { setVaultAccessSettings } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Set the Dispatch vault access mode. Admin only. Use all-apps for the default workspace-wide mode or manual to require explicit per-app grants.",
  schema: z.object({
    mode: z
      .enum(["all-apps", "manual"])
      .describe(
        "all-apps shares every vault key with every app; manual requires grants",
      ),
  }),
  // It creates, changes, or revokes a credential or who may use one: every
  // call needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  run: async (args) => setVaultAccessSettings(args),
});
