import { describe, expect, it } from "vitest";

import { includeReferenceSkin } from "./reference-skin";

describe("reference skin build boundary", () => {
  const cases = [
    [undefined, true, false],
    ["0", false, false],
    ["1", true, true],
    ["", true, false],
    ["true", true, false],
    [" 1", true, false],
  ] as const;

  for (const [value, serve, build] of cases) {
    for (const entryExists of [false, true]) {
      it(`serve with ${String(value)} and entry=${entryExists}`, () => {
        expect(includeReferenceSkin("serve", value, entryExists)).toBe(
          entryExists && serve,
        );
      });
      it(`build with ${String(value)} and entry=${entryExists}`, () => {
        expect(includeReferenceSkin("build", value, entryExists)).toBe(
          entryExists && build,
        );
      });
    }
  }
});
