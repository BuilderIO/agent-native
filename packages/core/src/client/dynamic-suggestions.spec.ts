import { describe, expect, it } from "vitest";
import {
  buildDynamicAgentSuggestions,
  mergeAgentSuggestions,
  normalizeAgentDynamicSuggestionsConfig,
} from "./dynamic-suggestions.js";

describe("buildDynamicAgentSuggestions", () => {
  it("prioritizes selection-aware suggestions", () => {
    expect(
      buildDynamicAgentSuggestions({
        navigation: { view: "document", documentId: "doc-1" },
        selection: { text: "Selected paragraph" },
        pendingSelection: null,
        url: null,
      }).slice(0, 2),
    ).toEqual(["Summarize this selection", "Rewrite this selection"]);
  });

  it("uses slide navigation details when present", () => {
    expect(
      buildDynamicAgentSuggestions({
        navigation: { view: "editor", deckId: "deck-1", slideNumber: 3 },
        selection: null,
        pendingSelection: null,
        url: null,
      }),
    ).toContain("Improve slide 3");
  });

  it("handles zero-based slide indexes", () => {
    expect(
      buildDynamicAgentSuggestions({
        navigation: { view: "editor", deckId: "deck-1", slideIndex: 0 },
        selection: null,
        pendingSelection: null,
        url: null,
      }),
    ).toContain("Improve slide 1");
  });

  it("uses chat scope labels for scoped resources", () => {
    expect(
      buildDynamicAgentSuggestions({
        navigation: { view: "editor", deckId: "deck-1" },
        selection: null,
        pendingSelection: null,
        url: null,
        scope: { type: "deck", id: "deck-1", label: "Q3 Board Update" },
      }),
    ).toEqual(
      expect.arrayContaining([
        "Summarize this Q3 Board Update",
        "Improve this Q3 Board Update",
      ]),
    );
  });

  it("does not add generic suggestions without screen context", () => {
    expect(
      buildDynamicAgentSuggestions({
        navigation: null,
        selection: null,
        pendingSelection: null,
        url: null,
      }),
    ).toEqual([]);
  });
});

describe("mergeAgentSuggestions", () => {
  it("dedupes dynamic and static suggestions before applying the max", () => {
    expect(
      mergeAgentSuggestions({
        dynamicSuggestions: ["Draft a reply", "Summarize this thread"],
        staticSuggestions: ["Draft a reply", "Search my inbox"],
        includeStatic: true,
        max: 3,
      }),
    ).toEqual(["Draft a reply", "Summarize this thread", "Search my inbox"]);
  });

  it("preserves the existing static list when no dynamic suggestions are available", () => {
    expect(
      mergeAgentSuggestions({
        dynamicSuggestions: [],
        staticSuggestions: [
          "Summarize my inbox",
          "Draft a reply",
          "Search my inbox",
          "Plan my day",
          "Find action items",
        ],
        includeStatic: true,
        max: 3,
      }),
    ).toEqual([
      "Summarize my inbox",
      "Draft a reply",
      "Search my inbox",
      "Plan my day",
      "Find action items",
    ]);
  });
});

describe("normalizeAgentDynamicSuggestionsConfig", () => {
  it("keeps dynamic suggestions enabled by default", () => {
    expect(normalizeAgentDynamicSuggestionsConfig()).toMatchObject({
      enabled: true,
      max: 4,
      includeStatic: true,
    });
  });

  it("supports disabling dynamic suggestions", () => {
    expect(normalizeAgentDynamicSuggestionsConfig(false)).toMatchObject({
      enabled: false,
      includeStatic: true,
    });
  });
});
