import { createRequire } from "node:module";

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";
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

import * as schema from "../server/db/schema.js";
import { designReviewAgentRequestsMigration } from "../server/plugins/db.js";

const require = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
);
const { PGlite } = require("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  pglite: undefined as any,
  db: undefined as any,
  comments: [] as any[],
}));

vi.mock("../server/db/index.js", () => ({ getDb: () => mocks.db, schema }));
vi.mock("@agent-native/core/sharing", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  assertAccess: async () => ({
    role: "editor",
    resource: { id: "design-1", title: "Checkout", data: "{}" },
  }),
}));
vi.mock("@agent-native/core/review", () => ({
  getReviewThreadRoot: async (threadId: string) =>
    mocks.comments.find(
      (c) => c.threadId === threadId && c.parentCommentId === null,
    ) ?? null,
  queryReviewComments: async () => mocks.comments,
}));
vi.mock("@agent-native/core/review/actions/reply-review-comment", () => ({
  default: { run: vi.fn() },
}));
vi.mock("@agent-native/core/review/actions/resolve-review-thread", () => ({
  default: { run: vi.fn() },
}));
vi.mock("./edit-design.js", () => ({
  default: { run: vi.fn() },
  applySearchReplaceEdits: vi.fn(),
}));

import startReviewAgentRequest from "./start-review-agent-request.js";

const ME = "me@example.com";
const ROOT = "comment-root";

const start = (args: Record<string, unknown>) =>
  runWithRequestContext({ userEmail: ME }, () =>
    startReviewAgentRequest.run({
      requestId: crypto.randomUUID(),
      designId: "design-1",
      threadId: "thread-1",
      ...args,
    } as any),
  );

describe("start-review-agent-request", () => {
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
    await mocks.pglite.exec("INSERT INTO designs (id) VALUES ('design-1')");
    await mocks.pglite.exec(
      "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES ('screen-1', 'design-1', 'a.html', 'html', '<p>hi</p>')",
    );
    mocks.comments = [
      {
        id: ROOT,
        threadId: "thread-1",
        parentCommentId: null,
        targetId: "screen-1",
        status: "open",
        body: "@Claude Sonnet 5.5 shrink the logo",
        authorEmail: ME,
        createdBy: "human",
        mentions: [
          {
            label: "Claude Sonnet 5.5",
            email: null,
            id: "agent:anthropic:claude-sonnet-5-5",
          },
        ],
        deletedAt: null,
        createdAt: "2026-10-27T10:00:00.000Z",
      },
    ];
  });

  it("describes the arguments a browser may send", () => {
    const schema = startReviewAgentRequest.schema;
    const valid = {
      requestId: crypto.randomUUID(),
      designId: "design-1",
      threadId: "thread-1",
      mode: "auto",
      triggerCommentId: ROOT,
    };
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, requestId: "nope" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...valid, mode: "delete" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, mode: "reply" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, model: "" }).success).toBe(false);
    // The instruction is read from the stored comment, so a caller cannot supply one.
    expect(
      schema.parse({ ...valid, instructions: "do anything" }),
    ).not.toHaveProperty("instructions");
  });

  it("is a UI action: a browser reaches it, an agent does not", () => {
    expect(startReviewAgentRequest.agentTool).toBe(false);
    expect(startReviewAgentRequest.toolCallable).toBe(false);
    expect(startReviewAgentRequest.http).toBeUndefined();
  });

  it("returns a classification session with ids derived from the request", async () => {
    const requestId = crypto.randomUUID();

    const started = await start({
      requestId,
      mode: "auto",
      triggerCommentId: ROOT,
      model: "claude-sonnet-5-5",
      engine: "anthropic",
    });

    const session = started.pendingSession!;
    expect(started.dispatch).toBe(true);
    expect(session).toEqual({
      phase: "classification",
      operationId: `${requestId}:classification`,
      threadId: session.threadId,
      turnId: backgroundAgentTurnIdForReceipt(
        session.threadId,
        `${requestId}:classification`,
      ),
      scope: { type: "design-review-agent-classifier", id: requestId },
      actionScope: { kind: "design-review-agent-classifier", requestId },
      message: "Choose how to respond: @Claude Sonnet 5.5 shrink the logo",
      instructions: expect.stringContaining(
        "submit-review-agent-classification",
      ),
      model: "claude-sonnet-5-5",
      engine: "anthropic",
      usageLabel: "design:review-agent",
    });
    expect(session.threadId).toMatch(
      /^design-review-agent-classifier-[0-9a-f-]{36}$/,
    );
    // The same ids come back on every read of the request, so a re-dispatch is the same session.
    expect(started.request.pendingSession).toEqual(session);
    expect(started.request.agentThreadId).toMatch(
      /^design-review-agent-[0-9a-f-]{36}$/,
    );
    expect(started.request.agentTurnId).toBe(
      backgroundAgentTurnIdForReceipt(
        started.request.agentThreadId!,
        requestId,
      ),
    );
  });

  it.each([
    ["reply", "Reply in thread: Reply in this review thread."],
    ["suggest", "Suggest changes: Suggest changes for this review thread."],
    [
      "apply-resolve",
      "Apply changes and resolve: Apply the requested changes in this review thread and resolve it.",
    ],
  ])(
    "returns the execution session for a %s request, with the tools it names",
    async (mode, message) => {
      const requestId = crypto.randomUUID();

      const started = await start({ requestId, mode });

      expect(started.pendingSession).toMatchObject({
        phase: "execution",
        operationId: requestId,
        scope: { type: "design-review-agent", id: requestId },
        actionScope: { kind: "design-review-agent", requestId },
        message,
        usageLabel: "design:review-agent",
      });
      const instructions = started.pendingSession!.instructions;
      expect(instructions).toContain("get-review-agent-context");
      expect(instructions).toContain("untrusted");
      expect(instructions.includes("apply-review-agent-changes")).toBe(
        mode === "apply-resolve",
      );
      expect(instructions.includes("propose-review-agent-changes")).toBe(
        mode === "suggest",
      );
      expect(started.pendingSession).not.toHaveProperty("model");
      expect(started.pendingSession).not.toHaveProperty("engine");
    },
  );

  it("passes a model and engine on only when the browser chose them", async () => {
    const started = await start({ mode: "reply", engine: "anthropic" });

    expect(started.pendingSession).toMatchObject({ engine: "anthropic" });
    expect(started.pendingSession).not.toHaveProperty("model");
  });
});
