/**
 * Tests for saveImportedDesignFiles (server/lib/import-design-files.ts).
 *
 * Coverage focus: imported HTML screens (import-design-source.ts's
 * html-string / figma-paste-html paths) now get missing
 * data-agent-native-node-id attributes stamped before persisting
 * (shared/screen-annotation.ts), same as generate-design/create-file/
 * present-design-variants, so an imported screen is fully addressable by
 * id-keyed editor operations immediately instead of depending on a
 * client-side backfill the first time someone opens it.
 *
 * See import-design-files.test.ts (sibling file) for the pure
 * normalizeImportedHtmlDocument/sanitizeImportedFilename helper tests, which
 * don't need DB mocking.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let designRow: Record<string, unknown> | null = {
    id: "design-1",
    data: "{}",
  };
  let existingFiles: Array<Record<string, unknown>> = [];

  const designSelectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  designSelectChain.from.mockReturnValue(designSelectChain);
  designSelectChain.where.mockReturnValue(designSelectChain);
  designSelectChain.limit.mockImplementation(() =>
    Promise.resolve(designRow ? [designRow] : []),
  );

  const filesSelectChain = { from: vi.fn(), where: vi.fn() };
  filesSelectChain.from.mockReturnValue(filesSelectChain);
  filesSelectChain.where.mockImplementation(() =>
    Promise.resolve(existingFiles),
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
  }

  let selectCallCount = 0;
  const tx: FakeTx = {
    select: vi.fn(() => {
      selectCallCount += 1;
      return selectCallCount === 1 ? designSelectChain : filesSelectChain;
    }),
    insert,
    update,
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
    assertAccess: vi.fn().mockResolvedValue(undefined),
    readAppStateForCurrentTab: vi.fn().mockResolvedValue(null),
    seedFromText: vi.fn().mockResolvedValue(undefined),
    hasCollabState: vi.fn().mockResolvedValue(false),
    applyText: vi.fn().mockResolvedValue(undefined),
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
  eq: mocks.eq,
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
    },
  },
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
    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toContain("data-agent-native-node-id");
    expect(insertedValues.content).toContain("<button");

    // seedFromText/applyText get the SAME annotated content, not the
    // pre-annotation raw import string.
    expect(mocks.seedFromText).toHaveBeenCalledWith(
      expect.any(String),
      insertedValues.content,
    );
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
});
