// @vitest-environment happy-dom

import type {
  Document,
  DocumentAccessRole,
  DocumentTreeNode,
} from "@shared/api";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DocumentTreeItem, FavoriteDocumentItem } from "./DocumentTreeItem";

const { useSortableMock } = vi.hoisted(() => ({
  useSortableMock: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}));

vi.mock("@dnd-kit/sortable", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dnd-kit/sortable")>()),
  useSortable: useSortableMock,
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextShareSheet: () => null,
}));

function documentForRole(
  accessRole: DocumentAccessRole,
  isFavorite = false,
): Document {
  return {
    id: "shared",
    parentId: null,
    title: "Shared page",
    content: "",
    icon: null,
    position: 0,
    isFavorite,
    hideFromSearch: false,
    accessRole,
    canEdit: accessRole !== "viewer",
    canManage: accessRole === "owner" || accessRole === "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  await act(async () => {
    root.render(
      <MemoryRouter>
        <TooltipProvider>{node}</TooltipProvider>
      </MemoryRouter>,
    );
  });

  return { container, root };
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll("[role=menu]").forEach((menu) => menu.remove());
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
}

async function openActions(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="More actions for Shared page"]',
  );
  expect(trigger).toBeTruthy();

  await act(async () => {
    trigger?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
    await Promise.resolve();
  });

  return Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]"));
}

function treeItem(
  document: Document,
  onToggleFavorite: (id: string, isFavorite: boolean) => void = () => {},
) {
  return (
    <DocumentTreeItem
      node={{ ...document, children: [] } satisfies DocumentTreeNode}
      depth={0}
      activeId={null}
      expandedIds={new Set()}
      onToggleExpanded={() => {}}
      onSelect={() => {}}
      onCreateChildPage={() => {}}
      onCreateChildDatabase={() => {}}
      onDelete={() => {}}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

describe("sidebar document permission menus", () => {
  it("lets a viewer remove a page from personal Favorites and nothing else", async () => {
    const onRemoveFavorite = vi.fn();
    const { container, root } = await render(
      <FavoriteDocumentItem
        document={documentForRole("viewer", true)}
        active={false}
        onSelect={() => {}}
        onCreateChildPage={() => {}}
        onCreateChildDatabase={() => {}}
        onRemoveFavorite={onRemoveFavorite}
        onDelete={() => {}}
      />,
    );

    expect(
      container.querySelector('button[aria-label="Add child to Shared page"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll('button[aria-haspopup="menu"]'),
    ).toHaveLength(1);
    const menuItems = await openActions(container);
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      "Remove from favorites",
    ]);

    await act(async () => {
      menuItems[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onRemoveFavorite).toHaveBeenCalledOnce();

    cleanup(root, container);
  });

  it("lets a viewer add a tree page to personal Favorites and nothing else", async () => {
    const onToggleFavorite = vi.fn();
    const { container, root } = await render(
      treeItem(documentForRole("viewer"), onToggleFavorite),
    );

    expect(
      container.querySelector('button[aria-label="Add child to Shared page"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll('button[aria-haspopup="menu"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[aria-label="Shared page"]')?.className,
    ).not.toContain("cursor-grab");
    expect(useSortableMock).toHaveBeenLastCalledWith({
      id: "shared",
      disabled: true,
    });

    const menuItems = await openActions(container);
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      "Add to favorites",
    ]);

    await act(async () => {
      menuItems[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onToggleFavorite).toHaveBeenCalledOnce();
    expect(onToggleFavorite).toHaveBeenCalledWith("shared", true);

    cleanup(root, container);
  });

  it.each([
    ["editor", ["Add to favorites", "Add to context"], false],
    ["admin", ["Add to favorites", "Add to context", "Delete"], true],
    ["owner", ["Add to favorites", "Add to context", "Delete"], true],
  ] as const)(
    "preserves the existing %s tree actions",
    async (role, expectedMenuItems, canManage) => {
      const { container, root } = await render(treeItem(documentForRole(role)));

      expect(
        container.querySelectorAll('button[aria-haspopup="menu"]'),
      ).toHaveLength(2);
      expect(
        container.querySelector('[aria-label="Shared page"]')?.className,
      ).toContain("cursor-grab");
      expect(useSortableMock).toHaveBeenLastCalledWith({
        id: "shared",
        disabled: false,
      });

      const menuItems = await openActions(container);
      expect(
        menuItems.map((item) => item.textContent?.trim().replace(/[.…]+$/, "")),
      ).toEqual(expectedMenuItems);
      expect(menuItems.some((item) => item.textContent === "Delete")).toBe(
        canManage,
      );

      cleanup(root, container);
    },
  );
});
