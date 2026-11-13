import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listSecretOptions } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List vault secrets as safe picker options for creating a new app. Does not include secret values. Admins see every key in the vault; members see only keys the Vault manages.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    return listSecretOptions();
  },
});
