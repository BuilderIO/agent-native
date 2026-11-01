import { createRequire } from "node:module";

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { REVIEW_AGENT_DEFAULT_INSTRUCTIONS } from "../../shared/review-agent.js";
import * as schema from "../db/schema.js";
import { designReviewAgentRequestsMigration } from "../plugins/db.js";

const require = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const { PGlite } = require("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  pglite: undefined as any,
  db: undefined as any,
  role: "editor" as "viewer" | "commenter" | "editor",
  design: { id: "design-1", title: "Checkout", data: "{}" } as {
    id: string;
    title: string;
    data: string;
  },
  comments: [] as any[],
}));

vi.mock("../db/index.js", () => ({ getDb: () => mocks.db, schema }));

vi.mock("@agent-native/core/sharing", () => {
  class ForbiddenError extends Error {
    statusCode = 403;
  }
  const rank = { viewer: 1, commenter: 2, editor: 3 };
  return {
    ForbiddenError,
    assertAccess: async (_type: string, id: string, min = "viewer") => {
      if (id !== mocks.design.id || rank[mocks.role] < (rank as any)[min]) {
        throw new ForbiddenError(`No ${min} access to ${id}`);
      }
      return { role: mocks.role, resource: mocks.design };
    },
  };
});

vi.mock("@agent-native/core/review", () => ({
  getReviewThreadRoot: async (threadId: string) =>
    mocks.comments.find(
      (comment) =>
        comment.threadId === threadId && comment.parentCommentId === null,
    ) ?? null,
  queryReviewComments: async (input: any) =>
    mocks.comments.filter(
      (comment) =>
        !comment.deletedAt &&
        (input.targetId === undefined || comment.targetId === input.targetId) &&
        (input.includeResolved || comment.status !== "resolved"),
    ),
}));
vi.mock("@agent-native/core/review/actions/reply-review-comment", () => ({
  default: { run: vi.fn() },
}));
vi.mock("@agent-native/core/review/actions/resolve-review-thread", () => ({
  default: { run: vi.fn() },
}));
vi.mock("../../actions/edit-design.js", () => ({
  default: { run: vi.fn() },
  applySearchReplaceEdits: vi.fn(),
}));

import {
  cancelReviewAgentRequest,
  expireStaleActiveRequests,
  listReviewAgentRequests,
  normalizeInstructions,
  previewEdits,
  reconcileReviewAgentRun,
  recordEditApplied,
  resultFitsRow,
  serializeReviewAgentRequest,
  startReviewAgentRequest,
  transitionReviewAgentRequest,
  withoutMentionMarkup,
  type ReviewAgentRow,
  type ReviewAgentRunStatus,
  type StartReviewAgentArgs,
} from "./review-agent.js";

const ME = "me@example.com";
const OTHER = "other@example.com";
const DESIGN_ID = "design-1";
const SCREEN_ID = "screen-1";
const THREAD = "thread-1";
const ROOT = "comment-root";
const AGENT_MENTION = {
  label: "Claude Sonnet 5.5",
  email: null,
  id: "agent:anthropic:claude-sonnet-5-5",
};
const MINUTE = 60_000;

const as = <T>(email: string | undefined, work: () => Promise<T>) =>
  runWithRequestContext(email ? { userEmail: email } : {}, work);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function comment(over: Record<string, unknown> = {}) {
  const id = (over.id as string | undefined) ?? crypto.randomUUID();
  return {
    id,
    resourceType: "design",
    resourceId: DESIGN_ID,
    threadId: THREAD,
    parentCommentId: null,
    targetId: SCREEN_ID,
    kind: "comment",
    status: "open",
    anchor: null,
    body: "make the button blue",
    authorEmail: ME,
    authorName: "Me",
    createdBy: "human",
    resolutionTarget: null,
    mentions: [],
    deletedAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const rootComment = (over: Record<string, unknown> = {}) =>
  comment({
    id: ROOT,
    body: "@Claude Sonnet 5.5 make the button blue",
    mentions: [AGENT_MENTION],
    ...over,
  });

const startArgs = (over: Partial<StartReviewAgentArgs> = {}) => ({
  requestId: crypto.randomUUID(),
  designId: DESIGN_ID,
  threadId: THREAD,
  mode: "auto" as const,
  triggerCommentId: ROOT,
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  engine: "anthropic",
  ...over,
});

async function insertRow(
  over: Partial<typeof schema.designReviewAgentRequests.$inferInsert> = {},
): Promise<ReviewAgentRow> {
  const id = over.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const [row] = await mocks.db
    .insert(schema.designReviewAgentRequests)
    .values({
      id,
      designId: DESIGN_ID,
      threadId: THREAD,
      rootCommentId: ROOT,
      screenId: SCREEN_ID,
      requesterEmail: ME,
      submittedMode: "apply-resolve",
      intent: "apply-resolve",
      instructions: "make the button blue",
      status: "running",
      classificationThreadId: `design-review-agent-classifier-${id}`,
      classificationTurnId: `classifier-turn-${id}`,
      agentThreadId: `design-review-agent-${id}`,
      agentTurnId: `agent-turn-${id}`,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .returning();
  return row;
}

const readRow = async (id: string): Promise<ReviewAgentRow> => {
  const [row] = await mocks.db
    .select()
    .from(schema.designReviewAgentRequests)
    .where(eq(schema.designReviewAgentRequests.id, id))
    .limit(1);
  return row;
};

const rowsOnThread = async () =>
  mocks.db
    .select()
    .from(schema.designReviewAgentRequests)
    .where(eq(schema.designReviewAgentRequests.threadId, THREAD))
    .limit(50);

describe("review agent requests against PGlite", () => {
  beforeAll(async () => {
    mocks.pglite = await PGlite.create("memory://");
    mocks.db = drizzle(mocks.pglite, { schema });
    const sql = designReviewAgentRequestsMigration.sql;
    if (typeof sql !== "string")
      throw new Error("migration SQL is not a string");
    await mocks.pglite.exec(`
      CREATE TABLE designs (id TEXT PRIMARY KEY);
      CREATE TABLE design_files (
        id TEXT PRIMARY KEY, design_id TEXT NOT NULL, filename TEXT NOT NULL,
        file_type TEXT, content TEXT NOT NULL DEFAULT ''
      );
      ${sql};
    `);
  });

  afterAll(async () => {
    await mocks.pglite.close();
  });

  beforeEach(async () => {
    await mocks.pglite.exec(
      "TRUNCATE design_review_agent_requests, design_files, designs",
    );
    await mocks.pglite.query("INSERT INTO designs (id) VALUES ($1)", [
      DESIGN_ID,
    ]);
    await mocks.pglite.query(
      `INSERT INTO design_files (id, design_id, filename, file_type, content)
       VALUES ($1, $2, 'screen.html', 'html', '<html><body>hi</body></html>')`,
      [SCREEN_ID, DESIGN_ID],
    );
    mocks.role = "editor";
    mocks.design = { id: DESIGN_ID, title: "Checkout", data: "{}" };
    mocks.comments = [rootComment()];
  });

  describe("the table", () => {
    it("lets only one request per thread be active, and any number finish", async () => {
      await insertRow({ status: "queued" });
      await expect(insertRow({ status: "running" })).rejects.toThrow();
      await insertRow({ status: "cancelled" });
      await insertRow({ status: "failed" });
      expect(await rowsOnThread()).toHaveLength(3);
    });
  });

  describe("start", () => {
    it("records an @agent request as classifying and returns the classifier session", async () => {
      const args = startArgs();
      const result = await as(ME, () => startReviewAgentRequest(args));

      expect(result).toMatchObject({
        outcome: "started",
        dispatch: true,
        request: {
          requestId: args.requestId,
          status: "classifying",
          intent: null,
          mode: "auto",
          requesterIsMe: true,
          screenId: SCREEN_ID,
          instructions: "@Claude Sonnet 5.5 make the button blue",
          triggerCommentId: ROOT,
        },
      });
      const session = result.pendingSession;
      expect(session).toMatchObject({
        phase: "classification",
        operationId: `${args.requestId}:classification`,
        scope: { type: "design-review-agent-classifier", id: args.requestId },
        actionScope: {
          kind: "design-review-agent-classifier",
          requestId: args.requestId,
        },
        model: "claude-sonnet-5-5",
        engine: "anthropic",
        usageLabel: "design:review-agent",
      });
      expect(session?.threadId).toMatch(/^design-review-agent-classifier-/);
      expect(session?.turnId).toBe(
        backgroundAgentTurnIdForReceipt(
          session!.threadId,
          `${args.requestId}:classification`,
        ),
      );
      expect(session?.message).toContain("make the button blue");
      expect(result.request.pendingSession).toEqual(session);
    });

    it("records an explicit mode as queued, with its intent and the execution session", async () => {
      const args = startArgs({ mode: "reply", triggerCommentId: undefined });
      const result = await as(ME, () => startReviewAgentRequest(args));

      expect(result.request).toMatchObject({
        status: "queued",
        intent: "reply",
        instructions: REVIEW_AGENT_DEFAULT_INSTRUCTIONS.reply,
        triggerCommentId: null,
      });
      expect(result.pendingSession).toMatchObject({
        phase: "execution",
        operationId: args.requestId,
        actionScope: { kind: "design-review-agent", requestId: args.requestId },
      });
      const threadId = result.pendingSession!.threadId;
      expect(threadId).toMatch(/^design-review-agent-/);
      expect(threadId).not.toMatch(/^design-review-agent-classifier-/);
      expect(result.pendingSession!.turnId).toBe(
        backgroundAgentTurnIdForReceipt(threadId, args.requestId),
      );
    });

    it("reads the instruction from the stored comment and drops reprompt markers", async () => {
      mocks.comments = [
        rootComment({
          body: "[Reprompt selection]\n@Claude Sonnet 5.5 widen it\n[Selection question]",
        }),
      ];
      const result = await as(ME, () => startReviewAgentRequest(startArgs()));

      expect(result.request.instructions).toBe("@Claude Sonnet 5.5 widen it");
    });

    it("replays the exact same submission, and stops dispatching once a run exists", async () => {
      const args = startArgs({ mode: "suggest", triggerCommentId: undefined });
      const first = await as(ME, () => startReviewAgentRequest(args));
      const again = await as(ME, () => startReviewAgentRequest(args));

      expect(again).toMatchObject({ outcome: "replayed", dispatch: true });
      expect(again.pendingSession).toEqual(first.pendingSession);
      expect(await rowsOnThread()).toHaveLength(1);

      await mocks.db
        .update(schema.designReviewAgentRequests)
        .set({ runId: "run-1", status: "running" })
        .where(eq(schema.designReviewAgentRequests.id, args.requestId));
      const running = await as(ME, () => startReviewAgentRequest(args));
      expect(running).toMatchObject({
        outcome: "replayed",
        dispatch: false,
        pendingSession: null,
      });
    });

    it("replays even after the run finished and closed the thread", async () => {
      const args = startArgs({
        mode: "apply-resolve",
        triggerCommentId: undefined,
      });
      await as(ME, () => startReviewAgentRequest(args));
      await mocks.db
        .update(schema.designReviewAgentRequests)
        .set({ status: "applied" })
        .where(eq(schema.designReviewAgentRequests.id, args.requestId));
      mocks.comments = [rootComment({ status: "resolved" })];

      const again = await as(ME, () => startReviewAgentRequest(args));

      expect(again).toMatchObject({
        outcome: "replayed",
        dispatch: false,
        request: { status: "applied" },
      });
    });

    it("refuses an id reused for a different submission, and hides someone else's id", async () => {
      const args = startArgs({ mode: "reply", triggerCommentId: undefined });
      await as(ME, () => startReviewAgentRequest(args));

      await expect(
        as(ME, () => startReviewAgentRequest({ ...args, mode: "suggest" })),
      ).rejects.toMatchObject({
        errorCode: "operation_conflict",
        statusCode: 409,
      });
      await expect(
        as(ME, () =>
          startReviewAgentRequest({ ...args, model: "other-model" }),
        ),
      ).rejects.toMatchObject({ errorCode: "operation_conflict" });
      await expect(
        as(OTHER, () => startReviewAgentRequest(args)),
      ).rejects.toMatchObject({
        errorCode: "request_not_found",
        statusCode: 404,
      });
    });

    it("lets two simultaneous starts create one row, and shows the other the winner", async () => {
      const first = startArgs({ mode: "reply", triggerCommentId: undefined });
      const second = startArgs({ mode: "reply", triggerCommentId: undefined });

      const results = await Promise.all([
        as(ME, () => startReviewAgentRequest(first)),
        as(ME, () => startReviewAgentRequest(second)),
      ]);

      expect(results.map((r) => r.outcome).sort()).toEqual(["busy", "started"]);
      const rows = await rowsOnThread();
      expect(rows).toHaveLength(1);
      const busy = results.find((r) => r.outcome === "busy");
      expect(busy?.request.requestId).toBe(rows[0].id);
    });

    it("shows a second editor the running request without private fields or a dispatch", async () => {
      const mine = startArgs({ mode: "reply", triggerCommentId: undefined });
      await as(ME, () => startReviewAgentRequest(mine));

      const theirs = await as(OTHER, () =>
        startReviewAgentRequest(
          startArgs({ mode: "suggest", triggerCommentId: undefined }),
        ),
      );

      expect(theirs).toMatchObject({
        outcome: "busy",
        dispatch: false,
        pendingSession: null,
        request: {
          requestId: mine.requestId,
          requesterIsMe: false,
          instructions: null,
          triggerCommentId: null,
          submitted: null,
          agentThreadId: null,
          agentTurnId: null,
          pendingSession: null,
        },
      });
    });

    it("lets a thread that a stalled request held be started again", async () => {
      const stalled = await insertRow({
        status: "running",
        updatedAt: ago(31 * MINUTE),
      });

      const result = await as(ME, () =>
        startReviewAgentRequest(
          startArgs({ mode: "reply", triggerCommentId: undefined }),
        ),
      );

      expect(result.outcome).toBe("started");
      expect(await readRow(stalled.id)).toMatchObject({
        status: "failed",
        errorCode: "run_timeout",
      });
    });

    it("never calls a stalled request that already edited the design a plain failure", async () => {
      const stalled = await insertRow({
        status: "running",
        updatedAt: ago(45 * MINUTE),
        resultJson: JSON.stringify({ editApplied: true }),
      });

      await as(ME, () => expireStaleActiveRequests({ designId: DESIGN_ID }));

      expect(await readRow(stalled.id)).toMatchObject({
        status: "needs-input",
        errorCode: "apply_incomplete",
      });
    });

    it("keeps a request that is still making progress", async () => {
      const live = await insertRow({
        status: "running",
        updatedAt: ago(5 * MINUTE),
      });

      await as(ME, () => expireStaleActiveRequests({ designId: DESIGN_ID }));

      expect((await readRow(live.id)).status).toBe("running");
    });

    it("limits a requester to three active requests on a design", async () => {
      for (const thread of ["a", "b", "c"]) {
        await insertRow({ threadId: `thread-${thread}`, status: "running" });
      }

      await expect(
        as(ME, () =>
          startReviewAgentRequest(
            startArgs({ mode: "reply", triggerCommentId: undefined }),
          ),
        ),
      ).rejects.toMatchObject({ errorCode: "rate_limited", statusCode: 429 });
    });

    it("limits a requester to thirty starts an hour, and only counts the last hour", async () => {
      for (let index = 0; index < 30; index += 1) {
        await insertRow({
          threadId: `old-${index}`,
          status: "cancelled",
          createdAt: ago(2 * 60 * MINUTE),
          updatedAt: ago(2 * 60 * MINUTE),
        });
      }
      const allowed = await as(ME, () =>
        startReviewAgentRequest(
          startArgs({ mode: "reply", triggerCommentId: undefined }),
        ),
      );
      expect(allowed.outcome).toBe("started");

      await mocks.pglite.exec("DELETE FROM design_review_agent_requests");
      for (let index = 0; index < 30; index += 1) {
        await insertRow({ threadId: `recent-${index}`, status: "cancelled" });
      }
      await expect(
        as(ME, () =>
          startReviewAgentRequest(
            startArgs({ mode: "reply", triggerCommentId: undefined }),
          ),
        ),
      ).rejects.toMatchObject({ errorCode: "rate_limited" });
    });

    describe("an @agent trigger comment", () => {
      const start = () => as(ME, () => startReviewAgentRequest(startArgs()));

      it("must be named", async () => {
        await expect(
          as(ME, () =>
            startReviewAgentRequest(startArgs({ triggerCommentId: undefined })),
          ),
        ).rejects.toMatchObject({ errorCode: "trigger_comment_required" });
      });

      it("must be in the thread", async () => {
        await expect(
          as(ME, () =>
            startReviewAgentRequest(
              startArgs({ triggerCommentId: "elsewhere" }),
            ),
          ),
        ).rejects.toMatchObject({
          errorCode: "trigger_comment_not_found",
          statusCode: 404,
        });
      });

      it("must be the requester's own, and written by a person", async () => {
        mocks.comments = [rootComment({ authorEmail: OTHER })];
        await expect(start()).rejects.toMatchObject({
          errorCode: "trigger_not_requesters",
        });

        mocks.comments = [rootComment({ createdBy: "agent" })];
        await expect(start()).rejects.toMatchObject({
          errorCode: "trigger_not_requesters",
        });
      });

      it("must mention an agent", async () => {
        mocks.comments = [rootComment({ mentions: [] })];
        await expect(start()).rejects.toMatchObject({
          errorCode: "no_agent_mention",
        });

        mocks.comments = [
          rootComment({
            mentions: [{ label: "Sam", email: "sam@example.com", id: null }],
          }),
        ];
        await expect(start()).rejects.toMatchObject({
          errorCode: "no_agent_mention",
        });
      });

      it("must say something", async () => {
        mocks.comments = [rootComment({ body: "[Reprompt selection]" })];
        await expect(start()).rejects.toMatchObject({
          errorCode: "instructions_empty",
        });
      });

      it("is bounded to 4,000 characters of instruction", async () => {
        mocks.comments = [rootComment({ body: "x".repeat(4_001) })];
        await expect(start()).rejects.toMatchObject({
          errorCode: "instructions_too_long",
        });
      });
    });

    describe("an apply-and-resolve request", () => {
      const start = () =>
        as(ME, () =>
          startReviewAgentRequest(
            startArgs({ mode: "apply-resolve", triggerCommentId: undefined }),
          ),
        );

      it("starts on an inline screen", async () => {
        expect((await start()).request.status).toBe("queued");
      });

      it("is unavailable on a board thread", async () => {
        mocks.comments = [rootComment({ targetId: null })];
        await expect(start()).rejects.toMatchObject({
          errorCode: "apply_unavailable",
        });
      });

      it("is unavailable when the screen is not an html file", async () => {
        await mocks.pglite.exec("UPDATE design_files SET file_type = 'css'");
        await expect(start()).rejects.toMatchObject({
          errorCode: "apply_unavailable",
        });
      });

      it("is unavailable on a screen stored as a localhost URL", async () => {
        await mocks.pglite.exec(
          "UPDATE design_files SET content = 'http://localhost:3000/checkout'",
        );
        await expect(start()).rejects.toMatchObject({
          errorCode: "apply_unavailable",
        });
      });

      it("is unavailable when the design is not an inline design", async () => {
        mocks.design = {
          ...mocks.design,
          data: JSON.stringify({ sourceType: "fusion" }),
        };
        await expect(start()).rejects.toMatchObject({
          errorCode: "apply_unavailable",
        });
      });

      it("is unavailable when the design data cannot be read", async () => {
        mocks.design = { ...mocks.design, data: "{not json" };
        await expect(start()).rejects.toMatchObject({
          errorCode: "apply_unavailable",
        });
      });

      it("is unavailable when the screen is marked as a localhost screen", async () => {
        mocks.design = {
          ...mocks.design,
          data: JSON.stringify({
            screenMetadata: { [SCREEN_ID]: { sourceType: "localhost" } },
          }),
        };
        await expect(start()).rejects.toMatchObject({
          errorCode: "apply_unavailable",
        });
      });
    });

    describe("the thread", () => {
      const start = () =>
        as(ME, () =>
          startReviewAgentRequest(
            startArgs({ mode: "reply", triggerCommentId: undefined }),
          ),
        );

      it("must be open", async () => {
        mocks.comments = [rootComment({ status: "resolved" })];
        await expect(start()).rejects.toMatchObject({
          errorCode: "thread_not_open",
        });
      });

      it("must exist", async () => {
        mocks.comments = [];
        await expect(start()).rejects.toMatchObject({
          errorCode: "thread_unavailable",
          statusCode: 404,
        });
      });

      it("must not have been deleted", async () => {
        mocks.comments = [rootComment({ deletedAt: new Date().toISOString() })];
        await expect(start()).rejects.toMatchObject({
          errorCode: "thread_unavailable",
        });
      });

      it("cannot have more than 100 comments", async () => {
        mocks.comments = [
          rootComment(),
          ...Array.from({ length: 100 }, () =>
            comment({ parentCommentId: ROOT }),
          ),
        ];
        await expect(start()).rejects.toMatchObject({
          errorCode: "thread_too_large",
        });
      });

      it("cannot be longer than 24,000 characters", async () => {
        mocks.comments = [
          rootComment(),
          comment({ parentCommentId: ROOT, body: "x".repeat(24_000) }),
        ];
        await expect(start()).rejects.toMatchObject({
          errorCode: "thread_too_large",
        });
      });
    });

    describe("who may start", () => {
      const start = (email: string | undefined) =>
        as(email, () =>
          startReviewAgentRequest(
            startArgs({ mode: "reply", triggerCommentId: undefined }),
          ),
        );

      it.each(["commenter", "viewer"] as const)(
        "refuses a %s, and writes nothing",
        async (role) => {
          mocks.role = role;
          await expect(start(ME)).rejects.toMatchObject({ statusCode: 403 });
          expect(await rowsOnThread()).toHaveLength(0);
        },
      );

      it("refuses someone who is signed out", async () => {
        await expect(start(undefined)).rejects.toMatchObject({
          errorCode: "sign_in_required",
          statusCode: 401,
        });
      });
    });
  });

  describe("transition", () => {
    it("moves a row once, and reports a lost race instead of success", async () => {
      const row = await insertRow({ status: "queued" });

      const begun = await transitionReviewAgentRequest(row, "begin");
      expect(begun?.status).toBe("running");

      // Same stale row, so the source status no longer matches in the table.
      expect(await transitionReviewAgentRequest(row, "begin")).toBeUndefined();
      expect((await readRow(row.id)).status).toBe("running");
    });

    it("refuses an event that is not legal from where the row is", async () => {
      const row = await insertRow({ status: "queued" });
      expect(await transitionReviewAgentRequest(row, "reply")).toBeUndefined();
      expect((await readRow(row.id)).status).toBe("queued");
    });

    it("never moves a row that already finished", async () => {
      const row = await insertRow({ status: "applied" });
      for (const event of ["fail", "cancel", "needInput"] as const) {
        expect(await transitionReviewAgentRequest(row, event)).toBeUndefined();
      }
      expect((await readRow(row.id)).status).toBe("applied");
    });

    it("writes the patch with the status", async () => {
      const row = await insertRow({ status: "running" });
      const failed = await transitionReviewAgentRequest(row, "fail", {
        errorCode: "run_failed",
        error: "The agent run failed before it finished.",
      });
      expect(failed).toMatchObject({
        status: "failed",
        errorCode: "run_failed",
      });
    });
  });

  describe("cancel", () => {
    it("stops a request that has not been dispatched, naming the classifier session to abort", async () => {
      const row = await insertRow({
        status: "classifying",
        intent: null,
        submittedMode: "auto",
      });

      const result = await as(ME, () =>
        cancelReviewAgentRequest({ requestId: row.id }),
      );

      expect(result).toMatchObject({
        changed: true,
        request: { status: "cancelled" },
        receipt: {
          threadId: row.classificationThreadId,
          turnId: row.classificationTurnId,
        },
      });
    });

    it("stops a running request, naming the execution session to abort", async () => {
      const row = await insertRow({ status: "running" });

      const result = await as(ME, () =>
        cancelReviewAgentRequest({ requestId: row.id }),
      );

      expect(result.receipt).toEqual({
        threadId: row.agentThreadId,
        turnId: row.agentTurnId,
      });
      expect((await readRow(row.id)).status).toBe("cancelled");
    });

    it("does not call a request cancelled once it has edited the design", async () => {
      const row = await insertRow({
        status: "running",
        resultJson: JSON.stringify({ editApplied: true, editsApplied: 1 }),
      });

      const result = await as(ME, () =>
        cancelReviewAgentRequest({ requestId: row.id }),
      );

      expect(result.request).toMatchObject({
        status: "needs-input",
        errorCode: "cancelled_after_edit",
      });
      expect(result.changed).toBe(true);
    });

    it("returns a finished request unchanged, as a no-op", async () => {
      const row = await insertRow({ status: "replied" });

      const result = await as(ME, () =>
        cancelReviewAgentRequest({ requestId: row.id }),
      );

      expect(result).toMatchObject({
        changed: false,
        receipt: null,
        request: { status: "replied" },
      });
    });

    it("is for the requester only", async () => {
      const row = await insertRow({ status: "running" });
      await expect(
        as(OTHER, () => cancelReviewAgentRequest({ requestId: row.id })),
      ).rejects.toMatchObject({ errorCode: "request_not_found" });
      expect((await readRow(row.id)).status).toBe("running");
    });

    it("needs edit access to still be there", async () => {
      const row = await insertRow({ status: "running" });
      mocks.role = "commenter";
      await expect(
        as(ME, () => cancelReviewAgentRequest({ requestId: row.id })),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect((await readRow(row.id)).status).toBe("running");
    });
  });

  describe("list", () => {
    it("shows active requests and those that finished in the last day, newest first", async () => {
      const active = await insertRow({
        threadId: "t-active",
        status: "running",
        updatedAt: ago(1 * MINUTE),
      });
      const recent = await insertRow({
        threadId: "t-recent",
        status: "replied",
        updatedAt: ago(60 * MINUTE),
      });
      await insertRow({
        threadId: "t-old",
        status: "replied",
        updatedAt: ago(2 * 24 * 60 * MINUTE),
      });

      const { requests } = await as(ME, () =>
        listReviewAgentRequests({ designId: DESIGN_ID }),
      );

      expect(requests.map((r) => r.requestId)).toEqual([active.id, recent.id]);
    });

    it("narrows to one thread", async () => {
      await insertRow({ threadId: "t-a", status: "running" });
      const other = await insertRow({ threadId: "t-b", status: "running" });

      const { requests } = await as(ME, () =>
        listReviewAgentRequests({ designId: DESIGN_ID, threadId: "t-b" }),
      );

      expect(requests.map((r) => r.requestId)).toEqual([other.id]);
    });

    it("gives a viewer the status without the requester's private fields", async () => {
      mocks.role = "viewer";
      await insertRow({ status: "running" });

      const { requests } = await as(OTHER, () =>
        listReviewAgentRequests({ designId: DESIGN_ID }),
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        status: "running",
        requesterIsMe: false,
        instructions: null,
        triggerCommentId: null,
        submitted: null,
        agentThreadId: null,
        agentTurnId: null,
        pendingSession: null,
      });
    });

    it("gives the requester their own session ids and instructions", async () => {
      await insertRow({
        status: "running",
        submittedModel: "claude-sonnet-5-5",
      });

      const { requests } = await as(ME, () =>
        listReviewAgentRequests({ designId: DESIGN_ID }),
      );

      expect(requests[0]).toMatchObject({
        requesterIsMe: true,
        instructions: "make the button blue",
        submitted: { model: "claude-sonnet-5-5" },
      });
      expect(requests[0]?.agentThreadId).toMatch(/^design-review-agent-/);
    });

    it("closes a request that stalled, so its card stops spinning", async () => {
      const stalled = await insertRow({
        status: "running",
        updatedAt: ago(40 * MINUTE),
      });

      const { requests } = await as(ME, () =>
        listReviewAgentRequests({ designId: DESIGN_ID }),
      );

      expect(requests[0]).toMatchObject({
        requestId: stalled.id,
        status: "failed",
        errorCode: "run_timeout",
      });
    });

    it("needs a signed-in viewer", async () => {
      await expect(
        as(undefined, () => listReviewAgentRequests({ designId: DESIGN_ID })),
      ).rejects.toMatchObject({ errorCode: "sign_in_required" });
      mocks.role = "viewer";
      mocks.design = { ...mocks.design, id: "other-design" };
      await expect(
        as(ME, () => listReviewAgentRequests({ designId: DESIGN_ID })),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe("serialize", () => {
    it("trims the stored message to 500 characters", async () => {
      const row = await insertRow({ status: "failed", error: "x".repeat(900) });
      expect(serializeReviewAgentRequest(row, ME).error).toHaveLength(500);
    });

    it("throws on a status it does not know, rather than showing a default", async () => {
      const row = await insertRow({ status: "bogus" });
      expect(() => serializeReviewAgentRequest(row, ME)).toThrow();
    });

    it("throws on a stored result it cannot read", async () => {
      const row = await insertRow({ resultJson: "{ not json" });
      expect(() => serializeReviewAgentRequest(row, ME)).toThrow();
      const wrong = await insertRow({
        threadId: "t2",
        resultJson: JSON.stringify({ editApplied: "yes" }),
      });
      expect(() => serializeReviewAgentRequest(wrong, ME)).toThrow();
    });

    it("offers a dispatch only while one is owed", async () => {
      const queued = await insertRow({ status: "queued", runId: null });
      const underway = await insertRow({
        threadId: "t2",
        status: "queued",
        runId: "run-1",
      });
      const classifying = await insertRow({
        threadId: "t3",
        status: "classifying",
        intent: null,
      });
      const finished = await insertRow({ threadId: "t4", status: "failed" });

      expect(
        serializeReviewAgentRequest(queued, ME).pendingSession?.phase,
      ).toBe("execution");
      expect(
        serializeReviewAgentRequest(underway, ME).pendingSession,
      ).toBeNull();
      expect(
        serializeReviewAgentRequest(classifying, ME).pendingSession?.phase,
      ).toBe("classification");
      expect(
        serializeReviewAgentRequest(finished, ME).pendingSession,
      ).toBeNull();
    });
  });

  describe("reconcile", () => {
    type Case = {
      phase: "classification" | "execution";
      from: "classifying" | "queued" | "running";
      status: ReviewAgentRunStatus;
      edited?: boolean;
      expected: { status: string; errorCode?: string | null } | "unchanged";
    };

    const cases: Case[] = [
      {
        phase: "classification",
        from: "classifying",
        status: "queued",
        expected: "unchanged",
      },
      {
        phase: "classification",
        from: "classifying",
        status: "running",
        expected: "unchanged",
      },
      {
        phase: "classification",
        from: "classifying",
        status: "unavailable",
        expected: "unchanged",
      },
      {
        phase: "classification",
        from: "classifying",
        status: "completed",
        expected: { status: "failed", errorCode: "no_result" },
      },
      {
        phase: "classification",
        from: "classifying",
        status: "truncated",
        expected: { status: "failed", errorCode: "no_result" },
      },
      {
        phase: "classification",
        from: "classifying",
        status: "errored",
        expected: { status: "failed", errorCode: "run_failed" },
      },
      {
        phase: "classification",
        from: "classifying",
        status: "aborted",
        expected: { status: "cancelled", errorCode: null },
      },
      {
        phase: "execution",
        from: "queued",
        status: "completed",
        expected: { status: "failed", errorCode: "no_result" },
      },
      {
        phase: "execution",
        from: "running",
        status: "truncated",
        expected: { status: "failed", errorCode: "no_result" },
      },
      {
        phase: "execution",
        from: "running",
        status: "errored",
        expected: { status: "failed", errorCode: "run_failed" },
      },
      {
        phase: "execution",
        from: "running",
        status: "aborted",
        expected: { status: "cancelled", errorCode: null },
      },
      {
        phase: "execution",
        from: "running",
        status: "running",
        expected: "unchanged",
      },
      {
        phase: "execution",
        from: "running",
        status: "unavailable",
        expected: "unchanged",
      },
      {
        phase: "execution",
        from: "running",
        status: "completed",
        edited: true,
        expected: { status: "needs-input", errorCode: "apply_incomplete" },
      },
      {
        phase: "execution",
        from: "running",
        status: "errored",
        edited: true,
        expected: { status: "needs-input", errorCode: "apply_incomplete" },
      },
      {
        phase: "execution",
        from: "running",
        status: "aborted",
        edited: true,
        expected: { status: "needs-input", errorCode: "cancelled_after_edit" },
      },
    ];

    it.each(cases)(
      "$phase run $status on a $from request (edited: $edited)",
      async ({ phase, from, status, edited, expected }) => {
        const row = await insertRow({
          status: from,
          intent: phase === "classification" ? null : "apply-resolve",
          ...(edited
            ? { resultJson: JSON.stringify({ editApplied: true }) }
            : {}),
        });

        const reconciled = await reconcileReviewAgentRun({
          requestId: row.id,
          phase,
          status,
        });

        if (expected === "unchanged") {
          expect(reconciled.status).toBe(from);
        } else {
          expect(reconciled).toMatchObject(expected);
        }
        expect((await readRow(row.id)).status).toBe(reconciled.status);
      },
    );

    it("can only ever produce a failure, a cancel or a question, never a success", async () => {
      const statuses: ReviewAgentRunStatus[] = [
        "queued",
        "running",
        "completed",
        "truncated",
        "errored",
        "aborted",
        "unavailable",
      ];
      for (const status of statuses) {
        for (const edited of [false, true]) {
          const row = await insertRow({
            threadId: `t-${status}-${edited}`,
            status: "running",
            ...(edited
              ? { resultJson: JSON.stringify({ editApplied: true }) }
              : {}),
          });
          const result = await reconcileReviewAgentRun({
            requestId: row.id,
            phase: "execution",
            status,
          });
          expect(["running", "failed", "cancelled", "needs-input"]).toContain(
            result.status,
          );
        }
      }
    });

    it("blames the engine when the browser could not even start the run", async () => {
      const row = await insertRow({ status: "queued" });
      const result = await reconcileReviewAgentRun({
        requestId: row.id,
        phase: "execution",
        status: "errored",
        clientErrorCode: "engine_not_configured",
      });
      expect(result).toMatchObject({
        status: "failed",
        errorCode: "engine_not_configured",
      });
    });

    it("records the run that ended", async () => {
      const row = await insertRow({ status: "running", runId: null });
      const result = await reconcileReviewAgentRun({
        requestId: row.id,
        phase: "execution",
        status: "errored",
        runId: "run-9",
      });
      expect(result.runId).toBe("run-9");
    });

    it("leaves a finished request alone", async () => {
      const row = await insertRow({ status: "applied" });
      for (const status of ["errored", "aborted", "completed"] as const) {
        const result = await reconcileReviewAgentRun({
          requestId: row.id,
          phase: "execution",
          status,
        });
        expect(result.status).toBe("applied");
      }
    });

    it("ignores a run from the other phase", async () => {
      const classifying = await insertRow({
        status: "classifying",
        intent: null,
      });
      const afterClassification = await reconcileReviewAgentRun({
        requestId: classifying.id,
        phase: "execution",
        status: "errored",
      });
      expect(afterClassification.status).toBe("classifying");

      const running = await insertRow({ threadId: "t2", status: "running" });
      const lateClassifier = await reconcileReviewAgentRun({
        requestId: running.id,
        phase: "classification",
        status: "errored",
      });
      expect(lateClassifier.status).toBe("running");
    });

    it("checks the server hook's run against the session the request minted", async () => {
      const row = await insertRow({ status: "running" });

      await expect(
        reconcileReviewAgentRun({
          requestId: row.id,
          phase: "execution",
          status: "errored",
          run: { threadId: "someone-elses-thread", turnId: row.agentTurnId! },
        }),
      ).rejects.toMatchObject({ errorCode: "scope_mismatch", statusCode: 409 });
      await expect(
        reconcileReviewAgentRun({
          requestId: row.id,
          phase: "execution",
          status: "errored",
          run: { threadId: row.agentThreadId!, turnId: "another-turn" },
        }),
      ).rejects.toMatchObject({ errorCode: "scope_mismatch" });
      expect((await readRow(row.id)).status).toBe("running");

      const ok = await reconcileReviewAgentRun({
        requestId: row.id,
        phase: "execution",
        status: "errored",
        run: { threadId: row.agentThreadId!, turnId: row.agentTurnId! },
      });
      expect(ok.status).toBe("failed");
    });

    it("checks the classifier phase against the classifier session", async () => {
      const row = await insertRow({ status: "classifying", intent: null });
      await expect(
        reconcileReviewAgentRun({
          requestId: row.id,
          phase: "classification",
          status: "errored",
          run: { threadId: row.agentThreadId!, turnId: row.agentTurnId! },
        }),
      ).rejects.toMatchObject({ errorCode: "scope_mismatch" });
      const ok = await reconcileReviewAgentRun({
        requestId: row.id,
        phase: "classification",
        status: "errored",
        run: {
          threadId: row.classificationThreadId!,
          turnId: row.classificationTurnId!,
        },
      });
      expect(ok.status).toBe("failed");
    });

    it("is only for the requester when the browser asks", async () => {
      const row = await insertRow({ status: "running" });
      await expect(
        reconcileReviewAgentRun({
          requestId: row.id,
          phase: "execution",
          status: "errored",
          requesterEmail: OTHER,
        }),
      ).rejects.toMatchObject({ errorCode: "request_not_found" });
      expect((await readRow(row.id)).status).toBe("running");
    });

    it("says so when the request does not exist", async () => {
      await expect(
        reconcileReviewAgentRun({
          requestId: crypto.randomUUID(),
          phase: "execution",
          status: "errored",
        }),
      ).rejects.toMatchObject({
        errorCode: "request_not_found",
        statusCode: 404,
      });
    });
  });

  describe("recording an edit", () => {
    it("is stored on a running request", async () => {
      const row = await insertRow({ status: "running" });
      const updated = await recordEditApplied(row, {
        editApplied: true,
        editsApplied: 2,
      });
      expect(updated.status).toBe("running");
      expect(JSON.parse(updated.resultJson!)).toMatchObject({
        editApplied: true,
        editsApplied: 2,
      });
    });

    it("turns a request that was cancelled mid-edit into needs-input, not 'stopped'", async () => {
      const row = await insertRow({ status: "cancelled" });
      const updated = await recordEditApplied(row, { editApplied: true });
      expect(updated).toMatchObject({
        status: "needs-input",
        errorCode: "cancelled_after_edit",
      });
    });

    it("keeps an ordinary edit's preview whole", () => {
      expect(previewEdits([{ search: "Get started", replace: "Go" }])).toEqual([
        { before: "Get started", after: "Go" },
      ]);
    });

    it("shortens a preview of multi-byte or quote-heavy text until it fits a row", () => {
      const texts = ["字".repeat(600), '"'.repeat(600), "😀".repeat(600)];
      for (const text of texts) {
        const changes = previewEdits(
          Array.from({ length: 5 }, () => ({ search: text, replace: text })),
        );
        expect(changes).toHaveLength(5);
        expect(resultFitsRow({ editApplied: true, changes })).toBe(true);
        for (const change of changes) {
          expect(change.truncated).toBe(true);
          expect(change.before).not.toBe("");
          expect(change.after).not.toBe("");
        }
      }
    });

    it("keeps a deletion a deletion when shortening", () => {
      const [change] = previewEdits([
        { search: "字".repeat(600), replace: "" },
      ]);
      expect(change?.after).toBe("");
      expect(change?.before).not.toBe("");
    });

    it("refuses a result larger than a row may hold", async () => {
      const row = await insertRow({ status: "running" });
      await expect(
        recordEditApplied(row, {
          editApplied: true,
          changes: [{ before: "x".repeat(9_000), after: "" }],
        }),
      ).rejects.toThrow(/size limit/);
    });
  });

  describe("agent text", () => {
    it("flattens mention markup so an agent cannot mention or email anyone", () => {
      expect(
        withoutMentionMarkup(
          "Ask @[Sam Lee](mailto:sam@example.com) to review",
        ),
      ).toBe("Ask @Sam Lee to review");
      expect(withoutMentionMarkup("plain @name text")).toBe("plain @name text");
    });

    it("normalizes the requester's instruction", () => {
      expect(normalizeInstructions("  go\r\nnow  ")).toBe("go\nnow");
      expect(() => normalizeInstructions("   ")).toThrow();
    });
  });
});
