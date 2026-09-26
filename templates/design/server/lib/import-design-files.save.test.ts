
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let designRow: Record<string, unknown> | null = {
    id: "design-1",
    data: "{}",
  };
  let existingFiles: Array<Record<string, unknown>> = [];
  let designData: Record<string, unknown> = {};

  const designSelectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  designSelectChain.from.mockReturnValue(designSelectChain);
  designSelectChain.where.mockReturnValue(designSelectChain);
  designSelectChain.limit.mockImplementation(() =>
    Promise.resolve(designRow ? [designRow] : []),
  );

  const filesSelectChain = { from: vi.fn(), where: vi.fn() };
  const filesSelectWhereResult = {
    limit: vi.fn(),
    then: (
      resolve: (value: unknown) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve(existingFiles).then(resolve, reject),
  };
  filesSelectChain.from.mockReturnValue(filesSelectChain);
  filesSelectChain.where.mockImplementation(() => filesSelectWhereResult);
  filesSelectWhereResult.limit.mockImplementation(() =>
    Promise.resolve(existingFiles.slice(0, 1)),
  );

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateChain = { set: vi.fn(), where: vi.fn() };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);
  const update = vi.fn(() => updateChain);

  interface FakeTx {
    select: () => typeof designSelectChain | typeof filesSelectChain;
    insert: typeof insert;
    update: typeof update;
    execute: ReturnType<typeof vi.fn>;
  }

  let selectCallCount = 0;
  const tx: FakeTx = {
    select: vi.fn(() => {
      selectCallCount += 1;
      return selectCallCount === 1 ? designSelectChain : filesSelectChain;
    }),
    insert,
    update,
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };

  const db = {
    transaction: vi.fn(async (fn: (tx: FakeTx) => Promise<void>) => {
      selectCallCount = 0;
      await fn(tx);
    }),
  };

  return {
    db,
    insertValues,
    updateChain,
    setDesignRow: (row: Record<string, unknown> | null) => {
      designRow = row;
    },
    setExistingFiles: (files: Array<Record<string, unknown>>) => {
      existingFiles = files;
    },
    setDesignData: (next: Record<string, unknown>) => {
      designData = next;
    },
    getDesignData: () => designData,
    mutateDesignData: vi.fn(),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    readAppStateForCurrentTab: vi.fn().mockResolvedValue(null),
    seedFromText: vi.fn().mockResolvedValue(undefined),
    hasCollabState: vi.fn().mockResolvedValue(false),
    applyText: vi.fn().mockResolvedValue(undefined),
    and: vi.fn((...conditions) => ({ conditions })),
    eq: vi.fn((left, right) => ({ left, right })),
    nanoidCalls: 0,
  };
});

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: mocks.applyText,
  hasCollabState: mocks.hasCollabState,
  seedFromText: mocks.seedFromText,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  inArray: vi.fn((left, right) => ({ left, right })),
  like: vi.fn((left, right) => ({ left, right })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => `file-${++mocks.nanoidCalls}`),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: { id: "designs.id", data: "designs.data" },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      contentOperationSource: "designFiles.contentOperationSource",
    },
  },
}));

vi.mock("./design-data-mutation.js", () => ({
  InvalidDesignDataError: class InvalidDesignDataError extends Error {},
  mutateDesignData: mocks.mutateDesignData,
}));

import { saveImportedDesignFiles } from "./import-design-files.js";

describe("saveImportedDesignFiles: node-id annotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nanoidCalls = 0;
    mocks.setDesignRow({ id: "design-1", data: "{}" });
    mocks.setExistingFiles([]);
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.hasCollabState.mockResolvedValue(false);
    mocks.setDesignData({
      concurrentSibling: { keep: true },
      canvasFrames: {
        existing: { x: 0, y: 0, width: 320, height: 200, z: 0 },
      },
    });
    mocks.mutateDesignData.mockImplementation(
      async (options: {
        mutate: (
          current: Record<string, unknown>,
          context: { updatedAt: string },
        ) => Record<string, unknown>;
        isApplied: (current: Record<string, unknown>) => boolean;
      }) => {
        const updatedAt = "2026-07-09T12:00:00.000Z";
        const next = options.mutate(mocks.getDesignData(), { updatedAt });
        mocks.setDesignData(next);
        expect(options.isApplied(next)).toBe(true);
        return { data: next, updatedAt };
      },
    );
  });

  it("stamps missing data-agent-native-node-id attributes on imported HTML before persisting", async () => {
    const result = await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "html-string",
      files: [
        {
          filename: "imported.html",
          fileType: "html",
          content:
            "<!doctype html><html><body><main><button>Buy</button></main></body></html>",
        },
      ],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.source).toMatchObject({
      heightMode: "fixed",
      heightPinned: true,
    });
    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toContain("data-agent-native-node-id");
    expect(insertedValues.content).toContain("<button");

    expect(mocks.seedFromText).toHaveBeenCalledWith(
      expect.any(String),
      insertedValues.content,
    );
    expect(mocks.getDesignData()).toMatchObject({
      concurrentSibling: { keep: true },
      sourceMode: "import",
      canvasFrames: {
        existing: { x: 0, width: 320 },
      },
    });
  });

  it("places imported screens above the existing durable screen stack", async () => {
    mocks.setExistingFiles([
      {
        id: "existing-screen",
        filename: "existing.html",
        fileType: "html",
      },
      {
        id: "concurrent-screen",
        filename: "concurrent.html",
        fileType: "html",
      },
    ]);
    mocks.setDesignData({
      canvasFrames: {
        "existing-screen": { x: 0, y: 0, width: 320, height: 200, z: 7 },
        "concurrent-screen": {
          x: 400,
          y: 0,
          width: 320,
          height: 200,
          z: 42,
        },
      },
    });

    const result = await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "figma-clipboard-rest",
      files: [
        {
          filename: "pasted.html",
          fileType: "html",
          content: "<main>Pasted</main>",
        },
      ],
    });

    expect(result.placedFrames).toEqual([
      expect.objectContaining({
        fileId: "file-1",
        frame: expect.objectContaining({ x: 816, z: 43 }),
      }),
    ]);
    expect(mocks.getDesignData()).toMatchObject({
      canvasFrames: {
        "existing-screen": { z: 7 },
        "concurrent-screen": { z: 42 },
        "file-1": { x: 816, z: 43 },
      },
    });
  });

  it("places multiple imported screens side by side in one save", async () => {
    mocks.setDesignData({});
    const result = await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "figma-clipboard-rest",
      files: [
        {
          filename: "first.html",
          fileType: "html",
          content: "<main>First</main>",
          preferredFrame: { width: 320, height: 200 },
        },
        {
          filename: "second.html",
          fileType: "html",
          content: "<main>Second</main>",
          preferredFrame: { width: 640, height: 400 },
        },
      ],
    });

    expect(result.placedFrames).toEqual([
      expect.objectContaining({
        fileId: "file-1",
        frame: expect.objectContaining({ x: 0, width: 320 }),
      }),
      expect.objectContaining({
        fileId: "file-2",
        frame: expect.objectContaining({ x: 416, width: 640 }),
      }),
    ]);
  });

  it("reserves responsive preview space when placing imported screens", async () => {
    mocks.setExistingFiles([
      { id: "existing-screen", filename: "existing.html", fileType: "html" },
    ]);
    mocks.setDesignData({
      breakpointSet: { breakpoints: [{ id: "mobile", widthPx: 390 }] },
      screenMetadata: {
        "existing-screen": { width: 1440, height: 900 },
      },
      canvasFrames: {
        "existing-screen": {
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
          z: 0,
        },
      },
    });

    const result = await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "fig-upload",
      files: [
        {
          filename: "imported.html",
          fileType: "html",
          content: "<main>Imported</main>",
          preferredFrame: { width: 1440, height: 900 },
        },
      ],
    });

    expect(result.placedFrames[0]?.frame).toMatchObject({
      x: 1950,
      width: 1440,
    });
  });

  it("ignores board and support-file frames when reserving import space", async () => {
    mocks.setExistingFiles([
      { id: "existing-screen", filename: "existing.html", fileType: "html" },
      { id: "screen", filename: "screen.html", fileType: "html" },
      { id: "styles", filename: "styles.css", fileType: "css" },
      { id: "board", filename: "__board__.html", fileType: "html" },
    ]);
    mocks.setDesignData({
      breakpointSet: { breakpoints: [{ id: "mobile", widthPx: 390 }] },
      screenMetadata: {
        screen: { width: 1440, height: 900 },
        styles: { width: 1440, height: 900 },
        board: { width: 1440, height: 900 },
      },
      canvasFrames: {
        screen: { x: 0, y: 0, width: 1440, height: 900, z: 0 },
        styles: { x: 2000, y: 0, width: 1440, height: 900, z: 1 },
        board: { x: 10_000, y: 0, width: 1440, height: 900, z: 2 },
      },
    });

    const result = await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "fig-upload",
      files: [
        {
          filename: "imported.html",
          fileType: "html",
          content: "<main>Imported</main>",
          preferredFrame: { width: 1440, height: 900 },
        },
      ],
    });

    expect(result.placedFrames[0]?.frame.x).toBe(1950);
  });

  it("reserves the rotated responsive group footprint when placing imports", async () => {
    mocks.setExistingFiles([
      { id: "rotated", filename: "rotated.html", fileType: "html" },
    ]);
    mocks.setDesignData({
      breakpointSet: { breakpoints: [{ id: "tablet", widthPx: 300 }] },
      screenMetadata: {
        rotated: { width: 100, height: 200 },
      },
      canvasFrames: {
        rotated: {
          x: 0,
          y: 0,
          width: 100,
          height: 200,
          rotation: -45,
          z: 0,
        },
      },
    });

    const result = await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "fig-upload",
      files: [
        {
          filename: "imported.html",
          fileType: "html",
          content: "<main>Imported</main>",
          preferredFrame: { width: 1440, height: 900 },
        },
      ],
    });

    expect(result.placedFrames[0]?.frame.x).toBeGreaterThan(520);
  });

  it("is idempotent: preserves an existing clean id and only fills the missing one", async () => {
    await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "html-string",
      files: [
        {
          filename: "imported.html",
          fileType: "html",
          content:
            '<main data-agent-native-node-id="an-kept"><button>Buy</button></main>',
        },
      ],
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toContain(
      'data-agent-native-node-id="an-kept"',
    );
    expect(
      insertedValues.content.match(/data-agent-native-node-id="an-kept"/g),
    ).toHaveLength(1);
    expect(insertedValues.content).toMatch(
      /<button data-agent-native-node-id="[^"]+">Buy<\/button>/,
    );
  });

  it("does not annotate a non-HTML imported file", async () => {
    const cssContent = ".imported { color: blue; }";

    await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "html-string",
      files: [
        {
          filename: "imported.css",
          fileType: "css",
          content: cssContent,
        },
      ],
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toBe(cssContent);
  });

  it("preserves compiler-validated native clone HTML byte-for-byte when requested", async () => {
    const nativeContent =
      '<!doctype html>\n<html><body><div data-figma-node-id="1:2">Exact clone</div></body></html>';

    await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "creative-context-clone",
      preserveExactContent: true,
      files: [
        {
          filename: "native-clone.html",
          fileType: "html",
          content: nativeContent,
        },
      ],
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toBe(nativeContent);
    expect(mocks.seedFromText).toHaveBeenCalledWith(
      expect.any(String),
      nativeContent,
    );
  });

  it("reuses an existing operation source instead of inserting a duplicate screen", async () => {
    const existingContent =
      '<main data-agent-native-node-id="kept">Existing</main>';
    mocks.setExistingFiles([
      {
        id: "existing-screen",
        filename: "Hero.html",
        fileType: "html",
        content: existingContent,
        contentOperationSource: "fig-import:run-1:0",
      },
    ]);

    const result = await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "fig-upload",
      files: [
        {
          filename: "Hero.html",
          fileType: "html",
          content: "<main>Retry</main>",
          operationSource: "fig-import:run-1:0",
        },
      ],
    });

    expect(result.files[0]).toMatchObject({
      id: "existing-screen",
      filename: "Hero.html",
    });
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.seedFromText).toHaveBeenCalledWith(
      "existing-screen",
      existingContent,
    );
  });
  it("refuses invalid design data before inserting any file", async () => {
    mocks.setDesignRow({ id: "design-1", data: "{not json" });

    await expect(
      saveImportedDesignFiles({
        designId: "design-1",
        sourceType: "fig-upload",
        files: [
          { filename: "a.html", fileType: "html", content: "<main>A</main>" },
        ],
      }),
    ).rejects.toThrow();
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.mutateDesignData).not.toHaveBeenCalled();
  });

  it("places a placement group at the origin its first batch stored", async () => {
    mocks.setExistingFiles([
      { id: "existing-screen", filename: "existing.html", fileType: "html" },
      { id: "earlier-batch", filename: "earlier.html", fileType: "html" },
      { id: "added-mid-import", filename: "added.html", fileType: "html" },
    ]);
    mocks.setDesignData({
      canvasFrames: {
        "existing-screen": { x: 0, y: 0, width: 400, height: 300, z: 0 },
        "earlier-batch": { x: 496, y: 0, width: 200, height: 300, z: 1 },
        "added-mid-import": { x: 3000, y: 0, width: 200, height: 300, z: 2 },
      },
      screenMetadata: {
        "earlier-batch": {
          operationSource: "fig-import:run-1:frame:0",
          importOriginX: 496,
        },
      },
    });

    const result = await saveImportedDesignFiles({
      designId: "design-1",
      sourceType: "fig-upload",
      placementGroup: "fig-import:run-1:",
      files: [
        {
          filename: "later.html",
          fileType: "html",
          content: "<main>Later</main>",
          source: { operationSource: "fig-import:run-1:frame:1" },
          preferredFrame: { width: 200, height: 300, x: 1000, y: 500 },
        },
      ],
    });

    expect(result.placedFrames[0]?.frame).toMatchObject({
      x: 1496,
      y: 500,
      z: 3,
    });
    expect(result.files[0]?.source).toMatchObject({ importOriginX: 496 });
  });
});
