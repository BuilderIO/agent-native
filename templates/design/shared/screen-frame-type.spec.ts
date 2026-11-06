import { describe, expect, it } from "vitest";

import { createHubSpotEmailHtml } from "./hubspot-email.js";
import {
  resolveScreenFrameType,
  screenFrameTypeForCopy,
  storedScreenFrameType,
  withStoredScreenFrameType,
} from "./screen-frame-type.js";

const marked = createHubSpotEmailHtml();
const plain = "<!doctype html><html><body>Plain</body></html>";

describe("screen frame type", () => {
  it("reads a stored email type without needing content", () => {
    const designData = {
      screenMetadata: { a: { width: 600, frameType: "hubspot-email" } },
    };
    expect(resolveScreenFrameType({ designData, fileId: "a" })).toBe(
      "hubspot-email",
    );
    expect(
      resolveScreenFrameType({ designData, fileId: "a", content: plain }),
    ).toBe("hubspot-email");
  });

  it("lets a stored web type override a legacy marker", () => {
    const designData = { screenMetadata: { a: { frameType: "web" } } };
    expect(
      resolveScreenFrameType({ designData, fileId: "a", content: marked }),
    ).toBeNull();
  });

  it("falls back to the legacy marker only when no type is stored", () => {
    expect(
      resolveScreenFrameType({ designData: {}, fileId: "a", content: marked }),
    ).toBe("hubspot-email");
    expect(
      resolveScreenFrameType({ designData: {}, fileId: "a", content: plain }),
    ).toBeNull();
    expect(resolveScreenFrameType({ designData: {}, fileId: "a" })).toBeNull();
  });

  it("gives a copy the stored type, including web over a legacy marker", () => {
    const web = { screenMetadata: { a: { frameType: "web" } } };
    expect(
      screenFrameTypeForCopy({ designData: web, fileId: "a", content: marked }),
    ).toBe("web");
    expect(
      screenFrameTypeForCopy({ designData: {}, fileId: "a", content: marked }),
    ).toBe("hubspot-email");
    expect(
      screenFrameTypeForCopy({ designData: {}, fileId: "a", content: plain }),
    ).toBeUndefined();
  });

  it("ignores values that are not a known frame type", () => {
    const designData = { screenMetadata: { a: { frameType: "newsletter" } } };
    expect(storedScreenFrameType(designData, "a")).toBeUndefined();
  });

  it("stores a frame type beside the screen's other metadata", () => {
    const designData = {
      canvasFrames: { a: { x: 0 } },
      screenMetadata: { a: { width: 600 }, b: { width: 390 } },
    };
    expect(withStoredScreenFrameType(designData, "a", "hubspot-email")).toEqual(
      {
        canvasFrames: { a: { x: 0 } },
        screenMetadata: {
          a: { width: 600, frameType: "hubspot-email" },
          b: { width: 390 },
        },
      },
    );
  });
});
