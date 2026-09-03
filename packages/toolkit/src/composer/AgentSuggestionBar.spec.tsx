// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentSuggestionBar,
  agentSuggestionPrompt,
  normalizeAgentSuggestion,
} from "./AgentSuggestionBar.js";

describe("AgentSuggestionBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("normalizes strings and preserves structured agent suggestions", () => {
    expect(normalizeAgentSuggestion("Explain this", 0)).toEqual({
      id: "suggestion-0-Explain this",
      label: "Explain this",
      prompt: "Explain this",
    });
    expect(
      agentSuggestionPrompt({
        id: "next",
        label: "Review changes",
        prompt: "Review the changes in detail",
      }),
    ).toBe("Review the changes in detail");
  });

  it("renders compact pills and returns the selected structured action", () => {
    const onSelect = vi.fn();
    const suggestion = {
      id: "review",
      label: "Review changes",
      prompt: "Review the changes in detail",
      metadata: { source: "agent" },
    } as const;

    act(() => {
      root.render(
        <AgentSuggestionBar
          ariaLabel="Next actions"
          suggestions={[suggestion, "Explain this"]}
          onSelect={onSelect}
        />,
      );
    });

    const bar = container.querySelector('[data-agent-suggestion-bar="true"]');
    const buttons = container.querySelectorAll("button");
    expect(bar?.getAttribute("aria-label")).toBe("Next actions");
    expect(buttons).toHaveLength(2);
    expect(bar?.className).toContain("py-2");
    expect(buttons[0]?.className).toContain("rounded-full");
    expect(buttons[0]?.className).toContain("whitespace-nowrap");
    expect(buttons[0]?.className).not.toContain("max-w-");
    expect(buttons[0]?.querySelector("span")?.className).not.toContain(
      "truncate",
    );
    expect(buttons[0]?.className).toContain("bg-muted/55");
    expect(
      container.querySelector('[data-agent-suggestion-scroller="true"]')
        ?.className,
    ).not.toContain("mask-image");

    act(() => buttons[0]?.click());
    expect(onSelect).toHaveBeenCalledWith(suggestion);
  });
});
