import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { COLUMN_RULE_FROZEN } from "../shared/column-rules.js";
import { parsePropertyOptions } from "../shared/properties.js";

const beforePageRowsLock = vi.hoisted(() => ({
  run: null as null | ((tx: unknown) => Promise<unknown>),
}));

vi.mock("./_row-lock-order.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_row-lock-order.js")>();
  return {
    ...actual,
    lockDocumentRows: async (
      ...args: Parameters<typeof actual.lockDocumentRows>
    ) => {
      const run = beforePageRowsLock.run;
      beforePageRowsLock.run = null;
      await run?.(args[0]);
      return actual.lockDocumentRows(...args);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-column-rules-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const COLLEAGUE = "colleague@example.com";

const person = { caller: "frontend" as const, userEmail: OWNER };
const agent = { caller: "mcp" as const, userEmail: OWNER };
const ownAgent = { caller: "tool" as const, userEmail: OWNER };
const frozen = { errorCode: COLUMN_RULE_FROZEN, statusCode: 403 };
const inUse = { errorCode: "COLUMN_RULE_IN_USE", statusCode: 409 };
const invalid = { errorCode: "INVALID_COLUMN_RULE", statusCode: 400 };

const STATUS_OPTIONS = [
  { id: "draft", name: "Draft", color: "gray" },
  { id: "approved", name: "Approved", color: "green" },
  { id: "published", name: "Published", color: "blue" },
];

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/index.js").schema;
let setRule: typeof import("./set-blocks-field-freeze-rule.js").default;
let createDatabase: typeof import("./create-content-database.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let deleteProperty: typeof import("./delete-document-property.js").default;
let listProperties: typeof import("./list-document-properties.js").default;
let upsertRow: typeof import("./upsert-database-item-by-key.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let listBlocks: typeof import("./list-content-database-blocks.js").default;
let mutateBlock: typeof import("./mutate-content-database-block.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER, orgId: null }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  setRule = (await import("./set-blocks-field-freeze-rule.js")).default;
  createDatabase = (await import("./create-content-database.js")).default;
  getDatabase = (await import("./get-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  deleteProperty = (await import("./delete-document-property.js")).default;
  listProperties = (await import("./list-document-properties.js")).default;
  upsertRow = (await import("./upsert-database-item-by-key.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  listBlocks = (await import("./list-content-database-blocks.js")).default;
  mutateBlock = (await import("./mutate-content-database-block.js")).default;
  ({ getDb, schema } = await import("../server/db/index.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let sequence = 0;

async function addProperty(
  collection: { databaseId: string; databaseDocumentId: string },
  name: string,
  type: "text" | "status" | "blocks",
  extra: { options?: unknown; naturalKey?: boolean } = {},
) {
  const configured = (await configureProperty.run(
    {
      documentId: collection.databaseDocumentId,
      databaseId: collection.databaseId,
      name,
      type,
      ...extra,
    } as never,
    person,
  )) as { properties: Array<{ definition: { id: string; name: string } }> };
  const property = configured.properties.find(
    (candidate) => candidate.definition.name === name,
  );
  if (!property) throw new Error(`Property ${name} was not created.`);
  return property.definition.id;
}

async function contract(databaseId: string) {
  const response = await getDatabase.run({ databaseId }, person);
  if (!("database" in response) || !response.mutationContract)
    throw new Error("Fixture database has no mutation contract.");
  return response.mutationContract;
}

/** A collection with Status, a Spec tab and a Notes tab, and one row. */
async function specRow() {
  sequence += 1;
  const created = await createDatabase.run(
    { title: `Specs ${sequence}` },
    person,
  );
  const collection = {
    databaseId: created.database.id,
    databaseDocumentId: created.database.documentId,
  };
  const statusId = await addProperty(collection, "Status", "status", {
    options: { options: STATUS_OPTIONS },
  });
  const specId = await addProperty(collection, "Spec", "blocks");
  const notesId = await addProperty(collection, "Notes", "blocks");
  await addProperty(collection, "Key", "text", { naturalKey: true });
  const first = await contract(collection.databaseId);
  const bodyId = first.properties.find(
    (property) =>
      property.type === "blocks" &&
      property.id !== specId &&
      property.id !== notesId,
  )?.id;
  const row = await upsertRow.run(
    {
      target: first.target,
      expectedSchemaRevision: first.schemaRevision,
      idempotencyKey: `row-${collection.databaseId}`,
      keyValue: "row-key",
      expectedRowRevision: null,
      title: "A spec",
    },
    person,
  );
  const documentId = row.receipt.row.documentId;
  await setProperty.run(
    {
      databaseId: collection.databaseId,
      documentId,
      propertyId: specId,
      value: "Ship the approved spec",
      expectedBlocksFieldRevision: 0,
    },
    person,
  );
  return {
    ...collection,
    statusId,
    specId,
    notesId,
    bodyId: bodyId ?? null,
    itemId: row.receipt.row.itemId,
    documentId,
  };
}

type SpecRow = Awaited<ReturnType<typeof specRow>>;

function freezeAt(row: SpecRow, optionIds = ["approved"]) {
  return setRule.run(
    {
      databaseId: row.databaseId,
      propertyId: row.specId,
      rule: { propertyId: row.statusId, optionIds },
    },
    person,
  );
}

function setStatus(row: SpecRow, value: string | null, ctx = person) {
  return setProperty.run(
    {
      databaseId: row.databaseId,
      documentId: row.documentId,
      propertyId: row.statusId,
      value,
    },
    ctx,
  );
}

async function fieldText(row: SpecRow, propertyId: string) {
  const [stored] = await getDb()
    .select({ content: schema.documentBlockFieldContents.content })
    .from(schema.documentBlockFieldContents)
    .where(
      and(
        eq(schema.documentBlockFieldContents.documentId, row.documentId),
        eq(schema.documentBlockFieldContents.propertyId, propertyId),
      ),
    );
  const [identity] = await getDb()
    .select({ revision: schema.documentBlockFields.revision })
    .from(schema.documentBlockFields)
    .where(
      and(
        eq(schema.documentBlockFields.documentId, row.documentId),
        eq(schema.documentBlockFields.propertyId, propertyId),
      ),
    );
  return { text: stored?.content ?? "", revision: identity?.revision ?? 0 };
}

async function saveTab(
  row: SpecRow,
  propertyId: string,
  value: string,
  ctx: { caller: "frontend" | "mcp" | "tool"; userEmail: string } = person,
) {
  const { revision } = await fieldText(row, propertyId);
  return setProperty.run(
    {
      databaseId: row.databaseId,
      documentId: row.documentId,
      propertyId,
      value,
      expectedBlocksFieldRevision: revision,
    },
    ctx,
  );
}

async function insertBlock(row: SpecRow, idempotencyKey: string, nfm: string) {
  const discovered = await contract(row.databaseId);
  const target = {
    ...discovered.target,
    itemId: row.itemId,
    rowDocumentId: row.documentId,
    propertyId: row.specId,
  };
  const listed = await listBlocks.run({ target, limit: 100 }, person);
  return mutateBlock.run(
    {
      target,
      expectedSchemaRevision: discovered.schemaRevision,
      expectedRowRevision: listed.rowRevision,
      expectedFieldRevision: listed.fieldRevision,
      idempotencyKey,
      operation: "insert",
      block: { kind: "paragraph", nfm },
      position: { placement: "end" },
    } as never,
    agent,
  );
}

async function definitionOptions(propertyId: string) {
  const [definition] = await getDb()
    .select({
      name: schema.documentPropertyDefinitions.name,
      optionsJson: schema.documentPropertyDefinitions.optionsJson,
    })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.id, propertyId));
  return {
    name: definition?.name,
    options: parsePropertyOptions(definition?.optionsJson),
  };
}

describe("a tab frozen while Status is Approved", () => {
  it("refuses every save to the tab, from people and agents alike", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);
      await setStatus(row, "approved");

      await expect(
        saveTab(row, row.specId, "An agent's rewrite", agent),
      ).rejects.toMatchObject(frozen);
      await expect(
        saveTab(row, row.specId, "An agent's rewrite", ownAgent),
      ).rejects.toMatchObject(frozen);
      await expect(
        saveTab(row, row.specId, "A person's rewrite"),
      ).rejects.toMatchObject(frozen);
      await expect(
        insertBlock(row, "frozen-block", "An agent's block"),
      ).rejects.toMatchObject(frozen);

      expect((await fieldText(row, row.specId)).text).toBe(
        "Ship the approved spec",
      );
    });
  });

  it("names the tab, the column and the value, so an agent knows what to do", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);
      await setStatus(row, "approved");

      await expect(
        saveTab(row, row.specId, "An agent's rewrite", agent),
      ).rejects.toThrow(
        "The Spec tab can't change while Status is Approved: a rule on this collection freezes it. Move Status off Approved to edit it, or comment on the page instead.",
      );
    });
  });

  it("leaves the row's other tabs and columns open", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);
      await setStatus(row, "approved");

      await saveTab(row, row.notesId, "Notes still move", agent);
      expect((await fieldText(row, row.notesId)).text).toBe("Notes still move");
      await setStatus(row, "published", agent);
    });
  });

  it("stays open while Status is unset or has another value", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);

      await saveTab(row, row.specId, "Unset status", agent);
      await setStatus(row, "draft");
      await saveTab(row, row.specId, "Draft status", agent);
      expect((await fieldText(row, row.specId)).text).toBe("Draft status");
    });
  });

  it("reopens when Status moves off Approved", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row, ["approved", "published"]);
      await setStatus(row, "published");
      await expect(
        saveTab(row, row.specId, "Too soon", agent),
      ).rejects.toMatchObject(frozen);

      await setStatus(row, "draft", agent);
      await saveTab(row, row.specId, "Back in draft", agent);
      await insertBlock(row, "reopened-block", "And a new block");
      expect((await fieldText(row, row.specId)).text).toContain(
        "And a new block",
      );
    });
  });

  it("checks the status the save commits against, not one read before it", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);
      await setStatus(row, "draft");

      // Status reaches Approved after the save starts but before it takes
      // the page's row.
      beforePageRowsLock.run = (tx) =>
        (tx as ReturnType<typeof getDb>)
          .update(schema.documentPropertyValues)
          .set({ valueJson: JSON.stringify("approved") })
          .where(
            and(
              eq(schema.documentPropertyValues.documentId, row.documentId),
              eq(schema.documentPropertyValues.propertyId, row.statusId),
            ),
          );
      await expect(
        saveTab(row, row.specId, "A save that started in Draft", agent),
      ).rejects.toMatchObject(frozen);
      expect((await fieldText(row, row.specId)).text).toBe(
        "Ship the approved spec",
      );
    });
  });

  it("makes a change to the rule's column take the page's row, as a save to the tab does", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);
      const locked: string[][] = [];
      beforePageRowsLock.run = async () => {
        locked.push([row.documentId]);
      };
      await setStatus(row, "approved");
      expect(locked).toEqual([[row.documentId]]);
    });
  });
});

describe("setting a tab's freeze", () => {
  it("is for a person with full access to the collection, never an agent", async () => {
    const row = await asOwner(() => specRow());
    const rule = {
      databaseId: row.databaseId,
      propertyId: row.specId,
      rule: { propertyId: row.statusId, optionIds: ["approved"] },
    };
    await asOwner(async () => {
      await expect(setRule.run(rule, agent)).rejects.toBeTruthy();
      await expect(setRule.run(rule, ownAgent)).rejects.toBeTruthy();
      const listed = await listProperties.run(
        { documentId: row.documentId, databaseId: row.databaseId },
        person,
      );
      expect(listed.canManageColumnRules).toBe(true);
    });

    // Editor on the collection and its row: enough to write the tab, not to
    // set its rule.
    await getDb()
      .insert(schema.documentShares)
      .values(
        [row.databaseDocumentId, row.documentId].map((resourceId) => ({
          id: `share-${crypto.randomUUID()}`,
          resourceId,
          principalType: "user",
          principalId: COLLEAGUE,
          role: "editor",
          createdBy: OWNER,
          createdAt: new Date().toISOString(),
        })),
      );
    const colleague = { caller: "frontend" as const, userEmail: COLLEAGUE };
    await runWithRequestContext(
      { userEmail: COLLEAGUE, orgId: null },
      async () => {
        await expect(setRule.run(rule, colleague)).rejects.toMatchObject({
          statusCode: 403,
        });
        const listed = await listProperties.run(
          { documentId: row.documentId, databaseId: row.databaseId },
          colleague,
        );
        expect(listed.canManageColumnRules).toBe(false);
      },
    );
    expect(
      (await definitionOptions(row.specId)).options.blocks,
    ).not.toHaveProperty("freezeWhen");

    await getDb()
      .update(schema.documentShares)
      .set({ role: "admin" })
      .where(eq(schema.documentShares.resourceId, row.databaseDocumentId));
    await runWithRequestContext({ userEmail: COLLEAGUE, orgId: null }, () =>
      setRule.run(rule, colleague),
    );
    expect((await definitionOptions(row.specId)).options.blocks).toEqual({
      primary: false,
      freezeWhen: { propertyId: row.statusId, optionIds: ["approved"] },
    });
  });

  it("freezes a tab, not the page body, by a status or select column's own values", async () => {
    await asOwner(async () => {
      const row = await specRow();
      const freeze = (propertyId: string, keyId: string, optionIds: string[]) =>
        setRule.run(
          {
            databaseId: row.databaseId,
            propertyId,
            rule: { propertyId: keyId, optionIds },
          },
          person,
        );
      if (row.bodyId) {
        await expect(
          freeze(row.bodyId, row.statusId, ["approved"]),
        ).rejects.toMatchObject(invalid);
      }
      await expect(
        freeze(row.statusId, row.statusId, ["approved"]),
      ).rejects.toMatchObject(invalid);
      await expect(
        freeze(row.specId, row.notesId, ["approved"]),
      ).rejects.toMatchObject(invalid);
      await expect(
        freeze(row.specId, row.statusId, ["shipped"]),
      ).rejects.toMatchObject(invalid);

      await freeze(row.specId, row.statusId, ["approved", "approved"]);
      expect(
        (await definitionOptions(row.specId)).options.blocks?.freezeWhen,
      ).toEqual({ propertyId: row.statusId, optionIds: ["approved"] });
    });
  });

  it("lifts the rule with null", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);
      await setStatus(row, "approved");
      await setRule.run(
        { databaseId: row.databaseId, propertyId: row.specId, rule: null },
        person,
      );
      expect((await definitionOptions(row.specId)).options.blocks).toEqual({
        primary: false,
      });
      await saveTab(row, row.specId, "Open again", agent);
    });
  });
});

describe("the columns a rule uses", () => {
  it("can't be deleted or retyped while the rule stands", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);
      const remove = (propertyId: string) =>
        deleteProperty.run(
          {
            documentId: row.databaseDocumentId,
            databaseId: row.databaseId,
            propertyId,
          },
          person,
        );
      const retype = (propertyId: string, name: string) =>
        configureProperty.run(
          {
            id: propertyId,
            documentId: row.databaseDocumentId,
            databaseId: row.databaseId,
            name,
            type: "text",
          },
          person,
        );

      await expect(remove(row.specId)).rejects.toMatchObject(inUse);
      await expect(remove(row.statusId)).rejects.toMatchObject(inUse);
      await expect(retype(row.specId, "Spec")).rejects.toMatchObject(inUse);
      await expect(retype(row.statusId, "Status")).rejects.toMatchObject(inUse);

      await setRule.run(
        { databaseId: row.databaseId, propertyId: row.specId, rule: null },
        person,
      );
      await remove(row.specId);
      await remove(row.statusId);
    });
  });

  it("keeps the values a rule names, and the rule through a rename", async () => {
    await asOwner(async () => {
      const row = await specRow();
      await freezeAt(row);
      const configure = (
        propertyId: string,
        name: string,
        type: "status" | "blocks",
        options?: unknown,
      ) =>
        configureProperty.run(
          {
            id: propertyId,
            documentId: row.databaseDocumentId,
            databaseId: row.databaseId,
            name,
            type,
            ...(options ? { options } : {}),
          } as never,
          person,
        );

      await expect(
        configure(row.statusId, "Status", "status", {
          options: STATUS_OPTIONS.filter((option) => option.id !== "approved"),
        }),
      ).rejects.toMatchObject(inUse);
      await configure(row.statusId, "Stage", "status", {
        options: [
          ...STATUS_OPTIONS.filter((option) => option.id !== "draft"),
          { id: "review", name: "In review", color: "yellow" },
        ],
      });
      await configure(row.specId, "Specification", "blocks");

      const spec = await definitionOptions(row.specId);
      expect(spec.name).toBe("Specification");
      expect(spec.options.blocks?.freezeWhen).toEqual({
        propertyId: row.statusId,
        optionIds: ["approved"],
      });
      await setStatus(row, "approved");
      await expect(
        saveTab(row, row.specId, "Still frozen after the renames", agent),
      ).rejects.toThrow(
        "The Specification tab can't change while Stage is Approved",
      );
    });
  });
});
