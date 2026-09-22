import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listSecrets,
  toVaultSecretMetadata,
} from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List all secrets stored in the workspace vault. Admin only. Returns metadata and a masked last-four preview; never returns secret values.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const secrets = await listSecrets();
    return secrets.map(toVaultSecretMetadata);
  },
});
