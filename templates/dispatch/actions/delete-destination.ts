import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { deleteDestination } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "Delete a saved dispatch destination.",
  schema: z.object({
    id: z.string().describe("Destination id"),
  }),
  run: async ({ id }) => deleteDestination(id),
});
