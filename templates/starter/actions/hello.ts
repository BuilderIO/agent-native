import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Return a friendly greeting.",
  schema: z.object({
    name: z.string().default("world").describe("Name to greet"),
  }),
  http: { method: "GET" },
  run: async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
});
