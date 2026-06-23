import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPreviewDocumentSaveController,
  type PreviewDocumentPayload,
} from "./previewDocumentSaveController";
import {
  __resetPreviewSaveLanes,
  enqueuePreviewSave,
} from "./previewSaveLane";

beforeEach(() => {
  vi.useFakeTimers();
  __resetPreviewSaveLanes();
});
afterEach(() => vi.useRealTimers());

const initial: PreviewDocumentPayload = { title: "T0", content: "C0" };
const DOC = "doc-1";

// The per-doc lane wraps each save in extra promise hops, so a single
// runAllTicks() may not drain the whole chain. Flush microtasks a few times.
async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i++) {
    await vi.runAllTicks();
    await Promise.resolve();
  }
}

// A passthrough enqueue that runs immediately (no cross-doc serialization
// needed for single-doc tests) — exercises the real lane so ordering is real.
function makeController(args: {
  save: (id: string, p: PreviewDocumentPayload) => Promise<unknown>;
  targetId?: () => string;
  onSaved?: (p: PreviewDocumentPayload) => void;
  onError?: (e: unknown) => void;
  init?: PreviewDocumentPayload;
}) {
  return createPreviewDocumentSaveController({
    initial: args.init ?? initial,
    resolveTargetId: args.targetId ?? (() => DOC),
    enqueue: (id, run) => enqueuePreviewSave(id, run),
    save: args.save,
    onSaved: args.onSaved,
    onError: args.onError,
  });
}

describe("previewDocumentSaveController", () => {
  it("debounces a primary-body edit and persists after the delay, bound to the target id", async () => {
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
    // Dispatched synchronously (write committed-to before teardown).
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

  it("flush does NOT duplicate-save when the in-flight save already covers the latest payload", async () => {
    let resolveFirst: (() => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const c = makeController({ save });

    // Save in flight for "C1"; pending is still exactly "C1".
    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.isSaving).toBe(true);

    // Closing now must NOT issue a second identical save — it's already covered.
    const flushed = c.flush();
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await flushed;
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.lastSaved).toEqual({ title: "T0", content: "C1" });
  });

  it("mark() adopts a new baseline (e.g. row switch) without scheduling a save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = makeController({ save });

    c.mark({ title: "T9", content: "C9" });
    expect(c.hasPendingTimer).toBe(false);
    await c.flush();
    expect(save).not.toHaveBeenCalled();
    expect(c.lastSaved).toEqual({ title: "T9", content: "C9" });
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

  // THE INTEGRATION BUG (facet 1 — trailing edit lost on teardown). A save is in
  // flight AND a trailing edit landed; a flush/teardown must DISPATCH that
  // trailing edit, not drop it behind awaiting the in-flight save.
  it("flush dispatches the trailing edit synchronously even while a save is in flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValue(undefined);
    const c = makeController({ save });

    // First save kicked off and in flight.
    c.changeContent("C1");
    vi.advanceTimersByTime(450);
    await flushMicrotasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.isSaving).toBe(true);

    // Trailing edit, then immediate teardown (flush) BEFORE the in-flight save
    // resolves. The final save must already be enqueued on the lane.
    c.changeContent("C2-trailing");
    const flushed = c.flush();

    // The first save still has to finish before the lane runs the trailing one.
    resolveFirst?.();
    await flushed;
    await flushMicrotasks();

    expect(save).toHaveBeenCalledTimes(2);
    // The LAST write the DB sees is the trailing edit — not dropped.
    expect(save).toHaveBeenLastCalledWith(DOC, {
      title: "T0",
      content: "C2-trailing",
    });
    expect(c.lastSaved).toEqual({ title: "T0", content: "C2-trailing" });
  });

  // THE INTEGRATION BUG (facet 2 — trailing edit retargeted to the new row). The
  // controller services many ids; a flush at row-switch must bind the OLD id.
  it("flush binds the OLD document id even when the target rebases to the new row right after", async () => {
    const calls: Array<{ id: string; payload: PreviewDocumentPayload }> = [];
    let targetId = "old-doc";
    const save = vi.fn().mockImplementation((id: string, payload) => {
      calls.push({ id, payload });
      return Promise.resolve();
    });
    const c = makeController({ save, targetId: () => targetId });

    // Edit the OLD row, then row-switch: flush, THEN rebase target to new row.
    c.changeContent("old-row trailing edit");
    void c.flush(); // dispatches synchronously, binds "old-doc"
    targetId = "new-doc"; // rebase happens immediately after, as in the effect
    await flushMicrotasks();

    expect(calls).toHaveLength(1);
    // Bound to the OLD doc, never retargeted to "new-doc".
    expect(calls[0].id).toBe("old-doc");
    expect(calls[0].payload).toEqual({
      title: "T0",
      content: "old-row trailing edit",
    });
  });

  // Same doc id: two saves commit in issue order, latest payload final.
  it("two saves for the same doc commit in issue order (latest payload wins)", async () => {
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

    // Trailing edit + flush while first is still gated.
    c.changeContent("second");
    void c.flush();

    // Release in order; lane guarantees first runs before second.
    gates[0]?.();
    await flushMicrotasks();
    gates[1]?.();
    await flushMicrotasks();

    expect(order).toEqual(["first", "second"]);
    expect(c.lastSaved).toEqual({ title: "T0", content: "second" });
  });
});

// Integration-level proof of the dispatch/rebase ordering at the SEAM the
// component uses (resolveTargetId ref + the per-doc lane) — without rendering
// all of DocumentDatabase. Mirrors how DatabaseItemPreview wires the controller.
describe("preview save dispatch/rebase ordering (integration seam)", () => {
  beforeEach(() => {
    vi.useRealTimers(); // exercise the real lane microtask ordering
    __resetPreviewSaveLanes();
  });
  afterEach(() => vi.useFakeTimers());

  it("a row-switch dispatches the old row's trailing edit to the OLD id before the new row saves to the NEW id; ids stay independent", async () => {
    const writes: Array<{ id: string; content: string }> = [];
    // Gate per-id so we can prove independence + correct targeting.
    const resolvers = new Map<string, Array<() => void>>();
    const save = (id: string, payload: PreviewDocumentPayload) =>
      new Promise<void>((resolve) => {
        const list = resolvers.get(id) ?? [];
        list.push(() => {
          writes.push({ id, content: payload.content });
          resolve();
        });
        resolvers.set(id, list);
      });

    // The component's saveTargetIdRef; resolveTargetId reads it at dispatch.
    const targetRef = { current: "doc-A" };
    const c = createPreviewDocumentSaveController({
      initial: { title: "TA", content: "A0" },
      resolveTargetId: () => targetRef.current,
      enqueue: (id, run) => enqueuePreviewSave(id, run),
      save,
    });

    // 1) Edit doc-A, then ROW SWITCH: flush (binds doc-A) THEN rebase to doc-B.
    c.changeContent("A-edit");
    void c.flush();
    targetRef.current = "doc-B";
    c.mark({ title: "TB", content: "B0" });

    // 2) Edit doc-B, then close: flush (binds doc-B).
    c.changeContent("B-edit");
    void c.flush();

    // Let each lane's first step run so the gated saves register their resolver.
    const drain = async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };
    await drain();

    // Release doc-B first to prove ids are independent (doc-A not yet released).
    resolvers.get("doc-B")?.forEach((r) => r());
    await drain();
    resolvers.get("doc-A")?.forEach((r) => r());
    await drain();

    // Both writes landed, each on its correct id; the old-row edit was NOT
    // retargeted to doc-B.
    const a = writes.filter((w) => w.id === "doc-A");
    const b = writes.filter((w) => w.id === "doc-B");
    expect(a).toEqual([{ id: "doc-A", content: "A-edit" }]);
    expect(b).toEqual([{ id: "doc-B", content: "B-edit" }]);
  });
});
