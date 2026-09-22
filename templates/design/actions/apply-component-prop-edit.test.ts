import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
  agentUpdateSelection: vi.fn(),
  deleteComponentMainFromDesign: vi.fn(),
  readLiveSourceFile: vi.fn(),
  resolveAccess: vi.fn(),
  resolveSourceWorkspace: vi.fn(),
  restoreComponentMainInDesign: vi.fn(),
  snapshotDesignBeforeAgentEdit: vi.fn(),
  sourceType: "inline" as string,
  writeInlineSourceFilesBatch: vi.fn(),
}));

const archiveMutationError = vi.hoisted(() => {
  class TestComponentArchiveMutationError extends Error {
    readonly reason: string;

    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
    }
  }

  return TestComponentArchiveMutationError;
});

vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: mocks.agentEnterDocument,
  agentLeaveDocument: mocks.agentLeaveDocument,
  agentUpdateSelection: mocks.agentUpdateSelection,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({}),
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
      updatedAt: "designFiles.updatedAt",
    },
    designs: { id: "designs.id" },
    designShares: {},
  },
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));

vi.mock("../server/source-workspace.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/source-workspace.js")>()),
  readLiveSourceFile: mocks.readLiveSourceFile,
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  writeInlineSourceFilesBatch: mocks.writeInlineSourceFilesBatch,
}));

vi.mock("../shared/source-mode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/source-mode.js")>()),
  designSourceTypeFromData: () => mocks.sourceType,
}));

vi.mock("./_component-archive.js", () => ({
  ComponentArchiveMutationError: archiveMutationError,
  deleteComponentMainFromDesign: mocks.deleteComponentMainFromDesign,
  restoreComponentMainInDesign: mocks.restoreComponentMainInDesign,
}));

import {
  COMPONENT_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "../shared/component-model.js";
import { sourceContentHash } from "../shared/source-workspace.js";
import action from "./apply-component-prop-edit.js";

const designId = "design-components";
const mainContent = `<section data-agent-native-node-id="main-root" data-agent-native-component="Button" data-agent-native-prop-variant="primary" ${COMPONENT_ID_ATTR}="button"><span data-agent-native-node-id="main-label" style="color: blue">Play</span></section><div data-agent-native-node-id="plain-target" style="color: black">Plain</div>`;
const copyContent = `<section data-agent-native-node-id="copy-root" data-agent-native-prop-variant="primary" ${COMPONENT_REF_ATTR}="button"><span data-agent-native-node-id="copy-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-label" style="color: blue">Play</span></section>`;

const structureMainContent = `<section data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="button"><div data-agent-native-node-id="main-a">A</div><div data-agent-native-node-id="main-b">B</div></section>`;
const emptyComponentOverrides = encodeURIComponent("[]");
const structureCopyContent = `<section data-agent-native-node-id="copy-root" data-agent-native-component="Card copy" ${COMPONENT_REF_ATTR}="button" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-root" ${COMPONENT_OVERRIDES_ATTR}="${emptyComponentOverrides}"><div data-agent-native-node-id="copy-a" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-a" ${COMPONENT_OVERRIDES_ATTR}="${emptyComponentOverrides}">A</div><div data-agent-native-node-id="copy-b" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-b" ${COMPONENT_OVERRIDES_ATTR}="${emptyComponentOverrides}">B</div></section>`;

function liveFiles() {
  return [
    {
      id: "main-file",
      designId,
      filename: "main.html",
      fileType: "html",
      content: mainContent,
      createdAt: null,
      updatedAt: "main-v1",
    },
    {
      id: "copy-file",
      designId,
      filename: "copy.html",
      fileType: "html",
      content: copyContent,
      createdAt: null,
      updatedAt: "copy-v1",
    },
  ];
}

function expectedFiles() {
  return liveFiles().map((file) => ({
    fileId: file.id,
    versionHash: sourceContentHash(file.content),
  }));
}

function boardAndScreenFiles() {
  return [
    {
      id: "board-file",
      designId,
      filename: "__board__.html",
      fileType: "html",
      content: mainContent,
      createdAt: null,
      updatedAt: "board-v1",
    },
    {
      id: "screen-file",
      designId,
      filename: "index.html",
      fileType: "html",
      content: copyContent,
      createdAt: null,
      updatedAt: "screen-v1",
    },
  ];
}

function expectedFor(files: Array<{ id: string; content: string }>) {
  return files.map((file) => ({
    fileId: file.id,
    versionHash: sourceContentHash(file.content),
  }));
}

function structureLiveFiles() {
  return [
    {
      id: "main-file",
      designId,
      filename: "main.html",
      fileType: "html",
      content: structureMainContent,
      createdAt: null,
      updatedAt: "main-v1",
    },
    {
      id: "copy-file",
      designId,
      filename: "copy.html",
      fileType: "html",
      content: structureCopyContent,
      createdAt: null,
      updatedAt: "copy-v1",
    },
  ];
}

function batchResult(files: Array<{ file: { id: string }; content: string }>) {
  const originalContentById = new Map([
    ...liveFiles().map((file) => [file.id, file.content] as const),
    ...boardAndScreenFiles().map((file) => [file.id, file.content] as const),
  ]);
  return {
    files: files.map(({ file, content }) => ({
      id: file.id,
      versionHash: sourceContentHash(content),
      changed: content !== originalContentById.get(file.id),
      updatedAt: `saved:${file.id}`,
    })),
    collaboration: { status: "synced" as const, files: [] },
  };
}

describe("apply-component-prop-edit linked path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteComponentMainFromDesign.mockReset();
    mocks.restoreComponentMainInDesign.mockReset();
    mocks.sourceType = "inline";
    const files = liveFiles();
    mocks.resolveAccess.mockResolvedValue({
      role: "editor",
      resource: { data: { sourceType: "inline" } },
    });
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.snapshotDesignBeforeAgentEdit.mockResolvedValue(undefined);
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId,
      sourceType: "inline",
      canEdit: true,
      files,
      boardFileId: null,
    });
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content: file.content,
      versionHash: sourceContentHash(file.content),
      language: "html",
    }));
    mocks.writeInlineSourceFilesBatch.mockImplementation(
      async ({ files: batch }) => batchResult(batch),
    );
  });

  it("propagates a main style edit through the action batch for both Screens", async () => {
    const result = await action.run({
      designId,
      fileId: "main-file",
      nodeId: "main-label",
      edit: { kind: "style", property: "color", value: "orange" },
      source: { expectedFiles: expectedFiles() },
    });

    expect(result).toMatchObject({ persisted: true, ctaRequired: false });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledTimes(1);
    const batch = mocks.writeInlineSourceFilesBatch.mock.calls[0][0];
    expect(batch.files).toHaveLength(2);
    expect(
      batch.files.find(({ file }) => file.id === "main-file")?.content,
    ).toContain('style="color: orange"');
    expect(
      batch.files.find(({ file }) => file.id === "copy-file")?.content,
    ).toContain('style="color: orange"');
    expect(
      batch.files.every(({ expectedVersionHash }) => expectedVersionHash),
    ).toBe(true);
    expect(result.sourceBases).toHaveLength(2);
    expect(result.changes).toHaveLength(2);
  });

  it("routes deleteMain through the archive mutation and returns its receipt", async () => {
    const archive = {
      schemaVersion: 1 as const,
      versionId: "checkpoint-1",
      fileId: "main-file",
      componentId: "button",
      mainNodeId: "main-root",
      sourceVersionHash: sourceContentHash(mainContent),
    };
    const sourceBases = expectedFiles().map(({ fileId }, index) => ({
      fileId,
      versionHash: `after-${index}`,
      updatedAt: `saved:${fileId}`,
    }));
    const archiveResult = {
      designId,
      componentId: "button",
      mainNodeId: "main-root",
      archive,
      checkpointId: "checkpoint-1",
      persisted: true as const,
      changes: [],
      referenceNodeIds: [{ fileId: "copy-file", nodeId: "copy-root" }],
      sourceBases,
      selection: { fileId: "copy-file", nodeIds: ["copy-root"] },
    };
    mocks.deleteComponentMainFromDesign.mockResolvedValue(archiveResult);

    const result = await action.run({
      designId,
      fileId: "main-file",
      nodeId: "main-root",
      edit: { kind: "deleteMain" },
      source: { expectedFiles: expectedFiles() },
    });

    expect(mocks.deleteComponentMainFromDesign).toHaveBeenCalledWith({
      designId,
      fileId: "main-file",
      mainNodeId: "main-root",
      expectedVersionHash: sourceContentHash(mainContent),
      expectedFiles: expectedFiles(),
    });
    expect(result).toMatchObject({
      designId,
      nodeId: "main-root",
      componentId: "button",
      persisted: true,
      selection: archiveResult.selection,
      sourceBases,
    });
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
  });

  it("routes restoreMain from an instance through the archive mutation", async () => {
    const archiveResult = {
      designId,
      componentId: "button",
      mainNodeId: "main-root",
      archive: {
        schemaVersion: 1 as const,
        versionId: "checkpoint-1",
        fileId: "main-file",
        componentId: "button",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(mainContent),
      },
      checkpointId: "checkpoint-2",
      persisted: true as const,
      changes: [],
      referenceNodeIds: [{ fileId: "copy-file", nodeId: "copy-root" }],
      sourceBases: expectedFiles().map(({ fileId }, index) => ({
        fileId,
        versionHash: `restored-${index}`,
        updatedAt: `saved:${fileId}`,
      })),
      selection: { fileId: "main-file", nodeIds: ["main-root"] },
    };
    mocks.restoreComponentMainInDesign.mockResolvedValue(archiveResult);

    const result = await action.run({
      designId,
      fileId: "copy-file",
      nodeId: "copy-root",
      edit: { kind: "restoreMain" },
      source: { expectedFiles: expectedFiles() },
    });

    expect(mocks.restoreComponentMainInDesign).toHaveBeenCalledWith({
      designId,
      fileId: "copy-file",
      instanceNodeId: "copy-root",
      expectedVersionHash: sourceContentHash(copyContent),
      expectedFiles: expectedFiles(),
    });
    expect(result).toMatchObject({
      designId,
      nodeId: "copy-root",
      componentId: "button",
      persisted: true,
      selection: archiveResult.selection,
    });
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
  });

  it("includes the Board in linked edits that propagate to a Screen instance", async () => {
    const files = boardAndScreenFiles();
    mocks.resolveSourceWorkspace.mockImplementation(
      async (_designId, options) => ({
        designId,
        sourceType: "inline",
        canEdit: true,
        files: options?.includeBoard
          ? files
          : files.filter((file) => file.filename !== "__board__.html"),
        boardFileId: "board-file",
      }),
    );

    const result = await action.run({
      designId,
      fileId: "board-file",
      nodeId: "main-label",
      edit: { kind: "style", property: "color", value: "orange" },
      source: { expectedFiles: expectedFor(files) },
    });

    expect(result).toMatchObject({ persisted: true, ctaRequired: false });
    expect(mocks.resolveSourceWorkspace).toHaveBeenCalledWith(designId, {
      includeContent: true,
      includeBoard: true,
    });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const batch = mocks.writeInlineSourceFilesBatch.mock.calls[0][0];
    expect(batch.files).toHaveLength(2);
    expect(
      batch.files.find(({ file }) => file.id === "board-file")?.content,
    ).toContain('style="color: orange"');
    expect(
      batch.files.find(({ file }) => file.id === "screen-file")?.content,
    ).toContain('style="color: orange"');
    expect(result.changes).toHaveLength(2);
  });

  it("persists a text override through the action while retaining instance identity", async () => {
    const result = await action.run({
      designId,
      fileId: "copy-file",
      nodeId: "copy-label",
      edit: { kind: "textContent", value: "Get started" },
      source: { expectedFiles: expectedFiles() },
    });

    expect(result).toMatchObject({ persisted: true, ctaRequired: false });
    const batch = mocks.writeInlineSourceFilesBatch.mock.calls[0][0];
    const copy = batch.files.find(
      ({ file }) => file.id === "copy-file",
    )?.content;
    expect(copy).toContain("Get started");
    expect(copy).toContain(` ${COMPONENT_REF_ATTR}="button"`);
    expect(copy).toContain(` ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-label"`);
    expect(copy).toContain(COMPONENT_OVERRIDES_ATTR);
  });

  it("persists a component prop override through the linked action path", async () => {
    const result = await action.run({
      designId,
      fileId: "copy-file",
      nodeId: "copy-root",
      edit: {
        kind: "attribute",
        attribute: "data-agent-native-prop-variant",
        value: "outline",
      },
      source: { expectedFiles: expectedFiles() },
    });

    expect(result).toMatchObject({ persisted: true, ctaRequired: false });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledTimes(1);
    const batch = mocks.writeInlineSourceFilesBatch.mock.calls[0][0];
    const copy = batch.files.find(
      ({ file }) => file.id === "copy-file",
    )?.content;
    expect(copy).toContain('data-agent-native-prop-variant="outline"');
    expect(copy).toContain(COMPONENT_REF_ATTR);
    expect(copy).toContain(COMPONENT_OVERRIDES_ATTR);
    const overrides = decodeURIComponent(
      copy?.match(new RegExp(`${COMPONENT_OVERRIDES_ATTR}="([^"]+)"`))?.[1] ??
        "",
    );
    expect(overrides).toContain(
      '"property":"attribute:data-agent-native-prop-variant"',
    );
  });

  it("writes a multi-property inspector commit through one component action batch", async () => {
    const result = await action.run({
      designId,
      fileId: "main-file",
      nodeId: "main-label",
      edit: {
        kind: "styleBatch",
        values: {
          "background-color": "red",
          "background-image": "linear-gradient(black, white)",
        },
      },
      source: { expectedFiles: expectedFiles() },
    });

    expect(result).toMatchObject({ persisted: true, ctaRequired: false });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledTimes(1);
    const batch = mocks.writeInlineSourceFilesBatch.mock.calls[0][0];
    expect(batch.files).toHaveLength(2);
    for (const { content } of batch.files) {
      expect(content).toContain("background-color: red");
      expect(content).toContain(
        "background-image: linear-gradient(black, white)",
      );
    }
    expect(result.changes).toHaveLength(2);
  });

  it("applies mixed linked and plain selected layers in one source batch", async () => {
    const result = await action.run({
      designId,
      fileId: "main-file",
      nodeId: "main-label",
      edit: {
        kind: "styleTargetsBatch",
        targets: [
          {
            fileId: "main-file",
            nodeId: "main-label",
            styles: { color: "orange" },
          },
          {
            fileId: "main-file",
            nodeId: "plain-target",
            styles: { opacity: "0.5" },
          },
        ],
      },
      source: { expectedFiles: expectedFiles() },
    });

    expect(result).toMatchObject({ persisted: true, ctaRequired: false });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const batch = mocks.writeInlineSourceFilesBatch.mock.calls[0][0];
    expect(batch.files).toHaveLength(2);
    const main = batch.files.find(
      ({ file }) => file.id === "main-file",
    )?.content;
    const copy = batch.files.find(
      ({ file }) => file.id === "copy-file",
    )?.content;
    expect(main).toContain('style="color: orange"');
    expect(main).toContain('style="color: black; opacity: 0.5"');
    expect(copy).toContain('style="color: orange"');
    expect(result.changes).toHaveLength(2);
  });

  it.each(["localhost", "fusion"])(
    "leaves %s source in the existing live source handoff path",
    async (sourceType) => {
      mocks.sourceType = sourceType;
      const result = await action.run({
        designId,
        fileId: "copy-file",
        nodeId: "copy-label",
        edit: { kind: "textContent", value: "Pending live edit" },
        source: { expectedFiles: expectedFiles() },
      });

      expect(result).toMatchObject({ persisted: false, ctaRequired: true });
      expect(mocks.resolveSourceWorkspace).not.toHaveBeenCalled();
      expect(mocks.readLiveSourceFile).not.toHaveBeenCalled();
      expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
    },
  );

  it("returns a conflict and does not write when caller source versions are stale", async () => {
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content: file.content,
      versionHash: "another-version",
      language: "html",
    }));
    const result = await action.run({
      designId,
      fileId: "main-file",
      nodeId: "main-label",
      edit: { kind: "style", property: "color", value: "orange" },
      source: { expectedFiles: expectedFiles() },
    });

    expect(result).toMatchObject({ persisted: false, conflict: true });
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
  });

  it("rejects duplicate expected source file IDs before reading or writing", async () => {
    const expected = expectedFiles();
    const result = await action.run({
      designId,
      fileId: "main-file",
      nodeId: "main-label",
      edit: { kind: "style", property: "color", value: "orange" },
      source: {
        expectedFiles: [
          { ...expected[0]!, versionHash: "stale-but-shadowed" },
          expected[0]!,
          expected[1]!,
        ],
      },
    });

    expect(result).toMatchObject({ persisted: false, conflict: true });
    expect(result.error).toContain("source file set changed");
    expect(mocks.readLiveSourceFile).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
  });

  it("applies semantic structure intents atomically and returns the new wrapper selection", async () => {
    const files = structureLiveFiles();
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId,
      sourceType: "inline",
      canEdit: true,
      files,
      boardFileId: null,
    });
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content: file.content,
      versionHash: sourceContentHash(file.content),
      language: "html",
    }));

    const result = await action.run({
      designId,
      fileId: "main-file",
      nodeId: "main-root",
      edit: {
        kind: "structure",
        intents: [
          {
            kind: "wrapNodes",
            targetIds: ["main-a", "main-b"],
            wrapperKind: "frame",
            sizeHints: {
              "main-a": { width: 40, height: 20 },
              "main-b": { width: 60, height: 20 },
            },
          },
        ],
      },
      source: { expectedFiles: expectedFor(files) },
    });

    expect(result).toMatchObject({ persisted: true, ctaRequired: false });
    expect(result.selection).toMatchObject({
      fileId: "main-file",
      nodeIds: [expect.any(String)],
    });
    const wrapperId = result.selection?.nodeIds[0];
    expect(wrapperId).toBeTruthy();
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const batch = mocks.writeInlineSourceFilesBatch.mock.calls[0][0];
    expect(batch.files).toHaveLength(2);
    const main = batch.files.find(
      ({ file }) => file.id === "main-file",
    )?.content;
    const copy = batch.files.find(
      ({ file }) => file.id === "copy-file",
    )?.content;
    expect(main).toContain(
      `data-agent-native-node-id="${wrapperId}" data-agent-native-layer-name="Frame"`,
    );
    expect(copy).toContain(
      `data-agent-native-component-source-node-id="${wrapperId}"`,
    );
    expect(copy).toContain(`data-agent-native-node-id="an-instance-copy-file:`);
    expect(copy).toContain(`${COMPONENT_REF_ATTR}="button"`);
    expect(result.changes).toHaveLength(2);
  });

  it("refuses a stale structure snapshot before writing any file", async () => {
    const files = structureLiveFiles();
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId,
      sourceType: "inline",
      canEdit: true,
      files,
      boardFileId: null,
    });
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content: `${file.content}\npeer-change`,
      versionHash: sourceContentHash(`${file.content}\npeer-change`),
      language: "html",
    }));
    const result = await action.run({
      designId,
      fileId: "main-file",
      nodeId: "main-root",
      edit: {
        kind: "structure",
        before: structureMainContent,
        after: structureMainContent.replace(
          "</section>",
          '<div data-agent-native-node-id="new-layer"></div></section>',
        ),
      },
      source: { expectedFiles: expectedFor(files) },
    });

    expect(result).toMatchObject({ persisted: false, conflict: true });
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
  });
});
