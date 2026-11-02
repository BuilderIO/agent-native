import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { serializeContentSourceDocument } from "../shared/content-source.js";
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
let importSource: typeof import("./import-content-source.js").default;
let withContentDatabaseMutationLock: typeof import("./_content-database-mutation-lock.js").withContentDatabaseMutationLock;
let setImageAlt: typeof import("./set-image-alt-text.js").default;
let transcribe: typeof import("./transcribe-media.js").default;
let deleteDatabase: typeof import("./delete-content-database.js").default;
let deleteProperty: typeof import("./delete-document-property.js").default;
let resolveDraft: typeof import("./resolve-preview-document-draft.js").default;
let rollbackSlash: typeof import("./rollback-created-slash-document.js").default;

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
  importSource = (await import("./import-content-source.js")).default;
  ({ withContentDatabaseMutationLock } =
    await import("./_content-database-mutation-lock.js"));
  setImageAlt = (await import("./set-image-alt-text.js")).default;
  transcribe = (await import("./transcribe-media.js")).default;
  deleteDatabase = (await import("./delete-content-database.js")).default;
  deleteProperty = (await import("./delete-document-property.js")).default;
  resolveDraft = (await import("./resolve-preview-document-draft.js")).default;
  rollbackSlash = (await import("./rollback-created-slash-document.js"))
    .default;
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

  it("doesn't count a person typing in a chat widget", () => {
    expect(isAgentCall({ caller: "mcp-widget-write" })).toBe(false);
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
      const after = (await readPage(page.id)) as unknown as { icon: unknown };
      expect(JSON.stringify(after.icon)).toContain("🔒");
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

  it("refuses an agent's image alt text and transcript, and keeps a person's alt text", async () => {
    await asOwner(async () => {
      const image = "https://example.com/diagram.png";
      const page = await lockedPage(`![Old](${image})`);

      await expect(
        setImageAlt.run(
          { documentId: page.id, imageUrl: image, altText: "New" },
          agent,
        ),
      ).rejects.toMatchObject(locked);
      await expect(
        transcribe.run(
          {
            documentId: page.id,
            mediaUrl: "https://example.com/talk.mp4",
            mediaType: "video",
          },
          ownAgent,
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toBe(page.content);

      await setImageAlt.run(
        { documentId: page.id, imageUrl: image, altText: "New" },
        person,
      );
      expect((await readPage(page.id)).content).toContain("![New]");
    });
  });

  it("refuses an agent moving a locked collection to Trash, by either request", async () => {
    await asOwner(async () => {
      const created = await createDatabase.run(
        { title: "Locked collection" },
        person,
      );
      const databaseId = created.database.id;
      const documentId = created.database.documentId;
      await setLock.run({ id: documentId, locked: true }, person);
      const discovered = await contract(databaseId);
      const read = (await getDatabase.run({ databaseId }, person)) as {
        configurationRevision: string;
      };

      await expect(
        deleteDatabase.run({ databaseId }, ownAgent),
      ).rejects.toMatchObject(locked);
      await expect(
        deleteDatabase.run(
          {
            target: {
              spaceId: discovered.target.spaceId,
              databaseId: discovered.target.databaseId,
              databaseDocumentId: discovered.target.databaseDocumentId,
            },
            expectedConfigurationRevision: read.configurationRevision,
            idempotencyKey: "trash-locked-collection",
          },
          agent,
        ),
      ).rejects.toMatchObject(locked);
      const [page] = await getDb()
        .select({ trashedAt: schema.documents.trashedAt })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId));
      expect(page.trashedAt).toBeNull();

      await deleteDatabase.run({ databaseId }, person);
    });
  });

  it("refuses an agent's new description when it turns a locked page into a collection", async () => {
    await asOwner(async () => {
      const page = await lockedPage("The body");

      await expect(
        createDatabase.run(
          { documentId: page.id, description: "Agent's description" },
          ownAgent,
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).description).toBe(page.description);

      await createDatabase.run(
        { documentId: page.id, description: "A person's description" },
        person,
      );
      expect((await readPage(page.id)).description).toBe(
        "A person's description",
      );
    });
  });

  it("refuses an agent deleting a Blocks property that holds locked text, not its other columns", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      const discovered = await contract(row.databaseId);
      const remove = (propertyId: string) => ({
        documentId: discovered.target.databaseDocumentId,
        databaseId: row.databaseId,
        propertyId,
      });

      await expect(
        deleteProperty.run(remove(row.blocksId), ownAgent),
      ).rejects.toMatchObject(locked);
      expect((await readPage(row.documentId)).content).toContain("First block");

      await deleteProperty.run(remove(row.rankId), ownAgent);
      await deleteProperty.run(remove(row.blocksId), person);
      const propertyIds = (await contract(row.databaseId)).properties.map(
        (property) => property.id,
      );
      expect(propertyIds).not.toContain(row.rankId);
      expect(propertyIds).not.toContain(row.blocksId);
    });
  });

  it("refuses an outside call keeping a preview draft over locked text", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Saved text");
      await expect(
        resolveDraft.run(
          {
            choice: "keep_mine",
            documentId: page.id,
            expectedDraftVersion: 1,
            expectedDraftTitle: page.title,
            expectedDraftContent: "Draft text",
            expectedDocumentUpdatedAt: page.updatedAt,
          },
          { caller: "http", userEmail: OWNER },
        ),
      ).rejects.toMatchObject(locked);
    });
  });

  it("refuses an agent rolling back a new page a person locked", async () => {
    await asOwner(async () => {
      const parent = (await createDocument.run(
        { title: "Parent", content: "" },
        person,
      )) as { id: string };
      const child = (await createDocument.run(
        { title: "", content: "", parentId: parent.id },
        person,
      )) as { id: string };
      await setLock.run({ id: child.id, locked: true }, person);

      await expect(
        rollbackSlash.run({ id: child.id, parentId: parent.id }, ownAgent),
      ).rejects.toMatchObject(locked);
      await rollbackSlash.run({ id: child.id, parentId: parent.id }, person);
    });
  });

  it("refuses an agent importing over a locked page, and lets a person", async () => {
    await asOwner(async () => {
      const page = await lockedPage("The body");
      const path = "notes/locked.md";
      const files = {
        [path]: serializeContentSourceDocument({
          id: page.id,
          parentId: null,
          title: page.title,
          description: "",
          content: "Imported text",
          icon: null,
          position: 0,
          isFavorite: false,
          hideFromSearch: false,
          visibility: "private",
        }),
      };

      const refused = (await importSource.run(
        { files, dryRun: false },
        agent,
      )) as { skipped: Array<{ path: string; reason: string }> };
      expect(refused.skipped).toEqual([
        { path, reason: expect.stringContaining("locked") },
      ]);
      expect((await readPage(page.id)).content).toBe(page.content);

      await importSource.run({ files, dryRun: false }, person);
      expect((await readPage(page.id)).content).toContain("Imported text");
    });
  });

  it("refuses an agent changing a Blocks field's type on locked rows, and lets a person", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      const discovered = await contract(row.databaseId);
      const documentId = discovered.target.databaseDocumentId;
      const configured = (await configureProperty.run(
        {
          documentId,
          databaseId: row.databaseId,
          name: "Notes",
          type: "blocks",
        },
        person,
      )) as {
        properties: Array<{ definition: { id: string; name: string } }>;
      };
      const notes = configured.properties.find(
        (property) => property.definition.name === "Notes",
      );
      if (!notes) throw new Error("Fixture has no second Blocks field.");
      const change = {
        documentId,
        databaseId: row.databaseId,
        id: notes.definition.id,
        name: "Notes",
        type: "text" as const,
      };

      await expect(
        configureProperty.run(change, { caller: "http", userEmail: OWNER }),
      ).rejects.toMatchObject(locked);
      await configureProperty.run(change, person);
    });
  });

  it("checks the lock again after a block edit has waited its turn", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      await setLock.run({ id: row.documentId, locked: false }, person);
      const { discovered, listed } = await rowRevision(
        row.databaseId,
        row.blocksId,
        row,
      );
      let release = () => {};
      const queueAhead = withContentDatabaseMutationLock(
        row.databaseId,
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const outcome = mutateBlock
        .run(
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
            idempotencyKey: "row-block-queued",
            operation: "insert",
            block: { kind: "paragraph", nfm: "Changed block" },
            position: { placement: "end" },
          } as never,
          agent,
        )
        .catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await setLock.run({ id: row.documentId, locked: true }, person);
      release();
      await queueAhead;

      expect(await outcome).toMatchObject(locked);
      expect((await readPage(row.documentId)).content).not.toContain(
        "Changed block",
      );
    });
  });

  it("lets a person edit a locked page through a chat widget", async () => {
    await asOwner(async () => {
      const page = await lockedPage("The body");
      await updateDocument.run({ id: page.id, title: "Typed in a widget" }, {
        caller: "mcp-widget-write",
        userEmail: OWNER,
        mcpDirectoryWidgetWrite: {
          appId: "content",
          actionNames: ["update-document"],
          resourceIds: { documentId: page.id },
        },
      } as never);
      expect((await readPage(page.id)).title).toBe("Typed in a widget");
    });
  });

  it("still returns the receipt of an edit that landed before the lock", async () => {
    await asOwner(async () => {
      const { id } = (await createDocument.run(
        { title: "Replay", content: "First draft" },
        person,
      )) as { id: string };
      const before = await readPage(id);
      const edit = {
        id,
        baseRevision: before.revision,
        idempotencyKey: "landed-before-lock",
        find: "First",
        replace: "Second",
      };
      await editDocument.run(edit, agent);
      await setLock.run({ id, locked: true }, person);

      const again = (await editDocument.run(edit, agent)) as {
        receipt: { idempotency: { result: string } };
      };
      expect(again.receipt.idempotency.result).toBe("replayed");
      const after = await readPage(id);
      await expect(
        editDocument.run(
          {
            ...edit,
            baseRevision: after.revision,
            idempotencyKey: "new-after-lock",
            find: "Second",
            replace: "Third",
          },
          agent,
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(id)).content).toContain("Second draft");
    });
  });

  it("still returns the receipt of a block write that landed before the lock", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      await setLock.run({ id: row.documentId, locked: false }, person);
      const { discovered, listed } = await rowRevision(
        row.databaseId,
        row.blocksId,
        row,
      );
      const write = {
        target: {
          ...discovered.target,
          itemId: row.itemId,
          rowDocumentId: row.documentId,
          propertyId: row.blocksId,
        },
        expectedSchemaRevision: discovered.schemaRevision,
        expectedRowRevision: listed.rowRevision,
        expectedFieldRevision: listed.fieldRevision,
        idempotencyKey: "block-landed-before-lock",
        operation: "insert",
        block: { kind: "paragraph", nfm: "Landed block" },
        position: { placement: "end" },
      } as never;
      await mutateBlock.run(write, agent);
      await setLock.run({ id: row.documentId, locked: true }, person);

      const again = await mutateBlock.run(write, agent);
      expect(again.receipt.idempotency.result).toBe("replayed");
      await expect(
        mutateBlock.run(
          {
            ...(write as object),
            idempotencyKey: "block-new-after-lock",
            block: { kind: "paragraph", nfm: "Refused block" },
          } as never,
          agent,
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(row.documentId)).content).not.toContain(
        "Refused block",
      );
    });
  });
});
