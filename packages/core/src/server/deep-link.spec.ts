import { describe, expect, it } from "vitest";

import {
  DESKTOP_DEEP_LINK_PROTOCOLS,
  DESKTOP_OPEN_URL,
  toDesktopOpenUrl,
} from "./deep-link.js";

describe("DESKTOP_DEEP_LINK_PROTOCOLS", () => {
  it("lists the stable scheme first, then the nightly scheme", () => {
    expect(DESKTOP_DEEP_LINK_PROTOCOLS).toEqual([
      "agentnative",
      "agentnative-nightly",
    ]);
  });

  it("keeps the stable scheme in sync with DESKTOP_OPEN_URL", () => {
    expect(`${DESKTOP_DEEP_LINK_PROTOCOLS[0]}://open`).toBe(DESKTOP_OPEN_URL);
  });
});

describe("toDesktopOpenUrl", () => {
  it("defaults to the stable scheme and keeps the query", () => {
    expect(toDesktopOpenUrl("/_agent-native/open?view=inbox&id=1")).toBe(
      "agentnative://open?view=inbox&id=1",
    );
  });

  it("uses each registered scheme verbatim", () => {
    for (const protocol of DESKTOP_DEEP_LINK_PROTOCOLS) {
      expect(toDesktopOpenUrl("/_agent-native/open?view=a", protocol)).toBe(
        `${protocol}://open?view=a`,
      );
    }
  });

  it("drops everything before the first question mark", () => {
    expect(
      toDesktopOpenUrl(
        "https://app.example.com/_agent-native/open?to=%2Fx%3Fy&view=v",
        "agentnative-nightly",
      ),
    ).toBe("agentnative-nightly://open?to=%2Fx%3Fy&view=v");
  });

  it("keeps a query that starts at the first character", () => {
    expect(toDesktopOpenUrl("?view=inbox")).toBe(
      "agentnative://open?view=inbox",
    );
  });

  it("returns the bare scheme URL without a query", () => {
    expect(toDesktopOpenUrl("/_agent-native/open")).toBe("agentnative://open");
    expect(toDesktopOpenUrl("/_agent-native/open", "agentnative-nightly")).toBe(
      "agentnative-nightly://open",
    );
  });

  it("returns the bare scheme URL for an empty query", () => {
    expect(toDesktopOpenUrl("/_agent-native/open?")).toBe("agentnative://open");
  });
});
