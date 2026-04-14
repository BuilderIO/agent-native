import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listSecrets } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List all secrets stored in the workspace vault. Returns name, credential key, provider, and grant count (values are masked).",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const secrets = await listSecrets();
    return secrets.map((s) => ({
      id: s.id,
      name: s.name,
      credentialKey: s.credentialKey,
      provider: s.provider,
      description: s.description,
      createdBy: s.createdBy,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  },
});
