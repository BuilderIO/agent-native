import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("../source-workspace.js", () => ({ readLiveSourceFile: vi.fn() }));
vi.mock("./playwright-runtime.js", () => ({
  importPlaywright: vi.fn(),
  launchChromium: vi.fn(),
}));

import {
  pngSize,
  screenFingerprint,
  screenName,
  screenWidthPx,
  visibilityForRequest,
} from "./screen-capture.js";

describe("visibilityForRequest", () => {
  it("keeps public and private as Design stores them", () => {
    expect(visibilityForRequest("public", "org-1", null)).toBe("public");
    expect(visibilityForRequest("private", "org-1", "org-1")).toBe("private");
  });

  it("counts an organization share only for that organization", () => {
    expect(visibilityForRequest("org", "org-1", "org-1")).toBe("org");
    expect(visibilityForRequest("org", "org-1", "org-2")).toBe("private");
    expect(visibilityForRequest("org", null, "org-1")).toBe("private");
    expect(visibilityForRequest("org", "org-1", null)).toBe("private");
  });

  it("reads anything else as private", () => {
    expect(visibilityForRequest(undefined, null, null)).toBe("private");
    expect(visibilityForRequest("everyone", "org-1", "org-1")).toBe("private");
  });
});

describe("screenWidthPx", () => {
  it("prefers the screen's own width over its canvas frame", () => {
    expect(
      screenWidthPx(
        {
          screenMetadata: { s1: { width: 390 } },
          canvasFrames: { s1: { x: 0, y: 0, width: 320, height: 600 } },
        },
        "s1",
      ),
    ).toBe(390);
  });

  it("falls back to 1440 and keeps widths in range", () => {
    expect(screenWidthPx({}, "s1")).toBe(1440);
    expect(screenWidthPx({ screenMetadata: { s1: { width: 50 } } }, "s1")).toBe(
      200,
    );
    expect(
      screenWidthPx({ screenMetadata: { s1: { width: 9000 } } }, "s1"),
    ).toBe(3840);
    expect(screenWidthPx({ screenMetadata: "broken" }, "s1")).toBe(1440);
  });
});

describe("screenName", () => {
  it("names a screen by its file name", () => {
    expect(screenName("Checkout.html")).toBe("Checkout");
    expect(screenName("flows/cart/Summary.htm")).toBe("Summary");
    expect(screenName(".html")).toBe(".html");
  });
});

describe("screenFingerprint", () => {
  const data = { screenMetadata: { s1: { width: 1440 } } };

  it("is stable for the same screen", () => {
    const one = screenFingerprint({ content: "<main>Hi</main>" }, data, "s1");
    expect(one).toMatch(/^[a-f0-9]{12}$/);
    expect(screenFingerprint({ content: "<main>Hi</main>" }, data, "s1")).toBe(
      one,
    );
  });

  it("moves when the source or the screen's frame changes", () => {
    const one = screenFingerprint({ content: "<main>Hi</main>" }, data, "s1");
    expect(
      screenFingerprint({ content: "<main>Hello</main>" }, data, "s1"),
    ).not.toBe(one);
    expect(
      screenFingerprint(
        { content: "<main>Hi</main>" },
        { screenMetadata: { s1: { width: 390 } } },
        "s1",
      ),
    ).not.toBe(one);
  });

  it("ignores the design's other screens", () => {
    const one = screenFingerprint({ content: "<main>Hi</main>" }, data, "s1");
    expect(
      screenFingerprint(
        { content: "<main>Hi</main>" },
        { screenMetadata: { s1: { width: 1440 }, s2: { width: 390 } } },
        "s1",
      ),
    ).toBe(one);
  });
});

describe("pngSize", () => {
  it("reads the size from the PNG header", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(2880, 16);
    png.writeUInt32BE(1800, 20);
    expect(pngSize(png)).toEqual({ width: 2880, height: 1800 });
  });

  it("refuses bytes that aren't a PNG", () => {
    expect(() => pngSize(Buffer.from("not a png"))).toThrow("Not a PNG");
  });
});
