import { sourceContentHash } from "@shared/source-workspace";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { DesignSaveOutboxEntry } from "@/lib/design-save-outbox";
import {
  shouldRetirePendingLocalFileContent,
  type FileContentSaveRequest,
} from "@/pages/design-editor/editor-state";

import {
  runSaveFileContent,
  type SaveFileContentArgs,
} from "./save-file-content";

const DESIGN_KEY = ["action", "get-design", { id: "design-1" }];
const OLD_UPDATED_AT = "2026-01-01T00:00:00.000Z";

function setup(result: Record<string, unknown>) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(DESIGN_KEY, {
    id: "design-1",
    files: [
      {
        id: "screen-1",
        content: "<main>old</main>",
        updatedAt: OLD_UPDATED_AT,
      },
      {
        id: "screen-2",
        content: "<main>other</main>",
        updatedAt: OLD_UPDATED_AT,
      },
    ],
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const fileSaveChainsRef: SaveFileContentArgs["fileSaveChainsRef"] = {
    current: {},
  };
  const args: SaveFileContentArgs = {
    acknowledgeOutboxEntry: vi.fn(async () => {}),
    canEditDesignRef: { current: true },
    createFileSaveOutboxEntry: vi.fn(
      () => ({ key: "entry" }) as DesignSaveOutboxEntry,
    ),
    designId: "design-1",
    fileSaveChainsRef,
    journalOutboxEntry: vi.fn(async () => true),
    latestFileSaveForUnloadRef: { current: {} },
    rollbackPendingLocalFileContent: vi.fn(),
    markPendingLocalFileContent: vi.fn(),
    queryClient,
    setPatchProof: vi.fn(),
    t: (key) => key,
    updateFileMutation: {
      mutateAsync: vi.fn(async () => result),
    } as unknown as SaveFileContentArgs["updateFileMutation"],
    warnChangesWillRetry: vi.fn(),
  };
  const pending: FileContentSaveRequest = {
    id: "screen-1",
    content: "<main>new</main>",
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 1,
    expectedVersionHash: sourceContentHash("<main>old</main>"),
  };
  return { args, fileSaveChainsRef, invalidateQueries, pending, queryClient };
}

function cachedFile(queryClient: QueryClient, id: string) {
  return (
    queryClient.getQueryData(DESIGN_KEY) as {
      files: { id: string; content: string; updatedAt: string }[];
    }
  ).files.find((file) => file.id === id)!;
}

describe("runSaveFileContent get-design cache", () => {
  it("refetches get-design when the save result carries no updatedAt", async () => {
    const { args, fileSaveChainsRef, invalidateQueries, pending, queryClient } =
      setup({
        id: "screen-1",
        updated: true,
        versionHash: sourceContentHash("<main>new</main>"),
      });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("persisted");
    await fileSaveChainsRef.current[pending.id];

    expect(cachedFile(queryClient, "screen-1")).toMatchObject({
      content: "<main>new</main>",
      updatedAt: OLD_UPDATED_AT,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "get-design"],
    });
  });

  it("writes the persisted updatedAt so the overlay retires without a refetch", async () => {
    const persistedAt = "2026-01-01T00:00:05.000Z";
    const { args, invalidateQueries, pending, queryClient } = setup({
      id: "screen-1",
      updated: true,
      versionHash: sourceContentHash("<main>new</main>"),
      updatedAt: persistedAt,
    });
    const otherBefore = cachedFile(queryClient, "screen-2");

    await expect(runSaveFileContent(args, pending)).resolves.toBe("persisted");

    const saved = cachedFile(queryClient, "screen-1");
    expect(saved).toMatchObject({
      content: "<main>new</main>",
      updatedAt: persistedAt,
    });
    expect(cachedFile(queryClient, "screen-2")).toBe(otherBefore);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(
      shouldRetirePendingLocalFileContent(
        { content: pending.content, baseUpdatedAt: OLD_UPDATED_AT },
        saved,
      ),
    ).toBe(true);
  });

  it("still refetches when a get-design read was already in flight", async () => {
    const { args, invalidateQueries, pending, queryClient } = setup({
      id: "screen-1",
      updated: true,
      versionHash: sourceContentHash("<main>new</main>"),
      updatedAt: "2026-01-01T00:00:05.000Z",
    });
    void queryClient.fetchQuery({
      queryKey: DESIGN_KEY,
      queryFn: () => new Promise(() => {}),
      staleTime: 0,
    });

    await expect(runSaveFileContent(args, pending)).resolves.toBe("persisted");

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "get-design"],
    });
  });
});
