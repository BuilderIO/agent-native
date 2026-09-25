import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  listProperties: vi.fn(),
  resolveAccess: vi.fn(),
  resolveDatabase: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({}));
vi.mock("./_database-utils.js", () => ({
  isSoftDeletedDatabaseDocument: vi.fn(async () => false),
}));
vi.mock("./_document-access.js", () => ({
  resolveDocumentAccess: mocks.resolveAccess,
}));
vi.mock("./_document-flush.js", () => ({
  flushOpenDocumentEditorToSql: mocks.flush,
}));
vi.mock("./_property-utils.js", () => ({
  listPropertiesForAllDocumentDatabases: mocks.listProperties,
  resolvePropertyDatabaseForDocument: mocks.resolveDatabase,
}));

import getBlocksFieldWordCount from "./get-blocks-field-word-count";

function primary(value: string) {
  return {
    definition: {
      id: "primary",
      name: "Content",
      type: "blocks",
      visibility: "hide_when_empty",
      options: { blocks: { primary: true } },
    },
    value,
  } as any;
}

describe("get-blocks-field-word-count action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue({
      resource: {
        id: "doc-1",
        content: "standalone fallback must not leak",
        ownerEmail: "owner@example.com",
        trashedAt: null,
      },
    });
    mocks.resolveDatabase.mockResolvedValue({ id: "database-1" });
    mocks.flush.mockResolvedValue(undefined);
  });

  it("fails closed when a database primary field becomes hidden during flush", async () => {
    mocks.listProperties
      .mockResolvedValueOnce([primary("visible before flush")])
      .mockResolvedValueOnce([primary("")]);

    await expect(
      getBlocksFieldWordCount.run({ documentId: "doc-1" }),
    ).rejects.toThrow(/no visible primary Content field/i);
    expect(mocks.flush).toHaveBeenCalledWith({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
  });
});
