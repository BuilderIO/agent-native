import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { authorizeDispatchAdmin } from "../server/lib/app-roles.js";
import { deleteDestination } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "Delete a saved dispatch destination.",
  authorize: authorizeDispatchAdmin,
  schema: z.object({
    id: z.string().describe("Destination id"),
  }),
  run: async ({ id }) => deleteDestination(id),
});
