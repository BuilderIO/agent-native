import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActionRunContext } from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readBlockLink } from "../shared/block-link.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-get-document-agent-read-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "agent-read-owner@example.com";
const BODY = "First paragraph of the row.\nSecond paragraph of the row.";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let createContentDatabase: typeof import("./create-content-database.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;
let getDocumentAction: typeof import("./get-document.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createContentDatabase = (await import("./create-content-database.js"))
    .default;
  configureDocumentProperty = (await import("./configure-document-property.js"))
    .default;
  getContentDatabase = (await import("./get-content-database.js")).default;
  addDatabaseItem = (await import("./add-database-item.js")).default;
  setDocumentProperty = (await import("./set-document-property.js")).default;
  getDocumentAction = (await import("./get-document.js")).default;
  await (await import("../server/plugins/db.js")).default(undefined as never);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function as<T>(run: () => Promise<T>) {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

/** The item a lookup found, failing the test when it found none. */
function found<T>(item: T | undefined, what: string): T {
  if (item === undefined) throw new Error(`No ${what} in the read.`);
  return item;
}

/**
 * A row with a body, a described Select field with described options, and a
 * second Blocks field, each with a value.
 */
async function seedRow(suffix: string) {
  return as(async () => {
    const created = await createContentDatabase.run({
      title: `Board ${suffix}`,
    });
    const databaseId = created.database.id;
    const documentId = created.database.documentId;
    await configureDocumentProperty.run({
      documentId,
      databaseId,
      name: "Notes",
      type: "blocks",
    });
    const configured = await configureDocumentProperty.run({
      documentId,
      databaseId,
      name: "Stage",
      type: "select",
      description: "Where the piece is in editing.",
      options: {
        options: [
          {
            id: "stage-draft",
            name: "Draft",
            color: "gray",
            description: "Still being written.",
          },
          { id: "stage-done", name: "Done", color: "green" },
        ],
      },
    });
    const byName = (name: string) =>
      found(
        configured.properties.find(
          (property) => property.definition.name === name,
        ),
        name,
      ).definition;
    const read = await getContentDatabase.run({ databaseId });
    if (!("database" in read) || !read.mutationContract)
      throw new Error("Fixture Collection has no mutation contract.");
    const added = await addDatabaseItem.run({
      target: read.mutationContract.target,
      expectedSchemaRevision: read.mutationContract.schemaRevision,
      idempotencyKey: `agent-read-row-${suffix}`,
      title: "Row",
    });
    const row = added.receipt.row.documentId as string;
    await getDb()
      .update(schema.documents)
      .set({ content: BODY })
      .where(eq(schema.documents.id, row));
    const set = (propertyId: string, value: unknown) =>
      setDocumentProperty.run(
        { documentId: row, databaseId, propertyId, value },
        { caller: "frontend", userEmail: OWNER },
      );
    await set(byName("Stage").id, "stage-draft");
    await set(byName("Notes").id, "A note on the row.");
    return { row, stageId: byName("Stage").id, notesId: byName("Notes").id };
  });
}

function read(
  id: string,
  caller: ActionRunContext["caller"] | undefined,
  detail?: "full",
) {
  return as(() =>
    getDocumentAction.run(
      { id, ...(detail ? { detail } : {}) },
      caller ? { caller, userEmail: OWNER } : undefined,
    ),
  );
}

describe("get-document agent read", () => {
  it("names each interactive HTML block and the link that opens it, for agents only", async () => {
    const { row } = await seedRow("interactive");
    const block = (title: string) =>
      `\`\`\`html interactive\n<title>${title}</title>\n<p>Hi</p>\n\`\`\``;
    await getDb()
      .update(schema.documents)
      .set({ content: ["Intro", block("First"), block("Second")].join("\n") })
      .where(eq(schema.documents.id, row));

    const { interactiveBlocks = [] } = await read(row, "mcp");

    expect(interactiveBlocks.map(({ title }) => title)).toEqual([
      "First",
      "Second",
    ]);
    expect(new Set(interactiveBlocks.map(({ blockId }) => blockId)).size).toBe(
      2,
    );
    for (const { blockId, url } of interactiveBlocks) {
      const { pathname, search } = new URL(url);
      expect(pathname).toBe(`/page/${row}`);
      expect(readBlockLink(search)).toEqual({ blockId, fullScreen: true });
    }
    expect(await read(row, "frontend")).not.toHaveProperty("interactiveBlocks");
  });

  it("gives agents the fields without the editor's display data", async () => {
    const { row, stageId, notesId } = await seedRow("trimmed");
    const full = await read(row, "frontend");
    const agent = await read(row, "mcp");

    const { properties: fullProperties, ...fullRest } = full;
    const { properties: agentProperties, ...agentRest } = agent;
    expect(agentRest).toEqual(fullRest);
    expect(agent.content).toBe(BODY);
    expect(agentProperties.map((property) => property.definition.id)).toEqual(
      fullProperties.map((property) => property.definition.id),
    );

    const fullById = (id: string) =>
      found(
        fullProperties.find((property) => property.definition.id === id),
        id,
      );
    const agentById = (id: string) =>
      found(
        agentProperties.find((property) => property.definition.id === id),
        id,
      );

    const stage = agentById(stageId);
    expect(stage).toEqual({
      definition: {
        id: stageId,
        databaseId: fullById(stageId).definition.databaseId,
        name: "Stage",
        type: "select",
        description: "Where the piece is in editing.",
        options: {
          options: [
            {
              id: "stage-draft",
              name: "Draft",
              description: "Still being written.",
            },
            { id: "stage-done", name: "Done" },
          ],
        },
      },
      value: fullById(stageId).value,
      editable: fullById(stageId).editable,
    });

    const notes = agentById(notesId);
    const fullNotes = fullById(notesId);
    expect(notes.value).toBe(fullNotes.value);
    const fullBlocks = found(fullNotes.blocksField, "Notes block map");
    expect(fullBlocks.blocks.length).toBeGreaterThan(0);
    expect(notes.blocksField).toEqual({
      fieldId: fullBlocks.fieldId,
      revision: fullBlocks.revision,
    });

    const fullBody = found(
      fullProperties.find(
        (property) => property.definition.options.blocks?.primary === true,
      ),
      "body field",
    );
    expect(fullBody.value).toBe(BODY);
    const body = agentById(fullBody.definition.id);
    expect(body).not.toHaveProperty("value");
    expect(body).toMatchObject({
      valueIsContent: true,
      definition: { options: { blocks: { primary: true } } },
    });

    // The editor's display data appears nowhere in the agent's fields.
    for (const property of agentProperties) {
      for (const key of [
        "icon",
        "visibility",
        "position",
        "createdAt",
        "updatedAt",
      ]) {
        expect(property.definition).not.toHaveProperty(key);
      }
      for (const option of property.definition.options.options ?? []) {
        expect(option).not.toHaveProperty("color");
      }
    }
    expect(JSON.stringify(agent).length).toBeLessThan(
      JSON.stringify(full).length,
    );
  });

  it("gives every agent caller one trimmed read and others the whole read", async () => {
    const { row } = await seedRow("whole");
    const full = await read(row, "frontend");
    const fullProperties = JSON.stringify(full.properties);
    const agentProperties = JSON.stringify((await read(row, "mcp")).properties);
    expect(agentProperties).not.toBe(fullProperties);
    for (const caller of ["mcp-widget", "cli", "http", undefined] as const) {
      expect(JSON.stringify((await read(row, caller)).properties)).toBe(
        fullProperties,
      );
    }
    for (const caller of [
      "mcp",
      "tool",
      "webmcp",
      "a2a",
      "automation",
    ] as const) {
      expect(JSON.stringify((await read(row, caller, "full")).properties)).toBe(
        fullProperties,
      );
      expect(JSON.stringify((await read(row, caller)).properties)).toBe(
        agentProperties,
      );
    }
  });
});
