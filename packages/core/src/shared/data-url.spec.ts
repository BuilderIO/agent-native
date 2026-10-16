import { describe, expect, it } from "vitest";

import { parseBase64DataUrl, parseDataUrl } from "./data-url.js";

describe("parseDataUrl", () => {
  it("parses MIME parameters before a case-insensitive base64 marker", () => {
    expect(
      parseBase64DataUrl("DATA:IMAGE/JPG;charset=binary;base64,AQID"),
    ).toEqual({
      mediaType: "image/jpg",
      data: "AQID",
    });
  });

  it("keeps semicolons inside quoted MIME parameter values", () => {
    expect(
      parseDataUrl('data:image/png;name="frame;preview";base64,AQID'),
    ).toEqual({ mediaType: "image/png", data: "AQID", isBase64: true });
  });

  it("keeps commas inside quoted MIME parameter values", () => {
    expect(
      parseDataUrl('data:image/png;name="frame,preview";base64,AQID'),
    ).toEqual({ mediaType: "image/png", data: "AQID", isBase64: true });
  });

  it("parses parameterized non-base64 data URLs", () => {
    expect(parseDataUrl("data:text/plain;charset=utf-8,hello%20world")).toEqual(
      {
        mediaType: "text/plain",
        data: "hello%20world",
        isBase64: false,
      },
    );
    expect(
      parseBase64DataUrl("data:text/plain;charset=utf-8,hello"),
    ).toBeNull();
  });

  it("rejects malformed headers and empty payloads", () => {
    expect(parseDataUrl("https://example.com/image.png")).toBeNull();
    expect(parseDataUrl("data:image/png;broken;base64,AQID")).toBeNull();
    expect(parseDataUrl("data:image/png;base64,")).toBeNull();
  });
});
