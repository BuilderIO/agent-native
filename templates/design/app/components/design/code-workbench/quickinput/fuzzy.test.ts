import { describe, expect, it } from "vitest";

import { score, scoreFilePath } from "./fuzzy";

describe("score", () => {
  it("returns a zero-score empty match for an empty query", () => {
    expect(score("", "anything.ts")).toEqual({ score: 0, matches: [] });
  });

  it("returns null when target is empty", () => {
    expect(score("a", "")).toBeNull();
  });

  it("returns null when characters are missing or out of order", () => {
    expect(score("xyz", "abc")).toBeNull();
    expect(score("ba", "ab")).toBeNull();
  });

  it("matches characters in order and returns their indices", () => {
    const result = score("ab", "xaxbx");
    expect(result).not.toBeNull();
    expect(result!.matches).toEqual([1, 3]);
  });

  it("is deterministic across repeated calls", () => {
    const first = score("wbc", "workbench.tsx");
    const second = score("wbc", "workbench.tsx");
    expect(first).toEqual(second);
  });

  it("scores a consecutive run higher than a scattered match of equal length", () => {
    // "wor" is consecutive at the start of "workbench.ts".
    const consecutive = score("wor", "workbench.ts");
    // "wch" is scattered across "workbench.ts" (w-o-r-k-b-e-n-c-h).
    const scattered = score("wch", "workbench.ts");
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(scattered!.score);
  });

  it("rewards camelCase boundary starts", () => {
    // "mh" matches the camelCase starts in "MonacoHost.tsx" (M, H).
    const camelBoundary = score("mh", "MonacoHost.tsx");
    // "mh" matches two arbitrary lowercase letters with no boundary bonus.
    const noBoundary = score("mh", "xxmxxhxx");
    expect(camelBoundary).not.toBeNull();
    expect(noBoundary).not.toBeNull();
    expect(camelBoundary!.score).toBeGreaterThan(noBoundary!.score);
  });

  it("rewards word/path boundary starts (separators, path segments)", () => {
    // "fi" matches the start of "file-icons.tsx" at a path/word boundary.
    const boundary = score("fi", "explorer/file-icons.tsx");
    // "fi" matches mid-word, no boundary.
    const midWord = score("fi", "xxxxxfixxxx");
    expect(boundary).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(boundary!.score).toBeGreaterThan(midWord!.score);
  });

  it("rewards exact case matches over case-insensitive matches", () => {
    const exact = score("ABC", "ABCxyz");
    const mismatched = score("ABC", "abcxyz");
    expect(exact).not.toBeNull();
    expect(mismatched).not.toBeNull();
    expect(exact!.score).toBeGreaterThan(mismatched!.score);
  });

  it("penalizes gaps between matched characters", () => {
    const tight = score("ab", "abxxxxxxxx");
    const loose = score("ab", "axxxxxxxxb");
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    expect(tight!.score).toBeGreaterThan(loose!.score);
  });
});

describe("scoreFilePath", () => {
  it("returns a zero-score empty match for an empty query", () => {
    expect(scoreFilePath("", "src/foo.ts")).toEqual({ score: 0, matches: [] });
  });

  it("returns null when the path does not fuzzy-match the query", () => {
    expect(scoreFilePath("zzz", "src/foo.ts")).toBeNull();
  });

  it("weights a basename match above a match confined to the directory", () => {
    // "foo" matches the basename directly in the first path, and only the
    // directory segment in the second (no match in the basename "bar.ts").
    const basenameMatch = scoreFilePath("foo", "src/foo.ts");
    const dirOnlyMatch = scoreFilePath("foo", "foo/bar.ts");
    expect(basenameMatch).not.toBeNull();
    expect(dirOnlyMatch).not.toBeNull();
    expect(basenameMatch!.score).toBeGreaterThan(dirOnlyMatch!.score);
  });

  it("ranks a basename match above a directory match even with a longer overall path", () => {
    // "store" matches the basename directly in the first path (short dir).
    const basenameHit = scoreFilePath("store", "workbench/store.ts");
    // "store" only matches within a long directory chain, not the basename
    // "index.ts" — despite being a tight consecutive run, it should still
    // rank below a genuine basename match.
    const dirOnlyHit = scoreFilePath("store", "a/store-utils/nested/index.ts");
    expect(basenameHit).not.toBeNull();
    expect(dirOnlyHit).not.toBeNull();
    expect(basenameHit!.score).toBeGreaterThan(dirOnlyHit!.score);
  });

  it("is deterministic across repeated calls", () => {
    const first = scoreFilePath("mh", "code-workbench/editor/MonacoHost.tsx");
    const second = scoreFilePath("mh", "code-workbench/editor/MonacoHost.tsx");
    expect(first).toEqual(second);
  });
});
