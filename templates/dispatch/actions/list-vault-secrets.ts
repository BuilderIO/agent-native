import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listSecrets } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List all secrets stored in the workspace vault. Includes raw values so the UI mask/unmask toggle works — masking is a UI concern, not a data concern. Agent responses should still mask values when echoing them to users.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const secrets = await listSecrets();
    return secrets.map((s) => ({
      id: s.id,
      name: s.name,
      credentialKey: s.credentialKey,
      // Included so the vault UI's eye-icon toggle can reveal the stored
      // value. Without this the "unmask" click shows an empty string.
      value: s.value,
      provider: s.provider,
      description: s.description,
      createdBy: s.createdBy,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  },
});
