import { describe, expect, it } from "vitest";

import {
  normalizeSlideClipboard,
  readSlideClipboard,
  writeSlideClipboard,
} from "./slide-clipboard";

const base = { id: "slide-1", content: "<div>One</div>" };

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe("normalizeSlideClipboard transitions", () => {
  it.each([
    ["flip", "flip"],
    ["slide-from-left", "slide-from-left"],
    ["instant", "none"],
    ["slide", "slide-from-right"],
    ["zoom", "dissolve"],
  ])("normalizes transition %s to %s", (input, canonical) => {
    expect(
      normalizeSlideClipboard({ ...base, transition: input })?.transition,
    ).toBe(canonical);
  });

  it("rejects a transition outside the catalog", () => {
    expect(
      normalizeSlideClipboard({ ...base, transition: "bounce" }),
    ).toBeNull();
  });

  it("keeps a valid integer transitionSpeed", () => {
    expect(
      normalizeSlideClipboard({ ...base, transitionSpeed: 30 })
        ?.transitionSpeed,
    ).toBe(30);
  });

  it("clamps and rounds an out-of-range transitionSpeed", () => {
    expect(
      normalizeSlideClipboard({ ...base, transitionSpeed: 80 })
        ?.transitionSpeed,
    ).toBe(49);
    expect(
      normalizeSlideClipboard({ ...base, transitionSpeed: -4 })
        ?.transitionSpeed,
    ).toBe(0);
    expect(
      normalizeSlideClipboard({ ...base, transitionSpeed: 30.4 })
        ?.transitionSpeed,
    ).toBe(30);
  });

  it("drops a null transitionSpeed instead of storing it", () => {
    const slide = normalizeSlideClipboard({ ...base, transitionSpeed: null });
    expect(slide).not.toBeNull();
    expect(slide).not.toHaveProperty("transitionSpeed");
  });

  it.each(["fast", Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-numeric transitionSpeed %s",
    (transitionSpeed) => {
      expect(normalizeSlideClipboard({ ...base, transitionSpeed })).toBeNull();
    },
  );
});

describe("slide clipboard round trip", () => {
  it("keeps a canonical transition and its speed through storage", () => {
    const storage = memoryStorage();
    const slide = normalizeSlideClipboard({
      ...base,
      transition: "cube",
      transitionSpeed: 12,
    })!;

    expect(writeSlideClipboard("key", slide, 1000, storage)).toBe(true);
    const result = readSlideClipboard("key", storage);

    expect(result).toMatchObject({
      status: "ready",
      slide: { transition: "cube", transitionSpeed: 12 },
    });
  });
});
