// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
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

import { DocumentTreeItem } from "./DocumentTreeItem";

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
      <AgentNativeI18nProvider
        initialLocale="en-US"
        persistPreference={false}
        catalog={{
          sourceLocale: "en-US",
          messages: {
            creativeContext: { addToContext: "Add to context" },
            database: { delete: "Delete" },
            sidebar: {
              addChild: "Add child",
              addChildTo: "Add child to {{title}}",
              database: "Database",
              page: "Page",
              pinToSidebar: "Pin to sidebar",
              unpinFromSidebar: "Unpin from sidebar",
              untitled: "Untitled",
            },
          },
        }}
      >
        <MemoryRouter>
          <TooltipProvider>{node}</TooltipProvider>
        </MemoryRouter>
      </AgentNativeI18nProvider>,
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
  onCreateChildPage: (id: string) => void = () => {},
  onCreateChildDatabase: (id: string) => void = () => {},
) {
  return (
    <DocumentTreeItem
      node={{ ...document, children: [] } satisfies DocumentTreeNode}
      depth={0}
      activeId={null}
      expandedIds={new Set()}
      onToggleExpanded={() => {}}
      onSelect={() => {}}
      onCreateChildPage={onCreateChildPage}
      onCreateChildDatabase={onCreateChildDatabase}
      onDelete={() => {}}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

describe("sidebar document permission menus", () => {
  it("keeps the tree-row add-child slot disabled beside Pin", async () => {
    const onToggleFavorite = vi.fn();
    const onCreateChildPage = vi.fn();
    const onCreateChildDatabase = vi.fn();
    const { container, root } = await render(
      treeItem(
        documentForRole("viewer"),
        onToggleFavorite,
        onCreateChildPage,
        onCreateChildDatabase,
      ),
    );

    const moreActions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Shared page"]',
    );
    const addChild = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add child to Shared page"]',
    );
    if (!moreActions || !addChild) {
      throw new Error("Expected aligned viewer sidebar controls");
    }
    expect(addChild.disabled).toBe(true);
    expect(addChild.className).toContain("h-7 w-7");
    expect(addChild.className).toContain("text-muted-foreground/50");
    expect(moreActions.compareDocumentPosition(addChild)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
    addChild.focus();
    addChild.click();
    addChild.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    addChild.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: " " }),
    );
    expect(document.activeElement).not.toBe(addChild);
    expect(onCreateChildPage).not.toHaveBeenCalled();
    expect(onCreateChildDatabase).not.toHaveBeenCalled();

    const menuItems = await openActions(container);
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      "Pin to sidebar",
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
    ["editor", ["Pin to sidebar", "Add to context"], false],
    ["admin", ["Pin to sidebar", "Add to context", "Delete"], true],
    ["owner", ["Pin to sidebar", "Add to context", "Delete"], true],
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
