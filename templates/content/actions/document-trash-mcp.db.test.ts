import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadActionsFromStaticRegistry,
  runFrameworkReleaseMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "../../../packages/core/src/mcp/build-server.js";

const requireFromCore = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
);
const [{ Client }, { InMemoryTransport }] = await Promise.all([
  import(requireFromCore.resolve("@modelcontextprotocol/client")),
  import(requireFromCore.resolve("@modelcontextprotocol/server")),
]);
type MCPClient = InstanceType<typeof Client>;

// guard:allow-unscoped — isolated test database verifies the external MCP protocol boundary.
const databasePath = join(
  tmpdir(),
  `content-trash-mcp-${process.pid}-${Date.now()}.pglite`,
);
const databaseUrl =
  process.env.CONTENT_SETUP_POSTGRES_URL ?? `pglite:${databasePath}`;
const owner = "mcp-trash-owner@example.com";
const outsider = "mcp-trash-outsider@example.com";
const sessions: Array<{
  client: MCPClient;
  server: Awaited<ReturnType<typeof createMCPServerForRequest>>;
}> = [];

let actions: MCPConfig["actions"];
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let ownerClient: MCPClient;
let secondOwnerClient: MCPClient;
let outsiderClient: MCPClient;

function callerIdentity(userEmail: string): MCPCallerIdentity {
  return {
    userEmail,
    orgDomain: undefined,
    oauthScopes: ["mcp:read", "mcp:write"],
  };
}

async function connect(userEmail: string) {
  const server = await createMCPServerForRequest(
    {
      name: "Content",
      appId: "content",
      description: "Agent-Native Content",
      version: "1.0.0-test",
      actions,
      productionActions: actions,
      builtinCrossAppTools: false,
      externalAgents: { writes: "allowlisted" },
    },
    callerIdentity(userEmail),
    {
      origin: "http://content.test",
      transport: "http",
      fullSurface: true,
      inlineMcpApps: false,
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "content-trash-test", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  sessions.push({ client, server });
  return client;
}

type ProtocolResult = Awaited<ReturnType<MCPClient["callTool"]>>;

function resultTexts(result: ProtocolResult): string[] {
  return result.content
    .filter(
      (
        entry,
      ): entry is Extract<(typeof result.content)[number], { type: "text" }> =>
        entry.type === "text",
    )
    .map((entry) => entry.text);
}

async function callJson<T = any>(
  client: MCPClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const texts = resultTexts(result);
  expect(result.isError, texts.join("\n")).not.toBe(true);
  if (result.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent as T;
  for (const text of texts) {
    try {
      return JSON.parse(text) as T;
    } catch {}
  }
  throw new Error(`${name} returned no JSON result: ${texts.join("\n")}`);
}

async function callError(
  client: MCPClient,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  return resultTexts(result).join("\n");
}

async function createPage(title: string, parentId?: string) {
  const result = await ownerClient.callTool({
    name: "create-document",
    arguments: {
      title,
      content: `Disposable ${title}`,
      ...(parentId ? { parentId } : {}),
    },
  });
  const text = resultTexts(result).join("\n");
  expect(result.isError, text).not.toBe(true);
  const id = /\/page\/([A-Za-z0-9_-]+)/.exec(text)?.[1];
  if (!id) throw new Error(`create-document returned no page id: ${text}`);
  return { id };
}

async function readPage(id: string) {
  const [page] = await getDb()
    .select({
      updatedAt: schema.documents.updatedAt,
      trashedAt: schema.documents.trashedAt,
      trashRootId: schema.documents.trashRootId,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return page;
}

beforeAll(async () => {
  if (
    databaseUrl.startsWith("postgres") &&
    !new URL(databaseUrl).pathname.includes("test")
  ) {
    throw new Error(
      "CONTENT_SETUP_POSTGRES_URL must be an isolated test database",
    );
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = await import("../server/db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  if (databaseUrl.startsWith("postgres")) {
    await runFrameworkReleaseMigrations(undefined);
  }
  await (await import("../server/plugins/db.js")).default(undefined as never);
  const { provisionContentSpaces } = await import("./_content-spaces.js");
  for (const userEmail of [owner, outsider]) {
    await runWithRequestContext({ userEmail }, () =>
      provisionContentSpaces(getDb(), userEmail),
    );
  }
  const { default: actionModules } =
    await import("../.generated/actions-registry.js");
  actions = loadActionsFromStaticRegistry(actionModules);
  [ownerClient, secondOwnerClient, outsiderClient] = await Promise.all([
    connect(owner),
    connect(owner),
    connect(outsider),
  ]);
}, 120_000);

afterAll(async () => {
  await Promise.all(
    sessions.flatMap(({ client, server }) => [client.close(), server.close()]),
  );
  if (!databaseUrl.startsWith("postgres")) {
    rmSync(databasePath, { recursive: true, force: true });
  }
});

describe("page Trash through external MCP", () => {
  it("advertises the guarded page lifecycle with honest annotations", async () => {
    const { tools } = await ownerClient.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of [
      "delete-document",
      "restore-document",
      "list-content-trash",
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
    expect(byName.has("permanently-delete-document")).toBe(false);
    expect(byName.has("execute-content-trash-purge")).toBe(false);

    expect(byName.get("delete-document")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get("delete-content-database")?.annotations).toMatchObject({
      destructiveHint: true,
    });
    expect(byName.get("restore-document")?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(byName.get("list-content-trash")?.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(byName.get("delete-document")?.inputSchema.required).toEqual(
      expect.arrayContaining(["id", "expectedUpdatedAt", "idempotencyKey"]),
    );
    expect(byName.get("restore-document")?.inputSchema.required).toEqual(
      expect.arrayContaining(["id", "expectedTrashedAt", "idempotencyKey"]),
    );
  });

  it("trashes, lists, and restores a page and its sub-pages with replayable receipts", async () => {
    const parent = await createPage("MCP trash parent");
    const child = await createPage("MCP trash child", parent.id);
    const fresh = await callJson(ownerClient, "get-document", {
      id: parent.id,
    });

    const legacy = await callError(ownerClient, "delete-document", {
      id: parent.id,
    });
    expect(legacy).toContain("DOCUMENT_LIFECYCLE_PROTOCOL_REQUIRED");
    expect(legacy).toContain("expectedUpdatedAt");

    const denied = await callError(outsiderClient, "delete-document", {
      id: parent.id,
      expectedUpdatedAt: fresh.updatedAt,
      idempotencyKey: "outsider-trash",
    });
    expect(denied).toMatch(/No access to document/);

    const stale = await callError(ownerClient, "delete-document", {
      id: parent.id,
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      idempotencyKey: "trash-parent",
    });
    expect(stale).toContain("DOCUMENT_REVISION_CONFLICT");
    expect(stale).not.toContain(fresh.updatedAt);
    expect((await readPage(parent.id)).trashedAt).toBeNull();

    const trashInput = {
      id: parent.id,
      expectedUpdatedAt: fresh.updatedAt,
      idempotencyKey: "trash-parent",
    };
    const [trashed, concurrent] = await Promise.all([
      callJson(ownerClient, "delete-document", trashInput),
      callJson(secondOwnerClient, "delete-document", trashInput),
    ]);
    const applied = [trashed, concurrent].find(
      (result) => result.receipt.idempotency.result === "applied",
    );
    const replayed = [trashed, concurrent].find(
      (result) => result.receipt.idempotency.result === "replayed",
    );
    expect(applied).toBeDefined();
    expect(replayed?.receipt.receiptId).toBe(applied.receipt.receiptId);
    expect(applied).toMatchObject({
      success: true,
      documentId: parent.id,
      trashRootId: parent.id,
      affectedDocumentCount: 2,
      affectedDocumentIdsComplete: true,
      receipt: {
        operation: "delete-document",
        outcome: "trashed",
        readback: { verified: true },
      },
    });
    expect(applied.affectedDocumentIds).toEqual(
      expect.arrayContaining([parent.id, child.id]),
    );
    expect(await readPage(child.id)).toMatchObject({
      trashRootId: parent.id,
      trashedAt: applied.trashedAt,
    });

    const reused = await callError(ownerClient, "delete-document", {
      ...trashInput,
      expectedUpdatedAt: applied.updatedAt,
    });
    expect(reused).toContain("IDEMPOTENCY_KEY_REUSED");

    const alreadyTrashed = await callJson(ownerClient, "delete-document", {
      id: child.id,
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      idempotencyKey: "trash-child-again",
    });
    expect(alreadyTrashed).toMatchObject({
      trashRootId: parent.id,
      affectedDocumentCount: 0,
      receipt: { outcome: "unchanged" },
    });

    const listed = await callJson(ownerClient, "list-content-trash", {
      query: "MCP trash parent",
    });
    const item = listed.items.find(
      (candidate: { documentId: string }) => candidate.documentId === parent.id,
    );
    expect(item).toMatchObject({
      kind: "page",
      trashedAt: applied.trashedAt,
      canRestore: true,
    });

    const nested = await callError(ownerClient, "restore-document", {
      id: child.id,
      expectedTrashedAt: applied.trashedAt,
      idempotencyKey: "restore-child",
    });
    expect(nested).toContain("PARENT_IN_TRASH");
    expect(nested).toContain(parent.id);

    const staleRestore = await callError(ownerClient, "restore-document", {
      id: parent.id,
      expectedTrashedAt: "2000-01-01T00:00:00.000Z",
      idempotencyKey: "restore-parent",
    });
    expect(staleRestore).toContain("TRASH_REVISION_CONFLICT");

    const restoreInput = {
      id: parent.id,
      expectedTrashedAt: item.trashedAt,
      idempotencyKey: "restore-parent",
    };
    const restored = await callJson(
      ownerClient,
      "restore-document",
      restoreInput,
    );
    expect(restored).toMatchObject({
      documentId: parent.id,
      trashedAt: null,
      affectedDocumentCount: 2,
      receipt: { outcome: "restored", idempotency: { result: "applied" } },
    });
    expect((await readPage(child.id)).trashedAt).toBeNull();
    const replayedRestore = await callJson(
      ownerClient,
      "restore-document",
      restoreInput,
    );
    expect(replayedRestore.receipt).toMatchObject({
      receiptId: restored.receipt.receiptId,
      idempotency: { result: "replayed" },
    });

    const visible = await callJson(ownerClient, "get-document", {
      id: child.id,
    });
    expect(visible.id).toBe(child.id);
  });

  it("locks a Trash group's collections in one order after a member moves", async () => {
    const parent = await createPage("Restore lock parent");
    const child = await createPage("Restore lock child", parent.id);
    const collection = await createPage("Restore lock collection");
    const destination = await createPage("Restore lock destination");
    // Sorts before generated ids, so an out-of-order restore locks it last.
    const collectionId = "--restore-lock-collection";
    await getDb().insert(schema.contentDatabases).values({
      id: collectionId,
      documentId: collection.id,
      ownerEmail: owner,
    });
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "restore-lock-membership",
      databaseId: collectionId,
      documentId: child.id,
      ownerEmail: owner,
    });
    const trashed = await callJson(ownerClient, "delete-document", {
      id: parent.id,
      expectedUpdatedAt: (await readPage(parent.id)).updatedAt,
      idempotencyKey: "restore-lock-trash",
    });
    const moveDocument = (await import("./move-document.js")).default;
    await runWithRequestContext({ userEmail: owner }, () =>
      moveDocument.run(
        { id: child.id, parentId: destination.id },
        { caller: "frontend" },
      ),
    );

    const locks = await import("./_content-database-mutation-lock.js");
    const lockDatabase = locks.lockContentDatabaseMutation;
    const lockOrder: string[] = [];
    const spy = vi
      .spyOn(locks, "lockContentDatabaseMutation")
      .mockImplementation(async (tx, databaseId) => {
        lockOrder.push(databaseId);
        return lockDatabase(tx, databaseId);
      });
    try {
      const restored = await callJson(ownerClient, "restore-document", {
        id: parent.id,
        expectedTrashedAt: trashed.trashedAt,
        idempotencyKey: "restore-lock-restore",
      });
      expect(restored).toMatchObject({
        affectedDocumentCount: 2,
        receipt: { outcome: "restored" },
      });
    } finally {
      spy.mockRestore();
    }
    expect(lockOrder).toContain(collectionId);
    expect(lockOrder).toEqual([...lockOrder].sort());
  });

  it("routes collection pages to the collection lifecycle", async () => {
    const spaces = await callJson(ownerClient, "list-content-spaces", {});
    const space = spaces.spaces.find(
      (candidate: { canCreateDatabase: boolean }) =>
        candidate.canCreateDatabase,
    );
    const created = await callJson(ownerClient, "create-content-database", {
      spaceId: space.id,
      title: "MCP trash collection",
      idempotencyKey: "trash-collection-create",
    });
    const documentId = created.database.documentId as string;
    const page = await readPage(documentId);

    const refused = await callError(ownerClient, "delete-document", {
      id: documentId,
      expectedUpdatedAt: page.updatedAt,
      idempotencyKey: "trash-collection-page",
    });
    expect(refused).toContain("COLLECTION_PAGE");
    expect(refused).toContain("delete-content-database");
    expect((await readPage(documentId)).trashedAt).toBeNull();
  });

  it("keeps the signed-in UI's unguarded Trash contract", async () => {
    const created = await createPage("UI trash page");
    const deleteDocument = (await import("./delete-document.js")).default;
    const restoreDocument = (await import("./restore-document.js")).default;
    const deleted = await runWithRequestContext({ userEmail: owner }, () =>
      deleteDocument.run(
        { id: created.id, activeDocumentId: created.id },
        { caller: "frontend" },
      ),
    );
    expect(deleted).toMatchObject({
      success: true,
      deleted: 1,
      activeTargetDeleted: true,
      navigationPath: "/home",
    });
    const restored = await runWithRequestContext({ userEmail: owner }, () =>
      restoreDocument.run({ id: created.id }, { caller: "frontend" }),
    );
    expect(restored).toMatchObject({ success: true, restored: 1 });
  });
});
