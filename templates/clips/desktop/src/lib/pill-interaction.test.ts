import { describe, expect, it } from "vitest";

import { isDirectPillClick } from "./pill-interaction";

describe("isDirectPillClick", () => {
  it("accepts a stationary click and normal pointer jitter", () => {
    expect(isDirectPillClick({ x: 240, y: 180 }, { x: 240, y: 180 })).toBe(
      true,
    );
    expect(isDirectPillClick({ x: 240, y: 180 }, { x: 243, y: 184 })).toBe(
      true,
    );
  });

  it("rejects a drag before the click event arrives", () => {
    expect(isDirectPillClick({ x: 240, y: 180 }, { x: 246, y: 180 })).toBe(
      false,
    );
    expect(isDirectPillClick({ x: 240, y: 180 }, { x: 320, y: 260 })).toBe(
      false,
    );
  });

  it("fails closed when no matching press was recorded", () => {
    expect(isDirectPillClick(null, { x: 240, y: 180 })).toBe(false);
  });
});
