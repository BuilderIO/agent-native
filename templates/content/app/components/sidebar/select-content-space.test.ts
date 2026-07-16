import { describe, expect, it, vi } from "vitest";

import type { ContentSpaceSummary } from "@/hooks/use-content-spaces";

import {
  contentSpaceForActiveOrg,
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
    orgId: "org_1",
    role: "owner",
    catalogItemId: "catalog_item_1",
    catalogDocumentId: "catalog_document_1",
    ...overrides,
  };
}

describe("selectContentSpace", () => {
  it("switches organization context before persisting another org workspace", async () => {
    const events: string[] = [];
    const switchOrg = vi.fn(async (orgId: string | null) => {
      events.push(`switch:${orgId}`);
    });
    const persistSelection = vi.fn((spaceId: string) => {
      events.push(`persist:${spaceId}`);
    });

    await selectContentSpace({
      space: space(),
      activeOrgId: "org_2",
      switchOrg,
      persistSelection,
    });

    expect(events).toEqual(["switch:org_1", "persist:space_1"]);
  });

  it("switches explicitly when the active organization is still loading", async () => {
    const switchOrg = vi.fn(async () => undefined);
    const persistSelection = vi.fn();

    await selectContentSpace({
      space: space({ kind: "personal", orgId: null }),
      activeOrgId: undefined,
      switchOrg,
      persistSelection,
    });

    expect(switchOrg).toHaveBeenCalledWith(null);
    expect(persistSelection).toHaveBeenCalledWith("space_1");
  });

  it("switches to personal context for a personal workspace", async () => {
    const switchOrg = vi.fn(async () => undefined);
    const persistSelection = vi.fn();

    await selectContentSpace({
      space: space({ kind: "personal", orgId: null }),
      activeOrgId: "org_1",
      switchOrg,
      persistSelection,
    });

    expect(switchOrg).toHaveBeenCalledWith(null);
    expect(persistSelection).toHaveBeenCalledWith("space_1");
  });

  it("does not persist a selection when organization switching fails", async () => {
    const error = new Error("Organization switch failed");
    const persistSelection = vi.fn();

    await expect(
      selectContentSpace({
        space: space(),
        activeOrgId: "org_2",
        switchOrg: async () => Promise.reject(error),
        persistSelection,
      }),
    ).rejects.toBe(error);

    expect(persistSelection).not.toHaveBeenCalled();
  });

  it("persists immediately when the organization context already matches", async () => {
    const switchOrg = vi.fn(async () => undefined);
    const persistSelection = vi.fn();

    await selectContentSpace({
      space: space(),
      activeOrgId: "org_1",
      switchOrg,
      persistSelection,
    });

    expect(switchOrg).not.toHaveBeenCalled();
    expect(persistSelection).toHaveBeenCalledWith("space_1");
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
