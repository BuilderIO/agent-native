// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18nCatalog } from "@/i18n";

import projectsCss from "./projects.css?raw";
import { ProjectsListView } from "./ProjectsListView";

const user = { name: "Sam Reader", email: "reader@example.test" };

function extractRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css);
  return match?.[1] ?? "";
}

describe("projects list header layout for Trash and Archive", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  const render = (view: "active" | "archive" | "trash") =>
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <ProjectsListView
            status="ready"
            projects={[]}
            currentUser={user}
            search=""
            onSearchChange={() => undefined}
            onCreateProject={() => undefined}
            listView={view}
          />
        </AgentNativeI18nProvider>,
      );
    });

  it.each([
    [
      "trash",
      "Trash",
      "Projects and components that have been in the trash for more than 30 days will be permanently deleted",
    ],
    [
      "archive",
      "Archive",
      "Archive projects and components to declutter a workspace, without losing your work.",
    ],
  ] as const)(
    "keeps %s icon aligned in a dedicated title row above the subtitle",
    (view, expectedTitle, expectedSubtitle) => {
      render(view);
      const heading = host.querySelector("header .ws-projects-heading");
      const titleRow = heading?.querySelector(".ws-projects-heading-row");
      const icon = titleRow?.querySelector(".ws-projects-heading-icon");
      const title = titleRow?.querySelector("h1.ws-projects-title");
      const subtitle = heading?.querySelector(
        ":scope > p.ws-projects-subtitle",
      );

      expect(heading).not.toBeNull();
      expect(titleRow).not.toBeNull();
      expect(icon).not.toBeNull();
      expect(title?.textContent?.trim()).toBe(expectedTitle);
      expect(titleRow?.contains(subtitle ?? null)).toBe(false);
      expect(subtitle?.textContent).toContain(expectedSubtitle);
      expect(host.querySelector(".ws-projects-heading-copy")).toBeNull();
    },
  );

  it("keeps active Projects icon and title in the same heading row with no subtitle", () => {
    render("active");
    const titleRow = host.querySelector(
      "header .ws-projects-heading > .ws-projects-heading-row",
    );
    expect(titleRow?.querySelector(".ws-projects-heading-icon")).not.toBeNull();
    expect(
      titleRow?.querySelector("h1.ws-projects-title")?.textContent?.trim(),
    ).toBe("Projects");
    expect(host.querySelector("header .ws-projects-subtitle")).toBeNull();
  });

  it("defines vertical heading stack, centered title row, and non-cramped subtitle spacing in projects.css", () => {
    const headingRule = extractRuleBlock(
      projectsCss,
      /\.ws-projects-heading\s*\{([^}]*)\}/,
    );
    const headingRowRule = extractRuleBlock(
      projectsCss,
      /\.ws-projects-heading-row\s*\{([^}]*)\}/,
    );
    const subtitleRule = extractRuleBlock(
      projectsCss,
      /\.ws-projects-subtitle\s*\{([^}]*)\}/,
    );
    const narrowMediaBlock = extractRuleBlock(
      projectsCss,
      /@media\s*\(max-width:\s*945px\)\s*\{([\s\S]*?\})\s*\}/,
    );

    expect(headingRule).toMatch(/flex-direction:\s*column/);
    expect(headingRowRule).toMatch(/display:\s*flex/);
    expect(headingRowRule).toMatch(/align-items:\s*center/);
    expect(subtitleRule).toMatch(/margin:\s*12px\s+0\s+0\s+4px/);
    expect(projectsCss).not.toMatch(/\.ws-projects-heading-copy\s*\{/);
    expect(narrowMediaBlock).toContain(
      '.ws-projects[data-list-view="archive"] .ws-projects-header',
    );
    expect(narrowMediaBlock).toContain(
      '.ws-projects[data-list-view="trash"] .ws-projects-header',
    );
  });
});
