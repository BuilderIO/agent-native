import { describe, expect, it, vi } from "vitest";

import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";

import {
  contentSpaceAvailability,
  contentSpaceForActiveOrg,
  contentSpaceForCatalogItem,
  selectContentSpace,
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
  it("supports Personal to organization to Personal with one complete flow per selection", async () => {
    let activeOrgId: string | null = null;
    let storedSpaceId: string | null = null;
    const opened: string[] = [];
    const states: string[] = [];
    const switchOrg = vi.fn(async (orgId: string | null) => {
      activeOrgId = orgId;
    });
    const select = async (selected: ContentSpaceSummary) => {
      await selectContentSpace({
        space: selected,
        activeOrgId,
        switchOrg,
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

    expect(switchOrg.mock.calls).toEqual([["builder-org"], [null]]);
    expect(states).toEqual(["personal", "builder", "personal"]);
    expect(opened).toEqual([
      "personal-files",
      "builder-files",
      "personal-files",
    ]);
    expect(storedSpaceId).toBe("personal");
  });

  it("switches organization context before persisting another org workspace", async () => {
    const events: string[] = [];
    const switchOrg = vi.fn(async (orgId: string | null) => {
      events.push(`switch:${orgId}`);
    });
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
      activeOrgId: "org_2",
      switchOrg,
      syncApplicationState,
      persistSelection,
      openFiles,
    });

    expect(events).toEqual([
      "switch:org_1",
      "state:space_1",
      "persist:space_1",
      "open:files_document_1",
    ]);
  });

  it("switches explicitly when the active organization is still loading", async () => {
    const switchOrg = vi.fn(async () => undefined);
    const persistSelection = vi.fn();
    const syncApplicationState = vi.fn(async () => undefined);
    const openFiles = vi.fn();

    await selectContentSpace({
      space: space({ kind: "personal", orgId: null }),
      activeOrgId: undefined,
      switchOrg,
      syncApplicationState,
      persistSelection,
      openFiles,
    });

    expect(switchOrg).toHaveBeenCalledWith(null);
    expect(persistSelection).toHaveBeenCalledWith("space_1");
  });

  it("switches to personal context for a personal workspace", async () => {
    const switchOrg = vi.fn(async () => undefined);
    const persistSelection = vi.fn();
    const syncApplicationState = vi.fn(async () => undefined);
    const openFiles = vi.fn();

    await selectContentSpace({
      space: space({ kind: "personal", orgId: null }),
      activeOrgId: "org_1",
      switchOrg,
      syncApplicationState,
      persistSelection,
      openFiles,
    });

    expect(switchOrg).toHaveBeenCalledWith(null);
    expect(persistSelection).toHaveBeenCalledWith("space_1");
  });

  it("does not persist a selection when organization switching fails", async () => {
    const error = new Error("Organization switch failed");
    const persistSelection = vi.fn();
    const syncApplicationState = vi.fn(async () => undefined);
    const openFiles = vi.fn();

    await expect(
      selectContentSpace({
        space: space(),
        activeOrgId: "org_2",
        switchOrg: async () => Promise.reject(error),
        syncApplicationState,
        persistSelection,
        openFiles,
      }),
    ).rejects.toBe(error);

    expect(persistSelection).not.toHaveBeenCalled();
    expect(syncApplicationState).not.toHaveBeenCalled();
    expect(openFiles).not.toHaveBeenCalled();
  });

  it("does not persist or navigate when application state cannot be updated", async () => {
    const error = new Error("Application state failed");
    const persistSelection = vi.fn();
    const openFiles = vi.fn();

    await expect(
      selectContentSpace({
        space: space(),
        activeOrgId: "org_1",
        switchOrg: vi.fn(async () => undefined),
        syncApplicationState: async () => Promise.reject(error),
        persistSelection,
        openFiles,
      }),
    ).rejects.toBe(error);

    expect(persistSelection).not.toHaveBeenCalled();
    expect(openFiles).not.toHaveBeenCalled();
  });

  it("persists immediately when the organization context already matches", async () => {
    const switchOrg = vi.fn(async () => undefined);
    const persistSelection = vi.fn();
    const syncApplicationState = vi.fn(async () => undefined);
    const openFiles = vi.fn();

    await selectContentSpace({
      space: space(),
      activeOrgId: "org_1",
      switchOrg,
      syncApplicationState,
      persistSelection,
      openFiles,
    });

    expect(switchOrg).not.toHaveBeenCalled();
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

describe("contentSpaceForActiveOrg", () => {
  it("keeps the stored workspace when its organization is active", () => {
    const selected = space({ id: "space_2", orgId: "org_1" });
    expect(
      contentSpaceForActiveOrg({
        spaces: [space(), selected],
        storedSpaceId: selected.id,
        activeOrgId: "org_1",
      }),
    ).toBe(selected);
  });

  it("reconciles an independently switched organization before querying Files", () => {
    const oldSpace = space({ id: "old", orgId: "org_1" });
    const newSpace = space({ id: "new", orgId: "org_2" });
    expect(
      contentSpaceForActiveOrg({
        spaces: [oldSpace, newSpace],
        storedSpaceId: oldSpace.id,
        activeOrgId: "org_2",
      }),
    ).toBe(newSpace);
  });

  it("waits for active organization context instead of querying a stale Files database", () => {
    expect(
      contentSpaceForActiveOrg({
        spaces: [space()],
        storedSpaceId: "space_1",
        activeOrgId: undefined,
      }),
    ).toBeNull();
  });

  it("prefers the personal workspace when switching out of an organization", () => {
    const folder = space({ id: "folder", kind: "source", orgId: null });
    const personal = space({ id: "personal", kind: "personal", orgId: null });
    expect(
      contentSpaceForActiveOrg({
        spaces: [folder, personal],
        storedSpaceId: "missing",
        activeOrgId: null,
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
    activeOrganizationResolved: true,
    activeOrganizationError: false,
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

  it("surfaces active organization failures instead of loading forever", () => {
    expect(
      contentSpaceAvailability({
        ...settledMissingSpace,
        activeOrganizationResolved: false,
        activeOrganizationError: true,
      }),
    ).toBe("error");
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
