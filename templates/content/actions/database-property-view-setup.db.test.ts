import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const path = join(
  tmpdir(),
  `content-property-view-setup-${process.pid}-${Date.now()}.pglite`,
);
const owner = `property-view-owner-${Date.now()}@example.com`;
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let updateView: typeof import("./update-content-database-view.js").default;
let readDatabase: typeof import("./get-content-database.js").default;
let listSpaces: typeof import("./list-content-spaces.js").default;
let spaceId: string;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${path}`;
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  createDatabase = (await import("./create-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  updateView = (await import("./update-content-database-view.js")).default;
  readDatabase = (await import("./get-content-database.js")).default;
  listSpaces = (await import("./list-content-spaces.js")).default;
  await asOwner(() =>
    import("./_content-spaces.js").then((module) =>
      module.provisionContentSpaces(getDb(), owner),
    ),
  );
  const spaces = await asOwner(() => listSpaces.run({}));
  spaceId = spaces.spaces[0]!.id;
}, 120_000);

afterAll(() => rmSync(path, { recursive: true, force: true }));

describe("ordinary property and table-view setup", () => {
  it("creates and safely edits an ordinary property with stable option identity", async () => {
    const created = await asOwner(() =>
      createDatabase.run({
        spaceId,
        title: "Property setup",
        idempotencyKey: "property-database",
      }),
    );
    const initial = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    if (!("mutationContract" in initial) || !initial.mutationContract) {
      throw new Error("Expected a database mutation contract");
    }
    const target = {
      spaceId,
      databaseId: created.database.id,
      databaseDocumentId: created.database.documentId,
    };
    const property = await asOwner(() =>
      configureProperty.run({
        operation: "create",
        target,
        expectedSchemaRevision: initial.mutationContract!.schemaRevision,
        idempotencyKey: "create-status",
        definition: {
          name: "Status",
          type: "status",
          options: [
            { id: "draft", name: "Draft", color: "gray" },
            { id: "ready", name: "Ready", color: "green" },
          ],
        },
      }),
    );
    expect(property.receipt).toMatchObject({
      outcome: "created",
      propertyId: property.value.id,
      readback: { verified: true },
    });
    expect(
      (
        await asOwner(() =>
          configureProperty.run({
            operation: "create",
            target,
            expectedSchemaRevision: initial.mutationContract!.schemaRevision,
            idempotencyKey: "create-status",
            definition: {
              name: "Status",
              type: "status",
              options: [
                { id: "draft", name: "Draft", color: "gray" },
                { id: "ready", name: "Ready", color: "green" },
              ],
            },
          }),
        )
      ).receipt.idempotency.result,
    ).toBe("replayed");

    const fresh = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    if (!("mutationContract" in fresh) || !fresh.mutationContract) {
      throw new Error("Expected a fresh database mutation contract");
    }
    const updated = await asOwner(() =>
      configureProperty.run({
        operation: "update",
        target,
        expectedSchemaRevision: fresh.mutationContract!.schemaRevision,
        idempotencyKey: "rename-status",
        propertyId: property.value.id,
        patch: {
          name: "Stage",
          optionEdits: [
            {
              operation: "update",
              optionId: "ready",
              patch: { name: "Approved" },
            },
            { operation: "reorder", optionIds: ["ready", "draft"] },
          ],
        },
      }),
    );
    expect(updated.value).toMatchObject({
      id: property.value.id,
      name: "Stage",
      options: {
        options: [
          { id: "ready", name: "Approved" },
          { id: "draft", name: "Draft" },
        ],
      },
    });
    await expect(
      asOwner(() =>
        configureProperty.run({
          operation: "update",
          target,
          expectedSchemaRevision: initial.mutationContract!.schemaRevision,
          idempotencyKey: "stale-property",
          propertyId: property.value.id,
          patch: { name: "Overwritten" },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "SCHEMA_REVISION_CONFLICT" });
  });

  it("creates and sparsely updates a table view without widening invalid filters", async () => {
    const created = await asOwner(() =>
      createDatabase.run({
        spaceId,
        title: "View setup",
        idempotencyKey: "view-database",
      }),
    );
    await getDb()
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: JSON.stringify({
          activeViewId: "default",
          views: [
            {
              id: "default",
              name: "Table",
              type: "table",
              sorts: [],
              filters: [],
              columnWidths: {},
              futureSetting: { preserved: true },
            },
          ],
          futureTopLevel: "preserved",
        }),
      })
      .where(eq(schema.contentDatabases.id, created.database.id));
    const initial = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    if (
      !("mutationContract" in initial) ||
      !initial.mutationContract ||
      !("configurationRevision" in initial)
    ) {
      throw new Error("Expected setup revisions");
    }
    const target = {
      spaceId,
      databaseId: created.database.id,
      databaseDocumentId: created.database.documentId,
    };
    const view = await asOwner(() =>
      updateView.run({
        operation: "create",
        target,
        expectedSchemaRevision: initial.mutationContract!.schemaRevision,
        expectedConfigurationRevision: initial.configurationRevision,
        idempotencyKey: "create-ready-view",
        view: {
          name: "Ready drafts",
          type: "table",
          config: { rowDensity: "compact", tableColumnOrderIds: ["name"] },
        },
      }),
    );
    expect(view.receipt).toMatchObject({
      outcome: "created",
      viewId: view.value.id,
      readback: { verified: true },
    });
    const rawAfterCreate = await getDb()
      .select({ value: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, created.database.id));
    expect(JSON.parse(rawAfterCreate[0]!.value!)).toMatchObject({
      futureTopLevel: "preserved",
      views: expect.arrayContaining([
        expect.objectContaining({ futureSetting: { preserved: true } }),
      ]),
    });

    const fresh = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    if (
      !("mutationContract" in fresh) ||
      !fresh.mutationContract ||
      !("configurationRevision" in fresh)
    ) {
      throw new Error("Expected fresh setup revisions");
    }
    const updated = await asOwner(() =>
      updateView.run({
        operation: "update",
        target,
        expectedSchemaRevision: fresh.mutationContract!.schemaRevision,
        expectedConfigurationRevision: fresh.configurationRevision,
        idempotencyKey: "update-ready-view",
        viewId: view.value.id,
        patch: { wrapCells: true },
      }),
    );
    expect(updated.value).toMatchObject({
      id: view.value.id,
      name: "Ready drafts",
      rowDensity: "compact",
      wrapCells: true,
    });

    const latest = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    if (
      !("mutationContract" in latest) ||
      !latest.mutationContract ||
      !("configurationRevision" in latest)
    ) {
      throw new Error("Expected latest setup revisions");
    }
    await expect(
      asOwner(() =>
        updateView.run({
          operation: "update",
          target,
          expectedSchemaRevision: latest.mutationContract!.schemaRevision,
          expectedConfigurationRevision: latest.configurationRevision,
          idempotencyKey: "invalid-filter",
          viewId: view.value.id,
          patch: {
            filters: [
              {
                key: "missing-property",
                label: "Missing",
                operator: "equals",
                value: "anything",
              },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "INVALID_VIEW_REFERENCE" });
    const afterInvalid = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    expect(
      "configurationRevision" in afterInvalid
        ? afterInvalid.configurationRevision
        : null,
    ).toBe(latest.configurationRevision);
  });
});
