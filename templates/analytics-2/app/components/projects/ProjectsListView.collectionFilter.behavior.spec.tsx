// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { ProjectListRow } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

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

function project(id: string, title: string): ProjectListRow {
  return {
    id,
    ownerEmail: "sam@example.test",
    creatorEmail: "sam@example.test",
    title,
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    lastPublishedAt: null,
    appViews: null,
    appLastViewedAt: null,
    yourAccess: "owner",
    sharedWith: { workspace: false, directCount: 0 },
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
  };
}

const PROJECTS = [project("p1", "Alpha plan"), project("p2", "Beta plan")];
const COLLECTION = { id: "c1", name: "Planning" };
const FILTER_OPTIONS = {
  statuses: [],
  categories: [],
  collections: [COLLECTION],
};

function render(
  collectionsByProject: ReadonlyMap<
    string,
    readonly { id: string; name: string }[]
  >,
) {
  act(() => {
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <ProjectsListView
          status="ready"
          projects={PROJECTS}
          currentUser={{ name: "Sam", email: "sam@example.test" }}
          search=""
          onSearchChange={() => undefined}
          collectionsByProject={collectionsByProject}
          filterOptions={FILTER_OPTIONS}
        />
      </AgentNativeI18nProvider>,
    );
  });
}

function titles(): string[] {
  return [...host.querySelectorAll("tbody tr[data-project-id]")].map(
    (row) => row.getAttribute("data-project-id") ?? "",
  );
}

it("re-filters by collection when a project is filed into the chosen collection", () => {
  render(new Map([["p1", [COLLECTION]]]));
  const filter = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Filter"),
  );
  act(() => filter?.click());
  act(() =>
    host
      .querySelector<HTMLButtonElement>('button[aria-label="More filters"]')
      ?.click(),
  );
  const planning = [
    ...host.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
  ].find((item) => item.textContent?.includes("Planning"));
  act(() => planning?.click());
  expect(titles()).toEqual(["p1"]);

  render(
    new Map([
      ["p1", [COLLECTION]],
      ["p2", [COLLECTION]],
    ]),
  );
  expect(titles().sort()).toEqual(["p1", "p2"]);
});
