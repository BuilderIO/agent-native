import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
    designs: { id: "designs.id" },
    designShares: {},
  };
  const fileRow = {
    id: "file-1",
    designId: "design-1",
    filename: "index.html",
    fileType: "html",
    content: "",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
  const selectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.innerJoin.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([fileRow]);
  selectChain.orderBy.mockResolvedValue([fileRow]);

  return {
    schema,
    fileRow,
    db: { select: vi.fn(() => selectChain) },
    selectChain,
    resolveAccess: vi.fn().mockResolvedValue({
      role: "editor",
      resource: { data: JSON.stringify({ sourceType: "inline" }) },
    }),
    accessFilter: vi.fn(),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    snapshotDesignBeforeAgentEdit: vi.fn().mockResolvedValue(undefined),
    writeInlineSourceFile: vi.fn().mockResolvedValue({
      changed: true,
      updatedAt: "2026-09-15T00:00:01.000Z",
      versionHash: "next-hash",
    }),
    agentEnterDocument: vi.fn(),
    agentLeaveDocument: vi.fn(),
    agentUpdateSelection: vi.fn(),
    and: vi.fn((...parts: unknown[]) => ({ parts })),
    eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: mocks.agentEnterDocument,
  agentLeaveDocument: mocks.agentLeaveDocument,
  agentUpdateSelection: mocks.agentUpdateSelection,
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: mocks.schema,
}));
vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));
vi.mock("../server/source-workspace.js", () => ({
  writeInlineSourceFile: mocks.writeInlineSourceFile,
}));

import detachAction from "./detach-component-instance.js";
import swapAction from "./swap-component-instance.js";

const CANONICAL_MAIN =
  '<main data-agent-native-node-id="main-card" data-agent-native-component="Card" data-agent-native-component-id="cmp-card"><p data-agent-native-node-id="main-title">Main</p></main>';

beforeEach(() => {
  mocks.fileRow.content = "";
  mocks.fileRow.updatedAt = "2026-09-15T00:00:00.000Z";
  mocks.writeInlineSourceFile.mockClear();
  mocks.agentEnterDocument.mockClear();
  mocks.agentLeaveDocument.mockClear();
  mocks.agentUpdateSelection.mockClear();
});

describe("detach-component-instance identity boundary", () => {
  it("refuses a canonical main before writing and leaves its id intact", async () => {
    mocks.fileRow.content = CANONICAL_MAIN;

    await expect(
      detachAction.run({
        designId: "design-1",
        fileId: "file-1",
        nodeId: "main-card",
      }),
    ).rejects.toThrow(/canonical component main/);

    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    expect(mocks.fileRow.content).toContain(
      'data-agent-native-component-id="cmp-card"',
    );
  });

  it("still detaches a linked reference through the action write path", async () => {
    const linked =
      '<main data-agent-native-node-id="card-copy" data-agent-native-component="Card copy" data-agent-native-component-ref="cmp-card"><p data-agent-native-node-id="copy-title" data-agent-native-component-source-node-id="main-title">Copy</p></main>';
    mocks.fileRow.content = linked;

    const result = await detachAction.run({
      designId: "design-1",
      fileId: "file-1",
      nodeId: "card-copy",
      source: {
        currentContent: linked,
        revision: mocks.fileRow.updatedAt,
      },
    });

    expect(result).toMatchObject({ detached: true, fileId: "file-1" });
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.not.stringContaining("data-agent-native-component-ref"),
      }),
    );
  });
});

describe("swap-component-instance identity boundary", () => {
  it("refuses a canonical main before searching or writing", async () => {
    mocks.fileRow.content = CANONICAL_MAIN;

    await expect(
      swapAction.run({
        designId: "design-1",
        fileId: "file-1",
        nodeId: "main-card",
        targetComponentName: "Button",
      }),
    ).rejects.toThrow(/canonical component main/);

    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("skips a canonical source and swaps from a linked reference", async () => {
    const content =
      `${CANONICAL_MAIN}` +
      '<main data-agent-native-node-id="card-copy" data-agent-native-component="Card copy" data-agent-native-component-ref="cmp-card">Copy</main>' +
      '<button data-agent-native-node-id="main-button" data-agent-native-component="Button" data-agent-native-component-id="cmp-button">Main button</button>' +
      '<button data-agent-native-node-id="button-copy" data-agent-native-component="Button" data-agent-native-component-ref="cmp-button">Linked button</button>';
    mocks.fileRow.content = content;

    const result = await swapAction.run({
      designId: "design-1",
      fileId: "file-1",
      nodeId: "card-copy",
      targetComponentName: "Button",
      source: {
        currentContent: content,
        revision: mocks.fileRow.updatedAt,
      },
    });

    expect(result).toMatchObject({ swapped: true, toComponent: "Button" });
    const writtenContent = mocks.writeInlineSourceFile.mock.calls[0]?.[0]
      ?.content as string;
    expect(writtenContent).toContain(
      'data-agent-native-component-ref="cmp-button"',
    );
    expect(
      writtenContent.match(/data-agent-native-component-id="cmp-button"/g),
    ).toHaveLength(1);
  });
});
