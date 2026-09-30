import { describe, expect, it } from "vitest";

import {
  anyOfTsquery,
  buildSearchVector,
  documentTokens,
  isPhraseTerm,
  normalizeSearchText,
  queryLexemes,
  termTsquery,
} from "./tokenize.js";

const lexemes = (text: string) =>
  documentTokens(text).tokens.map(
    (token) => `${token.lexeme}@${token.position}`,
  );

describe("search tokens", () => {
  it("lowercases and splits on anything that isn't a letter, number, or mark", () => {
    expect(lexemes("Q3 Roadmap: ship-it_now")).toEqual([
      "q3@1",
      "roadmap@2",
      "ship@3",
      "it@4",
      "now@5",
    ]);
  });

  it("splits URLs and paths into consecutive parts", () => {
    expect(queryLexemes("docs.example.com/api/v2")).toEqual([
      "docs",
      "example",
      "com",
      "api",
      "v2",
    ]);
  });

  it("indexes a camelCase word whole and as parts, at both ends", () => {
    expect(lexemes("use searchIndexState now")).toEqual([
      "use@1",
      "search@2",
      "index@3",
      "state@4",
      "searchindexstate@2",
      "searchindexstate@4",
      "now@5",
    ]);
    expect(lexemes("HTTPServer")).toEqual([
      "http@1",
      "server@2",
      "httpserver@1",
      "httpserver@2",
    ]);
  });

  it("never splits a query word on case", () => {
    expect(queryLexemes("searchIndexState")).toEqual(["searchindexstate"]);
  });

  it("turns Chinese, Japanese, and Korean runs into overlapping pairs", () => {
    expect(queryLexemes("オンボーディング")).toEqual([
      "オン",
      "ンボ",
      "ボー",
      "ーデ",
      "ディ",
      "ィン",
      "ング",
    ]);
    expect(queryLexemes("日")).toEqual(["日"]);
    expect(lexemes("Q3の計画")).toEqual(["q3@1", "の計@2", "計画@3"]);
  });

  it("applies NFKC so full-width text matches", () => {
    expect(queryLexemes("Ｑ３")).toEqual(["q3"]);
    expect(normalizeSearchText("  Ｑ３   Roadmap ")).toBe("q3 roadmap");
  });

  it("keeps accents, with no stemming or stopwords", () => {
    expect(queryLexemes("Política de reembolsos")).toEqual([
      "política",
      "de",
      "reembolsos",
    ]);
  });
});

describe("tsvector literals", () => {
  it("shares one position space across weighted fields", () => {
    expect(
      buildSearchVector([
        { text: "Roadmap", weight: "A" },
        { text: "", weight: "B" },
        { text: "the roadmap", weight: "C" },
      ]),
    ).toEqual({
      literal: "'roadmap':1A,3C 'the':2C",
      positionsComplete: true,
    });
  });

  it("caps positions per word and says so", () => {
    const vector = buildSearchVector([
      { text: "word ".repeat(400), weight: "C" },
    ]);
    expect(vector.literal.split(",")).toHaveLength(255);
    expect(vector.positionsComplete).toBe(false);
  });

  it("says so when a document runs past the last position", () => {
    const words = Array.from({ length: 16_400 }, (_, index) => `w${index}`);
    const vector = buildSearchVector([{ text: words.join(" "), weight: "C" }]);
    expect(vector.literal).toContain("'w16399':16383C");
    expect(vector.positionsComplete).toBe(false);
  });

  it("quotes lexemes safely", () => {
    // Words never contain quotes, so this is belt and braces.
    expect(buildSearchVector([{ text: "it's", weight: "D" }]).literal).toBe(
      "'it':1D 's':2D",
    );
  });
});

describe("tsquery literals", () => {
  it("makes a single word a prefix", () => {
    expect(termTsquery("Prio", { prefix: true })).toBe("'prio':*");
  });

  it("makes a multi-word term a phrase with a prefix last word", () => {
    expect(termTsquery("just-in-time", { prefix: true })).toBe(
      "'just' <-> 'in' <-> 'time':*",
    );
  });

  it("matches words in any order when asked, once each", () => {
    expect(
      termTsquery("quoted-phrase-quoted-phrase", {
        prefix: true,
        anyOrder: true,
      }),
    ).toBe("'quoted' & 'phrase' & 'phrase':*");
    expect(isPhraseTerm("just-in-time")).toBe(true);
    expect(isPhraseTerm("roadmap")).toBe(false);
  });

  it("restricts weights", () => {
    expect(termTsquery("webhook retries", { prefix: true, weights: "C" })).toBe(
      "'webhook':C <-> 'retries':*C",
    );
  });

  it("returns null for a term with nothing to match", () => {
    expect(termTsquery("!!!")).toBeNull();
    expect(anyOfTsquery([null, null])).toBeNull();
  });

  it("joins alternatives", () => {
    expect(anyOfTsquery(["'a':*", null, "'b' <-> 'c'"])).toBe(
      "('a':*) | ('b' <-> 'c')",
    );
  });
});
