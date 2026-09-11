/**
 * Tests for insert-design-native-asset.
 *
 * Coverage focus: the positioned-insertion follow-up (optional x/y/screenId
 * on the action schema, previously silently ignored — see the panel-side
 * NOTE this test file's sibling app code used to carry in
 * DesignExtensionsPanel.tsx). A usable {x, y} must wrap the inserted snippet
 * in an absolutely-positioned container at that exact point; an
 * omitted/unusable position must fall back to the exact append-before-
 * closing-tag behavior this action always had, byte-for-byte unchanged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // `where()` must behave both as a directly-awaited result (the initial
  // multi-file lookup in insert-design-native-asset.ts) AND as a chain that
  // supports a trailing `.limit(1)` (writeInlineSourceFile's internal
  // re-select in server/source-workspace.ts, now used by the action's write
  // path). Returning a real Promise with an extra `.limit()` method attached
  // covers both call shapes with the same mocked resolved value.
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  }

  // Backing rows for the configured design's files. The initial multi-file
  // lookup in insert-design-native-asset.ts filters by designId only (the
  // fake accessFilter/and don't narrow further); writeInlineSourceFile's
  // internal re-select filters by a single file id (`eq(designFiles.id,
  // file.id)`), which this fake `where` recognizes by shape and narrows to,
  // so a multi-file design (e.g. the screenId-wins test) resolves to the
  // SAME row the action targeted, not just the first row in the table.
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
        const match = rows.filter((row) => row.id === predicate.right);
        return makeWhereResult(match);
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
    makeWhereResult,
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

import action from "./insert-design-native-asset.js";

function setFiles(rows: Array<Record<string, unknown>>) {
  mocks.setRows(rows);
}

function setFile(
  content: string,
  overrides: Partial<{
    id: string;
    designId: string;
    filename: string;
    fileType: string;
  }> = {},
) {
  setFiles([
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

describe("insert-design-native-asset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.updateChain.where.mockResolvedValue({ rowsAffected: 1 });
  });

  it("without a position: appends before </body>, exactly as before x/y existed", async () => {
    setFile("<html><body></body></html>");

    const result = await action.run({
      kind: "text-block",
      designId: "design-1",
      fileId: "file-1",
    });

    expect(result.inserted).toBe(true);
    expect(result.positioned).toBe(false);
    const content = lastSavedContent();
    expect(content).not.toContain("data-agent-native-positioned-wrapper");
    expect(content).toContain("</body>");
    expect(content.indexOf("data-agent-native-node-id")).toBeLessThan(
      content.indexOf("</body>"),
    );
  });

  it("with a usable {x, y}: wraps the snippet in an absolutely-positioned container at that point", async () => {
    setFile("<html><body></body></html>");

    const result = await action.run({
      kind: "button",
      designId: "design-1",
      fileId: "file-1",
      x: 120.4,
      y: 340.6,
    });

    expect(result.inserted).toBe(true);
    expect(result.positioned).toBe(true);
    const content = lastSavedContent();
    expect(content).toContain("data-agent-native-positioned-wrapper");
    expect(content).toMatch(/style="position:absolute;left:120px;top:341px;"/);
  });

  it("prefers </main> over </body> when both exist, with a position applied", async () => {
    setFile("<html><body><main></main></body></html>");

    await action.run({
      kind: "card",
      designId: "design-1",
      fileId: "file-1",
      x: 10,
      y: 20,
    });

    const content = lastSavedContent();
    const mainCloseIndex = content.indexOf("</main>");
    const wrapperIndex = content.indexOf(
      "data-agent-native-positioned-wrapper",
    );
    expect(wrapperIndex).toBeGreaterThan(-1);
    expect(wrapperIndex).toBeLessThan(mainCloseIndex);
  });

  it("treats a negative coordinate as an unusable position and falls back to append", async () => {
    setFile("<html><body></body></html>");

    const result = await action.run({
      kind: "hero",
      designId: "design-1",
      fileId: "file-1",
      x: -5,
      y: 20,
    });

    expect(result.positioned).toBe(false);
    const content = lastSavedContent();
    expect(content).not.toContain("data-agent-native-positioned-wrapper");
  });

  it("treats a missing y as an unusable position (both x and y required together)", async () => {
    setFile("<html><body></body></html>");

    const result = await action.run({
      kind: "nav-bar",
      designId: "design-1",
      fileId: "file-1",
      x: 50,
    });

    expect(result.positioned).toBe(false);
    const content = lastSavedContent();
    expect(content).not.toContain("data-agent-native-positioned-wrapper");
  });

  it("screenId wins over fileId when both resolve to different HTML files in the design", async () => {
    setFiles([
      {
        id: "file-1",
        designId: "design-1",
        filename: "index.html",
        fileType: "html",
        content: "<html><body></body></html>",
      },
      {
        id: "screen-2",
        designId: "design-1",
        filename: "details.html",
        fileType: "html",
        content: "<html><body></body></html>",
      },
    ]);

    const result = await action.run({
      kind: "input",
      designId: "design-1",
      fileId: "file-1",
      screenId: "screen-2",
      x: 5,
      y: 5,
    });

    expect(result.fileId).toBe("screen-2");
  });

  it("falls back to fileId when screenId does not resolve to a file in this design", async () => {
    setFile("<html><body></body></html>");

    const result = await action.run({
      kind: "feature-grid",
      designId: "design-1",
      fileId: "file-1",
      screenId: "does-not-exist",
    });

    expect(result.fileId).toBe("file-1");
  });

  it("rounds fractional coordinates to whole pixels", async () => {
    setFile("<html><body></body></html>");

    await action.run({
      kind: "section-frame",
      designId: "design-1",
      fileId: "file-1",
      x: 99.49,
      y: 99.5,
    });

    const content = lastSavedContent();
    expect(content).toContain("left:99px;top:100px;");
  });
});
