import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    activeTable: "",
    designData: "",
    fileContent: "",
    fileContentAtMutation: null as string | null,
  };
  const selectChain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  } = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockImplementation((table: unknown) => {
    state.activeTable =
      typeof table === "object" && table !== null && "id" in table
        ? String(table.id)
        : table;
    return selectChain;
  });
  selectChain.where.mockImplementation(async () =>
    state.activeTable === "designs.id"
      ? [{ data: state.designData }]
      : [
          {
            id: "file-1",
            filename: "Screen.html",
            fileType: "html",
            content: state.fileContent,
          },
        ],
  );

  const db = { select: vi.fn(() => selectChain) };
  const mutateDesignData = vi.fn(async (input: any) => {
    const current = JSON.parse(state.designData);
    const next = input.mutate(current, {
      updatedAt: "2026-10-27T00:00:00.000Z",
    });
    if (state.fileContentAtMutation !== null) {
      state.fileContent = state.fileContentAtMutation;
      state.fileContentAtMutation = null;
    }
    const files = [
      { id: "file-1", fileType: "html", content: state.fileContent },
    ];
    const updates = input.mutateFiles?.(current, next, {
      updatedAt: "2026-10-27T00:00:00.000Z",
      files,
    });
    state.designData = JSON.stringify(next);
    for (const update of updates ?? []) {
      if (update.fileId === "file-1") state.fileContent = update.content;
    }
    if (!input.isApplied(next)) throw new Error("Mutation did not apply.");
    return {
      data: next,
      updatedAt: next.updatedAt,
      updatedFiles: updates ?? [],
    };
  });

  return {
    state,
    db,
    assertAccess: vi.fn(),
    fetchFigmaNodeSnapshot: vi.fn(),
    buildScreenFilesFromFigmaNodes: vi.fn(),
    snapshotDesignBeforeAgentEdit: vi.fn(),
    mutateDesignData,
    eq: vi.fn((field, value) => ({ field, value })),
    and: vi.fn((...conditions) => conditions),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: { id: "designs.id", data: "designs.data" },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
  },
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));

vi.mock("../server/lib/figma-node-import.js", () => ({
  buildScreenFilesFromFigmaNodes: mocks.buildScreenFilesFromFigmaNodes,
  fetchFigmaNodeSnapshot: mocks.fetchFigmaNodeSnapshot,
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

vi.mock("../shared/generation-output-receipt.js", () => ({
  designOutputWriteReceipt: vi.fn(() => ({
    changed: true,
    verified: true,
  })),
}));

import { hashJson, hashText } from "../server/lib/figma-sync.js";
import action from "./sync-figma-screen.js";

const baselineNode = { id: "1:2", name: "Hero", type: "FRAME", width: 100 };
const changedNode = { ...baselineNode, width: 120 };
const baselineHtml = "<main>before</main>";
const changedHtml = "<main>after</main>";

function setScreen(input?: {
  node?: Record<string, unknown>;
  html?: string;
  version?: string;
}) {
  const node = input?.node ?? baselineNode;
  const html = input?.html ?? baselineHtml;
  const version = input?.version ?? "1";
  mocks.state.designData = JSON.stringify({
    screenMetadata: {
      "file-1": {
        figmaFileKey: "abcDEF12345",
        figmaNodeId: "1:2",
        figmaSync: {
          figmaVersion: "1",
          figmaNodeHash: hashJson(baselineNode),
          designHash: hashText(baselineHtml),
        },
      },
    },
  });
  mocks.state.fileContent = html;
  mocks.fetchFigmaNodeSnapshot.mockResolvedValue({
    node,
    version,
    lastModified: "2026-10-27T00:00:00.000Z",
    role: "owner",
  });
}

describe("sync-figma-screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setScreen();
  });

  it("stays in sync across three unchanged checks", async () => {
    const results = [];
    for (let index = 0; index < 3; index += 1) {
      results.push(
        await action.run({ designId: "design-1", fileId: "file-1" } as any),
      );
    }

    expect(results.map((result: any) => result.status)).toEqual([
      "in-sync",
      "in-sync",
      "in-sync",
    ]);
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
  });

  it("reports simultaneous edits without overwriting either side", async () => {
    setScreen({ html: "<main>local edit</main>" });
    mocks.fetchFigmaNodeSnapshot.mockResolvedValue({
      node: changedNode,
      version: "2",
      lastModified: "2026-10-27T00:00:00.000Z",
      role: "owner",
    });

    const result = await action.run({
      designId: "design-1",
      fileId: "file-1",
      mode: "pull",
    } as any);

    expect(result).toMatchObject({
      status: "both-changed",
      applied: false,
    });
    expect(mocks.state.fileContent).toBe("<main>local edit</main>");
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
  });

  it("pulls a source-only change and records the resulting baseline", async () => {
    mocks.fetchFigmaNodeSnapshot
      .mockResolvedValueOnce({
        node: changedNode,
        version: "2",
        lastModified: "2026-10-27T00:00:00.000Z",
        role: "owner",
      })
      .mockResolvedValueOnce({
        node: changedNode,
        version: "2",
        lastModified: "2026-10-27T00:00:00.000Z",
        role: "owner",
      });
    mocks.buildScreenFilesFromFigmaNodes.mockResolvedValue({
      files: [{ fileType: "html", content: changedHtml }],
      omissionWarnings: [],
    });

    const result = await action.run({
      designId: "design-1",
      fileId: "file-1",
      mode: "pull",
    } as any);
    const nextData = JSON.parse(mocks.state.designData);

    expect(result).toMatchObject({ status: "in-sync", applied: true });
    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledWith(
      "design-1",
      undefined,
    );
    expect(mocks.state.fileContent).toBe(changedHtml);
    expect(nextData.screenMetadata["file-1"].figmaSync).toEqual({
      figmaVersion: "2",
      figmaNodeHash: hashJson(changedNode),
      designHash: hashText(changedHtml),
    });
  });

  it("records a connected write only for the exact observed snapshots", async () => {
    setScreen({ html: changedHtml });
    mocks.fetchFigmaNodeSnapshot.mockResolvedValue({
      node: changedNode,
      version: "2",
      lastModified: "2026-10-27T00:00:00.000Z",
      role: "owner",
    });

    const result = await action.run({
      designId: "design-1",
      fileId: "file-1",
      mode: "record-push",
      expectedFigmaVersion: "1",
      expectedFigmaNodeHashBefore: hashJson(baselineNode),
      expectedDesignHash: hashText(changedHtml),
      expectedFigmaVersionAfter: "2",
      expectedFigmaNodeHashAfter: hashJson(changedNode),
    } as any);

    expect(result).toMatchObject({ status: "in-sync", recorded: true });
    expect(mocks.state.fileContent).toBe(changedHtml);
  });

  it("rejects a push receipt when Design changes during the transaction", async () => {
    setScreen({ html: changedHtml });
    mocks.state.fileContentAtMutation = "<main>concurrent edit</main>";
    mocks.fetchFigmaNodeSnapshot.mockResolvedValue({
      node: changedNode,
      version: "2",
      lastModified: "2026-10-27T00:00:00.000Z",
      role: "owner",
    });

    await expect(
      action.run({
        designId: "design-1",
        fileId: "file-1",
        mode: "record-push",
        expectedFigmaVersion: "1",
        expectedFigmaNodeHashBefore: hashJson(baselineNode),
        expectedDesignHash: hashText(changedHtml),
        expectedFigmaVersionAfter: "2",
        expectedFigmaNodeHashAfter: hashJson(changedNode),
      } as any),
    ).rejects.toMatchObject({
      errorCode: "figma_sync_design_conflict",
      statusCode: 409,
    });
    expect(
      JSON.parse(mocks.state.designData).screenMetadata["file-1"].figmaSync,
    ).toMatchObject({ designHash: hashText(baselineHtml) });
  });
});
