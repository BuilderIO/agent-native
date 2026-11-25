import { describe, expect, it } from "vitest";

import {
  designScreenCaptureSchema,
  designScreenUrl,
  parseDesignScreenLink,
} from "./design-screen-capture.js";

const ORIGINS = ["https://design.agent-native.com"];

describe("parseDesignScreenLink", () => {
  it("reads a screen's copied link", () => {
    expect(
      parseDesignScreenLink(
        "https://design.agent-native.com/design/d_abc123?screen=file-1&selection=node-9",
        ORIGINS,
      ),
    ).toEqual({ kind: "screen", designId: "d_abc123", screenId: "file-1" });
  });

  it("accepts a link under an app base path", () => {
    expect(
      parseDesignScreenLink(
        "https://design.agent-native.com/design/design/abc?screen=s1",
        ORIGINS,
      ),
    ).toEqual({ kind: "screen", designId: "abc", screenId: "s1" });
  });

  it("names the board for a link without a screen", () => {
    expect(
      parseDesignScreenLink("https://design.agent-native.com/design/abc", [
        ...ORIGINS,
      ]),
    ).toEqual({ kind: "board", designId: "abc" });
    expect(
      parseDesignScreenLink(
        "https://design.agent-native.com/design/abc?screen=",
        ORIGINS,
      ),
    ).toEqual({ kind: "board", designId: "abc" });
  });

  it("ignores links from other origins, other pages and odd shapes", () => {
    for (const text of [
      "https://evil.example/design/abc?screen=s1",
      "https://design.agent-native.com/present/abc?screen=s1",
      "https://design.agent-native.com/design/abc/extra?screen=s1",
      "https://user:pass@design.agent-native.com/design/abc?screen=s1",
      "https://design.agent-native.com/design/abc?screen=s1 and more",
      "javascript:alert(1)",
      "https://design.agent-native.com/design/%E0%A4%A?screen=s1",
      "https://design.agent-native.com/design/abc?screen=bad%20id",
      "",
    ]) {
      expect(parseDesignScreenLink(text, ORIGINS)).toBeNull();
    }
  });

  it("trusts nothing with no origins", () => {
    expect(
      parseDesignScreenLink(
        "https://design.agent-native.com/design/abc?screen=s1",
        [],
      ),
    ).toBeNull();
  });
});

describe("designScreenUrl", () => {
  it("builds the link that parses back to the screen", () => {
    const url = designScreenUrl(
      "https://design.agent-native.com/",
      "abc",
      "s1",
    );
    expect(url).toBe("https://design.agent-native.com/design/abc?screen=s1");
    expect(parseDesignScreenLink(url, ORIGINS)).toEqual({
      kind: "screen",
      designId: "abc",
      screenId: "s1",
    });
  });
});

describe("designScreenCaptureSchema", () => {
  const capture = {
    design: {
      id: "abc",
      title: "Checkout",
      url: "https://design.agent-native.com/design/abc",
      visibility: "org",
    },
    screen: {
      id: "s1",
      name: "Cart",
      width: 1440,
      fingerprint: "0123456789ab",
      url: "https://design.agent-native.com/design/abc?screen=s1",
    },
    openComments: 2,
    image: {
      mimeType: "image/png",
      data: "iVBORw0KGgo=",
      width: 2880,
      height: 1800,
    },
    capturedAt: "2026-11-20T15:00:00.000Z",
  };

  it("accepts a capture", () => {
    expect(designScreenCaptureSchema.safeParse(capture).success).toBe(true);
  });

  it("refuses a link that isn't http(s) and a width outside the range", () => {
    expect(
      designScreenCaptureSchema.safeParse({
        ...capture,
        design: { ...capture.design, url: "javascript:alert(1)" },
      }).success,
    ).toBe(false);
    expect(
      designScreenCaptureSchema.safeParse({
        ...capture,
        screen: { ...capture.screen, width: 100 },
      }).success,
    ).toBe(false);
  });
});
