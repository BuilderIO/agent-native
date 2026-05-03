import { defineAction } from "@agent-native/core";
import { z } from "zod";
import exportPptxAction from "./export-pptx.js";
import { getExportUrl, getSlidesAppUrl } from "./_app-url.js";

/**
 * Google Slides has no first-party "import this URL" REST API — there is no
 * stable equivalent of `docs.google.com/presentation/u/0/?usp=openurl&url=...`
 * for .pptx files. The reliable user-facing path is:
 *   1. Generate the PPTX server-side (via the existing export-pptx action).
 *   2. Hand the user the download URL plus a prompt that opens Google Slides
 *      with File → Import primed (`?usp=import`), which triggers the
 *      "Choose a file" dialog they can drop the .pptx into.
 *
 * If APP_URL is publicly reachable we also surface a `googleSlidesImportUrl`
 * pointing at `docs.google.com/presentation/u/0/?usp=openurl&url=<encoded>`.
 * Google occasionally honors this for hosted .pptx URLs, but it's unreliable
 * — we still return the download URL + note so the user always has a path.
 */
export default defineAction({
  description:
    "Export a deck for Google Slides. Generates a PPTX (the format Google Slides imports) and returns a download URL plus a Google Slides import URL. The user can either drag the file into Google Slides or use File → Import.",
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

    const appUrl = getSlidesAppUrl();
    const downloadUrl = getExportUrl(filename);

    // The /api/exports/:filename route requires a logged-in session, so
    // Google's importer cannot fetch it directly even when APP_URL is
    // public. We still build the openurl link as a convenience for the
    // common "user is logged into both apps in the same browser" case.
    const isPubliclyReachable =
      /^https?:\/\//.test(appUrl) && !/localhost|127\.0\.0\.1/.test(appUrl);
    const googleSlidesImportUrl = isPubliclyReachable
      ? `https://docs.google.com/presentation/u/0/?usp=openurl&url=${encodeURIComponent(downloadUrl)}`
      : null;

    // The dialog version of the importer — always works, just requires the
    // user to pick the file themselves.
    const googleSlidesImportDialogUrl =
      "https://docs.google.com/presentation/u/0/?usp=import";

    return {
      ...result,
      downloadUrl,
      googleSlidesImportUrl,
      googleSlidesImportDialogUrl,
      slideCount,
      note: "Download the .pptx and import it via Google Slides → File → Import slides. (Google Slides has no direct-import API for hosted PPTX files.)",
    };
  },
});
