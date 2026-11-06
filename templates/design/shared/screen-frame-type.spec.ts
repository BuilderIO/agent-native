import { describe, expect, it, vi } from "vitest";

import { createHubSpotEmailHtml } from "./hubspot-email.js";
import {
  resolveScreenFrameType,
  screenFrameTypeForCopy,
  sourceWriteFrameType,
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

  it("never reads stored data for a source write without the marker", () => {
    const readStored = vi.fn(() => "hubspot-email" as const);
    expect(
      sourceWriteFrameType({
        readStored,
        previousContents: [plain],
        nextContent: plain,
      }),
    ).toEqual({ frameType: null, unstoredLegacyMarker: false });
    expect(readStored).not.toHaveBeenCalled();
  });

  it("lets a stored web type override a leftover marker in a source write", () => {
    expect(
      sourceWriteFrameType({
        readStored: () => "web",
        previousContents: [marked],
        nextContent: marked,
      }),
    ).toEqual({ frameType: null, unstoredLegacyMarker: false });
  });

  it("flags a marked screen with no stored type as a legacy email", () => {
    expect(
      sourceWriteFrameType({
        readStored: () => undefined,
        previousContents: [plain, marked],
        nextContent: plain,
      }),
    ).toEqual({ frameType: "hubspot-email", unstoredLegacyMarker: true });
    expect(
      sourceWriteFrameType({
        readStored: () => undefined,
        previousContents: [plain],
        nextContent: marked,
      }),
    ).toEqual({ frameType: "hubspot-email", unstoredLegacyMarker: false });
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
