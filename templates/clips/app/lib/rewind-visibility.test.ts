import { describe, expect, it } from "vitest";

import { isPrivateClip } from "./rewind-visibility";

describe("Rewind history visibility", () => {
  it("treats only a private Clip as private", () => {
    expect(isPrivateClip("private")).toBe(true);
    expect(isPrivateClip("org")).toBe(false);
    expect(isPrivateClip("public")).toBe(false);
    expect(isPrivateClip(null)).toBe(false);
  });
});
