import { describe, expect, it } from "vitest";

import {
  buildFigmaNodeCandidates,
  extractVisibleTexts,
  matchFigmaClipboardNodes,
  type FigmaNodeCandidate,
} from "./figma-clipboard-match.js";

describe("extractVisibleTexts", () => {
  it("strips tags and returns distinct trimmed text lines", () => {
    expect(
      extractVisibleTexts(
        "<div><span>Hero</span><p>Sign up today</p><span>Hero</span></div>",
      ),
    ).toEqual(["Hero", "Sign up today"]);
  });

  it("decodes common HTML entities", () => {
    expect(extractVisibleTexts("<p>Terms &amp; Conditions</p>")).toEqual([
      "Terms & Conditions",
    ]);
  });

  it("drops script/style content and empty lines", () => {
    expect(
      extractVisibleTexts(
        "<style>.a{color:red}</style><div>  </div><p>Real text</p><script>evil()</script>",
      ),
    ).toEqual(["Real text"]);
  });

  it("returns an empty array for empty/undefined input", () => {
    expect(extractVisibleTexts("")).toEqual([]);
    expect(extractVisibleTexts(undefined)).toEqual([]);
    expect(extractVisibleTexts(null)).toEqual([]);
  });
});

describe("buildFigmaNodeCandidates", () => {
  it("collects one candidate per top-level frame across all pages, with direct-children text", () => {
    const document = {
      children: [
        {
          id: "page-1",
          children: [
            {
              id: "1:1",
              name: "Hero",
              children: [{ id: "1:2", name: "Title", characters: "Welcome" }],
            },
          ],
        },
        {
          id: "page-2",
          children: [{ id: "2:1", name: "Footer", children: [] }],
        },
      ],
    };
    expect(buildFigmaNodeCandidates(document)).toEqual([
      { id: "1:1", name: "Hero", texts: ["Welcome"] },
      { id: "2:1", name: "Footer", texts: [] },
    ]);
  });

  it("ignores frames with no id and tolerates a missing document", () => {
    expect(buildFigmaNodeCandidates(undefined)).toEqual([]);
    expect(
      buildFigmaNodeCandidates({
        children: [{ id: "page-1", children: [{ name: "No id" }] }],
      }),
    ).toEqual([]);
  });
});

describe("matchFigmaClipboardNodes", () => {
  const candidate = (
    id: string,
    name: string,
    texts: string[] = [],
  ): FigmaNodeCandidate => ({ id, name, texts });

  it("matches a single candidate whose name appears verbatim in the clipboard text", () => {
    const result = matchFigmaClipboardNodes(
      [candidate("1:1", "Hero"), candidate("1:2", "Footer")],
      ["Hero", "Sign up today"],
    );
    expect(result).toEqual({
      status: "matched",
      matches: [{ id: "1:1", name: "Hero", reason: "name" }],
    });
  });

  it("matches multiple candidates for a multi-select copy (several frames named in the clipboard)", () => {
    const result = matchFigmaClipboardNodes(
      [
        candidate("1:1", "Header"),
        candidate("1:2", "Footer"),
        candidate("1:3", "Sidebar"),
      ],
      ["Header", "Footer"],
    );
    expect(result.status).toBe("matched");
    expect(result.matches.map((m) => m.id).sort()).toEqual(["1:1", "1:2"]);
    expect(result.matches.every((m) => m.reason === "name")).toBe(true);
  });

  it("is case/whitespace-insensitive when matching names", () => {
    const result = matchFigmaClipboardNodes(
      [candidate("1:1", "  Hero Section  ")],
      ["hero section"],
    );
    expect(result.status).toBe("matched");
    expect(result.matches[0]!.id).toBe("1:1");
  });

  it("falls back to text-content matching when no candidate name matches", () => {
    const result = matchFigmaClipboardNodes(
      [
        candidate("1:1", "Frame 12", ["Welcome back", "Sign in"]),
        candidate("1:2", "Frame 13", ["Pricing", "$9/mo"]),
      ],
      ["Welcome back", "Sign in"],
    );
    expect(result).toEqual({
      status: "matched",
      matches: [{ id: "1:1", name: "Frame 12", reason: "text" }],
    });
  });

  it("requires at least two distinct text overlaps before trusting a text-only match", () => {
    const result = matchFigmaClipboardNodes(
      [candidate("1:1", "Frame 12", ["Welcome back"])],
      ["Welcome back"],
    );
    expect(result).toEqual({ status: "none", matches: [] });
  });

  it("is ambiguous when two candidates both clear the text-match bar", () => {
    const result = matchFigmaClipboardNodes(
      [
        candidate("1:1", "Frame 12", ["Welcome back", "Sign in"]),
        candidate("1:2", "Frame 13", ["Welcome back", "Sign in"]),
      ],
      ["Welcome back", "Sign in"],
    );
    expect(result).toEqual({ status: "ambiguous", matches: [] });
  });

  it("is ambiguous (not matched) when name matches exceed the multi-match cap", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      candidate(`1:${i}`, `Frame ${i}`),
    );
    const result = matchFigmaClipboardNodes(
      many,
      many.map((c) => c.name),
    );
    expect(result).toEqual({ status: "ambiguous", matches: [] });
  });

  it("returns none when nothing overlaps at all", () => {
    const result = matchFigmaClipboardNodes(
      [candidate("1:1", "Hero", ["Welcome"])],
      ["Totally unrelated copy", "Nothing matches"],
    );
    expect(result).toEqual({ status: "none", matches: [] });
  });

  it("returns none for an empty candidate list", () => {
    expect(matchFigmaClipboardNodes([], ["Hero"])).toEqual({
      status: "none",
      matches: [],
    });
  });
});
