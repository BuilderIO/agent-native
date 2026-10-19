import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  deleteKeyDate,
  requireKeyDateScope,
} from "../server/lib/key-dates-store.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Delete one key date by id. It disappears from every dashboard that shows its set.",
  schema: z.object({
    id: z.string().min(1).describe("Id of the key date to delete"),
  }),
  run: async ({ id }) => deleteKeyDate(requireKeyDateScope(), id),
});
