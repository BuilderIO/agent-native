import { describe, expect, it, vi } from "vitest";

import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";

import {
  contentSpaceAvailability,
  contentSpaceForStoredSelection,
  contentSpaceForCatalogItem,
  contentSpaceIdForCreate,
  createContentSpaceSelectionQueue,
  ensureWorkspaceExpanded,
  selectContentSpace,
  toggleExpandedWorkspaceIds,
} from "./select-content-space";

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
    ...overrides,
  };
}

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
          openFiles: (id) => events.push(`open:${id}`),
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
      "open:builder-files",
      "state:personal",
      "persist:personal",
      "open:personal-files",
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
        openFiles: (id) => opened.push(id),
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
    expect(opened).toEqual([
      "personal-files",
      "builder-files",
      "personal-files",
    ]);
    expect(storedSpaceId).toBe("personal");
  });

  it("syncs state before persisting and opening another org workspace", async () => {
    const events: string[] = [];
    const persistSelection = vi.fn((spaceId: string) => {
      events.push(`persist:${spaceId}`);
    });
    const syncApplicationState = vi.fn(async () => {
      events.push("state:space_1");
    });
    const openFiles = vi.fn((documentId: string) => {
      events.push(`open:${documentId}`);
    });

    await selectContentSpace({
      space: space(),
      syncApplicationState,
      persistSelection,
      openFiles,
    });

    expect(events).toEqual([
      "state:space_1",
      "persist:space_1",
      "open:files_document_1",
    ]);
  });

  it("does not persist or navigate when application state cannot be updated", async () => {
    const error = new Error("Application state failed");
    const persistSelection = vi.fn();
    const openFiles = vi.fn();

    await expect(
      selectContentSpace({
        space: space(),
        syncApplicationState: async () => Promise.reject(error),
        persistSelection,
        openFiles,
      }),
    ).rejects.toBe(error);

    expect(persistSelection).not.toHaveBeenCalled();
    expect(openFiles).not.toHaveBeenCalled();
  });

  it("persists and opens the selected Files database", async () => {
    const persistSelection = vi.fn();
    const syncApplicationState = vi.fn(async () => undefined);
    const openFiles = vi.fn();

    await selectContentSpace({
      space: space(),
      syncApplicationState,
      persistSelection,
      openFiles,
    });

    expect(persistSelection).toHaveBeenCalledWith("space_1");
    expect(syncApplicationState).toHaveBeenCalledWith(
      expect.objectContaining({ id: "space_1" }),
    );
    expect(openFiles).toHaveBeenCalledWith("files_document_1");
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
