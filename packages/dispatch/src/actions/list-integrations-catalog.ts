import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listIntegrationsCatalog } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List all workspace apps and their credential/integration requirements. Shows configured credentials and effective Dispatch vault access.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listIntegrationsCatalog(),
});
