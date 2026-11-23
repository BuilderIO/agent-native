// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import type { ProjectListItem } from "./projectList";
import { ProjectsListView } from "./ProjectsListView";

const base: ProjectListItem = {
  id: "prj_listed",
  ownerEmail: "qa@workspace.test",
  title: "Old revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
  lastPublishedAt: null,
};

function render(
  listView: "active" | "archive" | "trash",
  project: ProjectListItem,
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
          projects={[project]}
          currentUser={{ name: "QA", email: "qa@workspace.test" }}
          search=""
          onSearchChange={() => {}}
          onCreateProject={() => {}}
          listView={listView}
          fixture="fixture"
          now={Date.parse("2026-11-08T12:00:00.000Z")}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  return container;
}

const headers = (container: HTMLElement) =>
  [...container.querySelectorAll("thead th")].map((th) =>
    th.textContent.trim(),
  );

it("Trash lists the date each project is permanently deleted, with the retention notice", () => {
  const container = render("trash", {
    ...base,
    trashedAt: "2026-11-08T12:00:00.000Z",
  });
  expect(headers(container)).toEqual([
    "",
    "Title",
    "Permanent deletion",
    "Status",
    "Categories",
    "Last viewed by you",
    "App last published",
  ]);
  expect(container.textContent).toContain(
    "Projects and components that have been in the trash for more than 30 days will be permanently deleted",
  );
  const row = container.querySelector("tbody tr");
  const cells = [...(row?.querySelectorAll("td") ?? [])].map((td) =>
    td.textContent.trim(),
  );
  expect(cells[2]).toBe("Dec 8, 2026");
});

it("Archive lists when each project was archived, in the original's column order", () => {
  const container = render("archive", {
    ...base,
    archivedAt: "2026-11-05T12:00:00.000Z",
  });
  expect(headers(container)).toEqual([
    "",
    "Title",
    "Archived",
    "Owner",
    "Categories",
    "Status",
    "App last published",
  ]);
  const row = container.querySelector("tbody tr");
  const cells = [...(row?.querySelectorAll("td") ?? [])].map((td) =>
    td.textContent.trim(),
  );
  expect(cells[2]).toBe("Nov 5, 2026");
});

it("the active Projects list is unchanged", () => {
  const container = render("active", base);
  expect(headers(container)).not.toContain("Permanent deletion");
  expect(headers(container)).not.toContain("Archived");
  expect(container.textContent).not.toContain("permanently deleted");
});
