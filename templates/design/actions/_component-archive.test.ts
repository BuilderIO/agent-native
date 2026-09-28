// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  createDesignVersionSnapshot: vi.fn(),
  readDesignVersionSnapshot: vi.fn(),
  readLiveSourceFile: vi.fn(),
  resolveSourceWorkspace: vi.fn(),
  select: vi.fn(),
  writeInlineSourceFilesBatch: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    designVersions: {
      designId: "designVersions.designId",
      id: "designVersions.id",
      snapshot: "designVersions.snapshot",
    },
  },
}));

vi.mock("../server/lib/design-versions.js", () => ({
  createDesignVersionSnapshot: mocks.createDesignVersionSnapshot,
  readDesignVersionSnapshot: mocks.readDesignVersionSnapshot,
}));

vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  writeInlineSourceFilesBatch: mocks.writeInlineSourceFilesBatch,
}));

import {
  COMPONENT_ARCHIVE_ATTR,
  encodeComponentArchivePointer,
} from "../shared/component-archive.js";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
} from "../shared/component-model.js";
import { sourceContentHash } from "../shared/source-workspace.js";
import {
  deleteComponentMainFromDesign,
  restoreComponentMainInDesign,
} from "./_component-archive.js";

const designId = "design-1";
const mainContent = `<body><main data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="cmp-card">Title</main></body>`;
const instanceContent = `<body><main data-agent-native-node-id="instance-root" data-agent-native-component="Card copy" ${COMPONENT_REF_ATTR}="cmp-card">Title</main></body>`;

function liveFiles() {
  return [
    {
      id: "file-main",
      designId,
      filename: "main.html",
      fileType: "html",
      content: mainContent,
      createdAt: null,
      updatedAt: null,
    },
    {
      id: "file-instance",
      designId,
      filename: "instance.html",
      fileType: "html",
      content: instanceContent,
      createdAt: null,
      updatedAt: null,
    },
  ];
}

function configure(snapshotContent = mainContent) {
  const files = liveFiles();
  mocks.assertAccess.mockResolvedValue({});
  mocks.resolveSourceWorkspace.mockResolvedValue({
    designId,
    sourceType: "inline",
    canEdit: true,
    files,
    boardFileId: null,
  });
  mocks.readLiveSourceFile.mockImplementation(async (file) => ({
    content: file.content ?? "",
    language: "html",
    versionHash: sourceContentHash(file.content ?? ""),
  }));
  mocks.createDesignVersionSnapshot.mockResolvedValue({
    id: "checkpoint-1",
    createdAt: "2026-09-15T00:00:00.000Z",
    label: "Before component delete",
  });
  mocks.readDesignVersionSnapshot.mockResolvedValue({
    designId,
    files: [
      {
        id: "file-main",
        filename: "main.html",
        fileType: "html",
        content: snapshotContent,
      },
    ],
  });
  mocks.writeInlineSourceFilesBatch.mockImplementation(
    async ({ files: batch }) => ({
      files: batch.map(({ file, content }) => ({
        id: file.id,
        versionHash: sourceContentHash(content),
        changed: content !== file.content,
        updatedAt: "2026-09-15T00:00:01.000Z",
      })),
      collaboration: { status: "synced", files: [] },
    }),
  );
  mocks.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => [{ snapshot: "checkpoint-snapshot" }],
      }),
    }),
  });
}

describe("component archive server helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configure();
  });

  it("reads back the checkpoint before atomically persisting archive changes", async () => {
    const result = await deleteComponentMainFromDesign({
      designId,
      fileId: "file-main",
      mainNodeId: "main-root",
      expectedFiles: liveFiles().map((file) => ({
        fileId: file.id,
        versionHash: sourceContentHash(file.content!),
      })),
    });

    expect(result).toMatchObject({
      designId,
      componentId: "cmp-card",
      mainNodeId: "main-root",
      checkpointId: "checkpoint-1",
      persisted: true,
    });
    expect(result.sourceBases).toHaveLength(2);
    expect(result.selection).toEqual({
      fileId: "file-main",
      nodeIds: [],
    });
    expect(mocks.readDesignVersionSnapshot).toHaveBeenCalledWith(
      "checkpoint-snapshot",
      designId,
    );
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const [{ files }] = mocks.writeInlineSourceFilesBatch.mock.calls[0]!;
    expect(files.map(({ file }) => file.id)).toEqual([
      "file-main",
      "file-instance",
    ]);
    expect(files[0]!.expectedVersionHash).toBe(sourceContentHash(mainContent));
    expect(files[1]!.content).toContain("data-agent-native-component-archive");
  });

  it("persists deletion geometry in the immutable checkpoint", async () => {
    const deletionGeometry = {
      fileId: "file-main",
      mainNodeId: "main-root",
      sourceVersionHash: sourceContentHash(mainContent),
      boundingRect: { x: 10, y: 20, width: 100, height: 70 },
    };
    mocks.readDesignVersionSnapshot.mockResolvedValue({
      designId,
      files: [
        {
          id: "file-main",
          filename: "main.html",
          fileType: "html",
          content: mainContent,
        },
      ],
      deletionGeometry,
    });

    await deleteComponentMainFromDesign({
      designId,
      fileId: "file-main",
      mainNodeId: "main-root",
      deletionGeometry,
    });

    expect(mocks.createDesignVersionSnapshot).toHaveBeenCalledWith(designId, {
      label: "Before component delete",
      deletionGeometry,
    });
  });

  it("deletes an unused main and returns an empty selection in its source file", async () => {
    const [mainFile] = liveFiles();
    const files = [mainFile!];
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId,
      sourceType: "inline",
      canEdit: true,
      files,
      boardFileId: null,
    });

    const result = await deleteComponentMainFromDesign({
      designId,
      fileId: "file-main",
      mainNodeId: "main-root",
      expectedFiles: files.map((file) => ({
        fileId: file.id,
        versionHash: sourceContentHash(file.content!),
      })),
    });

    expect(result.selection).toEqual({
      fileId: "file-main",
      nodeIds: [],
    });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
  });

  it("refuses a mismatched source file set before creating a checkpoint or writing", async () => {
    await expect(
      deleteComponentMainFromDesign({
        designId,
        fileId: "file-main",
        mainNodeId: "main-root",
        expectedFiles: [
          {
            fileId: "file-main",
            versionHash: sourceContentHash(mainContent),
          },
        ],
      }),
    ).rejects.toMatchObject({ reason: "source-file-set-mismatch" });
    expect(mocks.createDesignVersionSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
  });

  it("refuses a checkpoint whose read-back content hash is stale", async () => {
    configure("<body>stale checkpoint</body>");

    await expect(
      deleteComponentMainFromDesign({
        designId,
        fileId: "file-main",
        mainNodeId: "main-root",
      }),
    ).rejects.toMatchObject({ reason: "snapshot-mismatch" });
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
  });

  it("restores from an instance in another file and persists the new checkpoint", async () => {
    const archive = encodeComponentArchivePointer({
      schemaVersion: 1,
      versionId: "archive-checkpoint",
      fileId: "file-main",
      componentId: "cmp-card",
      mainNodeId: "main-root",
      sourceVersionHash: sourceContentHash(mainContent),
    });
    const currentInstanceContent = `<body><main data-agent-native-node-id="instance-root" data-agent-native-component="Card copy" ${COMPONENT_REF_ATTR}="cmp-card" ${COMPONENT_ARCHIVE_ATTR}="${archive}">Title</main></body>`;
    const currentFiles = liveFiles().map((file) =>
      file.id === "file-main"
        ? { ...file, content: "<body></body>" }
        : { ...file, content: currentInstanceContent },
    );
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId,
      sourceType: "inline",
      canEdit: true,
      files: currentFiles,
      boardFileId: null,
    });

    const result = await restoreComponentMainInDesign({
      designId,
      fileId: "file-instance",
      instanceNodeId: "instance-root",
      expectedFiles: currentFiles.map((file) => ({
        fileId: file.id,
        versionHash: sourceContentHash(file.content!),
      })),
      expectedVersionHash: sourceContentHash(currentInstanceContent),
    });

    expect(result).toMatchObject({
      designId,
      componentId: "cmp-card",
      mainNodeId: "main-root",
      checkpointId: "checkpoint-1",
      persisted: true,
    });
    expect(result.sourceBases).toHaveLength(2);
    expect(result.selection).toEqual({
      fileId: "file-main",
      nodeIds: ["main-root"],
    });
    expect(mocks.createDesignVersionSnapshot).toHaveBeenCalledWith(designId, {
      label: "Before component restore",
    });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const [{ files }] = mocks.writeInlineSourceFilesBatch.mock.calls[0]!;
    expect(files.map(({ file }) => file.id)).toEqual([
      "file-main",
      "file-instance",
    ]);
    expect(files[0]!.content).toBe(mainContent);
    expect(files[1]!.content).not.toContain(COMPONENT_ARCHIVE_ATTR);
  });
});
