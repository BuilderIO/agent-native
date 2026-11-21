import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listSecrets } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List all secrets stored in the workspace vault, including organization keys an app registered for itself. Admin only. Returns metadata, a masked last-four preview, and `valueStatus` (stored or unreadable) for each key; never returns secret values.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listSecrets(),
});
