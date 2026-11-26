// @vitest-environment happy-dom
import { tweakSelectionsHash } from "@shared/resolve-tweaks";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keepalive = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  completion: null as Promise<unknown> | null,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  tryCallActionKeepalive: vi.fn(
    (_name: string, params: Record<string, unknown>) => {
      keepalive.calls.push(params);
      return {
        accepted: true,
        completion: keepalive.completion ?? new Promise(() => {}),
      };
    },
  ),
}));
vi.mock("@/lib/design-save-outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/design-save-outbox")>()),
  journalDesignSaveOutboxEntry: vi.fn(async () => {}),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";

import { useTweaks, type UseTweaksResult } from "./use-tweaks";

const PERSISTED = { speed: 0 };
const DESIGN = {
  data: JSON.stringify({
    tweaks: [
      {
        id: "speed",
        label: "Speed",
        type: "slider",
        min: 0,
        max: 10,
        step: 0.1,
        defaultValue: 0,
      },
    ],
    tweakSelections: PERSISTED,
  }),
};

interface Deferred {
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const roots: ReturnType<typeof createRoot>[] = [];

function mountTweaks(designData: { data: string } = DESIGN) {
  const saves: Deferred[] = [];
  const applyTweaksAsync = vi.fn(
    (params: Record<string, unknown>) =>
      new Promise((resolve, reject) => {
        saves.push({ params, resolve, reject });
      }),
  );
  const result = { current: undefined as unknown as UseTweaksResult };
  let args: Parameters<typeof useTweaks>[0];
  const queryClient = {
    setQueryData: (
      _key: unknown,
      update: (old: { data: string }) => { data: string },
    ) => {
      args.design = update(args.design as { data: string });
    },
  };
  args = {
    acknowledgeOutboxEntry: async () => {},
    applyTweaksAsync: applyTweaksAsync as never,
    canEditDesign: true,
    canEditDesignRef: { current: true },
    design: designData,
    designSaveActorScope: "user-1",
    designSaveOperationSourceRef: { current: "tab-a" },
    id: "design-1",
    noteSaveLeftQueued: () => {},
    queryClient: queryClient as never,
    t: (key) => key,
    warnChangesWillRetry: () => {},
  };
  function Probe() {
    result.current = useTweaks(args);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  return {
    result,
    saves,
    applyTweaksAsync,
    rerender: (nextData: { data: string }) => {
      args.design = nextData;
      act(() => root.render(createElement(Probe)));
    },
  };
}

function succeed(save: Deferred, selectionsRevision?: number) {
  const selections = save.params.selections as Record<string, unknown>;
  const applied = { ...PERSISTED, ...selections };
  save.resolve({
    appliedTweaks: applied,
    selectionsHash: tweakSelectionsHash(applied, selectionsRevision),
    ...(selectionsRevision === undefined ? {} : { selectionsRevision }),
  });
}

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function scrubTo(result: { current: UseTweaksResult }, value: number) {
  act(() => result.current.handleTweakChange("speed", value));
  await act(async () => {
    vi.advanceTimersByTime(700);
  });
  await flushMicrotasks();
}

describe("useTweaks save scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: true });
    keepalive.calls = [];
    keepalive.completion = null;
    vi.mocked(toast.error).mockClear();
  });
  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps saved selections pending across reload until source handoff advances the baseline", () => {
    const { result, rerender } = mountTweaks({
      data: JSON.stringify({
        ...JSON.parse(DESIGN.data),
        tweakSelections: { speed: 3 },
        tweakSourceBaseline: { speed: 0 },
      }),
    });
    expect(result.current.pendingTweakChanges).toMatchObject([
      { id: "speed", oldValue: 0, newValue: 3 },
    ]);

    rerender({
      data: JSON.stringify({
        ...JSON.parse(DESIGN.data),
        tweakSelections: { speed: 3 },
        tweakSourceBaseline: { speed: 3 },
      }),
    });
    expect(result.current.pendingTweakChanges).toEqual([]);
  });

  it("keeps pending changes unknown and warns when the baseline data is malformed", async () => {
    const { result, saves } = mountTweaks({ data: "{" });
    await flushMicrotasks();

    expect(result.current.pendingTweakChanges).toEqual([]);
    expect(toast.warning).toHaveBeenCalledWith(
      "designEditor.toasts.tweakBaselineUnreadable",
      expect.objectContaining({
        action: expect.objectContaining({
          label: "designEditor.toasts.resetTweakBaseline",
        }),
      }),
    );
    expect(result.current.tweakMutationsEnabled).toBe(false);
    expect(result.current.handleTweakChange("speed", 4)).toEqual({
      accepted: false,
      reason: "baseline_unreadable",
    });
    expect(saves).toHaveLength(0);
  });

  it("coalesces changes made during an in-flight save into one latest-values save", async () => {
    const { result, saves } = mountTweaks();

    await scrubTo(result, 1);
    expect(saves).toHaveLength(1);
    await scrubTo(result, 2);
    await scrubTo(result, 3);
    await scrubTo(result, 1.8);
    expect(saves).toHaveLength(1);

    succeed(saves[0]!);
    await flushMicrotasks();

    expect(saves).toHaveLength(2);
    expect(saves[1]!.params.selections).toEqual({ speed: 1.8 });
    expect(saves[1]!.params.expectedSelectionsHash).toBe(
      tweakSelectionsHash({ speed: 1 }),
    );

    succeed(saves[1]!);
    await flushMicrotasks();
    expect(saves).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("returns the committed selection revision after settling a queued save", async () => {
    const { result, saves, rerender } = mountTweaks({
      data: JSON.stringify({
        ...JSON.parse(DESIGN.data),
        tweakSelectionsRevision: 4,
      }),
    });
    act(() => result.current.handleTweakChange("speed", 3));

    let settledRevision: number | null | undefined;
    let settling!: Promise<number | null>;
    act(() => {
      settling = result.current.settlePendingTweakSaves().then((revision) => {
        settledRevision = revision;
        return revision;
      });
    });
    await flushMicrotasks();
    expect(saves).toHaveLength(1);

    succeed(saves[0]!, 5);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await expect(settling).resolves.toBe(5);
    expect(settledRevision).toBe(5);
    await expect(result.current.settlePendingTweakSaves()).resolves.toBe(5);

    const refreshedDesign = JSON.parse(DESIGN.data) as Record<string, unknown>;
    refreshedDesign.tweakSelections = { speed: 2 };
    refreshedDesign.tweakSelectionsRevision = 6;
    rerender({ data: JSON.stringify(refreshedDesign) });
    await expect(result.current.settlePendingTweakSaves()).resolves.toBeNull();
  });

  it("flushes the latest values on pagehide while a save is in flight", async () => {
    const { result, saves } = mountTweaks();

    await scrubTo(result, 1);
    expect(saves).toHaveLength(1);
    act(() => result.current.handleTweakChange("speed", 1.8));

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      // A closing page gets no later task to send from.
      expect(keepalive.calls).toHaveLength(1);
    });
    await flushMicrotasks();

    expect(keepalive.calls).toHaveLength(1);
    expect(keepalive.calls[0]!.selections).toEqual({ speed: 1.8 });
    // The in-flight save may land before or after this request does.
    expect(keepalive.calls[0]!.expectedSelectionsHash).toBe(
      tweakSelectionsHash(PERSISTED),
    );
    expect(keepalive.calls[0]!.inFlightSelectionsHash).toBe(
      tweakSelectionsHash({ speed: 1 }, 1),
    );
  });

  it("flushes the latest values when the page is hidden, once per revision", async () => {
    const { result } = mountTweaks();
    act(() => result.current.handleTweakChange("speed", 4));

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });
    await flushMicrotasks();
    visibility.mockRestore();

    expect(keepalive.calls).toHaveLength(1);
    expect(keepalive.calls[0]!.selections).toEqual({ speed: 4 });
    expect(keepalive.calls[0]!.inFlightSelectionsHash).toBeUndefined();
  });

  it("does not report a conflict for an in-flight save the keepalive overtook", async () => {
    let finishKeepalive!: (value: unknown) => void;
    keepalive.completion = new Promise((resolve) => {
      finishKeepalive = resolve;
    });
    const { result, saves } = mountTweaks();

    await scrubTo(result, 1);
    act(() => result.current.handleTweakChange("speed", 1.8));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await flushMicrotasks();

    const landed = { speed: 1.8 };
    finishKeepalive({
      appliedTweaks: landed,
      selectionsHash: tweakSelectionsHash(landed),
    });
    await flushMicrotasks();
    saves[0]!.reject(
      Object.assign(new Error("Tweaks changed"), { status: 409 }),
    );
    await flushMicrotasks();

    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.tweakSelections).toEqual({ speed: 1.8 });
  });

  it("still reports a failed save loudly", async () => {
    const { result, saves } = mountTweaks();

    await scrubTo(result, 1);
    saves[0]!.reject(
      Object.assign(new Error("Tweaks changed"), { status: 409 }),
    );
    await flushMicrotasks();

    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.tweakConflict",
    );
  });
});
