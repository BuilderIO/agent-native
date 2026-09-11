import { z } from "zod";

/** Zod mirror of the `AutomationAction` union in `shared/types.ts`. */
export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("label"), labelName: z.string() }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("mark_read") }),
  z.object({ type: z.literal("star") }),
  z.object({ type: z.literal("trash") }),
]);
