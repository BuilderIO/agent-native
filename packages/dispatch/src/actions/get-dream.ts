import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDream } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "Get one Dispatch dream report and its evidence-backed proposals.",
  schema: z.object({
    id: z.string().min(1).describe("Dream id."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => getDream(id),
});
