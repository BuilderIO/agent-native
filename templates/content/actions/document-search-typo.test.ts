import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "../shared/search-query.js";
import {
  correctSearchQueryTypos,
  hasCorrectableWord,
  searchVocabulary,
  TYPO_VOCABULARY_LIMIT,
} from "./_document-search-typo.js";

// Full-width forms of the letters at the given positions.
const widen = (word: string, positions: number[]) =>
  Array.from(word, (letter, index) =>
    positions.includes(index)
      ? String.fromCodePoint((letter.codePointAt(0) ?? 0) + 0xfee0)
      : letter,
  ).join("");

describe("typo pass vocabulary", () => {
  it("keeps each word's stored spellings, at most three", () => {
    const vocabulary = searchVocabulary([
      "ｇａｚｅｂｏ",
      "ⓖⓐⓩⓔⓑⓞ",
      "caféteria",
      widen("gazebo", [0]),
      widen("gazebo", [1]),
      "gazebo",
    ]);

    expect(vocabulary.get("gazebo")).toEqual([
      "ｇａｚｅｂｏ",
      "ⓖⓐⓩⓔⓑⓞ",
      widen("gazebo", [0]),
    ]);
    expect(vocabulary.get("caféteria")).toEqual(["caféteria"]);
  });

  it("reads at most the vocabulary limit, even from one stored word", () => {
    // The database splits only at spaces and ASCII punctuation.
    const words = Array.from(
      { length: TYPO_VOCABULARY_LIMIT + 10_000 },
      (_, index) => `w${index}`,
    );

    const vocabulary = searchVocabulary([words.join("—")]);
    expect(vocabulary.size).toBe(TYPO_VOCABULARY_LIMIT);
    expect(vocabulary.has("w0")).toBe(true);
    expect(vocabulary.has(`w${TYPO_VOCABULARY_LIMIT}`)).toBe(false);
  });

  it("keeps each of two mistyped words as typed while correcting the other", () => {
    const corrected = correctSearchQueryTypos(
      parseSearchQuery("lantren-harbro"),
      searchVocabulary(["lantern", "harbor"]),
    );

    expect(corrected?.query.groups[0]?.terms.map(({ text }) => text)).toEqual([
      "lantren-harbro",
      "lantern-harbor",
      "lantern-harbro",
      "lantren-harbor",
    ]);
  });

  it("keeps full corrections ahead of words kept as typed", () => {
    // Five close words for each mistyped word: 25 full corrections, 20 kept.
    const corrected = correctSearchQueryTypos(
      parseSearchQuery("zats-zogs"),
      searchVocabulary([
        "bats cats hats mats rats",
        "dogs hogs jogs logs togs",
      ]),
    );

    const texts = corrected?.query.groups[0]?.terms.map(({ text }) => text);
    expect(texts).toHaveLength(21);
    expect(texts).toContain("mats-logs");
    expect(texts?.slice(1).filter((text) => /zats|zogs/.test(text))).toEqual(
      [],
    );
  });

  it("reads the vocabulary only when a word is long enough to correct", () => {
    for (const query of ['"billng v2"', "bil q3", "-roadmpa"]) {
      expect(hasCorrectableWord(parseSearchQuery(query)), query).toBe(false);
    }
    for (const query of ["billng", "q3-roadmpa", '"v2 spec" roadmpa,']) {
      expect(hasCorrectableWord(parseSearchQuery(query)), query).toBe(true);
    }
  });

  it("bounds the alternatives a mistyped term gains", () => {
    // Six close words, each stored in five spellings.
    const vocabulary = searchVocabulary(
      ["gazebo", "gazeboa", "gazebob", "gazeboc", "gazebod", "gazeboe"].flatMap(
        (word) => [word, ...[0, 1, 2, 3].map((at) => widen(word, [at]))],
      ),
    );

    for (const query of ["gazbeo", "pre-gazbeo-gazbeo"]) {
      const corrected = correctSearchQueryTypos(
        parseSearchQuery(query),
        vocabulary,
      );
      expect(corrected?.query.groups[0]?.terms, query).toHaveLength(21);
    }
  });
});
