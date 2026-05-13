import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listGrants } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List explicit vault grants used by manual vault access mode. Optionally filter by app or secret.",
  schema: z.object({
    appId: z.string().optional().describe("Filter by app ID"),
    secretId: z.string().optional().describe("Filter by secret ID"),
  }),
  http: { method: "GET" },
  run: async (args) => listGrants(args),
});
