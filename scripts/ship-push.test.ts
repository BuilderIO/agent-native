import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs script, no type declarations
import {
  assertFreeDisk,
  freeDiskBytes,
  isExcludedPath,
  isSpecificCommitMessage,
  parsePorcelain,
  selectStageablePaths,
} from "./ship-push.mjs";

const z = (...entries: string[]) => entries.join("\0") + "\0";

describe("free disk preflight", () => {
  it("returns the filesystem's available bytes", () => {
    expect(freeDiskBytes(process.cwd())).toBeGreaterThan(0);
  });

  it("fails loudly below the required floor", () => {
    expect(() =>
      assertFreeDisk(process.cwd(), Number.MAX_SAFE_INTEGER),
    ).toThrow(/free on .* need at least/i);
  });
});

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
    expect(selectStageablePaths(["gone.ts", "a.ts"], onDisk("a.ts"))).toEqual([
      "a.ts",
    ]);
  });
});

describe("isExcludedPath", () => {
  it("excludes root bridge/data directories without suppressing app source", () => {
    expect(isExcludedPath("bridge/notes.ts")).toBe(true);
    expect(isExcludedPath("data/session.json")).toBe(true);
    expect(
      isExcludedPath("templates/design/app/components/design/bridge/editor.ts"),
    ).toBe(false);
    expect(
      isExcludedPath("templates/design/.generated/bridge/editor.generated.ts"),
    ).toBe(false);
  });

  it("excludes learnings.md at any path", () => {
    expect(isExcludedPath("learnings.md")).toBe(true);
    expect(isExcludedPath("templates/design/learnings.md")).toBe(true);
  });
});

describe("isSpecificCommitMessage", () => {
  it("rejects empty, generic, and option-looking commit subjects", () => {
    expect(isSpecificCommitMessage(undefined)).toBe(false);
    expect(isSpecificCommitMessage("chore: publish branch work")).toBe(false);
    expect(isSpecificCommitMessage("fix")).toBe(false);
    expect(isSpecificCommitMessage("update")).toBe(false);
    expect(isSpecificCommitMessage("fix update")).toBe(false);
    expect(isSpecificCommitMessage("fix: update")).toBe(false);
    expect(isSpecificCommitMessage("fix\nbody")).toBe(false);
    expect(isSpecificCommitMessage("--dry-run")).toBe(false);
    expect(isSpecificCommitMessage("-m --foo")).toBe(false);
    expect(isSpecificCommitMessage("fix: avoid repeated CI runs")).toBe(true);
  });
});

describe("renames survive the round trip", () => {
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
