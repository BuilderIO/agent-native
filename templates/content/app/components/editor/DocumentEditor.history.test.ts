import { describe, expect, it, vi } from "vitest";

import {
  applyHistoryToDocumentBody,
  resolveAcknowledgedDocumentSnapshot,
} from "./DocumentEditor";

describe("document editor history", () => {
  it("applies database Page recovery without a rich-text controller while requiring one for ordinary Pages", () => {
    const restored = {
      content: "Earlier body",
      updatedAt: "2026-09-09T10:00:00.000Z",
      revision: "12:restored-hash",
    };
    expect(applyHistoryToDocumentBody(true, null, restored)).toBe(true);
    expect(applyHistoryToDocumentBody(false, null, restored)).toBe(false);
    const controller = {
      undo: vi.fn(),
      redo: vi.fn(),
      replaceWithAuthoritativeContent: vi.fn(() => false),
    };
    expect(applyHistoryToDocumentBody(false, controller, restored)).toBe(false);
    controller.replaceWithAuthoritativeContent.mockReturnValue(true);
    expect(applyHistoryToDocumentBody(false, controller, restored)).toBe(true);
    expect(controller.replaceWithAuthoritativeContent).toHaveBeenLastCalledWith(
      {
        content: restored.content,
        contentUpdatedAt: restored.updatedAt,
        contentRevision: restored.revision,
      },
    );
  });

  it("keeps the whole acknowledged document monotonic across stale query replays", () => {
    const snapshot = (title: string, content: string, updatedAt: string) => ({
      id: "page-a",
      title,
      content,
      updatedAt,
    });
    const restoredA = snapshot(
      "Restored A title",
      "Restored A body",
      "2026-09-08T14:00:02.000Z",
    );
    const oldB = snapshot(
      "Old B title",
      "Old B body",
      "2026-09-08T14:00:01.000Z",
    );
    const newerC = snapshot(
      "Newer C title",
      "Newer C body",
      "2026-09-08T14:00:03.000Z",
    );

    let resolved = resolveAcknowledgedDocumentSnapshot({
      currentDocumentId: "page-a",
      incoming: oldB,
      acknowledged: restoredA,
    });
    expect(resolved.document).toBe(restoredA);

    resolved = resolveAcknowledgedDocumentSnapshot({
      currentDocumentId: "page-a",
      incoming: newerC,
      acknowledged: resolved.acknowledged,
    });
    expect(resolved.document).toBe(newerC);

    resolved = resolveAcknowledgedDocumentSnapshot({
      currentDocumentId: "page-a",
      incoming: oldB,
      acknowledged: resolved.acknowledged,
    });
    expect(resolved.document).toBe(newerC);
    expect(resolved.document).toEqual({
      id: "page-a",
      title: "Newer C title",
      content: "Newer C body",
      updatedAt: "2026-09-08T14:00:03.000Z",
    });
  });
});
