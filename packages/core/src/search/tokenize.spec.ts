import { describe, expect, it } from "vitest";

import {
  anyOfTsquery,
  buildSearchVector,
  documentTokens,
  isPhraseTerm,
  normalizeSearchText,
  queryLexemes,
  SearchTermTooLongError,
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
    expect(lexemes("Q3の計画")).toEqual(["q3@1", "の計@2", "計画@3", "画@3"]);
  });

  it("indexes a run's last character alone, so every character starts a lexeme", () => {
    expect(lexemes("新しい 日")).toEqual(["新し@1", "しい@2", "い@2", "日@3"]);
  });

  it("applies NFKC so full-width text matches", () => {
    expect(queryLexemes("Ｑ３")).toEqual(["q3"]);
    expect(normalizeSearchText("  Ｑ３   Roadmap ")).toBe("q3 roadmap");
  });

  it("keeps the longest prefix Postgres accepts of an over-long word", () => {
    const long = "x".repeat(3_000);
    expect(lexemes(`foo ${long} bar`)).toEqual([
      "foo@1",
      `${"x".repeat(2_046)}@2`,
      "bar@3",
    ]);
    expect(queryLexemes(`foo ${long} bar`)).toEqual([
      "foo",
      "x".repeat(2_046),
      "bar",
    ]);
    // Measured in UTF-8 bytes, never splitting a character.
    expect(queryLexemes(`a${"é".repeat(1_100)}`)[0]).toBe(
      `a${"é".repeat(1_022)}`,
    );
    expect(queryLexemes("𐐨".repeat(600))[0]).toBe("𐐨".repeat(511));
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
  it("shares one position space across fields, with a gap between them", () => {
    expect(
      buildSearchVector([
        { text: "Roadmap", weight: "A" },
        { text: "", weight: "B" },
        { text: "the roadmap", weight: "C" },
      ]),
    ).toEqual({
      literal: "'roadmap':1A,4C 'the':3C",
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

  it("keeps a repetitive word's first position in every field", () => {
    const vector = buildSearchVector([
      { text: "Example", weight: "A" },
      { text: "alpha ".repeat(300), weight: "B" },
      { text: "alpha beta", weight: "C" },
    ]);
    const alpha = vector.literal.match(/'alpha':(\S+)/)![1]!.split(",");
    expect(alpha).toHaveLength(255);
    expect(alpha[0]).toBe("3B");
    expect(alpha.at(-1)).toBe("304C");
    expect(vector.positionsComplete).toBe(false);
  });

  it("says so when a document runs past the last position", () => {
    const words = Array.from({ length: 16_400 }, (_, index) => `w${index}`);
    const vector = buildSearchVector([{ text: words.join(" "), weight: "C" }]);
    expect(vector.literal).toContain("'w16399':16383C");
    expect(vector.positionsComplete).toBe(false);
  });

  it("keeps fields apart past the last position", () => {
    // Postgres merges equal positions and keeps the higher weight, so two
    // fields sharing the last position would lose the body's weight.
    const vector = buildSearchVector([
      { text: "Title", weight: "A" },
      { text: `${"filler ".repeat(17_000)}omega`, weight: "B" },
      { text: "omega gamma", weight: "C" },
    ]);
    expect(vector.literal).toContain("'omega':16382B,16383C");
    expect(vector.literal).toContain("'gamma':16383C");
    expect(vector.positionsComplete).toBe(false);
  });

  it("keeps the first words of a document with too many distinct words", () => {
    // About 1.2 MB of distinct words; Postgres rejects a vector whose words
    // alone take 1 MB.
    const words = Array.from(
      { length: 130_000 },
      (_, index) => `w${index.toString(36).padStart(8, "x")}`,
    );
    const vector = buildSearchVector([
      { text: "Title", weight: "A" },
      { text: `title ${words.join(" ")} title`, weight: "C" },
    ]);
    // One position per word in each field, so a phrase in the body can
    // still be told apart from words in the title.
    expect(vector.literal.startsWith("'title':1A,3C 'wxxxxxxx0':4C")).toBe(
      true,
    );
    expect(vector.literal).not.toContain(`'${words.at(-1)}'`);
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

  it("matches a camelCase word inside a phrase whole or by its parts", () => {
    expect(termTsquery("use searchIndexState now", { prefix: true })).toBe(
      "'use' <-> ('searchindexstate' | 'search' <-> 'index' <-> 'state') <-> 'now':*",
    );
    expect(termTsquery("use searchIndexState", { prefix: true })).toBe(
      "'use' <-> ('searchindexstate':* | 'search' <-> 'index' <-> 'state':*)",
    );
    // Alone, the whole word is enough: documents index it.
    expect(termTsquery("searchIndexState", { prefix: true })).toBe(
      "'searchindexstate':*",
    );
  });

  it("refuses a term longer than Postgres can evaluate", () => {
    expect(termTsquery("w ".repeat(2_048))).not.toBeNull();
    expect(() => termTsquery("w ".repeat(2_049))).toThrow(
      SearchTermTooLongError,
    );
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
