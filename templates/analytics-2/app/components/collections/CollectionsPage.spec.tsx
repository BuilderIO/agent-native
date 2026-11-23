// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  failed: false,
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
  "projectMenu.loadError": "Collections could not be loaded.",
  "error.retry": "Retry",
  "analytics.collections.notFoundTitle": "Collection not found",
  "analytics.collections.notFoundDescription":
    "This collection may have been deleted, or it is not shared with you.",
  "analytics.collections.managersAndMembers": "Collection managers & members",
  "analytics.collections.roleOwner": "Owner",
  "collectionDialog.roleManager": "Manager",
  "collectionDialog.roleMember": "Member",
  "analytics.lists.editCollection": "Edit this collection (catalog)",
  "analytics.lists.deleteCollection": "Delete this collection (catalog)",
  "analytics.collections.addProjects": "Add projects (catalog)",
  "analytics.collections.favoriteFailed": "Add favorite failed",
  "analytics.collections.unfavoriteFailed": "Remove favorite failed",
};

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    (copy[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      String(vars?.[name] ?? ""),
    ),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: mocks.failed ? undefined : mocks.result,
    isLoading: false,
    isError: mocks.failed,
    refetch: mocks.refetch,
  }),
  callAction: mocks.callAction,
}));

// A collection's page embeds the Projects list, which reads the workspace
// identity and the query client; this spec only asserts the page's own facts.
vi.mock("@/components/projects/ProjectsPage", () => ({
  OrdinaryProjectsPage: ({ collectionId }: { collectionId?: string }) => (
    <output data-embedded-collection={collectionId} />
  ),
}));

import type { RoutePageProps } from "@/components/workspace/types";

import { CollectionsPage } from "./CollectionsPage";

/**
 * Row 119: the seeded sample collection read as a bare name — no description, no
 * project count and no byline. The list and a collection's own page now show all
 * three from the workspace's own collections read.
 */
describe("collections page", () => {
  let host: HTMLDivElement;
  let root: Root;

  const sample = {
    id: "collection-1",
    name: "Starting point",
    description: "Example projects built on the sample data.",
    kind: "collection" as const,
    parentId: null,
    favorited: false,
    projectCount: 3,
    ownedByYou: true,
    sharedWithWorkspace: true,
    isPrivate: false,
    sharedWithUserCount: 0,
  };

  beforeEach(() => {
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.result = { collections: [sample] };
    mocks.failed = false;
    mocks.refetch.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  const render = (path = "/home/collections") =>
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
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

  it.each(["/home/collections", "/collection/collection-1"])(
    "reports a failed read on %s with a retry instead of an empty or missing collection",
    (path) => {
      mocks.failed = true;
      render(path);
      const text = host.textContent ?? "";
      expect(text).toContain("Collections could not be loaded.");
      expect(text).not.toContain("No collections yet");
      expect(text).not.toContain("Collection not found");
      const retry = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Retry",
      );
      act(() => retry?.click());
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
    },
  );

  it("shows the description, project count and byline in the list", () => {
    render();
    const text = host.textContent ?? "";
    expect(text).toContain("Starting point");
    expect(text).toContain("Example projects built on the sample data.");
    expect(text).toContain("3 projects");
    // The list carries the sharing label; the byline belongs to the page below.
    expect(text).toContain("Shared with workspace");
  });

  it("links a collection to its own page, which repeats the three facts", () => {
    render();
    const link = [...host.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("Starting point"),
    );
    expect(link?.getAttribute("href")).toBe("/collection/collection-1");

    // A fresh mount for the collection's own route: re-rendering the same root
    // keeps the index's params and would assert the list twice.
    act(() => root.unmount());
    host.innerHTML = "";
    root = createRoot(host);
    render("/collection/collection-1");
    const text = host.textContent ?? "";
    expect(text).toContain("Starting point");
    expect(text).toContain("3 projects");
    expect(text).toContain("Shared with workspace");
    expect(text).toContain("Created by you");
    expect(host.querySelector('a[href="/collection/collection-1"]')).toBeNull();
    // oracle-change: the collection's projects render in the embedded Projects table, so the page passes its id instead of drawing its own project links.
    const embedded = host.querySelector("output[data-embedded-collection]");
    expect(embedded?.getAttribute("data-embedded-collection")).toBe(
      "collection-1",
    );
  });

  it("lets a long collection name and its three actions wrap on a narrow screen", () => {
    mocks.result = {
      collections: [{ ...sample, name: "Quarterly revenue ".repeat(20) }],
    };
    render("/collection/collection-1");
    const header = host.querySelector("[data-collection-header]");
    const actions = host.querySelector("[data-collection-actions]");
    expect(header?.classList.contains("flex-wrap")).toBe(true);
    expect(actions?.classList.contains("flex-wrap")).toBe(true);
    expect(header?.querySelector("h1")?.classList.contains("min-w-0")).toBe(
      true,
    );
    expect(
      [...(actions?.querySelectorAll("button") ?? [])].map(
        (button) => button.textContent,
      ),
    ).toEqual([
      "Edit this collection (catalog)",
      "Add projects (catalog)",
      "Delete this collection (catalog)",
    ]);
  });

  it("summarises individual user sharing, with the workspace taking precedence", () => {
    const base = { ...sample, sharedWithWorkspace: false, isPrivate: true };
    mocks.result = {
      collections: [
        { ...base, id: "c-two", name: "Two users", sharedWithUserCount: 2 },
        { ...base, id: "c-one", name: "One user", sharedWithUserCount: 1 },
        { ...base, id: "c-none", name: "Nobody", sharedWithUserCount: 0 },
        {
          ...sample,
          id: "c-ws",
          name: "Everyone",
          sharedWithUserCount: 3,
        },
      ],
    };
    render();
    const row = (name: string) =>
      [...host.querySelectorAll("li")].find((li) =>
        li.textContent?.includes(name),
      )?.textContent ?? "";
    expect(row("Two users")).toContain("Shared with 2 users");
    expect(row("One user")).toContain("Shared with 1 user");
    expect(row("Nobody")).toContain("Private");
    expect(row("Everyone")).toContain("Shared with workspace");
    expect(row("Everyone")).not.toContain("3 users");
  });

  it("counts a single project without pluralizing", () => {
    mocks.result = { collections: [{ ...sample, projectCount: 1 }] };
    render();
    expect(host.textContent).toContain("1 project");
    expect(host.textContent).not.toContain("1 projects");
  });

  it("shows the empty state when the workspace has no collections", () => {
    mocks.result = { collections: [] };
    render();
    expect(host.textContent).toContain("No collections yet");
  });

  it("stars a collection through the favorite action", () => {
    mocks.callAction.mockClear();
    render();
    const star = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Favorite collection"]',
    );
    if (!star) throw Error("Collection favorite control missing");
    expect(star.getAttribute("aria-pressed")).toBe("false");
    act(() => star.click());
    expect(mocks.callAction).toHaveBeenCalledWith("favorite-collection", {
      collectionId: "collection-1",
      favorited: true,
    });
  });

  it("reads filled and offers removal when the collection is a favorite", () => {
    mocks.result = { collections: [{ ...sample, favorited: true }] };
    render();
    const star = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove collection from favorites"]',
    );
    if (!star) throw Error("Favorited collection control missing");
    expect(star.getAttribute("aria-pressed")).toBe("true");
  });

  it("says the removal failed when un-favoriting fails", async () => {
    mocks.result = { collections: [{ ...sample, favorited: true }] };
    mocks.callAction.mockRejectedValueOnce(new Error("offline"));
    render();
    const star = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove collection from favorites"]',
    );
    await act(async () => star?.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Remove favorite failed",
    );
  });

  it("renders Collection managers & members on a collection detail page", () => {
    mocks.result = {
      collections: [
        {
          ...sample,
          members: [
            { email: "ada@example.test", name: "Ada Lovelace", role: "owner" },
            {
              email: "grace@example.test",
              name: "Grace Hopper",
              role: "manager",
            },
            { email: "linus@example.test", name: null, role: "member" },
          ],
        },
      ],
    };
    render("/collection/collection-1");
    const section = host.querySelector("[data-collection-members]");
    expect(section).not.toBeNull();
    const text = section?.textContent ?? "";
    expect(text).toContain("Collection managers & members");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Grace Hopper");
    expect(text).toContain("Manager");
    expect(text).toContain("linus@example.test");
    expect(text).toContain("Member");
  });

  it("labels the collection page actions from the catalog", () => {
    render("/collection/collection-1");
    const labels = [
      ...(host
        .querySelector("[data-collection-actions]")
        ?.querySelectorAll("button") ?? []),
    ].map((button) => button.textContent);
    expect(labels).toEqual([
      "Edit this collection (catalog)",
      "Add projects (catalog)",
      "Delete this collection (catalog)",
    ]);
  });

  it("shows a collection's emoji in the list and on its page", () => {
    mocks.result = { collections: [{ ...sample, emoji: "\u{1F680}" }] };
    render();
    expect(host.textContent).toContain("\u{1F680}");
    act(() => root.unmount());
    host.innerHTML = "";
    root = createRoot(host);
    render("/collection/collection-1");
    expect(host.querySelector("h1")?.textContent).toContain("\u{1F680}");
  });

  it("says whether adding or removing the favorite failed", async () => {
    mocks.callAction.mockRejectedValueOnce(new Error("offline"));
    render();
    const star = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Favorite collection"]',
    );
    await act(async () => star?.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Add favorite failed",
    );
  });

  it("reveals the unstarred collection star on row hover", () => {
    render();
    const row = host.querySelector("li");
    const star = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Favorite collection"]',
    );
    expect(row?.classList.contains("group")).toBe(true);
    expect(star?.classList.contains("group-hover:opacity-100")).toBe(true);
  });

  it("invalidates workspace activity when toggling a collection favorite so the shell updates immediately", async () => {
    mocks.callAction.mockClear();
    const queryClient = new QueryClient();
    const invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/home/collections"]}>
            <Routes>
              <Route
                element={<CollectionsPage {...({} as RoutePageProps)} />}
                path="/home/collections"
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const star = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Favorite collection"]',
    );
    if (!star) throw Error("Collection favorite control missing");
    await act(async () => {
      star.click();
      await Promise.resolve();
    });
    expect(mocks.callAction).toHaveBeenCalledWith("favorite-collection", {
      collectionId: "collection-1",
      favorited: true,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["action", "get-workspace-activity"],
    });
  });

  it("renders a visible favorite toggle on the collection detail header", async () => {
    mocks.callAction.mockClear();
    const queryClient = new QueryClient();
    const invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/collection/collection-1"]}>
            <Routes>
              <Route
                element={<CollectionsPage {...({} as RoutePageProps)} />}
                path="/collection/:collectionId"
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const header = host.querySelector("[data-collection-header]");
    const star = header?.querySelector<HTMLButtonElement>(
      'button[aria-label="Favorite collection"]',
    );
    expect(star).not.toBeNull();
    expect(star?.classList.contains("opacity-0")).toBe(false);
    expect(star?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      star?.click();
      await Promise.resolve();
    });
    expect(mocks.callAction).toHaveBeenCalledWith("favorite-collection", {
      collectionId: "collection-1",
      favorited: true,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["action", "get-workspace-activity"],
    });
  });
});

// oracle-change: test-audit campaign removed whole low-value tests, see PR 498
