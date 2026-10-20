import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deleteSecret } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Delete a secret from the workspace vault. Also revokes all active grants for this secret. Admin only.",
  schema: z.object({
    id: z.string().describe("Secret ID to delete"),
  }),
  // It creates, changes, or revokes a credential or who may use one: every
  // call needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  run: async ({ id }) => {
    await deleteSecret(id);
    return { deleted: true, id };
  },
});
