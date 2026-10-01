import {
  closeDbExec,
  getDbExec,
  getDatabaseUrl,
  getRuntimeDatabaseUrl,
} from "@agent-native/core/db";
import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  deleteSetting,
  getSetting,
  putSetting,
} from "@agent-native/core/settings";
import * as creativeSchema from "@agent-native/creative-context/schema";
import { configureCreativeContext } from "@agent-native/creative-context/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

// Not exported from @agent-native/core/db; the source module computes the same
// pool options from the environment as the built one the app loads.
import { pgPoolOptions } from "../../../packages/core/src/db/client.js";
import { CONTENT_CREATIVE_CONTEXT } from "../shared/labs.js";

const OWNER = "pool-owner@example.test";
const WRITER = "pool-writer@example.test";
const VIEWER = "pool-viewer@example.test";
const ORG = "pool-regression-org";
const BODY = "Alpha one. Beta two.";
const TIMEOUT = 5_000;

export function connectionPoolRegressionSuite(postgresUrl: string) {
  let database: typeof import("../server/db/index.js");
  let addComment: typeof import("./add-comment.js").default;
  let editDocument: typeof import("./edit-document.js").default;
  let revisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;
  let commentAi: typeof import("../server/lib/comment-ai.js");
  let applyRequest: typeof import("./apply-comment-ai-request.js").default;
  let undoRequest: typeof import("./undo-comment-ai-request.js").default;
  let documentId: string;
  let rootId: string;
  let beforeTransaction: (() => Promise<void>) | undefined;

  const asUser = <T>(email: string, run: () => T | Promise<T>) =>
    runWithRequestContext({ userEmail: email }, async () => run());

  const add = (caller: "frontend" | "mcp" = "mcp", email = WRITER) =>
    asUser(email, () =>
      addComment.run(
        {
          documentId,
          content: "Pool regression comment",
          clientOperationId: crypto.randomUUID(),
        },
        { caller, userEmail: email },
      ),
    );

  const edit = (email = WRITER, idempotencyKey = crypto.randomUUID()) =>
    asUser(email, () =>
      editDocument.run(
        {
          id: documentId,
          find: "Alpha one.",
          replace: "Alpha changed.",
          baseRevision: revisionToken(0, BODY),
          idempotencyKey,
          reuseLabels: [],
        },
        { caller: "mcp", userEmail: email },
      ),
    );

  async function storedDocument() {
    const [document] = await database
      .getDb()
      .select()
      .from(database.schema.documents)
      .where(eq(database.schema.documents.id, documentId));
    return document!;
  }

  beforeAll(async () => {
    if (!new URL(postgresUrl).pathname.toLowerCase().includes("test")) {
      throw new Error(
        "Content pool regression requires an isolated PostgreSQL test database",
      );
    }
    vi.stubEnv("APP_NAME", "");
    for (const key of [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "NETLIFY_DATABASE_URL",
      "NETLIFY_DATABASE_URL_UNPOOLED",
    ]) {
      vi.stubEnv(key, postgresUrl);
    }
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "content-write-pool-test");
    expect(pgPoolOptions(postgresUrl).max).toBe(1);
    expect(getDatabaseUrl()).toBe(postgresUrl);
    expect(getRuntimeDatabaseUrl()).toBe(postgresUrl);
    database = await import("../server/db/index.js");
    await (
      await import("../server/plugins/db.js")
    ).runContentMigrations(undefined as never);
    await (
      await import("@agent-native/creative-context/server")
    ).creativeContextDbPlugin(undefined as never);
    configureCreativeContext({
      getDb: database.getDb,
      labKey: CONTENT_CREATIVE_CONTEXT.key,
    });
    registerLabs([CONTENT_CREATIVE_CONTEXT]);
    await getDbExec().execute(`
      CREATE TABLE IF NOT EXISTS org_members (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        role TEXT NOT NULL, joined_at BIGINT NOT NULL,
        federation_removal_pending_at BIGINT
      )
    `);
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
      args: ["pool-regression-member", ORG, WRITER, "member", 0],
    });
    addComment = (await import("./add-comment.js")).default;
    editDocument = (await import("./edit-document.js")).default;
    revisionToken = (await import("./_document-edit-mutation.js"))
      .documentRevisionToken;
    commentAi = await import("../server/lib/comment-ai.js");
    applyRequest = (await import("./apply-comment-ai-request.js")).default;
    undoRequest = (await import("./undo-comment-ai-request.js")).default;

    await database.getDb().select().from(database.schema.documents).limit(1);
    const db = database.getDb();
    // Core's getDb() proxy wraps whatever `transaction` resolves to, so the
    // spy must call the unwrapped method; calling the wrapped one opens a
    // second, independent transaction scope and core rejects the handle.
    const rawTransaction = Object.getPrototypeOf(db).transaction;
    vi.spyOn(db, "transaction").mockImplementation(async function (
      this: unknown,
      ...args
    ) {
      const hook = beforeTransaction;
      beforeTransaction = undefined;
      await hook?.();
      return rawTransaction.apply(this, args);
    });
  }, 60_000);

  beforeEach(async () => {
    beforeTransaction = undefined;
    documentId = `pool-document-${crypto.randomUUID()}`;
    rootId = crypto.randomUUID();
    const { schema } = database;
    const db = database.getDb();
    await db.insert(schema.documents).values({
      id: documentId,
      ownerEmail: OWNER,
      title: "Pool regression",
      content: BODY,
      bodyRevision: 0,
    });
    await db.insert(schema.documentShares).values([
      {
        id: crypto.randomUUID(),
        resourceId: documentId,
        principalType: "user",
        principalId: WRITER,
        role: "editor",
        createdBy: OWNER,
      },
      {
        id: crypto.randomUUID(),
        resourceId: documentId,
        principalType: "user",
        principalId: VIEWER,
        role: "viewer",
        createdBy: OWNER,
      },
    ]);
    await db.insert(schema.documentComments).values({
      id: rootId,
      ownerEmail: OWNER,
      documentId,
      threadId: rootId,
      parentId: null,
      content: "Please change Alpha",
      authorEmail: WRITER,
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeDbExec();
    vi.unstubAllEnvs();
  }, 60_000);

  it(
    "reads core settings with question-mark parameters on the held connection",
    async () => {
      const key = `content-pool:${documentId}`;
      const original = { documentId, title: "Original ? $1 'quoted'" };
      const updated = { documentId, title: "Updated ? $1 'quoted'" };
      await putSetting(key, original);
      try {
        await database.getDb().transaction(async () => {
          const transaction = getDbExec();
          expect(await getSetting(key, { transaction })).toEqual(original);
          const result = await transaction.execute({
            sql: "UPDATE public.settings SET value = ? WHERE key = ?",
            args: [JSON.stringify(updated), key],
          });
          expect(result).toMatchObject({ rows: [], rowsAffected: 1 });
          expect(await getSetting(key, { transaction })).toEqual(updated);
        });
      } finally {
        await deleteSetting(key);
      }
    },
    TIMEOUT,
  );

  it.each(["frontend", "mcp"] as const)(
    "saves a top-level %s comment on the held connection",
    async (caller) => {
      const result = await add(caller);
      const [saved] = await database
        .getDb()
        .select()
        .from(database.schema.documentComments)
        .where(eq(database.schema.documentComments.id, result.id));
      expect(saved).toMatchObject({
        documentId,
        threadId: result.id,
        parentId: null,
        authorEmail: WRITER,
        content: "Pool regression comment",
        submissionSource: caller,
      });
    },
    TIMEOUT,
  );

  it(
    "saves a reply on the held connection",
    async () => {
      const result = await asUser(WRITER, () =>
        addComment.run(
          {
            documentId,
            content: "Pool regression reply",
            threadId: rootId,
            parentId: rootId,
          },
          { caller: "mcp", userEmail: WRITER },
        ),
      );
      const [saved] = await database
        .getDb()
        .select()
        .from(database.schema.documentComments)
        .where(eq(database.schema.documentComments.id, result.id));
      expect(saved).toMatchObject({
        documentId,
        threadId: rootId,
        parentId: rootId,
      });
    },
    TIMEOUT,
  );

  it(
    "commits and replays a revision-guarded MCP edit",
    async () => {
      const key = crypto.randomUUID();
      const result = await edit(WRITER, key);
      expect(result).toMatchObject({
        applied: 1,
        receipt: {
          readback: { verified: true },
          idempotency: { result: "applied", key },
        },
      });
      expect(await storedDocument()).toMatchObject({
        content: "Alpha changed. Beta two.",
        bodyRevision: 1,
      });
      expect(await edit(WRITER, key)).toMatchObject({
        receipt: { idempotency: { result: "replayed" } },
      });
    },
    TIMEOUT,
  );

  it.each([false, true])(
    "records Creative Context for an org member MCP edit with pack=%s on the held connection",
    async (withPack) => {
      const packId = withPack ? crypto.randomUUID() : undefined;
      const db = database.getDb();
      await db
        .update(database.schema.documents)
        .set({ orgId: ORG })
        .where(eq(database.schema.documents.id, documentId));
      await putSetting(`u:${WRITER}:labs`, {
        [CONTENT_CREATIVE_CONTEXT.key]: true,
      });
      if (packId) {
        await db.insert(creativeSchema.contextPacks).values({
          id: packId,
          name: "Pool regression pack",
          ownerEmail: OWNER,
          orgId: ORG,
          visibility: "private",
          createdAt: new Date().toISOString(),
        });
        await getDbExec().execute({
          sql: "INSERT INTO creative_context_pack_shares (id, resource_id, principal_type, principal_id, role, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          args: [
            crypto.randomUUID(),
            packId,
            "user",
            WRITER,
            "viewer",
            OWNER,
            Date.now(),
          ],
        });
      }
      const result = await runWithRequestContext(
        { userEmail: WRITER, orgId: ORG },
        () =>
          editDocument.run(
            {
              id: documentId,
              find: "Alpha one.",
              replace: "Alpha changed.",
              baseRevision: revisionToken(0, BODY),
              idempotencyKey: crypto.randomUUID(),
              reuseLabels: [],
              ...(packId
                ? { contextPackId: packId }
                : { contextModeOverride: "off" as const }),
            },
            { caller: "mcp", userEmail: WRITER },
          ),
      );
      expect(result).toMatchObject({
        applied: 1,
        receipt: { readback: { verified: true } },
      });
      expect(await storedDocument()).toMatchObject({
        content: "Alpha changed. Beta two.",
        bodyRevision: 1,
      });
      const records = await db
        .select()
        .from(creativeSchema.generationRecords)
        .where(eq(creativeSchema.generationRecords.artifactId, documentId));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        appId: "content",
        artifactType: "document",
        orgId: ORG,
        contextPackId: packId ?? null,
        contextMode: packId ? "pinned" : "off",
      });
    },
    TIMEOUT,
  );

  it.each(["comment", "edit"] as const)(
    "rejects a viewer without %s permission",
    async (operation) => {
      await expect(
        operation === "comment" ? add("mcp", VIEWER) : edit(VIEWER),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await storedDocument()).toMatchObject({
        content: BODY,
        bodyRevision: 0,
      });
      const comments = await database
        .getDb()
        .select()
        .from(database.schema.documentComments)
        .where(eq(database.schema.documentComments.documentId, documentId));
      expect(comments).toHaveLength(1);
    },
    TIMEOUT,
  );

  it.each(["comment", "edit"] as const)(
    "rechecks revoked %s permission before writing",
    async (operation) => {
      beforeTransaction = async () => {
        await database
          .getDb()
          .delete(database.schema.documentShares)
          .where(eq(database.schema.documentShares.resourceId, documentId));
      };
      await expect(
        operation === "comment" ? add() : edit(),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await storedDocument()).toMatchObject({
        content: BODY,
        bodyRevision: 0,
      });
      const comments = await database
        .getDb()
        .select()
        .from(database.schema.documentComments)
        .where(eq(database.schema.documentComments.documentId, documentId));
      expect(comments).toHaveLength(1);
      const receipts = await database
        .getDb()
        .select()
        .from(database.schema.documentEditReceipts)
        .where(eq(database.schema.documentEditReceipts.documentId, documentId));
      expect(receipts).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    "applies and undoes a comment AI request without acquiring a second connection",
    async () => {
      const requestId = crypto.randomUUID();
      const started = await asUser(WRITER, () =>
        commentAi.startCommentAiRequest({
          requestId,
          agentThreadId: `pool-agent-${requestId}`,
          documentId,
          threadId: rootId,
          rootCommentId: rootId,
          intent: "apply-resolve",
        }),
      );
      const inRun = <T>(run: () => T | Promise<T>) =>
        runWithRequestContext(
          {
            userEmail: WRITER,
            run: {
              actionScope: { kind: "content-comment-ai", requestId },
              threadId: started.agentThreadId!,
              runId: `pool-run-${requestId}`,
            },
          },
          run,
        );
      const attempt = await inRun(async () =>
        commentAi.beginCommentAiAttempt(
          await commentAi.requireCommentAiRequest("apply-resolve"),
        ),
      );
      const applied = await inRun(() =>
        applyRequest.run(
          {
            attemptId: attempt.attempt!.id,
            edits: [{ find: "Alpha one.", replace: "Alpha changed." }],
            summary: "Changed Alpha",
          },
          { caller: "tool", userEmail: WRITER },
        ),
      );
      expect(applied.status).toBe("resolved");
      expect(await storedDocument()).toMatchObject({
        content: "Alpha changed. Beta two.",
        bodyRevision: 1,
      });
      const undone = await asUser(WRITER, () =>
        undoRequest.run({ requestId }, { caller: "mcp", userEmail: WRITER }),
      );
      expect(undone.result?.undone).toBe(true);
      expect(await storedDocument()).toMatchObject({
        content: BODY,
        bodyRevision: 2,
      });
      const [root] = await database
        .getDb()
        .select()
        .from(database.schema.documentComments)
        .where(eq(database.schema.documentComments.id, rootId));
      expect(root!.resolved).toBe(0);
    },
    TIMEOUT,
  );
}
