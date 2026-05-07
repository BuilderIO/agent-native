import { defineAction } from "@agent-native/core";
import { z } from "zod";
import exportPptxAction from "./export-pptx.js";
import { getExportUrl } from "./_app-url.js";

/**
 * Google Slides has no first-party "import this URL" REST API — there is no
 * stable equivalent of `docs.google.com/presentation/u/0/?usp=openurl&url=...`
 * for .pptx files. The reliable user-facing path is:
 *   1. Generate the PPTX server-side (via the existing export-pptx action).
 *   2. Hand the user the download URL plus a prompt that opens Google Slides
 *      with File → Import primed (`?usp=import`), which triggers the
 *      "Choose a file" dialog they can drop the .pptx into.
 * Direct `openurl` links make Google fetch the app's private export URL and
 * commonly fail with "file wasn't available on site", so this action never
 * returns one.
 */
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
  run: async ({ deckId, includeNotes }) => {
    const result = await exportPptxAction.run({ deckId, includeNotes });
    const { filename, slideCount } = result;

    const downloadUrl = getExportUrl(filename);

    // The dialog version of the importer — always works, just requires the
    // user to pick the file themselves.
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
