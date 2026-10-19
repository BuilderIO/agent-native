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
  it("hides a new collection's sole Blocks field in its default table view", async () => {
    const created = await asOwner(() =>
      createDatabase.run({
        spaceId,
        title: "Blocks visibility",
        idempotencyKey: "blocks-visibility-database",
      }),
    );

    const primaryBlocksField = created.properties.find(
      (property) => property.definition.type === "blocks",
    );
    expect(primaryBlocksField?.definition.name).toBe("Content");
    expect(created.database.viewConfig.views[0]?.hiddenPropertyIds).toEqual([
      primaryBlocksField?.definition.id,
    ]);

    const fresh = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    expect(fresh.database.viewConfig.views[0]?.hiddenPropertyIds).toEqual([
      primaryBlocksField?.definition.id,
    ]);
    if (
      !("mutationContract" in fresh) ||
      !fresh.mutationContract ||
      !("configurationRevision" in fresh)
    ) {
      throw new Error("Expected setup revisions");
    }

    await asOwner(() =>
      updateView.run({
        operation: "update",
        target: {
          spaceId,
          databaseId: created.database.id,
          databaseDocumentId: created.database.documentId,
        },
        expectedSchemaRevision: fresh.mutationContract!.schemaRevision,
        expectedConfigurationRevision: fresh.configurationRevision,
        idempotencyKey: "show-primary-blocks-field",
        viewId: "default",
        patch: { hiddenPropertyIds: [] },
      }),
    );
    const revealed = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    expect(revealed.database.viewConfig.views[0]?.hiddenPropertyIds).toEqual(
      [],
    );
  });

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

  it("sets a list view's row layout from a preset and slot patches", async () => {
    const created = await asOwner(() =>
      createDatabase.run({
        spaceId,
        title: "List rows",
        idempotencyKey: "list-rows-database",
      }),
    );
    const target = {
      spaceId,
      databaseId: created.database.id,
      databaseDocumentId: created.database.documentId,
    };
    const revisions = async () => {
      const fresh = await asOwner(() =>
        readDatabase.run({ databaseId: created.database.id }),
      );
      if (
        !("mutationContract" in fresh) ||
        !fresh.mutationContract ||
        !("configurationRevision" in fresh)
      ) {
        throw new Error("Expected setup revisions");
      }
      return {
        expectedSchemaRevision: fresh.mutationContract.schemaRevision,
        expectedConfigurationRevision: fresh.configurationRevision,
      };
    };
    const propertyIds: Record<string, string> = {};
    for (const [name, type] of [
      ["Done", "checkbox"],
      ["Pitch", "text"],
      ["Due", "date"],
    ] as const) {
      const { expectedSchemaRevision } = await revisions();
      const result = await asOwner(() =>
        configureProperty.run({
          operation: "create",
          target,
          expectedSchemaRevision,
          idempotencyKey: `create-${name}`,
          definition: { name, type },
        }),
      );
      propertyIds[name] = result.value.id;
    }
    await getDb()
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: JSON.stringify({
          activeViewId: "ideas",
          views: [
            { id: "ideas", name: "Ideas", type: "list" },
            { id: "default", name: "Table", type: "table" },
          ],
        }),
      })
      .where(eq(schema.contentDatabases.id, created.database.id));
    const update = async (
      idempotencyKey: string,
      viewId: string,
      patch: Record<string, unknown>,
    ) =>
      asOwner(async () =>
        updateView.run({
          operation: "update",
          target,
          ...(await revisions()),
          idempotencyKey,
          viewId,
          patch,
        } as never),
      );

    const checklist = await update("checklist", "ideas", {
      itemLayoutPreset: "checklist",
    });
    expect(checklist.value.itemLayout).toEqual({
      leading: { kind: "checkbox", propertyId: propertyIds.Done },
      titleWeight: "bold",
      line2: { propertyId: propertyIds.Pitch, lines: 2 },
      line3: [],
      trailing: [],
    });

    const tweaked = await update("tweak", "ideas", {
      itemLayout: { titleWeight: "regular", trailing: [propertyIds.Due] },
    });
    expect(tweaked.value.itemLayout).toEqual({
      leading: { kind: "checkbox", propertyId: propertyIds.Done },
      titleWeight: "regular",
      line2: { propertyId: propertyIds.Pitch, lines: 2 },
      line3: [],
      trailing: [propertyIds.Due],
    });
    const listed = await asOwner(() =>
      readDatabase.run({ databaseId: created.database.id }),
    );
    expect(
      listed.database.viewConfig.views.find((view) => view.id === "ideas")
        ?.itemLayout,
    ).toEqual(tweaked.value.itemLayout);

    await expect(
      update("date-line2", "ideas", {
        itemLayout: { line2: { propertyId: propertyIds.Due } },
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_VIEW_REFERENCE" });
    await expect(
      update("list-wrap", "ideas", { wrapCells: true }),
    ).rejects.toMatchObject({ errorCode: "UNSUPPORTED_SCHEMA_CHANGE" });
    await expect(
      update("table-layout", "default", { itemLayoutPreset: "digest" }),
    ).rejects.toMatchObject({ errorCode: "UNSUPPORTED_SCHEMA_CHANGE" });

    type SavedView = Record<string, unknown> & { id: string };
    const saved = async () => {
      const read = await asOwner(() =>
        readDatabase.run({ databaseId: created.database.id }),
      );
      const viewConfig = read.database.viewConfig;
      return {
        viewConfig,
        layout: viewConfig.views.find((view) => view.id === "ideas")
          ?.itemLayout,
      };
    };
    const changeIdeas = async (change: (view: SavedView) => SavedView) => {
      const { viewConfig } = await saved();
      return {
        ...viewConfig,
        views: viewConfig.views.map((view) =>
          view.id === "ideas" ? change(view as SavedView) : view,
        ),
      };
    };
    const replace = async (
      idempotencyKey: string,
      change: (view: SavedView) => SavedView,
    ) => {
      const viewConfig = await changeIdeas(change);
      return asOwner(async () =>
        updateView.run({
          operation: "replace",
          target,
          ...(await revisions()),
          idempotencyKey,
          viewConfig,
        } as never),
      );
    };
    const legacySave = async (change: (view: SavedView) => SavedView) => {
      const viewConfig = await changeIdeas(change);
      return asOwner(() =>
        updateView.run({
          databaseId: created.database.id,
          viewConfig,
        } as never),
      );
    };
    const withoutLayout = ({ itemLayout: _layout, ...view }: SavedView) =>
      view as SavedView;

    // Saves from clients that don't know about layouts keep the saved one.
    await replace("replace-without-layout", (view) => ({
      ...withoutLayout(view),
      name: "Ideas list",
    }));
    expect((await saved()).layout).toEqual(tweaked.value.itemLayout);
    await legacySave(withoutLayout);
    expect((await saved()).layout).toEqual(tweaked.value.itemLayout);

    // Picking Default sends an explicit null, which clears the layout.
    await legacySave((view) => ({ ...view, itemLayout: null }));
    expect((await saved()).layout).toBeNull();

    await update("checklist-again", "ideas", { itemLayoutPreset: "checklist" });
    const reset = await update("reset", "ideas", { itemLayout: null });
    expect(reset.value).toHaveProperty("itemLayout", null);

    await update("checklist-third", "ideas", { itemLayoutPreset: "checklist" });
    expect((await saved()).layout).toEqual(checklist.value.itemLayout);
    await replace("replace-default", (view) => ({ ...view, itemLayout: null }));
    expect((await saved()).layout).toBeNull();

    // A deleted property in a saved slot doesn't block unrelated edits.
    await update("due-at-end", "ideas", {
      itemLayoutPreset: "checklist",
      itemLayout: { trailing: [propertyIds.Due] },
    });
    await getDb()
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyIds.Due));
    const afterDelete = await update("after-delete", "ideas", {
      itemLayout: { titleWeight: "regular" },
    });
    expect(afterDelete.value.itemLayout).toMatchObject({
      titleWeight: "regular",
      trailing: [],
    });

    // Always-hidden properties can't be put in a slot, and full saves drop
    // them along with references to properties that no longer exist.
    await asOwner(async () =>
      configureProperty.run({
        operation: "update",
        target,
        expectedSchemaRevision: (await revisions()).expectedSchemaRevision,
        idempotencyKey: "hide-pitch",
        propertyId: propertyIds.Pitch,
        patch: { visibility: "always_hide" },
      }),
    );
    await expect(
      update("hidden-line2", "ideas", {
        itemLayout: { line2: { propertyId: propertyIds.Pitch } },
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_VIEW_REFERENCE" });
    const withStaleSlots = (view: SavedView) => ({
      ...view,
      itemLayout: {
        ...checklist.value.itemLayout,
        line3: [propertyIds.Pitch, "deleted-property"],
      },
    });
    const showable = {
      ...checklist.value.itemLayout,
      line2: { propertyId: null, lines: 2 },
      line3: [],
    };
    await legacySave(withStaleSlots);
    expect((await saved()).layout).toEqual(showable);
    await replace("replace-stale", withStaleSlots);
    expect((await saved()).layout).toEqual(showable);
  });
});
