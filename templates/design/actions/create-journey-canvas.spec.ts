import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    generatedId: 0,
    data: {} as Record<string, unknown>,
    boardContent: "",
    selectQueue: [] as unknown[][],
    inserts: [] as Array<{ table: string; rows: Array<Record<string, any>> }>,
    deletes: [] as Array<{ table: string; where: unknown }>,
    boardWrites: [] as Array<{ fileId: string; content: string }>,
    mutateOptions: [] as Array<Record<string, any>>,
  };
  const chain = (rows: unknown[]) => {
    const link: Record<string, any> = {
      from: vi.fn(() => link),
      where: vi.fn(() => link),
      limit: vi.fn(async () => rows),
      then: (
        resolve: (value: unknown[]) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return link;
  };
  const tx = {
    select: vi.fn(() => chain(state.selectQueue.shift() ?? [])),
    insert: vi.fn((table: { name: string }) => ({
      values: vi.fn(
        async (rows: Array<Record<string, any>> | Record<string, any>) => {
          state.inserts.push({
            table: table.name,
            rows: Array.isArray(rows) ? rows : [rows],
          });
        },
      ),
    })),
    delete: vi.fn((table: { name: string }) => ({
      where: vi.fn(async (where: unknown) => {
        state.deletes.push({ table: table.name, where });
      }),
    })),
  };
  return {
    state,
    chain,
    tx,
    assertAccess: vi.fn(),
    applyText: vi.fn(),
    hasCollabState: vi.fn(),
    seedFromText: vi.fn(),
    createDesign: vi.fn(),
    deleteDesign: vi.fn(),
    migrateBoard: vi.fn(),
    getDb: vi.fn(),
    getRequestUserEmail: vi.fn(),
    getProvider: vi.fn(),
    resolveAttachment: vi.fn(),
    putPrivateBlob: vi.fn(),
    deletePrivateBlob: vi.fn(),
    readLiveSourceFile: vi.fn(),
    deleteVisualEditSnapshotBlobs: vi.fn(),
    queueCleanup: vi.fn(),
    mutateDesignData: vi.fn(),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/collab", () => ({
  applyText: mocks.applyText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: mocks.seedFromText,
}));
vi.mock("@agent-native/core/private-blob", () => ({
  ATTACHMENT_REF_MAX_CHARS: 4_096,
  deletePrivateBlob: mocks.deletePrivateBlob,
  getActivePrivateBlobProviderForRequest: mocks.getProvider,
  putPrivateBlob: mocks.putPrivateBlob,
  resolveAttachment: mocks.resolveAttachment,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({ params }: { params: { designId: string } }) =>
      `https://design.example.test/open?designId=${params.designId}`,
  ),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  inArray: (left: unknown, right: unknown) => ({ inArray: [left, right] }),
  like: (left: unknown, right: unknown) => ({ like: [left, right] }),
}));
vi.mock("nanoid", () => ({
  nanoid: () => `generated-${++mocks.state.generatedId}`,
}));
vi.mock("../server/db/index.js", () => {
  const table = (name: string, columns: string[]) => ({
    name,
    ...Object.fromEntries(
      columns.map((column) => [column, `${name}.${column}`]),
    ),
  });
  return {
    getDb: mocks.getDb,
    schema: {
      designs: table("designs", ["id"]),
      designFiles: table("designFiles", [
        "id",
        "designId",
        "filename",
        "fileType",
        "content",
        "createdAt",
        "updatedAt",
      ]),
      designBoardReplayScreenshots: table("designBoardReplayScreenshots", [
        "id",
        "designId",
        "blobHandle",
      ]),
    },
  };
});
vi.mock("../server/lib/design-change-resource.js", () => ({
  designChangeResource: (designId: string) => ({
    resourceType: "design",
    resourceId: designId,
  }),
}));
vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));
vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  deleteVisualEditSnapshotBlobs: mocks.deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction: mocks.queueCleanup,
}));
vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: mocks.readLiveSourceFile,
}));
vi.mock("./create-design.js", () => ({ default: { run: mocks.createDesign } }));
vi.mock("./delete-design.js", () => ({ default: { run: mocks.deleteDesign } }));
vi.mock("./migrate-board-objects-to-file.js", () => ({
  default: { run: mocks.migrateBoard },
}));

import { emptyBoardHtml } from "../shared/board-file.js";
import action from "./create-journey-canvas.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const BOARD_FILE = {
  id: "board-1",
  designId: "design-1",
  filename: "__board__.html",
  fileType: "html",
  content: "",
  createdAt: null,
  updatedAt: null,
};

function rawInput(frames: Array<Record<string, unknown>>) {
  const step = (key: string, parentKey: string | null, n: number) => ({
    key,
    label: key,
    parentKey,
    depth: parentKey ? 2 : 1,
    kind: "step" as const,
    n,
    pctOfRoot: n / 10,
    pctOfParent: parentKey ? 50 : n / 10,
    dropoffN: 10,
    dropoffPct: 10,
    examples: [
      {
        sessionId: `${key}-s1`,
        recordingId: `${key}-r1`,
        ts: "2026-10-01T12:00:00.000Z",
        offsetMs: 2_000,
        viewport: { width: 1440, height: 900 },
      },
    ],
  });
  return {
    title: "Journey",
    tree: {
      window: { from: "2026-10-01", to: "2026-10-07" },
      app: "design",
      rootN: 1000,
      coverage: {
        sessionsWithEvents: 1000,
        sessionsWithReplay: 10,
        truncated: false,
      },
      nodes: [step("a", null, 1000), step("b", "a", 500)],
    },
    frames,
  };
}

const frame = (nodeKey: string, extra: Record<string, unknown>) => ({
  nodeKey,
  exampleIndex: 0,
  width: 1440,
  height: 900,
  capturedAt: "2026-10-08T09:30:00.000Z",
  ...extra,
});

const parsed = (input: ReturnType<typeof rawInput>) =>
  (action as any).schema.parse(input);

beforeEach(() => {
  vi.clearAllMocks();
  const { state } = mocks;
  state.generatedId = 0;
  state.data = {};
  state.boardContent = emptyBoardHtml();
  state.selectQueue = [];
  state.inserts = [];
  state.deletes = [];
  state.boardWrites = [];
  state.mutateOptions = [];
  mocks.getRequestUserEmail.mockReturnValue("designer@example.test");
  mocks.assertAccess.mockResolvedValue({
    role: "owner",
    resource: {
      id: "design-1",
      ownerEmail: "owner@example.test",
      orgId: null,
      visibility: "private",
    },
  });
  mocks.createDesign.mockImplementation(async ({ id }: { id: string }) => ({
    id,
  }));
  mocks.migrateBoard.mockResolvedValue({ boardFileId: BOARD_FILE.id });
  mocks.getDb.mockImplementation(() => ({
    select: () => mocks.chain([{ ...BOARD_FILE, content: state.boardContent }]),
  }));
  mocks.readLiveSourceFile.mockImplementation(async () => ({
    content: state.boardContent,
    versionHash: "v1",
    source: "stored",
  }));
  mocks.getProvider.mockResolvedValue({ id: "private-provider" });
  mocks.resolveAttachment.mockResolvedValue({
    status: "ok",
    file: { data: PNG },
  });
  mocks.putPrivateBlob.mockImplementation(async () => ({
    id: `blob-${++state.generatedId}`,
    provider: "private-provider",
    opaque: true,
    encrypted: true,
  }));
  mocks.deletePrivateBlob.mockResolvedValue({ deleted: true });
  mocks.hasCollabState.mockResolvedValue(false);
  mocks.mutateDesignData.mockImplementation(
    async (options: Record<string, any>) => {
      state.mutateOptions.push(options);
      const next = options.mutate(state.data, {
        updatedAt: "2026-10-08T10:00:00.000Z",
      });
      const files = [{ id: BOARD_FILE.id, content: state.boardContent }];
      const updates = options.mutateFiles?.(state.data, next, { files }) ?? [];
      for (const update of updates) state.boardWrites.push(update);
      await options.mutateInTransaction?.(mocks.tx, state.data, next, {});
      if (!options.isApplied(next)) throw new Error("not applied");
      state.data = next;
      return { data: next, updatedAt: "t", updatedFiles: [] };
    },
  );
});

describe("create-journey-canvas run", () => {
  it("creates a design, draws every screen and the board in one mutation, and returns the documented shape", async () => {
    const result = await action.run(
      parsed(
        rawInput([
          frame("a", { imageUrl: "https://img.example.test/a.png" }),
          frame("b", { imageUrl: "https://img.example.test/b.png" }),
        ]),
      ),
      { caller: "mcp" } as any,
    );

    expect(Object.keys(result).sort()).toEqual([
      "designId",
      "frameCount",
      "nodeCount",
      "skippedNodes",
      "url",
    ]);
    expect(result).toMatchObject({
      designId: "generated-1",
      nodeCount: 2,
      frameCount: 2,
      skippedNodes: [],
      url: "https://design.example.test/open?designId=generated-1",
    });
    expect(mocks.createDesign).toHaveBeenCalledWith(
      expect.objectContaining({ id: "generated-1", designSystemId: null }),
      expect.anything(),
    );
    expect(mocks.mutateDesignData).toHaveBeenCalledTimes(1);

    const { data, inserts, boardWrites } = {
      data: mocks.state.data,
      inserts: mocks.state.inserts,
      boardWrites: mocks.state.boardWrites,
    };
    const files = inserts.find((entry) => entry.table === "designFiles")!.rows;
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.id.startsWith("jc_"))).toBe(true);
    expect(files.every((file) => file.filename.startsWith("journey-"))).toBe(
      true,
    );
    expect(files.every((file) => file.fileType === "html")).toBe(true);
    expect(files.some((file) => /base64|data:/.test(file.content))).toBe(false);

    const frames = data.canvasFrames as Record<string, Record<string, number>>;
    expect(Object.keys(frames).sort()).toEqual(files.map((f) => f.id).sort());
    expect(frames[files[0]!.id]).toMatchObject({
      x: expect.any(Number),
      width: 360,
    });
    const metadata = data.screenMetadata as Record<
      string,
      Record<string, unknown>
    >;
    expect(metadata[files[0]!.id]).toMatchObject({
      title: "a",
      breakpointWidths: [],
      heightMode: "fixed",
    });
    expect(data.journeyCanvasOrigin).toEqual({ x: 0, y: 0 });

    expect(boardWrites).toHaveLength(1);
    expect(boardWrites[0]!.fileId).toBe("board-1");
    expect(boardWrites[0]!.content).toContain('data-an-primitive="arrow"');
    expect(
      mocks.state.inserts.some(
        (e) => e.table === "designBoardReplayScreenshots",
      ),
    ).toBe(false);
    expect(mocks.seedFromText).toHaveBeenCalledTimes(3);
  });

  it("copies attachmentRef screenshots into private blobs and serves them through the authenticated route", async () => {
    await action.run(
      parsed(
        rawInput([
          frame("a", { attachmentRef: "ref-a" }),
          frame("b", { attachmentRef: "ref-b" }),
        ]),
      ),
      {} as any,
    );

    expect(mocks.resolveAttachment).toHaveBeenCalledWith("ref-a", {
      ownerEmail: "designer@example.test",
      orgId: null,
    });
    expect(mocks.putPrivateBlob).toHaveBeenCalledTimes(2);
    expect(mocks.putPrivateBlob.mock.calls[0]![0]).toMatchObject({
      ownerEmail: "designer@example.test",
      mimeType: "image/png",
    });
    const rows = mocks.state.inserts.find(
      (entry) => entry.table === "designBoardReplayScreenshots",
    )!.rows;
    expect(rows).toHaveLength(2);
    const files = mocks.state.inserts.find(
      (entry) => entry.table === "designFiles",
    )!.rows;
    for (const row of rows) {
      expect(row.id.startsWith("jcs_")).toBe(true);
      expect(JSON.parse(row.blobHandle)).toMatchObject({
        opaque: true,
        provider: "private-provider",
      });
      expect(row).toMatchObject({
        designId: "generated-1",
        mimeType: "image/png",
        app: "design",
      });
      expect(
        files.some((file) =>
          file.content.includes(
            `/api/design-board-replay-screenshots/${row.id}`,
          ),
        ),
      ).toBe(true);
    }
    expect(files.some((file) => file.content.includes("ref-a"))).toBe(false);
  });

  it("replaces only what it drew before and leaves other canvas content in place", async () => {
    mocks.state.data = {
      canvasFrames: {
        keep: { x: 0, y: 0, width: 100, height: 100 },
        jc_old: { x: 1, y: 1, width: 360, height: 281 },
      },
      screenMetadata: { keep: { width: 100 }, jc_old: { width: 360 } },
      journeyCanvasOrigin: { x: 40, y: 900 },
    };
    const foreign =
      '<div data-agent-native-node-id="user-1" data-an-primitive="rectangle" style="position:absolute;left:5px;top:5px;width:10px;height:10px"></div>';
    const stale =
      '<div data-agent-native-node-id="jc-edge-old" data-an-primitive="arrow" style="position:absolute;left:0px;top:0px;width:1px;height:1px"></div>';
    mocks.state.boardContent = emptyBoardHtml().replace(
      "</body>",
      `${foreign}\n${stale}\n</body>`,
    );
    mocks.state.selectQueue = [
      [{ id: "jc_old" }],
      [{ id: "jcs_old", blobHandle: '{"id":"old-blob"}' }],
    ];

    const result = await action.run(
      {
        ...parsed(
          rawInput([
            frame("a", { imageUrl: "https://img.example.test/a.png" }),
          ]),
        ),
        designId: "design-1",
      },
      {} as any,
    );

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-1",
      "editor",
    );
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(result.designId).toBe("design-1");

    const frames = mocks.state.data.canvasFrames as Record<
      string,
      Record<string, number>
    >;
    expect(frames.keep).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(frames.jc_old).toBeUndefined();
    expect(
      (mocks.state.data.screenMetadata as Record<string, unknown>).jc_old,
    ).toBeUndefined();
    const journeyFrames = Object.entries(frames).filter(([id]) =>
      id.startsWith("jc_"),
    );
    expect(journeyFrames).toHaveLength(1);
    expect(journeyFrames[0]![1]!.x).toBeGreaterThanOrEqual(40);
    expect(journeyFrames[0]![1]!.y).toBeGreaterThanOrEqual(900);

    expect(mocks.state.deletes.map((entry) => entry.table).sort()).toEqual([
      "designBoardReplayScreenshots",
      "designFiles",
    ]);
    for (const deleted of mocks.state.deletes) {
      const ids = JSON.stringify(deleted.where);
      expect(ids).toMatch(/jc_old|jcs_old/);
    }
    expect(mocks.queueCleanup).toHaveBeenCalledWith(mocks.tx, [
      '{"id":"old-blob"}',
    ]);
    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledWith([
      '{"id":"old-blob"}',
    ]);

    const board = mocks.state.boardWrites[0]!.content;
    expect(board).toContain(foreign);
    expect(board).not.toContain("jc-edge-old");
    expect(board).toContain('data-agent-native-node-id="jc-title"');
  });

  it("places a first draw below existing canvas content", async () => {
    mocks.state.data = {
      canvasFrames: { keep: { x: 0, y: 0, width: 100, height: 700 } },
    };
    await action.run(
      {
        ...parsed(
          rawInput([
            frame("a", { imageUrl: "https://img.example.test/a.png" }),
          ]),
        ),
        designId: "design-1",
      },
      {} as any,
    );
    expect(mocks.state.data.journeyCanvasOrigin).toEqual({ x: 0, y: 860 });
  });

  it("reconciles live collaboration for the board when it has live state", async () => {
    mocks.hasCollabState.mockResolvedValue(true);
    await action.run(
      parsed(
        rawInput([frame("a", { imageUrl: "https://img.example.test/a.png" })]),
      ),
      {} as any,
    );
    expect(mocks.applyText).toHaveBeenCalledWith(
      "board-1",
      mocks.state.boardWrites[0]!.content,
      "content",
      "agent",
      expect.objectContaining({ validateBase: expect.any(Function) }),
    );
    const { validateBase } = mocks.applyText.mock.calls[0]![4];
    expect(() => validateBase(mocks.state.boardContent)).not.toThrow();
    expect(() => validateBase("edited since")).toThrow(/changed/);
  });
});

describe("create-journey-canvas exposure", () => {
  it("is declared an MCP tool so external agents such as Codex can call it", () => {
    expect((action as any).mcpTool).toBe(true);
    expect((action as any).mcpAnnotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect((action as any).requiresAuth).toBe(true);
    expect((action as any).agentTool).not.toBe(false);
  });
});

describe("create-journey-canvas failures", () => {
  it("stops before any write when the caller cannot edit the design", async () => {
    mocks.assertAccess.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      action.run(
        {
          ...parsed(
            rawInput([
              frame("a", { imageUrl: "https://img.example.test/a.png" }),
            ]),
          ),
          designId: "design-1",
        },
        {} as any,
      ),
    ).rejects.toThrow("Forbidden");
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });

  it("fails loudly with the skipped nodes when nothing has a screenshot", async () => {
    await expect(
      action.run(parsed(rawInput([])), {} as any),
    ).rejects.toMatchObject({
      errorCode: "journey_canvas_empty",
      details: { skippedNodes: [{ key: "a" }, { key: "b" }] },
    });
    expect(mocks.createDesign).not.toHaveBeenCalled();
  });

  it("requires a private blob provider only when attachmentRefs are used", async () => {
    mocks.getProvider.mockResolvedValue(null);
    await expect(
      action.run(
        parsed(rawInput([frame("a", { attachmentRef: "ref-a" })])),
        {} as any,
      ),
    ).rejects.toMatchObject({ errorCode: "private_blob_provider_required" });
    expect(mocks.createDesign).not.toHaveBeenCalled();
    mocks.getProvider.mockClear();
    await action.run(
      parsed(
        rawInput([frame("a", { imageUrl: "https://img.example.test/a.png" })]),
      ),
      {} as any,
    );
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it("discards blobs it already stored, and deletes a design it created, when a later attachment fails", async () => {
    mocks.resolveAttachment
      .mockResolvedValueOnce({ status: "ok", file: { data: PNG } })
      .mockResolvedValueOnce({ status: "notFound", reason: "expired" });
    await expect(
      action.run(
        parsed(
          rawInput([
            frame("a", { attachmentRef: "ref-a" }),
            frame("b", { attachmentRef: "ref-b" }),
          ]),
        ),
        {} as any,
      ),
    ).rejects.toMatchObject({ errorCode: "attachment_notFound" });
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
    expect(mocks.deletePrivateBlob).toHaveBeenCalledTimes(1);
    expect(mocks.createDesign).not.toHaveBeenCalled();
  });

  it("removes the design it created and the blobs it stored when the transaction fails", async () => {
    mocks.mutateDesignData.mockRejectedValueOnce(new Error("conflict"));
    await expect(
      action.run(
        parsed(rawInput([frame("a", { attachmentRef: "ref-a" })])),
        {} as any,
      ),
    ).rejects.toThrow("conflict");
    expect(mocks.deleteDesign).toHaveBeenCalledWith(
      { id: "generated-1" },
      expect.anything(),
    );
    expect(mocks.deletePrivateBlob).toHaveBeenCalledTimes(1);
  });

  it("rejects non-image attachment bytes", async () => {
    mocks.resolveAttachment.mockResolvedValue({
      status: "ok",
      file: { data: new Uint8Array([1, 2, 3, 4]) },
    });
    await expect(
      action.run(
        parsed(rawInput([frame("a", { attachmentRef: "ref-a" })])),
        {} as any,
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_replay_screenshot_image" });
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });
});
