import { describe, expect, it } from "vitest";

import { decodeDataUrl } from "./data-url.js";

describe("decodeDataUrl", () => {
  it("decodes base64 payloads with MIME parameters", () => {
    expect(decodeDataUrl("data:IMAGE/PNG;charset=binary;base64,AQID")).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/png",
    });
  });

  it("rejects malformed and non-base64 data URLs", () => {
    expect(() => decodeDataUrl("data:image/png,hello")).toThrow(
      "dataUrl must be base64-encoded data: URL",
    );
  });
});
