import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs script, no type declarations
import { parsePorcelain, selectStageablePaths } from "./ship-push.mjs";

const z = (...entries: string[]) => entries.join("\0") + "\0";

describe("parsePorcelain", () => {
  it("keeps a leading dot that trimming the status column would eat", () => {
    expect(parsePorcelain(z(" M .agents/skills/ship/SKILL.md"))).toEqual([
      ".agents/skills/ship/SKILL.md",
    ]);
  });

  it("skips the old path of a rename so `git add` never gets a dead path", () => {
    expect(
      parsePorcelain(z("R  new/path.ts", "old/path.ts", "?? added.ts")),
    ).toEqual(["new/path.ts", "added.ts"]);
  });

  it("returns nothing for a clean tree", () => {
    expect(parsePorcelain("")).toEqual([]);
  });
});

describe("selectStageablePaths", () => {
  const onDisk = (...files: string[]) => ({
    exists: (file: string) => files.includes(file),
    isTracked: () => false,
  });

  it("stages a deleted file that Git still tracks", () => {
    // Regression: filtering to paths present on disk dropped every deletion,
    // so `rm old.ts && ship:push` shipped the new file and left the old one
    // tracked — a partial snapshot from a helper that promises a whole one.
    expect(
      selectStageablePaths(["new.ts", "old.ts"], {
        exists: (file) => file === "new.ts",
        isTracked: (file) => file === "old.ts",
      }),
    ).toEqual(["new.ts", "old.ts"]);
  });

  it("keeps ordinary modified and added files", () => {
    expect(
      selectStageablePaths(["a.ts", "b.ts"], onDisk("a.ts", "b.ts")),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("drops a path that is neither on disk nor tracked", () => {
    // Such a pathspec makes `git add` abort, which would strand every other
    // path in the same call.
    expect(selectStageablePaths(["gone.ts", "a.ts"], onDisk("a.ts"))).toEqual([
      "a.ts",
    ]);
  });
});

describe("renames survive the round trip", () => {
  // Verified against real git: an unstaged `mv old.ts new.ts` does NOT produce
  // an `R` record. Porcelain reports ` D old.ts` and `?? new.ts` as two
  // separate entries, so both reach `git add` on their own. An `R` record only
  // appears once the rename is already staged, at which point the old path's
  // removal is in the index and re-adding it would be a no-op — which is why
  // parsePorcelain may drop it without losing the deletion.
  it("reads an unstaged rename as a deletion plus an addition", () => {
    expect(parsePorcelain(z(" D old.ts", "?? new.ts"))).toEqual([
      "old.ts",
      "new.ts",
    ]);
  });

  it("stages both halves of an unstaged rename", () => {
    expect(
      selectStageablePaths(parsePorcelain(z(" D old.ts", "?? new.ts")), {
        exists: (file) => file === "new.ts",
        isTracked: (file) => file === "old.ts",
      }),
    ).toEqual(["old.ts", "new.ts"]);
  });
});
