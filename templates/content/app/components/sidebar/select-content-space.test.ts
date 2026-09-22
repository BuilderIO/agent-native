import { describe, expect, it, vi } from "vitest";

import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";

import {
  contentSpaceActionArgs,
  contentSpaceAvailability,
  contentSpaceForStoredSelection,
  contentSpaceForCatalogItem,
  contentSidebarSubsetReorder,
  contentSpaceRouteReconciliation,
  contentSpaceIdForCreate,
  createContentSidebarStateWriteQueue,
  createContentSpaceSelectionQueue,
  ensureWorkspaceExpanded,
  selectContentSpace,
  toggleExpandedWorkspaceIds,
} from "./select-content-space";

describe("contentSpaceActionArgs", () => {
  it("omits action input until a non-empty Content space is selected", () => {
    expect(contentSpaceActionArgs(undefined)).toBeUndefined();
    expect(contentSpaceActionArgs(null)).toBeUndefined();
    expect(contentSpaceActionArgs("")).toBeUndefined();
    expect(contentSpaceActionArgs("space-1")).toEqual({ spaceId: "space-1" });
  });
});

function space(
  overrides: Partial<ContentSpaceSummary> = {},
): ContentSpaceSummary {
  return {
    id: "space_1",
    name: "Workspace",
    kind: "organization",
    filesDatabaseId: "database_1",
    filesDocumentId: "files_document_1",
    orgId: "org_1",
    role: "owner",
    catalogItemId: "catalog_item_1",
    catalogDocumentId: "catalog_document_1",
    catalogPosition: 0,
    ...overrides,
  };
}

describe("contentSidebarSubsetReorder", () => {
  it("describes only the five rendered pins when more scoped pins are loaded", () => {
    const loaded = ["a", "b", "c", "d", "e", "f", "g"];
    const rendered = loaded.slice(0, 5);
    expect(
      contentSidebarSubsetReorder(["e", "a", "b", "c", "d"], rendered),
    ).toEqual({
      operation: "reorder-subset",
      itemIds: ["e", "a", "b", "c", "d"],
      previousItemIds: ["a", "b", "c", "d", "e"],
    });
  });
});

describe("selectContentSpace", () => {
  it("serializes rapid workspace selections", async () => {
    const enqueue = createContentSpaceSelectionQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const personal = space({
      id: "personal",
      kind: "personal",
      orgId: null,
      filesDocumentId: "personal-files",
    });
    const builder = space({
      id: "builder",
      orgId: "builder-org",
      filesDocumentId: "builder-files",
    });
    const select = (selected: ContentSpaceSummary, wait = false) =>
      enqueue(() =>
        selectContentSpace({
          space: selected,
          syncApplicationState: async (next) => {
            if (wait) {
              markFirstStarted();
              await firstPending;
            }
            events.push(`state:${next.id}`);
          },
          persistSelection: (id) => events.push(`persist:${id}`),
          openSpace: (id) => events.push(`open:${id}`),
        }),
      );

    const first = select(builder, true);
    const second = select(personal);

    await firstStarted;
    expect(events).toEqual([]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "state:builder",
      "persist:builder",
      "open:builder",
      "state:personal",
      "persist:personal",
      "open:personal",
    ]);
  });

  it("supports Personal to organization to Personal without changing framework organization context", async () => {
    let storedSpaceId: string | null = null;
    const opened: string[] = [];
    const states: string[] = [];
    const select = async (selected: ContentSpaceSummary) => {
      await selectContentSpace({
        space: selected,
        syncApplicationState: async (next) => states.push(next.id),
        persistSelection: (id) => {
          storedSpaceId = id;
        },
        openSpace: (id) => opened.push(id),
      });
    };
    const personal = space({
      id: "personal",
      kind: "personal",
      orgId: null,
      filesDocumentId: "personal-files",
    });
    const builder = space({
      id: "builder",
      orgId: "builder-org",
      filesDocumentId: "builder-files",
    });

    await select(personal);
    await select(builder);
    await select(personal);

    expect(states).toEqual(["personal", "builder", "personal"]);
    expect(opened).toEqual(["personal", "builder", "personal"]);
    expect(storedSpaceId).toBe("personal");
  });

  it("persists after asynchronous state sync and before opening another org workspace", async () => {
    const events: string[] = [];
    const persistSelection = vi.fn((spaceId: string) => {
      events.push(`persist:${spaceId}`);
    });
    const syncApplicationState = vi.fn(async () => {
      events.push("state:space_1");
    });
    const openSpace = vi.fn((spaceId: string) => {
      events.push(`open:${spaceId}`);
    });

    await selectContentSpace({
      space: space(),
      syncApplicationState,
      persistSelection,
      openSpace,
    });

    expect(events).toEqual([
      "state:space_1",
      "persist:space_1",
      "open:space_1",
    ]);
  });

  it("does not persist the explicit selection when application state cannot be updated", async () => {
    const error = new Error("Application state failed");
    const persistSelection = vi.fn();
    const openSpace = vi.fn();

    await expect(
      selectContentSpace({
        space: space(),
        syncApplicationState: async () => Promise.reject(error),
        persistSelection,
        openSpace,
      }),
    ).rejects.toBe(error);

    expect(persistSelection).not.toHaveBeenCalled();
    expect(openSpace).not.toHaveBeenCalled();
  });

  it("persists and opens the selected Files database", async () => {
    const persistSelection = vi.fn();
    const syncApplicationState = vi.fn(async () => undefined);
    const openSpace = vi.fn();

    await selectContentSpace({
      space: space(),
      syncApplicationState,
      persistSelection,
      openSpace,
    });

    expect(persistSelection).toHaveBeenCalledWith("space_1");
    expect(syncApplicationState).toHaveBeenCalledWith(
      expect.objectContaining({ id: "space_1" }),
    );
    expect(openSpace).toHaveBeenCalledWith("space_1");
  });
});

describe("contentSpaceRouteReconciliation", () => {
  const personal = space({
    id: "personal",
    filesDatabaseId: "personal-files-db",
  });
  const demo = space({ id: "demo", filesDatabaseId: "demo-files-db" });

  it("does not let a stale route response snap an asynchronous explicit selection back", () => {
    expect(
      contentSpaceRouteReconciliation({
        activeDocumentId: "demo-files-document",
        routeDocumentId: "demo-files-document",
        routeFilesDatabaseId: "personal-files-db",
        selectedSpace: demo,
        explicitSpaceId: "demo",
        spaces: [personal, demo],
      }),
    ).toEqual({ explicitSelectionReachedRoute: false, routeSpace: null });
  });

  it("releases explicit selection ownership only when the target route response arrives", () => {
    expect(
      contentSpaceRouteReconciliation({
        activeDocumentId: "demo-files-document",
        routeDocumentId: "demo-files-document",
        routeFilesDatabaseId: "demo-files-db",
        selectedSpace: demo,
        explicitSpaceId: "demo",
        spaces: [personal, demo],
      }),
    ).toEqual({ explicitSelectionReachedRoute: true, routeSpace: null });
  });

  it("preserves direct deep-link reconciliation without an explicit selection", () => {
    expect(
      contentSpaceRouteReconciliation({
        activeDocumentId: "demo-page",
        routeDocumentId: "demo-page",
        routeFilesDatabaseId: "demo-files-db",
        selectedSpace: personal,
        explicitSpaceId: null,
        spaces: [personal, demo],
      }).routeSpace,
    ).toBe(demo);
  });
});

describe("contentSpaceForCatalogItem", () => {
  it("maps a Workspaces database row to the Content space it selects", () => {
    const builder = space({
      id: "builder",
      catalogDocumentId: "builder-reference",
    });
    expect(
      contentSpaceForCatalogItem({
        databaseId: "workspaces",
        catalogDatabaseId: "workspaces",
        documentId: "builder-reference",
        spaces: [builder],
      }),
    ).toBe(builder);
  });

  it("does not treat workspace catalog references as Files rows", () => {
    const personal = space({
      id: "personal",
      kind: "personal",
      filesDatabaseId: "personal-files",
      catalogDocumentId: "personal-reference",
    });
    const builder = space({
      id: "builder",
      kind: "organization",
      filesDatabaseId: "builder-files",
      catalogDocumentId: "builder-reference",
    });
    expect(
      contentSpaceForCatalogItem({
        databaseId: "personal-files",
        catalogDatabaseId: "workspaces",
        documentId: "builder-reference",
        spaces: [personal, builder],
      }),
    ).toBeNull();
  });

  it("does not treat workspace references in another space's Files database as selectors", () => {
    const personal = space({
      id: "personal",
      kind: "personal",
      filesDatabaseId: "personal-files",
    });
    expect(
      contentSpaceForCatalogItem({
        databaseId: "organization-files",
        catalogDatabaseId: "workspaces",
        documentId: "builder-reference",
        spaces: [personal, space({ catalogDocumentId: "builder-reference" })],
      }),
    ).toBeNull();
  });

  it("leaves ordinary database rows on the normal page-open path", () => {
    expect(
      contentSpaceForCatalogItem({
        databaseId: "projects",
        catalogDatabaseId: "workspaces",
        documentId: "builder-reference",
        spaces: [space({ catalogDocumentId: "builder-reference" })],
      }),
    ).toBeNull();
  });
});

describe("workspace expansion", () => {
  it("opens and closes workspaces independently", () => {
    expect(toggleExpandedWorkspaceIds(["personal"], "organization")).toEqual([
      "personal",
      "organization",
    ]);
    expect(
      toggleExpandedWorkspaceIds(["personal", "organization"], "organization"),
    ).toEqual(["personal"]);
  });

  it("keeps the selected workspace open without closing its siblings", () => {
    expect(ensureWorkspaceExpanded(["personal"], "organization")).toEqual([
      "personal",
      "organization",
    ]);
    const expanded = ["personal", "organization"];
    expect(ensureWorkspaceExpanded(expanded, "organization")).toBe(expanded);
  });

  it("serializes persisted expansion snapshots in interaction order", async () => {
    const writes: string[][] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const enqueue = createContentSidebarStateWriteQueue(
      async (workspaceIds: string[]) => {
        if (writes.length === 0) await firstPending;
        writes.push(workspaceIds);
      },
    );

    const first = enqueue(["personal", "organization"]);
    const second = enqueue(["personal"]);
    await Promise.resolve();
    expect(writes).toEqual([]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(writes).toEqual([["personal", "organization"], ["personal"]]);
  });
});

describe("contentSpaceIdForCreate", () => {
  it("uses the selected workspace for a root page", () => {
    expect(
      contentSpaceIdForCreate({ selectedSpace: space(), parentId: undefined }),
    ).toBe("space_1");
  });

  it("fails closed while root-page workspace selection is unresolved", () => {
    expect(() =>
      contentSpaceIdForCreate({ selectedSpace: null, parentId: undefined }),
    ).toThrow("Files are still loading");
  });

  it("lets nested pages inherit their parent workspace", () => {
    expect(
      contentSpaceIdForCreate({ selectedSpace: null, parentId: "parent" }),
    ).toBeUndefined();
  });
});

describe("contentSpaceForStoredSelection", () => {
  it("recovers an explicit stored selection after an initially partial space list", () => {
    const personal = space({ id: "personal", kind: "personal" });
    const demo = space({ id: "demo" });
    const storedSpaceId = "demo";

    expect(
      contentSpaceForStoredSelection({ spaces: [personal], storedSpaceId }),
    ).toBe(personal);
    expect(
      contentSpaceForStoredSelection({
        spaces: [personal, demo],
        storedSpaceId,
      }),
    ).toBe(demo);
  });

  it("keeps the stored workspace independently of framework organization context", () => {
    const selected = space({ id: "space_2", orgId: "org_1" });
    expect(
      contentSpaceForStoredSelection({
        spaces: [space(), selected],
        storedSpaceId: selected.id,
      }),
    ).toBe(selected);
  });

  it("does not change Content workspace after an independent framework organization switch", () => {
    const selected = space({ id: "selected", orgId: "org_1" });
    const other = space({ id: "other", orgId: "org_2" });
    expect(
      contentSpaceForStoredSelection({
        spaces: [selected, other],
        storedSpaceId: selected.id,
      }),
    ).toBe(selected);
  });

  it("prefers Personal when the stored workspace is unavailable", () => {
    const folder = space({ id: "folder", kind: "source", orgId: null });
    const personal = space({ id: "personal", kind: "personal", orgId: null });
    expect(
      contentSpaceForStoredSelection({
        spaces: [folder, personal],
        storedSpaceId: "missing",
      }),
    ).toBe(personal);
  });
});

describe("contentSpaceAvailability", () => {
  const settledMissingSpace = {
    hasSelectedSpace: false,
    contentSpacesLoading: false,
    contentSpacesFetching: false,
    contentSpacesError: false,
    provisioningAttempted: true,
    provisioningPending: false,
    provisioningError: false,
  };

  it("keeps the Files sidebar loading before automatic provisioning starts", () => {
    expect(
      contentSpaceAvailability({
        ...settledMissingSpace,
        provisioningAttempted: false,
      }),
    ).toBe("loading");
  });

  it("keeps loading until the post-provision list refetch settles", () => {
    expect(
      contentSpaceAvailability({
        ...settledMissingSpace,
        contentSpacesFetching: true,
      }),
    ).toBe("loading");
  });

  it("surfaces provisioning failures instead of claiming there are no workspaces", () => {
    expect(
      contentSpaceAvailability({
        ...settledMissingSpace,
        provisioningError: true,
      }),
    ).toBe("error");
    expect(contentSpaceAvailability(settledMissingSpace)).toBe("error");
  });

  it("renders Files as soon as the active workspace is available", () => {
    expect(
      contentSpaceAvailability({
        ...settledMissingSpace,
        hasSelectedSpace: true,
        provisioningError: true,
      }),
    ).toBe("ready");
  });
});
