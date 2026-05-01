import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listSecrets } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List vault secrets as safe picker options for creating a new app. Does not include secret values.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const secrets = await listSecrets();
    return secrets.map((secret) => ({
      id: secret.id,
      name: secret.name,
      credentialKey: secret.credentialKey,
      provider: secret.provider,
      description: secret.description,
    }));
  },
});
