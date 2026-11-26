import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAppState } from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { nfmToDoc } from "../shared/nfm.js";

vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: vi.fn().mockResolvedValue(undefined),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `append-to-document-${process.pid}-${Date.now()}.pglite`,
);

const missedOnce = vi.hoisted(() => new Set<string>());

vi.mock("./_database-utils.js", async (importOriginal) => {
  const utils = await importOriginal<typeof import("./_database-utils.js")>();
  return {
    ...utils,
    getDatabaseByDocumentId: (
      ...args: Parameters<typeof utils.getDatabaseByDocumentId>
    ) =>
      missedOnce.delete(args[0])
        ? Promise.resolve(null)
        : utils.getDatabaseByDocumentId(...args),
  };
});

type Schema = typeof import("../server/db/schema.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let appendToDocument: typeof import("./append-to-document.js").default;

const OWNER = "owner@example.com";
const STRANGER = "stranger@example.com";
const person = { caller: "frontend" as const, userEmail: OWNER };

const TABLE =
  '<table header-row="true">\n<tr>\n<td>Name</td>\n<td>Price</td>\n</tr>\n<tr>\n<td>Widget</td>\n<td>\\$60</td>\n</tr>\n</table>';

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  appendToDocument = (await import("./append-to-document.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;

async function createPage(
  content: string,
  extra: Partial<Record<"title" | "sourceMode" | "trashedAt", string>> = {},
) {
  counter += 1;
  const id = `append_${counter}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      ownerEmail: OWNER,
      parentId: null,
      title: extra.title ?? "Target",
      content,
      position: 0,
      visibility: "private",
      orgId: null,
      createdAt: now,
      updatedAt: now,
      ...(extra.sourceMode ? { sourceMode: extra.sourceMode } : {}),
      ...(extra.trashedAt ? { trashedAt: extra.trashedAt } : {}),
    });
  return id;
}

async function body(id: string) {
  const [row] = await getDb()
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row.content as string;
}

function append(
  documentId: string,
  content: string,
  ctx: { caller: "frontend" | "mcp"; userEmail: string } = person,
) {
  return runWithRequestContext({ userEmail: ctx.userEmail }, () =>
    appendToDocument.run({ documentId, content }, ctx),
  );
}

function blockTypes(content: string) {
  return nfmToDoc(content).content.map((node) => node.type);
}

describe("append-to-document", () => {
  it("adds the block after the page's last block and returns its title", async () => {
    const id = await createPage("## Notes\nFirst line.", { title: "Inbox" });

    await expect(append(id, "Moved paragraph.")).resolves.toEqual({
      documentId: id,
      title: "Inbox",
    });
    expect(await body(id)).toBe("## Notes\nFirst line.\nMoved paragraph.");
  });

  it("reports a committed move as done when the refresh signal fails", async () => {
    const id = await createPage("First line.", { title: "Inbox" });
    vi.mocked(writeAppState).mockRejectedValue(new Error("state down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(append(id, "Moved paragraph.")).resolves.toEqual({
        documentId: id,
        title: "Inbox",
      });
      expect(warn).toHaveBeenCalledWith(
        "[append-to-document] refresh signal failed:",
        "state down",
      );
    } finally {
      warn.mockRestore();
      vi.mocked(writeAppState).mockResolvedValue(undefined);
    }
    expect(await body(id)).toBe("First line.\nMoved paragraph.");
  });

  it("joins after the page's trailing blank lines, and fills an empty page", async () => {
    const trailing = await createPage("Closing paragraph.\n\n");
    await append(trailing, "Moved paragraph.");
    expect(await body(trailing)).toBe("Closing paragraph.\nMoved paragraph.");

    const empty = await createPage("");
    await append(empty, "Moved paragraph.");
    expect(await body(empty)).toBe("Moved paragraph.");

    const cleared = await createPage("<empty-block/>");
    await append(cleared, "Moved paragraph.");
    expect(await body(cleared)).toBe("Moved paragraph.");
  });

  it("joins a moved list to a list of the same kind that ends the page, as the stored form joins any two", async () => {
    const id = await createPage("- First item");
    await append(id, "- Moved item");
    expect(await body(id)).toBe("- First item\n- Moved item");
    expect(blockTypes(await body(id))).toEqual(["bulletList"]);
  });

  it("keeps a block added after a table, list or code block a block of its own", async () => {
    const afterTable = await createPage(TABLE);
    await append(afterTable, "After the table.");
    expect(blockTypes(await body(afterTable))).toEqual(["table", "paragraph"]);

    const afterCode = await createPage("```ts\nconst a = 1;\n```");
    await append(afterCode, "After the code.");
    expect(blockTypes(await body(afterCode))).toEqual([
      "codeBlock",
      "paragraph",
    ]);

    const afterList = await createPage("- one\n- two");
    await append(afterList, "> A quote");
    expect(blockTypes(await body(afterList))).toEqual([
      "bulletList",
      "blockquote",
    ]);

    const tableMoved = await createPage("Before the table.");
    await append(tableMoved, TABLE);
    expect(blockTypes(await body(tableMoved))).toEqual(["paragraph", "table"]);
  });

  it("stores the added block in the stored form", async () => {
    const id = await createPage("Placeholder line.");
    await append(id, "The plan costs $60 a month.\n\n");
    expect(await body(id)).toBe(
      "Placeholder line.\nThe plan costs \\$60 a month.",
    );
  });

  it("refuses a page the caller can't edit and leaves it unchanged", async () => {
    const id = await createPage("Private line.");
    await expect(
      append(id, "Moved paragraph.", {
        caller: "frontend",
        userEmail: STRANGER,
      }),
    ).rejects.toBeTruthy();
    expect(await body(id)).toBe("Private line.");
  });

  it("refuses a page in Trash", async () => {
    const id = await createPage("Trashed line.", {
      trashedAt: new Date().toISOString(),
    });
    await expect(append(id, "Moved paragraph.")).rejects.toMatchObject({
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
    expect(await body(id)).toBe("Trashed line.");
  });

  it("refuses a page that follows a GitHub file", async () => {
    const id = await createPage("Synced line.", { sourceMode: "github" });
    await expect(append(id, "Moved paragraph.")).rejects.toMatchObject({
      errorCode: "SOURCE_READ_ONLY",
    });
    expect(await body(id)).toBe("Synced line.");
  });

  it("refuses a collection's page", async () => {
    const id = await createPage("", { title: "Tasks" });
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.contentDatabases)
      .values({
        id: `db_${id}`,
        ownerEmail: OWNER,
        documentId: id,
        title: "Tasks",
        createdAt: now,
        updatedAt: now,
      });
    await expect(append(id, "Moved paragraph.")).rejects.toMatchObject({
      errorCode: "DOCUMENT_IS_COLLECTION",
      statusCode: 400,
    });
    expect(await body(id)).toBe("");
  });

  it("refuses a page made into a collection while the block was added", async () => {
    const id = await createPage("Plan line.", { title: "Tasks" });
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.contentDatabases)
      .values({
        id: `db_${id}`,
        ownerEmail: OWNER,
        documentId: id,
        title: "Tasks",
        createdAt: now,
        updatedAt: now,
      });
    missedOnce.add(id);
    await expect(append(id, "Moved paragraph.")).rejects.toMatchObject({
      errorCode: "DOCUMENT_IS_COLLECTION",
      statusCode: 400,
    });
    expect(missedOnce.has(id)).toBe(false);
  });

  it("keeps a moved heading that reads as the page's title", async () => {
    const empty = await createPage("", { title: "Inbox" });
    await append(empty, "# Inbox");
    expect(await body(empty)).toBe("# Inbox");

    const headed = await createPage("# Inbox\nFirst line.", { title: "Inbox" });
    await append(headed, "Moved paragraph.");
    expect(await body(headed)).toBe("# Inbox\nFirst line.\nMoved paragraph.");
  });

  it("refuses a block the parser would lose part of, and leaves the page unchanged", async () => {
    const id = await createPage("Kept line.");
    await expect(append(id, "<empty-block/>lost text")).rejects.toMatchObject({
      errorCode: "DOCUMENT_BODY_UNREPRESENTABLE",
      statusCode: 422,
    });
    expect(await body(id)).toBe("Kept line.");
  });

  it("refuses nothing to add", async () => {
    const id = await createPage("Kept line.");
    await expect(append(id, "\n\n")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await body(id)).toBe("Kept line.");
  });

  it("answers only the signed-in app, not an agent", async () => {
    const id = await createPage("Kept line.");
    await expect(
      append(id, "Moved paragraph.", { caller: "mcp", userEmail: OWNER }),
    ).rejects.toMatchObject({ errorCode: "ui_only_action", statusCode: 403 });
    expect(await body(id)).toBe("Kept line.");
  });
});
