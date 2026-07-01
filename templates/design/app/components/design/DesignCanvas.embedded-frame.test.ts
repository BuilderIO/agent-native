import { describe, expect, it } from "vitest";

import {
  getEmbeddedFrameBackgroundStyle,
  getEmbeddedIframeBackgroundColor,
} from "./DesignCanvas";

describe("DesignCanvas embedded frame backgrounds", () => {
  it("lets transparentBackground override an embedded frame background", () => {
    expect(
      getEmbeddedIframeBackgroundColor({
        embeddedFrameBackground: "white",
        transparentBackground: true,
      }),
    ).toBe("transparent");
    expect(
      getEmbeddedFrameBackgroundStyle({
        embeddedFrameBackground: "white",
        transparentBackground: true,
      }),
    ).toContain("background:transparent");
  });

  it("uses the embedded frame background when transparency is not requested", () => {
    expect(
      getEmbeddedIframeBackgroundColor({
        embeddedFrameBackground: "hsl(0 0% 10%)",
      }),
    ).toBe("hsl(0 0% 10%)");
    expect(
      getEmbeddedFrameBackgroundStyle({
        embeddedFrameBackground: "hsl(0 0% 10%)",
      }),
    ).toContain("hsl(0 0% 10%)");
  });
});
