import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  deleteKeyDateSet,
  requireKeyDateScope,
} from "../server/lib/key-dates-store.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Delete a key-date set and every date in it, for the whole organization. To take a set off one dashboard instead, add its id to that dashboard's config.annotations.hiddenKeyDateSets.",
  schema: z.object({
    id: z.string().min(1).describe("Id of the set to delete"),
  }),
  run: async ({ id }) => deleteKeyDateSet(requireKeyDateScope(), id),
});
