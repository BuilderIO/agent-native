import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseIconValue } from "@agent-native/core/icons";
import { runWithRequestContext } from "@agent-native/core/server";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `update-document-cas-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let updateDocumentAction: typeof import("./update-document.js").default;
let getDocumentSaveAttemptAction: typeof import("./get-document-save-attempt.js").default;
let updatePersonalViewAction: typeof import("./update-content-database-personal-view.js").default;
let editDocumentAction: typeof import("./edit-document.js").default;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const VIEWER = "viewer@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  updateDocumentAction = (await import("./update-document.js")).default;
  getDocumentSaveAttemptAction = (
    await import("./get-document-save-attempt.js")
  ).default;
  updatePersonalViewAction = (
    await import("./update-content-database-personal-view.js")
  ).default;
  editDocumentAction = (await import("./edit-document.js")).default;
  ({ documentRevisionToken } = await import("./_document-edit-mutation.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createDocument(args: {
  id?: string;
  title?: string;
  content?: string;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = args.id ?? nextId("doc");
  await db.insert(schema.documents).values({
    id,
    ownerEmail: args.ownerEmail ?? OWNER,
    parentId: null,
    title: args.title ?? "Untitled",
    content: args.content ?? "",
    position: 0,
    visibility: "private",
    orgId: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function documentRow(documentId: string) {
  const db = getDb();
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  return document;
}

describe("update-document compare-and-swap", () => {
  it("normalizes a duplicate title heading in an authored browser save", async () => {
    const id = await createDocument({ title: "Page", content: "Body before" });
    const revision = documentRevisionToken(0, "Body before");
    const saved = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: "# Page\nBody after",
          baseRevision: revision,
          authoredBaseRevision: revision,
          authoredBaseContent: "Body before",
          authoredCandidateContent: "# Page\nBody after",
          editorSessionId: nextId("heading-session"),
          editorEditGeneration: 1,
          browserSaveAttemptId: nextId("heading-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(saved.content).toBe("Body after");
    expect((await documentRow(id)).content).toBe("Body after");
  });

  it("uses the locked body revision for a verified authored merge with only baseUpdatedAt", async () => {
    const base = "First passage\nSecond passage";
    const id = await createDocument({ content: base });
    const before = await documentRow(id);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: documentRevisionToken(0, base),
          idempotencyKey: nextId("mcp-before-timestamp-save"),
          find: "First passage",
          replace: "Agent first",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const saved = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: "First passage\nBrowser second",
          baseUpdatedAt: before.updatedAt,
          authoredBaseRevision: documentRevisionToken(0, base),
          authoredBaseContent: base,
          authoredCandidateContent: "First passage\nBrowser second",
          editorSessionId: nextId("timestamp-session"),
          editorEditGeneration: 1,
          browserSaveAttemptId: nextId("timestamp-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(saved).toMatchObject({
      content: "Agent first\nBrowser second",
      bodyIntentOutcome: { status: "applied" },
    });
    expect((await documentRow(id)).bodyRevision).toBe(2);
  });

  it("replays a preserved attempt without duplicating its History checkpoint", async () => {
    const base = "First passage\nSecond passage";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: revision,
          idempotencyKey: nextId("mcp-before-preservation"),
          find: "First passage",
          replace: "Agent first",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const candidate = "First passage\nInserted passage\nSecond passage";
    const attemptId = nextId("preserved-attempt");
    const args = {
      id,
      title: "Draft title",
      baseTitle: "Untitled",
      content: candidate,
      baseRevision: revision,
      authoredBaseRevision: revision,
      authoredBaseContent: base,
      authoredCandidateContent: candidate,
      editorSessionId: nextId("preserved-session"),
      editorEditGeneration: 1,
      browserSaveAttemptId: attemptId,
    };
    const invoke = (input: typeof args) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(input, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    const first = await invoke(args);
    const retry = await invoke(args);
    expect(first).toMatchObject({
      preservationRequired: true,
      reason: "structure",
    });
    expect(retry).toMatchObject({
      preservationRequired: true,
      checkpointId: first.checkpointId,
    });
    const [preserved] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, first.checkpointId));
    expect(preserved).toMatchObject({
      title: "Draft title",
      content: candidate,
    });
    expect((await documentRow(id)).title).toBe("Untitled");
    const lookup = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentSaveAttemptAction.run({ id, browserSaveAttemptId: attemptId }),
    );
    expect(lookup).toMatchObject({
      found: true,
      preservationRequired: {
        checkpointId: first.checkpointId,
        reason: "structure",
      },
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id)),
    ).toHaveLength(3);
    expect(
      await getDb()
        .select()
        .from(schema.documentBrowserSaveAttempts)
        .where(eq(schema.documentBrowserSaveAttempts.documentId, id)),
    ).toHaveLength(1);
    await expect(
      invoke({ ...args, content: `${candidate}\nchanged` }),
    ).rejects.toMatchObject({ errorCode: "BROWSER_SAVE_ATTEMPT_REUSED" });
  });

  it("settles a represented browser generation after an independent MCP edit is merged", async () => {
    const base = "First passage\nSecond passage";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    const session = nextId("browser-session");
    const browserCandidate = "First passage\nBrowser second";
    await getDb()
      .insert(schema.documentPreviewDrafts)
      .values({
        id: nextId("draft"),
        ownerEmail: OWNER,
        orgId: "",
        documentId: id,
        title: "Untitled",
        content: browserCandidate,
        editorSessionId: session,
        editGeneration: 1,
      });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: revision,
          idempotencyKey: nextId("mcp-first"),
          find: "First passage",
          replace: "Agent first",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const saved = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: browserCandidate,
          baseRevision: revision,
          authoredBaseRevision: revision,
          authoredBaseContent: base,
          authoredCandidateContent: browserCandidate,
          editorSessionId: session,
          editorEditGeneration: 1,
          editorSnapshotTitle: "Untitled",
          editorSnapshotContent: browserCandidate,
          browserSaveAttemptId: nextId("browser-after-mcp"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(saved).toMatchObject({
      content: "Agent first\nBrowser second",
      bodyIntentOutcome: { status: "applied" },
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, id)),
    ).toHaveLength(0);
  });

  it("persists a peer observation after the local authored attempt already committed", async () => {
    const base = "Original passage\nTail";
    const local = "Local passage\nTail";
    const observed = "Local passage\nTail\nPeer passage";
    const id = await createDocument({ content: base });
    const session = nextId("browser-session");
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: local,
          baseRevision: documentRevisionToken(0, base),
          authoredBaseRevision: documentRevisionToken(0, base),
          authoredBaseContent: base,
          authoredCandidateContent: local,
          editorSessionId: session,
          editorEditGeneration: 1,
          editorSnapshotTitle: "Untitled",
          editorSnapshotContent: local,
          browserSaveAttemptId: nextId("local-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(first.content).toBe(local);

    const replay = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: observed,
          baseRevision: first.revision,
          editorSessionId: session,
          editorEditGeneration: 1,
          editorSnapshotTitle: "Untitled",
          editorSnapshotContent: observed,
          browserSaveAttemptId: nextId("observed-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(replay.content).toBe(observed);
    expect((await documentRow(id)).content).toBe(observed);
  });

  it("replays the exact receipt after its editor generation settles", async () => {
    const id = await createDocument({ content: "Before" });
    const args = {
      id,
      content: "After",
      editorSessionId: nextId("settled-replay-session"),
      editorEditGeneration: 1,
      editorSnapshotTitle: "Untitled",
      editorSnapshotContent: "After",
      browserSaveAttemptId: nextId("settled-replay-attempt"),
    };
    const save = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );

    const first = await save();
    const retry = await save();

    expect(first).toMatchObject({
      content: "After",
      browserSaveAttempt: { result: "applied" },
    });
    expect(retry).toMatchObject({
      content: "After",
      browserSaveAttempt: { result: "replayed" },
    });
    expect(await documentRow(id)).toMatchObject({
      content: "After",
      bodyRevision: 1,
    });
  });

  it("converges overlapping browser sessions regardless of save delivery order", async () => {
    const base = "Base passage\nUnrelated passage";
    const revision = documentRevisionToken(0, base);
    const results: string[] = [];
    for (const order of [
      ["a", "z"],
      ["z", "a"],
    ] as const) {
      const id = await createDocument({ content: base });
      for (const session of order) {
        const candidate = `${session} passage\nUnrelated passage`;
        await runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              content: candidate,
              baseRevision: revision,
              authoredBaseRevision: revision,
              authoredBaseContent: base,
              authoredCandidateContent: candidate,
              editorSessionId: session,
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("overlap-attempt"),
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        );
      }
      results.push((await documentRow(id)).content);
      const history = await getDb()
        .select({ content: schema.documentVersions.content })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id));
      expect(
        history.map((version: { content: string }) => version.content),
      ).toContain("a passage\nUnrelated passage");
    }
    expect(results).toEqual([
      "z passage\nUnrelated passage",
      "z passage\nUnrelated passage",
    ]);
  });

  it("replays a displaced editor generation through a new transport attempt", async () => {
    const base = "Shared passage\nOther passage";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: revision,
          idempotencyKey: nextId("agent-overlap"),
          find: "Shared passage",
          replace: "Agent passage",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const candidate = "Browser passage\nOther passage";
    const identity = {
      id,
      content: candidate,
      baseRevision: revision,
      authoredBaseRevision: revision,
      authoredBaseContent: base,
      authoredCandidateContent: candidate,
      editorSessionId: nextId("displaced-session"),
      editorEditGeneration: 1,
    };
    const save = (attemptId: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          { ...identity, browserSaveAttemptId: attemptId },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
    const first = await save(nextId("first-attempt"));
    const retry = await save(nextId("retry-attempt"));
    expect(first.bodyIntentOutcome).toMatchObject({
      status: "displaced-preserved",
    });
    expect(retry.bodyIntentOutcome).toEqual(first.bodyIntentOutcome);
    expect((await documentRow(id)).content).toBe(
      "Agent passage\nOther passage",
    );
    expect(
      await getDb()
        .select()
        .from(schema.documentBodyIntents)
        .where(eq(schema.documentBodyIntents.documentId, id)),
    ).toHaveLength(2);
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id)),
    ).toHaveLength(3);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          {
            ...identity,
            content: "Different browser passage\nOther passage",
            authoredCandidateContent:
              "Different browser passage\nOther passage",
            browserSaveAttemptId: nextId("reused-generation"),
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "EDITOR_BODY_INTENT_REUSED" });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          {
            ...identity,
            title: "Different title",
            baseTitle: "Untitled",
            browserSaveAttemptId: nextId("reused-generation-title"),
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "EDITOR_BODY_INTENT_REUSED" });
  });

  it("replays an applied editor generation after a later independent edit", async () => {
    const base = "Browser base\nAgent base";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    const session = nextId("applied-session");
    const args = {
      id,
      content: "Browser changed\nAgent base",
      baseRevision: revision,
      authoredBaseRevision: revision,
      authoredBaseContent: base,
      authoredCandidateContent: "Browser changed\nAgent base",
      editorSessionId: session,
      editorEditGeneration: 1,
    };
    const save = (browserSaveAttemptId: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          { ...args, browserSaveAttemptId },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
    await save(nextId("first-applied"));
    const afterBrowser = await documentRow(id);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: documentRevisionToken(
            afterBrowser.bodyRevision,
            afterBrowser.content,
          ),
          idempotencyKey: nextId("later-agent"),
          find: "Agent base",
          replace: "Agent changed",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const retry = await save(nextId("retry-applied"));
    expect(retry.bodyIntentOutcome).toEqual({ status: "applied" });
    expect((await documentRow(id)).content).toBe(
      "Browser changed\nAgent changed",
    );
    expect(
      await getDb()
        .select()
        .from(schema.documentBodyIntents)
        .where(eq(schema.documentBodyIntents.documentId, id)),
    ).toHaveLength(2);
  });

  it("converges browser and MCP overlaps in either commit order while keeping independent edits", async () => {
    const base = "Base passage\nOther passage\nThird passage";
    const browserCandidate = "Browser passage\nOther passage\nBrowser third";
    const expected = "Agent passage\nOther passage\nBrowser third";
    for (const first of ["browser", "mcp"] as const) {
      const id = await createDocument({ content: base });
      const revision = documentRevisionToken(0, base);
      const browser = () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              content: browserCandidate,
              baseRevision: revision,
              authoredBaseRevision: revision,
              authoredBaseContent: base,
              authoredCandidateContent: browserCandidate,
              editorSessionId: `browser-${first}`,
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("browser-attempt"),
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        );
      const mcp = () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          editDocumentAction.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: nextId("mcp-edit"),
              find: "Base passage",
              replace: "Agent passage",
            },
            { caller: "mcp", userEmail: OWNER },
          ),
        );
      if (first === "browser") {
        await browser();
        await mcp();
      } else {
        await mcp();
        await browser();
      }
      expect((await documentRow(id)).content).toBe(expected);
      const history = await getDb()
        .select({ content: schema.documentVersions.content })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id));
      expect(
        history.map((version: { content: string }) => version.content),
      ).toContain(browserCandidate);
    }
  });

  it("records a browser save with its canonical write and replays only the same payload", async () => {
    const id = await createDocument({ content: "Before" });
    const before = await documentRow(id);
    const args = {
      id,
      content: "After",
      baseRevision: documentRevisionToken(before.bodyRevision, before.content),
      browserSaveAttemptId: nextId("save"),
    };
    const invoke = (input: typeof args) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(input, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    const first = await invoke(args);
    expect(first).toMatchObject({
      content: "After",
      browserSaveAttempt: {
        attemptId: args.browserSaveAttemptId,
        result: "applied",
      },
    });
    const after = await documentRow(id);
    const retry = await invoke(args);
    expect(retry).toMatchObject({
      content: "After",
      browserSaveAttempt: {
        attemptId: args.browserSaveAttemptId,
        result: "replayed",
        revision: documentRevisionToken(after.bodyRevision, after.content),
      },
    });
    expect(await documentRow(id)).toMatchObject({
      content: "After",
      bodyRevision: after.bodyRevision,
      updatedAt: after.updatedAt,
    });
    await expect(
      invoke({ ...args, content: "Different" }),
    ).rejects.toMatchObject({
      errorCode: "BROWSER_SAVE_ATTEMPT_REUSED",
    });
    expect((await documentRow(id)).content).toBe("After");
    const lookup = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentSaveAttemptAction.run({
        id,
        browserSaveAttemptId: args.browserSaveAttemptId,
      }),
    );
    expect(lookup).toMatchObject({
      found: true,
      browserSaveAttempt: {
        attemptId: args.browserSaveAttemptId,
        revision: documentRevisionToken(after.bodyRevision, after.content),
      },
    });
  });

  it("replays a lost title-only browser response without reverting a later rename", async () => {
    const id = await createDocument({ title: "Before", content: "Body" });
    const args = {
      id,
      title: "Browser title",
      browserSaveAttemptId: nextId("title-save"),
    };
    const deliver = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    const first = await deliver();
    expect(first.browserSaveAttempt).toMatchObject({
      attemptId: args.browserSaveAttemptId,
      result: "applied",
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id, title: "Newer title" }),
    );
    const replay = await deliver();
    expect(replay.browserSaveAttempt).toMatchObject({
      attemptId: args.browserSaveAttemptId,
      result: "replayed",
    });
    expect(await documentRow(id)).toMatchObject({
      title: "Newer title",
      content: "Body",
      bodyRevision: 0,
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentBrowserSaveAttempts)
        .where(eq(schema.documentBrowserSaveAttempts.documentId, id)),
    ).toHaveLength(1);
  });

  it("deduplicates concurrent browser deliveries of one lifecycle attempt", async () => {
    const id = await createDocument({ content: "Before" });
    const args = {
      id,
      content: "After",
      baseRevision: documentRevisionToken(0, "Before"),
      browserSaveAttemptId: nextId("lifecycle-attempt"),
    };
    const deliver = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    const [visibility, pagehide] = await Promise.all([deliver(), deliver()]);
    expect(
      new Set([
        visibility.browserSaveAttempt?.result,
        pagehide.browserSaveAttempt?.result,
      ]),
    ).toEqual(new Set(["applied", "replayed"]));
    expect(await documentRow(id)).toMatchObject({
      content: "After",
      bodyRevision: 1,
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentBrowserSaveAttempts)
        .where(eq(schema.documentBrowserSaveAttempts.documentId, id)),
    ).toHaveLength(1);
    const history = await getDb()
      .select({ content: schema.documentVersions.content })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, id));
    expect(
      history.map((version: { content: string }) => version.content),
    ).toEqual(expect.arrayContaining(["Before", "After"]));
    expect(history).toHaveLength(2);
  });

  it("replays a lost committed response after a later canonical edit", async () => {
    const id = await createDocument({
      content: "First passage\nSecond passage",
    });
    const args = {
      id,
      content: "First passage\nBrowser second",
      baseRevision: documentRevisionToken(0, "First passage\nSecond passage"),
      browserSaveAttemptId: nextId("lost-response"),
    };
    const deliver = (input: typeof args) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(input, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    await deliver(args); // The committed response never reaches the original editor.
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: documentRevisionToken(
            1,
            "First passage\nBrowser second",
          ),
          idempotencyKey: nextId("after-lost-response"),
          find: "First passage",
          replace: "Agent first",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const replay = await deliver(args);
    expect(replay.browserSaveAttempt).toMatchObject({
      attemptId: args.browserSaveAttemptId,
      result: "replayed",
      revision: documentRevisionToken(1, args.content),
    });
    expect(await documentRow(id)).toMatchObject({
      content: "Agent first\nBrowser second",
      bodyRevision: 2,
    });
    await expect(
      deliver({
        ...args,
        baseRevision: documentRevisionToken(1, args.content),
      }),
    ).rejects.toMatchObject({ errorCode: "BROWSER_SAVE_ATTEMPT_REUSED" });
  });

  it("does not confirm a conflicted browser save and keeps lookup actor scoped", async () => {
    const id = await createDocument({ content: "Before" });
    const attemptId = nextId("save");
    const conflict = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: "Rejected",
          baseRevision: documentRevisionToken(0, "stale"),
          browserSaveAttemptId: attemptId,
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(conflict).toMatchObject({ conflict: true });
    expect(
      await runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentSaveAttemptAction.run({
          id,
          browserSaveAttemptId: attemptId,
        }),
      ),
    ).toEqual({ found: false });
    expect((await documentRow(id)).content).toBe("Before");
  });

  it("does not expose an owner's save receipt to a shared editor", async () => {
    const id = await createDocument({ content: "Before" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: id,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
    const browserSaveAttemptId = nextId("save");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        { id, content: "After", browserSaveAttemptId },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(
      await runWithRequestContext({ userEmail: EDITOR }, () =>
        getDocumentSaveAttemptAction.run({ id, browserSaveAttemptId }),
      ),
    ).toEqual({ found: false });
  });

  it("does not confirm a browser payload suppressed by stale empty-body protection", async () => {
    const id = await createDocument({ content: "Hydrated body" });
    const attemptId = nextId("save");
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: "<empty-block/>",
          loadedUpdatedAt: "2026-01-01T00:00:00.000Z",
          loadedContentWasEmpty: true,
          browserSaveAttemptId: attemptId,
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(result).toMatchObject({
      conflict: true,
      document: { content: "Hydrated body" },
    });
    expect(
      await runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentSaveAttemptAction.run({
          id,
          browserSaveAttemptId: attemptId,
        }),
      ),
    ).toEqual({ found: false });
  });
  it("prepends only a newly created favorite membership and removes its order reference on unpin", async () => {
    const { getUserSetting } = await import("@agent-native/core/settings");
    const { favoritesSystemIds } = await import("./_content-favorites.js");
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const first = await createDocument({ title: "First" });
    const second = await createDocument({ title: "Second" });
    for (const id of [first, second]) {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id, isFavorite: true }),
      );
    }
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: second, isFavorite: true }),
    );
    const databaseId = favoritesSystemIds(OWNER).databaseId;
    const memberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const secondMembership = memberships.find(
      (item: any) => item.documentId === second,
    )!.id;
    const firstMembership = memberships.find(
      (item: any) => item.documentId === first,
    )!.id;
    const settingKey = personalDatabaseViewSettingKey(databaseId);
    expect(await getUserSetting(OWNER, settingKey)).toMatchObject({
      views: [
        {
          sidebarOrder: {
            mode: "custom",
            itemIds: [secondMembership, firstMembership],
          },
        },
      ],
    });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: second, isFavorite: false }),
    );
    expect(await getUserSetting(OWNER, settingKey)).toMatchObject({
      views: [{ sidebarOrder: { itemIds: [firstMembership] } }],
    });
  });

  it("keeps favorite membership and order consistent under concurrent pin and unpin", async () => {
    const { getUserSetting } = await import("@agent-native/core/settings");
    const { favoritesSystemIds } = await import("./_content-favorites.js");
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const documentId = await createDocument({ title: "Concurrent favorite" });
    const invoke = (isFavorite: boolean) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id: documentId, isFavorite }),
      );

    await Promise.all([invoke(true), invoke(true)]);
    const databaseId = favoritesSystemIds(OWNER).databaseId;
    let memberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    expect(
      memberships.filter((row: any) => row.documentId === documentId),
    ).toHaveLength(1);

    await Promise.all([invoke(true), invoke(false)]);
    memberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const membershipIds = new Set(memberships.map((row: any) => row.id));
    const setting = await getUserSetting(
      OWNER,
      personalDatabaseViewSettingKey(databaseId),
    );
    const references = ((setting?.views as any[]) ?? []).flatMap(
      (view) => view.sidebarOrder?.itemIds ?? [],
    );
    expect(references.every((id: string) => membershipIds.has(id))).toBe(true);
  });

  it("preserves a concurrent pin while an ordinary personal reorder commits", async () => {
    const { getUserSetting } = await import("@agent-native/core/settings");
    const { favoritesSystemIds } = await import("./_content-favorites.js");
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const first = await createDocument({ title: "Reorder first" });
    const second = await createDocument({ title: "Reorder second" });
    const concurrent = await createDocument({ title: "Concurrent pin" });
    for (const id of [first, second]) {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id, isFavorite: true }),
      );
    }
    const databaseId = favoritesSystemIds(OWNER).databaseId;
    const memberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const membershipByDocument = new Map(
      memberships.map((item: any) => [item.documentId, item.id]),
    );
    const requestedOrder = [
      membershipByDocument.get(first)!,
      membershipByDocument.get(second)!,
    ];

    await Promise.all([
      runWithRequestContext({ userEmail: OWNER }, () =>
        updatePersonalViewAction.run(
          {
            databaseId,
            navigation: {
              sidebarOrder: {
                viewId: "default",
                mode: "custom",
                itemIds: requestedOrder,
              },
            },
          },
          { userEmail: OWNER },
        ),
      ),
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id: concurrent, isFavorite: true }),
      ),
    ]);

    const finalMemberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const concurrentMembership = finalMemberships.find(
      (item: any) => item.documentId === concurrent,
    )!.id;
    const setting = await getUserSetting(
      OWNER,
      personalDatabaseViewSettingKey(databaseId),
    );
    const order = (setting?.views as any[])[0].sidebarOrder.itemIds as string[];
    expect(order).toEqual(
      expect.arrayContaining([...requestedOrder, concurrentMembership]),
    );
    const finalMembershipIds = new Set(
      finalMemberships.map((item: any) => item.id),
    );
    expect(order.every((id) => finalMembershipIds.has(id))).toBe(true);
    expect(order.indexOf(requestedOrder[0])).toBeLessThan(
      order.indexOf(requestedOrder[1]),
    );
  });

  it("rolls back a failed favorite setting write without damaging a competing success", async () => {
    const { getUserSetting } = await import("@agent-native/core/settings");
    const { favoritesSystemIds } = await import("./_content-favorites.js");
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const failedCandidate = await createDocument({ title: "Failed candidate" });
    const successfulCandidate = await createDocument({
      title: "Successful candidate",
    });
    const db = getDb();
    const originalTransaction = db.transaction.bind(db);
    let failOneSettingWrite = true;
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementation(async (callback: any, config?: any) =>
        originalTransaction(async (tx: any) => {
          let executeCount = 0;
          const wrapped = Object.create(tx);
          wrapped.execute = async (...executeArgs: any[]) => {
            executeCount += 1;
            if (failOneSettingWrite && executeCount === 3) {
              failOneSettingWrite = false;
              throw new Error("simulated setting write failure");
            }
            return tx.execute(...executeArgs);
          };
          return callback(wrapped);
        }, config),
      );
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled(
        [failedCandidate, successfulCandidate].map((id) =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run({ id, isFavorite: true }),
          ),
        ),
      );
    } finally {
      transaction.mockRestore();
    }
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const databaseId = favoritesSystemIds(OWNER).databaseId;
    const memberships = await db
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const membershipIds = new Set(memberships.map((row: any) => row.id));
    const setting = await getUserSetting(
      OWNER,
      personalDatabaseViewSettingKey(databaseId),
    );
    const references = ((setting?.views as any[]) ?? []).flatMap(
      (view) => view.sidebarOrder?.itemIds ?? [],
    );
    expect(references.every((id: string) => membershipIds.has(id))).toBe(true);
    expect(
      memberships.filter((row: any) =>
        [failedCandidate, successfulCandidate].includes(row.documentId),
      ),
    ).toHaveLength(1);
  });
  it("initializes an empty body through the externally callable edit action", async () => {
    const documentId = await createDocument({
      title: "Keep this title",
      content: "",
    });
    const before = await documentRow(documentId);
    const content = "# Keep this title\n\nExact body 🌿\n";

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id: documentId,
          baseRevision: documentRevisionToken(0, ""),
          idempotencyKey: "external-empty-initialization",
          initializeContent: content,
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const after = await documentRow(documentId);

    expect(result.receipt).toMatchObject({
      outcome: "applied",
      readback: { verified: true },
    });
    expect(after).toMatchObject({
      id: before.id,
      title: before.title,
      description: before.description,
      parentId: before.parentId,
      visibility: before.visibility,
      content,
      bodyRevision: 1,
    });
  });

  it("rejects conflicting initialization modes before writing", async () => {
    const documentId = await createDocument({ content: "" });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        editDocumentAction.run(
          {
            id: documentId,
            baseRevision: documentRevisionToken(0, ""),
            idempotencyKey: "conflicting-initialization",
            initializeContent: "body",
            find: "something",
            replace: "else",
          },
          { caller: "mcp", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_EDIT_MODE_CONFLICT" });
    expect((await documentRow(documentId)).content).toBe("");
  });

  it.each([
    {
      protocol: "base revision only",
      fields: { baseRevision: "body:0:sha256:invalid" },
    },
    {
      protocol: "idempotency key only",
      fields: { idempotencyKey: "partial-edit-protocol" },
    },
  ])("rejects a partial revision protocol: $protocol", async ({ fields }) => {
    const documentId = await createDocument({ content: "original" });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        editDocumentAction.run(
          {
            id: documentId,
            find: "original",
            replace: "changed",
            ...fields,
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_EDIT_PROTOCOL_REQUIRED",
    });
    expect((await documentRow(documentId)).content).toBe("original");
  });

  it("rejects external full-body writes outside the revisioned edit protocol", async () => {
    const documentId = await createDocument({ content: "original" });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          { id: documentId, content: "blind external rewrite" },
          { caller: "mcp", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_EDIT_PROTOCOL_REQUIRED",
    });
    expect((await documentRow(documentId)).content).toBe("original");
  });

  it("uses a canonical Files database rename as the workspace name", async () => {
    const { provisionContentSpaces, systemIdsForContentSpace } =
      await import("./_content-spaces.js");
    const provisioned = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    const filesDocumentId = systemIdsForContentSpace(
      provisioned.personalSpaceId,
      "files",
    ).documentId;

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: filesDocumentId, title: "Research" }),
    );

    const [space] = await getDb()
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, provisioned.personalSpaceId));
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.documentId, filesDocumentId));
    const [catalogReference] = await getDb()
      .select({ document: schema.documents })
      .from(schema.contentSpaceCatalogItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentSpaceCatalogItems.documentId),
      )
      .where(
        eq(
          schema.contentSpaceCatalogItems.spaceId,
          provisioned.personalSpaceId,
        ),
      );

    expect(space.name).toBe("Research");
    expect(database.title).toBe("Research");
    expect((await documentRow(filesDocumentId)).title).toBe("Research");
    expect(catalogReference.document.title).toBe("Research");
  });

  it("applies a content save with no baseUpdatedAt exactly like today (no CAS)", async () => {
    const documentId = await createDocument({ content: "original" });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, content: "rewritten" }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    expect((result as any).content).toBe("rewritten");
    expect((await documentRow(documentId)).content).toBe("rewritten");
  });

  it("derives an unguarded body save from the row locked after a racing writer", async () => {
    const documentId = await createDocument({ content: "initial body" });
    const initial = await documentRow(documentId);
    const db = getDb();
    const originalTransaction = db.transaction.bind(db);
    const racingUpdatedAt = new Date(
      new Date(initial.updatedAt).getTime() + 1_000,
    ).toISOString();
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementationOnce(async (callback: any, config?: any) => {
        await db
          .update(schema.documents)
          .set({
            content: "racing writer body",
            bodyRevision: 7,
            updatedAt: racingUpdatedAt,
          })
          .where(eq(schema.documents.id, documentId));
        return originalTransaction(callback, config);
      });
    try {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({
          id: documentId,
          content: "requested body",
          historySessionId: "unguarded-race",
        }),
      );
    } finally {
      transaction.mockRestore();
    }

    expect(await documentRow(documentId)).toMatchObject({
      content: "requested body",
      bodyRevision: 8,
      updatedAt: new Date(
        new Date(racingUpdatedAt).getTime() + 1,
      ).toISOString(),
    });
    const checkpoints = await db
      .select({ content: schema.documentVersions.content })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId))
      .orderBy(asc(schema.documentVersions.createdAt));
    expect(checkpoints.map((checkpoint: any) => checkpoint.content)).toEqual([
      "racing writer body",
      "requested body",
    ]);
  });

  it("CAS-rejects a body that only becomes stale before the row lock", async () => {
    const documentId = await createDocument({
      title: "Initial title",
      content: "initial body",
    });
    const initial = await documentRow(documentId);
    const db = getDb();
    const originalTransaction = db.transaction.bind(db);
    const racingUpdatedAt = new Date(
      new Date(initial.updatedAt).getTime() + 1_000,
    ).toISOString();
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementationOnce(async (callback: any, config?: any) => {
        await db
          .update(schema.documents)
          .set({ content: "racing writer body", updatedAt: racingUpdatedAt })
          .where(eq(schema.documents.id, documentId));
        return originalTransaction(callback, config);
      });
    let result: Awaited<ReturnType<typeof updateDocumentAction.run>>;
    try {
      result = await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({
          id: documentId,
          title: "Requested title",
          content: "initial body",
          baseUpdatedAt: initial.updatedAt,
        }),
      );
    } finally {
      transaction.mockRestore();
    }

    expect("conflict" in result && result.conflict).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({
      title: "Initial title",
      content: "racing writer body",
      updatedAt: racingUpdatedAt,
    });
  });

  it("applies a content save when baseUpdatedAt matches the current row", async () => {
    const documentId = await createDocument({ content: "original" });
    const before = await documentRow(documentId);

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "updated by matching snapshot",
        baseUpdatedAt: before.updatedAt,
      }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    expect((result as any).content).toBe("updated by matching snapshot");
    expect((await documentRow(documentId)).content).toBe(
      "updated by matching snapshot",
    );
  });

  it("uses the body revision so a metadata-only write does not falsely conflict", async () => {
    const documentId = await createDocument({ content: "original" });
    const before = await documentRow(documentId);
    const baseRevision = `body:${before.bodyRevision}:sha256:${(
      await import("node:crypto")
    )
      .createHash("sha256")
      .update(before.content)
      .digest("hex")}`;

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, icon: "📌" }),
    );
    const afterMetadata = await documentRow(documentId);
    expect(afterMetadata.updatedAt).not.toBe(before.updatedAt);
    expect(afterMetadata.bodyRevision).toBe(before.bodyRevision);

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "local body edit",
        baseUpdatedAt: before.updatedAt,
        baseRevision,
      }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    const updated = await documentRow(documentId);
    expect(updated).toMatchObject({
      content: "local body edit",
      bodyRevision: before.bodyRevision + 1,
    });
    expect(parseIconValue(updated.icon)).toEqual({
      version: 1,
      kind: "emoji",
      emoji: "📌",
    });
  });

  it("rejects a stale opaque body revision even when its counter is forged", async () => {
    const documentId = await createDocument({ content: "original" });
    const before = await documentRow(documentId);
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Must not apply",
        content: "local body edit",
        baseTitle: "Untitled",
        baseRevision: `body:${before.bodyRevision}:sha256:${"0".repeat(64)}`,
      }),
    );

    expect("conflict" in result && result.conflict).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({
      title: "Untitled",
      content: "original",
      bodyRevision: before.bodyRevision,
    });
  });

  it("rejects a combined title and body CAS save without a title baseline", async () => {
    const documentId = await createDocument({
      title: "Original title",
      content: "original",
    });
    const before = await documentRow(documentId);
    const { documentRevisionToken } =
      await import("./_document-edit-mutation.js");

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({
          id: documentId,
          title: "Local title",
          content: "local body",
          baseRevision: documentRevisionToken(
            before.bodyRevision,
            before.content,
          ),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "BASE_TITLE_REQUIRED" });
    expect(await documentRow(documentId)).toMatchObject({
      title: "Original title",
      content: "original",
    });
  });

  it("does not let a matching body revision overwrite a concurrently changed title", async () => {
    const documentId = await createDocument({
      title: "Original title",
      content: "original",
    });
    const before = await documentRow(documentId);
    const { documentRevisionToken } =
      await import("./_document-edit-mutation.js");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, title: "Concurrent title" }),
    );

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Local title",
        content: "local body",
        baseTitle: "Original title",
        baseRevision: documentRevisionToken(
          before.bodyRevision,
          before.content,
        ),
      }),
    );

    expect("conflict" in result && result.conflict).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({
      title: "Concurrent title",
      content: "original",
    });
  });

  it("does not let a title-only save overwrite a concurrently changed title", async () => {
    const documentId = await createDocument({
      title: "Original title",
      content: "original",
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, title: "Concurrent title" }),
    );

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Local title",
        baseTitle: "Original title",
      }),
    );

    expect("conflict" in result && result.conflict).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({
      title: "Concurrent title",
      content: "original",
    });
  });

  it("rejects a content save when the row moved past baseUpdatedAt and returns the current server document", async () => {
    const documentId = await createDocument({ content: "original" });
    const staleSnapshot = await documentRow(documentId);

    // Simulate a concurrent write (e.g. the Notion auto-pull) landing after
    // the editor's snapshot but before this save's CAS check runs.
    const db = getDb();
    const remoteUpdatedAt = new Date(
      new Date(staleSnapshot.updatedAt).getTime() + 1000,
    ).toISOString();
    await db
      .update(schema.documents)
      .set({ content: "pulled from notion", updatedAt: remoteUpdatedAt })
      .where(eq(schema.documents.id, documentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "New title from the stale editor",
        content: "editor's stale rewrite",
        baseUpdatedAt: staleSnapshot.updatedAt,
      }),
    );

    expect("conflict" in result && result.conflict).toBe(true);
    if (!("conflict" in result && result.conflict))
      throw new Error("unreachable");
    expect(result.id).toBe(documentId);
    expect(result.document.content).toBe("pulled from notion");
    expect(result.document.updatedAt).toBe(remoteUpdatedAt);

    // The rejected save must not have applied ANY of its fields — including
    // title — since a partial apply would desync fields from what the caller
    // believes it sent.
    const current = await documentRow(documentId);
    expect(current.content).toBe("pulled from notion");
    expect(current.title).toBe("Untitled");
    expect(current.updatedAt).toBe(remoteUpdatedAt);
  });

  it("rejects a stale draft title even when its body matches the current Page", async () => {
    const documentId = await createDocument({ content: "same body" });
    const stale = await documentRow(documentId);
    const newer = new Date(
      new Date(stale.updatedAt).getTime() + 1000,
    ).toISOString();
    await getDb()
      .update(schema.documents)
      .set({ title: "Newer title", updatedAt: newer })
      .where(eq(schema.documents.id, documentId));
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Stale draft title",
        content: "same body",
        baseUpdatedAt: stale.updatedAt,
      }),
    );
    expect("conflict" in result && result.conflict).toBe(true);
    expect((await documentRow(documentId)).title).toBe("Newer title");
  });

  it("does not CAS-guard title/icon-only saves even when baseUpdatedAt is stale", async () => {
    const documentId = await createDocument({ content: "original" });
    const staleSnapshot = await documentRow(documentId);

    const db = getDb();
    const remoteUpdatedAt = new Date(
      new Date(staleSnapshot.updatedAt).getTime() + 1000,
    ).toISOString();
    await db
      .update(schema.documents)
      .set({ content: "pulled from notion", updatedAt: remoteUpdatedAt })
      .where(eq(schema.documents.id, documentId));

    // No `content` in this call, so baseUpdatedAt (even though stale) must
    // not trigger the CAS path — title/metadata-only saves keep today's
    // last-write-wins behavior.
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Renamed",
        baseUpdatedAt: staleSnapshot.updatedAt,
      }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    const current = await documentRow(documentId);
    expect(current.title).toBe("Renamed");
    expect(current.content).toBe("pulled from notion");
  });

  it("always snapshots the last nonempty body before an intentional clear", async () => {
    const documentId = await createDocument({ content: "original body" });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "second body within the snapshot interval",
      }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "<empty-block/>",
      }),
    );

    const versions = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    expect(versions.map((version: any) => version.content)).toEqual(
      expect.arrayContaining([
        "original body",
        "second body within the snapshot interval",
      ]),
    );
    expect(versions).toHaveLength(3);
  });

  it("targets a shared editor's update audit event to the document owner", async () => {
    const documentId = await createDocument({ content: "owner body" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: documentId,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });

    const result = await runWithRequestContext({ userEmail: EDITOR }, () =>
      updateDocumentAction.run(
        { id: documentId, content: "edited by collaborator" },
        {
          caller: "frontend",
          actionName: "update-document",
          userEmail: EDITOR,
        },
      ),
    );
    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const events = await queryAuditEvents(
      { userEmail: OWNER },
      {
        action: "update-document",
        targetType: "document",
        targetId: documentId,
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorEmail: EDITOR,
      ownerEmail: OWNER,
      targetType: "document",
      targetId: documentId,
      status: "success",
    });
    expect(await documentRow(documentId)).toMatchObject({
      createdBy: null,
      updatedBy: EDITOR,
    });
    expect(JSON.stringify(result)).not.toContain(OWNER);
  });

  it("keeps a viewer's favorite preference in the viewer's private audit trail", async () => {
    const documentId = await createDocument({ content: "owner body" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: documentId,
        principalType: "user",
        principalId: VIEWER,
        role: "viewer",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });

    await runWithRequestContext({ userEmail: VIEWER }, () =>
      updateDocumentAction.run(
        { id: documentId, isFavorite: true },
        {
          caller: "frontend",
          actionName: "update-document",
          userEmail: VIEWER,
        },
      ),
    );
    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const viewerEvents = await queryAuditEvents(
      { userEmail: VIEWER },
      {
        action: "update-document",
        targetType: "document",
        targetId: documentId,
      },
    );
    const ownerEvents = await queryAuditEvents(
      { userEmail: OWNER },
      {
        action: "update-document",
        targetType: "document",
        targetId: documentId,
      },
    );

    expect(viewerEvents).toHaveLength(1);
    expect(viewerEvents[0]).toMatchObject({
      actorEmail: VIEWER,
      ownerEmail: VIEWER,
      targetType: "document",
      targetId: documentId,
      status: "success",
    });
    expect(ownerEvents).toHaveLength(0);
  });

  it("preserves separate content and favorite updates without exposing their inputs to the owner", async () => {
    const documentId = await createDocument({ content: "owner body" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: documentId,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });

    await runWithRequestContext({ userEmail: EDITOR }, () =>
      updateDocumentAction.run(
        {
          id: documentId,
          content: "collaborator body",
        },
        {
          caller: "frontend",
          actionName: "update-document",
          userEmail: EDITOR,
        },
      ),
    );
    await runWithRequestContext({ userEmail: EDITOR }, () =>
      updateDocumentAction.run(
        { id: documentId, isFavorite: true },
        {
          caller: "frontend",
          actionName: "update-document",
          userEmail: EDITOR,
        },
      ),
    );
    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const ownerEvents = await queryAuditEvents(
      { userEmail: OWNER },
      {
        action: "update-document",
        targetType: "document",
        targetId: documentId,
      },
    );

    expect((await documentRow(documentId)).content).toBe("collaborator body");
    expect(ownerEvents).toHaveLength(1);
    expect(ownerEvents[0]).toMatchObject({
      actorEmail: EDITOR,
      ownerEmail: OWNER,
      input: null,
      status: "success",
    });
  });
});
