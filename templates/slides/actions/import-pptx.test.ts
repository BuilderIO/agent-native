import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  parsePptx: vi.fn(),
  uploadPptxSlideImages: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: { decks: {} },
}));

vi.mock("../server/handlers/import/pptx-assets.js", () => ({
  assertPptxImagesRenderable: vi.fn(),
  uploadPptxSlideImages: (...args: unknown[]) =>
    mocks.uploadPptxSlideImages(...args),
}));

vi.mock("../server/handlers/import/pptx-parser.js", () => ({
  parsePptx: (...args: unknown[]) => mocks.parsePptx(...args),
}));

import {
  InvalidPptxSourceError,
  SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
} from "../shared/source-import-errors.js";
import { importPptxBufferToDeck } from "./import-pptx";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importPptxBufferToDeck parse failures", () => {
  it("returns a typed no-write failure before database access or image uploads", async () => {
    mocks.parsePptx.mockRejectedValue(
      new InvalidPptxSourceError(new Error("Invalid PPTX: broken archive")),
    );

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("invalid PPTX"),
        deckId: "deck-1",
      }),
    ).rejects.toMatchObject({
      errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
      message: expect.stringContaining("No slides were written"),
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });

  it("preserves an already typed parser error", async () => {
    const typedError = Object.assign(new Error("Parser unavailable"), {
      errorCode: "pptx_parser_unavailable",
      statusCode: 503,
    });
    mocks.parsePptx.mockRejectedValue(typedError);

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("invalid PPTX"),
        deckId: "deck-1",
      }),
    ).rejects.toBe(typedError);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });

  it("preserves unexpected parser errors", async () => {
    const parserError = new Error("Unexpected parser failure");
    mocks.parsePptx.mockRejectedValue(parserError);

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("invalid PPTX"),
        deckId: "deck-1",
      }),
    ).rejects.toBe(parserError);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });
});
