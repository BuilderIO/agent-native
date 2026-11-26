// @vitest-environment happy-dom

import type { ContentTrashItem } from "@shared/content-trash";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatabaseTableColumnOrder } from "@/components/editor/database/DatabaseTableGrid";
import { TooltipProvider } from "@/components/ui/tooltip";

import { TRASH_TABLE_COLUMNS, TrashRow } from "./TrashRow";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "Sep 14, 2026" }),
}));
vi.mock("react-router", () => ({
  Link: ({
    children,
    to: _to,
    ...props
  }: React.ComponentProps<"a"> & { to: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const item = {
  documentId: "page-1",
  databaseId: null,
  legacyRestoreDatabaseId: null,
  title: "Roadmap",
  kind: "page",
  createdByState: "unresolved",
  updatedByState: "unresolved",
  trashedAt: "2026-09-14T00:00:00.000Z",
  trashedBy: null,
  trashedByState: "unresolved",
  trashOrigin: null,
  trashRootId: "page-1",
  parentId: null,
  parentTitle: null,
  spaceId: "space-1",
  spaceName: "Space",
  canRestore: true,
  canPermanentlyDelete: true,
  hasAccessibleTrashedChildren: false,
} satisfies ContentTrashItem;

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function renderRow(row: ContentTrashItem = item) {
  const handlers = {
    onOpen: vi.fn(),
    onRestore: vi.fn(),
    onDelete: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <TooltipProvider>
        <DatabaseTableColumnOrder.Provider value={TRASH_TABLE_COLUMNS}>
          <TrashRow
            item={row}
            selected={false}
            expanded={false}
            onSelect={() => {}}
            onToggle={() => {}}
            {...handlers}
            focused
            rowRef={() => {}}
            onFocus={() => {}}
            onKeyDown={() => {}}
          />
        </DatabaseTableColumnOrder.Provider>
      </TooltipProvider>,
    );
  });
  return { host, handlers };
}

async function openMenu(host: HTMLElement) {
  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="trash.rowActions"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

async function chooseMenuItem(host: HTMLElement, label: string) {
  const menuItem = (await openMenu(host)).find(
    (candidate) => candidate.textContent === label,
  );
  expect(menuItem).not.toBeUndefined();
  await act(async () => menuItem?.click());
}

describe("Trash row actions", () => {
  it("restores from the arrow without opening the preview", async () => {
    const { host, handlers } = await renderRow();
    const arrow = host.querySelector<HTMLButtonElement>(
      'button[aria-label="trash.restore"]',
    );

    await act(async () => arrow?.click());

    expect(handlers.onRestore).toHaveBeenCalledTimes(1);
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("opens a menu with Restore, Open preview, and Delete permanently", async () => {
    const { host } = await renderRow();

    expect((await openMenu(host)).map((entry) => entry.textContent)).toEqual([
      "trash.restore",
      "trash.openPreview",
      "trash.deletePermanently",
    ]);
  });

  it("runs each menu item's action", async () => {
    const { host, handlers } = await renderRow();

    await chooseMenuItem(host, "trash.restore");
    expect(handlers.onRestore).toHaveBeenCalledTimes(1);

    await chooseMenuItem(host, "trash.openPreview");
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);

    await chooseMenuItem(host, "trash.deletePermanently");
    await vi.waitFor(() => expect(handlers.onDelete).toHaveBeenCalledTimes(1));
  });

  it("asks to delete only after the menu has given focus back", async () => {
    const { host, handlers } = await renderRow();
    const dialogButton = document.createElement("button");
    document.body.append(dialogButton);
    let menuOpenAtDelete: boolean | null = null;
    handlers.onDelete.mockImplementation(() => {
      menuOpenAtDelete = document.querySelector('[role="menu"]') !== null;
      dialogButton.focus();
    });

    await chooseMenuItem(host, "trash.deletePermanently");
    await vi.waitFor(() => expect(handlers.onDelete).toHaveBeenCalledTimes(1));

    expect(menuOpenAtDelete).toBe(false);
    expect(document.activeElement).toBe(dialogButton);
  });

  it("disables what the row does not allow", async () => {
    const { host } = await renderRow({
      ...item,
      canRestore: false,
      canPermanentlyDelete: false,
    });
    const entries = await openMenu(host);
    const disabled = (label: string) =>
      entries
        .find((entry) => entry.textContent === label)
        ?.hasAttribute("data-disabled");

    expect(disabled("trash.restore")).toBe(true);
    expect(disabled("trash.openPreview")).toBe(false);
    expect(disabled("trash.deletePermanently")).toBe(true);
  });
});
