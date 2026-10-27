// @vitest-environment happy-dom

import { IconHome } from "@tabler/icons-react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AppShellSkeleton } from "./AppShellSkeleton.js";
import type { AppShellFirstPaintHome } from "./AppShellSkeleton.js";

function render(layout: Parameters<typeof AppShellSkeleton>[0]["layout"]) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <AppShellSkeleton layout={layout} />,
  );
  return container.querySelector<HTMLElement>(
    "[data-agent-native-app-skeleton]",
  )!;
}

describe("AppShellSkeleton home layout", () => {
  it("paints the home hero and resource footer beside the sidebar, with no header row", () => {
    const shell = render("home");

    expect(shell.dataset.agentNativeAppSkeletonLayout).toBe("home");
    expect(
      shell.querySelector("[data-agent-native-app-skeleton-sidebar]"),
    ).not.toBeNull();
    expect(shell.querySelector("header")).toBeNull();

    const hero = shell.querySelector<HTMLElement>(
      "[data-agent-native-app-skeleton-home-hero]",
    );
    expect(hero?.style.justifyContent).toBe("center");
    // Mark, title, two lead lines, composer and hint.
    expect(
      hero?.querySelectorAll("[data-agent-native-skeleton-block]"),
    ).toHaveLength(6);

    const footer = shell.querySelector<HTMLElement>(
      "[data-agent-native-app-skeleton-home-footer]",
    );
    expect(footer?.children).toHaveLength(2);
    expect(
      [...(footer?.children ?? [])].map(
        (column) =>
          column.querySelectorAll("[data-agent-native-skeleton-block]").length,
      ),
    ).toEqual([6, 4]);
  });

  it("keeps the assistant layout distinct from home", () => {
    const shell = render("assistant");

    expect(shell.dataset.agentNativeAppSkeletonLayout).toBe("assistant");
    expect(
      shell.querySelector("[data-agent-native-app-skeleton-home-hero]"),
    ).toBeNull();
  });

  it("shows the prompt and suggestions immediately while skeletonizing only the library", () => {
    const firstPaintHome: AppShellFirstPaintHome = {
      appId: "design",
      appName: "Design",
      pageTitle: "Home",
      headerHeight: 56,
      headerActionWidths: [108, 32],
      promptTitle: "What would you like to design?",
      promptPlaceholder: "Describe your design",
      suggestedPromptsLabel: "Suggested prompts",
      sidebarItems: [{ label: "Home", to: "/home", icon: IconHome }],
      sidebarGettingStartedSteps: 5,
      templatesLabel: "Templates",
      recentLabel: "Recent",
      browseAllLabel: "Browse all",
      skipPromptLabel: "Skip prompt",
      suggestionSeed: 123,
      reserveConnectionBar: true,
      suggestions: [
        { id: "one", label: "Build a portfolio", prompt: "Build a portfolio" },
        {
          id: "two",
          label: "Create a dashboard",
          prompt: "Create a dashboard",
        },
        { id: "three", label: "Design a shop", prompt: "Design a shop" },
      ],
    };
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <MemoryRouter>
        <AppShellSkeleton
          layout="prompt-library"
          firstPaintHome={firstPaintHome}
        />
      </MemoryRouter>,
    );
    const shell = container.querySelector<HTMLElement>(
      "[data-agent-native-app-skeleton]",
    )!;

    expect(shell.getAttribute("role")).toBeNull();
    expect(shell.querySelector("textarea")?.placeholder).toBe(
      "Describe your design",
    );
    expect(shell.querySelectorAll("[data-home-suggestion-id]")).toHaveLength(3);
    expect(
      shell
        .querySelector("[data-agent-suggestion-bar]")
        ?.getAttribute("data-home-suggestion-seed"),
    ).toBe("123");
    expect(
      shell.querySelectorAll("[data-agent-native-skeleton-block]"),
    ).not.toHaveLength(0);
    expect(
      shell
        .querySelector(
          '[data-agent-suggestion-bar][aria-label="Suggested prompts"]',
        )
        ?.getAttribute("aria-label"),
    ).toBe("Suggested prompts");
    expect(shell.querySelectorAll('aside nav a[href="/home"]')).toHaveLength(1);
    expect(shell.querySelector("[data-agent-native-icon]")).not.toBeNull();
    expect(shell.textContent).toContain("Skip prompt");
    expect(
      shell.querySelector("[data-prompt-home-connection-skeleton]"),
    ).not.toBeNull();
  });
});
