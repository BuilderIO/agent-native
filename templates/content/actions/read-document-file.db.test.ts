import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isActionExposedToExternalAgents } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../server/lib/document-pdf.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/document-pdf.js")>();
  return {
    ...actual,
    renderDocumentPdf: (
      input: Parameters<typeof actual.renderDocumentPdf>[0],
    ) => {
      if (input.content.includes("The render breaks here.")) {
        throw new Error("font files missing");
      }
      if (input.content.includes("The PDF comes out too large.")) {
        return Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(2_200_000)]);
      }
      return actual.renderDocumentPdf(input);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-read-document-file-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "file-owner@example.com";
const OTHER = "file-other@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let action: typeof import("./read-document-file.js").default;
let documentFileName: typeof import("./read-document-file.js").documentFileName;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const actionModule = await import("./read-document-file.js");
  action = actionModule.default;
  documentFileName = actionModule.documentFileName;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await addDocument({
    id: "plan-page",
    title: "Q3 plan: draft",
    content: "## Goals\n\n- Ship the signup page.",
  });
  await addDocument({ id: "trashed-page", trashed: true });
  await addDocument({ id: "private-page", ownerEmail: OTHER });
  await addDocument({ id: "hidden-page", hideFromSearch: true });
  await addCollection();
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let clock = Date.parse("2026-01-01T00:00:00.000Z");

async function addDocument(args: {
  id: string;
  title?: string;
  content?: string;
  ownerEmail?: string;
  orgId?: string;
  parentId?: string;
  trashed?: boolean;
  hideFromSearch?: boolean;
}) {
  const timestamp = new Date((clock += 1000)).toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      parentId: args.parentId ?? null,
      ownerEmail: args.ownerEmail ?? OWNER,
      orgId: args.orgId ?? null,
      title: args.title ?? args.id,
      description: "",
      content: args.content ?? `body of ${args.id}`,
      visibility: args.orgId ? "org" : "private",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(args.trashed ? { trashedAt: timestamp } : {}),
      ...(args.hideFromSearch ? { hideFromSearch: 1 } : {}),
    });
}

async function addProperty(args: {
  id: string;
  name: string;
  type: string;
  position: number;
  visibility?: string;
  optionsJson?: string;
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documentPropertyDefinitions)
    .values({
      id: args.id,
      ownerEmail: OWNER,
      databaseId: "launch-tracker",
      name: args.name,
      type: args.type,
      visibility: args.visibility ?? "always_show",
      optionsJson: args.optionsJson ?? "{}",
      position: args.position,
      createdAt: now,
      updatedAt: now,
    });
}

async function addCollection() {
  await addDocument({ id: "tracker-page", title: "Launch tracker" });
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: "launch-tracker",
      ownerEmail: OWNER,
      documentId: "tracker-page",
      title: "Launch tracker",
      viewConfigJson: JSON.stringify({
        activeViewId: "primary",
        views: [{ id: "primary", name: "Table", type: "table" }],
      }),
    });
  await addDocument({
    id: "tracker-row",
    title: "Signup page",
    content: "Row body",
    parentId: "tracker-page",
  });
  const now = new Date().toISOString();
  await getDb().insert(schema.contentDatabaseItems).values({
    id: "tracker-item",
    ownerEmail: OWNER,
    databaseId: "launch-tracker",
    documentId: "tracker-row",
    position: 0,
    bodyHydrationStatus: "hydrated",
    createdAt: now,
    updatedAt: now,
  });
  await addProperty({
    id: "tracker-status",
    name: "Status",
    type: "status",
    position: 0,
    optionsJson: JSON.stringify({ options: [{ id: "ready", name: "Ready" }] }),
  });
  await addProperty({
    id: "tracker-secret",
    name: "Internal",
    type: "text",
    position: 1,
    visibility: "always_hide",
  });
  await addProperty({
    id: "tracker-notes",
    name: "Notes",
    type: "blocks",
    position: 2,
    optionsJson: JSON.stringify({ blocks: { primary: false } }),
  });
  await getDb()
    .insert(schema.documentPropertyValues)
    .values({
      id: "tracker-status-value",
      ownerEmail: OWNER,
      documentId: "tracker-row",
      propertyId: "tracker-status",
      valueJson: JSON.stringify("ready"),
      createdAt: now,
      updatedAt: now,
    });
}

function readAs<T>(context: { userEmail?: string }, fn: () => Promise<T>) {
  return runWithRequestContext(context, fn);
}

const owner = { userEmail: OWNER };

function read(id: string, format?: "markdown" | "csv" | "pdf") {
  return readAs(owner, () =>
    action.run({ operation: "read", id, page: 1, format }),
  );
}

describe("Content read-document-file", () => {
  it("lists pages and collections the caller can open, each with the format it attaches as", async () => {
    const result = await readAs(owner, () =>
      action.run({ operation: "list", page: 1 }),
    );
    const items = "items" in result ? result.items : [];
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "plan-page",
        kind: "page",
        format: "markdown",
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "tracker-page",
        kind: "collection",
        format: "csv",
      }),
    );
    const ids = items.map((item) => item.id);
    expect(ids).not.toContain("private-page");
    expect(ids).not.toContain("trashed-page");
    expect(ids).not.toContain("hidden-page");
  });

  it("searches by title", async () => {
    const result = await readAs(owner, () =>
      action.run({ operation: "list", search: "tracker", page: 1 }),
    );
    expect("items" in result && result.items).toEqual([
      expect.objectContaining({ id: "tracker-page", kind: "collection" }),
    ]);
  });

  it("reads a page as a Markdown file named for its title", async () => {
    const result = await read("plan-page");
    expect(result).toMatchObject({
      id: "plan-page",
      kind: "page",
      format: "markdown",
      filename: "Q3 plan draft.md",
      mimeType: "text/markdown;charset=utf-8",
      encoding: "utf8",
      content: "# Q3 plan: draft\n\n## Goals\n\n- Ship the signup page.\n",
    });
    expect("size" in result && result.size).toBe(
      Buffer.byteLength("content" in result ? result.content : "", "utf8"),
    );
  });

  it("reads a page as a PDF file, base64-encoded", async () => {
    const result = await read("plan-page", "pdf");
    expect(result).toMatchObject({
      kind: "page",
      format: "pdf",
      filename: "Q3 plan draft.pdf",
      mimeType: "application/pdf",
      encoding: "base64",
    });
    const pdf = Buffer.from(
      "content" in result ? result.content : "",
      "base64",
    );
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect("size" in result && result.size).toBe(pdf.byteLength);
  });

  it("reads a collection as a CSV of its columns, leaving out always-hidden and Blocks fields", async () => {
    const result = await read("tracker-page");
    expect(result).toMatchObject({
      kind: "collection",
      format: "csv",
      filename: "Launch tracker.csv",
      mimeType: "text/csv;charset=utf-8",
      content: "Title,Status\r\nSignup page,Ready\r\n",
    });
  });

  it("refuses a format that doesn't fit the page", async () => {
    await expect(read("plan-page", "csv")).rejects.toMatchObject({
      errorCode: "document_file_format_unsupported",
    });
    await expect(read("tracker-page", "markdown")).rejects.toMatchObject({
      errorCode: "document_file_format_unsupported",
    });
    await expect(read("tracker-page", "pdf")).rejects.toMatchObject({
      errorCode: "document_file_format_unsupported",
    });
  });

  it("refuses a PDF of a page in a script the PDF font can't show", async () => {
    await addDocument({ id: "tokyo-page", content: "東京の計画" });
    await expect(read("tokyo-page", "pdf")).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "document_file_pdf_text_unsupported",
    });
    await expect(read("tokyo-page")).resolves.toMatchObject({
      format: "markdown",
    });
  });

  it("refuses a PDF of a page longer than the PDF page limit", async () => {
    await addDocument({
      id: "long-page",
      content: Array.from(
        { length: 12_000 },
        (_, index) => `Paragraph ${index}`,
      ).join("\n\n"),
    });
    await expect(read("long-page", "pdf")).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "document_file_pdf_too_long",
      message: expect.stringContaining("over 200 pages"),
    });
    await expect(read("long-page")).resolves.toMatchObject({
      format: "markdown",
    });
  });

  it("refuses a PDF the renderer fails on, and logs why", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await addDocument({
      id: "broken-page",
      content: "The render breaks here.",
    });
    await expect(read("broken-page", "pdf")).rejects.toMatchObject({
      statusCode: 500,
      errorCode: "document_file_pdf_failed",
      message: expect.stringContaining("Attach it as Markdown"),
    });
    expect(logged).toHaveBeenCalledWith(
      "[read-document-file] PDF render failed",
      expect.any(Error),
    );
    logged.mockRestore();
    await expect(read("broken-page")).resolves.toMatchObject({
      format: "markdown",
    });
  });

  it("refuses a PDF over 2 MB of a page whose Markdown fits, and says to attach Markdown", async () => {
    await addDocument({
      id: "heavy-pdf-page",
      content: "The PDF comes out too large.",
    });
    await expect(read("heavy-pdf-page", "pdf")).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "document_file_pdf_too_long",
      message: expect.stringContaining("Attach it as Markdown"),
    });
    await expect(read("heavy-pdf-page")).resolves.toMatchObject({
      format: "markdown",
    });
  });

  it("refuses a page too large to send back in one response", async () => {
    await addDocument({ id: "huge-page", content: "x".repeat(2_200_000) });
    await expect(read("huge-page")).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "document_file_too_large",
    });
    await expect(read("huge-page", "pdf")).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "document_file_too_large",
    });
  });

  it.each(["trashed-page", "private-page", "missing-page"])(
    "does not read %s",
    async (id) => {
      await expect(read(id)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: "document_file_unavailable",
      });
    },
  );

  it("reads a page it lists from an organization that isn't the active one", async () => {
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: ["side-org", "Side org", OTHER, 0],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: ["side-member", "side-org", OWNER, "member", 0],
    });
    await addDocument({
      id: "side-org-page",
      ownerEmail: OTHER,
      orgId: "side-org",
    });

    const listed = await readAs(owner, () =>
      action.run({ operation: "list", page: 1 }),
    );
    expect("items" in listed ? listed.items : []).toContainEqual(
      expect.objectContaining({ id: "side-org-page" }),
    );
    await expect(read("side-org-page")).resolves.toMatchObject({
      id: "side-org-page",
      content: "# side-org-page\n\nbody of side-org-page\n",
    });
  });

  it("asks for a page to read", async () => {
    await expect(
      readAs(owner, () => action.run({ operation: "read", page: 1 })),
    ).rejects.toMatchObject({ errorCode: "document_file_required" });
  });

  it("requires a signed-in caller", async () => {
    await expect(
      readAs({}, () => action.run({ operation: "list", page: 1 })),
    ).rejects.toMatchObject({ statusCode: 401, errorCode: "unauthorized" });
  });

  it("is exposed to peer apps as an authenticated read, not to Content's own agent", () => {
    expect(action.readOnly).toBe(true);
    expect(action.mcpTool).toBe(true);
    expect(action.agentTool).toBe(false);
    expect(isActionExposedToExternalAgents(action)).toBe(true);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
    });
  });
});

describe("documentFileName", () => {
  it("keeps the title readable and drops characters a filename can't hold", () => {
    expect(documentFileName('Plan: "v2" / final?', "markdown")).toBe(
      "Plan v2 final.md",
    );
    expect(documentFileName("  ...  ", "csv")).toBe("Untitled.csv");
    expect(documentFileName(null, "markdown")).toBe("Untitled.md");
  });
});
