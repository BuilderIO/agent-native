import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { credentialKeys } from "../server/lib/credential-keys";
import { deleteCredential } from "../server/lib/credentials";
import { tryRequestCredentialContext } from "../server/lib/credentials-context";

const ALLOWED_KEYS = new Set(credentialKeys.map((k) => k.key));

export default defineAction({
  description:
    "UI-only: delete Analytics data-source credentials. Secret values are not returned.",
  schema: z.object({
    keys: z.array(z.string()).min(1),
  }),
  agentTool: false,
  run: async ({ keys }) => {
    const filtered = keys.filter((key) => ALLOWED_KEYS.has(key));
    if (filtered.length === 0) {
      throw new Error("No recognized credential keys in request");
    }

    const ctx = tryRequestCredentialContext();
    if (!ctx) throw new Error("Sign in to delete credentials");

    for (const key of filtered) {
      await deleteCredential(key, ctx);
    }

    return { deleted: filtered };
  },
});
