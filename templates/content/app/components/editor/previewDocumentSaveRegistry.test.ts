import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPreviewDocumentSaveController,
  deferredPreviewDocumentSave,
  type PreviewDocumentPayload,
} from "./previewDocumentSaveController";
import {
  __resetPreviewDocumentSaveRegistry,
  acquirePreviewDocumentSaveController,
  activePreviewControllerCount,
  peekPreviewDocumentSaveController,
  releasePreviewDocumentSaveController,
} from "./previewDocumentSaveRegistry";

afterEach(() => {
  vi.useRealTimers();
  __resetPreviewDocumentSaveRegistry();
});

const initial: PreviewDocumentPayload = { title: "T0", content: "C0" };

// A factory wired to a save spy, mirroring how DatabaseItemPreview builds one.
function factoryFor(
  documentId: string,
  save: (id: string, p: PreviewDocumentPayload) => Promise<unknown>,
  init: PreviewDocumentPayload = initial,
) {
  return () =>
    createPreviewDocumentSaveController({
      documentId,
      initial: init,
      save: (id, payload) => save(id, payload),
    });
}

describe("previewDocumentSaveRegistry", () => {
  it("returns the SAME controller instance for a doc id while ref-count > 0", () => {
    const id = "doc-1";
    const save = vi.fn().mockResolvedValue(undefined);
    const a = acquirePreviewDocumentSaveController(id, factoryFor(id, save));
    const b = acquirePreviewDocumentSaveController(id, factoryFor(id, save));
    expect(b).toBe(a);
    expect(activePreviewControllerCount()).toBe(1);

    releasePreviewDocumentSaveController(id);
    const c = acquirePreviewDocumentSaveController(id, factoryFor(id, save));
    expect(c).toBe(a);
    expect(activePreviewControllerCount()).toBe(1);
  });

  it("different doc ids get different, independent controllers", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = acquirePreviewDocumentSaveController(
      "doc-A",
      factoryFor("doc-A", save),
    );
    const b = acquirePreviewDocumentSaveController(
      "doc-B",
      factoryFor("doc-B", save),
    );
    expect(a).not.toBe(b);
    expect(a.documentId).toBe("doc-A");
    expect(b.documentId).toBe("doc-B");
    expect(activePreviewControllerCount()).toBe(2);
  });

  it("release flush-then-evicts: the pending edit persists, then the entry is dropped", async () => {
    const id = "doc-1";
    const resolvers: Array<() => void> = [];
    const saved: Array<{ id: string; content: string }> = [];
    const save = (sid: string, payload: PreviewDocumentPayload) => {
      saved.push({ id: sid, content: payload.content });
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };

    vi.useFakeTimers();
    const controller = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, save),
    );

    // Dirty content with no debounce fired yet.
    controller.changeContent("draft");

    // Release the only reference → flush-then-evict. The flush dispatches the
    // save SYNCHRONOUSLY (bound to this doc id), but the controller is NOT evicted
    // until that save settles.
    releasePreviewDocumentSaveController(id);
    expect(saved).toEqual([{ id, content: "draft" }]);
    expect(activePreviewControllerCount()).toBe(1);
    expect(peekPreviewDocumentSaveController(id)).toBe(controller);

    // Settle the flush save → now it evicts.
    await act(() => resolvers[0]!());
    expect(activePreviewControllerCount()).toBe(0);
    expect(peekPreviewDocumentSaveController(id)).toBeUndefined();
  });

  it("keeps a dirty controller after a failed release flush so reopen can retry", async () => {
    const id = "doc-1";
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const controller = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, save),
    );

    controller.changeContent("draft");
    releasePreviewDocumentSaveController(id);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(activePreviewControllerCount()).toBe(1);
    expect(peekPreviewDocumentSaveController(id)).toBe(controller);
    expect(controller.pending).toEqual({ title: "T0", content: "draft" });
    expect(controller.lastSaved).toEqual(initial);

    const reopened = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, save),
    );
    expect(reopened).toBe(controller);

    releasePreviewDocumentSaveController(id);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(id, {
      title: "T0",
      content: "draft",
    });
    expect(activePreviewControllerCount()).toBe(0);
  });

  it("keeps and reuses a hydration-deferred draft across close/reopen", async () => {
    const id = "builder-doc";
    const save = vi
      .fn()
      .mockResolvedValueOnce(deferredPreviewDocumentSave())
      .mockResolvedValueOnce(undefined);
    const controller = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, save),
    );

    controller.changeContent("Draft typed before hydration changed");
    releasePreviewDocumentSaveController(id);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(activePreviewControllerCount()).toBe(1);
    expect(controller.pending.content).toBe(
      "Draft typed before hydration changed",
    );
    expect(controller.lastSaved.content).toBe("C0");
    expect(controller.deferredReason).toBe("hydration");

    const reopened = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, save),
    );
    expect(reopened).toBe(controller);
    await reopened.flush();

    expect(save).toHaveBeenCalledTimes(2);
    expect(reopened.lastSaved.content).toBe(
      "Draft typed before hydration changed",
    );
    expect(reopened.deferredReason).toBeNull();
  });

  it("replaces mount A's adapter with mount B's live adapter before retrying", async () => {
    const id = "builder-doc";
    let resolvePending:
      | ((value: ReturnType<typeof deferredPreviewDocumentSave>) => void)
      | undefined;
    const saveA = vi.fn(
      (_documentId: string, _payload: PreviewDocumentPayload) =>
        new Promise<ReturnType<typeof deferredPreviewDocumentSave>>(
          (resolve) => {
            resolvePending = resolve;
          },
        ),
    );
    const saveB = vi.fn(
      (_documentId: string, _payload: PreviewDocumentPayload) =>
        Promise.resolve(undefined),
    );
    const first = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, saveA),
      (controller) =>
        controller.replaceSaveAdapter({
          save: (documentId, payload) => saveA(documentId, payload),
        }),
    );
    first.changeContent("draft");
    releasePreviewDocumentSaveController(id);

    const reopened = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, saveB),
      (controller) =>
        controller.replaceSaveAdapter({
          save: (documentId, payload) => saveB(documentId, payload),
        }),
    );
    expect(reopened).toBe(first);

    resolvePending?.(deferredPreviewDocumentSave());
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await reopened.flush();

    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveB).toHaveBeenCalledTimes(1);
    expect(reopened.lastSaved.content).toBe("draft");
  });

  it("a flush during release still persists the latest dirty payload bound to the old doc id", async () => {
    const id = "doc-old";
    const saved: Array<{ id: string; content: string }> = [];
    const save = (sid: string, payload: PreviewDocumentPayload) => {
      saved.push({ id: sid, content: payload.content });
      return Promise.resolve();
    };

    const controller = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, save),
    );
    controller.changeContent("unsaved final edit");

    // Release must flush the pending edit (not drop it), bound to the OLD doc id,
    // then evict once the flush settles.
    releasePreviewDocumentSaveController(id);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(saved).toEqual([{ id: "doc-old", content: "unsaved final edit" }]);
    expect(activePreviewControllerCount()).toBe(0);
  });

  it("reopen BEFORE the flush settles reuses the same controller (eviction cancelled)", async () => {
    const id = "doc-1";
    const resolvers: Array<() => void> = [];
    const save = () => new Promise<void>((resolve) => resolvers.push(resolve));

    const first = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, save),
    );
    first.changeContent("content");

    // Release → flush-then-evict starts; the save goes in flight (unresolved).
    releasePreviewDocumentSaveController(id);
    expect(activePreviewControllerCount()).toBe(1);

    // Reopen before the flush settles: same instance, eviction cancelled.
    const second = acquirePreviewDocumentSaveController(
      id,
      factoryFor(id, save),
    );
    expect(second).toBe(first);

    // Even after the in-flight flush save settles, the entry is NOT evicted
    // because it was re-acquired (refCount > 0, evicting cleared).
    await act(() => resolvers.forEach((r) => r()));
    expect(activePreviewControllerCount()).toBe(1);
    expect(peekPreviewDocumentSaveController(id)).toBe(second);
  });

  it("releasing a clean controller is a no-op flush and still evicts (no double-save)", async () => {
    const id = "doc-1";
    const save = vi.fn().mockResolvedValue(undefined);
    acquirePreviewDocumentSaveController(id, factoryFor(id, save));

    releasePreviewDocumentSaveController(id);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(save).not.toHaveBeenCalled();
    expect(activePreviewControllerCount()).toBe(0);
  });
});

// Minimal act() shim: settle promises after a resolver, mirroring how the hook
// awaits flushes. Keeps assertions deterministic.
async function act(fn: () => void): Promise<void> {
  fn();
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
