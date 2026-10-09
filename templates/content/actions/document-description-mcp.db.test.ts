import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerLabs } from "@agent-native/core/labs/registry";
import {
  loadActionsFromStaticRegistry,
  runWithRequestContext,
} from "@agent-native/core/server";
import { setupCreativeContext } from "@agent-native/creative-context/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createMCPServerForRequest,
  type MCPConfig,
} from "../../../packages/core/src/mcp/build-server.js";
import { CONTENT_CREATIVE_CONTEXT, CONTENT_LABS } from "../shared/labs.js";

const requireFromCore = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
);
const [{ Client }, { InMemoryTransport }] = await Promise.all([
  import(requireFromCore.resolve("@modelcontextprotocol/client")),
  import(requireFromCore.resolve("@modelcontextprotocol/server")),
]);
type MCPClient = InstanceType<typeof Client>;

// guard:allow-unscoped — isolated database reads verify MCP persistence and omitted-field preservation.
const databasePath = join(
  tmpdir(),
  `content-description-mcp-${process.pid}-${Date.now()}.pglite`,
);
const owner = "description-owner@example.com";
const outsider = "description-outsider@example.com";
const viewer = "description-viewer@example.com";
const editor = "description-editor@example.com";
const sessions: Array<{
  client: MCPClient;
  server: Awaited<ReturnType<typeof createMCPServerForRequest>>;
}> = [];
let actions: MCPConfig["actions"];
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let ownerClient: MCPClient;
let outsiderClient: MCPClient;
let readOnlyClient: MCPClient;
let viewerClient: MCPClient;
let editorClient: MCPClient;

async function connect(userEmail: string, writes = true) {
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
    {
      userEmail,
      orgDomain: undefined,
      oauthScopes: writes ? ["mcp:read", "mcp:write"] : ["mcp:read"],
    },
    {
      origin: "http://content.test",
      transport: "http",
      inlineMcpApps: false,
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "content-description-test",
    version: "1.0.0",
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  sessions.push({ client, server });
  return client;
}

async function callJson(
  client: MCPClient,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as Record<string, any>;
}

async function readRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row;
}

async function createPage(args: Record<string, unknown>) {
  const result = await ownerClient.callTool({
    name: "create-document",
    arguments: args,
  });
  const text = result.content
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
  expect(result.isError, text).not.toBe(true);
  const id = /\/page\/([A-Za-z0-9_-]+)/.exec(text)?.[1];
  if (!id) throw new Error(`create-document returned no page id: ${text}`);
  return callJson(ownerClient, "get-document", { id });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  registerLabs(CONTENT_LABS);
  setupCreativeContext({
    appId: "content",
    labKey: CONTENT_CREATIVE_CONTEXT.key,
  });
  const database = await import("../server/db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  const { provisionContentSpaces } = await import("./_content-spaces.js");
  for (const userEmail of [owner, outsider, viewer, editor]) {
    await runWithRequestContext({ userEmail }, () =>
      provisionContentSpaces(getDb(), userEmail),
    );
  }
  actions = loadActionsFromStaticRegistry({
    "create-document": await import("./create-document.js"),
    "update-document": await import("./update-document.js"),
    "get-document": await import("./get-document.js"),
    "list-content-spaces": await import("./list-content-spaces.js"),
    "create-content-database": await import("./create-content-database.js"),
    "describe-content-database": await import("./describe-content-database.js"),
    "get-content-database": await import("./get-content-database.js"),
  });
  [ownerClient, outsiderClient, readOnlyClient, viewerClient, editorClient] =
    await Promise.all([
      connect(owner),
      connect(outsider),
      connect(owner, false),
      connect(viewer),
      connect(editor),
    ]);
}, 120_000);

afterAll(async () => {
  await Promise.all(
    sessions.flatMap(({ client, server }) => [client.close(), server.close()]),
  );
  rmSync(databasePath, { recursive: true, force: true });
});

const longDescription = `${"Complete guidance with Unicode café 🪶 and Markdown **emphasis**.\n".repeat(160)}END OF DESCRIPTION`;

describe("document descriptions through external MCP", () => {
  it("rejects invalid creative context before saving document metadata", async () => {
    const created = await createPage({ title: "Validate before save" });
    const before = await readRow(created.id);
    const rejected = await ownerClient.callTool({
      name: "update-document",
      arguments: {
        id: created.id,
        description: "Must not be saved",
        contextModeOverride: "off",
        contextPackId: "fake-context-pack",
      },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected.content)).toContain(
      "contextPackId cannot be applied",
    );
    expect(await readRow(created.id)).toEqual(before);
  });

  it.each(["unavailable", "forbidden"] as const)(
    "reports a committed save when creative-context recording is %s",
    async (failureKind) => {
      const created = await createPage({
        title: "Post-commit recording",
        content: "Private body",
      });
      const creativeContext =
        await import("@agent-native/creative-context/server");
      const { ForbiddenError } = await import("@agent-native/core/sharing");
      const record = vi
        .spyOn(creativeContext, "recordGenerationCreativeContext")
        .mockRejectedValueOnce(
          failureKind === "forbidden"
            ? new ForbiddenError("Private context failure")
            : new Error("Private context failure"),
        );
      try {
        const result = await ownerClient.callTool({
          name: "update-document",
          arguments: {
            id: created.id,
            description: "Saved private guidance",
            contextModeOverride: "off",
          },
        });
        expect(result.isError).toBe(true);
        const errorText = JSON.stringify(result.content);
        expect(errorText).toContain("DOCUMENT_SAVED_RESPONSE_FAILED");
        expect(errorText).toContain("update was saved");
        expect(errorText).not.toContain("Saved private guidance");
        expect(errorText).not.toContain("Private body");
        expect(errorText).not.toContain("Private context failure");
        expect((await readRow(created.id)).description).toBe(
          "Saved private guidance",
        );
        expect(record).toHaveBeenCalledOnce();
      } finally {
        record.mockRestore();
      }
    },
  );

  it("rejects combined description and favorite changes before mutation", async () => {
    const created = await createPage({
      title: "Separate favorite update",
      description: "Original guidance",
    });
    const before = await readRow(created.id);
    const rejected = await ownerClient.callTool({
      name: "update-document",
      arguments: {
        id: created.id,
        description: "Must not be dropped",
        isFavorite: false,
      },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected.content)).toContain(
      "FAVORITE_UPDATE_MUST_BE_SEPARATE",
    );
    expect(await readRow(created.id)).toEqual(before);
  });

  it("distinguishes a committed description update from losing read access afterward", async () => {
    const created = await createPage({
      title: "Committed description",
      content: "Private body",
    });
    const db = getDb();
    const transaction = db.transaction.bind(db);
    const race = vi
      .spyOn(db, "transaction")
      .mockImplementationOnce(async (...args: unknown[]) => {
        const result = await transaction(...args);
        expect((await readRow(created.id)).description).toBe(
          "Saved private guidance",
        );
        await db
          .update(schema.documents)
          .set({ ownerEmail: outsider })
          .where(eq(schema.documents.id, created.id));
        return result;
      });
    try {
      const result = await ownerClient.callTool({
        name: "update-document",
        arguments: { id: created.id, description: "Saved private guidance" },
      });
      expect(result.isError).toBe(true);
      const errorText = JSON.stringify(result.content);
      expect(errorText).toContain("DOCUMENT_SAVED_ACCESS_CHANGED");
      expect(errorText).toContain("update was saved");
      expect(errorText).not.toContain("Saved private guidance");
      expect(errorText).not.toContain("Private body");
      expect(await readRow(created.id)).toMatchObject({
        description: "Saved private guidance",
        ownerEmail: outsider,
      });
      expect(race).toHaveBeenCalledOnce();
    } finally {
      race.mockRestore();
    }
  });

  it("reports a metadata conflict as an MCP error without saving any fields", async () => {
    const created = await createPage({
      title: "Current title",
      content: "Body",
    });
    const before = await readRow(created.id);
    const rejected = await ownerClient.callTool({
      name: "update-document",
      arguments: {
        id: created.id,
        title: "Must not apply",
        baseTitle: "Stale title",
        description: "Must not apply",
      },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected.content)).toContain(
      "DOCUMENT_UPDATE_CONFLICT",
    );
    expect(JSON.stringify(rejected.content)).toContain("no changes were saved");
    expect(await readRow(created.id)).toEqual(before);
  });

  it("advertises update-document in the compact catalog with write annotations", async () => {
    const { tools } = await ownerClient.listTools();
    const tool = tools.find((entry) => entry.name === "update-document");
    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
    expect(tool?.inputSchema.properties).toHaveProperty("description");
    expect(tool?.inputSchema.required).toContain("id");
    expect(
      (
        await ownerClient.callTool({
          name: "update-document",
          arguments: { description: "Missing document ID" },
        })
      ).isError,
    ).toBe(true);
    expect(
      (await readOnlyClient.listTools()).tools.map((entry) => entry.name),
    ).not.toContain("update-document");
  });

  it("updates, reads, retries, and clears a page description without changing its body", async () => {
    const created = await createPage({
      title: "MCP description page",
      content: "Keep this Markdown body.",
      description: "Before",
    });
    const before = await readRow(created.id);
    const updated = await callJson(ownerClient, "update-document", {
      id: created.id,
      description: longDescription,
    });
    expect(updated.description).toBe(longDescription);
    const read = await callJson(ownerClient, "get-document", {
      id: created.id,
    });
    expect(read.description).toBe(longDescription);
    expect(await readRow(created.id)).toMatchObject({
      title: before.title,
      content: before.content,
      icon: before.icon,
      bodyRevision: before.bodyRevision,
      description: longDescription,
    });
    const retried = await callJson(ownerClient, "update-document", {
      id: created.id,
      description: longDescription,
    });
    expect(retried.updatedAt).toBe(updated.updatedAt);
    const cleared = await callJson(ownerClient, "update-document", {
      id: created.id,
      description: "",
    });
    expect(cleared.description).toBe("");
    expect((await readRow(created.id)).content).toBe(before.content);
  });

  it("uses the database backing page id and returns the complete description on database reads", async () => {
    const spaces = await callJson(ownerClient, "list-content-spaces", {});
    const space = spaces.spaces.find((entry: any) => entry.kind === "personal");
    expect(space).toBeDefined();
    const created = await callJson(ownerClient, "create-content-database", {
      spaceId: space.id,
      title: "MCP description database",
      description: "Before",
      idempotencyKey: "description-database-create",
    });
    const id = created.database.documentId;
    const before = await readRow(id);
    await callJson(ownerClient, "update-document", {
      id,
      description: longDescription,
    });
    const page = await callJson(ownerClient, "get-document", { id });
    expect(page.description).toBe(longDescription);
    expect(page.database.description).toBe(longDescription);
    const described = await callJson(ownerClient, "describe-content-database", {
      databaseId: created.database.id,
    });
    expect(described.database.description).toBe(longDescription);
    const read = await callJson(ownerClient, "get-content-database", {
      databaseId: created.database.id,
      limit: 1,
    });
    expect(read.database.description).toBe(longDescription);
    expect(await readRow(id)).toMatchObject({
      title: before.title,
      content: before.content,
      bodyRevision: before.bodyRevision,
    });
  });

  it("rejects unauthorized updates and external body replacement without applying either patch", async () => {
    const created = await createPage({
      title: "Private description",
      content: "Protected body",
      description: "Protected guidance",
    });
    const before = await readRow(created.id);
    for (const [client, args] of [
      [outsiderClient, { id: created.id, description: "Denied" }],
      [readOnlyClient, { id: created.id, description: "Denied" }],
      [
        ownerClient,
        { id: created.id, description: "Denied", content: "Replace body" },
      ],
    ] as const) {
      const result = await client.callTool({
        name: "update-document",
        arguments: args,
      });
      expect(result.isError).toBe(true);
      expect(await readRow(created.id)).toEqual(before);
    }
    const hidden = await outsiderClient.callTool({
      name: "get-document",
      arguments: { id: created.id },
    });
    expect(hidden.isError).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain(before.description);
  });

  it("allows a shared editor, denies a viewer, and attributes the metadata write to its actor", async () => {
    const created = await createPage({
      title: "Shared description",
      content: "Shared body",
    });
    await getDb()
      .insert(schema.documentShares)
      .values(
        [viewer, editor].map((principalId) => ({
          id: `description-share-${principalId}`,
          resourceId: created.id,
          principalType: "user",
          principalId,
          role: principalId === viewer ? "viewer" : "editor",
          createdBy: owner,
          createdAt: new Date().toISOString(),
        })),
      );
    const denied = await viewerClient.callTool({
      name: "update-document",
      arguments: { id: created.id, description: "Denied" },
    });
    expect(denied.isError).toBe(true);
    expect((await readRow(created.id)).description).toBe("");
    const updated = await callJson(editorClient, "update-document", {
      id: created.id,
      description: longDescription,
    });
    expect(updated.description).toBe(longDescription);
    const read = await callJson(viewerClient, "get-document", {
      id: created.id,
    });
    expect(read.description).toBe(longDescription);
    expect((await readRow(created.id)).updatedBy).toBe(editor);
    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const events = await queryAuditEvents(
      { userEmail: owner },
      {
        action: "update-document",
        targetType: "document",
        targetId: created.id,
      },
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorEmail: editor,
          ownerEmail: owner,
          status: "success",
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain(longDescription);
  });
});
