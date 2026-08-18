import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

vi.mock("./clips-api", () => ({
  callClipsAction: vi.fn(),
}));

import { callClipsAction } from "./clips-api";
import {
  addDictationVocabularyTerm,
  buildDictationInstructions,
  DEFAULT_DICTATION_PREFERENCES,
  listDictationVocabulary,
  loadDictationPreferences,
  normalizeDictationPreferences,
  removeDictationVocabularyTerm,
  saveDictationPreferences,
} from "./dictation-preferences";

describe("mobile dictation preferences", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it("recovers invalid local data to safe defaults", async () => {
    storage.set("agent-native:dictation-preferences:v1", "not-json");
    await expect(loadDictationPreferences()).resolves.toEqual(
      DEFAULT_DICTATION_PREFERENCES,
    );
    expect(
      normalizeDictationPreferences({
        language: "unsafe-locale",
        cleanupStyle: "rewrite-everything",
        customInstructions: 42,
      }),
    ).toEqual(DEFAULT_DICTATION_PREFERENCES);
  });

  it("stores only normalized, non-secret preferences on device", async () => {
    await saveDictationPreferences({
      language: "fr-FR",
      cleanupStyle: "concise",
      customInstructions: `  Keep headings. ${"x".repeat(600)}  `,
    });
    const loaded = await loadDictationPreferences();
    expect(loaded.language).toBe("fr-FR");
    expect(loaded.cleanupStyle).toBe("concise");
    expect(loaded.customInstructions).toHaveLength(500);
  });

  it("builds bounded cleanup guidance with preferred spellings", () => {
    const instructions = buildDictationInstructions(
      {
        language: "en-US",
        cleanupStyle: "light",
        customInstructions: "Keep Builder product names capitalized.",
      },
      [
        {
          id: "vocab_1",
          term: "builder eye oh",
          replacement: "Builder.io",
          usesCount: 2,
        },
        {
          id: "vocab_2",
          term: "Agent Native",
          replacement: "Agent Native",
          usesCount: 4,
        },
      ],
    );
    expect(instructions).toContain("Correct punctuation");
    expect(instructions).toContain(
      "User style preference: Keep Builder product names capitalized.",
    );
    expect(instructions).toContain("builder eye oh -> Builder.io");
    expect(instructions).toContain("Agent Native");
  });
});

describe("mobile personal vocabulary actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists and normalizes vocabulary through the GET action", async () => {
    vi.mocked(callClipsAction).mockResolvedValue({
      vocabulary: [
        {
          id: "vocab_1",
          term: "agent native",
          replacement: "Agent Native",
          usesCount: 3.8,
        },
        { id: "", term: "ignored", replacement: "ignored" },
      ],
    });
    const session = { token: "secret", ownerKey: "owner" };
    await expect(listDictationVocabulary(session)).resolves.toEqual([
      {
        id: "vocab_1",
        term: "agent native",
        replacement: "Agent Native",
        usesCount: 3,
      },
    ]);
    expect(callClipsAction).toHaveBeenCalledWith(
      "list-vocabulary",
      { limit: 100 },
      { method: "GET", session },
    );
  });

  it("adds explicit terms and removes them with the declared methods", async () => {
    vi.mocked(callClipsAction).mockResolvedValue({});
    await addDictationVocabularyTerm("  wispr flow  ", "  Wispr Flow  ");
    await removeDictationVocabularyTerm("vocab_1");
    expect(callClipsAction).toHaveBeenNthCalledWith(1, "add-vocabulary-term", {
      term: "wispr flow",
      replacement: "Wispr Flow",
      confidence: 1,
    });
    expect(callClipsAction).toHaveBeenNthCalledWith(
      2,
      "remove-vocabulary-term",
      { id: "vocab_1" },
      { method: "DELETE" },
    );
  });
});
