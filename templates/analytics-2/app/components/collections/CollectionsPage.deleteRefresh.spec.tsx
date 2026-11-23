// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  refetch: vi.fn(() => Promise.resolve()),
  callAction: vi.fn(async () => ({})),
}));

const copy: Record<string, string> = {
  "analytics.collections.title": "Collections",
  "analytics.collections.back": "All collections",
  "analytics.collections.projectCountOne": "1 project",
  "analytics.collections.projectCountOther": "{{count}} projects",
  "analytics.collections.createdByYou": "Created by you",
  "analytics.collections.sharedWithWorkspace": "Shared with workspace",
  "analytics.collections.privateSharing": "Private",
  "analytics.collections.sharedWithYou": "Shared with you",
  "collectionSharingSummary.usersOne": "Shared with 1 user",
  "collectionSharingSummary.usersOther": "Shared with {{count}} users",
  "analytics.collections.favorite": "Favorite collection",
  "analytics.collections.unfavorite": "Remove collection from favorites",
  "analytics.lists.favoriteCollectionFailed":
    "Could not update the collection favorite. Try again.",
  "analytics.collections.emptyTitle": "No collections yet",
  "analytics.collections.emptyDescription":
    "Collections group projects that belong together.",
  "analytics.collections.notFoundTitle": "Collection not found",
  "analytics.collections.notFoundDescription":
    "This collection may have been deleted, or it is not shared with you.",
  "analytics.lists.deleteCollection": "Delete collection",
};

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    (copy[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      String(vars?.[name] ?? ""),
    ),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: mocks.result,
    isLoading: false,
    refetch: mocks.refetch,
  }),
  callAction: mocks.callAction,
}));

vi.mock("@/components/projects/ProjectsPage", () => ({
  OrdinaryProjectsPage: ({ collectionId }: { collectionId?: string }) => (
    <output data-embedded-collection={collectionId} />
  ),
}));

import type { RoutePageProps } from "@/components/workspace/types";

import { CollectionsPage } from "./CollectionsPage";

describe("collection delete refreshes the list", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.result = {
      collections: [
        {
          id: "collection-1",
          name: "Starting point",
          description: "",
          kind: "collection",
          parentId: null,
          favorited: false,
          projectCount: 0,
          ownedByYou: true,
          sharedWithWorkspace: false,
          isPrivate: true,
          sharedWithUserCount: 0,
        },
      ],
    };
    mocks.refetch.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("reads the collections again before returning to the list", async () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/collection/collection-1"]}>
          <Routes>
            <Route
              element={<CollectionsPage {...({} as RoutePageProps)} />}
              path="/home/collections"
            />
            <Route
              element={<CollectionsPage {...({} as RoutePageProps)} />}
              path="/collection/:collectionId"
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    const button = (label: string) =>
      [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
    act(() => button("Delete collection")?.click());
    const before = mocks.refetch.mock.calls.length;
    await act(async () => {
      const confirms = [...document.querySelectorAll("button")].filter(
        (candidate) => candidate.textContent?.trim() === "Delete collection",
      );
      confirms.at(-1)?.click();
      await Promise.resolve();
    });
    expect(mocks.callAction).toHaveBeenCalledWith("delete-collection", {
      collectionId: "collection-1",
    });
    expect(mocks.refetch.mock.calls.length).toBeGreaterThan(before);
  });
});
