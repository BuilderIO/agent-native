// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDynamicAgentSuggestions,
  mergeAgentSuggestions,
  normalizeAgentDynamicSuggestionsConfig,
  useAgentDynamicSuggestionsResult,
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

function SuggestionsProbe() {
  const result = useAgentDynamicSuggestionsResult({
    staticSuggestions: ["Static prompt"],
  });
  return React.createElement("div", {
    "data-testid": "suggestions-probe",
    "data-loading": String(result.isLoading),
    "data-suggestions": (result.suggestions ?? []).join("|"),
  });
}

describe("useAgentDynamicSuggestionsResult", () => {
  let container: HTMLDivElement;
  let root: Root;
  let releaseFetches: () => void;
  let fetchGate: Promise<void>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchGate = new Promise((resolve) => {
      releaseFetches = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => fetchGate.then(() => new Response("", { status: 204 }))),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    releaseFetches();
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function probe() {
    const node = container.querySelector("[data-testid='suggestions-probe']");
    if (!(node instanceof HTMLElement)) {
      throw new Error("suggestions probe did not render");
    }
    return node;
  }

  it("reports loading until the initial app-state suggestion read finishes", async () => {
    act(() => {
      root.render(React.createElement(SuggestionsProbe));
    });

    expect(probe().dataset.loading).toBe("true");
    expect(probe().dataset.suggestions).toBe("");

    await act(async () => {
      releaseFetches();
      await fetchGate;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(probe().dataset.loading).toBe("false");
    expect(probe().dataset.suggestions).toBe("Static prompt");
  });
});
