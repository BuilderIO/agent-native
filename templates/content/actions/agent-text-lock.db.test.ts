import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { runAsRouteCaller } from "../server/lib/agent-lock-route.js";
import {
  BUILDER_DOCS_MDX_SOURCE_MODE,
  builderSourceKindForModel,
  builderSourceRootPath,
} from "../shared/builder-docs-blocks.js";
import { serializeContentSourceDocument } from "../shared/content-source.js";
import {
  isAgentCall,
  keepAgentCallProvenance,
  serverSaveContext,
} from "./_document-agent-lock.js";

const beforeRowLock = vi.hoisted(() => ({
  run: null as null | ((tx: unknown) => Promise<unknown>),
}));

vi.mock("../server/lib/document-body-revision.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../server/lib/document-body-revision.js")
    >();
  return {
    ...actual,
    lockLegacyBodyWrites: async (
      ...args: Parameters<typeof actual.lockLegacyBodyWrites>
    ) => {
      const run = beforeRowLock.run;
      beforeRowLock.run = null;
      await run?.(args[0]);
      return actual.lockLegacyBodyWrites(...args);
    },
  };
});

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

const beforeAcceptTransaction = vi.hoisted(() => ({
  run: null as null | (() => Promise<unknown>),
}));

// A legacy accept reads presence between the lock's first check and its
// transaction, so a lock turned on here is one that check can't see.
vi.mock("@agent-native/core/collab", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/collab")>();
  return {
    ...actual,
    loadAwarenessRows: async (
      ...args: Parameters<typeof actual.loadAwarenessRows>
    ) => {
      const run = beforeAcceptTransaction.run;
      beforeAcceptTransaction.run = null;
      await run?.();
      return actual.loadAwarenessRows(...args);
    },
  };
});

const notion = vi.hoisted(() => ({
  getConnection: vi.fn(),
  requireConnection: vi.fn(),
  fetchPage: vi.fn(),
  createPage: vi.fn(),
  readPage: vi.fn(),
  pushPage: vi.fn(),
  owner: vi.fn(),
}));

vi.mock("../server/lib/notion.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/notion.js")>()),
  getNotionConnectionForOwner: notion.getConnection,
  requireNotionConnectionForOwner: notion.requireConnection,
  fetchNotionPage: notion.fetchPage,
  createNotionPageWithMarkdown: notion.createPage,
  readNotionPageAsDocument: notion.readPage,
  pushDocumentToNotionPage: notion.pushPage,
  getDocumentOwnerEmail: notion.owner,
}));

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
const viewOnly = { errorCode: "AGENT_VIEW_ONLY", statusCode: 403 };

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
let updateComment: typeof import("./update-comment.js").default;
let deleteComment: typeof import("./delete-comment.js").default;
let reactToComment: typeof import("./react-to-comment.js").default;
let syncNotionComments: typeof import("./sync-notion-comments.js").default;
let createReviewComment: typeof import("@agent-native/core/review/actions/create-review-comment").default;
let replyReviewComment: typeof import("@agent-native/core/review/actions/reply-review-comment").default;
let reactToReviewComment: typeof import("@agent-native/core/review/actions/react-to-review-comment").default;
let createSuggestion: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion").default;
let suggestEdit: typeof import("./suggest-document-edit.js").default;
let decideSuggestion: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;
let listSuggestions: typeof import("@agent-native/core/review/suggestions/actions/list-resource-suggestions").default;
let createDatabase: typeof import("./create-content-database.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
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
let updateDraft: typeof import("./update-preview-document-draft.js").default;
let applyTranscript: typeof import("./transcribe-media.js").applyTranscriptToDocument;
let connectFolder: typeof import("./connect-local-folder-source.js").default;
let syncFolder: typeof import("./sync-local-folder-source.js").default;
let shareLocalFile: typeof import("./share-local-file-document.js").default;
let syncManifestFolder: typeof import("./sync-manifest-local-folder-source.js").default;
let resolveFolderConflict: typeof import("./resolve-local-folder-conflict.js").default;
let pullNotion: typeof import("./pull-notion-page.js").default;
let resolveNotionConflict: typeof import("./resolve-notion-sync-conflict.js").default;
let linkNotion: typeof import("./link-notion-page.js").default;
let createAndLinkNotion: typeof import("./create-and-link-notion-page.js").default;
let refreshNotion: typeof import("./refresh-notion-sync-status.js").default;
let pushNotion: typeof import("./push-notion-page.js").default;
let rewriteLiveCopy: typeof import("../server/live-copy/write.js").rewriteContentLiveCopyBody;
let liveCopyPage: typeof import("../server/test-support/live-copy-page.js");

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
  updateComment = (await import("./update-comment.js")).default;
  deleteComment = (await import("./delete-comment.js")).default;
  reactToComment = (await import("./react-to-comment.js")).default;
  syncNotionComments = (await import("./sync-notion-comments.js")).default;
  createReviewComment = (
    await import("@agent-native/core/review/actions/create-review-comment")
  ).default;
  replyReviewComment = (
    await import("@agent-native/core/review/actions/reply-review-comment")
  ).default;
  reactToReviewComment = (
    await import("@agent-native/core/review/actions/react-to-review-comment")
  ).default;
  createSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion")
  ).default;
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
  updateDraft = (await import("./update-preview-document-draft.js")).default;
  applyTranscript = (await import("./transcribe-media.js"))
    .applyTranscriptToDocument;
  connectFolder = (await import("./connect-local-folder-source.js")).default;
  syncFolder = (await import("./sync-local-folder-source.js")).default;
  shareLocalFile = (await import("./share-local-file-document.js")).default;
  syncManifestFolder = (await import("./sync-manifest-local-folder-source.js"))
    .default;
  resolveFolderConflict = (await import("./resolve-local-folder-conflict.js"))
    .default;
  pullNotion = (await import("./pull-notion-page.js")).default;
  resolveNotionConflict = (await import("./resolve-notion-sync-conflict.js"))
    .default;
  linkNotion = (await import("./link-notion-page.js")).default;
  createAndLinkNotion = (await import("./create-and-link-notion-page.js"))
    .default;
  refreshNotion = (await import("./refresh-notion-sync-status.js")).default;
  pushNotion = (await import("./push-notion-page.js")).default;
  rewriteLiveCopy = (await import("../server/live-copy/write.js"))
    .rewriteContentLiveCopyBody;
  liveCopyPage = await import("../server/test-support/live-copy-page.js");
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

async function readIcon(id: string) {
  return ((await getDocument.run({ id }, person)) as { icon?: unknown }).icon;
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

  it("counts a token claiming to be the browser, but not an embedded session", () => {
    const frontend = (headers: Record<string, string>) => ({
      caller: "frontend" as const,
      requestHeaders: new Headers(headers),
    });
    expect(isAgentCall(frontend({ authorization: "Bearer token" }))).toBe(true);
    expect(
      isAgentCall(
        frontend({
          authorization: "Bearer token",
          "x-agent-native-embed-target": "/page/one",
        }),
      ),
    ).toBe(false);
    expect(isAgentCall(frontend({}))).toBe(false);
  });

  it("keeps counting an agent's call that runs as the browser's", () => {
    const relabeled = { ...agent, caller: "frontend" as const };
    expect(isAgentCall(keepAgentCallProvenance(relabeled, agent))).toBe(true);
    const personal = { ...person };
    expect(isAgentCall(keepAgentCallProvenance(personal, person))).toBe(false);
  });

  it("treats a token on a plain route as an agent, unlike a cookie or an embedded session", async () => {
    const route = (headers: Record<string, string>) =>
      runAsRouteCaller({ headers: new Headers(headers) }, async (ctx) =>
        isAgentCall(ctx),
      );
    expect(await route({ authorization: "Bearer token" })).toBe(true);
    expect(await route({ cookie: "session=1" })).toBe(false);
    expect(
      await route({
        authorization: "Bearer token",
        "x-agent-native-embed-target": "chat",
      }),
    ).toBe(false);
  });

  it("marks a server save only when an agent started it", () => {
    expect(isAgentCall(serverSaveContext(agent))).toBe(true);
    expect(isAgentCall(serverSaveContext(ownAgent))).toBe(true);
    expect(serverSaveContext(person)).toBeUndefined();
    expect(serverSaveContext(undefined)).toBeUndefined();
  });

  it("doesn't count a person typing in a chat widget", () => {
    expect(isAgentCall({ caller: "mcp-widget-write" })).toBe(false);
  });
});

describe("Agents set to Can comment on a page", () => {
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

  it("still lets an agent change what isn't the text or icon", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Locked text");
      await updateDocument.run({ id: page.id, isFavorite: true }, agent);
      const after = (await readPage(page.id)) as unknown as {
        isFavorite: unknown;
      };
      expect(after.isFavorite).toBe(true);
      expect((await readPage(page.id)).content).toContain("Locked text");
    });
  });

  it("refuses an agent changing the icon, and keeps a person's", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Locked text");
      await expect(
        updateDocument.run({ id: page.id, icon: "🔒" }, agent),
      ).rejects.toMatchObject(locked);
      await expect(
        updateDocument.run({ id: page.id, icon: "🔒" }, ownAgent),
      ).rejects.toMatchObject(locked);
      expect(JSON.stringify(await readIcon(page.id))).not.toContain("🔒");

      await updateDocument.run({ id: page.id, icon: "🔒" }, person);
      expect(JSON.stringify(await readIcon(page.id))).toContain("🔒");
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

  it("refuses an agent turning a locked page into a collection, with or without a new description", async () => {
    await asOwner(async () => {
      const page = await lockedPage("The body");
      const collectionsOnPage = () =>
        getDb()
          .select({ id: schema.contentDatabases.id })
          .from(schema.contentDatabases)
          .where(eq(schema.contentDatabases.documentId, page.id));

      await expect(
        createDatabase.run({ documentId: page.id }, ownAgent),
      ).rejects.toMatchObject(locked);
      await expect(
        createDatabase.run(
          { documentId: page.id, description: "Agent's description" },
          ownAgent,
        ),
      ).rejects.toMatchObject(locked);
      expect(await collectionsOnPage()).toHaveLength(0);
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

  it("refuses an agent adding a Blocks tab to locked rows, new or converted, and lets a person", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      const discovered = await contract(row.databaseId);
      const documentId = discovered.target.databaseDocumentId;
      const agentCall = { caller: "http", userEmail: OWNER } as const;
      type Configured = {
        properties: Array<{
          definition: { id: string; name: string; type: string };
        }>;
      };
      const named = (configured: Configured, name: string) =>
        configured.properties.filter(
          (property) => property.definition.name === name,
        );
      const newTab = {
        documentId,
        databaseId: row.databaseId,
        name: "Agent notes",
        type: "blocks" as const,
      };
      const summary = (
        (await configureProperty.run(
          {
            documentId,
            databaseId: row.databaseId,
            name: "Summary",
            type: "text",
          },
          person,
        )) as Configured
      ).properties.find((property) => property.definition.name === "Summary");
      if (!summary) throw new Error("Fixture has no text field.");
      const toTab = {
        documentId,
        databaseId: row.databaseId,
        id: summary.definition.id,
        name: "Summary",
        type: "blocks" as const,
      };

      await expect(
        configureProperty.run(newTab, agentCall),
      ).rejects.toMatchObject(locked);
      await expect(
        configureProperty.run(toTab, agentCall),
      ).rejects.toMatchObject(locked);

      const converted = (await configureProperty.run(
        toTab,
        person,
      )) as Configured;
      expect(
        named(converted, "Summary").map((property) => property.definition.type),
      ).toEqual(["blocks"]);
      const added = (await configureProperty.run(newTab, person)) as Configured;
      expect(named(added, "Agent notes")).toHaveLength(1);
    });
  });

  it("refuses an agent renaming or hiding a Blocks tab on locked rows, not another column", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      const discovered = await contract(row.databaseId);
      const documentId = discovered.target.databaseDocumentId;
      const agentCall = { caller: "http", userEmail: OWNER } as const;
      const field = async (name: string, type: "blocks" | "text") => {
        const configured = (await configureProperty.run(
          { documentId, databaseId: row.databaseId, name, type },
          person,
        )) as {
          properties: Array<{ definition: { id: string; name: string } }>;
        };
        const property = configured.properties.find(
          (candidate) => candidate.definition.name === name,
        );
        if (!property) throw new Error(`Fixture has no ${name} field.`);
        return property.definition.id;
      };
      const notes = {
        documentId,
        databaseId: row.databaseId,
        id: await field("Notes", "blocks"),
        type: "blocks" as const,
      };
      const status = await field("Status", "text");

      await expect(
        configureProperty.run({ ...notes, name: "Agent's notes" }, agentCall),
      ).rejects.toMatchObject(locked);
      await expect(
        configureProperty.run(
          { ...notes, name: "Notes", visibility: "always_hide" },
          agentCall,
        ),
      ).rejects.toMatchObject(locked);
      await configureProperty.run(
        {
          documentId,
          databaseId: row.databaseId,
          id: status,
          name: "State",
          type: "text",
        },
        agentCall,
      );

      await configureProperty.run(
        { ...notes, name: "Renamed notes", visibility: "always_hide" },
        person,
      );
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

/** Turns the lock on as the next transaction opens: after the action's first read, before its write. */
async function lockedAsTransactionOpens<T>(id: string, run: () => Promise<T>) {
  const db = getDb() as unknown as {
    transaction: (...args: unknown[]) => Promise<unknown>;
  };
  const original = db.transaction;
  db.transaction = async function (this: unknown, ...args: unknown[]) {
    db.transaction = original;
    await setLock.run({ id, locked: true }, person);
    return original.apply(this, args);
  };
  try {
    return await run();
  } finally {
    db.transaction = original;
  }
}

async function unlockedPage(content: string, parentId?: string) {
  const { id } = (await createDocument.run(
    { title: "Unlocked page", content, parentId },
    person,
  )) as { id: string };
  return readPage(id);
}

describe("a lock turned on while a write is under way", () => {
  it("stops an agent's save at its commit", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Before");
      await expect(
        lockedAsTransactionOpens(page.id, () =>
          updateDocument.run({ id: page.id, title: "Agent title" }, agent),
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).title).toBe(page.title);
    });
  });

  it("stops an agent's version restore at its commit", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Current text");
      const now = new Date().toISOString();
      const versionId = `version-${page.id}`;
      await getDb().insert(schema.documentVersions).values({
        id: versionId,
        ownerEmail: OWNER,
        documentId: page.id,
        title: page.title,
        content: "Older text",
        groupId: versionId,
        groupKind: "operation",
        actorKind: "system",
        origin: "test",
        operation: "test",
        checkpointKind: "before",
        createdAt: now,
        updatedAt: now,
      });
      await expect(
        lockedAsTransactionOpens(page.id, () =>
          restoreVersion.run(
            {
              documentId: page.id,
              versionId,
              expectedUpdatedAt: page.updatedAt,
            } as never,
            agent,
          ),
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toContain("Current text");
    });
  });

  it("stops an agent's Blocks value at its commit", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      await setLock.run({ id: row.documentId, locked: false }, person);
      const { listed } = await rowRevision(row.databaseId, row.blocksId, row);
      await expect(
        lockedAsTransactionOpens(row.documentId, () =>
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
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(row.documentId)).content).toContain("First block");
    });
  });

  it("stops an agent keeping a preview draft, and leaves the draft", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Saved text");
      await updateDraft.run({
        operation: "upsert",
        documentId: page.id,
        expectedVersion: null,
        draft: {
          title: page.title,
          content: "Draft text",
          baseDocumentUpdatedAt: page.updatedAt,
          loadedContentWasEmpty: false,
          deferredReason: "conflict" as const,
          editorSessionId: `session-${page.id}`,
          editGeneration: 5,
        },
      });
      const request = {
        choice: "keep_mine" as const,
        documentId: page.id,
        expectedDraftVersion: 1,
        expectedDraftTitle: page.title,
        expectedDraftContent: "Draft text",
        expectedDocumentUpdatedAt: page.updatedAt,
      };
      await expect(
        lockedAsTransactionOpens(page.id, () =>
          resolveDraft.run(request, { caller: "http", userEmail: OWNER }),
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toContain("Saved text");
      const [draft] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, page.id));
      expect(draft.content).toBe("Draft text");
    });
  });

  it("stops a transcript that finishes after the lock, and keeps a person's", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Transcript placeholder");
      const apply = (ctx: typeof agent | typeof person) =>
        applyTranscript({
          documentId: page.id,
          mediaUrl: "https://example.com/talk.mp4",
          mediaType: "video",
          placeholderText: "Transcript placeholder",
          transcript: "The transcript",
          ctx,
        });
      await expect(apply(agent)).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).not.toContain("The transcript");
      await apply(person);
      expect((await readPage(page.id)).content).toContain("The transcript");
    });
  });

  it("stops an agent's write through the live copy at its commit", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Live text");
      await liveCopyPage.putPageOnLiveCopy(page.id, { seeded: true });
      try {
        await setLock.run({ id: page.id, locked: true }, person);
        const base = (await readPage(page.id)).content;
        const write = (ctx: typeof agent | typeof person, candidate: string) =>
          rewriteLiveCopy(page.id, {
            cause: { ctx, operation: "agent-text-lock-test" },
            base,
            candidate,
          });
        await expect(write(agent, "Agent text")).rejects.toMatchObject(locked);
        expect((await readPage(page.id)).content).toBe(base);
        await write(person, "Person text");
        expect((await readPage(page.id)).content).toContain("Person text");
      } finally {
        await liveCopyPage.turnLiveCopyFlagsOff();
      }
    });
  });

  it("stops an agent's block edit through the live copy, and a person's lands", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      await liveCopyPage.putPageOnLiveCopy(row.documentId, { seeded: true });
      try {
        const write = async (
          ctx: typeof agent | typeof person,
          idempotencyKey: string,
          nfm: string,
        ) => {
          const { discovered, listed } = await rowRevision(
            row.databaseId,
            row.blocksId,
            row,
          );
          return mutateBlock.run(
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
              idempotencyKey,
              operation: "insert",
              block: { kind: "paragraph", nfm },
              position: { placement: "end" },
            } as never,
            ctx,
          );
        };
        const version = await liveCopyPage.liveCopyVersionOf(row.documentId);

        await expect(
          write(agent, "live-block-agent", "Agent block"),
        ).rejects.toMatchObject(locked);
        expect((await readPage(row.documentId)).content).not.toContain(
          "Agent block",
        );

        await write(person, "live-block-person", "Person block");
        expect((await readPage(row.documentId)).content).toContain(
          "Person block",
        );
        expect(
          await liveCopyPage.liveCopyVersionOf(row.documentId),
        ).toBeGreaterThan(version ?? 0);
      } finally {
        await liveCopyPage.turnLiveCopyFlagsOff();
      }
    });
  });
});

describe("an agent's call that reaches a locked page another way", () => {
  it("refuses trashing a page that holds a locked sub-page, and lets a person", async () => {
    await asOwner(async () => {
      const parent = await unlockedPage("Parent");
      const child = await unlockedPage("Child", parent.id);
      await setLock.run({ id: child.id, locked: true }, person);

      await expect(
        deleteDocument.run(
          {
            id: parent.id,
            expectedUpdatedAt: parent.updatedAt,
            idempotencyKey: `trash-${parent.id}`,
          },
          agent,
        ),
      ).rejects.toMatchObject(locked);
      const trashedAt = async (id: string) =>
        (
          await getDb()
            .select({ trashedAt: schema.documents.trashedAt })
            .from(schema.documents)
            .where(eq(schema.documents.id, id))
        )[0].trashedAt;
      expect(await trashedAt(child.id)).toBeNull();
      expect(await trashedAt(parent.id)).toBeNull();

      await deleteDocument.run({ id: parent.id }, person);
      expect(await trashedAt(child.id)).not.toBeNull();
    });
  });

  it("doesn't move or reorder a page its import skipped", async () => {
    await asOwner(async () => {
      const other = await unlockedPage("Other");
      const page = await lockedPage("The body");
      const place = async () =>
        (
          await getDb()
            .select({
              parentId: schema.documents.parentId,
              position: schema.documents.position,
            })
            .from(schema.documents)
            .where(eq(schema.documents.id, page.id))
        )[0];
      const before = await place();
      const files = {
        "notes/moved.md": serializeContentSourceDocument({
          id: page.id,
          parentId: other.id,
          title: page.title,
          description: "",
          content: "Imported text",
          icon: null,
          position: before.position + 7,
          isFavorite: false,
          hideFromSearch: false,
          visibility: "private",
        }),
      };
      const result = (await importSource.run(
        { files, dryRun: false },
        agent,
      )) as { skipped: unknown[] };
      expect(result.skipped).toHaveLength(1);
      expect(await place()).toEqual(before);
    });
  });

  async function connectedFile(connectionId: string) {
    const connection = (await connectFolder.run(
      {
        connectionId,
        label: connectionId,
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      } as never,
      person,
    )) as { sourceId: string };
    const first = (await syncFolder.run(
      {
        sourceId: connection.sourceId,
        files: { "guide.md": "# Guide\n\nFirst." },
      },
      person,
    )) as { created: Array<{ id: string }> };
    return { sourceId: connection.sourceId, documentId: first.created[0].id };
  }

  it("refuses a local folder sync whose text an agent supplies, and lets a person", async () => {
    await asOwner(async () => {
      const { sourceId, documentId } = await connectedFile("lock-folder-sync");
      await setLock.run({ id: documentId, locked: true }, person);
      const files = { "guide.md": "# Guide\n\nAgent text." };

      await expect(
        syncFolder.run({ sourceId, files, dryRun: true }, agent),
      ).rejects.toMatchObject(locked);
      await expect(
        syncFolder.run({ sourceId, files }, agent),
      ).rejects.toMatchObject(locked);
      expect((await readPage(documentId)).content).toContain("First.");

      await syncFolder.run({ sourceId, files }, person);
      expect((await readPage(documentId)).content).toContain("Agent text.");
    });
  });

  it("refuses a manifest folder sync an agent starts", async () => {
    await asOwner(async () => {
      const workspace = mkdtempSync(join(tmpdir(), "agent-lock-manifest-"));
      const manifestPath = join(workspace, "agent-native.json");
      const connectionId = "local-folder:agent-lock";
      mkdirSync(join(workspace, "docs"));
      writeFileSync(join(workspace, "docs", "hello.md"), "# Hello\n\nFirst.");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          version: 1,
          apps: {
            content: {
              roots: [
                {
                  name: "Lock docs",
                  path: "docs",
                  extensions: [".md", ".mdx"],
                  source: {
                    type: "local-folder",
                    connectionId,
                    truthPolicy: "source_primary",
                  },
                },
              ],
            },
          },
        }),
      );
      const previousManifest = process.env.AGENT_NATIVE_MANIFEST_PATH;
      process.env.AGENT_NATIVE_MANIFEST_PATH = manifestPath;
      try {
        const request = {
          connectionId,
          file: "docs/hello.md",
          dryRun: false,
        };
        const first = (await syncManifestFolder.run(request, person)) as {
          requestedDocumentId: string;
        };
        const documentId = first.requestedDocumentId;
        await setLock.run({ id: documentId, locked: true }, person);
        writeFileSync(
          join(workspace, "docs", "hello.md"),
          "# Hello\n\nChanged.",
        );
        await expect(
          syncManifestFolder.run(request, agent),
        ).rejects.toMatchObject(locked);
        expect((await readPage(documentId)).content).toContain("First.");
      } finally {
        if (previousManifest === undefined) {
          delete process.env.AGENT_NATIVE_MANIFEST_PATH;
        } else {
          process.env.AGENT_NATIVE_MANIFEST_PATH = previousManifest;
        }
        rmSync(workspace, { force: true, recursive: true });
      }
    });
  });

  it("refuses an agent accepting a folder's text over a locked page, and lets a person", async () => {
    await asOwner(async () => {
      const { sourceId, documentId } = await connectedFile(
        "lock-folder-conflict",
      );
      await getDb()
        .update(schema.documents)
        .set({
          content: "Content-side edit",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.documents.id, documentId));
      const sourceContent = "# Guide\n\nFolder-side edit.";
      await syncFolder.run(
        { sourceId, files: { "guide.md": sourceContent } },
        person,
      );
      const [changeSet] = await getDb()
        .select()
        .from(schema.contentDatabaseSourceChangeSets)
        .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, sourceId));
      await setLock.run({ id: documentId, locked: true }, person);
      const accept = {
        changeSetId: changeSet.id,
        decision: "accept_source" as const,
        sourceContent,
      };

      await expect(
        resolveFolderConflict.run(accept, agent),
      ).rejects.toMatchObject(locked);
      expect((await readPage(documentId)).content).toBe("Content-side edit");

      await resolveFolderConflict.run(accept, person);
      expect((await readPage(documentId)).content).toContain(
        "Folder-side edit.",
      );
    });
  });

  it("refuses an agent pulling a linked Notion page's text, not a push or a person", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Keep this");
      const outcome = (run: Promise<unknown>) =>
        run.catch((error: { errorCode?: string }) => error) as Promise<{
          errorCode?: string;
        }>;

      await expect(
        pullNotion.run({ documentId: page.id }, agent),
      ).rejects.toMatchObject(locked);
      await expect(
        resolveNotionConflict.run(
          { documentId: page.id, direction: "pull" },
          agent,
        ),
      ).rejects.toMatchObject(locked);

      const allowed = await Promise.all([
        outcome(pullNotion.run({ documentId: page.id }, person)),
        outcome(
          resolveNotionConflict.run(
            { documentId: page.id, direction: "push" },
            agent,
          ),
        ),
      ]);
      for (const result of allowed) {
        expect(result.errorCode).not.toBe("AGENT_TEXT_LOCKED");
      }
      expect((await readPage(page.id)).content).toContain("Keep this");
    });
  });
});

describe("a lock turned on just before a write takes the page's row", () => {
  const lockInTransaction = (id: string) => (tx: unknown) =>
    (tx as ReturnType<typeof getDb>)
      .update(schema.documents)
      .set({ agentTextLocked: 1 })
      .where(eq(schema.documents.id, id));

  it("stops an agent's edit, and a person's lands", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Some text");
      const edit = (idempotencyKey: string) => ({
        id: page.id,
        baseRevision: page.revision,
        idempotencyKey,
        find: "Some",
        replace: "Changed",
      });

      beforeRowLock.run = lockInTransaction(page.id);
      await expect(
        editDocument.run(edit("raced-agent-edit"), agent),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toBe(page.content);

      beforeRowLock.run = lockInTransaction(page.id);
      await editDocument.run(edit("raced-person-edit"), person);
      expect((await readPage(page.id)).content).toContain("Changed text");
    });
  });

  it("stops an agent's edit without a base revision, and a person's lands", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Some text");
      const edit = { id: page.id, find: "Some", replace: "Changed" };
      // Other agents must send a revision. A token with the browser's header
      // is the one that takes this path.
      const tokenAsBrowser = {
        ...person,
        requestHeaders: new Headers({ authorization: "Bearer token" }),
      };

      beforeRowLock.run = lockInTransaction(page.id);
      await expect(
        editDocument.run(edit, tokenAsBrowser),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toBe(page.content);

      beforeRowLock.run = lockInTransaction(page.id);
      await editDocument.run(edit, person);
      expect((await readPage(page.id)).content).toContain("Changed text");
    });
  });

  it("lets a linked file's page follow the file that already took the edit", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Some text");
      await getDb()
        .update(schema.documents)
        .set({
          sourceMode: "local-files",
          sourceKind: "file",
          sourcePath: "notes/linked.md",
        })
        .where(eq(schema.documents.id, page.id));
      const linkedLocal = await import("./_linked-local-document-edit.js");
      const fileEdit = vi
        .spyOn(linkedLocal, "editLinkedLocalDocumentThroughBrowser")
        .mockImplementationOnce(async () => ({
          status: "persisted",
          content: "Changed text",
          title: page.title,
          path: "notes/linked.md",
          runtime: "browser",
        }));
      beforeRowLock.run = lockInTransaction(page.id);
      try {
        await editDocument.run(
          { id: page.id, find: "Some", replace: "Changed" },
          {
            ...person,
            requestHeaders: new Headers({ authorization: "Bearer token" }),
          },
        );
        expect(fileEdit).toHaveBeenCalledTimes(1);
        expect((await readPage(page.id)).content).toBe("Changed text");
      } finally {
        fileEdit.mockRestore();
      }
    });
  });

  it("stops an agent deleting a Blocks property, and a person's lands", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      await setLock.run({ id: row.documentId, locked: false }, person);
      const discovered = await contract(row.databaseId);
      const remove = {
        documentId: discovered.target.databaseDocumentId,
        databaseId: row.databaseId,
        propertyId: row.blocksId,
      };

      beforePageRowsLock.run = lockInTransaction(row.documentId);
      await expect(deleteProperty.run(remove, ownAgent)).rejects.toMatchObject(
        locked,
      );
      expect((await readPage(row.documentId)).content).toContain("First block");

      await deleteProperty.run(remove, person);
      expect(
        (await contract(row.databaseId)).properties.map(
          (property) => property.id,
        ),
      ).not.toContain(row.blocksId);
    });
  });

  it("stops an agent changing a Blocks field's type, and a person's lands", async () => {
    await asOwner(async () => {
      const row = await collectionRow();
      await setLock.run({ id: row.documentId, locked: false }, person);
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

      beforePageRowsLock.run = lockInTransaction(row.documentId);
      await expect(
        configureProperty.run(change, { caller: "http", userEmail: OWNER }),
      ).rejects.toMatchObject(locked);
      expect(
        (await contract(row.databaseId)).properties.find(
          (property) => property.id === notes.definition.id,
        )?.type,
      ).toBe("blocks");

      await configureProperty.run(change, person);
    });
  });

  it("stops an agent refreshing a local file's copy, and a person's lands", async () => {
    await asOwner(async () => {
      const id = "content_agent_lock_local_file";
      const now = new Date().toISOString();
      await getDb().insert(schema.documents).values({
        id,
        ownerEmail: OWNER,
        title: "Synced note",
        content: "First body",
        sourceMode: "local-files",
        sourceKind: "file",
        sourcePath: "notes/locked.md",
        sourceRootPath: "agent-lock-folder",
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      });
      const copy = (await shareLocalFile.run({ id }, person)) as { id: string };
      await getDb()
        .update(schema.documents)
        .set({ content: "Later body" })
        .where(eq(schema.documents.id, id));

      beforeRowLock.run = lockInTransaction(copy.id);
      await expect(shareLocalFile.run({ id }, agent)).rejects.toMatchObject(
        locked,
      );
      expect((await readPage(copy.id)).content).toBe("First body");

      beforeRowLock.run = lockInTransaction(copy.id);
      await shareLocalFile.run({ id }, person);
      expect((await readPage(copy.id)).content).toBe("Later body");
    });
  });

  it("stops an agent accepting a suggestion, and a person's lands", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Keep the first draft.");
      const created = (await suggestEdit.run(
        {
          id: page.id,
          baseRevision: page.revision,
          idempotencyKey: `raced-suggest-${page.id}`,
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

      beforeAcceptTransaction.run = () => lockInTransaction(page.id)(getDb());
      await expect(
        decideSuggestion.run(decision("raced-agent-accept"), agent),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toContain("first draft");

      await decideSuggestion.run(decision("raced-person-accept"), person);
      expect((await readPage(page.id)).content).toContain("second draft");
    });
  });
});

describe("an agent's Builder push to an entry a locked page follows", () => {
  const colleague = "colleague@example.com";
  const model = "docs-content";
  const asColleague = <T>(run: () => Promise<T>) =>
    runWithRequestContext({ userEmail: colleague, orgId: null }, run);
  const lockedFollowingPage = (entryId: string) =>
    asOwner(async () => {
      const page = await lockedPage("Some text");
      await getDb()
        .update(schema.documents)
        .set({
          sourceMode: BUILDER_DOCS_MDX_SOURCE_MODE,
          sourceKind: builderSourceKindForModel(model),
          sourceRootPath: builderSourceRootPath({
            entryId,
            sourceHash: "source",
            blocksHash: "blocks",
          }),
        })
        .where(eq(schema.documents.id, page.id));
      return page;
    });
  const check = async (entryId: string, caller: "mcp" | "frontend") => {
    const { assertAgentMayPushBuilderEntry } =
      await import("./_builder-docs-client.js");
    return assertAgentMayPushBuilderEntry({
      model,
      entryId,
      ctx: { caller, userEmail: colleague },
    });
  };

  it("refuses when someone else's page, shared with the caller, follows it", async () => {
    const page = await lockedFollowingPage("builder-entry-shared");
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: `share-${crypto.randomUUID()}`,
        resourceId: page.id,
        principalType: "user",
        principalId: colleague,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });

    await asColleague(async () => {
      await expect(check("builder-entry-shared", "mcp")).rejects.toMatchObject(
        locked,
      );
      await expect(
        check("builder-entry-shared", "frontend"),
      ).resolves.toBeUndefined();
    });
  });

  it("finds the page by its exact entry ID, characters LIKE treats as wildcards included", async () => {
    const entryId = String.raw`builder_entry%with\odd`;
    await lockedFollowingPage(entryId);
    const push = (pushed: string) =>
      asOwner(async () => {
        const { assertAgentMayPushBuilderEntry } =
          await import("./_builder-docs-client.js");
        return assertAgentMayPushBuilderEntry({
          model,
          entryId: pushed,
          ctx: { caller: "mcp", userEmail: OWNER },
        });
      });

    await expect(push(entryId)).rejects.toMatchObject(locked);
    await expect(push("builder_entry")).resolves.toBeUndefined();
    await expect(push("builder%")).resolves.toBeUndefined();
  });

  it("isn't stopped by a locked page the caller can't reach", async () => {
    await lockedFollowingPage("builder-entry-unreachable");

    await asColleague(async () => {
      await expect(
        check("builder-entry-unreachable", "mcp"),
      ).resolves.toBeUndefined();
    });
  });
});

describe("a save the server runs on an agent's behalf", () => {
  const image = "https://example.com/diagram.png";
  const altText = (documentId: string) => ({
    documentId,
    imageUrl: image,
    altText: "New",
  });
  const transcript = (documentId: string, ctx: typeof agent | typeof person) =>
    applyTranscript({
      documentId,
      mediaUrl: "https://example.com/talk.mp4",
      mediaType: "video",
      placeholderText: "Transcript placeholder",
      transcript: "The transcript",
      ctx,
    });

  it("still lands on an unlocked page", async () => {
    await asOwner(async () => {
      const page = await unlockedPage(`![Old](${image})`);
      await setImageAlt.run(altText(page.id), agent);
      expect((await readPage(page.id)).content).toContain("![New]");

      const other = await unlockedPage("Transcript placeholder");
      await transcript(other.id, agent);
      expect((await readPage(other.id)).content).toContain("The transcript");
    });
  });

  it("stops alt text when the lock lands after its first check, and keeps a person's", async () => {
    await asOwner(async () => {
      const page = await unlockedPage(`![Old](${image})`);
      await expect(
        lockedAsTransactionOpens(page.id, () =>
          setImageAlt.run(altText(page.id), agent),
        ),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toBe(page.content);

      const other = await unlockedPage(`![Old](${image})`);
      await lockedAsTransactionOpens(other.id, () =>
        setImageAlt.run(altText(other.id), person),
      );
      expect((await readPage(other.id)).content).toContain("![New]");
    });
  });

  it("stops a transcript when the lock lands after its first check, and keeps a person's", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Transcript placeholder");
      await expect(
        lockedAsTransactionOpens(page.id, () => transcript(page.id, agent)),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toBe(page.content);

      const other = await unlockedPage("Transcript placeholder");
      await lockedAsTransactionOpens(other.id, () =>
        transcript(other.id, person),
      );
      expect((await readPage(other.id)).content).toContain("The transcript");
    });
  });
});

describe("Notion's text reaching a locked page", () => {
  const OLD_TIME = "2026-11-01T12:00:00.000Z";
  const NEW_TIME = "2026-11-02T12:00:00.000Z";
  const remoteId = (digit: string) => digit.repeat(32);
  const remote = (content: string, title = "Notion title") => ({
    title,
    content,
    icon: null,
    lastEditedTime: NEW_TIME,
    warnings: [],
  });
  const linkToNotion = (
    page: { id: string; updatedAt: string },
    remotePageId: string,
  ) =>
    getDb().insert(schema.documentSyncLinks).values({
      documentId: page.id,
      ownerEmail: OWNER,
      remotePageId,
      state: "linked",
      lastSyncedAt: OLD_TIME,
      lastPulledRemoteUpdatedAt: OLD_TIME,
      lastPushedLocalUpdatedAt: page.updatedAt,
      lastKnownRemoteUpdatedAt: OLD_TIME,
      hasConflict: 0,
      warningsJson: "[]",
    });
  const readLink = async (id: string) => {
    const [link] = await getDb()
      .select()
      .from(schema.documentSyncLinks)
      .where(eq(schema.documentSyncLinks.documentId, id));
    return link;
  };
  const lockThenAnswer = (id: string, content: string) => async () => {
    await setLock.run({ id, locked: true }, person);
    return remote(content);
  };

  it("tells an agent when a lock stops the pull after create-and-link made the page", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Keep this");
      notion.createPage.mockResolvedValueOnce({ id: remoteId("3") });
      notion.readPage.mockImplementationOnce(
        lockThenAnswer(page.id, "Notion text"),
      );

      await expect(
        createAndLinkNotion.run(
          { documentId: page.id, parentPageIdOrUrl: remoteId("4") },
          agent,
        ),
      ).rejects.toMatchObject({
        ...locked,
        message: expect.stringContaining(
          `Created Notion page ${remoteId("3")}`,
        ),
      });

      expect((await readLink(page.id)).remotePageId).toBe(remoteId("3"));
      expect((await readPage(page.id)).content).toBe(page.content);
    });
  });

  beforeEach(() => {
    for (const mock of Object.values(notion)) mock.mockReset();
    notion.getConnection.mockResolvedValue({ accessToken: "token" });
    notion.requireConnection.mockResolvedValue({ accessToken: "token" });
    notion.fetchPage.mockImplementation(async (_token: string, id: string) => ({
      id,
      last_edited_time: NEW_TIME,
    }));
    notion.readPage.mockResolvedValue(remote("Notion text"));
    notion.owner.mockResolvedValue(OWNER);
  });

  it("stops an agent's pull when the lock lands while Notion answers, and keeps a person's", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Local text");
      await linkToNotion(page, remoteId("a"));

      notion.readPage.mockImplementationOnce(
        lockThenAnswer(page.id, "Notion text"),
      );
      await expect(
        pullNotion.run({ documentId: page.id }, agent),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toBe(page.content);

      await pullNotion.run({ documentId: page.id }, person);
      expect((await readPage(page.id)).content).toContain("Notion text");
    });
  });

  it("pulls an agent's parent page, and leaves a locked linked child with an error on its link", async () => {
    await asOwner(async () => {
      const parent = await unlockedPage("Parent text");
      const child = await lockedPage("Child text");
      await linkToNotion(parent, remoteId("b"));
      await linkToNotion(child, remoteId("c"));
      notion.readPage.mockImplementation(async (_token: string, id: string) =>
        id === remoteId("b")
          ? remote(
              `Parent from Notion\n\n<page url="https://www.notion.so/${remoteId("c")}">Child</page>`,
              "Parent",
            )
          : remote("Child from Notion", "Child"),
      );

      await pullNotion.run({ documentId: parent.id }, agent);

      expect((await readPage(parent.id)).content).toContain(
        "Parent from Notion",
      );
      expect((await readPage(child.id)).content).toBe(child.content);
      const link = await readLink(child.id);
      expect(link.state).toBe("error");
      expect(link.lastError).toContain("locked");
    });
  });

  it("refuses an agent linking a locked page before anything changes", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Keep this");
      await expect(
        linkNotion.run({ documentId: page.id, pageId: remoteId("d") }, agent),
      ).rejects.toMatchObject(locked);
      await expect(
        createAndLinkNotion.run({ documentId: page.id }, agent),
      ).rejects.toMatchObject(locked);
      expect(notion.fetchPage).not.toHaveBeenCalled();
      expect(await readLink(page.id)).toBeUndefined();
      expect((await readPage(page.id)).content).toBe(page.content);
    });
  });

  it("puts back the old link when a lock lands during an agent's link", async () => {
    await asOwner(async () => {
      const page = await unlockedPage("Keep this");
      await linkToNotion(page, remoteId("e"));
      notion.readPage.mockImplementationOnce(
        lockThenAnswer(page.id, "Notion text"),
      );

      await expect(
        linkNotion.run({ documentId: page.id, pageId: remoteId("f") }, agent),
      ).rejects.toMatchObject(locked);

      expect((await readLink(page.id)).remotePageId).toBe(remoteId("e"));
      expect((await readPage(page.id)).content).toBe(page.content);
    });
  });

  it("refuses an agent's auto-sync pull into a locked page, not a person's", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Keep this");
      await linkToNotion(page, remoteId("1"));
      await expect(
        refreshNotion.run({ documentId: page.id, autoSync: true }, agent),
      ).rejects.toMatchObject(locked);
      expect((await readPage(page.id)).content).toBe(page.content);

      const other = await lockedPage("Keep this");
      await linkToNotion(other, remoteId("2"));
      await refreshNotion.run({ documentId: other.id, autoSync: true }, person);
      expect((await readPage(other.id)).content).toContain("Notion text");
    });
  });

  it("lets an agent push a locked page, which keeps its text when Notion tidies it", async () => {
    await asOwner(async () => {
      const page = await lockedPage("Keep this");
      await linkToNotion(page, remoteId("3"));
      notion.fetchPage.mockResolvedValue({
        id: remoteId("3"),
        last_edited_time: OLD_TIME,
      });
      notion.pushPage.mockResolvedValue(remote("Notion's tidied text"));

      await pushNotion.run({ documentId: page.id }, agent);
      expect(notion.pushPage).toHaveBeenCalledTimes(1);
      expect((await readPage(page.id)).content).toBe(page.content);

      await pushNotion.run({ documentId: page.id }, person);
      expect((await readPage(page.id)).content).toContain("tidied");
    });
  });

  it("counts a token on a plain Notion route as an agent, and a browser's cookie as a person", async () => {
    await asOwner(async () => {
      const route = (
        await import("../server/routes/api/documents/[id]/notion/pull.post.js")
      ).default as unknown as (event: unknown) => Promise<unknown>;
      const request = (id: string, headers: Record<string, string>) => ({
        context: { params: { id } },
        headers: new Headers(headers),
      });
      const page = await lockedPage("Keep this");
      await linkToNotion(page, remoteId("4"));

      await expect(
        route(request(page.id, { authorization: "Bearer token" })),
      ).rejects.toMatchObject({
        statusCode: 403,
        data: { errorCode: "AGENT_TEXT_LOCKED" },
      });
      expect((await readPage(page.id)).content).toBe(page.content);

      await route(request(page.id, { cookie: "session=1" }));
      expect((await readPage(page.id)).content).toContain("Notion text");
    });
  });
});

async function viewOnlyPage(content: string) {
  const { id } = (await createDocument.run(
    { title: "View-only page", content },
    person,
  )) as { id: string };
  await setLock.run({ id, level: "view" }, person);
  return readPage(id);
}

async function storedLevel(id: string) {
  const rows = await getDb()
    .select({ agentTextLocked: schema.documents.agentTextLocked })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return rows.map((row) => row.agentTextLocked);
}

describe("Agents set to Can view on a page", () => {
  it("stores each level, reports it, and keeps the text lock a yes for both limits", async () => {
    await asOwner(async () => {
      const { id } = (await createDocument.run(
        { title: "Levels", content: "Text" },
        person,
      )) as { id: string };
      const levelOf = async () =>
        (await getDocument.run({ id }, person)) as {
          agentLevel: string;
          agentTextLocked: boolean;
        };

      for (const [level, stored, textLocked] of [
        ["view", 2, true],
        ["comment", 1, true],
        ["edit", 0, false],
      ] as const) {
        await expect(setLock.run({ id, level }, person)).resolves.toMatchObject(
          { agentLevel: level, agentTextLocked: textLocked },
        );
        expect(await storedLevel(id)).toEqual([stored]);
        expect(await levelOf()).toMatchObject({
          agentLevel: level,
          agentTextLocked: textLocked,
        });
      }

      // A page loaded before Can view still sends locked.
      await setLock.run({ id, locked: true }, person);
      expect(await storedLevel(id)).toEqual([1]);
      await setLock.run({ id, locked: false }, person);
      expect(await storedLevel(id)).toEqual([0]);
    });
  });

  it("takes a level or the old lock, not both or neither, and only from a person", async () => {
    await asOwner(async () => {
      const { id } = (await createDocument.run(
        { title: "Setter", content: "Text" },
        person,
      )) as { id: string };
      await expect(setLock.run({ id } as never, person)).rejects.toBeTruthy();
      await expect(
        setLock.run({ id, level: "view", locked: true }, person),
      ).rejects.toBeTruthy();
      await expect(
        setLock.run({ id, level: "view" }, agent),
      ).rejects.toBeTruthy();
      await expect(
        setLock.run({ id, level: "view" }, ownAgent),
      ).rejects.toBeTruthy();
      expect(await storedLevel(id)).toEqual([0]);
    });
  });

  it("reads a level it doesn't know as Can view", async () => {
    await asOwner(async () => {
      const { id } = (await createDocument.run(
        { title: "Unknown level", content: "Text" },
        person,
      )) as { id: string };
      await getDb()
        .update(schema.documents)
        .set({ agentTextLocked: 7 })
        .where(eq(schema.documents.id, id));
      expect(await getDocument.run({ id }, person)).toMatchObject({
        agentLevel: "view",
        agentTextLocked: true,
      });
      await expect(
        addComment.run({ documentId: id, content: "Hi" }, agent),
      ).rejects.toMatchObject(viewOnly);
    });
  });

  it("refuses an agent's text and icon with its own message, and keeps a person's", async () => {
    await asOwner(async () => {
      const page = await viewOnlyPage("Read-only text");
      await expect(
        editDocument.run(
          {
            id: page.id,
            baseRevision: page.revision,
            idempotencyKey: `view-edit-${page.id}`,
            find: "Read-only",
            replace: "Changed",
          },
          agent,
        ),
      ).rejects.toMatchObject(viewOnly);
      for (const change of [
        { title: "Changed title" },
        { description: "Changed description" },
        { icon: "🔒" },
      ]) {
        await expect(
          updateDocument.run({ id: page.id, ...change }, agent),
        ).rejects.toMatchObject(viewOnly);
      }
      expect(JSON.stringify(await readIcon(page.id))).not.toContain("🔒");
      await expect(
        deleteDocument.run(
          {
            id: page.id,
            expectedUpdatedAt: page.updatedAt,
            idempotencyKey: `view-trash-${page.id}`,
          },
          agent,
        ),
      ).rejects.toMatchObject(viewOnly);

      await updateDocument.run(
        { id: page.id, title: "Person title", icon: "🔒" },
        person,
      );
      const after = await readPage(page.id);
      expect(after.title).toBe("Person title");
      expect(after.content).toContain("Read-only text");
      expect(JSON.stringify(await readIcon(page.id))).toContain("🔒");
    });
  });

  it("refuses an agent's comments, replies, edits, resolves, deletions and reactions", async () => {
    await asOwner(async () => {
      const page = await viewOnlyPage("Comment here.");
      const root = (await addComment.run(
        { documentId: page.id, content: "A person's note." },
        person,
      )) as { id: string; threadId: string };

      const refused = [
        () => addComment.run({ documentId: page.id, content: "Hi" }, agent),
        () =>
          addComment.run(
            {
              documentId: page.id,
              content: "A reply",
              threadId: root.threadId,
              parentId: root.id,
            },
            ownAgent,
          ),
        () =>
          updateComment.run(
            { id: root.id, documentId: page.id, content: "Edited" },
            agent,
          ),
        () =>
          updateComment.run(
            { id: root.id, documentId: page.id, resolved: true },
            agent,
          ),
        () => deleteComment.run({ id: root.id, documentId: page.id }, agent),
        () =>
          reactToComment.run(
            {
              documentId: page.id,
              commentId: root.id,
              reaction: "👍",
              active: true,
            },
            agent,
          ),
      ];
      for (const call of refused) {
        await expect(call()).rejects.toMatchObject(viewOnly);
      }
      const comments = await getDb()
        .select()
        .from(schema.documentComments)
        .where(eq(schema.documentComments.documentId, page.id));
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        content: "A person's note.",
        resolved: 0,
      });
    });
  });

  it("lets a person comment, reply, edit, react and delete there", async () => {
    await asOwner(async () => {
      const page = await viewOnlyPage("Comment here.");
      const root = (await addComment.run(
        { documentId: page.id, content: "A person's note." },
        person,
      )) as { id: string; threadId: string };
      await addComment.run(
        {
          documentId: page.id,
          content: "A person's reply",
          threadId: root.threadId,
          parentId: root.id,
        },
        person,
      );
      await updateComment.run(
        { id: root.id, documentId: page.id, content: "Edited" },
        person,
      );
      await reactToComment.run(
        {
          documentId: page.id,
          commentId: root.id,
          reaction: "👍",
          active: true,
        },
        person,
      );
      await deleteComment.run({ id: root.id, documentId: page.id }, person);
    });
  });

  it("refuses an agent's suggested edits by every path, and its review comments", async () => {
    await asOwner(async () => {
      const page = await viewOnlyPage("Keep the first draft.");
      await expect(
        suggestEdit.run(
          {
            id: page.id,
            baseRevision: page.revision,
            idempotencyKey: `view-suggest-${page.id}`,
            find: "first draft",
            replace: "second draft",
          },
          agent,
        ),
      ).rejects.toMatchObject(viewOnly);
      // Core refuses before it reads the proposal.
      await expect(
        createSuggestion.run(
          {
            resourceType: "document",
            resourceId: page.id,
            adapterKind: "content-document",
            baseRevision: page.revision,
            summary: "Second draft",
            idempotencyKey: `view-core-suggest-${page.id}`,
            operations: [{ ordinal: 0, kind: "replace", schemaVersion: 1 }],
          } as never,
          agent,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      const listed = (await listSuggestions.run(
        { resourceType: "document", resourceId: page.id },
        person,
      )) as { suggestions: unknown[] };
      expect(listed.suggestions).toEqual([]);

      const review = { resourceType: "document", resourceId: page.id };
      await expect(
        createReviewComment.run({ ...review, body: "Agent note" }, agent),
      ).rejects.toMatchObject({ statusCode: 403 });
      const thread = (await createReviewComment.run(
        { ...review, body: "Person note" },
        person,
      )) as { id: string };
      await expect(
        replyReviewComment.run(
          { ...review, commentId: thread.id, body: "Agent reply" },
          agent,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        reactToReviewComment.run(
          { ...review, commentId: thread.id, reaction: "👍", active: true },
          agent,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await replyReviewComment.run(
        { ...review, commentId: thread.id, body: "Person reply" },
        person,
      );
    });
  });

  it("refuses an agent's Notion comment sync before reaching Notion, not a person's", async () => {
    await asOwner(async () => {
      const page = await viewOnlyPage("Synced page");
      await expect(
        syncNotionComments.run({ documentId: page.id }, agent),
      ).rejects.toMatchObject(viewOnly);
      // Unlinked, so a call that gets past the level stops here.
      const unlinked = "Document is not linked to Notion. Link it first.";
      await expect(
        syncNotionComments.run({ documentId: page.id }, person),
      ).resolves.toBe(unlinked);
      await setLock.run({ id: page.id, level: "comment" }, person);
      await expect(
        syncNotionComments.run({ documentId: page.id }, agent),
      ).resolves.toBe(unlinked);
    });
  });

  it("lets agents comment, react, suggest and review at Can comment and Can edit", async () => {
    await asOwner(async () => {
      for (const level of ["comment", "edit"] as const) {
        const { id } = (await createDocument.run(
          { title: `Agents ${level}`, content: "Keep the first draft." },
          person,
        )) as { id: string };
        await setLock.run({ id, level }, person);
        const page = await readPage(id);

        const root = (await addComment.run(
          { documentId: id, content: "An agent's note." },
          agent,
        )) as { id: string; threadId: string };
        await addComment.run(
          {
            documentId: id,
            content: "An agent's reply",
            threadId: root.threadId,
            parentId: root.id,
          },
          ownAgent,
        );
        await updateComment.run(
          { id: root.id, documentId: id, content: "Edited by an agent" },
          agent,
        );
        await reactToComment.run(
          { documentId: id, commentId: root.id, reaction: "👍", active: true },
          agent,
        );
        await suggestEdit.run(
          {
            id,
            baseRevision: page.revision,
            idempotencyKey: `${level}-suggest-${id}`,
            find: "first draft",
            replace: "second draft",
          },
          agent,
        );
        const review = { resourceType: "document", resourceId: id };
        const thread = (await createReviewComment.run(
          { ...review, body: "Agent note" },
          agent,
        )) as { id: string };
        await replyReviewComment.run(
          { ...review, commentId: thread.id, body: "Agent reply" },
          agent,
        );
        await reactToReviewComment.run(
          { ...review, commentId: thread.id, reaction: "👍", active: true },
          agent,
        );
        await deleteComment.run({ id: root.id, documentId: id }, agent);
      }
    });
  });

  it("still returns the receipt of a comment that landed before the switch", async () => {
    await asOwner(async () => {
      const { id } = (await createDocument.run(
        { title: "Receipt", content: "Text" },
        person,
      )) as { id: string };
      await setLock.run({ id, level: "comment" }, person);
      const comment = {
        documentId: id,
        content: "Landed first",
        clientOperationId: crypto.randomUUID(),
      };
      const first = (await addComment.run(comment, agent)) as { id: string };
      await setLock.run({ id, level: "view" }, person);
      await expect(addComment.run(comment, agent)).resolves.toMatchObject({
        id: first.id,
        replayed: true,
      });
      await expect(
        addComment.run(
          {
            ...comment,
            content: "New",
            clientOperationId: crypto.randomUUID(),
          },
          agent,
        ),
      ).rejects.toMatchObject(viewOnly);
    });
  });
});
