/**
 * Tests for insert-asset action.
 *
 * Security regression: a valid http(s) asset URL containing a single quote
 * must not be able to break out of the single-quoted CSS `url('...')` value
 * used by "background-fill" mode. Percent-encoding the quote (and backslash)
 * before HTML-escaping keeps the URL functionally identical while making a
 * breakout impossible, regardless of whether the surrounding HTML `style`
 * attribute is single- or double-quoted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // `where()` must behave both as a directly-awaited result (the initial
  // multi-file lookup in insert-asset.ts) AND as a chain that supports a
  // trailing `.limit(1)` (writeInlineSourceFile's internal re-select in
  // server/source-workspace.ts, now used by the action's write path).
  // Returning a real Promise with an extra `.limit()` method attached covers
  // both call shapes with the same mocked resolved rows, narrowed by id when
  // the predicate looks like `eq(designFiles.id, someId)`.
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
  // actually store what getText reads back. Cleared per-test in beforeEach.
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

import action from "./insert-asset.js";

// A URL containing a single quote — invalid to break out of `url('...')`,
// but syntactically a valid http(s) URL (quote in a path segment).
const MALICIOUS_URL =
  "https://evil.example.com/a'));</style><script>alert(1)</script><style x='.png";

function setFile(content: string) {
  mocks.setRows([
    {
      id: "file-1",
      designId: "design-1",
      filename: "index.html",
      fileType: "html",
      content,
    },
  ]);
}

describe("insert-asset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seededCollabText.clear();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.updateChain.where.mockResolvedValue({ rowsAffected: 1 });
  });

  it("background-fill: escapes single quotes so the URL cannot break out of url('...')", async () => {
    setFile(
      '<html><body><section data-agent-native-node-id="hero"></section></body></html>',
    );

    await action.run({
      assetUrl: MALICIOUS_URL,
      mode: "background-fill",
      targetNodeId: "hero",
      designId: "design-1",
      fileId: "file-1",
    });

    const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as string;
    expect(content).toBeDefined();
    // The raw single quote must never appear un-escaped inside the style value.
    expect(content).not.toContain("'));</style>");
    expect(content).not.toContain("<script>alert(1)</script>");
    expect(content).toContain("%27");
    expect(content).toMatch(/style="background-image: url\('[^']*'\)/);
  });

  it("background-fill: stays safe when the existing style attribute is single-quoted", async () => {
    setFile(
      "<html><body><section data-agent-native-node-id='hero' style='color: red;'></section></body></html>",
    );

    await action.run({
      assetUrl: MALICIOUS_URL,
      mode: "background-fill",
      targetNodeId: "hero",
      designId: "design-1",
      fileId: "file-1",
    });

    const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as string;
    expect(content).not.toContain("'));</style>");
    expect(content).not.toContain("<script>alert(1)</script>");
    expect(content).toContain("color: red");
  });

  it("figure mode: inserts a safe figure/section with the asset URL", async () => {
    setFile("<html><body></body></html>");

    const result = await action.run({
      assetUrl: "https://example.com/image.png",
      mode: "figure",
      designId: "design-1",
      fileId: "file-1",
    });

    expect(result.inserted).toBe(true);
    const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as string;
    expect(content).toContain('src="https://example.com/image.png"');
    expect(content).toContain("data-agent-native-asset");
  });

  it("replace-src mode: sets the src attribute on the targeted element", async () => {
    setFile(
      '<html><body><img data-agent-native-node-id="hero-img" src="old.png" /></body></html>',
    );

    const result = await action.run({
      assetUrl: "https://example.com/new.png",
      mode: "replace-src",
      targetNodeId: "hero-img",
      designId: "design-1",
      fileId: "file-1",
    });

    expect(result.inserted).toBe(true);
    const content = mocks.updateChain.set.mock.calls[0]?.[0]?.content as string;
    expect(content).toContain('src="https://example.com/new.png"');
  });
});
