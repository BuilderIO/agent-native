// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "./AppSidebar.js";

vi.mock("../FeedbackButton.js", () => ({
  FeedbackButton: () => null,
}));

describe("AppSidebar (router links)", () => {
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

  it("opens a tooltip for every icon on the collapsed rail", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <AppSidebar
            collapsed
            showBadge={false}
            brandName="Slides"
            items={[{ label: "Decks", to: "/home" }]}
            secondaryItems={[{ label: "Settings", to: "/settings" }]}
          />
        </MemoryRouter>,
      );
    });

    const rail = Array.from(
      container.querySelectorAll<HTMLElement>("aside a, aside button"),
    );
    expect(rail.map((element) => element.getAttribute("aria-label"))).toEqual([
      "Slides",
      "Decks",
      "Settings",
      "Expand sidebar",
    ]);

    for (const element of rail) {
      act(() => element.focus());
      const labels = Array.from(
        document.querySelectorAll('[role="tooltip"]'),
      ).map((node) => node.textContent);
      expect(labels).toContain(element.getAttribute("aria-label"));
      act(() => element.blur());
    }
  });
});
