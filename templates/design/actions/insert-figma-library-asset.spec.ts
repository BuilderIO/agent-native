/**
 * Tests for insert-figma-library-asset.
 *
 * Regression coverage for the stale-diff-base write race: the action must
 * read the LIVE base (collab text when present, else the SQL row) right
 * before transforming, and persist through writeInlineSourceFile with the
 * versionHash it read — the same pattern already covered for
 * insert-design-native-asset and insert-asset.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // `where()` must behave both as a directly-awaited result (the initial
  // multi-file lookup in insert-figma-library-asset.ts) AND as a chain that
  // supports a trailing `.limit(1)` (writeInlineSourceFile's internal
  // re-select in server/source-workspace.ts, now used by the action's write
  // path). Returning a real Promise with an extra `.limit()` method attached
  // covers both call shapes with the same mocked resolved rows, narrowed by
  // id when the predicate looks like `eq(designFiles.id, someId)`.
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  }

  let rows: Array<Record<string, unknown>> = [];
  const fileSelectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  fileSelectChain.from.mockReturnValue(fileSelectChain);
  fileSelectChain.innerJoin.mockReturnValue(fileSelectChain);
  fileSelectChain.where.mockImplementation(
    (predicate?: { left?: unknown; right?: unknown }) => {
      if (predicate && predicate.left === "designFiles.id") {
        return makeWhereResult(
          rows.filter((row) => row.id === predicate.right),
        );
      }
      return makeWhereResult(rows);
    },
  );

  const updateChain = { set: vi.fn(), where: vi.fn() };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue({ rowsAffected: 1 });

  const db = {
    select: vi.fn(() => fileSelectChain),
    update: vi.fn(() => updateChain),
  };

  // Shared with the @agent-native/core/collab mock below: writeInlineSourceFile
  // re-reads getText() right after seedFromText/applyText to persist the
  // "authoritative" collab content back to SQL, so seedFromText must
  // actually store what getText reads back. Cleared per-test in beforeEach
  // (the vi.mock factory only runs once per file, so without an explicit
  // reset this map would leak seeded content across tests).
  const seededCollabText = new Map<string, string>();

  return {
    db,
    fileSelectChain,
    updateChain,
    seededCollabText,
    setRows: (next: Array<Record<string, unknown>>) => {
      rows = next;
    },
    accessFilter: vi.fn(() => ({ access: true })),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    resolveAccess: vi.fn().mockResolvedValue({ role: "editor", resource: {} }),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
    isNull: vi.fn((value) => ({ isNull: value })),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  isNull: mocks.isNull,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: vi.fn().mockResolvedValue(null),
}));

vi.mock("@agent-native/core/collab", () => {
  const seeded = mocks.seededCollabText;
  return {
    hasCollabState: vi.fn().mockResolvedValue(false),
    getText: vi.fn(async (docId: string) => seeded.get(docId) ?? ""),
    applyText: vi.fn(async (docId: string, text: string) => {
      seeded.set(docId, text);
      return text;
    }),
    seedFromText: vi.fn(async (docId: string, text: string) => {
      if (!seeded.has(docId)) seeded.set(docId, text);
    }),
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
    designs: { id: "designs.id" },
    designShares: "designShares",
  },
}));

import action from "./insert-figma-library-asset.js";

function setFile(
  content: string,
  overrides: Partial<{
    id: string;
    designId: string;
    filename: string;
    fileType: string;
  }> = {},
) {
  mocks.setRows([
    {
      id: overrides.id ?? "file-1",
      designId: overrides.designId ?? "design-1",
      filename: overrides.filename ?? "index.html",
      fileType: overrides.fileType ?? "html",
      content,
    },
  ]);
}

function lastSavedContent(): string {
  const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as
    | string
    | undefined;
  expect(content).toBeDefined();
  return content as string;
}

describe("insert-figma-library-asset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.updateChain.where.mockResolvedValue({ rowsAffected: 1 });
  });

  it("inserts a rendered Figma component with provenance data attributes", async () => {
    setFile("<html><body></body></html>");

    const result = await action.run({
      renderUrl: "https://figma-renders.example.com/asset.png",
      fileKey: "abc123",
      nodeId: "1:23",
      componentKey: "comp-key",
      kind: "component",
      name: "Primary Button",
      designId: "design-1",
      fileId: "file-1",
    });

    expect(result.inserted).toBe(true);
    expect(result.source).toBe("figma");
    const content = lastSavedContent();
    expect(content).toContain("data-agent-native-figma-asset");
    expect(content).toContain('data-figma-file-key="abc123"');
    expect(content).toContain('data-figma-node-id="1:23"');
    expect(content).toContain(
      'src="https://figma-renders.example.com/asset.png"',
    );
    expect(content).toContain("</body>");
  });

  it("reads the live collab text as the base instead of the stale SQL row", async () => {
    setFile("<html><body><p>stale sql content</p></body></html>");
    // Simulate a concurrent editor/agent write that already landed in collab
    // state ahead of this action's SQL row.
    mocks.seededCollabText.set(
      "file-1",
      "<html><body><p>live collab content</p></body></html>",
    );

    await action.run({
      renderUrl: "https://figma-renders.example.com/asset.png",
      fileKey: "abc123",
      kind: "component",
      designId: "design-1",
      fileId: "file-1",
    });

    const content = lastSavedContent();
    expect(content).toContain("live collab content");
    expect(content).not.toContain("stale sql content");
  });

  it("persists the same content both to SQL and to the collab doc (no lost update)", async () => {
    setFile("<html><body></body></html>");

    await action.run({
      renderUrl: "https://figma-renders.example.com/asset.png",
      fileKey: "abc123",
      kind: "component_set",
      designId: "design-1",
      fileId: "file-1",
    });

    const sqlContent = lastSavedContent();
    const collabContent = mocks.seededCollabText.get("file-1");
    expect(collabContent).toBe(sqlContent);
  });

  it("falls back to appending at end of document when neither </main> nor </body> exist", async () => {
    setFile("<div>no closing body tag</div>");

    const result = await action.run({
      renderUrl: "https://figma-renders.example.com/asset.png",
      fileKey: "abc123",
      kind: "component",
      designId: "design-1",
      fileId: "file-1",
    });

    expect(result.inserted).toBe(true);
    const content = lastSavedContent();
    expect(content).toContain("data-agent-native-figma-asset");
  });
});
