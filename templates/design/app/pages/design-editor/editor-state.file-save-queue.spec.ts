import { sourceContentHash } from "@shared/source-workspace";
import { expect, it, vi } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import {
  runApplyFileContentUpdate,
  type ApplyFileContentUpdateArgs,
} from "./commands/apply-file-content-update";
import {
  coalescePendingFileContentSave,
  type FileContentSaveRequest,
} from "./editor-state";

it("supersedes a pending active save with a composed non-active update", () => {
  const base = "<main><p>base</p></main>";
  const firstEdit = "<main><p>base</p><p>first edit</p></main>";
  const secondEdit =
    "<main><p>base</p><p>first edit</p><p>second edit</p></main>";
  const pending: FileContentSaveRequest = {
    id: "screen-a",
    content: firstEdit,
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 1,
    expectedVersionHash: sourceContentHash(base),
  };
  const saveFileContent = vi.fn();
  const queueFileContentSave = vi.fn<
    ApplyFileContentUpdateArgs["queueFileContentSave"]
  >((fileId, content, options) => {
    const next: FileContentSaveRequest = {
      id: fileId,
      content,
      syncCollab: options.syncCollab ?? true,
      operationSource: "tab-a",
      operationRevision: 2,
      expectedVersionHash: options.expectedVersionHash,
    };
    saveFileContent(coalescePendingFileContentSave(next, pending));
  });
  const activeFile = {
    id: "screen-b",
    filename: "b.html",
    fileType: "html",
    content: "<main>screen b</main>",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  };
  const targetFile = {
    ...activeFile,
    id: "screen-a",
    filename: "a.html",
    content: base,
  };

  const result = runApplyFileContentUpdate(
    {
      acknowledgeAuthoritativeClipboardMutation: vi.fn(),
      activeFile,
      applyFileContentUpdate: vi.fn(),
      applyLocalContentUpdate: vi.fn((content: string) => {
        const prepared = prepareCanonicalSourceContent(content, {
          fileId: activeFile.id,
          fileType: activeFile.fileType,
        });
        return {
          status: "accepted" as const,
          content: prepared.content,
          nodeIdMap: prepared.nodeIdMap,
        };
      }),
      canEditDesignRef: { current: true },
      cancelQueuedFileContentSave: vi.fn(),
      clearPendingLocalFileContent: vi.fn(),
      files: [targetFile, activeFile],
      getScreenContent: () => firstEdit,
      id: "design-1",
      markPendingLocalFileContent: vi.fn(),
      overviewIsSynced: false,
      overviewPresenceFileId: null,
      overviewYdoc: null,
      queryClient: { setQueryData: vi.fn() } as never,
      queueFileContentSave,
      recordContentHistoryEntry: vi.fn(),
      suppressContentHistoryRef: { current: false },
      t: (key) => key,
    },
    targetFile.id,
    secondEdit,
  );

  expect(result).toMatchObject({ status: "accepted" });
  const canonicalSecondEdit = (result as { content: string }).content;
  expect(queueFileContentSave).toHaveBeenCalledWith(
    targetFile.id,
    canonicalSecondEdit,
    expect.objectContaining({
      expectedVersionHash: sourceContentHash(firstEdit),
      syncCollab: true,
      immediate: true,
    }),
  );
  expect(saveFileContent).toHaveBeenCalledWith({
    id: targetFile.id,
    content: canonicalSecondEdit,
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 2,
    expectedVersionHash: sourceContentHash(base),
  });
});

it("keeps the raw compare-and-swap base when a user edit supersedes identity-only stamping", () => {
  const raw =
    '<main><button id="duplicate">Alpha</button><button id="duplicate">Beta</button></main>';
  const canonical =
    '<main><button id="duplicate" data-agent-native-node-id="node-a">Alpha</button><button id="duplicate" data-agent-native-node-id="node-b">Beta</button></main>';
  const userEdit = canonical.replace("Beta</button>", "Beta revised</button>");
  const migration: FileContentSaveRequest = {
    id: "screen-a",
    content: canonical,
    identityMigrationSourceContent: raw,
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 1,
    expectedVersionHash: sourceContentHash(raw),
  };
  const userRequest: FileContentSaveRequest = {
    id: "screen-a",
    content: userEdit,
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 2,
    expectedVersionHash: sourceContentHash(canonical),
  };

  const composed = coalescePendingFileContentSave(userRequest, migration);

  expect(composed.content).toBe(userEdit);
  expect(composed.identityMigrationSourceContent).toBeUndefined();
  expect(composed.expectedVersionHash).toBe(sourceContentHash(raw));
});

it("starts a fresh compare-and-swap base for a newer identity migration", () => {
  const firstRaw = "<main><button>first source</button></main>";
  const secondRaw = "<main><button>second source</button></main>";
  const firstMigration: FileContentSaveRequest = {
    id: "screen-a",
    content:
      '<main data-agent-native-node-id="old-root"><button>first source</button></main>',
    identityMigrationSourceContent: firstRaw,
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 1,
    expectedVersionHash: sourceContentHash(firstRaw),
  };
  const nextMigration: FileContentSaveRequest = {
    id: "screen-a",
    content:
      '<main data-agent-native-node-id="new-root"><button>second source</button></main>',
    identityMigrationSourceContent: secondRaw,
    syncCollab: true,
    operationSource: "tab-a",
    operationRevision: 2,
    expectedVersionHash: sourceContentHash(secondRaw),
  };

  expect(coalescePendingFileContentSave(nextMigration, firstMigration)).toBe(
    nextMigration,
  );
});
