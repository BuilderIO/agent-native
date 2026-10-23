import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  listProperties: vi.fn(),
  resolveAccess: vi.fn(),
  resolveDatabase: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => {
    throw new Error("Database access is forbidden in word-count tests");
  },
}));
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

function additional(value: string) {
  return {
    definition: {
      id: "notes",
      name: "Notes",
      type: "blocks",
      visibility: "always_show",
      options: { blocks: { primary: false } },
    },
    value,
  };
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
    mocks.flush.mockResolvedValue({ status: "no_open_editor" });
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
  it("counts the captured exact additional field rather than a later field or primary body", async () => {
    mocks.listProperties.mockResolvedValue([
      primary("wrong primary body"),
      additional("later extra words must not replace capture"),
    ]);
    mocks.flush.mockResolvedValue({
      status: "flushed",
      editors: [],
      snapshot: {
        kind: "property",
        propertyId: "notes",
        content: "Captured field",
        title: "Page",
        updatedAt: "2026-10-19T12:00:00Z",
        contentHash: "hash",
      },
    });
    expect(
      await getBlocksFieldWordCount.run({
        documentId: "doc-1",
        propertyId: "notes",
      }),
    ).toMatchObject({ propertyId: "notes", primary: false, wordCount: 2 });
    expect(mocks.flush).toHaveBeenCalledWith({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
      propertyId: "notes",
    });
  });

  it("keeps the captured body for the same authorized primary property", async () => {
    mocks.listProperties.mockResolvedValue([primary("later primary body")]);
    mocks.flush.mockResolvedValue({
      status: "flushed",
      editors: [],
      snapshot: { kind: "document", content: "captured primary" },
    });
    expect(
      await getBlocksFieldWordCount.run({ documentId: "doc-1" }),
    ).toMatchObject({ propertyId: null, primary: true, wordCount: 2 });
  });

  it("keeps the confirmed standalone body when a later fresh read has different text", async () => {
    mocks.listProperties.mockResolvedValue([]);
    mocks.resolveDatabase.mockResolvedValue(null);
    mocks.flush.mockImplementation(async () => {
      mocks.resolveAccess.mockResolvedValue({
        resource: {
          id: "doc-1",
          content: "later primary body has more unconfirmed words",
          trashedAt: null,
        },
      });
      return {
        status: "flushed",
        editors: [],
        snapshot: { kind: "document", content: "confirmed standalone body" },
      };
    });
    expect(
      await getBlocksFieldWordCount.run({ documentId: "doc-1" }),
    ).toMatchObject({ propertyId: null, primary: true, wordCount: 3 });
  });

  it.each(["removed", "hidden", "access-revoked", "database-changed"])(
    "preserves main's refusal when the captured additional field is %s during flush",
    async (change) => {
      mocks.listProperties.mockResolvedValue([
        primary("primary must not substitute for notes"),
        additional("captured notes"),
      ]);
      mocks.flush.mockImplementation(async () => {
        if (change === "access-revoked")
          mocks.resolveAccess.mockResolvedValue(null);
        else if (change === "hidden")
          mocks.listProperties.mockResolvedValue([
            {
              ...additional("captured notes"),
              definition: {
                ...additional("").definition,
                visibility: "always_hide",
              },
            },
          ]);
        else {
          mocks.listProperties.mockResolvedValue([]);
          if (change === "database-changed")
            mocks.resolveDatabase.mockResolvedValue(null);
        }
        return {
          status: "flushed",
          editors: [],
          snapshot: {
            kind: "property",
            propertyId: "notes",
            content: "captured notes",
          },
        };
      });
      await expect(
        getBlocksFieldWordCount.run({
          documentId: "doc-1",
          propertyId: "notes",
        }),
      ).rejects.toThrow(
        change === "access-revoked"
          ? /Document .*not found/
          : /Blocks field .*not found/,
      );
    },
  );

  it("uses main's freshly read primary fallback when the collection field disappears during flush", async () => {
    mocks.listProperties.mockResolvedValue([primary("captured primary")]);
    mocks.flush.mockImplementation(async () => {
      mocks.listProperties.mockResolvedValue([]);
      mocks.resolveDatabase.mockResolvedValue(null);
      mocks.resolveAccess.mockResolvedValue({
        resource: {
          id: "doc-1",
          content: "fresh standalone primary body",
          trashedAt: null,
        },
      });
      return {
        status: "flushed",
        editors: [],
        snapshot: { kind: "document", content: "captured primary" },
      };
    });
    expect(
      await getBlocksFieldWordCount.run({ documentId: "doc-1" }),
    ).toMatchObject({
      propertyId: null,
      primary: true,
      wordCount: 4,
    });
  });

  it("uses the fresh authorized primary when the collection replaces its primary property", async () => {
    mocks.listProperties.mockResolvedValue([primary("captured primary")]);
    mocks.flush.mockImplementation(async () => {
      const next = primary("fresh replacement primary");
      next.definition.id = "replacement";
      mocks.listProperties.mockResolvedValue([next]);
      mocks.resolveAccess.mockResolvedValue({
        resource: {
          id: "doc-1",
          content: "fresh replacement primary",
          trashedAt: null,
        },
      });
      return {
        status: "flushed",
        editors: [],
        snapshot: { kind: "document", content: "captured primary" },
      };
    });
    expect(
      await getBlocksFieldWordCount.run({ documentId: "doc-1" }),
    ).toMatchObject({
      propertyId: null,
      primary: true,
      wordCount: 3,
    });
  });
});
