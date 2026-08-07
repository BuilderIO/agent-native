import { callAction } from "@agent-native/core/client/hooks";

import type { UploadedFile } from "@/components/editor/PromptDialog";

export type ImportedSourceDeck = {
  file: UploadedFile;
  format: "pdf" | "pptx";
  slideCount: number;
  imagesSkipped: number;
};

function sourceFormat(file: UploadedFile): "pdf" | "pptx" | null {
  const name = file.originalName.toLowerCase();
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".pdf")) return "pdf";
  return null;
}

function actionResultRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The uploaded presentation import returned no result.");
  }
  return value as Record<string, unknown>;
}

/**
 * Imports the user's source deck into the already-persisted target deck before
 * the agent run starts. This keeps the agent on the source slide IDs and
 * preserves source-native images instead of asking it to reconstruct a deck
 * from extracted text.
 */
export async function importUploadedDeckIntoDeck(
  files: UploadedFile[],
  deckId: string,
): Promise<ImportedSourceDeck | null> {
  const deckFiles = files.filter((file) => sourceFormat(file));
  if (deckFiles.length === 0) return null;
  if (deckFiles.length > 1) {
    throw new Error(
      "Upload one presentation at a time when asking Slides to improve it. Multiple source decks cannot be merged safely without losing slide order or content.",
    );
  }

  const file = deckFiles[0];
  if (!file) return null;
  const format = sourceFormat(file);
  if (!format) return null;

  const result = actionResultRecord(
    await callAction(
      format === "pptx" ? "import-pptx" : "import-file",
      format === "pptx"
        ? { filePath: file.path, deckId }
        : {
            filePath: file.path,
            format: "pdf",
            deckId,
            importIntoDeck: true,
          },
    ),
  );
  if (result.imported !== true || result.deckId !== deckId) {
    throw new Error(
      `The ${format.toUpperCase()} source deck was not imported into the target deck, so no source-preserving improvement was started.`,
    );
  }

  const slideCount = result.slideCount;
  if (typeof slideCount !== "number" || !Number.isInteger(slideCount)) {
    throw new Error(
      `The ${format.toUpperCase()} import did not report a reliable slide count, so no source-preserving improvement was started.`,
    );
  }
  if (slideCount < 1) {
    throw new Error(
      `The ${format.toUpperCase()} source deck contained no importable slides.`,
    );
  }

  const imagesSkipped =
    typeof result.imagesSkipped === "number" ? result.imagesSkipped : 0;
  if (imagesSkipped > 0) {
    throw new Error(
      `The ${format.toUpperCase()} source deck could not preserve ${imagesSkipped} image(s), so Slides stopped before restyling it. Re-export the deck with browser-renderable images, or upload a PDF for source-faithful page preservation.`,
    );
  }

  return { file, format, slideCount, imagesSkipped };
}
