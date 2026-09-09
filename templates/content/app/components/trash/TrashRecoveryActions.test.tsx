// @vitest-environment happy-dom

import type { ContentTrashItem } from "@shared/content-trash";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trashRecoveryMessagesByLocale } from "../../trash-messages";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  complete: vi.fn(),
  invalidate: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { count?: number }) => {
    const name = key.replace("trashRecovery.", "");
    const category =
      values?.count === undefined
        ? ""
        : "_" + new Intl.PluralRules("en-US").select(values.count);
    const messages = trashRecoveryMessagesByLocale["en-US"] as Record<
      string,
      string
    >;
    return (messages[name + category] ?? messages[name] ?? key).replace(
      "{{count}}",
      String(values?.count),
    );
  },
}));

import {
  TrashRecoveryActions,
  type TrashRecoveryPlan,
} from "./TrashRecoveryActions";

function item(id: string): ContentTrashItem {
  return {
    documentId: id,
    title: `Page ${id}`,
    databaseId: null,
    kind: "page",
    trashedAt: "2026-09-09T10:00:00Z",
    trashedBy: null,
    trashOrigin: null,
    trashRootId: id,
    parentId: null,
    parentTitle: null,
    spaceId: null,
    spaceName: null,
    canRestore: true,
    canPermanentlyDelete: true,
  };
}
function plan(
  id: string,
  affected = [id],
  needsDestination = false,
): TrashRecoveryPlan {
  return {
    documentId: id,
    affectedDocumentIds: affected,
    affectedDatabaseIds: [],
    scopeToken: `fresh-${id}`,
    needsDestination,
    destinations: [],
    hasMoreDestinations: false,
  };
}

describe("Trash recovery confirmation", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.callAction.mockImplementation(
      async (action: string, args: { id: string }) =>
        action === "plan-content-trash-recovery" ? plan(args.id) : {},
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  async function render(items = [item("one")]) {
    await act(async () =>
      root.render(
        <TrashRecoveryActions items={items} onComplete={mocks.complete} />,
      ),
    );
  }
  async function click(label: string, inDialog = false) {
    const scope = inDialog
      ? document.querySelector('[role="alertdialog"]')!
      : container;
    const button = [...scope.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === label,
    );
    expect(button, document.body.innerHTML).toBeTruthy();
    await act(async () => button!.click());
    return button!;
  }
  function mutations() {
    return mocks.callAction.mock.calls.filter(
      ([name]) => name !== "plan-content-trash-recovery",
    );
  }

  it("plans on open but Cancel never mutates", async () => {
    await render();
    await click("Delete permanently");
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("1 page will be permanently deleted.");
    await click("Cancel", true);
    expect(mutations()).toHaveLength(0);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("confirms the union count and sends the ancestor's exact fresh scope token once", async () => {
    mocks.callAction.mockImplementation(
      async (action: string, args: { id: string }) =>
        action === "plan-content-trash-recovery"
          ? plan(
              args.id,
              args.id === "parent" ? ["parent", "child"] : ["child"],
            )
          : {},
    );
    await render([item("child"), item("parent")]);
    await click("Delete permanently");
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("2 pages will be permanently deleted.");
    await click("Delete permanently", true);
    expect(mutations()).toEqual([
      [
        "permanently-delete-document",
        { id: "parent", scopeToken: "fresh-parent" },
      ],
    ]);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it("restores with a scope token and leaves original destination omitted", async () => {
    await render();
    await click("Restore");
    await click("Restore", true);
    expect(mutations()).toEqual([
      ["restore-document", { id: "one", scopeToken: "fresh-one" }],
    ]);
  });

  it("requires explicit choice when original parent is unavailable", async () => {
    mocks.callAction.mockResolvedValue(plan("one", ["one"], true));
    await render();
    await click("Restore");
    const button = await click("Restore", true);
    expect(button.disabled).toBe(true);
    expect(mutations()).toHaveLength(0);
  });

  it("shows partial failure by item and does not clear failed selection", async () => {
    mocks.callAction.mockImplementation(
      async (action: string, args: { id: string }) => {
        if (action === "plan-content-trash-recovery") return plan(args.id);
        if (args.id === "two") throw new Error("Scope changed; inspect again");
        return {};
      },
    );
    await render([item("one"), item("two")]);
    await click("Delete permanently");
    await click("Delete permanently", true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Page two: Scope changed; inspect again",
    );
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["action"] });
  });

  it("sends explicit null only after choosing the same-space root", async () => {
    mocks.callAction.mockImplementation(async (action: string) =>
      action === "plan-content-trash-recovery"
        ? plan("one", ["one"], true)
        : {},
    );
    await render();
    await click("Restore");
    const trigger = document.querySelector('[aria-label="Restore to"]')!;
    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    const option = [
      ...document.querySelectorAll('[role="menuitemradio"]'),
    ].find(
      (entry) => entry.textContent === "Root of the same space",
    ) as HTMLElement;
    expect(option, document.body.innerHTML).toBeTruthy();
    await act(async () => option.click());
    await click("Restore", true);
    expect(mutations()).toEqual([
      [
        "restore-document",
        {
          id: "one",
          scopeToken: "fresh-one",
          destinationParentId: null,
        },
      ],
    ]);
  });

  it.each([1, 2])(
    "discloses %s surviving pages without adding them to the deletion count",
    async (count) => {
      mocks.callAction.mockImplementation(
        async (_action: string, args: { id: string }) => ({
          ...plan(args.id),
          detachedDocumentIds: ["survivor-one", "survivor-two"].slice(0, count),
        }),
      );
      await render();
      await click("Delete permanently");
      const confirmation = document.querySelector(
        '[role="alertdialog"]',
      )?.textContent;
      expect(confirmation).toContain("1 page will be permanently deleted.");
      expect(confirmation).toContain(
        count === 1
          ? "1 surviving page will be moved to the root of its current space."
          : "2 surviving pages will be moved to the root of their current space.",
      );
      expect(mutations()).toHaveLength(0);
    },
  );

  it("restores a legacy database using its bound identity without a fabricated scope token", async () => {
    await render([
      {
        ...item("legacy"),
        kind: "database",
        databaseId: "legacy-db",
        legacyRestoreDatabaseId: "legacy-db",
      },
    ]);
    const deleteButton = await click("Delete permanently");
    expect(deleteButton.disabled).toBe(true);
    expect(mocks.callAction).not.toHaveBeenCalled();
    await click("Restore");
    expect(document.querySelector('[aria-label="Restore to"]')).toBeNull();
    expect(mocks.callAction).not.toHaveBeenCalled();
    await click("Restore", true);
    expect(mocks.callAction.mock.calls).toEqual([
      [
        "restore-content-database",
        {
          databaseId: "legacy-db",
          expectedLegacyDocumentId: "legacy",
        },
      ],
    ]);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it("Escape dismisses only the destination menu, then Cancel restores initiating focus", async () => {
    await render();
    const restoreButton = await click("Restore");
    const trigger = document.querySelector(
      '[aria-label="Restore to"]',
    ) as HTMLElement;
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu).toBeTruthy();
    await act(async () => {
      menu.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click("Cancel", true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(restoreButton);
    expect(mutations()).toHaveLength(0);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });
});
