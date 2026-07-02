import { describe, expect, it } from "vitest";

import { parseFigmaFileKey } from "./list-figma-library-assets";

describe("parseFigmaFileKey", () => {
  it("accepts a raw Figma file key", () => {
    expect(parseFigmaFileKey("abcDEF_12345")).toBe("abcDEF_12345");
  });

  it("extracts design, file, and proto URL keys", () => {
    expect(
      parseFigmaFileKey("https://www.figma.com/design/abcDEF12345/App"),
    ).toBe("abcDEF12345");
    expect(
      parseFigmaFileKey("https://www.figma.com/file/xyz98765432/System"),
    ).toBe("xyz98765432");
    expect(
      parseFigmaFileKey("https://www.figma.com/proto/protoKey123/Flow"),
    ).toBe("protoKey123");
  });

  it("returns null for invalid input", () => {
    expect(parseFigmaFileKey("https://example.com/nope")).toBeNull();
    expect(parseFigmaFileKey("")).toBeNull();
  });
});
