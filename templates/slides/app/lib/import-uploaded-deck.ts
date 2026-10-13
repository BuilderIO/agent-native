import { callAction } from "@agent-native/core/client/hooks";

import type { UploadedFile } from "@/components/editor/PromptDialog";

import { SOURCE_IMPORT_NO_WRITE_ERROR_CODE } from "../../shared/source-import-errors";

export type ImportedSourceDeck = {
  file: UploadedFile;
  format: "pdf" | "pptx";
  slideCount: number;
  imagesSkipped: number;
};

export const IMPORT_ACTION_TIMEOUT_MS = 5 * 60 * 1000;

export interface ImportUploadedDeckOptions {
  onImportStarted?: () => void;
  onImportCleanupSafe?: () => void;
}

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

function validatedSourceDeckFiles(files: UploadedFile[]): UploadedFile[] {
  const deckFiles = files.filter((file) => sourceFormat(file));
  if (deckFiles.length > 1) {
    throw new Error(
      "Upload one presentation at a time when asking Slides to improve it. Multiple source decks cannot be merged safely without losing slide order or content.",
    );
  }
  return deckFiles;
}

export function validateUploadedDeckImport(
  files: UploadedFile[],
): UploadedFile[] {
  return validatedSourceDeckFiles(files);
}

export async function importUploadedDeckIntoDeck(
  files: UploadedFile[],
  deckId: string,
  options: ImportUploadedDeckOptions = {},
): Promise<ImportedSourceDeck | null> {
  const deckFiles = validatedSourceDeckFiles(files);
  if (deckFiles.length === 0) return null;

  const file = deckFiles[0];
  if (!file) return null;
  const format = sourceFormat(file);
  if (!format) return null;

  options.onImportStarted?.();
  let actionResult: unknown;
  try {
    actionResult = await callAction(
      format === "pptx" ? "import-pptx" : "import-file",
      format === "pptx"
        ? { filePath: file.path, deckId }
        : {
            filePath: file.path,
            format: "pdf",
            deckId,
            importIntoDeck: true,
          },
      { timeoutMs: IMPORT_ACTION_TIMEOUT_MS },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "errorCode" in error &&
      error.errorCode === SOURCE_IMPORT_NO_WRITE_ERROR_CODE
    ) {
      options.onImportCleanupSafe?.();
    }
    throw error;
  }
  const result = actionResultRecord(actionResult);
  if (result.imported !== true || result.deckId !== deckId) {
    throw new Error(
      `The ${format.toUpperCase()} source deck was not imported into the target deck, so no source-preserving improvement was started.`,
    );
  }

  const slideCount = result.slideCount;
  if (
    typeof slideCount !== "number" ||
    !Number.isInteger(slideCount) ||
    slideCount < 0
  ) {
    throw new Error(
      `The ${format.toUpperCase()} import did not report a reliable slide count, so no source-preserving improvement was started.`,
    );
  }
  const imagesSkipped = result.imagesSkipped ?? 0;
  if (
    typeof imagesSkipped !== "number" ||
    !Number.isInteger(imagesSkipped) ||
    imagesSkipped < 0
  ) {
    throw new Error(
      `The ${format.toUpperCase()} import did not report a reliable image count, so no source-preserving improvement was started.`,
    );
  }
  if (slideCount < 1) {
    options.onImportCleanupSafe?.();
    throw new Error(
      `The ${format.toUpperCase()} source deck contained no importable slides.`,
    );
  }

  if (imagesSkipped > 0) {
    throw new Error(
      `The ${format.toUpperCase()} source deck could not preserve ${imagesSkipped} image(s), so Slides stopped before restyling it. Re-export the deck with browser-renderable images, or upload a PDF for source-faithful page preservation.`,
    );
  }

  options.onImportCleanupSafe?.();
  return { file, format, slideCount, imagesSkipped };
}
