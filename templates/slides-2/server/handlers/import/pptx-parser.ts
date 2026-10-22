import { fail } from "@agent-native/core/action";
import {
  DEFAULT_PPTX_IMAGE_BYTE_LIMITS,
  PptxImageByteLimitError,
  parsePptxPresentation,
} from "@agent-native/core/ingestion";

import {
  InvalidPptxSourceError,
  SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
} from "../../../shared/source-import-errors.js";

export async function parsePptx(
  fileBuffer: Parameters<typeof parsePptxPresentation>[0],
  options?: Parameters<typeof parsePptxPresentation>[1],
): ReturnType<typeof parsePptxPresentation> {
  try {
    return await parsePptxPresentation(fileBuffer, {
      ...options,
      imageByteLimits:
        options?.imageByteLimits ?? DEFAULT_PPTX_IMAGE_BYTE_LIMITS,
    });
  } catch (error) {
    if (error instanceof PptxImageByteLimitError) {
      fail(
        "Slides could not read this PowerPoint file. No slides were written to the deck.",
        {
          errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
          statusCode: 413,
        },
      );
    }
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
