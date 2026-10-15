import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  requireKeyDateScope,
  saveKeyDateSet,
} from "../server/lib/key-dates-store.js";

export default defineAction({
  description:
    "Create a key-date set, or rename one by id. Set names are unique in the organization, case-insensitively. A new set shows on every dashboard's time charts until a dashboard hides it.",
  schema: z.object({
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Id of the set to rename; omit to create a set"),
    name: z
      .string()
      .min(1)
      .max(80)
      .describe('Set name, for example "Launches" or "Product changes"'),
  }),
  run: async (input) => saveKeyDateSet(requireKeyDateScope(), input),
});
