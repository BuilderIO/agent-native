import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";

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

function conflict(): Error {
  return Object.assign(new Error("File changed since it was read."), {
    status: 409,
  });
}

function setup(options: {
  mutate: (input: {
    content: string;
    expectedVersionHash: string;
  }) => Promise<unknown>;
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

    await expect(runSaveFileContent(args, pending)).resolves.toBe("persisted");

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[1]![0]).toMatchObject({
      id: pending.id,
      content: MERGED,
      expectedVersionHash: sourceContentHash(THEIRS),
      operationSource: "tab-b",
      operationRevision: 4,
    });
    expect(args.markPendingLocalFileContent).toHaveBeenCalledWith(
      pending.id,
      MERGED,
    );
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
    const first = setup({
      mutate: async (input) => {
        if (input.content === MINE) throw conflict();
        if (input.content === MERGED) {
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
      first.mutateAsync.mock.calls.map(([input]) => input.content),
    ).toEqual([MINE, MERGED, second, secondMerged]);
    expect(first.rollbackPendingLocalFileContent).not.toHaveBeenCalled();
  });
});
