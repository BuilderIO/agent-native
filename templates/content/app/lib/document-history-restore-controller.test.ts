import { describe, expect, it, vi } from "vitest";

import {
  applyRegisteredDocumentHistoryRestore,
  prepareRegisteredDocumentHistoryRestore,
  registerDocumentHistoryRestoreController,
} from "./document-history-restore-controller";

describe("document history restore controller", () => {
  it("flushes the current draft before restore and installs the restored document afterward", async () => {
    const events: string[] = [];
    const restored = {
      id: "page-a",
      parentId: null,
      title: "Earlier title",
      content: "Earlier body",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-09-09T10:00:00.000Z",
      updatedAt: "2026-09-09T10:01:00.000Z",
    };
    const unregister = registerDocumentHistoryRestoreController("page-a", {
      prepareRestore: vi.fn(async () => {
        events.push("flush-current-draft");
        return "2026-09-09T10:00:30.000Z";
      }),
      applyRestore: vi.fn(async (document) => {
        events.push(`install-${document.title}`);
        return { status: "applied" } as const;
      }),
    });

    const expectedUpdatedAt = await prepareRegisteredDocumentHistoryRestore(
      "page-a",
      "editor is not ready",
    );
    events.push(`restore-from-${expectedUpdatedAt}`);
    expect(
      await applyRegisteredDocumentHistoryRestore("page-a", restored),
    ).toBe(true);
    expect(events).toEqual([
      "flush-current-draft",
      "restore-from-2026-09-09T10:00:30.000Z",
      "install-Earlier title",
    ]);

    unregister();
    await expect(
      prepareRegisteredDocumentHistoryRestore("page-a", "editor is not ready"),
    ).rejects.toThrow("editor is not ready");
  });

  it("does not let an older registration remove the active controller", async () => {
    const removeOld = registerDocumentHistoryRestoreController("page-a", {
      prepareRestore: async () => "old",
      applyRestore: async () => ({ status: "applied" }),
    });
    const removeCurrent = registerDocumentHistoryRestoreController("page-a", {
      prepareRestore: async () => "current",
      applyRestore: async () => ({ status: "applied" }),
    });

    removeOld();
    await expect(
      prepareRegisteredDocumentHistoryRestore("page-a", "editor is not ready"),
    ).resolves.toBe("current");
    removeCurrent();
  });
});
