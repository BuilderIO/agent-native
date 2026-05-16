import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listDreams } from "../server/lib/dreams-store.js";

export default defineAction({
  description: "List Dispatch dream reports with proposal status counts.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: z
      .enum(["running", "completed", "failed", "all"])
      .default("all")
      .describe("Optional dream status filter."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input) => listDreams(input),
});
