import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convertToHtml: vi.fn(),
  extractRawText: vi.fn(),
  parseDocxDocument: vi.fn(),
}));

vi.mock("mammoth", () => ({
  convertToHtml: (...args: unknown[]) => mocks.convertToHtml(...args),
  extractRawText: (...args: unknown[]) => mocks.extractRawText(...args),
}));

vi.mock("@agent-native/core/ingestion", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/ingestion")>();
  return {
    ...actual,
    parseDocxDocument: (...args: unknown[]) => mocks.parseDocxDocument(...args),
  };
});

import { parseDocx } from "./docx-parser.js";

describe("parseDocx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.convertToHtml.mockResolvedValue({
      value: "<h1>Quarterly update</h1><p>Summary<script>bad()</script></p>",
    });
    mocks.extractRawText.mockResolvedValue({
      value: "Quarterly update\nSummary",
    });
  });

  it("uses the bundled Mammoth parser and sanitizes the converted document", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const parsed = await parseDocx(bytes);

    expect(mocks.convertToHtml).toHaveBeenCalledWith({
      buffer: Buffer.from(bytes),
    });
    expect(mocks.extractRawText).toHaveBeenCalledWith({
      buffer: Buffer.from(bytes),
    });
    expect(mocks.parseDocxDocument).not.toHaveBeenCalled();
    expect(parsed).toMatchObject({
      title: "Quarterly update",
      text: "Quarterly update\nSummary",
      html: "<h1>Quarterly update</h1><p>Summary</p>",
      sections: [
        {
          heading: "Quarterly update",
          text: "Summary",
        },
      ],
    });
  });
});
