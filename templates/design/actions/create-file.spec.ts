/**
 * Tests for create-file.
 *
 * Coverage focus: create-file now stamps missing
 * data-agent-native-node-id attributes on HTML content before persisting
 * (shared/screen-annotation.ts), so a screen created directly via this
 * action — not only through generate-design — is fully addressable by
 * id-keyed editor operations from the moment it's created, instead of
 * depending on a client-side backfill the first time someone opens it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let existingRows: Array<Record<string, unknown>> = [];

  const selectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.limit.mockImplementation(() => Promise.resolve(existingRows));

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateChain = { set: vi.fn(), where: vi.fn() };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);
  const update = vi.fn(() => updateChain);

  const db = { select: vi.fn(() => selectChain), insert, update };

  return {
    db,
    insert,
    insertValues,
    updateChain,
    setExistingRows: (rows: Array<Record<string, unknown>>) => {
      existingRows = rows;
    },
    assertAccess: vi.fn().mockResolvedValue(undefined),
    seedFromText: vi.fn().mockResolvedValue(undefined),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/collab", () => ({
  seedFromText: mocks.seedFromText,
}));

vi.mock("drizzle-orm", () => ({
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
    },
    designs: { id: "designs.id" },
  },
}));

import action from "./create-file.js";

describe("create-file: node-id annotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setExistingRows([]);
    mocks.assertAccess.mockResolvedValue(undefined);
  });

  it("stamps missing data-agent-native-node-id attributes on new HTML content", async () => {
    await action.run({
      designId: "design-1",
      filename: "index.html",
      content: "<main><button>Buy</button></main>",
      fileType: "html",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toContain("data-agent-native-node-id");
    expect(insertedValues.content).toContain("<main");
    expect(insertedValues.content).toContain("<button");

    // Collab state must be seeded with the SAME annotated content, not the
    // raw pre-annotation string, so the first live edit doesn't fork from a
    // different base than what's in SQL.
    expect(mocks.seedFromText).toHaveBeenCalledWith(
      expect.any(String),
      insertedValues.content,
    );
  });

  it("is idempotent: does not double-stamp elements that already have a clean id", async () => {
    const alreadyAnnotated =
      '<main data-agent-native-node-id="an-existing"><button>Buy</button></main>';

    await action.run({
      designId: "design-1",
      filename: "index.html",
      content: alreadyAnnotated,
      fileType: "html",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    // The existing clean id on <main> is preserved verbatim.
    expect(insertedValues.content).toContain(
      'data-agent-native-node-id="an-existing"',
    );
    // Only one node-id attribute is added (for <button>), not a duplicate on
    // <main>.
    expect(
      insertedValues.content.match(/data-agent-native-node-id="an-existing"/g),
    ).toHaveLength(1);
  });

  it("does not annotate non-HTML file types", async () => {
    const cssContent = ".btn { color: red; }";

    await action.run({
      designId: "design-1",
      filename: "styles.css",
      content: cssContent,
      fileType: "css",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toBe(cssContent);
  });

  it("skips head/script/style/template content when annotating a full document", async () => {
    const fullDoc =
      "<!doctype html><html><head><style>.x{color:red}</style>" +
      "<script>const a = 1;</script></head><body><main><section>Hi</section></main></body></html>";

    await action.run({
      designId: "design-1",
      filename: "index.html",
      content: fullDoc,
      fileType: "html",
    });

    const insertedValues = mocks.insertValues.mock.calls[0]![0] as {
      content: string;
    };
    expect(insertedValues.content).toContain(
      "<section data-agent-native-node-id=",
    );
    expect(
      insertedValues.content.match(/<style>[\s\S]*?<\/style>/)?.[0],
    ).not.toContain("data-agent-native-node-id");
    expect(
      insertedValues.content.match(/<script>[\s\S]*?<\/script>/)?.[0],
    ).not.toContain("data-agent-native-node-id");
  });
});
