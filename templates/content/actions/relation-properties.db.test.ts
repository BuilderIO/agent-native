import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const path = join(
  tmpdir(),
  `content-relation-properties-${process.pid}-${Date.now()}.pglite`,
);
const owner = `relation-owner-${Date.now()}@example.com`;
const stranger = `relation-stranger-${Date.now()}@example.com`;

let getDb: typeof import("../server/db/index.js").getDb;
let createDatabase: typeof import("./create-content-database.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let addItem: typeof import("./add-database-item.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let listProperties: typeof import("./list-document-properties.js").default;
let searchRows: typeof import("./search-content-database-rows.js").default;
let deleteDocument: typeof import("./delete-document.js").default;

const as = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);
const asOwner = <T>(run: () => Promise<T>) => as(owner, run);

let spaceIds: string[] = [];
let projects: { id: string; documentId: string };
let tasks: { id: string; documentId: string };
let oc01: string;
let oc02: string;
let task: string;
let relationPropertyId: string;

async function newDatabase(spaceId: string, title: string) {
  const created = await asOwner(() =>
    createDatabase.run({
      spaceId,
      title,
      idempotencyKey: `relation-${title}-${spaceId}`,
    }),
  );
  return {
    id: created.database.id,
    documentId: created.database.documentId,
  };
}

async function newRow(databaseId: string, title: string) {
  const read = await asOwner(() => getDatabase.run({ databaseId }));
  if (!("mutationContract" in read) || !read.mutationContract) {
    throw new Error("Expected a database mutation contract");
  }
  const row = await asOwner(() =>
    addItem.run({
      target: read.mutationContract!.target,
      expectedSchemaRevision: read.mutationContract!.schemaRevision,
      idempotencyKey: `row-${databaseId}-${title}`,
      title,
    }),
  );
  return row.receipt.row.documentId;
}

async function relationProperty(documentId: string, userEmail = owner) {
  const listed = await as(userEmail, () =>
    listProperties.run({ documentId, databaseId: tasks.id }),
  );
  return listed.properties.find(
    (property) => property.definition.id === relationPropertyId,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${path}`;
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  createDatabase = (await import("./create-content-database.js")).default;
  getDatabase = (await import("./get-content-database.js")).default;
  addItem = (await import("./add-database-item.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  setProperty = (await import("./set-document-property.js")).default;
  listProperties = (await import("./list-document-properties.js")).default;
  searchRows = (await import("./search-content-database-rows.js")).default;
  deleteDocument = (await import("./delete-document.js")).default;
  const spaces = await import("./_content-spaces.js");
  await asOwner(() => spaces.provisionContentSpaces(getDb(), owner));
  await as(stranger, () => spaces.provisionContentSpaces(getDb(), stranger));
  const listSpaces = (await import("./list-content-spaces.js")).default;
  spaceIds = (await asOwner(() => listSpaces.run({}))).spaces.map(
    (space) => space.id,
  );

  projects = await newDatabase(spaceIds[0]!, "Projects");
  tasks = await newDatabase(spaceIds[0]!, "Tasks");
  oc01 = await newRow(projects.id, "OC01");
  oc02 = await newRow(projects.id, "OC02 Brand refresh");
  task = await newRow(tasks.id, "Write brief");
}, 180_000);

afterAll(() => rmSync(path, { recursive: true, force: true }));

describe("relation properties", () => {
  it("creates a relation property that targets a database in the same space", async () => {
    const result = await asOwner(() =>
      configureProperty.run({
        documentId: tasks.documentId,
        databaseId: tasks.id,
        name: "Project",
        type: "relation",
        options: { relation: { databaseId: projects.id } },
      }),
    );
    const created = result.properties.find(
      (property: any) => property.definition.name === "Project",
    );
    expect(created?.definition.type).toBe("relation");
    expect(created?.definition.options.relation?.databaseId).toBe(projects.id);
    relationPropertyId = created!.definition.id;
  });

  it("lets an agent create a relation through guarded property setup", async () => {
    const read = await asOwner(() => getDatabase.run({ databaseId: tasks.id }));
    if (!("mutationContract" in read) || !read.mutationContract) {
      throw new Error("Expected a database mutation contract");
    }
    const created = (await asOwner(() =>
      configureProperty.run({
        operation: "create",
        target: {
          spaceId: spaceIds[0]!,
          databaseId: tasks.id,
          databaseDocumentId: tasks.documentId,
        },
        expectedSchemaRevision: read.mutationContract!.schemaRevision,
        idempotencyKey: "agent-relation",
        definition: {
          name: "Client",
          type: "relation",
          relatedDatabaseId: projects.id,
        },
      } as any),
    )) as any;
    expect(created.value.type).toBe("relation");
    expect(created.value.options.relation.databaseId).toBe(projects.id);
  });

  it("rejects a relation without a target, or to a database in another space", async () => {
    await expect(
      asOwner(() =>
        configureProperty.run({
          documentId: tasks.documentId,
          databaseId: tasks.id,
          name: "No target",
          type: "relation",
        }),
      ),
    ).rejects.toThrow(/related database/i);

    if (spaceIds.length < 2) return;
    const elsewhere = await newDatabase(spaceIds[1]!, "Elsewhere");
    await expect(
      asOwner(() =>
        configureProperty.run({
          documentId: tasks.documentId,
          databaseId: tasks.id,
          name: "Cross space",
          type: "relation",
          options: { relation: { databaseId: elsewhere.id } },
        }),
      ),
    ).rejects.toThrow(/same space/i);
  });

  it("does not let a relation be retargeted", async () => {
    const other = await newDatabase(spaceIds[0]!, "Clients");
    await expect(
      asOwner(() =>
        configureProperty.run({
          id: relationPropertyId,
          documentId: tasks.documentId,
          databaseId: tasks.id,
          name: "Project",
          type: "relation",
          options: { relation: { databaseId: other.id } },
        }),
      ),
    ).rejects.toThrow(/different database/i);
  });

  it("renames a relation without resending its target", async () => {
    const renamed = async (name: string) => {
      const result = await asOwner(() =>
        configureProperty.run({
          id: relationPropertyId,
          documentId: tasks.documentId,
          databaseId: tasks.id,
          name,
          type: "relation",
        }),
      );
      return result.properties.find(
        (property: any) => property.definition.id === relationPropertyId,
      );
    };
    const property = await renamed("Client project");
    expect(property?.definition.name).toBe("Client project");
    expect(property?.definition.options.relation?.databaseId).toBe(projects.id);
    await renamed("Project");
  });

  it("links a task to a project and resolves its title", async () => {
    await asOwner(() =>
      setProperty.run({
        documentId: task,
        databaseId: tasks.id,
        propertyId: relationPropertyId,
        value: [oc01, oc01, ` ${oc01} `],
      }),
    );
    const property = await relationProperty(task);
    expect(property?.value).toEqual([oc01]);
    expect(property?.relationTargets).toEqual([
      {
        documentId: oc01,
        title: "OC01",
        icon: null,
        databaseId: projects.id,
        databaseDocumentId: projects.documentId,
      },
    ]);
  });

  it("rejects pages that are not rows of the related database", async () => {
    const otherTask = await newRow(tasks.id, "Another task");
    await expect(
      asOwner(() =>
        setProperty.run({
          documentId: task,
          databaseId: tasks.id,
          propertyId: relationPropertyId,
          value: [oc01, otherTask],
        }),
      ),
    ).rejects.toThrow(/not rows of the related database/i);
    await expect(
      asOwner(() =>
        setProperty.run({
          documentId: task,
          databaseId: tasks.id,
          propertyId: relationPropertyId,
          value: ["does-not-exist"],
        }),
      ),
    ).rejects.toThrow(/not rows of the related database/i);
    expect((await relationProperty(task))?.value).toEqual([oc01]);
  });

  it("clears a relation", async () => {
    const other = await newRow(tasks.id, "Clearable task");
    await asOwner(() =>
      setProperty.run({
        documentId: other,
        databaseId: tasks.id,
        propertyId: relationPropertyId,
        value: [oc02],
      }),
    );
    await asOwner(() =>
      setProperty.run({
        documentId: other,
        databaseId: tasks.id,
        propertyId: relationPropertyId,
        value: null,
      }),
    );
    const property = await relationProperty(other);
    expect(property?.value).toBeNull();
    expect(property?.relationTargets ?? []).toEqual([]);
  });

  it("hides a trashed project's title but keeps the link", async () => {
    const linked = await newRow(tasks.id, "Task on a trashed project");
    const doomed = await newRow(projects.id, "OC99 Cancelled");
    await asOwner(() =>
      setProperty.run({
        documentId: linked,
        databaseId: tasks.id,
        propertyId: relationPropertyId,
        value: [oc01, doomed],
      }),
    );
    await asOwner(() => deleteDocument.run({ id: doomed } as any));
    const property = await relationProperty(linked);
    expect(property?.value).toEqual([oc01, doomed]);
    expect(property?.relationTargets?.map((target) => target.title)).toEqual([
      "OC01",
    ]);
  });

  it("searches the related database's rows by title", async () => {
    const all = await asOwner(() =>
      searchRows.run({ databaseId: projects.id }),
    );
    expect(all.rows.map((row) => row.title)).toEqual(
      expect.arrayContaining(["OC01", "OC02 Brand refresh"]),
    );
    const brand = await asOwner(() =>
      searchRows.run({ databaseId: projects.id, query: "brand" }),
    );
    expect(brand.rows.map((row) => row.documentId)).toEqual([oc02]);
    expect(all.rowCreation?.target.databaseId).toBe(projects.id);
    expect(all.rowCreation?.schemaRevision).toEqual(expect.any(String));
    const literal = await asOwner(() =>
      searchRows.run({ databaseId: projects.id, query: "%" }),
    );
    expect(literal.rows).toEqual([]);
  });

  it("does not show project titles or rows to someone without access", async () => {
    await expect(
      as(stranger, () => searchRows.run({ databaseId: projects.id })),
    ).rejects.toThrow();
    await expect(relationProperty(task, stranger)).rejects.toThrow();
    await expect(
      as(stranger, () =>
        setProperty.run({
          documentId: task,
          databaseId: tasks.id,
          propertyId: relationPropertyId,
          value: [oc02],
        }),
      ),
    ).rejects.toThrow();
  });
});
