import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadActionsFromStaticRegistry,
  runFrameworkReleaseMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  `content-setup-mcp-${process.pid}-${Date.now()}.pglite`,
);
const databaseUrl =
  process.env.CONTENT_SETUP_POSTGRES_URL ?? `pglite:${databasePath}`;
const owner = "mcp-setup-owner@example.com";
const outsider = "mcp-setup-outsider@example.com";
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
  const client = new Client({
    name: "content-database-setup-test",
    version: "1.0.0",
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  sessions.push({ client, server });
  return client;
}

type ProtocolResult = Awaited<ReturnType<MCPClient["callTool"]>>;

function resultText(result: ProtocolResult): string {
  return (
    result.content.find(
      (
        entry,
      ): entry is Extract<(typeof result.content)[number], { type: "text" }> =>
        entry.type === "text",
    )?.text ?? ""
  );
}

async function callJson<T extends Record<string, unknown>>(
  client: MCPClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, resultText(result)).not.toBe(true);
  if (
    result.structuredContent &&
    typeof result.structuredContent === "object"
  ) {
    return result.structuredContent as T;
  }
  return JSON.parse(resultText(result)) as T;
}

async function callError(
  client: MCPClient,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  return resultText(result);
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
  await runWithRequestContext({ userEmail: owner }, () =>
    provisionContentSpaces(getDb(), owner),
  );
  await runWithRequestContext({ userEmail: outsider }, () =>
    provisionContentSpaces(getDb(), outsider),
  );
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

describe("ordinary database setup through external MCP", () => {
  it("discovers and invokes the authenticated setup, row, read-back, replay, denial, and cleanup story", async () => {
    const listed = await ownerClient.listTools();
    const toolByName = new Map(listed.tools.map((tool) => [tool.name, tool]));
    const requiredTools = [
      "list-content-spaces",
      "create-content-database",
      "configure-document-property",
      "update-content-database-view",
      "describe-content-database",
      "get-content-database",
      "get-content-database-source",
      "add-database-item",
      "update-database-item",
      "upsert-database-item-by-key",
      "delete-content-database",
      "restore-content-database",
      "list-trashed-content-databases",
    ];
    expect([...toolByName.keys()]).toEqual(
      expect.arrayContaining(requiredTools),
    );
    expect([...toolByName.keys()]).not.toEqual(
      expect.arrayContaining([
        "attach-content-database-source",
        "bind-content-database-source-field",
        "change-content-database-source-role",
        "add-content-database-source-field-property",
      ]),
    );

    for (const name of requiredTools) {
      expect(toolByName.get(name)?.inputSchema.type, name).toBe("object");
    }
    const propertySchema = JSON.stringify(
      toolByName.get("configure-document-property")?.inputSchema,
    );
    expect(propertySchema).toContain("expectedSchemaRevision");
    expect(propertySchema).toContain("databaseDocumentId");
    expect(propertySchema).not.toContain("authorityScope");
    expect(propertySchema).not.toContain("sourceId");
    const viewSchema = JSON.stringify(
      toolByName.get("update-content-database-view")?.inputSchema,
    );
    expect(viewSchema).toContain("expectedConfigurationRevision");
    expect(viewSchema).toContain("frozenThroughColumnId");
    expect(viewSchema).not.toContain("activeViewId");
    const sourceSchema = JSON.stringify(
      toolByName.get("get-content-database-source")?.inputSchema,
    );
    expect(sourceSchema).toContain('\"statusOnly\"');
    expect(sourceSchema).toContain('\"const\":true');

    const spaces = await callJson<{
      spaces: Array<{
        id: string;
        canCreateDatabase: boolean;
      }>;
    }>(ownerClient, "list-content-spaces", {});
    const space = spaces.spaces.find(
      (candidate) => candidate.canCreateDatabase,
    );
    expect(space).toBeDefined();

    const createInput = {
      spaceId: space!.id,
      title: "MCP-DB-QA-protocol Campaign tracker",
      description: "Protocol integration fixture",
      idempotencyKey: "mcp-create-campaign-tracker",
    };
    const created = await callJson<any>(
      ownerClient,
      "create-content-database",
      createInput,
    );
    const replayedCreate = await callJson<any>(
      ownerClient,
      "create-content-database",
      createInput,
    );
    expect(replayedCreate.database.id).toBe(created.database.id);
    expect(replayedCreate.receipt.receiptId).toBe(created.receipt.receiptId);
    expect(replayedCreate.receipt.idempotency.result).toBe("replayed");
    expect(created.receipt.readback).toEqual({ verified: true });

    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const createAuditEvents = await queryAuditEvents(
      { userEmail: owner },
      {
        action: "create-content-database",
        targetType: "content-database",
        targetId: created.database.id,
      },
    );
    expect(createAuditEvents).toHaveLength(2);
    const appliedAudit = createAuditEvents.find((event) =>
      event.summary?.startsWith("create-content-database;"),
    );
    const replayAudit = createAuditEvents.find((event) =>
      event.summary?.startsWith("Verified earlier operation;"),
    );
    expect(appliedAudit?.summary).toContain(
      `receipt ${created.receipt.receiptId}`,
    );
    expect(appliedAudit?.summary).toContain(
      `schema ${created.receipt.revisions.schemaBefore ?? "none"} -> ${created.receipt.revisions.schemaAfter}`,
    );
    expect(appliedAudit?.summary).toContain(
      `configuration ${created.receipt.revisions.configurationBefore ?? "none"} -> ${created.receipt.revisions.configurationAfter}`,
    );
    expect(replayAudit?.summary).toContain(
      `Verified earlier operation; receipt ${created.receipt.receiptId}`,
    );
    for (const event of createAuditEvents) {
      expect(event.input).toBeNull();
      expect(event.summary).not.toContain(createInput.title);
      expect(event.summary).not.toContain(createInput.description);
      expect(event.summary).not.toContain(createInput.idempotencyKey);
    }

    const target = {
      spaceId: space!.id,
      databaseId: created.database.id as string,
      databaseDocumentId: created.database.documentId as string,
    };
    const denied = await callError(outsiderClient, "delete-content-database", {
      target,
      expectedConfigurationRevision:
        created.receipt.revisions.configurationAfter,
      idempotencyKey: "outsider-delete",
    });
    expect(denied).not.toContain(created.receipt.receiptId);

    const described = await callJson<any>(
      ownerClient,
      "describe-content-database",
      { databaseId: target.databaseId },
    );
    expect(described.database).toMatchObject({
      id: target.databaseId,
      documentId: target.databaseDocumentId,
      spaceId: target.spaceId,
      title: createInput.title,
    });

    const rejectedLegacyCreate = await callError(
      ownerClient,
      "create-content-database",
      {
        documentId: target.databaseDocumentId,
        title: "Legacy create shape",
      },
    );
    expect(rejectedLegacyCreate).toMatch(/invalid|required|unrecognized/i);
    const rejectedSourceOverride = await callError(
      ownerClient,
      "create-content-database",
      {
        spaceId: target.spaceId,
        title: "Source override",
        idempotencyKey: "reject-create-source-override",
        sourceId: "source-not-allowed",
      },
    );
    expect(rejectedSourceOverride).toMatch(/invalid|unrecognized/i);
    const afterRejectedCreates = await callJson<any>(
      ownerClient,
      "describe-content-database",
      { databaseId: target.databaseId },
    );
    expect(afterRejectedCreates.database).toMatchObject({
      id: target.databaseId,
      documentId: target.databaseDocumentId,
      title: createInput.title,
    });

    const rejectedLegacyProperty = await callError(
      ownerClient,
      "configure-document-property",
      {
        documentId: target.databaseDocumentId,
        name: "Legacy property",
        type: "text",
      },
    );
    expect(rejectedLegacyProperty).toMatch(/invalid|required|unrecognized/i);

    const rejectedProperty = await callError(
      ownerClient,
      "configure-document-property",
      {
        target,
        expectedSchemaRevision: described.mutationContract.schemaRevision,
        idempotencyKey: "reject-source-shaped-property",
        operation: "create",
        definition: {
          name: "Managed status",
          type: "status",
          sourceId: "source-not-allowed",
        },
      },
    );
    expect(rejectedProperty).toMatch(/invalid|expected/i);

    const campaignKey = await callJson<any>(
      ownerClient,
      "configure-document-property",
      {
        target,
        expectedSchemaRevision: described.mutationContract.schemaRevision,
        idempotencyKey: "create-campaign-key",
        operation: "create",
        definition: {
          name: "Campaign key",
          type: "text",
          naturalKey: true,
        },
      },
    );
    const status = await callJson<any>(
      ownerClient,
      "configure-document-property",
      {
        target,
        expectedSchemaRevision: campaignKey.receipt.revisions.schemaAfter,
        idempotencyKey: "create-status",
        operation: "create",
        definition: {
          name: "Status",
          type: "status",
          options: [
            { id: "status-draft", name: "Draft", color: "gray" },
            { id: "status-ready", name: "Ready", color: "green" },
          ],
        },
      },
    );
    expect(
      status.value.options.options.map((option: any) => option.id),
    ).toEqual(["status-draft", "status-ready"]);

    const publishDateInput = {
      target,
      expectedSchemaRevision: status.receipt.revisions.schemaAfter,
      idempotencyKey: "create-publish-date-concurrently",
      operation: "create",
      definition: { name: "Publish date", type: "date" },
    };
    const concurrentProperties = await Promise.all([
      callJson<any>(
        ownerClient,
        "configure-document-property",
        publishDateInput,
      ),
      callJson<any>(
        secondOwnerClient,
        "configure-document-property",
        publishDateInput,
      ),
    ]);
    expect(concurrentProperties[0].value.id).toBe(
      concurrentProperties[1].value.id,
    );
    expect(
      concurrentProperties
        .map((result) => result.receipt.idempotency.result)
        .sort(),
    ).toEqual(["applied", "replayed"]);
    const staleProperty = await callError(
      secondOwnerClient,
      "configure-document-property",
      {
        target,
        expectedSchemaRevision: status.receipt.revisions.schemaAfter,
        idempotencyKey: "reject-stale-schema-intent",
        operation: "create",
        definition: { name: "Stale schema", type: "text" },
      },
    );
    expect(staleProperty).toContain("schema changed");

    const beforeView = await callJson<any>(
      ownerClient,
      "get-content-database",
      { databaseId: target.databaseId, limit: 100, offset: 0 },
    );
    const rejectedLegacyViewReplacement = await callError(
      ownerClient,
      "update-content-database-view",
      {
        databaseId: target.databaseId,
        viewConfig: JSON.parse(
          JSON.stringify(beforeView.database.viewConfig),
        ) as Record<string, unknown>,
      },
    );
    expect(rejectedLegacyViewReplacement).toMatch(
      /invalid|required|unrecognized/i,
    );
    const viewInput = {
      target,
      expectedSchemaRevision: beforeView.mutationContract.schemaRevision,
      expectedConfigurationRevision: beforeView.configurationRevision,
      idempotencyKey: "create-ready-drafts-view-concurrently",
      operation: "create",
      view: {
        name: "Ready drafts",
        type: "table",
        config: {
          propertyOrderIds: [campaignKey.value.id, status.value.id],
          tableColumnOrderIds: ["name", campaignKey.value.id, status.value.id],
          filters: [
            {
              key: status.value.id,
              label: "Status",
              operator: "contains",
              value: "status-ready",
            },
          ],
          rowDensity: "compact",
          openPagesIn: "preview",
        },
      },
    };
    const concurrentViews = await Promise.all([
      callJson<any>(ownerClient, "update-content-database-view", viewInput),
      callJson<any>(
        secondOwnerClient,
        "update-content-database-view",
        viewInput,
      ),
    ]);
    expect(concurrentViews[0].value.id).toBe(concurrentViews[1].value.id);
    expect(
      concurrentViews.map((result) => result.receipt.idempotency.result).sort(),
    ).toEqual(["applied", "replayed"]);
    const view = concurrentViews[0];
    const staleView = await callError(
      secondOwnerClient,
      "update-content-database-view",
      {
        target,
        expectedSchemaRevision: beforeView.mutationContract.schemaRevision,
        expectedConfigurationRevision: beforeView.configurationRevision,
        idempotencyKey: "reject-stale-view-intent",
        operation: "update",
        viewId: view.value.id,
        patch: { wrapCells: true },
      },
    );
    expect(staleView).toContain("configuration changed");
    expect(view.receipt.viewId).toBe(view.value.id);
    expect(view.receipt.url).toContain(`viewId=${view.value.id}`);

    const shareId = "mcp-setup-collaborator-share";
    await getDb().insert(schema.documentShares).values({
      id: shareId,
      resourceId: target.databaseDocumentId,
      principalType: "user",
      principalId: outsider,
      role: "editor",
      createdBy: owner,
      createdAt: new Date().toISOString(),
    });
    const beforeCollaboratorMutation = await callJson<any>(
      outsiderClient,
      "get-content-database",
      { databaseId: target.databaseId, limit: 100, offset: 0 },
    );
    const collaboratorInput = {
      target,
      expectedSchemaRevision:
        beforeCollaboratorMutation.mutationContract.schemaRevision,
      idempotencyKey: "collaborator-replay-after-revocation",
      operation: "create",
      definition: { name: "Collaborator note", type: "text" },
    };
    const collaboratorMutation = await callJson<any>(
      outsiderClient,
      "configure-document-property",
      collaboratorInput,
    );
    const collaboratorReplay = await callJson<any>(
      outsiderClient,
      "configure-document-property",
      collaboratorInput,
    );
    expect(collaboratorReplay.receipt.receiptId).toBe(
      collaboratorMutation.receipt.receiptId,
    );
    expect(collaboratorReplay.receipt.idempotency.result).toBe("replayed");
    await getDb()
      .update(schema.documentShares)
      .set({ role: "viewer" })
      .where(eq(schema.documentShares.id, shareId));
    const viewerReplay = await callError(
      outsiderClient,
      "configure-document-property",
      collaboratorInput,
    );
    expect(viewerReplay).not.toContain(collaboratorMutation.receipt.receiptId);
    await getDb()
      .delete(schema.documentShares)
      .where(
        and(
          eq(schema.documentShares.id, shareId),
          eq(schema.documentShares.principalId, outsider),
        ),
      );
    const revokedReplay = await callError(
      outsiderClient,
      "configure-document-property",
      collaboratorInput,
    );
    expect(revokedReplay).not.toContain(collaboratorMutation.receipt.receiptId);

    const sourceStatus = await callJson<any>(
      ownerClient,
      "get-content-database-source",
      { databaseId: target.databaseId, statusOnly: true },
    );
    expect(sourceStatus).toMatchObject({
      database: { id: target.databaseId },
      mode: "local",
      source: null,
    });
    expect(sourceStatus).not.toHaveProperty("rows");
    expect(sourceStatus).not.toHaveProperty("changeSets");

    const beforeRow = await callJson<any>(ownerClient, "get-content-database", {
      databaseId: target.databaseId,
      limit: 100,
      offset: 0,
    });
    expect(beforeRow.mutationContract.target).toMatchObject(target);
    expect(beforeRow.items).toHaveLength(0);

    const addInput = {
      target,
      expectedSchemaRevision: beforeRow.mutationContract.schemaRevision,
      idempotencyKey: "create-campaign-row",
      title: "September launch",
      propertyEntries: [
        {
          propertyId: campaignKey.value.id,
          propertyType: "text",
          value: "launch-2026-09",
        },
        {
          propertyId: status.value.id,
          propertyType: "status",
          value: "status-draft",
        },
      ],
    };
    const rejectedLegacyAdd = await callError(
      ownerClient,
      "add-database-item",
      {
        ...addInput,
        idempotencyKey: "reject-legacy-add-property-values",
        propertyValues: {
          [campaignKey.value.id]: "legacy-campaign-key",
        },
      },
    );
    expect(rejectedLegacyAdd).toMatch(/invalid|unrecognized/i);
    const added = await callJson<any>(
      ownerClient,
      "add-database-item",
      addInput,
    );
    const replayedAdd = await callJson<any>(
      ownerClient,
      "add-database-item",
      addInput,
    );
    expect(replayedAdd.receipt.row).toEqual(added.receipt.row);
    expect(replayedAdd.receipt.idempotency.result).toBe("replayed");
    expect(added.receipt.row.urlPath).toContain(
      `databaseId=${target.databaseId}`,
    );
    expect(added.receipt.row.urlPath).toContain(
      `databaseDocumentId=${target.databaseDocumentId}`,
    );

    const addedRead = await callJson<any>(ownerClient, "get-content-database", {
      databaseId: target.databaseId,
      limit: 100,
      offset: 0,
    });
    const addedItem = addedRead.items.find(
      (item: any) => item.id === added.receipt.row.itemId,
    );
    expect(addedItem.document.id).toBe(added.receipt.row.documentId);
    expect(addedItem.rowRevision).toBe(added.receipt.row.rowRevision);

    const rejectedLegacyUpdate = await callError(
      ownerClient,
      "update-database-item",
      {
        target,
        expectedSchemaRevision: addedRead.mutationContract.schemaRevision,
        expectedRowRevision: addedItem.rowRevision,
        idempotencyKey: "reject-legacy-update-property-values",
        itemId: addedItem.id,
        documentId: addedItem.document.id,
        propertyEntries: [
          {
            propertyId: status.value.id,
            propertyType: "status",
            value: "status-ready",
          },
        ],
        propertyValues: { [status.value.id]: "status-ready" },
      },
    );
    expect(rejectedLegacyUpdate).toMatch(/invalid|unrecognized/i);
    const rejectedLegacyUpsert = await callError(
      ownerClient,
      "upsert-database-item-by-key",
      {
        target,
        expectedSchemaRevision: addedRead.mutationContract.schemaRevision,
        expectedRowRevision: addedItem.rowRevision,
        idempotencyKey: "reject-legacy-upsert-property-values",
        keyValue: "launch-2026-09",
        propertyEntries: [
          {
            propertyId: status.value.id,
            propertyType: "status",
            value: "status-ready",
          },
        ],
        propertyValues: { [status.value.id]: "status-ready" },
      },
    );
    expect(rejectedLegacyUpsert).toMatch(/invalid|unrecognized/i);

    const updated = await callJson<any>(ownerClient, "update-database-item", {
      target,
      expectedSchemaRevision: addedRead.mutationContract.schemaRevision,
      expectedRowRevision: addedItem.rowRevision,
      idempotencyKey: "ready-campaign-row",
      itemId: addedItem.id,
      documentId: addedItem.document.id,
      propertyEntries: [
        {
          propertyId: status.value.id,
          propertyType: "status",
          value: "status-ready",
        },
      ],
    });
    expect(updated.receipt.row.itemId).toBe(added.receipt.row.itemId);
    expect(updated.receipt.row.documentId).toBe(added.receipt.row.documentId);

    const sourceId = "mcp-setup-source";
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.contentDatabaseSources)
      .values({
        id: sourceId,
        ownerEmail: owner,
        databaseId: target.databaseId,
        sourceType: "mock-local",
        sourceName: "Protocol source",
        sourceTable: "campaigns",
        capabilitiesJson: JSON.stringify({ canRefresh: true }),
        metadataJson: JSON.stringify({
          primaryKey: "id",
          connectionId: "private-connection-metadata",
          notes: "private-source-notes",
        }),
        lastError: "private provider failure detail",
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .insert(schema.contentDatabaseSourceRows)
      .values({
        id: "mcp-setup-source-row",
        ownerEmail: owner,
        sourceId,
        databaseItemId: added.receipt.row.itemId,
        documentId: added.receipt.row.documentId,
        sourceRowId: "provider-row-1",
        sourceQualifiedId: "campaigns:provider-row-1",
        sourceDisplayKey: "September launch",
        sourceValuesJson: JSON.stringify({
          internalPayload: "must be omitted",
        }),
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .insert(schema.contentDatabaseSourceChangeSets)
      .values({
        id: "mcp-setup-source-change",
        ownerEmail: owner,
        sourceId,
        databaseItemId: added.receipt.row.itemId,
        documentId: added.receipt.row.documentId,
        summary: "Private change-set detail",
        fieldChangesJson: JSON.stringify([
          { propertyId: status.value.id, proposedValue: "status-ready" },
        ]),
        createdAt: now,
        updatedAt: now,
      });
    const sourceBackedStatus = await callJson<any>(
      ownerClient,
      "get-content-database-source",
      { databaseId: target.databaseId },
    );
    expect(sourceBackedStatus).toMatchObject({
      database: { id: target.databaseId },
      mode: "source-backed",
      source: {
        id: sourceId,
        rows: [],
        changeSets: [],
        projection: { rows: "omitted", changeSets: "omitted" },
        lastError: "Source reports an error; inspect its settings in Content.",
      },
    });
    expect(sourceBackedStatus.source.metadata).not.toHaveProperty(
      "connectionId",
    );
    expect(sourceBackedStatus.source.metadata).not.toHaveProperty("notes");

    const outsiderSpaces = await callJson<{
      spaces: Array<{ id: string; canCreateDatabase: boolean }>;
    }>(outsiderClient, "list-content-spaces", {});
    const outsiderSpace = outsiderSpaces.spaces.find(
      (candidate) => candidate.canCreateDatabase,
    );
    expect(outsiderSpace).toBeDefined();
    const inaccessibleSourceTitle = "Private source target";
    const inaccessibleSource = await callJson<any>(
      outsiderClient,
      "create-content-database",
      {
        spaceId: outsiderSpace!.id,
        title: inaccessibleSourceTitle,
        idempotencyKey: "create-inaccessible-source-target",
      },
    );
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({
        sourceType: "local-table",
        sourceTable: inaccessibleSource.database.id,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.contentDatabaseSources.id, sourceId));
    const inaccessibleSourceError = await callError(
      ownerClient,
      "get-content-database-source",
      { databaseId: target.databaseId, statusOnly: true },
    );
    expect(inaccessibleSourceError).toContain("SOURCE_UNAVAILABLE");
    expect(inaccessibleSourceError).not.toContain(
      inaccessibleSource.database.id,
    );
    expect(inaccessibleSourceError).not.toContain(inaccessibleSourceTitle);
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({
        sourceType: "mock-local",
        sourceTable: "campaigns",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.contentDatabaseSources.id, sourceId));

    const filteredRead = await callJson<any>(
      ownerClient,
      "get-content-database",
      {
        databaseId: target.databaseId,
        limit: 100,
        offset: 0,
        tableQuery: {
          search: "",
          filters: [
            {
              key: status.value.id,
              label: "Status",
              operator: "contains",
              value: "status-ready",
            },
          ],
          sorts: [],
          filterMode: "and",
        },
      },
    );
    expect(filteredRead.items.map((item: any) => item.id)).toEqual([
      added.receipt.row.itemId,
    ]);

    const rejectedLegacyDelete = await callError(
      ownerClient,
      "delete-content-database",
      { databaseId: target.databaseId },
    );
    expect(rejectedLegacyDelete).toMatch(/invalid|required/i);
    const afterRejectedDelete = await callJson<any>(
      ownerClient,
      "get-content-database",
      { databaseId: target.databaseId, limit: 100, offset: 0 },
    );
    expect(afterRejectedDelete.available).not.toBe(false);

    const trashed = await callJson<any>(
      ownerClient,
      "delete-content-database",
      {
        target,
        expectedConfigurationRevision: filteredRead.configurationRevision,
        idempotencyKey: "trash-campaign-tracker",
      },
    );
    expect(trashed.receipt.outcome).toBe("trashed");
    const trashRead = await callJson<any>(
      ownerClient,
      "list-trashed-content-databases",
      {},
    );
    expect(
      trashRead.databases.filter(
        (database: any) => database.databaseId === target.databaseId,
      ),
    ).toHaveLength(1);

    const rejectedLegacyRestore = await callError(
      ownerClient,
      "restore-content-database",
      { databaseId: target.databaseId },
    );
    expect(rejectedLegacyRestore).toMatch(/invalid|required/i);
    const trashAfterRejectedRestore = await callJson<any>(
      ownerClient,
      "list-trashed-content-databases",
      {},
    );
    expect(
      trashAfterRejectedRestore.databases.filter(
        (database: any) => database.databaseId === target.databaseId,
      ),
    ).toHaveLength(1);

    const restored = await callJson<any>(
      ownerClient,
      "restore-content-database",
      {
        target,
        expectedConfigurationRevision:
          trashed.receipt.revisions.configurationAfter,
        idempotencyKey: "restore-campaign-tracker",
      },
    );
    expect(restored.receipt.outcome).toBe("restored");
    const restoredRead = await callJson<any>(
      ownerClient,
      "get-content-database",
      { databaseId: target.databaseId, limit: 100, offset: 0 },
    );
    expect(restoredRead.items[0]).toMatchObject({
      id: added.receipt.row.itemId,
      document: { id: added.receipt.row.documentId },
    });
    expect(
      restoredRead.database.viewConfig.views.some(
        (candidate: any) => candidate.id === view.value.id,
      ),
    ).toBe(true);

    await callJson<any>(ownerClient, "delete-content-database", {
      target,
      expectedConfigurationRevision: restoredRead.configurationRevision,
      idempotencyKey: "trash-campaign-tracker-final",
    });
    const unavailable = await callJson<any>(
      ownerClient,
      "get-content-database",
      { databaseId: target.databaseId, limit: 100, offset: 0 },
    );
    expect(unavailable).toMatchObject({
      available: false,
      databaseId: target.databaseId,
    });
  }, 90_000);
});
