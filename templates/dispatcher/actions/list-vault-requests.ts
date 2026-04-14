import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listRequests } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "List vault secret requests — pending, approved, and denied. Admins see all; members see their own.",
  schema: z.object({
    status: z
      .enum(["pending", "approved", "denied"])
      .optional()
      .describe("Filter by status"),
  }),
  http: { method: "GET" },
  run: async (args) => listRequests(args),
});
