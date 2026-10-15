import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  requireKeyDateScope,
  saveKeyDate,
} from "../server/lib/key-dates-store.js";

export default defineAction({
  description:
    'Add a key date to a set, or edit one by id. Name the set with setId, or with setName, which finds the set or creates it. A date draws as a marker on every time chart of every dashboard that shows its set. Give time and timeZone when the moment matters, for example a launch at "00:01" "America/Los_Angeles"; dates on the same day share one marker.',
  schema: z.object({
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Id of the key date to edit; omit to add one"),
    setId: z.string().min(1).optional().describe("Id of the set"),
    setName: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe("Set name, used when setId is omitted; created if missing"),
    date: z.string().describe('Day of the key date, "YYYY-MM-DD"'),
    time: z
      .string()
      .optional()
      .describe('Time of day, "HH:MM" (24-hour), in timeZone'),
    timeZone: z
      .string()
      .optional()
      .describe(
        'IANA time zone for time, for example "America/New_York"; UTC when omitted. Only with time.',
      ),
    label: z
      .string()
      .min(1)
      .max(120)
      .describe('Short label shown on charts, for example "Product Hunt live"'),
  }),
  run: async (input) => saveKeyDate(requireKeyDateScope(), input),
});
