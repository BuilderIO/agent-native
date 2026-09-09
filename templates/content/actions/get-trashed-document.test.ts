import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), getDb: vi.fn() }));
vi.mock("./_document-access.js", () => ({
  resolveDocumentAccess: mocks.access,
}));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: mocks.getDb,
}));

import { schema } from "../server/db/index.js";
import { readTrashedDocument } from "./get-trashed-document";

const document = {
  id: "page",
  title: "Deleted page",
  content: "Stored body",
  description: "",
  ownerEmail: "owner@example.com",
  trashRootId: "page",
  trashedAt: "2026-09-09T00:00:00Z",
};

function readOnlyDb(rows: Map<unknown, unknown[]>) {
  const tables: unknown[] = [];
  mocks.getDb.mockReturnValue({
    select: () => ({
      from: (table: unknown) => {
        tables.push(table);
        const query = {
          where: () => query,
          orderBy: () => query,
          limit: () => query,
          then: (resolve: (value: unknown[]) => unknown) =>
            Promise.resolve(rows.get(table) ?? []).then(resolve),
        };
        return query;
      },
    }),
  });
  return tables;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockImplementation(async (id: string) =>
    id === "page" ? { role: "viewer", resource: document } : null,
  );
});

describe("read trashed document", () => {
  it.each([
    {
      role: "viewer",
      hostRole: null,
      blockOwned: false,
      expected: [false, false],
    },
    {
      role: "editor",
      hostRole: null,
      blockOwned: false,
      expected: [false, false],
    },
    {
      role: "admin",
      hostRole: null,
      blockOwned: false,
      expected: [true, true],
    },
    {
      role: "viewer",
      hostRole: "editor",
      blockOwned: true,
      expected: [true, false],
    },
    {
      role: "owner",
      hostRole: "viewer",
      blockOwned: true,
      expected: [false, false],
    },
    {
      role: "owner",
      hostRole: "owner",
      blockOwned: true,
      expected: [true, false],
    },
  ])(
    "reports operation-specific recovery authority: $role / $hostRole / $blockOwned",
    async ({ role, hostRole, blockOwned, expected }) => {
      mocks.access.mockImplementation(async (id: string) =>
        id === "page"
          ? {
              role,
              resource: { ...document, parentId: blockOwned ? "host" : null },
            }
          : id === "host" && hostRole
            ? { role: hostRole, resource: { id: "host" } }
            : null,
      );
      readOnlyDb(
        new Map([
          [
            schema.contentDatabases,
            [{ id: "db", documentId: "page", ownerDocumentId: "host" }],
          ],
        ]),
      );
      const result = await readTrashedDocument({ documentId: "page" });
      expect([result.canRestore, result.canPermanentlyDelete]).toEqual(
        expected,
      );
    },
  );

  it("exposes exact-ID restore for an authorized legacy database without Page trash markers", async () => {
    mocks.access.mockResolvedValue({
      role: "owner",
      resource: { ...document, trashedAt: null, trashRootId: null },
    });
    readOnlyDb(
      new Map([
        [
          schema.contentDatabases,
          [{ id: "db", documentId: "page", deletedAt: document.trashedAt }],
        ],
      ]),
    );
    const result = await readTrashedDocument({ documentId: "page" });
    expect(result.content).toBe(document.content);
    expect(result.canRestore).toBe(true);
    expect(result.legacyRestoreDatabaseId).toBe("db");
    expect(result.canPermanentlyDelete).toBe(false);
  });

  it.each([
    { role: "viewer", trashedAt: null },
    { role: "owner", trashedAt: document.trashedAt },
  ])(
    "does not advertise legacy restore for denied or inconsistent Page state: $role / $trashedAt",
    async ({ role, trashedAt }) => {
      mocks.access.mockResolvedValue({
        role,
        resource: { ...document, trashedAt, trashRootId: null },
      });
      readOnlyDb(
        new Map([
          [
            schema.contentDatabases,
            [{ id: "db", documentId: "page", deletedAt: document.trashedAt }],
          ],
        ]),
      );
      const result = await readTrashedDocument({ documentId: "page" });
      expect(result.canRestore).toBe(false);
      expect(result.legacyRestoreDatabaseId).toBeNull();
      expect(result.canPermanentlyDelete).toBe(false);
    },
  );
  it("rejects an unreadable comment cursor rather than returning the first page", async () => {
    await expect(
      readTrashedDocument({ documentId: "page", commentsCursor: "invalid" }),
    ).rejects.toMatchObject({ errorCode: "invalid_cursor" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("filters relationship endpoints and does not expose computed or definition configuration", async () => {
    const db = {
      id: "db",
      documentId: "page",
      title: "Database",
      deletedAt: document.trashedAt,
    };
    const values = [
      { propertyId: "relation", valueJson: '["page","private"]' },
      { propertyId: "formula", valueJson: '"cached private result"' },
    ];
    readOnlyDb(
      new Map<unknown, unknown[]>([
        [schema.contentDatabases, [db]],
        [
          schema.documentPropertyDefinitions,
          [
            {
              id: "relation",
              name: "Related",
              type: "relation",
              optionsJson: '{"privateDatabaseId":"secret"}',
            },
            { id: "formula", name: "Computed", type: "formula" },
          ],
        ],
        [schema.documentPropertyValues, values],
      ]),
    );
    const result = await readTrashedDocument({ documentId: "page" });
    expect(result.properties).toEqual([
      {
        id: "relation",
        name: "Related",
        type: "relation",
        value: ["page"],
        available: true,
      },
      {
        id: "formula",
        name: "Computed",
        type: "formula",
        value: null,
        available: false,
      },
    ]);
    expect(values[0].valueJson).toBe('["page","private"]');
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("cached private result");
  });

  it("denies an inaccessible ID before querying nested data", async () => {
    await expect(
      readTrashedDocument({ documentId: "private" }),
    ).rejects.toMatchObject({ errorCode: "not_found" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects live pages instead of becoming a generic deleted-read bypass", async () => {
    mocks.access.mockResolvedValue({
      role: "owner",
      resource: { ...document, trashedAt: null },
    });
    const tables = readOnlyDb(new Map());
    await expect(
      readTrashedDocument({ documentId: "page" }),
    ).rejects.toMatchObject({ errorCode: "not_found" });
    expect(tables).toEqual([schema.contentDatabases]);
  });

  it("requires database access even when the requester owns the Page", async () => {
    mocks.access.mockImplementation(async (id: string) =>
      id === "page" ? { role: "owner", resource: document } : null,
    );
    const tables = readOnlyDb(
      new Map([
        [
          schema.contentDatabases,
          [{ id: "db", documentId: "private-container" }],
        ],
      ]),
    );
    await expect(
      readTrashedDocument({ documentId: "page", databaseId: "db" }),
    ).rejects.toMatchObject({ errorCode: "not_found" });
    expect(tables).not.toContain(schema.documentPropertyDefinitions);
    expect(tables).not.toContain(schema.documentComments);
  });

  it("reads a viewer's stored body using a database with no mutation methods", async () => {
    const tables = readOnlyDb(
      new Map([
        [
          schema.documentComments,
          Array.from({ length: 101 }, (_, id) => ({
            id: String(id),
            content: "Comment",
            createdAt: "2026-09-09T00:00:00Z",
          })),
        ],
        [
          schema.documentVersions,
          Array.from({ length: 21 }, (_, id) => ({
            id: String(id),
            content: "Version",
          })),
        ],
      ]),
    );
    const result = await readTrashedDocument({ documentId: "page" });
    expect(result.content).toBe("Stored body");
    expect(result.accessRole).toBe("viewer");
    expect(result.comments).toHaveLength(100);
    expect(result).not.toHaveProperty("versions");
    expect(result.hasMoreComments).toBe(true);
    expect(
      JSON.parse(
        Buffer.from(result.nextCommentsCursor!, "base64url").toString("utf8"),
      ),
    ).toEqual({ createdAt: "2026-09-09T00:00:00Z", id: "99" });
    expect(tables).toEqual([schema.contentDatabases, schema.documentComments]);
  });
});
