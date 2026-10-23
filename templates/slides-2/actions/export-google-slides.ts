import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import exportPptxAction from "./export-pptx.js";

export default defineAction({
  description:
    "Export a deck for Google Slides by generating a PPTX (the format Google Slides imports) and returning a download URL plus the Google Slides import dialog URL. The delegated PPTX action attempts bounded static rendering for supported source slides without a saved preview; source that requires browser Worker rendering returns source_runtime_export_required before a file is created. The editor menu can render those slides in its opaque-origin sandbox and build the PPTX locally. The user can drag the file into Google Slides or use File → Import.",
  schema: z.object({
    deckId: z.string().describe("Deck ID to export"),
    includeNotes: z
      .preprocess(
        (v) => (v === "true" ? true : v === "false" ? false : v),
        z.boolean().optional().default(true),
      )
      .describe("Include speaker notes"),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ deckId, includeNotes }, ctx) => {
    const result = ctx
      ? await exportPptxAction.run({ deckId, includeNotes }, ctx)
      : await exportPptxAction.run({ deckId, includeNotes });
    const { slideCount, downloadUrl } = result;

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
