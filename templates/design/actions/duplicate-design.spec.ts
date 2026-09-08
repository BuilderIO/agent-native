/**
 * Tests for duplicate-design.
 *
 * Coverage focus: duplicated designs/files always get fresh DB-level ids
 * (design id + designFiles.id), and duplicated HTML content gets any MISSING
 * data-agent-native-node-id attributes filled in (shared/screen-annotation.ts)
 * without disturbing ids the source screen already had. Existing
 * data-agent-native-node-id values are intentionally copied verbatim rather
 * than regenerated — see the long comment in duplicate-design.ts for why
 * (node ids are file-scoped, never looked up across designs, and
 * regenerating them would require rewriting motion/interaction-state CSS
 * selectors embedded in the same HTML in lockstep).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let sourceDesign: Record<string, unknown> | null = null;
  let sourceFiles: Array<Record<string, unknown>> = [];

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: insertValues }));

  const fileSelectChain = { from: vi.fn(), where: vi.fn() };
  fileSelectChain.from.mockReturnValue(fileSelectChain);
  fileSelectChain.where.mockImplementation(() => Promise.resolve(sourceFiles));

  const db = {
    select: vi.fn(() => fileSelectChain),
    insert,
    // The action runs both inserts inside one db.transaction(); the mock
    // hands the same insert-tracking db to the callback as `tx` so existing
    // insertValues assertions keep working unchanged.
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
      await callback(db);
    }),
  };

  return {
    db,
    insert,
    insertValues,
    setSourceDesign: (design: Record<string, unknown> | null) => {
      sourceDesign = design;
    },
    setSourceFiles: (files: Array<Record<string, unknown>>) => {
      sourceFiles = files;
    },
    getSourceDesign: () => sourceDesign,
    resolveAccess: vi.fn(),
    getRequestUserEmail: vi.fn(() => "user@example.com"),
    getRequestOrgId: vi.fn(() => null),
    eq: vi.fn((left, right) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  getRequestOrgId: mocks.getRequestOrgId,
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFiles: { designId: "designFiles.designId" },
    designs: {},
  },
}));

import action from "./duplicate-design.js";

function setSource(
  design: { id: string; title: string; data?: unknown },
  files: Array<{
    id: string;
    filename: string;
    fileType: string;
    content: string;
  }>,
) {
  mocks.resolveAccess.mockResolvedValue({
    resource: {
      id: design.id,
      title: design.title,
      description: null,
      projectType: "prototype",
      designSystemId: null,
      data: design.data ?? "{}",
    },
  });
  mocks.setSourceFiles(
    files.map((f) => ({
      id: f.id,
      designId: design.id,
      filename: f.filename,
      fileType: f.fileType,
      content: f.content,
    })),
  );
}

describe("duplicate-design: fresh ids + node-id annotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
  });

  it("assigns a fresh design id and fresh per-file ids, distinct from the source", async () => {
    setSource({ id: "design-src", title: "Original" }, [
      {
        id: "file-src-1",
        filename: "index.html",
        fileType: "html",
        content: "<main><button>Buy</button></main>",
      },
    ]);

    const result = await action.run({ id: "design-src" });

    expect(result.id).not.toBe("design-src");
    expect(result.title).toBe("Copy of Original");

    const designInsert = mocks.insertValues.mock.calls[0]![0] as {
      id: string;
    };
    // File inserts are now batched: `.values()` receives an array of rows in
    // one call rather than one call per file.
    const fileInsert = (
      mocks.insertValues.mock.calls[1]![0] as Array<{
        id: string;
        designId: string;
      }>
    )[0]!;
    expect(designInsert.id).toBe(result.id);
    expect(designInsert.id).not.toBe("design-src");
    expect(fileInsert.id).not.toBe("file-src-1");
    expect(fileInsert.designId).toBe(result.id);
  });

  it("fills in missing node ids on the duplicated copy without disturbing existing ones", async () => {
    setSource({ id: "design-src", title: "Original" }, [
      {
        id: "file-src-1",
        filename: "index.html",
        fileType: "html",
        content:
          '<main data-agent-native-node-id="an-kept"><button>Buy</button></main>',
      },
    ]);

    await action.run({ id: "design-src" });

    const fileInsert = (
      mocks.insertValues.mock.calls[1]![0] as Array<{ content: string }>
    )[0]!;
    // Existing id on <main> is preserved verbatim (not regenerated).
    expect(fileInsert.content).toContain('data-agent-native-node-id="an-kept"');
    // The <button>, which had no id in the source, gets one filled in on the
    // copy.
    expect(fileInsert.content).toMatch(
      /<button data-agent-native-node-id="[^"]+">Buy<\/button>/,
    );
  });

  it("copying two designs from the same source never collides on designFiles.id", async () => {
    setSource({ id: "design-src", title: "Original" }, [
      {
        id: "file-src-1",
        filename: "index.html",
        fileType: "html",
        content: "<main>Hi</main>",
      },
    ]);

    const first = await action.run({ id: "design-src" });
    const secondInsertCallsBefore = mocks.insertValues.mock.calls.length;
    const second = await action.run({ id: "design-src" });

    expect(first.id).not.toBe(second.id);
    const firstFileId = (
      mocks.insertValues.mock.calls[1]![0] as Array<{ id: string }>
    )[0]!.id;
    const secondFileId = (
      mocks.insertValues.mock.calls[secondInsertCallsBefore + 1]![0] as Array<{
        id: string;
      }>
    )[0]!.id;
    expect(firstFileId).not.toBe(secondFileId);
  });
});
