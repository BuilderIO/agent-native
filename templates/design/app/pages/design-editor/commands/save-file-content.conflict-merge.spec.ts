import {
  applySourceContentPatch,
  sourceContentHash,
  type SourceContentPatch,
} from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetCanvasOutcomeTrackingForTests,
  flushCanvasOutcomeCounts,
  setCanvasOutcomeContext,
} from "@/lib/canvas-outcome-tracking";
import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";

const outcomeMocks = vi.hoisted(() => ({ trackDesignRelay: vi.fn() }));

vi.mock("@/lib/design-relay-tracking", () => ({
  trackDesignRelay: outcomeMocks.trackDesignRelay,
}));

function saveOutcomes(): Record<string, number> {
  flushCanvasOutcomeCounts();
  const out: Record<string, number> = {};
  for (const [, props] of outcomeMocks.trackDesignRelay.mock.calls) {
    const { operation, outcome, reason, count } = props as Record<
      string,
      string | number
    >;
    const key = `${operation}/${outcome}/${reason}`;
    out[key] = (out[key] ?? 0) + Number(count);
  }
  return out;
}

import {
  __clearKnownSaveContentsForTests,
  runSaveFileContent,
  type SaveFileContentArgs,
} from "./save-file-content";

const BASE = [
  "<main>",
  '  <button data-agent-native-node-id="alpha" style="border-radius:10px;background:#6366f1">Alpha</button>',
  '  <button data-agent-native-node-id="beta" style="border-radius:10px;background:#22c55e">Beta</button>',
  "</main>",
].join("\n");
const MINE = BASE.replace(
  'beta" style="border-radius:10px',
  'beta" style="border-radius:30px',
);
const THEIRS = BASE.replace("#6366f1", "#ff0000");
const MERGED = MINE.replace("#6366f1", "#ff0000");

type SentSave = {
  content?: string;
  contentPatch?: SourceContentPatch;
  expectedVersionHash: string;
};

function sentContent(input: SentSave, bases: readonly string[]): string {
  if (input.content !== undefined) return input.content;
  const base = bases.find(
    (candidate) => sourceContentHash(candidate) === input.expectedVersionHash,
  );
  if (base === undefined || !input.contentPatch) {
    throw new Error("save carried neither content nor a patch on a known base");
  }
  return applySourceContentPatch(base, input.contentPatch);
}

function conflict(): Error {
  return Object.assign(new Error("File changed since it was read."), {
    status: 409,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup(options: {
  mutate: (input: SentSave) => Promise<unknown>;
  live?: () => Promise<string>;
  base?: string | undefined;
  id?: string;
}) {
  const id = options.id ?? "screen-1";
  const pending: FileContentSaveRequest = {
    id,
    content: MINE,
    syncCollab: true,
    operationSource: "tab-b",
    operationRevision: 4,
    expectedVersionHash: sourceContentHash(BASE),
  };
  const latestFileSaveForUnloadRef: SaveFileContentArgs["latestFileSaveForUnloadRef"] =
    { current: { [id]: pending } };
  const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
    current: {},
  };
  const mutateAsync = vi.fn(options.mutate);
  const rollbackPendingLocalFileContent = vi.fn();
  const markPendingLocalFileContent = vi.fn();
  const args: SaveFileContentArgs = {
    acknowledgeOutboxEntry: vi.fn(async () => {}),
    canEditDesignRef: { current: true },
    createFileSaveOutboxEntry: vi.fn(() => null),
    fileSaveChainsRef,
    journalOutboxEntry: vi.fn(async () => true),
    latestFileSaveForUnloadRef,
    rollbackPendingLocalFileContent,
    markPendingLocalFileContent,
    getPendingBaseContent: () => ("base" in options ? options.base : BASE),
    readLiveFileContent: options.live ?? (async () => THEIRS),
    queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
    setPatchProof: vi.fn(),
    t: (key) => key,
    updateFileMutation: {
      mutateAsync,
    } as unknown as SaveFileContentArgs["updateFileMutation"],
    warnChangesWillRetry: vi.fn(),
  };
  return {
    args,
    pending,
    mutateAsync,
    rollbackPendingLocalFileContent,
    markPendingLocalFileContent,
    latestFileSaveForUnloadRef,
  };
}

describe("runSaveFileContent concurrent edit merge", () => {
  const errorToast = vi.spyOn(toast, "error");

  beforeEach(() => {
    __clearKnownSaveContentsForTests();
    errorToast.mockReset().mockImplementation(() => "test-toast");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-applies a conflicted edit onto the newer server content instead of dropping it", async () => {
    const { args, pending, mutateAsync, rollbackPendingLocalFileContent } =
      setup({
        mutate: async (input) => {
          if (input.expectedVersionHash === sourceContentHash(BASE)) {
            throw conflict();
          }
          return { updated: true, versionHash: sourceContentHash(MERGED) };
        },
      });
    const onPersistedContent = vi.fn();

    await expect(
      runSaveFileContent(args, pending, undefined, onPersistedContent),
    ).resolves.toBe("persisted");

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[1]![0]).toMatchObject({
      id: pending.id,
      expectedVersionHash: sourceContentHash(THEIRS),
      operationSource: "tab-b",
      operationRevision: 4,
    });
    expect(sentContent(mutateAsync.mock.calls[1]![0], [THEIRS])).toBe(MERGED);
    expect(args.markPendingLocalFileContent).toHaveBeenCalledWith(
      pending.id,
      MERGED,
      undefined,
      undefined,
      undefined,
    );
    expect(MERGED).not.toBe(pending.content);
    expect(onPersistedContent).toHaveBeenCalledOnce();
    expect(onPersistedContent).toHaveBeenCalledWith(MERGED);
    expect(rollbackPendingLocalFileContent).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
    expect(args.latestFileSaveForUnloadRef.current[pending.id]).toBeUndefined();
  });

  it("keeps a same-spot conflict loud and sends nothing newer", async () => {
    const sameSpot = BASE.replace("beta", "beta").replace("#22c55e", "#000000");
    const { args, pending, mutateAsync, rollbackPendingLocalFileContent } =
      setup({
        live: async () => BASE.replace("#22c55e", "#ffffff"),
        mutate: async () => {
          throw conflict();
        },
      });
    pending.content = sameSpot;

    await expect(runSaveFileContent(args, pending)).resolves.toBe("conflict");

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(rollbackPendingLocalFileContent).toHaveBeenCalledWith(
      pending.id,
      sameSpot,
    );
    expect(errorToast).toHaveBeenCalledWith(
      "designEditor.toasts.saveConflict",
      expect.objectContaining({ id: `design-save-conflict:${pending.id}` }),
    );
  });

  it("does not publish content rejected as a stale collaboration mirror", async () => {
    const { args, pending, rollbackPendingLocalFileContent } = setup({
      mutate: async () => ({
        updated: true,
        skippedStaleMirror: true,
        versionHash: sourceContentHash(THEIRS),
      }),
    });
    const onPersistedContent = vi.fn();

    await expect(
      runSaveFileContent(args, pending, undefined, onPersistedContent),
    ).resolves.toBe("conflict");

    expect(onPersistedContent).not.toHaveBeenCalled();
    expect(rollbackPendingLocalFileContent).toHaveBeenCalledWith(
      pending.id,
      pending.content,
    );
  });

  it("drops the journaled save the server rejected with a conflict", async () => {
    const { args, pending } = setup({
      mutate: async () => {
        throw conflict();
      },
      base: undefined,
    });
    const entry = { key: "outbox-entry" };
    args.createFileSaveOutboxEntry = vi.fn(() => entry as never);

    await expect(runSaveFileContent(args, pending)).resolves.toBe("conflict");

    expect(args.acknowledgeOutboxEntry).toHaveBeenCalledWith(entry);
  });

  it("does not publish an accepted request after a newer save supersedes it", async () => {
    const mutation = deferred<unknown>();
    const { args, pending, latestFileSaveForUnloadRef } = setup({
      mutate: () => mutation.promise,
    });
    const onPersistedContent = vi.fn();
    const saving = runSaveFileContent(
      args,
      pending,
      undefined,
      onPersistedContent,
    );
    latestFileSaveForUnloadRef.current[pending.id] = {
      ...pending,
      content: "<main>newer local source</main>",
      expectedVersionHash: sourceContentHash(MINE),
      operationRevision: pending.operationRevision + 1,
    };
    mutation.resolve({
      updated: true,
      versionHash: sourceContentHash(MINE),
    });

    await expect(saving).resolves.toBe("persisted");
    expect(onPersistedContent).not.toHaveBeenCalled();
  });

  it("keeps the conflict loud when the base content is unknown", async () => {
    const { args, pending, mutateAsync, rollbackPendingLocalFileContent } =
      setup({
        base: undefined,
        mutate: async () => {
          throw conflict();
        },
      });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("conflict");

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(rollbackPendingLocalFileContent).toHaveBeenCalledWith(
      pending.id,
      pending.content,
    );
    expect(errorToast).toHaveBeenCalled();
  });

  it("keeps the conflict loud when the live content cannot be read", async () => {
    const { args, pending, mutateAsync, rollbackPendingLocalFileContent } =
      setup({
        live: async () => {
          throw new Error("offline");
        },
        mutate: async () => {
          throw conflict();
        },
      });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("conflict");

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(rollbackPendingLocalFileContent).toHaveBeenCalled();
  });

  it("stops merging after bounded retries when the file keeps moving", async () => {
    let version = 0;
    const { args, pending, mutateAsync, rollbackPendingLocalFileContent } =
      setup({
        live: async () => {
          version += 1;
          return THEIRS.replace("Alpha", `Alpha ${version}`);
        },
        mutate: async () => {
          throw conflict();
        },
      });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("conflict");

    expect(mutateAsync).toHaveBeenCalledTimes(4);
    expect(rollbackPendingLocalFileContent).toHaveBeenCalledTimes(1);
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  it("merges a queued follow-up save against the content its predecessor sent", async () => {
    const second = MINE.replace("Beta", "Beta 2");
    const secondMerged = MERGED.replace("Beta", "Beta 2");
    const known = [BASE, MINE, THEIRS, MERGED];
    const first = setup({
      mutate: async (input) => {
        const content = sentContent(input, known);
        if (content === MINE) throw conflict();
        if (content === MERGED) {
          return { updated: true, versionHash: sourceContentHash(MERGED) };
        }
        if (input.expectedVersionHash === sourceContentHash(MINE)) {
          throw conflict();
        }
        return { updated: true, versionHash: sourceContentHash(secondMerged) };
      },
      live: async () =>
        first.mutateAsync.mock.calls.length > 1 ? MERGED : THEIRS,
    });
    const followUp: FileContentSaveRequest = {
      ...first.pending,
      content: second,
      operationRevision: 5,
      expectedVersionHash: sourceContentHash(MINE),
    };
    first.latestFileSaveForUnloadRef.current[followUp.id] = followUp;

    const firstSave = runSaveFileContent(first.args, first.pending);
    const secondSave = runSaveFileContent(first.args, followUp);
    await expect(firstSave).resolves.toBe("persisted");
    await expect(secondSave).resolves.toBe("persisted");

    expect(
      first.mutateAsync.mock.calls.map(([input]) => sentContent(input, known)),
    ).toEqual([MINE, MERGED, second, secondMerged]);
    expect(first.rollbackPendingLocalFileContent).not.toHaveBeenCalled();
  });
});

describe("runSaveFileContent request body", () => {
  beforeEach(() => {
    __clearKnownSaveContentsForTests();
  });

  const persisted = async () => ({
    updated: true,
    versionHash: sourceContentHash(MINE),
  });

  it("sends only the changed span when the base it was edited from is known", async () => {
    const { args, pending, mutateAsync } = setup({ mutate: persisted });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("persisted");

    const sent = mutateAsync.mock.calls[0]![0];
    expect(sent.content).toBeUndefined();
    expect(sent.contentPatch!.text.length).toBeLessThan(MINE.length / 10);
    expect(sentContent(sent, [BASE])).toBe(MINE);
  });

  it("sends the whole document when the base it was edited from is unknown", async () => {
    const { args, pending, mutateAsync } = setup({
      mutate: persisted,
      base: undefined,
    });

    await runSaveFileContent(args, pending);

    expect(mutateAsync.mock.calls[0]![0]).toMatchObject({ content: MINE });
    expect(mutateAsync.mock.calls[0]![0].contentPatch).toBeUndefined();
  });

  it("sends the whole document for a mirror-only write", async () => {
    const { args, pending, mutateAsync } = setup({ mutate: persisted });
    pending.syncCollab = false;

    await runSaveFileContent(args, pending);

    expect(mutateAsync.mock.calls[0]![0]).toMatchObject({ content: MINE });
  });

  it("resends the whole document once when a server that predates patches saves nothing", async () => {
    const { args, pending, mutateAsync } = setup({
      mutate: async (input) =>
        input.content === undefined
          ? { updated: true, versionHash: sourceContentHash(BASE) }
          : { updated: true, versionHash: sourceContentHash(input.content) },
    });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("persisted");

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[0]![0].contentPatch).toBeDefined();
    expect(mutateAsync.mock.calls[1]![0]).toMatchObject({ content: MINE });
    expect(mutateAsync.mock.calls[1]![0].contentPatch).toBeUndefined();
    expect(args.rollbackPendingLocalFileContent).not.toHaveBeenCalled();
  });

  it("does not resend the whole document when the server skips the patch's stale revision", async () => {
    const { args, pending, mutateAsync } = setup({
      mutate: async () => ({
        updated: true,
        skippedStaleOperation: true,
        versionHash: sourceContentHash(BASE),
      }),
    });

    await runSaveFileContent(args, pending);

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0]![0].contentPatch).toBeDefined();
  });

  it("resends the whole document once when the server rejects the patch's result hash", async () => {
    const { args, pending, mutateAsync } = setup({
      mutate: async (input) => {
        if (input.content === undefined) {
          throw Object.assign(
            new Error("The content patch did not produce its result hash."),
            { status: 422, errorCode: "content_patch_mismatch" },
          );
        }
        return { updated: true, versionHash: sourceContentHash(input.content) };
      },
    });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("persisted");

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[1]![0]).toMatchObject({ content: MINE });
    expect(args.rollbackPendingLocalFileContent).not.toHaveBeenCalled();
  });

  it("does not resend the whole document when the patched result fails the HTML check", async () => {
    const { args, pending, mutateAsync } = setup({
      mutate: async () => {
        throw Object.assign(
          new Error("DESIGN_HTML_INTEGRITY: the document structure is invalid"),
          { status: 422 },
        );
      },
    });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("failed");

    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("treats the save as a conflict when the resent document is not persisted either", async () => {
    const { args, pending, mutateAsync } = setup({
      mutate: async () => ({
        updated: true,
        versionHash: sourceContentHash(BASE),
      }),
    });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("conflict");

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(args.rollbackPendingLocalFileContent).toHaveBeenCalledWith(
      pending.id,
      MINE,
    );
  });
});

describe("runSaveFileContent outcome counts", () => {
  beforeEach(() => {
    __clearKnownSaveContentsForTests();
    __resetCanvasOutcomeTrackingForTests();
    setCanvasOutcomeContext({ designId: undefined, signedIn: true });
    outcomeMocks.trackDesignRelay.mockReset();
    vi.spyOn(toast, "error").mockImplementation(() => "test-toast");
    vi.spyOn(toast, "warning").mockImplementation(() => "test-toast");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("counts a save under the design it was queued for", async () => {
    const { args, pending } = setup({
      mutate: async () => ({
        updated: true,
        versionHash: sourceContentHash(MINE),
      }),
    });
    args.designId = "design-a";
    setCanvasOutcomeContext({ designId: "design-b", signedIn: true });
    await runSaveFileContent(args, pending);
    flushCanvasOutcomeCounts();
    expect(
      outcomeMocks.trackDesignRelay.mock.calls.map(
        ([, props]) => (props as { design_id?: string }).design_id,
      ),
    ).toEqual(["design-a"]);
  });

  it("counts a save that merged and retried as one success", async () => {
    const { args, pending, mutateAsync } = setup({
      mutate: async (input) => {
        if (input.expectedVersionHash === sourceContentHash(BASE)) {
          throw conflict();
        }
        return { updated: true, versionHash: sourceContentHash(MERGED) };
      },
    });
    await expect(runSaveFileContent(args, pending)).resolves.toBe("persisted");
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(saveOutcomes()).toEqual({ "save/succeeded/none": 1 });
  });

  it("counts an unresolvable conflict as a failed save", async () => {
    const { args, pending } = setup({
      live: async () => BASE.replace("#22c55e", "#ffffff"),
      mutate: async () => {
        throw conflict();
      },
    });
    pending.content = BASE.replace("#22c55e", "#000000");
    await expect(runSaveFileContent(args, pending)).resolves.toBe("conflict");
    expect(saveOutcomes()).toEqual({ "save/failed/conflict": 1 });
  });

  it("counts a server-skipped stale copy as a failure the server calls success", async () => {
    const { args, pending } = setup({
      mutate: async () => ({ updated: true, skippedStaleMirror: true }),
    });
    await expect(runSaveFileContent(args, pending)).resolves.toBe("conflict");
    expect(saveOutcomes()).toEqual({ "save/failed/stale_mirror": 1 });
  });

  it("counts a save without edit rights as skipped, never sent", async () => {
    const { args, pending, mutateAsync } = setup({
      mutate: async () => ({ updated: true }),
    });
    args.canEditDesignRef.current = false;
    await expect(runSaveFileContent(args, pending)).resolves.toBe("failed");
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(saveOutcomes()).toEqual({ "save/skipped/no_edit_rights": 1 });
  });

  it("counts an offline save kept for retry as deferred, not failed", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const { args, pending } = setup({
      mutate: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(
      runSaveFileContent(args, pending, Promise.resolve(true)),
    ).resolves.toBe("retryable");
    expect(saveOutcomes()).toEqual({ "save/deferred/offline_queued": 1 });
  });
});
