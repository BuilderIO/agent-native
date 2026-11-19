import { tweakSelectionsHash } from "@shared/resolve-tweaks";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import type { PendingTweakSave } from "@/pages/design-editor/tweak-save";

import {
  sendLatestTweakSave,
  sendLatestTweakSaveKeepalive,
  type PersistTweakSaveArgs,
} from "./persist-tweak-save";

const keepaliveCall = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({
  tryCallActionKeepalive: keepaliveCall,
  useActionMutation: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

const PENDING: PendingTweakSave = {
  selections: {},
  revision: 1,
  expectedSelectionsHash: tweakSelectionsHash({}),
};

function setup(options: {
  apply: () => Promise<unknown>;
  journaled?: boolean;
}) {
  const noteSaveLeftQueued = vi.fn();
  const warnChangesWillRetry = vi.fn();
  const args: PersistTweakSaveArgs = {
    acknowledgeOutboxEntry: vi.fn(async () => {}),
    applyTweaksAsync: vi.fn(
      options.apply,
    ) as unknown as PersistTweakSaveArgs["applyTweaksAsync"],
    canEditDesignRef: { current: true },
    confirmedTweakSelectionsRef: {
      current: {
        selections: {},
        hash: tweakSelectionsHash({}),
        selectionsRevision: 0,
      },
    },
    createTweakSaveOutboxEntry: (pending) =>
      createDesignSaveOutboxEntry({
        designId: "design-1",
        actorScope: "user-1",
        actionName: "apply-tweaks",
        resourceId: "design-1",
        operationSource: "tab-a:save:1",
        operationRevision: pending.revision,
        payload: {
          designId: "design-1",
          selections: pending.selections,
          expectedSelectionsHash: pending.expectedSelectionsHash,
        },
      }),
    id: "design-1",
    journalTweakOutboxEntry: vi.fn(async () => options.journaled ?? true),
    keepaliveTweakSaveInFlightRef: { current: null },
    keepaliveTweakSaveRevisionRef: { current: 0 },
    noteSaveLeftQueued,
    pendingTweakSaveRef: { current: PENDING },
    queryClient: {
      setQueryData: vi.fn(),
    } as unknown as PersistTweakSaveArgs["queryClient"],
    setTweakSaveActive: vi.fn(),
    t: (key) => key,
    tweakSaveInFlightRef: { current: null },
    tweakSaveRevisionRef: { current: 1 },
    warnChangesWillRetry,
  };
  return { args, noteSaveLeftQueued, warnChangesWillRetry };
}

async function runToCompletion(args: PersistTweakSaveArgs) {
  sendLatestTweakSave(args);
  await vi.waitFor(() => expect(args.tweakSaveInFlightRef.current).toBeNull());
}

describe("runPersistTweakSave queued-save signal", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an offline save that stays journaled for the replay", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const { args, noteSaveLeftQueued, warnChangesWillRetry } = setup({
      apply: async () => {
        throw new Error("Failed to fetch");
      },
    });

    await runToCompletion(args);

    expect(warnChangesWillRetry).toHaveBeenCalledOnce();
    expect(noteSaveLeftQueued).toHaveBeenCalledOnce();
  });

  it("reports a refused save that stays journaled", async () => {
    const { args, noteSaveLeftQueued } = setup({
      apply: async () => {
        throw Object.assign(new Error("Internal server error"), {
          status: 500,
        });
      },
    });

    await runToCompletion(args);

    expect(noteSaveLeftQueued).toHaveBeenCalledOnce();
  });

  it("hands a conflict back to the person and clears its queued copy", async () => {
    const { args, noteSaveLeftQueued } = setup({
      apply: async () => {
        throw Object.assign(new Error("Tweaks changed"), { status: 409 });
      },
    });

    await runToCompletion(args);

    expect(noteSaveLeftQueued).not.toHaveBeenCalled();
    expect(args.acknowledgeOutboxEntry).toHaveBeenCalledOnce();
  });

  it("keeps the queued copy of a save that failed for another reason", async () => {
    const { args } = setup({
      apply: async () => {
        throw Object.assign(new Error("Internal server error"), {
          status: 500,
        });
      },
    });

    await runToCompletion(args);

    expect(args.acknowledgeOutboxEntry).not.toHaveBeenCalled();
  });

  it("reports nothing when no entry was journaled to replay", async () => {
    const { args, noteSaveLeftQueued } = setup({
      journaled: false,
      apply: async () => {
        throw Object.assign(new Error("Internal server error"), {
          status: 500,
        });
      },
    });

    await runToCompletion(args);

    expect(noteSaveLeftQueued).not.toHaveBeenCalled();
  });

  it("reports nothing when the save lands", async () => {
    const { args, noteSaveLeftQueued } = setup({
      apply: async () => ({
        appliedTweaks: {},
        selectionsHash: tweakSelectionsHash({}),
      }),
    });

    await runToCompletion(args);

    expect(noteSaveLeftQueued).not.toHaveBeenCalled();
  });
});

describe("overlapping page-exit keepalive and normal saves", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("document", { visibilityState: "visible" });
    keepaliveCall.mockReset();
    vi.mocked(toast.error).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores a save response older than the confirmed base", async () => {
    const newerHash = tweakSelectionsHash({ a: 1 });
    const { args } = setup({
      apply: async () => ({
        appliedTweaks: {},
        selectionsHash: tweakSelectionsHash({}),
      }),
    });
    args.confirmedTweakSelectionsRef.current = {
      selections: { a: 1 },
      hash: newerHash,
      selectionsRevision: 0,
      revision: 5,
    };

    await runToCompletion(args);

    expect(args.confirmedTweakSelectionsRef.current.hash).toBe(newerHash);
    expect(args.queryClient.setQueryData).not.toHaveBeenCalled();
  });

  it("accepts the base a keepalive on the wire will leave", async () => {
    const { args } = setup({ apply: async () => ({ appliedTweaks: {} }) });
    args.keepaliveTweakSaveInFlightRef.current = {
      revision: 1,
      selectionsHashIfApplied: "hash-after-keepalive",
    };

    await runToCompletion(args);

    expect(args.applyTweaksAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        inFlightSelectionsHash: "hash-after-keepalive",
      }),
    );
  });

  it("clears a conflicting keepalive and lets the next page exit retry", async () => {
    const { args } = setup({ apply: async () => ({}) });
    keepaliveCall.mockReturnValue({
      accepted: true,
      completion: Promise.reject(
        Object.assign(new Error("Tweaks changed"), { status: 409 }),
      ),
    });

    sendLatestTweakSaveKeepalive(args);
    await vi.waitFor(() =>
      expect(args.keepaliveTweakSaveInFlightRef.current).toBeNull(),
    );
    await vi.waitFor(() =>
      expect(args.acknowledgeOutboxEntry).toHaveBeenCalledOnce(),
    );

    expect(args.keepaliveTweakSaveRevisionRef.current).toBe(0);
    expect(args.noteSaveLeftQueued).not.toHaveBeenCalled();
  });

  it("reports a failed keepalive that stays journaled when the page is still open", async () => {
    const { args, noteSaveLeftQueued } = setup({ apply: async () => ({}) });
    keepaliveCall.mockReturnValue({
      accepted: true,
      completion: Promise.reject(
        Object.assign(new Error("Internal server error"), { status: 500 }),
      ),
    });

    sendLatestTweakSaveKeepalive(args);
    await vi.waitFor(() => expect(noteSaveLeftQueued).toHaveBeenCalledOnce());

    expect(args.acknowledgeOutboxEntry).not.toHaveBeenCalled();
    expect(args.keepaliveTweakSaveRevisionRef.current).toBe(0);
  });

  it("tells the person a failed keepalive was not saved when nothing was journaled", async () => {
    const { args, noteSaveLeftQueued } = setup({
      journaled: false,
      apply: async () => ({}),
    });
    keepaliveCall.mockReturnValue({
      accepted: true,
      completion: Promise.reject(
        Object.assign(new Error("Internal server error"), { status: 500 }),
      ),
    });

    sendLatestTweakSaveKeepalive(args);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());

    expect(toast.error).toHaveBeenCalledWith(
      "designEditor.toasts.tweakSaveNotDurable",
    );
    expect(noteSaveLeftQueued).not.toHaveBeenCalled();
    expect(args.acknowledgeOutboxEntry).not.toHaveBeenCalled();
  });

  it("accepts an earlier keepalive's base when a later page exit sends again", async () => {
    const { args } = setup({ apply: async () => ({}) });
    args.keepaliveTweakSaveInFlightRef.current = {
      revision: 1,
      selectionsHashIfApplied: "hash-after-first-keepalive",
    };
    args.keepaliveTweakSaveRevisionRef.current = 1;
    args.pendingTweakSaveRef.current = { ...PENDING, revision: 2 };
    keepaliveCall.mockReturnValue({
      accepted: true,
      completion: new Promise(() => {}),
    });

    sendLatestTweakSaveKeepalive(args);

    expect(keepaliveCall).toHaveBeenCalledWith(
      "apply-tweaks",
      expect.objectContaining({
        inFlightSelectionsHash: "hash-after-first-keepalive",
      }),
    );
  });
});
