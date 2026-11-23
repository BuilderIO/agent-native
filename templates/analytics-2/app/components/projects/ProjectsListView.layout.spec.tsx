// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@/lib/model/contracts";

import { ANALYTICS_CONTROL_IDS } from "../../../shared/analytics-control-ids";
import { capabilityDecisionSchema } from "../../../shared/capabilities";
import {
  ProjectsListView,
  WORKSPACE_PAGE_LAYOUT_KEY,
  type ProjectsListViewProps,
} from "./ProjectsListView";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const user = { name: "QA Reviewer", email: "qa@workspace.test" };

const FIXTURE: (Project & { creatorEmail: string | null })[] = [
  {
    id: "fixture-project-1",
    ownerEmail: user.email,
    creatorEmail: "creator@example.test",
    title: "Fixture project 1",
    description: "Fixture description",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: new Date(NOW).toISOString(),
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const storage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key]! : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

function render(overrides: Partial<ProjectsListViewProps> = {}) {
  act(() => {
    root?.render(
      <ProjectsListView
        status="ready"
        projects={FIXTURE}
        currentUser={user}
        search=""
        onSearchChange={() => {}}
        onCreateProject={() => {}}
        fixture="fixture"
        now={NOW}
        {...overrides}
      />,
    );
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Projects card layout toggle", () => {
  it("uses the scoped list decision for the App views header and sort option", () => {
    const projects = FIXTURE.map((project) => ({ ...project, appViews: 5 }));
    const sort = () =>
      container?.querySelector<HTMLButtonElement>(
        'button[aria-label^="Sort by:"]',
      );
    const hasHeader = () =>
      [...document.querySelectorAll("th")].some(
        (header) => header.textContent === "App views",
      );
    const hasSort = () =>
      [...document.querySelectorAll('[role="menuitemradio"]')].some(
        (item) => item.textContent === "App views",
      );

    render({ projects, columnCapabilities: [] });
    act(() => sort()?.click());
    expect(hasHeader()).toBe(false);
    expect(hasSort()).toBe(false);
    render({
      projects,
      columnCapabilities: [
        capabilityDecisionSchema.parse({
          controlId: ANALYTICS_CONTROL_IDS.projectAppViews,
          scope: { kind: "workspace", workspaceId: "workspace" },
          status: "allowed",
          target: { kind: "action", actionName: "list-projects" },
        }),
      ],
    });
    expect(hasHeader()).toBe(true);
    expect(hasSort()).toBe(true);
    expect(container?.querySelector("tbody")?.textContent).toContain("5");
  });

  it("keeps unavailable columns unchecked, disabled and out of the table", () => {
    render();
    const display = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Display settings"]',
    );
    expect(display).toBeDefined();
    act(() => display?.click());
    for (const name of ["App views", "Your access", "Shared with"]) {
      const option = [...document.querySelectorAll("label")].find((label) =>
        label.textContent?.startsWith(name),
      );
      const checkbox = option?.querySelector("input");
      expect(checkbox?.checked, name).toBe(false);
      expect(checkbox?.disabled, name).toBe(true);
      expect(
        [...document.querySelectorAll("th")].some(
          (header) => header.textContent?.trim() === name,
        ),
      ).toBe(false);
    }
  });

  it("shows the recorded creator when the hidden Creator column is enabled", () => {
    render();
    const display = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Display settings"]',
    );
    expect(display).not.toBeNull();
    act(() => display!.click());
    const option = [...container!.querySelectorAll("label")].find(
      (label) => label.textContent?.trim() === "Creator",
    );
    const checkbox = option?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox?.disabled).toBe(false);
    act(() => checkbox!.click());
    expect(
      container!.querySelector('tr[data-project-id="fixture-project-1"]')
        ?.textContent,
    ).toContain("creator@example.test");
  });
  it("renders the card grid when the card toggle is pressed and persists the choice", () => {
    render();
    expect(container!.querySelector(".ws-projects-card-grid")).toBeNull();
    expect(container!.querySelector(".ws-projects-table")).not.toBeNull();

    const cardToggle = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch to card view"]',
    );
    expect(cardToggle).not.toBeNull();
    act(() => {
      cardToggle!.click();
    });

    expect(container!.querySelector(".ws-projects-table")).toBeNull();
    const grid = container!.querySelector(".ws-projects-card-grid");
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll(".ws-projects-card")).toHaveLength(
      FIXTURE.length,
    );
    expect(window.localStorage.getItem(WORKSPACE_PAGE_LAYOUT_KEY)).toBe("card");
  });

  it("starts in the stored card layout and returns to the list view", () => {
    window.localStorage.setItem(WORKSPACE_PAGE_LAYOUT_KEY, "card");
    render();
    expect(container!.querySelector(".ws-projects-card-grid")).not.toBeNull();

    const listToggle = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch to table view"]',
    );
    expect(listToggle).not.toBeNull();
    act(() => {
      listToggle!.click();
    });

    expect(container!.querySelector(".ws-projects-table")).not.toBeNull();
    expect(container!.querySelector(".ws-projects-card-grid")).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_PAGE_LAYOUT_KEY)).toBe("list");
  });
});
