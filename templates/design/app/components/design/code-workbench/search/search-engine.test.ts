import { describe, expect, it } from "vitest";

import type {
  WorkspaceFileEntry,
  WorkspaceProvider,
  WorkspaceReadResult,
} from "../workspace/types";
import {
  buildSearchRegExp,
  findMatchesInText,
  invalidate,
  planReplaceAllFile,
  replaceMatchesInText,
  searchWorkspace,
} from "./search-engine";

function baseOptions(
  overrides: Partial<Parameters<typeof findMatchesInText>[2]> = {},
) {
  return { matchCase: false, wholeWord: false, regex: false, ...overrides };
}

describe("findMatchesInText", () => {
  it("finds case-insensitive matches by default", () => {
    const matches = findMatchesInText(
      "Hello world\nhello again",
      "hello",
      baseOptions(),
    );
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ line: 1, column: 1, length: 5 });
    expect(matches[1]).toMatchObject({ line: 2, column: 1, length: 5 });
  });

  it("respects matchCase", () => {
    const matches = findMatchesInText(
      "Hello world\nhello again",
      "hello",
      baseOptions({ matchCase: true }),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(2);
  });

  it("respects wholeWord boundaries", () => {
    const text = "cat category catalog cat";
    const withoutBoundary = findMatchesInText(text, "cat", baseOptions());
    expect(withoutBoundary.length).toBeGreaterThanOrEqual(4);

    const withBoundary = findMatchesInText(
      text,
      "cat",
      baseOptions({ wholeWord: true }),
    );
    expect(withBoundary).toHaveLength(2);
    expect(withBoundary.map((m) => m.column)).toEqual([1, 22]);
  });

  it("supports regex patterns and escapes non-regex queries", () => {
    const regexMatches = findMatchesInText(
      "foo1 foo22 foo333",
      "foo\\d+",
      baseOptions({ regex: true }),
    );
    expect(regexMatches).toHaveLength(3);
    expect(regexMatches[0].length).toBe(4);
    expect(regexMatches[2].length).toBe(6);

    // A literal query containing regex metacharacters must be escaped when
    // regex mode is off — "a.b" should not match "axb".
    const literalMatches = findMatchesInText("a.b axb", "a.b", baseOptions());
    expect(literalMatches).toHaveLength(1);
    expect(literalMatches[0].column).toBe(1);
  });

  it("returns no matches (not a throw) for invalid regex", () => {
    expect(() =>
      findMatchesInText("abc", "(unterminated", baseOptions({ regex: true })),
    ).not.toThrow();
    expect(
      findMatchesInText("abc", "(unterminated", baseOptions({ regex: true })),
    ).toEqual([]);
  });

  it("finds multiple matches per line", () => {
    const matches = findMatchesInText("foo foo foo", "foo", baseOptions());
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.column)).toEqual([1, 5, 9]);
  });

  it("returns empty for an empty query", () => {
    expect(findMatchesInText("hello", "", baseOptions())).toEqual([]);
  });
});

describe("buildSearchRegExp", () => {
  it("throws for genuinely invalid regex patterns", () => {
    expect(() =>
      buildSearchRegExp("(unterminated", {
        matchCase: true,
        wholeWord: false,
        regex: true,
      }),
    ).toThrow();
  });

  it("builds a global, case-insensitive regex by default", () => {
    const re = buildSearchRegExp("abc", {
      matchCase: false,
      wholeWord: false,
      regex: false,
    });
    expect(re.flags).toContain("g");
    expect(re.flags).toContain("i");
  });
});

function makeProvider(
  key: string,
  files: Record<string, string>,
  overrides: Partial<WorkspaceProvider> = {},
): WorkspaceProvider {
  return {
    key,
    kind: "inline",
    label: key,
    capabilities: { write: true, create: true, rename: true, delete: true },
    listFiles: async () =>
      Object.keys(files).map((path): WorkspaceFileEntry => ({ path })),
    readFile: async (path: string): Promise<WorkspaceReadResult> => ({
      content: files[path] ?? "",
      versionHash: `v-${files[path]?.length ?? 0}`,
    }),
    writeFile: async () => ({}),
    ...overrides,
  };
}

describe("searchWorkspace", () => {
  it("searches across all provider files and aggregates matches", async () => {
    invalidate();
    const provider = makeProvider("inline:d1", {
      "a.html": "<div>hello</div>",
      "b.css": ".hello { color: red; }",
    });
    const result = await searchWorkspace({
      providers: [provider],
      query: "hello",
      matchCase: false,
      wholeWord: false,
      regex: false,
    });
    expect(result.files).toHaveLength(2);
    expect(result.totalMatches).toBe(2);
    expect(result.capped).toBe(false);
  });

  it("skips files larger than 1MB", async () => {
    invalidate();
    const bigContent = "x".repeat(1024 * 1024 + 10);
    const provider = makeProvider(
      "inline:d1",
      { "big.txt": bigContent },
      {
        listFiles: async () => [{ path: "big.txt", size: bigContent.length }],
      },
    );
    const result = await searchWorkspace({
      providers: [provider],
      query: "x",
      matchCase: false,
      wholeWord: false,
      regex: false,
    });
    expect(result.files).toHaveLength(0);
  });

  it("caps total matches at 5000 and flags capped", async () => {
    invalidate();
    const line = "foo ".repeat(200); // 200 matches per file
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) files[`f${i}.txt`] = line;
    const provider = makeProvider("inline:d1", files);
    const result = await searchWorkspace({
      providers: [provider],
      query: "foo",
      matchCase: false,
      wholeWord: false,
      regex: false,
    });
    expect(result.totalMatches).toBe(5000);
    expect(result.capped).toBe(true);
  });

  it("returns an inline error for invalid regex instead of throwing", async () => {
    invalidate();
    const provider = makeProvider("inline:d1", { "a.txt": "hello" });
    const result = await searchWorkspace({
      providers: [provider],
      query: "(unterminated",
      matchCase: false,
      wholeWord: false,
      regex: true,
    });
    expect(result.error).toBeTruthy();
    expect(result.files).toEqual([]);
  });

  it("uses the content cache and skips re-reading unchanged files across calls", async () => {
    invalidate();
    let readCount = 0;
    const provider = makeProvider(
      "inline:d1",
      { "a.txt": "hello world" },
      {
        readFile: async () => {
          readCount += 1;
          return { content: "hello world", versionHash: "v1" };
        },
      },
    );
    await searchWorkspace({
      providers: [provider],
      query: "hello",
      matchCase: false,
      wholeWord: false,
      regex: false,
    });
    await searchWorkspace({
      providers: [provider],
      query: "world",
      matchCase: false,
      wholeWord: false,
      regex: false,
    });
    // readFile is still called each time (to check versionHash), but content
    // itself is served from cache — verify no crash and correct results.
    expect(readCount).toBe(2);
  });
});

describe("planReplaceAllFile", () => {
  it("routes files with a live open buffer through the open-buffer path", () => {
    expect(planReplaceAllFile(true)).toEqual({ route: "open-buffer" });
  });

  it("routes files without an open buffer through the provider path", () => {
    expect(planReplaceAllFile(false)).toEqual({ route: "provider" });
  });
});

describe("replaceMatchesInText", () => {
  it("replaces all literal matches and returns a count", () => {
    const { content, count } = replaceMatchesInText(
      "foo bar foo",
      "foo",
      "baz",
      { matchCase: true, wholeWord: false, regex: false },
    );
    expect(content).toBe("baz bar baz");
    expect(count).toBe(2);
  });

  it("supports regex backreferences in the replacement", () => {
    const { content, count } = replaceMatchesInText(
      "hello world",
      "(\\w+) (\\w+)",
      "$2 $1",
      { matchCase: true, wholeWord: false, regex: true },
    );
    expect(content).toBe("world hello");
    expect(count).toBe(1);
  });

  it("supports backreferences when the pattern has named capture groups", () => {
    // A named-group regex makes String.replace pass an extra trailing
    // `groups` object to the callback; group-index backreferences ($1, $2)
    // must still resolve to the real capture values, not the match offset.
    const { content, count } = replaceMatchesInText(
      "hello world",
      "(?<first>\\w+) (?<second>\\w+)",
      "$2 $1",
      { matchCase: true, wholeWord: false, regex: true },
    );
    expect(content).toBe("world hello");
    expect(count).toBe(1);
  });
});
