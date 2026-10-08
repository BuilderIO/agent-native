import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { applyTrims } from "./lib/apply-trims.js";

export default defineAction({
  description:
    "Append a trim range to a recording. The range is excluded from playback but the source video is never modified. Adjacent/overlapping ranges are merged.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    startMs: z.coerce
      .number()
      .int()
      .min(0)
      .describe("Start of the trim range in milliseconds (original time)"),
    endMs: z.coerce
      .number()
      .int()
      .min(0)
      .describe("End of the trim range in milliseconds (original time)"),
  }),
  run: async (args) => {
    if (args.endMs <= args.startMs) {
      throw new Error("endMs must be greater than startMs");
    }

    const { editsJson, trimCount } = await applyTrims(args.recordingId, [
      { startMs: args.startMs, endMs: args.endMs },
    ]);
    console.log(
      `Trimmed ${args.recordingId}: ${args.startMs}–${args.endMs} ms (now ${trimCount} excluded ranges)`,
    );
    return { id: args.recordingId, editsJson, trimCount };
  },
});
