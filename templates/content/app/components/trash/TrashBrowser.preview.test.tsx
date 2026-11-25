// @vitest-environment happy-dom

import { createElement, useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { byLabel, click, renderUi } from "@/test-utils/render-ui";

import { TrashBrowser } from "./TrashBrowser";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

// One trashed page. Each read answers with the same objects, as a cached
// query does.
const reads = vi.hoisted(() => {
  const page = {
    documentId: "page-1",
    databaseId: null,
    legacyRestoreDatabaseId: null,
    title: "Launch notes",
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
  };
  return {
    trash: {
      data: { pages: [{ items: [page] }] },
      isSuccess: true,
      isError: false,
      isPending: false,
      hasNextPage: false,
    },
    spaces: { data: { spaces: [] } },
    restore: { mutateAsync: () => Promise.resolve(), isPending: false },
  };
});
vi.mock("@/hooks/use-content-trash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-trash")>()),
  useContentTrash: () => reads.trash,
  useRestoreTrashItem: () => reads.restore,
  useTrashContext: () => {},
}));
vi.mock("@/hooks/use-content-spaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-spaces")>()),
  useContentSpaces: () => reads.spaces,
}));
// The preview reads the trashed page; here it only offers its close button.
vi.mock("@/components/editor/TrashDocumentPreview", () => ({
  TrashDocumentPreview: ({ onClose }: { onClose?: () => void }) =>
    onClose
      ? createElement("button", { type: "button", onClick: onClose }, "Close")
      : null,
}));

describe("Trash preview", () => {
  it.each([
    ["the page's name", () => document.body.querySelector<HTMLElement>("a")],
    ["its Preview button", () => byLabel("trash.preview")],
  ])(
    "keeps its URL in step when opened from %s and closed",
    async (_, opener) => {
      let location = "";
      function LocationProbe() {
        const current = useLocation();
        useEffect(() => {
          location = current.pathname + current.search;
        });
        return null;
      }
      renderUi(
        createElement(
          MemoryRouter,
          { initialEntries: ["/trash"] },
          createElement(LocationProbe),
          createElement(TooltipProvider, null, createElement(TrashBrowser)),
        ),
      );
      const open = opener();
      if (!open) throw new Error("The trashed page has no way to open.");

      await click(open);
      expect(location).toBe("/trash?preview=page-1");
      const closeButton = () =>
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "Close",
        );
      const close = closeButton();
      if (!close) throw new Error("The preview did not open.");

      await click(close);
      expect(location).toBe("/trash");
      expect(closeButton()).toBeUndefined();
    },
  );
});
