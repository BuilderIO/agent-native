import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    rows: Array<Record<string, unknown>>;
    workspaceFiles: Array<Record<string, unknown>>;
    reads: Map<string, number>;
    readOverride?: (file: { id: string }, count: number) => string | undefined;
  } = { rows: [], workspaceFiles: [], reads: new Map() };
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => state.rows),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return {
    state,
    query,
    db: { select: vi.fn(() => query) },
    accessFilter: vi.fn(() => ({ kind: "access-filter" })),
    assertAccess: vi.fn(),
    resolveAccess: vi.fn(),
    readLiveSourceFile: vi.fn(),
    resolveSourceWorkspace: vi.fn(),
    writeInlineSourceFile: vi.fn(),
    writeInlineSourceFilesBatch: vi.fn(),
    snapshotDesignBeforeAgentEdit: vi.fn(),
    agentEnterDocument: vi.fn(),
    agentLeaveDocument: vi.fn(),
    agentUpdateSelection: vi.fn(),
    hasCollabState: vi.fn(),
    and: vi.fn((...parts) => ({ parts })),
    eq: vi.fn((left, right) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: mocks.agentEnterDocument,
  agentLeaveDocument: mocks.agentLeaveDocument,
  agentUpdateSelection: mocks.agentUpdateSelection,
  hasCollabState: mocks.hasCollabState,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      updatedAt: "designFiles.updatedAt",
    },
    designs: { id: "designs.id", data: "designs.data" },
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
  writeInlineSourceFile: mocks.writeInlineSourceFile,
  writeInlineSourceFilesBatch: mocks.writeInlineSourceFilesBatch,
}));

import { LINKED_COMPONENT_STRUCTURE_REFUSAL } from "../shared/code-layer.js";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "../shared/component-model.js";
import { sourceContentHash } from "../shared/source-workspace.js";
import action from "./apply-visual-edit.js";

const designId = "linked-visual-edit";
const mainContent = `<section data-agent-native-node-id="main-root" data-agent-native-component="Button" ${COMPONENT_ID_ATTR}="button"><span data-agent-native-node-id="main-label" style="color: blue">Play</span><i data-agent-native-node-id="main-sibling">!</i></section><div id="plain-target" class="ordinary" style="color: black">Plain</div>`;
const referenceContent = `<section data-agent-native-node-id="copy-root" ${COMPONENT_REF_ATTR}="button"><span data-agent-native-node-id="copy-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-label" style="color: blue">Play</span><i data-agent-native-node-id="copy-sibling" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-sibling">!</i></section>`;
const overrideContent = `<section data-agent-native-node-id="override-root" ${COMPONENT_REF_ATTR}="button"><span data-agent-native-node-id="override-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-label" style="color: purple" ${COMPONENT_OVERRIDES_ATTR}="${encodeURIComponent(
  JSON.stringify([
    { sourceNodeId: "main-label", property: "style:color" },
    { sourceNodeId: "main-label", property: "textContent" },
  ]),
)}">Custom</span><i data-agent-native-node-id="override-sibling" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-sibling">!</i></section>`;

function sourceFiles() {
  return [
    {
      id: "main-file",
      designId,
      filename: "main.html",
      fileType: "html",
      content: mainContent,
      createdAt: null,
      updatedAt: "main-revision",
    },
    {
      id: "copy-file",
      designId,
      filename: "copy.html",
      fileType: "html",
      content: referenceContent,
      createdAt: null,
      updatedAt: "copy-revision",
    },
    {
      id: "override-file",
      designId,
      filename: "override.html",
      fileType: "html",
      content: overrideContent,
      createdAt: null,
      updatedAt: "override-revision",
    },
  ];
}

describe("apply-visual-edit linked component persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const files = sourceFiles();
    mocks.state.rows = [files[0]!];
    mocks.state.workspaceFiles = files;
    mocks.state.reads.clear();
    mocks.state.readOverride = undefined;
    mocks.query.limit.mockImplementation(async () => mocks.state.rows);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.resolveAccess.mockResolvedValue({
      role: "editor",
      resource: { data: { sourceType: "inline" } },
    });
    mocks.snapshotDesignBeforeAgentEdit.mockResolvedValue(undefined);
    mocks.hasCollabState.mockResolvedValue(false);
    mocks.resolveSourceWorkspace.mockImplementation(async () => ({
      designId,
      sourceType: "inline",
      canEdit: true,
      files: mocks.state.workspaceFiles,
      boardFileId: null,
    }));
    mocks.readLiveSourceFile.mockImplementation(
      async (file: { id: string }) => {
        const count = (mocks.state.reads.get(file.id) ?? 0) + 1;
        mocks.state.reads.set(file.id, count);
        const override = mocks.state.readOverride?.(file, count);
        const source = mocks.state.workspaceFiles.find(
          (candidate) => candidate.id === file.id,
        );
        const content = override ?? String(source?.content ?? "");
        return {
          content,
          versionHash: sourceContentHash(content),
          language: "html",
        };
      },
    );
    mocks.writeInlineSourceFile.mockResolvedValue({
      versionHash: "plain-after",
      changed: true,
      updatedAt: "plain-updated",
    });
    mocks.writeInlineSourceFilesBatch.mockImplementation(
      async ({
        files: batch,
      }: {
        files: Array<{ file: { id: string }; content: string }>;
      }) => ({
        files: batch.map(({ file, content }) => ({
          id: file.id,
          versionHash: sourceContentHash(content),
          changed:
            content !==
            String(
              mocks.state.workspaceFiles.find(
                (candidate) => candidate.id === file.id,
              )?.content ?? "",
            ),
          updatedAt: `saved:${file.id}`,
        })),
        collaboration: { status: "synced" as const, files: [] },
      }),
    );
  });

  it("propagates a linked-main style edit, preserves an override, and keeps preimage versions", async () => {
    const result = await action.run({
      source: { kind: "design-file", fileId: "main-file" },
      intent: {
        kind: "style",
        target: { nodeId: "main-label" },
        property: "color",
        value: "orange",
      },
    });

    expect(result).toMatchObject({ persisted: true });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    expect(mocks.agentUpdateSelection).toHaveBeenCalledOnce();
    const { files } = mocks.writeInlineSourceFilesBatch.mock.calls[0]![0];
    const contentById = new Map(
      files.map(
        ({ file, content }: { file: { id: string }; content: string }) => [
          file.id,
          content,
        ],
      ),
    );
    expect(contentById.get("main-file")).toContain("color: orange");
    expect(contentById.get("copy-file")).toContain("color: orange");
    expect(contentById.get("override-file")).toContain("color: purple");
    expect(contentById.get("override-file")).toContain(
      COMPONENT_OVERRIDES_ATTR,
    );
    expect(
      files.map(
        ({
          file,
          expectedVersionHash,
        }: {
          file: { id: string };
          expectedVersionHash: string;
        }) => [file.id, expectedVersionHash],
      ),
    ).toEqual(
      sourceFiles().map((file) => [file.id, sourceContentHash(file.content)]),
    );
  });

  it("routes an all-style mixed linked/plain batch through one atomic write", async () => {
    const result = await action.run({
      source: { kind: "design-file", fileId: "main-file" },
      intent: [
        {
          kind: "style",
          target: { nodeId: "main-label" },
          property: "color",
          value: "orange",
        },
        {
          kind: "style",
          target: { nodeId: "plain-target" },
          property: "opacity",
          value: "0.5",
        },
      ],
    });

    expect(result).toMatchObject({ persisted: true });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const { files } = mocks.writeInlineSourceFilesBatch.mock.calls[0]![0];
    const main = files.find(
      ({ file }: { file: { id: string } }) => file.id === "main-file",
    )!.content;
    const copy = files.find(
      ({ file }: { file: { id: string } }) => file.id === "copy-file",
    )!.content;
    const overridden = files.find(
      ({ file }: { file: { id: string } }) => file.id === "override-file",
    )!.content;
    expect(main).toContain("color: orange");
    expect(main).toMatch(
      /<div id="plain-target"[^>]*style="[^"]*opacity: 0\.5/,
    );
    expect(copy).toContain("color: orange");
    expect(overridden).toContain("color: purple");
  });

  it("propagates one linked-main text edit while preserving an instance text override", async () => {
    const result = await action.run({
      source: { kind: "design-file", fileId: "main-file" },
      intent: {
        kind: "textContent",
        target: { nodeId: "main-label" },
        value: "Start",
      },
    });

    expect(result).toMatchObject({ persisted: true });
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const { files } = mocks.writeInlineSourceFilesBatch.mock.calls[0]![0];
    const contentById = new Map(
      files.map(
        ({ file, content }: { file: { id: string }; content: string }) => [
          file.id,
          content,
        ],
      ),
    );
    expect(contentById.get("main-file")).toContain(">Start</span>");
    expect(contentById.get("copy-file")).toContain(">Start</span>");
    expect(contentById.get("override-file")).toContain(">Custom</span>");
    expect(contentById.get("override-file")).toContain(
      COMPONENT_OVERRIDES_ATTR,
    );
  });

  it("routes an alternate CSS selector style edit through linked propagation", async () => {
    const result = await action.run({
      source: { kind: "design-file", fileId: "main-file" },
      intent: {
        kind: "style",
        target: { selector: '[data-agent-native-node-id="main-label"]' },
        property: "color",
        value: "orange",
      },
    });

    expect(result.persisted).toBe(true);
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const { files } = mocks.writeInlineSourceFilesBatch.mock.calls[0]![0];
    expect(
      files.find(
        ({ file }: { file: { id: string } }) => file.id === "copy-file",
      )?.content,
    ).toContain("color: orange");
  });

  it("routes an alternate CSS selector text edit through linked propagation", async () => {
    const result = await action.run({
      source: { kind: "design-file", fileId: "main-file" },
      intent: {
        kind: "textContent",
        target: { selector: '[data-agent-native-node-id="main-label"]' },
        value: "Start",
      },
    });

    expect(result.persisted).toBe(true);
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFilesBatch).toHaveBeenCalledOnce();
    const { files } = mocks.writeInlineSourceFilesBatch.mock.calls[0]![0];
    expect(
      files.find(
        ({ file }: { file: { id: string } }) => file.id === "copy-file",
      )?.content,
    ).toContain(">Start</span>");
  });

  it("keeps the legacy non-inline sourceMode guard before linked writes", async () => {
    mocks.state.rows = [
      {
        ...sourceFiles()[0],
        designData: JSON.stringify({ sourceMode: "localhost" }),
      },
    ];

    const result = await action.run({
      source: { kind: "design-file", fileId: "main-file" },
      intent: {
        kind: "style",
        target: { nodeId: "main-label" },
        property: "color",
        value: "orange",
      },
    });

    expect(result).toMatchObject({
      persisted: false,
      ctaRequired: true,
      result: { status: "needsAgent", changed: false },
    });
    expect(mocks.resolveSourceWorkspace).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("leaves an ordinary plain target on the original single-file path", async () => {
    const result = await action.run({
      source: { kind: "design-file", fileId: "main-file" },
      intent: {
        kind: "style",
        target: { nodeId: "plain-target" },
        property: "opacity",
        value: "0.5",
      },
    });

    expect(result.persisted).toBe(true);
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile.mock.calls[0]![0]).toMatchObject({
      expectedVersionHash: sourceContentHash(mainContent),
      content: expect.stringContaining("opacity: 0.5"),
    });
  });

  it("returns conflict without source writes when a linked base changes before the atomic path", async () => {
    mocks.state.readOverride = (file, count) =>
      file.id === "main-file" && count === 3
        ? mainContent.replace(">Play</span>", ">Concurrent</span>")
        : undefined;

    const result = await action.run({
      source: { kind: "design-file", fileId: "main-file" },
      intent: {
        kind: "style",
        target: { nodeId: "main-label" },
        property: "color",
        value: "orange",
      },
    });

    expect(result).toMatchObject({
      persisted: false,
      result: { status: "conflict", changed: false },
    });
    expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it.each([
    [
      "class",
      {
        kind: "class",
        target: { nodeId: "main-label" },
        operation: "add",
        className: "font-bold",
      },
      { status: "needsAgent", changed: false },
    ],
    [
      "structural",
      { kind: "wrapNodes", targetIds: ["main-label", "main-sibling"] },
      {
        status: "unsupported",
        message: LINKED_COMPONENT_STRUCTURE_REFUSAL,
        changed: false,
      },
    ],
    [
      "breakpoint-scoped",
      {
        kind: "style",
        target: { nodeId: "main-label" },
        property: "color",
        value: "red",
      },
      { status: "needsAgent", changed: false },
    ],
  ])(
    "refuses linked %s edits before any source write",
    async (_label, intent, expectedResult) => {
      const result = await action.run({
        source: { kind: "design-file", fileId: "main-file" },
        intent,
        ...(_label === "breakpoint-scoped" ? { activeFrameWidthPx: 390 } : {}),
      });

      expect(result).toMatchObject({
        persisted: false,
        result: expectedResult,
      });
      expect(mocks.writeInlineSourceFilesBatch).not.toHaveBeenCalled();
      expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    },
  );
});
