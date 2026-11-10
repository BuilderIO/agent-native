import { z } from "zod";

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("label"),
    labelName: z.string().describe("Name of the label to apply"),
  }),
  z.object({ type: z.literal("notify") }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("mark_read") }),
  z.object({ type: z.literal("star") }),
  z.object({ type: z.literal("trash") }),
]);
