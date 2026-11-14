import { createRequire } from "node:module";

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

import { REVIEW_AGENT_ALLOWED_ACTIONS } from "../../shared/review-agent.js";
import * as schema from "../db/schema.js";
import { designReviewAgentRequestsMigration } from "../plugins/db.js";

const require = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const { PGlite } = require("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  pglite: undefined as any,
  db: undefined as any,
  dbReads: 0,
}));

vi.mock("../db/index.js", () => ({
  getDb: () => {
    mocks.dbReads += 1;
    return mocks.db;
  },
  schema,
}));
vi.mock("@agent-native/core/sharing", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  assertAccess: vi.fn(),
}));
vi.mock("@agent-native/core/review", () => ({
  getReviewThreadRoot: vi.fn(),
  queryReviewComments: vi.fn(),
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
  allowedActionNamesFor,
  finalizeReviewAgentRun,
  resolveReviewAgentActionSurface,
} from "./review-agent-surface.js";

const ME = "me@example.com";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";

const AGENT_KIND = "design-review-agent";
const CLASSIFIER_KIND = "design-review-agent-classifier";

type Over = Partial<typeof schema.designReviewAgentRequests.$inferInsert>;

async function insertRow(id: string, over: Over = {}) {
  const now = new Date().toISOString();
  const [row] = await mocks.db
    .insert(schema.designReviewAgentRequests)
    .values({
      id,
      designId: "design-1",
      threadId: `thread-${id}`,
      rootCommentId: "root",
      requesterEmail: ME,
      submittedMode: "auto",
      intent: "apply-resolve",
      instructions: "make it blue",
      status: "queued",
      classificationThreadId: `design-review-agent-classifier-${id}`,
      classificationTurnId: `classifier-turn-${id}`,
      agentThreadId: `design-review-agent-${id}`,
      agentTurnId: `agent-turn-${id}`,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .returning();
  return row as typeof schema.designReviewAgentRequests.$inferSelect;
}

const executionDetails = (id = REQUEST_ID, over = {}) => ({
  ownerEmail: ME,
  threadId: `design-review-agent-${id}`,
  requestedTurnId: `agent-turn-${id}`,
  queuedMessageId: id,
  actionScope: { kind: AGENT_KIND, requestId: id },
  ...over,
});
const classifierDetails = (id = REQUEST_ID, over = {}) => ({
  ownerEmail: ME,
  threadId: `design-review-agent-classifier-${id}`,
  requestedTurnId: `classifier-turn-${id}`,
  queuedMessageId: `${id}:classification`,
  actionScope: { kind: CLASSIFIER_KIND, requestId: id },
  ...over,
});

describe("the review agent action surface", () => {
  beforeAll(async () => {
    mocks.pglite = await PGlite.create("memory://");
    mocks.db = drizzle(mocks.pglite, { schema });
    const sql = designReviewAgentRequestsMigration.sql;
    if (typeof sql !== "string")
      throw new Error("migration SQL is not a string");
    await mocks.pglite.exec(`
      CREATE TABLE designs (id TEXT PRIMARY KEY);
      ${sql};
    `);
  });

  afterAll(async () => {
    await mocks.pglite.close();
  });

  beforeEach(async () => {
    await mocks.pglite.exec("TRUNCATE design_review_agent_requests, designs");
    await mocks.pglite.exec("INSERT INTO designs (id) VALUES ('design-1')");
    mocks.dbReads = 0;
  });

  describe("an ordinary chat request", () => {
    it.each([
      ["a thread with no scope", { ownerEmail: ME, threadId: "chat-123" }],
      ["a request with no thread", { ownerEmail: ME }],
      [
        "a request that declares another feature's scope",
        {
          ownerEmail: ME,
          threadId: "chat-123",
          actionScope: { kind: "content-comment-ai", requestId: REQUEST_ID },
        },
      ],
    ])(
      "gets the default surface for %s without touching the database",
      async (_name, details) => {
        expect(await resolveReviewAgentActionSurface(details)).toEqual({
          mode: "default",
        });
        expect(mocks.dbReads).toBe(0);
      },
    );
  });

  describe("allowed tools", () => {
    it("are exactly the classifier's two for a classification run", async () => {
      await insertRow(REQUEST_ID, { status: "classifying", intent: null });

      const surface =
        await resolveReviewAgentActionSurface(classifierDetails());

      expect(surface).toEqual({
        allowedActionNames: [
          "get-review-agent-context",
          "submit-review-agent-classification",
        ],
        actionScope: {
          kind: CLASSIFIER_KIND,
          requestId: REQUEST_ID,
          phase: "classification",
          intent: null,
        },
      });
    });

    it.each([
      [
        "reply",
        [
          "get-review-agent-context",
          "get-design-snapshot",
          "post-review-agent-reply",
        ],
      ],
      [
        "suggest",
        [
          "get-review-agent-context",
          "get-design-snapshot",
          "propose-review-agent-changes",
          "post-review-agent-reply",
        ],
      ],
      [
        "apply-resolve",
        [
          "get-review-agent-context",
          "get-design-snapshot",
          "apply-review-agent-changes",
          "post-review-agent-reply",
        ],
      ],
    ])("are exactly these for a %s run", async (intent, names) => {
      await insertRow(REQUEST_ID, { status: "queued", intent });

      const surface = await resolveReviewAgentActionSurface(executionDetails());

      expect(surface).toEqual({
        allowedActionNames: names,
        actionScope: {
          kind: AGENT_KIND,
          requestId: REQUEST_ID,
          phase: "execution",
          intent,
        },
      });
      expect(names).toEqual([
        ...REVIEW_AGENT_ALLOWED_ACTIONS[intent as "reply"],
      ]);
    });

    it("never offer a way to edit the design to a reply or suggest run", async () => {
      for (const intent of ["reply", "suggest"]) {
        await mocks.pglite.exec("TRUNCATE design_review_agent_requests");
        await insertRow(REQUEST_ID, { status: "running", intent });
        const surface = (await resolveReviewAgentActionSurface(
          executionDetails(),
        )) as { allowedActionNames: string[] };
        expect(surface.allowedActionNames).not.toContain(
          "apply-review-agent-changes",
        );
        expect(surface.allowedActionNames).not.toContain("edit-design");
      }
    });

    it("are the context read alone once the request has finished", async () => {
      for (const status of ["replied", "applied", "failed", "cancelled"]) {
        await mocks.pglite.exec("TRUNCATE design_review_agent_requests");
        await insertRow(REQUEST_ID, { status, intent: "apply-resolve" });
        const surface =
          await resolveReviewAgentActionSurface(executionDetails());
        expect(surface).toEqual({
          allowedActionNames: ["get-review-agent-context"],
          actionScope: {
            kind: AGENT_KIND,
            requestId: REQUEST_ID,
            phase: "execution",
            intent: "apply-resolve",
          },
        });
      }
    });

    it("are the context read alone for a classifier thread that is done classifying", async () => {
      await insertRow(REQUEST_ID, { status: "running" });

      const surface =
        await resolveReviewAgentActionSurface(classifierDetails());

      expect(surface).toMatchObject({
        allowedActionNames: ["get-review-agent-context"],
        actionScope: { phase: "classification" },
      });
    });

    it("hold for a follow-up typed into the opened chat, with no declared scope", async () => {
      await insertRow(REQUEST_ID, { status: "running", intent: "suggest" });

      const surface = await resolveReviewAgentActionSurface({
        ownerEmail: ME,
        threadId: `design-review-agent-${REQUEST_ID}`,
        queuedMessageId: "a-later-message",
      });

      expect(surface).toMatchObject({
        allowedActionNames: REVIEW_AGENT_ALLOWED_ACTIONS.suggest,
        actionScope: { requestId: REQUEST_ID, intent: "suggest" },
      });
    });

    it("are not offered to an execution thread before the request is classified", async () => {
      await insertRow(REQUEST_ID, { status: "classifying", intent: null });

      await expect(
        resolveReviewAgentActionSurface(executionDetails()),
      ).rejects.toMatchObject({ errorCode: "not_classified", statusCode: 409 });
    });

    it("name only actions that exist for every phase and intent", () => {
      expect(
        allowedActionNamesFor("classifying", "classification", null),
      ).toEqual([...REVIEW_AGENT_ALLOWED_ACTIONS.classification]);
      expect(allowedActionNamesFor("running", "classification", null)).toEqual([
        ...REVIEW_AGENT_ALLOWED_ACTIONS.terminal,
      ]);
      expect(() =>
        allowedActionNamesFor("running", "execution", null),
      ).toThrow();
    });
  });

  describe("binding", () => {
    it("fails closed when the request no longer exists", async () => {
      await expect(
        resolveReviewAgentActionSurface(executionDetails()),
      ).rejects.toMatchObject({
        errorCode: "binding_missing",
        statusCode: 409,
      });
    });

    it("fails closed on a reserved thread with no request, instead of giving it the full tool set", async () => {
      await expect(
        resolveReviewAgentActionSurface({
          ownerEmail: ME,
          threadId: `design-review-agent-${REQUEST_ID}`,
        }),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
      await expect(
        resolveReviewAgentActionSurface({
          ownerEmail: ME,
          threadId: `design-review-agent-classifier-${REQUEST_ID}`,
        }),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
    });

    it("refuses a scope declared for another request's thread", async () => {
      await insertRow(REQUEST_ID, { intent: "reply" });
      await insertRow(OTHER_REQUEST_ID, { intent: "apply-resolve" });

      await expect(
        resolveReviewAgentActionSurface(
          executionDetails(OTHER_REQUEST_ID, {
            // Lend the apply request's scope to the reply request's thread.
            threadId: `design-review-agent-${REQUEST_ID}`,
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: "binding_missing",
        statusCode: 409,
      });
    });

    it("refuses a classifier scope declared on an execution thread, and the reverse", async () => {
      await insertRow(REQUEST_ID, { status: "classifying", intent: null });

      await expect(
        resolveReviewAgentActionSurface(
          executionDetails(REQUEST_ID, {
            actionScope: { kind: CLASSIFIER_KIND, requestId: REQUEST_ID },
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
      await expect(
        resolveReviewAgentActionSurface(
          classifierDetails(REQUEST_ID, {
            actionScope: { kind: AGENT_KIND, requestId: REQUEST_ID },
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
    });

    it("refuses a scope with anything but a kind and a request id", async () => {
      await insertRow(REQUEST_ID);

      for (const actionScope of [
        { kind: AGENT_KIND, requestId: REQUEST_ID, intent: "apply-resolve" },
        { kind: AGENT_KIND, requestId: "not-a-uuid" },
        { kind: AGENT_KIND },
      ]) {
        await expect(
          resolveReviewAgentActionSurface(
            executionDetails(REQUEST_ID, { actionScope }),
          ),
        ).rejects.toMatchObject({ errorCode: "binding_missing" });
      }
    });

    it("refuses someone other than the requester", async () => {
      await insertRow(REQUEST_ID);
      await expect(
        resolveReviewAgentActionSurface(
          executionDetails(REQUEST_ID, { ownerEmail: "intruder@example.com" }),
        ),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
      await expect(
        resolveReviewAgentActionSurface(
          executionDetails(REQUEST_ID, { ownerEmail: null }),
        ),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
    });

    it("refuses a first message that carries a turn the request did not mint", async () => {
      await insertRow(REQUEST_ID);

      await expect(
        resolveReviewAgentActionSurface(
          executionDetails(REQUEST_ID, { requestedTurnId: "forged-turn" }),
        ),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
      await expect(
        resolveReviewAgentActionSurface(
          executionDetails(REQUEST_ID, { requestedTurnId: undefined }),
        ),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
    });

    it("refuses a request with no stored turn", async () => {
      await insertRow(REQUEST_ID, { agentTurnId: null });
      await expect(
        resolveReviewAgentActionSurface(executionDetails()),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
    });

    it("binds a classifier's first message to the classifier turn", async () => {
      await insertRow(REQUEST_ID, { status: "classifying", intent: null });
      await expect(
        resolveReviewAgentActionSurface(
          classifierDetails(REQUEST_ID, {
            requestedTurnId: `agent-turn-${REQUEST_ID}`,
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "binding_missing" });
    });
  });

  describe("finalizing a run that ended", () => {
    const run = (id: string, status: string, over = {}) => ({
      threadId: `design-review-agent-${id}`,
      turnId: `agent-turn-${id}`,
      runId: "run-1",
      status,
      ...over,
    });

    it("closes a request whose run ended without finishing it", async () => {
      await insertRow(REQUEST_ID, { status: "running" });

      await finalizeReviewAgentRun(
        { type: AGENT_KIND, id: REQUEST_ID },
        run(REQUEST_ID, "completed"),
        { turnContinues: false },
      );

      const [row] = await mocks.db
        .select()
        .from(schema.designReviewAgentRequests)
        .limit(1);
      expect(row).toMatchObject({
        status: "failed",
        errorCode: "no_result",
        runId: "run-1",
      });
    });

    it("closes a classifier that never chose an intent", async () => {
      await insertRow(REQUEST_ID, { status: "classifying", intent: null });

      await finalizeReviewAgentRun(
        { type: CLASSIFIER_KIND, id: REQUEST_ID },
        {
          threadId: `design-review-agent-classifier-${REQUEST_ID}`,
          turnId: `classifier-turn-${REQUEST_ID}`,
          runId: "run-0",
          status: "errored",
        },
        { turnContinues: false },
      );

      const [row] = await mocks.db
        .select()
        .from(schema.designReviewAgentRequests)
        .limit(1);
      expect(row).toMatchObject({ status: "failed", errorCode: "run_failed" });
    });

    it("waits while the turn continues in another run", async () => {
      await insertRow(REQUEST_ID, { status: "running" });

      await finalizeReviewAgentRun(
        { type: AGENT_KIND, id: REQUEST_ID },
        run(REQUEST_ID, "truncated"),
        { turnContinues: true },
      );

      const [row] = await mocks.db
        .select()
        .from(schema.designReviewAgentRequests)
        .limit(1);
      expect(row.status).toBe("running");
    });

    it("does nothing for a chat that is not a review agent run", async () => {
      await finalizeReviewAgentRun(
        { type: "design", id: "design-1" },
        run(REQUEST_ID, "errored"),
        { turnContinues: false },
      );
      await finalizeReviewAgentRun(null, run(REQUEST_ID, "errored"), {
        turnContinues: false,
      });
      await finalizeReviewAgentRun(undefined, run(REQUEST_ID, "errored"), {
        turnContinues: false,
      });
      expect(mocks.dbReads).toBe(0);
    });

    it("has nothing to finalize once the design, and with it the request, was deleted", async () => {
      await expect(
        finalizeReviewAgentRun(
          { type: AGENT_KIND, id: REQUEST_ID },
          run(REQUEST_ID, "errored"),
          { turnContinues: false },
        ),
      ).resolves.toBeUndefined();
    });

    it("leaves a request that already finished as it is", async () => {
      await insertRow(REQUEST_ID, { status: "applied" });

      await finalizeReviewAgentRun(
        { type: AGENT_KIND, id: REQUEST_ID },
        run(REQUEST_ID, "aborted"),
        { turnContinues: false },
      );

      const [row] = await mocks.db
        .select()
        .from(schema.designReviewAgentRequests)
        .limit(1);
      expect(row.status).toBe("applied");
    });

    it("refuses a run that is not the request's own", async () => {
      await insertRow(REQUEST_ID, { status: "running" });

      await expect(
        finalizeReviewAgentRun(
          { type: AGENT_KIND, id: REQUEST_ID },
          run(REQUEST_ID, "errored", { turnId: "forged" }),
          { turnContinues: false },
        ),
      ).rejects.toMatchObject({ errorCode: "scope_mismatch" });
    });

    it("throws on a run status it does not know, rather than guessing", async () => {
      await insertRow(REQUEST_ID, { status: "running" });

      await expect(
        finalizeReviewAgentRun(
          { type: AGENT_KIND, id: REQUEST_ID },
          run(REQUEST_ID, "paused"),
          { turnContinues: false },
        ),
      ).rejects.toThrow();
    });
  });
});
