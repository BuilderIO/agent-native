import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isAgentCall } from "./_document-agent-lock.js";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-agent-text-lock-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";

const person = { caller: "frontend" as const, userEmail: OWNER };
const agent = { caller: "mcp" as const, userEmail: OWNER };
const ownAgent = { caller: "tool" as const, userEmail: OWNER };
const locked = { errorCode: "AGENT_TEXT_LOCKED", statusCode: 403 };

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/index.js").schema;
let setLock: typeof import("./set-document-agent-text-lock.js").default;
let createDocument: typeof import("./create-document.js").default;
let getDocument: typeof import("./get-document.js").default;
let editDocument: typeof import("./edit-document.js").default;
let updateDocument: typeof import("./update-document.js").default;
let deleteDocument: typeof import("./delete-document.js").default;
let restoreVersion: typeof import("./restore-document-version.js").default;
let addComment: typeof import("./add-comment.js").default;
let suggestEdit: typeof import("./suggest-document-edit.js").default;
let decideSuggestion: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;
let listSuggestions: typeof import("@agent-native/core/review/suggestions/actions/list-resource-suggestions").default;
let createDatabase: typeof import("./create-content-database.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let createRow: typeof import("./add-database-item.js").default;
let updateRow: typeof import("./update-database-item.js").default;
let upsertRow: typeof import("./upsert-database-item-by-key.js").default;
let patchRows: typeof import("./patch-database-items.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let listBlocks: typeof import("./list-content-database-blocks.js").default;
let mutateBlock: typeof import("./mutate-content-database-block.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER, orgId: null }, run);

beforeAll(async () => {
  registerLabs([CREATIVE_CONTEXT_LIBRARY_LAB]);
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  setLock = (await import("./set-document-agent-text-lock.js")).default;
  createDocument = (await import("./create-document.js")).default;
  getDocument = (await import("./get-document.js")).default;
  editDocument = (await import("./edit-document.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  deleteDocument = (await import("./delete-document.js")).default;
  restoreVersion = (await import("./restore-document-version.js")).default;
  addComment = (await import("./add-comment.js")).default;
  suggestEdit = (await import("./suggest-document-edit.js")).default;
  decideSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
  ).default;
  listSuggestions = (
    await import("@agent-native/core/review/suggestions/actions/list-resource-suggestions")
  ).default;
  createDatabase = (await import("./create-content-database.js")).default;
  getDatabase = (await import("./get-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  createRow = (await import("./add-database-item.js")).default;
  updateRow = (await import("./update-database-item.js")).default;
  upsertRow = (await import("./upsert-database-item-by-key.js")).default;
  patchRows = (await import("./patch-database-items.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  listBlocks = (await import("./list-content-database-blocks.js")).default;
  mutateBlock = (await import("./mutate-content-database-block.js")).default;
  ({ getDb, schema } = await import("../server/db/index.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await (
    await import("../server/plugins/suggested-edits.js")
  ).default(undefined as never);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function lockedPage(content: string) {
  const { id } = (await createDocument.run(
    { title: "Locked page", content },
    person,
  )) as { id: string };
  await setLock.run({ id, locked: true }, person);
  return readPage(id);
}

async function readPage(id: string) {
  return (await getDocument.run({ id }, person)) as {
    id: string;
    title: string;
    content: string;
    description: string;
    revision: string;
    updatedAt: string;
    agentTextLocked: boolean;
  };
}

let rowSequence = 0;

async function addProperty(
  databaseId: string,
  databaseDocumentId: string,
  name: string,
  naturalKey?: boolean,
) {
  const configured = (await configureProperty.run(
    {
      documentId: databaseDocumentId,
      databaseId,
      name,
      type: "text",
      naturalKey,
    },
    person,
  )) as { properties: Array<{ definition: { id: string; name: string } }> };
  const property = configured.properties.find(
    (candidate) => candidate.definition.name === name,
  );
  if (!property) throw new Error(`Property ${name} was not created.`);
  return property.definition.id;
}

async function collectionRow() {
  rowSequence += 1;
  const created = await createDatabase.run(
    { title: `Locked rows ${rowSequence}` },
    person,
  );
  const databaseId = created.database.id;
  const databaseDocumentId = created.database.documentId;
  const rankId = await addProperty(databaseId, databaseDocumentId, "Rank");
  await addProperty(databaseId, databaseDocumentId, "Key", true);
  const first = await contract(databaseId);
  const row = await upsertRow.run(
    {
      target: first.target,
      expectedSchemaRevision: first.schemaRevision,
      idempotencyKey: `row-${databaseId}`,
      keyValue: "row-key",
      expectedRowRevision: null,
      title: "Row title",
    },
    person,
  );
  const blocks = first.properties.find(
    (property) => property.type === "blocks",
  );
  if (!blocks) throw new Error("Fixture collection has no Blocks property.");
  const blocksId = blocks.id;
  await setProperty.run(
    {
      databaseId,
      documentId: row.receipt.row.documentId,
      propertyId: blocksId,
      value: "First block",
      expectedBlocksFieldRevision: 0,
    },
    person,
  );
  await setLock.run({ id: row.receipt.row.documentId, locked: true }, person);
  return {
    databaseId,
    rankId,
    blocksId,
    itemId: row.receipt.row.itemId,
    documentId: row.receipt.row.documentId,
  };
}

async function contract(databaseId: string) {
  const response = await getDatabase.run({ databaseId }, person);
  if (!("database" in response) || !response.mutationContract)
    throw new Error("Fixture database has no mutation contract.");
  return response.mutationContract;
}

async function rowRevision(
  databaseId: string,
  blocksId: string,
  row: { itemId: string; documentId: string },
) {
  const discovered = await contract(databaseId);
  const listed = await listBlocks.run(
    {
      target: {
        ...discovered.target,
        itemId: row.itemId,
        rowDocumentId: row.documentId,
        propertyId: blocksId,
      },
      limit: 100,
    },
    person,
  );
  return { discovered, listed };
}

describe("who counts as an agent", () => {
  it("treats everything but a person in the browser as an agent", () => {
    expect(isAgentCall({ caller: "frontend" })).toBe(false);
    for (const caller of [
      "tool",
      "mcp",
      "webmcp",
      "a2a",
      "cli",
      "http",
    ] as const) {
      expect(isAgentCall({ caller })).toBe(true);
    }
    expect(isAgentCall({ caller: "frontend", automation: {} as never })).toBe(
      true,
    );
  });

  it("doesn't count the server's own calls, which carry no context", () => {
    expect(isAgentCall(undefined)).toBe(false);
  });
});

describe("Agents can't edit the text of this", () => {
  it("is off until a person turns it on, and agents can't change it", async () => {
    await asOwner(async () => {
      const { id } = (await createDocument.run(
        { title: "Open page", content: "Open text" },
        person,
      )) as { id: string };
      expect((await readPage(id)).agentTextLocked).toBe(false);

      await expect(
        setLock.run({ id, locked: true }, agent),
      ).rejects.toBeTruthy();
      await expect(
        setLock.run({ id, locked: true }, ownAgent),
      ).rejects.toBeTruthy();
      await expect(
        setLock.run(
          { id, locked: true },
          { ...person, automation: {} as never },
        ),
      ).rejects.toBeTruthy();
      expect((await readPage(id)).agentTextLocked).toBe(false);

      await setLock.run({ id, locked: true }, person);
      expect((await readPage(id)).agentTextLocked).toBe(true);
      await setLock.run({ id, locked: false }, person);
      expect((await readPage(id)).agentTextLocked).toBe(false);
    });
  });

  it("takes manage access to change, and binds people's agents too", async () => {
    const page = await asOwner(() => lockedPage("Locked text"));
    const colleague = "colleague@example.com";
    const share = async (role: "editor" | "admin") => {
      await getDb()
        .insert(schema.documentShares)
        .values({
          id: `share-${crypto.randomUUID()}`,
          resourceId: page.id,
          principalType: "user",
          principalId: colleague,
          role,
          createdBy: OWNER,
          createdAt: new Date().toISOString(),
        });
    };
    const asColleague = <T>(run: () => Promise<T>) =>
      runWithRequestContext({ userEmail: colleague, orgId: null }, run);
    const colleaguePerson = {
      caller: "frontend" as const,
      userEmail: colleague,
    };

    await share("editor");
    await asColleague(async () => {
      await expect(
        setLock.run({ id: page.id, locked: false }, colleaguePerson),
      ).rejects.toMatchObject({ statusCode: 403 });
      // The lock is on the page, so it holds for an editor's own agent.
      await expect(
        updateDocument.run(
          { id: page.id, title: "Colleague's agent" },
          { caller: "mcp", userEmail: colleague },
        ),
      ).rejects.toMatchObject(locked);
      await updateDocument.run(
        { id: page.id, title: "Colleague's own edit" },
        colleaguePerson,
      );
    });
    await asOwner(async () => {
      const after = await readPage(page.id);
      expect(after.agentTextLocked).toBe(true);
      expect(after.title).toBe("Colleague's own edit");
    });

    await getDb()
      .update(schema.documentShares)
      .set({ role: "admin" })
      .where(eq(schema.documentShares.resourceId, page.id));
    await asColleague(() =>
      setLock.run({ id: page.id, locked: false }, colleaguePerson),
    );
    await asOwner(async () => {
      expect((await readPage(page.id)).agentTextLocked).toBe(false);
    });
  });

  it("refuses an agent's edits to the title, body and description", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Locked text");
      const edit = (idempotencyKey: string) => ({
        id: page.id,
        baseRevision: page.revision,
        idempotencyKey,
        find: "Locked",
        replace: "Changed",
      });

      await expect(
        editDocument.run(edit("mcp-edit"), agent),
      ).rejects.toMatchObject(locked);
      await expect(
        editDocument.run(edit("tool-edit"), ownAgent),
      ).rejects.toMatchObject(locked);
      for (const change of [
        { title: "Changed title" },
        { description: "Changed description" },
      ]) {
        await expect(
          updateDocument.run({ id: page.id, ...change }, agent),
        ).rejects.toMatchObject(locked);
      }
      // MCP and the app's own agent can't send a whole body here at all; a coding
      // agent on the command line can, so the lock has to catch it.
      await expect(
        updateDocument.run(
          { id: page.id, content: "Changed text" },
          { caller: "cli", userEmail: OWNER },
        ),
      ).rejects.toMatchObject(locked);
      await expect(
        restoreVersion.run(
          {
            documentId: page.id,
            versionId: "any-version",
            expectedUpdatedAt: page.updatedAt,
          } as never,
          agent,
        ),
      ).rejects.toMatchObject(locked);

      const after = await readPage(page.id);
      expect(after.title).toBe("Locked page");
      expect(after.content).toContain("Locked text");
      expect(after.description).toBe("");
    });
  });

  it("refuses an agent moving the page to Trash", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Keep this");
      await expect(
        deleteDocument.run(
          {
            id: page.id,
            expectedUpdatedAt: page.updatedAt,
            idempotencyKey: `trash-${page.id}`,
          },
          agent,
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toContain("Keep this");
    });
  });

  it("still lets an agent change what isn't the text", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Locked text");
      await updateDocument.run({ id: page.id, icon: "🔒" }, agent);
      expect((await readPage(page.id)).content).toContain("Locked text");
    });
  });

  it("lets a person keep editing, and agents again once it's off", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Locked text");
      await updateDocument.run({ id: page.id, title: "Person title" }, person);
      expect((await readPage(page.id)).title).toBe("Person title");

      await setLock.run({ id: page.id, locked: false }, person);
      const open = await readPage(page.id);
      await editDocument.run(
        {
          id: page.id,
          baseRevision: open.revision,
          idempotencyKey: `after-unlock-${page.id}`,
          find: "Locked",
          replace: "Open",
        },
        agent,
      );
      expect((await readPage(page.id)).content).toContain("Open text");
    });
  });

  it("lets an agent comment and suggest, and only a person accept", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Keep the first draft.");

      await addComment.run(
        { documentId: page.id, content: "A note from an agent." },
        agent,
      );
      const created = (await suggestEdit.run(
        {
          id: page.id,
          baseRevision: page.revision,
          idempotencyKey: `suggest-${page.id}`,
          find: "first draft",
          replace: "second draft",
        },
        agent,
      )) as { suggestionId: string };

      const listed = (await listSuggestions.run(
        { resourceType: "document", resourceId: page.id },
        person,
      )) as {
        suggestions: Array<{
          id: string;
          baseRevision: string;
          revision: number;
        }>;
      };
      const suggestion = listed.suggestions.find(
        (candidate) => candidate.id === created.suggestionId,
      );
      if (!suggestion) throw new Error("The suggestion wasn't listed.");
      const decision = (idempotencyKey: string) => ({
        id: suggestion.id,
        decision: "accepted" as const,
        idempotencyKey,
        observedBase: suggestion.baseRevision,
        observedRevision: suggestion.revision,
      });

      await expect(
        decideSuggestion.run(decision("agent-accept"), agent),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toContain("first draft");

      await decideSuggestion.run(decision("person-accept"), person);
      expect((await readPage(page.id)).content).toContain("second draft");
    });
  });

  it("refuses an agent's writes to a collection row's title and tabs", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      const { discovered, listed } = await rowRevision(
        row.databaseId,
        row.blocksId,
        row,
      );
      const envelope = (idempotencyKey: string) => ({
        target: {
          spaceId: discovered.target.spaceId,
          databaseId: discovered.target.databaseId,
          databaseDocumentId: discovered.target.databaseDocumentId,
        },
        expectedSchemaRevision: discovered.schemaRevision,
        idempotencyKey,
      });

      await expect(
        updateRow.run(
          {
            ...envelope("row-title"),
            itemId: row.itemId,
            documentId: row.documentId,
            expectedRowRevision: listed.rowRevision,
            title: "Changed title",
          },
          agent,
        ),
      ).rejects.toMatchObject(locked);
      await expect(
        upsertRow.run(
          {
            ...envelope("row-upsert"),
            keyValue: "row-key",
            expectedRowRevision: listed.rowRevision,
            title: "Changed title",
          },
          agent,
        ),
      ).rejects.toMatchObject(locked);
      await expect(
        patchRows.run(
          {
            ...envelope("row-patch"),
            rows: [
              {
                itemId: row.itemId,
                documentId: row.documentId,
                expectedRowRevision: listed.rowRevision,
                title: "Changed title",
              },
            ],
          } as never,
          agent,
        ),
      ).rejects.toMatchObject(locked);
      await expect(
        setProperty.run(
          {
            databaseId: row.databaseId,
            documentId: row.documentId,
            propertyId: row.blocksId,
            value: "Changed block",
            expectedBlocksFieldRevision: listed.fieldRevision,
          },
          agent,
        ),
      ).rejects.toMatchObject(locked);
      await expect(
        mutateBlock.run(
          {
            target: {
              ...discovered.target,
              itemId: row.itemId,
              rowDocumentId: row.documentId,
              propertyId: row.blocksId,
            },
            expectedSchemaRevision: discovered.schemaRevision,
            expectedRowRevision: listed.rowRevision,
            expectedFieldRevision: listed.fieldRevision,
            idempotencyKey: "row-block",
            operation: "insert",
            block: { kind: "paragraph", nfm: "Changed block" },
            position: { placement: "end" },
          } as never,
          agent,
        ),
      ).rejects.toMatchObject(locked);

      const after = await readPage(row.documentId);
      expect(after.title).toBe("Row title");
      expect(after.content).toContain("First block");
    });
  });

  it("still lets an agent set a collection row's other columns", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      const { discovered, listed } = await rowRevision(
        row.databaseId,
        row.blocksId,
        row,
      );
      const updated = await updateRow.run(
        {
          target: {
            spaceId: discovered.target.spaceId,
            databaseId: discovered.target.databaseId,
            databaseDocumentId: discovered.target.databaseDocumentId,
          },
          expectedSchemaRevision: discovered.schemaRevision,
          idempotencyKey: "row-column",
          itemId: row.itemId,
          documentId: row.documentId,
          expectedRowRevision: listed.rowRevision,
          propertyEntries: [
            { propertyId: row.rankId, propertyType: "text", value: "Top" },
          ],
        },
        agent,
      );
      expect(updated.receipt.outcome).toBe("updated");
    });
  });
});
