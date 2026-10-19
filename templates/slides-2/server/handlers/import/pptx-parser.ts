import { parsePptxPresentation } from "@agent-native/core/ingestion";

import { InvalidPptxSourceError } from "../../../shared/source-import-errors.js";

export async function parsePptx(
  fileBuffer: Parameters<typeof parsePptxPresentation>[0],
  options?: Parameters<typeof parsePptxPresentation>[1],
): ReturnType<typeof parsePptxPresentation> {
  try {
    return await parsePptxPresentation(fileBuffer, options);
  } catch (error) {
    if (isInvalidPptxSourceFailure(error)) {
      throw new InvalidPptxSourceError(error);
    }
    throw error;
  }
}

function isInvalidPptxSourceFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith("Invalid PPTX:") ||
    error.message.startsWith("Can't find end of central directory") ||
    error.message.startsWith("Corrupted zip:") ||
    /^End of data reached .*Corrupted zip \?$/i.test(error.message)
  );
}

export type {
  ParsedPptxElement as ParsedElement,
  ParsedPptxParagraph as ParsedParagraph,
  ParsedPptxImage as ParsedImage,
  ParsedPptxPresentation as ParsedPresentation,
  ParsedPptxSlide as ParsedSlide,
  ParsedPptxTextRun as ParsedTextRun,
} from "@agent-native/core/ingestion";
