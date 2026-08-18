import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-export-document-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let exportDocumentAction: typeof import("./export-document.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  exportDocumentAction = (await import("./export-document.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let nextPosition = 0;

async function createDocument(args: {
  id: string;
  title: string;
  content?: string;
  ownerEmail?: string;
  trashedAt?: string;
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      ownerEmail: args.ownerEmail ?? OWNER,
      parentId: null,
      title: args.title,
      content: args.content ?? "",
      position: nextPosition++,
      visibility: "private",
      trashedAt: args.trashedAt,
      createdAt: now,
      updatedAt: now,
    });
}

async function createDatabase(args: {
  id: string;
  documentId: string;
  title: string;
  viewType?: "table" | "list";
}) {
  await createDocument({
    id: args.documentId,
    title: args.title,
  });
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: args.id,
      ownerEmail: OWNER,
      documentId: args.documentId,
      title: args.title,
      viewConfigJson: JSON.stringify({
        activeViewId: "primary",
        views: [
          {
            id: "primary",
            name: args.viewType === "list" ? "List" : "Table",
            type: args.viewType ?? "table",
          },
        ],
      }),
    });
}

async function addDatabaseItem(args: {
  id: string;
  databaseId: string;
  documentId: string;
  position: number;
  bodyHydrationStatus?: "pending" | "hydrated";
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values({
      id: args.id,
      ownerEmail: OWNER,
      databaseId: args.databaseId,
      documentId: args.documentId,
      position: args.position,
      bodyHydrationStatus: args.bodyHydrationStatus ?? "hydrated",
      createdAt: now,
      updatedAt: now,
    });
}

async function shareDocumentWithOwner(documentId: string, id: string) {
  await getDb().insert(schema.documentShares).values({
    id,
    resourceId: documentId,
    principalType: "user",
    principalId: OWNER,
    role: "viewer",
    createdBy: "someone-else@example.com",
    createdAt: new Date().toISOString(),
  });
}

describe("export-document database collections", () => {
  it.each(["table", "list"] as const)(
    "exports immediate authorized members from a %s view in membership order for every format",
    async (viewType) => {
      const databaseId = `launch-library-${viewType}`;
      const databaseDocumentId = `launch-library-document-${viewType}`;
      const faqId = `faq-${viewType}`;
      const announcementId = `announcement-${viewType}`;
      const sharedRecordId = `shared-record-${viewType}`;
      const privateRecordId = `private-record-${viewType}`;

      await createDatabase({
        id: databaseId,
        documentId: databaseDocumentId,
        title: "Launch Library",
        viewType,
      });
      await createDocument({
        id: faqId,
        title: "FAQ",
        content: "Answers",
      });
      await createDocument({
        id: announcementId,
        title: "Announcement",
        content: "Launch copy",
      });
      await createDocument({
        id: sharedRecordId,
        title: "Shared record",
        content: "Shared body",
        ownerEmail: "someone-else@example.com",
      });
      await shareDocumentWithOwner(
        sharedRecordId,
        `shared-record-share-${viewType}`,
      );
      await createDocument({
        id: privateRecordId,
        title: "Private record",
        content: "Do not export",
        ownerEmail: "someone-else@example.com",
      });
      await addDatabaseItem({
        id: `faq-item-${viewType}`,
        databaseId,
        documentId: faqId,
        position: 2,
      });
      await addDatabaseItem({
        id: `announcement-item-${viewType}`,
        databaseId,
        documentId: announcementId,
        position: 1,
      });
      await addDatabaseItem({
        id: `shared-item-${viewType}`,
        databaseId,
        documentId: sharedRecordId,
        position: 3,
      });
      await addDatabaseItem({
        id: `private-item-${viewType}`,
        databaseId,
        documentId: privateRecordId,
        position: 0,
      });

      const [markdown, html, pdf] = await runWithRequestContext(
        { userEmail: OWNER },
        () =>
          Promise.all(
            (["markdown", "html", "pdf"] as const).map((format) =>
              exportDocumentAction.run({
                id: databaseDocumentId,
                format,
              }),
            ),
          ),
      );

      expect(markdown.content).toBe(
        "# Launch Library\n\n## Announcement\n\nLaunch copy\n\n## FAQ\n\nAnswers\n\n## Shared record\n\nShared body\n",
      );
      expect(markdown.content).not.toContain("Private record");
      for (const result of [html, pdf]) {
        expect(result.content).toContain("<h1>Launch Library</h1>");
        expect(result.content).toContain("<h2>Announcement</h2>");
        expect(result.content).toContain("<p>Launch copy</p>");
        expect(result.content).toContain("<h2>FAQ</h2>");
        expect(result.content).toContain("<p>Answers</p>");
        expect(result.content).toContain("<h2>Shared record</h2>");
        expect(result.content).toContain("<p>Shared body</p>");
        expect(result.content).not.toContain("Private record");
        expect(result.content.indexOf("<h2>Announcement</h2>")).toBeLessThan(
          result.content.indexOf("<h2>FAQ</h2>"),
        );
      }
    },
  );

  it("makes an empty database export explicit", async () => {
    await createDatabase({
      id: "empty-database",
      documentId: "empty-database-document",
      title: "Empty Database",
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: "empty-database-document",
        format: "markdown",
      }),
    );

    expect(result.content).toBe("# Empty Database\n\n_No accessible items._\n");
  });

  it("treats a database with only trashed members as having no accessible items", async () => {
    await createDatabase({
      id: "trashed-database",
      documentId: "trashed-database-document",
      title: "Trashed Database",
    });
    await createDocument({
      id: "trashed-page",
      title: "Trashed Page",
      content: "Do not export",
      trashedAt: new Date().toISOString(),
    });
    await addDatabaseItem({
      id: "trashed-item",
      databaseId: "trashed-database",
      documentId: "trashed-page",
      position: 0,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: "trashed-database-document",
        format: "markdown",
      }),
    );

    expect(result.content).toBe(
      "# Trashed Database\n\n_No accessible items._\n",
    );
  });

  it("fails instead of silently omitting a member whose body is not ready", async () => {
    await createDatabase({
      id: "pending-database",
      documentId: "pending-database-document",
      title: "Pending Database",
    });
    await createDocument({
      id: "pending-page",
      title: "Pending Page",
    });
    await addDatabaseItem({
      id: "pending-item",
      databaseId: "pending-database",
      documentId: "pending-page",
      position: 0,
      bodyHydrationStatus: "pending",
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        exportDocumentAction.run({
          id: "pending-database-document",
          format: "markdown",
        }),
      ),
    ).rejects.toThrow('Database item "pending-page" is not ready for export');
  });

  it("keeps ordinary page exports unchanged", async () => {
    await createDocument({
      id: "ordinary-page",
      title: "Ordinary Page",
      content: "Page body",
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: "ordinary-page",
        format: "markdown",
      }),
    );

    expect(result.content).toBe("# Ordinary Page\n\nPage body\n");
  });
});
