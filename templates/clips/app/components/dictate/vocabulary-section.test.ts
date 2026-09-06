import { describe, expect, it, vi } from "vitest";

import {
  MAX_VOCABULARY_IMPORT,
  addVocabularyEntries,
  parseVocabularyEntries,
  serializeVocabularyEntries,
} from "./vocabulary-section";

describe("parseVocabularyEntries", () => {
  it("treats plain lines as preferred spellings", () => {
    expect(parseVocabularyEntries("Agent-Native\nWispr Flow")).toEqual([
      { term: "Agent-Native", replacement: "Agent-Native" },
      { term: "Wispr Flow", replacement: "Wispr Flow" },
    ]);
  });

  it("accepts common correction mapping separators", () => {
    expect(
      parseVocabularyEntries(
        "agentnative → Agent-Native\nwhisper -> Wispr\ngranola => Granola\nclips\tClips",
      ),
    ).toEqual([
      { term: "agentnative", replacement: "Agent-Native" },
      { term: "whisper", replacement: "Wispr" },
      { term: "granola", replacement: "Granola" },
      { term: "clips", replacement: "Clips" },
    ]);
  });

  it("imports an exported CSV with quoted values", () => {
    expect(
      parseVocabularyEntries(
        'term,replacement\nagentnative,Agent-Native\n"hello, clips","Hello, Clips"',
      ),
    ).toEqual([
      { term: "agentnative", replacement: "Agent-Native" },
      { term: "hello, clips", replacement: "Hello, Clips" },
    ]);
  });

  it("imports a TSV with a header", () => {
    expect(
      parseVocabularyEntries(
        "term\treplacement\nagentnative\tAgent-Native\nClips\tClips",
      ),
    ).toEqual([
      { term: "agentnative", replacement: "Agent-Native" },
      { term: "Clips", replacement: "Clips" },
    ]);
  });

  it("trims, rejects incomplete mappings, and de-duplicates terms", () => {
    expect(
      parseVocabularyEntries(
        "  clips  \nCLIPS → Clips App\nmissing ->\n→ replacement",
      ),
    ).toEqual([{ term: "CLIPS", replacement: "Clips App" }]);
  });

  it("caps a single import", () => {
    const draft = Array.from(
      { length: MAX_VOCABULARY_IMPORT + 20 },
      (_, index) => `term-${index}`,
    ).join("\n");

    expect(parseVocabularyEntries(draft)).toHaveLength(MAX_VOCABULARY_IMPORT);
  });
});

describe("serializeVocabularyEntries", () => {
  it("creates a portable CSV that round-trips", () => {
    const entries = [
      { term: "agentnative", replacement: "Agent-Native" },
      { term: "hello, clips", replacement: 'Hello, "Clips"' },
    ];

    expect(parseVocabularyEntries(serializeVocabularyEntries(entries))).toEqual(
      entries,
    );
  });
});

describe("addVocabularyEntries", () => {
  it("imports every parsed entry and reports failures", async () => {
    const addEntry = vi.fn(async (entry: { term: string }) => {
      if (entry.term === "broken") throw new Error("nope");
      return entry.term;
    });
    const entries = parseVocabularyEntries("Clips\nbroken\nAgent-Native");

    await expect(addVocabularyEntries(entries, addEntry)).resolves.toBe(1);
    expect(addEntry).toHaveBeenCalledTimes(3);
  });
});
