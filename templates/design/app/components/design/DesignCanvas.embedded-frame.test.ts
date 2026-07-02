import { describe, expect, it } from "vitest";

import {
  getEmbeddedFrameDocumentContent,
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

  it("preserves embedded frame styles for live document replacement", () => {
    const content = getEmbeddedFrameDocumentContent({
      content:
        '<!DOCTYPE html><html><head></head><body><div data-agent-native-node-id="rect"></div></body></html>',
      embeddedFrameBackground: "hsl(0 0% 10%)",
      contentOffsetX: -100,
      contentOffsetY: -200,
    });

    expect(content).toContain("data-agent-native-frame-background");
    expect(content).toContain("background:hsl(0 0% 10%)");
    expect(content).toContain("data-agent-native-content-offset");
    expect(content).toContain("translate:-100px -200px");
    expect(content).toContain('data-agent-native-node-id="rect"');
  });
});
