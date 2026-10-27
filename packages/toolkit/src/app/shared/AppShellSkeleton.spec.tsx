// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShellSkeleton } from "./AppShellSkeleton.js";

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
});
