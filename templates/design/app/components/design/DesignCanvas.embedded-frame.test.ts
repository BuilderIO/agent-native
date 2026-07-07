import { describe, expect, it } from "vitest";

import {
  getEmbeddedFrameDocumentContent,
  getEmbeddedFrameBackgroundStyle,
  getEmbeddedIframeBackgroundColor,
  isElementInfoPayload,
  liveEditEndpointUrl,
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

describe("DesignCanvas bridge payload validation", () => {
  it("accepts complete element info payloads from the live edit bridge", () => {
    expect(
      isElementInfoPayload({
        tagName: "section",
        selector: "[data-agent-native-node-id='hero']",
        sourceId: "hero",
        classes: ["hero"],
        computedStyles: { color: "rgb(15, 23, 42)" },
        inlineStyles: {},
        boundingRect: { x: 10, y: 20, width: 300, height: 120 },
        isFlexChild: false,
        isFlexContainer: true,
      }),
    ).toBe(true);
  });

  it("rejects partial style-change payloads before they reach inspector state", () => {
    expect(
      isElementInfoPayload({
        tagName: "section",
        selector: "[data-agent-native-node-id='hero']",
        sourceId: "hero",
        classes: ["hero"],
        computedStyles: { width: "320px" },
        isFlexChild: false,
        isFlexContainer: true,
      }),
    ).toBe(false);
  });
});

describe("DesignCanvas live-edit URLs", () => {
  it("can request the bridge proxy without editor chrome for Interact mode", () => {
    const url = liveEditEndpointUrl(
      "http://127.0.0.1:7331",
      "http://localhost:5173/forms",
      { includeEditorBridge: false },
    );

    expect(url).toBe(
      "http://127.0.0.1:7331/live-edit?url=http%3A%2F%2Flocalhost%3A5173%2Fforms&bridge=0",
    );
  });
});
