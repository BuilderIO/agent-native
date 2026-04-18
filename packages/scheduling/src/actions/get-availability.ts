import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { aggregateBusy } from "../server/availability-engine.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description: "Get aggregated busy intervals for a user over a range",
  schema: z.object({
    userEmail: z.string().optional(),
    from: z.string(),
    to: z.string(),
  }),
  run: async (args) => ({
    busy: await aggregateBusy({
      userEmail: args.userEmail ?? currentUserEmail(),
      rangeStart: new Date(args.from),
      rangeEnd: new Date(args.to),
    }),
  }),
});
