import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listVaultAudit } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "View the vault audit log — secret access, grants, syncs, and requests.",
  schema: z.object({
    limit: z.coerce
      .number()
      .optional()
      .describe("Max entries to return (default 50)"),
  }),
  http: { method: "GET" },
  run: async (args) => listVaultAudit(args.limit),
});
