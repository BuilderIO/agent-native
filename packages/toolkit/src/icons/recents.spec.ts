import { describe, expect, it } from "vitest";

import { addResourceIconRecent, resourceIconKey } from "./recents.js";
import type { ResourceIconValue } from "./types.js";

describe("resource icon recents", () => {
  it("deduplicates the complete value while preserving colored variants", () => {
    const blue: ResourceIconValue = {
      version: 1,
      kind: "library",
      library: "tabler",
      name: "book",
      color: "blue",
    };
    const red: ResourceIconValue = { ...blue, color: "red" };
    expect(addResourceIconRecent([blue, red], blue)).toEqual([blue, red]);
    expect(resourceIconKey(blue)).not.toBe(resourceIconKey(red));
  });

  it("bounds recents to 24 by default", () => {
    const recents: ResourceIconValue[] = Array.from(
      { length: 30 },
      (_, index) => ({
        version: 1,
        kind: "emoji",
        emoji: String(index),
      }),
    );
    expect(
      addResourceIconRecent(recents, {
        version: 1,
        kind: "emoji",
        emoji: "new",
      }),
    ).toHaveLength(24);
  });
});
