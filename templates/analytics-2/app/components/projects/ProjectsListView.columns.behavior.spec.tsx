// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { ProjectListRow } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

const NOW = Date.parse("2026-11-22T12:00:00.000Z");

const currentUser = { name: "QA Reviewer", email: "qa@workspace.test" };

function row(
  overrides: Partial<ProjectListRow> & { id: string },
): ProjectListRow {
  return {
    ownerEmail: currentUser.email,
    ownerName: null,
    creatorEmail: currentUser.email,
    creatorName: null,
    title: overrides.id,
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: "2026-11-22T11:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-22T11:00:00.000Z",
    lastPublishedAt: null,
    yourAccess: "owner",
    sharedWith: { workspace: false, directCount: 0 },
    appViews: null,
    appViewsByDuration: null,
    appLastViewedAt: null,
    ...overrides,
  };
}

const mounted: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  vi.unstubAllGlobals();
});

function mountList(
  projects: ProjectListRow[],
  extra?: Partial<React.ComponentProps<typeof ProjectsListView>>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <ProjectsListView
          status="ready"
          projects={projects}
          currentUser={currentUser}
          search=""
          onSearchChange={() => {}}
          onCreateProject={() => {}}
          fixture="fixture"
          now={NOW}
          {...extra}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  mounted.push({ container, root });
  return { container };
}

function rowIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")].map(
    (tr) => tr.dataset.projectId ?? "",
  );
}

function columnIndex(container: HTMLElement, headerLabel: string): number {
  const headers = [...container.querySelectorAll("thead th")].map((th) =>
    (th.textContent ?? "").trim(),
  );
  return headers.indexOf(headerLabel);
}

function cellText(
  container: HTMLElement,
  projectId: string,
  headerLabel: string,
): string {
  const idx = columnIndex(container, headerLabel);
  if (idx < 0) return "";
  const tr = container.querySelector(
    `tbody tr[data-project-id="${projectId}"]`,
  );
  if (!tr) return "";
  const cells = tr.querySelectorAll("td");
  return (cells[idx]?.textContent ?? "").trim();
}

describe("ProjectsListView column behavior (report 1794901508.878089)", () => {
  it("updates App views cells and App views sorting when Show app views from changes", () => {
    const projects: ProjectListRow[] = [
      row({
        id: "evergreen",
        title: "Evergreen",
        lastPublishedAt: "2026-11-10T00:00:00.000Z",
        appViews: 120,
        appViewsByDuration: {
          ALL_TIME: 120,
          ONE_WEEK: 2,
          TWO_WEEKS: 5,
          ONE_MONTH: 20,
        },
      }),
      row({
        id: "trending",
        title: "Trending",
        lastPublishedAt: "2026-11-18T00:00:00.000Z",
        appViews: 15,
        appViewsByDuration: {
          ALL_TIME: 15,
          ONE_WEEK: 12,
          TWO_WEEKS: 14,
          ONE_MONTH: 15,
        },
      }),
      row({
        id: "draft",
        title: "Draft",
        lastPublishedAt: null,
        appViews: null,
        appViewsByDuration: null,
      }),
    ];

    const { container } = mountList(projects, {
      initialSort: { option: "appViews", direction: "DESC" },
    });

    expect(rowIds(container)).toEqual(["evergreen", "trending", "draft"]);
    expect(cellText(container, "evergreen", "App views")).toBe("120");
    expect(cellText(container, "trending", "App views")).toBe("15");
    expect(cellText(container, "draft", "App views")).toBe("—");

    const displayTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Display settings"]',
    );
    expect(displayTrigger).not.toBeNull();
    act(() => {
      displayTrigger!.click();
    });

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Show app views from"]',
    );
    expect(select).not.toBeNull();

    const changeDuration = (value: string) => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set;
        setter?.call(select!, value);
        select!.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    changeDuration("ONE_WEEK");
    expect(rowIds(container)).toEqual(["trending", "evergreen", "draft"]);
    expect(cellText(container, "trending", "App views")).toBe("12");
    expect(cellText(container, "evergreen", "App views")).toBe("2");
    expect(cellText(container, "draft", "App views")).toBe("—");

    changeDuration("TWO_WEEKS");
    expect(rowIds(container)).toEqual(["trending", "evergreen", "draft"]);
    expect(cellText(container, "trending", "App views")).toBe("14");
    expect(cellText(container, "evergreen", "App views")).toBe("5");

    changeDuration("ONE_MONTH");
    expect(rowIds(container)).toEqual(["evergreen", "trending", "draft"]);
    expect(cellText(container, "evergreen", "App views")).toBe("20");
    expect(cellText(container, "trending", "App views")).toBe("15");
  });

  it("renders resolved member display names for Owner and Creator while falling back to email", () => {
    const projects: ProjectListRow[] = [
      row({
        id: "named",
        title: "Named project",
        ownerEmail: "grace@workspace.test",
        ownerName: "Grace Hopper",
        creatorEmail: "ada@workspace.test",
        creatorName: "Ada Lovelace",
      }),
      row({
        id: "email-only",
        title: "Email only project",
        ownerEmail: "anon@workspace.test",
        ownerName: null,
        creatorEmail: "anon@workspace.test",
        creatorName: null,
      }),
    ];

    const { container } = mountList(projects);

    const displayTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Display settings"]',
    );
    act(() => {
      displayTrigger!.click();
    });
    const creatorLabelNode = [
      ...container.querySelectorAll(".ws-projects-column-option"),
    ].find((label) => (label.textContent ?? "").trim() === "Creator");
    const creatorCheckbox = creatorLabelNode?.querySelector<HTMLInputElement>(
      "input[type=checkbox]",
    );
    expect(creatorCheckbox).not.toBeNull();
    act(() => {
      creatorCheckbox!.click();
    });

    expect(cellText(container, "named", "Owner")).toContain("Grace Hopper");
    expect(cellText(container, "named", "Creator")).toBe("Ada Lovelace");
    const namedOwnerText = container.querySelector(
      'tbody tr[data-project-id="named"] .ws-projects-owner .ws-projects-cell-text',
    );
    expect(namedOwnerText?.getAttribute("title")).toBe("grace@workspace.test");
    const namedAvatar = container.querySelector(
      'tbody tr[data-project-id="named"] .ws-projects-avatar',
    );
    expect(namedAvatar?.textContent).toBe("G");

    expect(cellText(container, "email-only", "Owner")).toContain(
      "anon@workspace.test",
    );
    expect(cellText(container, "email-only", "Creator")).toBe(
      "anon@workspace.test",
    );
  });
});
