import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs script, no type declarations
import { parsePorcelain } from "./ship-push.mjs";

const z = (...entries: string[]) => entries.join("\0") + "\0";

describe("parsePorcelain", () => {
  it("keeps a leading dot that trimming the status column would eat", () => {
    expect(parsePorcelain(z(" M .agents/skills/ship/SKILL.md"))).toEqual([
      ".agents/skills/ship/SKILL.md",
    ]);
  });

  it("skips the old path of a rename so `git add` never gets a dead path", () => {
    expect(parsePorcelain(z("R  new/path.ts", "old/path.ts", "?? added.ts"))).toEqual(
      ["new/path.ts", "added.ts"],
    );
  });

  it("returns nothing for a clean tree", () => {
    expect(parsePorcelain("")).toEqual([]);
  });
});
