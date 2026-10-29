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
    expect(bar?.getAttribute("aria-live")).toBeNull();
    expect(buttons).toHaveLength(2);
    expect(bar?.className).toContain("py-2");
    expect(bar?.className).toContain("min-w-0");
    expect(buttons[0]?.className).toContain("rounded-full");
    expect(buttons[0]?.className).toContain("whitespace-nowrap");
    expect(buttons[0]?.className).not.toContain("max-w-");
    expect(buttons[0]?.className).toContain("text-foreground");
    expect(buttons[0]?.className).not.toContain("text-foreground/80");
    expect(buttons[0]?.className).toContain("border-border");
    expect(buttons[0]?.className).toContain("hover:bg-accent");
    expect(buttons[0]?.className).toContain("focus-visible:ring-inset");
    expect(buttons[0]?.querySelector("span")?.className).not.toContain(
      "truncate",
    );
    expect(buttons[0]?.className).toContain("bg-transparent");
    expect(buttons[0]?.className).not.toContain("bg-muted/55");
    const scroller = container.querySelector(
      '[data-agent-suggestion-scroller="true"]',
    );
    expect(scroller?.className).toContain("min-w-0");
    expect(scroller?.className).not.toContain("mask-image");

    act(() => buttons[0]?.click());
    expect(onSelect).toHaveBeenCalledWith(suggestion);
  });

  it("keeps tracked home suggestions as centered compact chips and reports clicks", () => {
    const onSelect = vi.fn();
    const onHomeSuggestionClick = vi.fn();
    act(() => {
      root.render(
        <AgentSuggestionBar
          ariaLabel="Suggested prompts"
          suggestions={[
            { id: "first", label: "First prompt", prompt: "Build the first" },
            {
              id: "second",
              label: "Second prompt",
              prompt: "Build the second in full",
            },
          ]}
          homeTracking={{ appId: "design", role: "marketing" }}
          onHomeSuggestionClick={onHomeSuggestionClick}
          layout="single-line"
          onSelect={onSelect}
        />,
      );
    });

    const buttons = container.querySelectorAll("button");
    expect(
      container
        .querySelector('[data-agent-suggestion-bar="true"]')
        ?.getAttribute("data-home-suggestion-app-id"),
    ).toBe("design");
    expect(buttons[1]?.getAttribute("data-agent-suggestion-position")).toBe(
      "2",
    );
    expect(buttons[1]?.getAttribute("data-home-suggestion-id")).toBe("second");
    const track = container.querySelector<HTMLElement>(
      '[data-agent-suggestion-track="true"]',
    );
    expect(track?.className).toContain("h-6");
    expect(track?.className).toContain("w-max");
    expect(track?.className).toContain("flex-nowrap");
    expect(track?.className).toContain("items-center");
    expect(track?.className).not.toContain("flex-wrap");
    expect(buttons[1]?.className).toContain("h-6");
    expect(buttons[1]?.className).toContain("px-2.5");
    expect(buttons[1]?.className).toContain("text-center");
    expect(buttons[1]?.className).toContain("whitespace-nowrap");
    expect(buttons[1]?.className).toContain("justify-center");
    expect(buttons[1]?.querySelector("span")?.textContent).toBe(
      "Second prompt",
    );
    act(() => buttons[1]?.click());

    expect(onHomeSuggestionClick).toHaveBeenCalledExactlyOnceWith({
      appId: "design",
      role: "marketing",
      suggestionId: "second",
      position: 2,
    });
    expect(onSelect).toHaveBeenCalledWith({
      id: "second",
      label: "Second prompt",
      prompt: "Build the second in full",
    });
  });

  it("reserves a single row with skeleton chips while suggestions load", () => {
    act(() => {
      root.render(
        <AgentSuggestionBar
          ariaLabel="Suggested prompts"
          suggestions={[]}
          loading
          announceUpdates
          layout="single-line"
          onSelect={() => {}}
        />,
      );
    });

    const bar = container.querySelector<HTMLElement>(
      '[data-agent-suggestion-bar="true"]',
    );
    const track = container.querySelector<HTMLElement>(
      '[data-agent-suggestion-track="true"]',
    );
    expect(bar?.getAttribute("aria-busy")).toBe("true");
    expect(bar?.getAttribute("aria-live")).toBe("polite");
    expect(
      container.querySelectorAll('[data-agent-suggestion-placeholder="true"]'),
    ).toHaveLength(3);
    expect(track?.className).toContain("flex-nowrap");
    expect(track?.className).toContain("h-6");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("keeps requested suggestions on one horizontal row", () => {
    act(() => {
      root.render(
        <AgentSuggestionBar
          ariaLabel="Suggested prompts"
          suggestions={["First", "Second", "Third"]}
          layout="single-line"
          onSelect={() => {}}
        />,
      );
    });

    const track = container.querySelector<HTMLElement>(
      '[data-agent-suggestion-track="true"]',
    );
    expect(track?.className).toContain("flex-nowrap");
    expect(track?.className).toContain("h-6");
  });
});
