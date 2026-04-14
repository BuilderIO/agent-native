import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listGrants } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List vault grants — which apps have access to which secrets. Optionally filter by app or secret.",
  schema: z.object({
    appId: z.string().optional().describe("Filter by app ID"),
    secretId: z.string().optional().describe("Filter by secret ID"),
  }),
  http: { method: "GET" },
  run: async (args) => listGrants(args),
});
