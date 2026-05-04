import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listIntegrationsCatalog } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List all workspace apps and their credential/integration requirements. Shows which credentials are configured, which are granted from the vault, and which are missing.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listIntegrationsCatalog(),
});
