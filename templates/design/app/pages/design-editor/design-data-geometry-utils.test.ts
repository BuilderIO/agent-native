import { describe, expect, it } from "vitest";

import { nextLocalhostScreenPosition } from "./design-data-geometry-utils";

describe("nextLocalhostScreenPosition", () => {
  it("returns the origin when the canvas has no frames yet", () => {
    expect(nextLocalhostScreenPosition({})).toEqual({ x: 0, y: 0 });
  });

  it("places the new frame to the right of the rightmost existing frame", () => {
    expect(
      nextLocalhostScreenPosition({
        a: { x: 0, y: 0, width: 1280, height: 900 },
        b: { x: 1440, y: 0, width: 1280, height: 900 },
      }),
    ).toEqual({ x: 2880, y: 0 });
  });

  it("uses the topmost frame's y and tolerates missing geometry fields", () => {
    expect(
      nextLocalhostScreenPosition({
        a: { x: 100, y: -200, width: 400 },
        b: { y: 50 },
      }),
    ).toEqual({ x: 660, y: -200 });
  });
});
