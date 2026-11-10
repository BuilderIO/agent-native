import { tweakSelectionsHash } from "@shared/resolve-tweaks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import type { PendingTweakSave } from "@/pages/design-editor/tweak-save";

import {
  runPersistTweakSave,
  type PersistTweakSaveArgs,
} from "./persist-tweak-save";

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
  const tweakSaveChainRef = { current: Promise.resolve() };
  const args: PersistTweakSaveArgs = {
    acknowledgeOutboxEntry: vi.fn(async () => {}),
    applyTweaksAsync: vi.fn(
      options.apply,
    ) as unknown as PersistTweakSaveArgs["applyTweaksAsync"],
    canEditDesignRef: { current: true },
    confirmedTweakSelectionsHashRef: { current: tweakSelectionsHash({}) },
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
    noteSaveLeftQueued,
    pendingTweakSaveRef: { current: null },
    queryClient: {
      setQueryData: vi.fn(),
    } as unknown as PersistTweakSaveArgs["queryClient"],
    setTweakSaveActive: vi.fn(),
    t: (key) => key,
    tweakSaveChainRef,
    tweakSaveInFlightRef: { current: false },
    tweakSaveRevisionRef: { current: 1 },
    warnChangesWillRetry,
  };
  return { args, noteSaveLeftQueued, warnChangesWillRetry };
}

async function runToCompletion(args: PersistTweakSaveArgs) {
  runPersistTweakSave(args, PENDING);
  await args.tweakSaveChainRef.current;
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

  it("leaves a conflict to the person who made the tweak", async () => {
    const { args, noteSaveLeftQueued } = setup({
      apply: async () => {
        throw Object.assign(new Error("Tweaks changed"), { status: 409 });
      },
    });

    await runToCompletion(args);

    expect(noteSaveLeftQueued).not.toHaveBeenCalled();
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
