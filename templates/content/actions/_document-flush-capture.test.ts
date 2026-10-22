import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ select: vi.fn(), rows: [] as unknown[][] }));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: db.select }),
  schema: {
    documents: {
      id: "doc-id",
      bodyRevision: "revision",
      content: "primary-body",
      title: "title",
      updatedAt: "updated-at",
    },
    documentBlockFieldContents: {
      documentId: "field-doc-id",
      propertyId: "property-id",
      content: "property-body",
    },
  },
}));
vi.mock("../server/lib/document-revision.js", async (original) => {
  const actual =
    await original<typeof import("../server/lib/document-revision.js")>();
  return { ...actual, documentContentHash: vi.fn(actual.documentContentHash) };
});
import { documentContentHash } from "../server/lib/document-revision.js";
import { createDocumentFlushCapture } from "./_document-save-row.js";

const row = {
  bodyRevision: 4,
  content: "Body",
  title: "Title",
  updatedAt: "2026-10-19T12:00:00Z",
};
const metadata = ({ content: _, ...rest } = row) => rest;

describe("document flush capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.rows = [];
    db.select.mockImplementation(() => {
      const query = {
        from: () => query,
        where: () => query,
        leftJoin: () => query,
        limit: async () => db.rows.shift()!,
      };
      return query;
    });
  });
  it("loads and hashes one body per encountered revision while refreshing title and updatedAt", async () => {
    db.rows.push(
      [metadata()],
      [row],
      [{ ...metadata(), title: "Renamed", updatedAt: "2026-10-19T12:01:00Z" }],
      [metadata()],
    );
    const capture = createDocumentFlushCapture();
    const first = await capture("doc");
    expect(await capture("doc")).toEqual({
      ...first,
      title: "Renamed",
      updatedAt: "2026-10-19T12:01:00Z",
    });
    expect(await capture("doc")).toEqual(first);
    expect(
      db.select.mock.calls.filter(
        ([fields]) => fields.content === "primary-body",
      ),
    ).toHaveLength(1);
    expect(documentContentHash).toHaveBeenCalledTimes(1);
  });
  it("uses the body and revision from the same read when metadata changes across awaits", async () => {
    db.rows.push(
      [metadata()],
      [{ ...row, bodyRevision: 5, content: "Next body" }],
      [{ ...metadata(), bodyRevision: 5 }],
    );
    const capture = createDocumentFlushCapture();
    expect(await capture("doc")).toMatchObject({
      bodyRevision: 5,
      content: "Next body",
    });
    expect(await capture("doc")).toMatchObject({
      bodyRevision: 5,
      content: "Next body",
    });
    expect(documentContentHash).toHaveBeenCalledTimes(1);
  });
  it("hashes each new revision once within the request", async () => {
    db.rows.push(
      [metadata()],
      [row],
      [{ ...metadata(), bodyRevision: 5 }],
      [{ ...row, bodyRevision: 5, content: "Next" }],
    );
    const capture = createDocumentFlushCapture();
    await capture("doc");
    await capture("doc");
    expect(documentContentHash).toHaveBeenCalledTimes(2);
  });
  it("captures and hashes the exact property value without selecting the primary body", async () => {
    db.rows.push([
      { title: "Title", updatedAt: row.updatedAt, content: "Additional field" },
    ]);
    expect(await createDocumentFlushCapture()("doc", "notes")).toMatchObject({
      content: "Additional field",
      propertyId: "notes",
    });
    expect(db.select.mock.calls[0]![0].content).toBe("property-body");
    expect(documentContentHash).toHaveBeenCalledWith("Additional field");
  });
});
