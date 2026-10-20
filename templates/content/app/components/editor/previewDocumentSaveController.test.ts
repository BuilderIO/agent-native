import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPreviewDocumentSaveController,
  deferredPreviewDocumentSave,
  type PreviewDocumentPayload,
} from "./previewDocumentSaveController";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const initial: PreviewDocumentPayload = { title: "T0", content: "C0" };
const DOC = "doc-1";

async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i++) {
    vi.runAllTicks();
    await Promise.resolve();
  }
}

function makeController(args: {
  save: (id: string, p: PreviewDocumentPayload) => Promise<unknown>;
  documentId?: string;
  onSaved?: (p: PreviewDocumentPayload) => void;
  onError?: (e: unknown) => void;
  init?: PreviewDocumentPayload;
}) {
  return createPreviewDocumentSaveController({
    documentId: args.documentId ?? DOC,
    initial: args.init ?? initial,
    save: (id, payload) => args.save(id, payload),
    onSaved: args.onSaved,
    onError: args.onError,
  });
}

describe("previewDocumentSaveController", () => {
  it("debounces a primary-body edit and persists after the delay, bound to the doc id", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });

    c.changeContent("C1");
    expect(save).not.toHaveBeenCalled();
    expect(c.hasPendingTimer).toBe(true);

    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(save).toHaveBeenCalledExactlyOnceWith(DOC, {
      title: "T0",
      content: "C1",
    });
    expect(c.lastSaved).toEqual({ title: "T0", content: "C1" });
  });

  it("flushes a pending primary-body edit on close/switch/unmount instead of dropping it", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });

    c.changeContent("edited body");
    expect(save).not.toHaveBeenCalled();
    expect(c.hasPendingTimer).toBe(true);

    const flushed = c.flush();
    expect(c.hasPendingTimer).toBe(false);
    expect(save).toHaveBeenCalledExactlyOnceWith(DOC, {
      title: "T0",
      content: "edited body",
    });
    await flushed;
    expect(c.lastSaved).toEqual({ title: "T0", content: "edited body" });
  });

  it("flush issues the save synchronously (write dispatched before async teardown like Open-page)", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });

    c.changeContent("body before navigate");
    void c.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith(DOC, {
      title: "T0",
      content: "body before navigate",
    });
  });

  it("flush is a no-op when nothing is dirty (no double-save of unchanged content)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });
    await c.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("does NOT re-save after a debounced save already persisted (no double-save)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);

    await c.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("tracks locally saved payloads until server state is adopted", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });

    expect(c.hasSavedLocally).toBe(false);
    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();

    expect(c.hasSavedLocally).toBe(true);
    expect(c.lastSaved).toEqual({ title: "T0", content: "C1" });

    c.mark({ title: "T0", content: "C1" });
    expect(c.hasSavedLocally).toBe(false);
  });

  it("marks clean only AFTER the save resolves; a failed save stays dirty and retries on flush", async () => {
    let rejectSave: ((err: unknown) => void) | undefined;
    const onError = vi.fn();
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => (rejectSave = reject)),
      )
      .mockResolvedValue(undefined);
    const c = makeController({ save, onError });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(c.isSaving).toBe(true);
    expect(c.lastSaved).toEqual({ title: "T0", content: "C0" });

    rejectSave?.(new Error("network"));
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledOnce();
    expect(c.lastSaved).toEqual({ title: "T0", content: "C0" });

    const flushed = c.flush();
    await flushed;
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(DOC, { title: "T0", content: "C1" });
    expect(c.lastSaved).toEqual({ title: "T0", content: "C1" });
  });

  it("coalesces edits made while a save is in flight into one trailing save (single-flight)", async () => {
    let resolveFirst: (() => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const c = makeController({ save });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.isSaving).toBe(true);

    c.changeContent("C2");
    c.changeTitle("T1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(DOC, { title: "T1", content: "C2" });
  });

  it("rebases trailing edits onto the timestamp returned by its own save", async () => {
    let resolveFirst:
      | ((value: {
          outcome: "saved";
          loadedUpdatedAt: string;
          loadedContentWasEmpty: boolean;
        }) => void)
      | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({
        outcome: "saved",
        loadedUpdatedAt: "after-second-save",
        loadedContentWasEmpty: false,
      });
    const c = makeController({
      save,
      init: {
        title: "T0",
        content: "",
        loadedUpdatedAt: "before-first-save",
        loadedContentWasEmpty: true,
      },
    });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    c.changeContent("C2");

    resolveFirst?.({
      outcome: "saved",
      loadedUpdatedAt: "after-first-save",
      loadedContentWasEmpty: false,
    });
    await flushMicrotasks();

    expect(save).toHaveBeenLastCalledWith(DOC, {
      title: "T0",
      content: "C2",
      loadedUpdatedAt: "after-first-save",
      loadedContentWasEmpty: false,
    });
  });

  it("flush does NOT duplicate-save when the in-flight save already covers the latest payload", async () => {
    let resolveFirst: (() => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const c = makeController({ save });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.isSaving).toBe(true);

    const flushed = c.flush();
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await flushed;
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.lastSaved).toEqual({ title: "T0", content: "C1" });
  });

  it("mark() adopts a new baseline (e.g. agent edit) without scheduling a save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });

    c.mark({ title: "T9", content: "C9" });
    expect(c.hasPendingTimer).toBe(false);
    await c.flush();
    expect(save).not.toHaveBeenCalled();
    expect(c.lastSaved).toEqual({ title: "T9", content: "C9" });
  });

  it("mark() rebases stale empty pending content onto fresher server content", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({
      save,
      init: {
        title: "Builder row",
        content: "",
        loadedUpdatedAt: "2026-07-02T12:00:00.000Z",
        loadedContentWasEmpty: true,
      },
    });

    c.changeContent("<empty-block/>");
    expect(c.hasPendingTimer).toBe(true);

    c.mark({
      title: "Builder row",
      content: "Hydrated Builder body",
      loadedUpdatedAt: "2026-07-02T12:00:00.000Z",
      loadedContentWasEmpty: false,
    });
    vi.advanceTimersByTime(450);
    await c.flush();

    expect(save).not.toHaveBeenCalled();
    expect(c.pending).toEqual({
      title: "Builder row",
      content: "Hydrated Builder body",
      loadedUpdatedAt: "2026-07-02T12:00:00.000Z",
      loadedContentWasEmpty: false,
    });
  });

  it("keeps a hydration-deferred user edit dirty until a later flush persists it", async () => {
    const onSaved = vi.fn();
    const save = vi
      .fn()
      .mockResolvedValueOnce(deferredPreviewDocumentSave())
      .mockResolvedValueOnce(undefined);
    const c = makeController({
      save,
      onSaved,
      init: {
        title: "Builder row",
        content: "",
        loadedUpdatedAt: "2026-07-02T12:00:00.000Z",
      },
    });

    c.changeContent("Typed while Builder was syncing");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();

    expect(save).toHaveBeenCalledExactlyOnceWith(DOC, {
      title: "Builder row",
      content: "Typed while Builder was syncing",
      loadedUpdatedAt: "2026-07-02T12:00:00.000Z",
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(c.hasSavedLocally).toBe(false);
    expect(c.pending).toEqual({
      title: "Builder row",
      content: "Typed while Builder was syncing",
      loadedUpdatedAt: "2026-07-02T12:00:00.000Z",
    });
    expect(c.lastSaved.content).toBe("");
    expect(c.deferredReason).toBe("hydration");

    await c.flush();

    expect(save).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(c.deferredReason).toBeNull();
    expect(c.pending).toEqual({
      title: "Builder row",
      content: "Typed while Builder was syncing",
      loadedUpdatedAt: "2026-07-02T12:00:00.000Z",
    });
  });

  it("keeps a non-empty conflict-deferred draft dirty and recoverable", async () => {
    const save = vi
      .fn()
      .mockResolvedValue(deferredPreviewDocumentSave("conflict"));
    const c = makeController({ save });

    c.changeContent("User-authored Builder draft");
    await c.flush();

    expect(c.pending.content).toBe("User-authored Builder draft");
    expect(c.lastSaved.content).toBe("C0");
    expect(c.deferredReason).toBe("conflict");
    expect(c.hasSavedLocally).toBe(false);
  });

  it("routes a late save callback conflict to the current mount adapter", async () => {
    const onConflictA = vi.fn();
    const onConflictB = vi.fn();
    let resolveSave:
      | ((value: ReturnType<typeof deferredPreviewDocumentSave>) => void)
      | undefined;
    const snapshot = {
      lastSaved: initial,
      pending: { title: "T0", content: "newer tab draft" },
      deferredReason: "conflict" as const,
    };
    const c = createPreviewDocumentSaveController({
      documentId: DOC,
      initial,
      save: () =>
        new Promise<ReturnType<typeof deferredPreviewDocumentSave>>(
          (resolve) => {
            resolveSave = resolve;
          },
        ),
      onDraftConflict: onConflictA,
    });
    c.changeContent("local edit");
    const flushing = c.flush();
    c.replaceSaveAdapter({
      save: vi.fn().mockResolvedValue(undefined),
      onDraftConflict: onConflictB,
    });

    resolveSave?.(deferredPreviewDocumentSave("conflict", snapshot));
    await flushing;

    expect(onConflictA).not.toHaveBeenCalled();
    expect(onConflictB).toHaveBeenCalledExactlyOnceWith(snapshot);
  });

  it("rebases a recoverable draft only after an explicit keep-local choice", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(deferredPreviewDocumentSave("conflict"))
      .mockResolvedValueOnce(undefined);
    const c = makeController({
      save,
      init: {
        title: "Builder row",
        content: "",
        loadedUpdatedAt: "before-hydration",
        loadedContentWasEmpty: true,
      },
    });

    c.changeContent("My local draft");
    await c.flush();
    c.rebasePending({
      title: "Builder row",
      content: "Fresh Builder body",
      loadedUpdatedAt: "after-hydration",
      loadedContentWasEmpty: false,
    });

    expect(c.pending).toEqual({
      title: "Builder row",
      content: "My local draft",
      loadedUpdatedAt: "after-hydration",
      loadedContentWasEmpty: false,
    });
    expect(c.lastSaved.content).toBe("Fresh Builder body");
    await c.flush();
    expect(save).toHaveBeenLastCalledWith(DOC, c.pending);
    expect(c.lastSaved.content).toBe("My local draft");
  });

  it("preserves a server body when resolving a title-only conflict", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({
      save,
      init: {
        title: "Before",
        content: "Body A",
        loadedUpdatedAt: "v0",
        loadedContentWasEmpty: false,
      },
    });

    c.changeTitle("Local title");
    c.rebasePending({
      title: "External title",
      content: "Body B from another tab",
      loadedUpdatedAt: "v2",
      loadedContentWasEmpty: false,
    });

    expect(c.pending).toEqual({
      title: "Local title",
      content: "Body B from another tab",
      loadedUpdatedAt: "v2",
      loadedContentWasEmpty: false,
    });
    await c.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith(DOC, c.pending);
  });

  it("preserves a server title when resolving a body-only conflict", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({
      save,
      init: {
        title: "Before",
        content: "Body A",
        loadedUpdatedAt: "v0",
        loadedContentWasEmpty: false,
      },
    });

    c.changeContent("Local body");
    c.rebasePending({
      title: "External title",
      content: "Body B from another tab",
      loadedUpdatedAt: "v2",
      loadedContentWasEmpty: false,
    });

    expect(c.pending).toEqual({
      title: "External title",
      content: "Local body",
      loadedUpdatedAt: "v2",
      loadedContentWasEmpty: false,
    });
    await c.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith(DOC, c.pending);
  });

  it("title and content edits both flush together in one payload", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });

    c.changeTitle("new title");
    c.changeContent("new body");
    await c.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith(DOC, {
      title: "new title",
      content: "new body",
    });
  });

  it("exposes its fixed document id and never retargets it", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save, documentId: "doc-fixed" });
    expect(c.documentId).toBe("doc-fixed");
  });

  it("flush persists the trailing edit even while a save is in flight (latest payload final)", async () => {
    let resolveFirst: (() => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const c = makeController({ save });

    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.isSaving).toBe(true);

    c.changeContent("C2-trailing");
    const flushed = c.flush();

    resolveFirst?.();
    await flushed;
    await flushMicrotasks();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(DOC, {
      title: "T0",
      content: "C2-trailing",
    });
    expect(c.lastSaved).toEqual({ title: "T0", content: "C2-trailing" });
  });

  it("two saves for the same doc commit in issue order (no overlap, latest payload wins)", async () => {
    const order: string[] = [];
    const gates: Array<() => void> = [];
    const save = vi.fn().mockImplementation((_id: string, payload) => {
      return new Promise<void>((resolve) => {
        gates.push(() => {
          order.push(payload.content);
          resolve();
        });
      });
    });
    const c = makeController({ save });

    c.changeContent("first");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(c.isSaving).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);

    c.changeContent("second");
    void c.flush();
    expect(save).toHaveBeenCalledTimes(1);

    gates[0]?.();
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(2);
    gates[1]?.();
    await flushMicrotasks();

    expect(order).toEqual(["first", "second"]);
    expect(c.lastSaved).toEqual({ title: "T0", content: "second" });
  });
});

describe("per-doc-controller independence (race-class elimination)", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useFakeTimers());

  it("a row-switch persists the old row's trailing edit to the OLD doc; a new doc's controller is independent", async () => {
    const writes: Array<{ id: string; content: string }> = [];
    const gates = new Map<string, Array<() => void>>();
    const save = (id: string, payload: PreviewDocumentPayload) =>
      new Promise<void>((resolve) => {
        const list = gates.get(id) ?? [];
        list.push(() => {
          writes.push({ id, content: payload.content });
          resolve();
        });
        gates.set(id, list);
      });

    const a = createPreviewDocumentSaveController({
      documentId: "doc-A",
      initial: { title: "TA", content: "A0" },
      save,
    });
    a.changeContent("A-edit");
    const aFlush = a.flush();

    const b = createPreviewDocumentSaveController({
      documentId: "doc-B",
      initial: { title: "TB", content: "B0" },
      save,
    });
    b.changeContent("B-edit");
    const bFlush = b.flush();

    const drain = async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };
    await drain();

    gates.get("doc-B")?.forEach((r) => r());
    await drain();
    gates.get("doc-A")?.forEach((r) => r());
    await drain();
    await Promise.all([aFlush, bFlush]);

    const aWrites = writes.filter((w) => w.id === "doc-A");
    const bWrites = writes.filter((w) => w.id === "doc-B");
    expect(aWrites).toEqual([{ id: "doc-A", content: "A-edit" }]);
    expect(bWrites).toEqual([{ id: "doc-B", content: "B-edit" }]);
  });

  it("an OLD-row in-flight save resolving AFTER a row-switch does NOT alter the new row's controller and does NOT trigger a redundant new-row save", async () => {
    let resolveOld: (() => void) | undefined;
    const oldSave = vi
      .fn()
      .mockImplementation(
        () => new Promise<void>((resolve) => (resolveOld = resolve)),
      );
    const old = createPreviewDocumentSaveController({
      documentId: "doc-old",
      initial: { title: "T", content: "old0" },
      save: oldSave,
    });

    old.changeContent("old-edit");
    void old.flush();
    expect(oldSave).toHaveBeenCalledTimes(1);

    const newSave = vi.fn().mockResolvedValue(undefined);
    const fresh = createPreviewDocumentSaveController({
      documentId: "doc-new",
      initial: { title: "T", content: "new0" },
      save: newSave,
    });
    fresh.mark({ title: "T", content: "new0" });

    resolveOld?.();
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(old.lastSaved).toEqual({ title: "T", content: "old-edit" });
    expect(fresh.lastSaved).toEqual({ title: "T", content: "new0" });
    expect(fresh.pending).toEqual({ title: "T", content: "new0" });
    expect(newSave).not.toHaveBeenCalled();
  });
});
