import { beforeEach, describe, expect, it, vi } from "vitest";

const mockParsePptxPresentation = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/ingestion", () => ({
  parsePptxPresentation: (...args: unknown[]) =>
    mockParsePptxPresentation(...args),
}));

import { InvalidPptxSourceError } from "../../../shared/source-import-errors.js";
import { parsePptx } from "./pptx-parser.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parsePptx", () => {
  it("marks known invalid PPTX input as a source error", async () => {
    mockParsePptxPresentation.mockRejectedValue(
      new Error("Invalid PPTX: missing ppt/presentation.xml"),
    );

    await expect(parsePptx(Buffer.from("bad pptx"))).rejects.toBeInstanceOf(
      InvalidPptxSourceError,
    );
  });

  it("marks known invalid ZIP archives as source errors", async () => {
    mockParsePptxPresentation.mockRejectedValue(
      new Error("Can't find end of central directory : is this a zip file ?"),
    );

    await expect(parsePptx(Buffer.from("bad zip"))).rejects.toBeInstanceOf(
      InvalidPptxSourceError,
    );
  });

  it("does not relabel unexpected parser failures", async () => {
    const parserError = new Error("Unexpected parser failure");
    mockParsePptxPresentation.mockRejectedValue(parserError);

    await expect(parsePptx(Buffer.from("bad pptx"))).rejects.toBe(parserError);
  });
});
