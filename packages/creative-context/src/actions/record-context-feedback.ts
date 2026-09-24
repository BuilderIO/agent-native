import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { recordContextFeedback } from "../store/index.js";

export default defineAction({
  description:
    "Record a usefulness, correctness, or freshness signal against an exact context item version.",
  schema: z.object({
    itemId: z.string().min(1),
    itemVersionId: z.string().min(1).optional(),
    signal: z.enum(["helpful", "not-helpful", "incorrect", "outdated"]),
    note: z.string().max(5000).optional(),
  }),
  run: recordContextFeedback,
});
