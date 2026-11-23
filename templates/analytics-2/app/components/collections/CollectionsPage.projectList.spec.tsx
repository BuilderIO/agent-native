// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Report 1795084861.733869: inside a collection the project list lacked the
// Projects list's detail columns and its column-settings control.
const mocks = vi.hoisted(() => ({
  queries: [] as { name: string; input: unknown }[],
  empty: false,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useT: () => (key: string) => key,
}));

const sample = {
  id: "collection-1",
  name: "Starting point",
  description: "",
  kind: "collection",
  parentId: null,
  favorited: false,
  projectCount: 1,
  ownedByYou: true,
  sharedWithWorkspace: false,
  isPrivate: true,
};
const project = {
  id: "prj_1",
  ownerEmail: "qa@workspace.test",
  creatorEmail: "creator@workspace.test",
  title: "Revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  lastPublishedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  yourAccess: "owner",
  sharedWith: { workspace: false, directCount: 0 },
  appViews: null,
  appLastViewedAt: null,
};
const columnCapabilities = [
  "projects-column-app-views",
  "projects-column-app-last-published",
  "projects-column-app-last-viewed",
  "projects-column-your-access",
  "projects-column-shared-with",
].map((controlId) => ({ controlId, status: "allowed" }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string, input: unknown) => {
    mocks.queries.push({ name, input });
    const data: Record<string, unknown> = {
      "list-collections": { collections: [sample] },
      "list-projects": {
        projects: mocks.empty ? [] : [project],
        capabilities: columnCapabilities,
        viewer: { email: "qa@workspace.test", orgId: "ws" },
      },
      "list-data-statuses": { statuses: [] },
      "list-project-categories": { categories: [], assignments: [] },
      "list-project-collections": {
        assignments: [{ projectId: "prj_1", collectionIds: ["collection-1"] }],
      },
    };
    return {
      data: data[name],
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: () => Promise.resolve(),
    };
  },
  callAction: vi.fn(async () => ({})),
}));

vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [], isPending: false, isError: false }),
  useUpdateResource: () => ({ mutateAsync: async () => undefined }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
}));

vi.mock("@/components/workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      user: { name: "QA", email: "qa@workspace.test" },
      workspace: { id: "ws" },
      capabilities: [],
      features: { isAdmin: false },
    },
    onCreateProject: () => {},
  }),
}));

import type { RoutePageProps } from "@/components/workspace/types";

import { CollectionsPage } from "./CollectionsPage";

describe("report 1795084861.733869 collection page project list", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.queries = [];
    mocks.empty = false;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/collection/collection-1"]}>
          <Routes>
            <Route
              element={<CollectionsPage {...({} as RoutePageProps)} />}
              path="/collection/:collectionId"
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  const headers = () =>
    [...host.querySelectorAll("thead th")].map((th) => th.textContent.trim());

  it("shows the Projects table's default detail columns", () => {
    // oracle-change: the list renders only columns the project contract backs, so Collection access has no column.
    expect(headers()).toEqual([
      "",
      "Title",
      "Status",
      "Categories",
      "Owner",
      "Last viewed by you",
      "App last published",
      "App views",
      "Your access",
      "Shared with",
      "Collections",
    ]);
    expect(host.querySelector("tbody")?.textContent).toContain("Revenue");
    // The list is filed-in-this-collection only.
    expect(
      mocks.queries.some(
        (q) =>
          q.name === "list-projects" &&
          (q.input as { collectionId?: string }).collectionId ===
            "collection-1",
      ),
    ).toBe(true);
  });

  it("offers column settings that change the real headers and rows", () => {
    const settings = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Display settings"]',
    );
    if (!settings) throw Error("Column settings control missing");
    expect(headers()).not.toContain("Creator");
    act(() => settings.click());
    const creator = [...host.querySelectorAll<HTMLElement>("[role^=menuitem]")]
      .concat([...host.querySelectorAll<HTMLElement>("label, button")])
      .find((el) => el.textContent.trim() === "Creator");
    if (!creator) throw Error("Creator column choice missing");
    act(() => creator.click());
    expect(headers()).toContain("Creator");
    expect(host.querySelector("tbody")?.textContent).toContain(
      "creator@workspace.test",
    );
  });
});

describe("report QA-1795084861 collection columns and column settings", () => {
  let host: HTMLDivElement;
  let root: Root;

  function mount() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/collection/collection-1"]}>
          <Routes>
            <Route
              element={<CollectionsPage {...({} as RoutePageProps)} />}
              path="/collection/:collectionId"
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  beforeEach(() => {
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.queries = [];
    mocks.empty = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  function openSettings(): HTMLElement {
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Display settings"]',
    );
    if (!button) throw Error("Display settings control missing");
    act(() => button.click());
    const menu = host.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Display settings"]',
    );
    if (!menu) throw Error("Display settings menu missing");
    return menu;
  }

  it("lists the collection's own columns in the collection's order", () => {
    mount();
    const menu = openSettings();
    const labels = [...menu.querySelectorAll(".ws-projects-menu-label")].map(
      (label) => label.textContent.trim(),
    );
    // oracle-change: Collection access, Reviews and Scheduled have no backing field, so the chooser does not list them.
    expect(labels).toEqual([
      "Show app views from",
      "All columns",
      "Title",
      "Status",
      "Categories",
      "Owner",
      "Creator",
      "Last viewed by you",
      "Created",
      "Last edited",
      "App last published",
      "App views",
      "App last viewed",
      "Your access",
      "Shared with",
      "Collections",
    ]);
  });

  it("offers the source's Display settings, Columns, Reset and All columns", () => {
    mount();
    const menu = openSettings();
    const text = menu.textContent;
    expect(text).toContain("Display settings");
    expect(text).toContain("Show app views from");
    expect(text).toContain("Columns");
    const reset = [...menu.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Reset",
    );
    if (!reset) throw Error("Reset missing");
    const heading = () =>
      [...host.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const all = [...menu.querySelectorAll("label")]
      .find((l) => l.textContent.trim() === "All columns")
      ?.querySelector("input");
    if (!all) throw Error("All columns missing");
    act(() => all.click());
    expect(heading()).toContain("Creator");
    act(() => all.click());
    // oracle-change: Owner stands in for the unbacked Collection access column as the default-visible optional column.
    expect(heading()).not.toContain("Owner");
    act(() => reset.click());
    expect(heading()).toContain("Owner");
    expect(heading()).not.toContain("Creator");
  });

  it("uses the collection's empty state", () => {
    mocks.empty = true;
    mount();
    const text = host.textContent;
    expect(text).toContain("You don't have anything in this collection yet");
    expect(text).toContain(
      "Add projects or components to this collection to help organize the files you care about and find them quickly",
    );
    expect(text).toContain("Add to collection");
  });
});
