import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "../shared/search-query.js";
import {
  correctSearchQueryTypos,
  searchVocabulary,
} from "./_document-search-typo.js";

// Full-width forms of the letters at the given positions.
const widen = (word: string, positions: number[]) =>
  Array.from(word, (letter, index) =>
    positions.includes(index)
      ? String.fromCodePoint(letter.codePointAt(0)! + 0xfee0)
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
