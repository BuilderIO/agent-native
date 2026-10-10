import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  ChapterSchema,
  CutRangeSchema,
  StoredChapterSchema,
  parseList,
  saveChapters,
} from "./lib/save-chapters.js";

export default defineAction({
  description:
    "Overwrite the chapters on a recording. Chapters are {startMs,title} entries that appear as markers on the timeline and in the player.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    chapters: z
      .union([z.string(), z.array(ChapterSchema)])
      .describe(
        "Array of {startMs,title} — either a JSON-encoded string (CLI) or an array (agent).",
      ),
    expectedChapters: z
      .union([z.string(), z.array(StoredChapterSchema)])
      .optional()
      .describe(
        "Optional. The chapters this edit started from; if the stored chapters differ, nothing is written and the call fails with errorCode chapters_changed.",
      ),
    expectedVersion: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional. The chapters' version token this edit started from (regenerate-chapters gives one); if the stored chapters' version differs, nothing is written and the call fails with errorCode chapters_changed.",
      ),
    expectedCuts: z
      .union([z.string(), z.array(CutRangeSchema)])
      .optional()
      .describe(
        "Optional. The cut ranges ({startMs,endMs}, original-media ms) the chapter times were mapped through; if the recording's cuts differ, nothing is written and the call fails with errorCode chapters_changed.",
      ),
  }),
  run: async (args) => {
    return saveChapters({
      recordingId: args.recordingId,
      chapters: parseList(
        args.chapters,
        "chapters",
        ChapterSchema,
        "invalid_chapters",
      ),
      expectedChapters:
        args.expectedChapters === undefined
          ? null
          : parseList(
              args.expectedChapters,
              "expectedChapters",
              StoredChapterSchema,
              "invalid_chapters",
            ),
      expectedVersion: args.expectedVersion ?? null,
      expectedCuts:
        args.expectedCuts === undefined
          ? null
          : parseList(
              args.expectedCuts,
              "expectedCuts",
              CutRangeSchema,
              "invalid_cuts",
            ),
    });
  },
});
