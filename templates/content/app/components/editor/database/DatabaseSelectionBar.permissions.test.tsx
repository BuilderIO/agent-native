import type { ContentDatabaseItem } from "@shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DatabaseSelectionBar,
  databaseSelectionCapabilities,
} from "./DatabaseView";

function item(overrides: Partial<ContentDatabaseItem> = {}) {
  return {
    id: "item-1",
    databaseId: "database-1",
    document: {
      id: "document-1",
      accessRole: "viewer",
      canView: true,
    } as ContentDatabaseItem["document"],
    position: 0,
    properties: [],
    bodyHydration: {
      status: "hydrated" as const,
      attemptedAt: null,
      error: null,
      version: null,
    },
    ...overrides,
  } satisfies ContentDatabaseItem;
}

function selectionBarMarkup(capabilities: {
  canEditSelected: boolean;
  canDuplicateSelected: boolean;
  canRemoveSelected: boolean;
}) {
  return renderToStaticMarkup(
    <DatabaseSelectionBar
      selectedCount={1}
      {...capabilities}
      properties={[]}
      selectedItems={[item()]}
      duplicateDisabled={false}
      removeDisabled={false}
      removesFavoriteMembership={false}
      updateDisabled={false}
      onClearSelection={vi.fn()}
      onSetPropertyValue={vi.fn()}
      onDuplicateSelected={vi.fn()}
      onRemoveSelected={vi.fn()}
    />,
  );
}

describe("database selection permissions", () => {
  it("renders count and Clear only for viewers", () => {
    const markup = selectionBarMarkup({
      canEditSelected: false,
      canDuplicateSelected: false,
      canRemoveSelected: false,
    });

    expect(markup).toContain("1 selected");
    expect(markup).toContain("Clear");
    expect(markup).not.toContain("Duplicate");
    expect(markup).not.toContain("Remove");
  });

  it("renders entry editing without removal and manager removal separately", () => {
    const editorMarkup = selectionBarMarkup({
      canEditSelected: true,
      canDuplicateSelected: true,
      canRemoveSelected: false,
    });
    expect(editorMarkup).toContain("Duplicate");
    expect(editorMarkup).not.toContain(">Remove<");

    const managerMarkup = selectionBarMarkup({
      canEditSelected: true,
      canDuplicateSelected: true,
      canRemoveSelected: true,
    });
    expect(managerMarkup).toContain(">Remove<");
  });

  it("fails closed for stale and source-backed whole selections", () => {
    const localItem = item();
    expect(
      databaseSelectionCapabilities({
        canEdit: true,
        canManageDatabase: true,
        databaseSystemRole: null,
        selectedItemIds: [localItem.id, "stale-item"],
        selectedItems: [localItem],
        sources: [],
        removesFavoriteMembership: false,
        isWorkspaceCatalog: false,
      }),
    ).toEqual({
      selectionComplete: false,
      canEditSelected: false,
      canDuplicateSelected: false,
      canRemoveSelected: false,
    });

    expect(
      databaseSelectionCapabilities({
        canEdit: true,
        canManageDatabase: true,
        databaseSystemRole: null,
        selectedItemIds: [localItem.id],
        selectedItems: [
          item({
            bodyHydration: {
              status: "pending",
              attemptedAt: null,
              error: null,
              version: null,
            },
          }),
        ],
        sources: [],
        removesFavoriteMembership: false,
        isWorkspaceCatalog: false,
      }).canRemoveSelected,
    ).toBe(false);
  });

  it("fails closed when any selected page lacks viewer access", () => {
    const inaccessibleItem = item({
      document: {
        id: "document-1",
      } as ContentDatabaseItem["document"],
    });

    expect(
      databaseSelectionCapabilities({
        canEdit: true,
        canManageDatabase: true,
        databaseSystemRole: null,
        selectedItemIds: [inaccessibleItem.id],
        selectedItems: [inaccessibleItem],
        sources: [],
        removesFavoriteMembership: false,
        isWorkspaceCatalog: false,
      }),
    ).toMatchObject({
      canDuplicateSelected: false,
      canRemoveSelected: false,
    });
  });

  it("does not offer membership removal for system databases", () => {
    const localItem = item();
    expect(
      databaseSelectionCapabilities({
        canEdit: true,
        canManageDatabase: true,
        databaseSystemRole: "files",
        selectedItemIds: [localItem.id],
        selectedItems: [localItem],
        sources: [],
        removesFavoriteMembership: false,
        isWorkspaceCatalog: false,
      }).canRemoveSelected,
    ).toBe(false);
    expect(
      databaseSelectionCapabilities({
        canEdit: true,
        canManageDatabase: true,
        databaseSystemRole: undefined,
        selectedItemIds: [localItem.id],
        selectedItems: [localItem],
        sources: [],
        removesFavoriteMembership: false,
        isWorkspaceCatalog: false,
      }).canRemoveSelected,
    ).toBe(false);
    expect(
      databaseSelectionCapabilities({
        canEdit: true,
        canManageDatabase: false,
        databaseSystemRole: "favorites",
        selectedItemIds: [localItem.id],
        selectedItems: [localItem],
        sources: [],
        removesFavoriteMembership: true,
        isWorkspaceCatalog: false,
      }).canRemoveSelected,
    ).toBe(true);
  });
});
