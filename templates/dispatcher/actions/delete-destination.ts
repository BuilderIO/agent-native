import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { deleteDestination } from "../server/lib/dispatcher-store.js";

export default defineAction({
  description: "Delete a saved dispatcher destination.",
  schema: z.object({
    id: z.string().describe("Destination id"),
  }),
  http: { method: "DELETE" },
  run: async ({ id }) => deleteDestination(id),
});
