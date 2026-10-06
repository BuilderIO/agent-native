import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getExportUrl } from "./_app-url.js";
import exportPptxAction from "./export-pptx.js";

export default defineAction({
  description:
    "Export a deck for Google Slides. Generates a PPTX (the format Google Slides imports) and returns a download URL plus the Google Slides import dialog URL. The user can drag the file into Google Slides or use File → Import.",
  schema: z.object({
    deckId: z.string().describe("Deck ID to export"),
    includeNotes: z
      .preprocess(
        (v) => (v === "true" ? true : v === "false" ? false : v),
        z.boolean().optional().default(true),
      )
      .describe("Include speaker notes"),
  }),
  run: async ({ deckId, includeNotes }, ctx) => {
    const result = ctx
      ? await exportPptxAction.run({ deckId, includeNotes }, ctx)
      : await exportPptxAction.run({ deckId, includeNotes });
    const { filename, slideCount } = result;

    const downloadUrl = getExportUrl(filename);

    const googleSlidesImportDialogUrl =
      "https://docs.google.com/presentation/u/0/?usp=import";

    return {
      ...result,
      downloadUrl,
      googleSlidesImportUrl: googleSlidesImportDialogUrl,
      googleSlidesImportDialogUrl,
      slideCount,
      note: "Download the .pptx and import it via Google Slides → File → Import slides. Google Slides cannot fetch this app's private export URL directly.",
    };
  },
});
