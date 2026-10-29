import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { getDbExec } from "@agent-native/core/db";
import {
  importReviewComments,
  queryReviewComments,
  type ImportReviewCommentInput,
} from "@agent-native/core/review";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  SLIDE_REVIEW_AGENT_ALLOWED_ACTIONS,
  SLIDE_REVIEW_AGENT_SCOPE,
} from "../../shared/slide-review-agent.js";
import { getDb, schema } from "../db/index.js";
import {
  applySlideReviewAgentChanges,
  cancelSlideReviewAgentRequest,
  finalizeSlideReviewAgentRun,
  postSlideReviewAgentReply,
  resolveSlideReviewAgentActionSurface,
  startSlideReviewAgentRequest,
} from "./slide-review-agent.js";

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}

// The database URL is read when the db modules load, so it is set before them.
const TEST_DB_PATH = await vi.hoisted(async () => {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const path = join(
    tmpdir(),
    `slide-review-agent-${process.pid}-${Date.now()}.pglite`,
  );
  process.env.DATABASE_URL = `pglite:${path}`;
  process.env.APP_URL = "https://slides.example.test";
  return path;
});

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const VIEWER = "viewer@example.com";
const DECK = "deck-agent";
// Engine ids hold colons, so the chip id cannot be split back into its parts.
const AGENT = { engine: "ai-sdk:openai", model: "gpt-6-luna" };
const AGENT_MENTION = {
  id: "agent:ai-sdk:openai:gpt-6-luna",
  label: "GPT-6 Luna",
};

let threadCount = 0;

/** A fresh open thread whose root is `author`'s comment on slide-2. */
async function thread(
  options: {
    author?: string;
    mentions?: ImportReviewCommentInput["mentions"];
    status?: "open" | "resolved";
  } = {},
) {
  const threadId = `thread-${++threadCount}`;
  const rootId = `${threadId}-root`;
  await importReviewComments([
    {
      id: rootId,
      resourceType: "deck",
      resourceId: DECK,
      threadId,
      targetId: "slide-2",
      status: options.status ?? "open",
      anchor: { kind: "slide", slideId: "slide-2", quotedText: "Revenue" },
      body: "@Claude tighten this",
      authorEmail: options.author ?? OWNER,
      createdBy: "human",
      mentions: options.mentions ?? [AGENT_MENTION],
      ownerEmail: OWNER,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  return { threadId, rootId };
}

function as<T>(userEmail: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail }, fn) as Promise<T>;
}

function inRun<T>(
  userEmail: string,
  requestId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithRequestContext(
    {
      userEmail,
      run: { actionScope: { kind: SLIDE_REVIEW_AGENT_SCOPE, requestId } },
    },
    fn,
  ) as Promise<T>;
}

async function start(
  userEmail = OWNER,
  options: Parameters<typeof thread>[0] = {},
) {
  const { threadId, rootId } = await thread(options);
  const requestId = randomUUID();
  const result = await as(userEmail, () =>
    startSlideReviewAgentRequest({
      requestId,
      deckId: DECK,
      threadId,
      triggerCommentId: rootId,
      engine: AGENT.engine,
      model: AGENT.model,
    }),
  );
  return { ...result, requestId, threadId, rootId };
}

async function stored(requestId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.slideReviewAgentRequests)
    .where(eq(schema.slideReviewAgentRequests.id, requestId));
  return row;
}

async function threadComments(threadId: string) {
  const comments = await queryReviewComments({
    resourceType: "deck",
    resourceId: DECK,
    scope: {},
    bypassScope: true,
    includeResolved: true,
  });
  return comments.filter((comment) => comment.threadId === threadId);
}

beforeAll(async () => {
  const { runSlidesMigrations } = await import("../plugins/db.js");
  await runSlidesMigrations(undefined);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
  await getDb()
    .insert(schema.decks)
    .values({
      id: DECK,
      title: "Agent deck",
      data: JSON.stringify({
        slides: [
          { id: "slide-1", content: "<h1>One</h1>" },
          { id: "slide-2", content: "<h1>Two</h1>" },
        ],
      }),
      ownerEmail: OWNER,
      visibility: "private",
    });
  await getDb()
    .insert(schema.deckShares)
    .values([
      {
        id: "share-editor",
        resourceId: DECK,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
      },
      {
        id: "share-viewer",
        resourceId: DECK,
        principalType: "user",
        principalId: VIEWER,
        role: "viewer",
        createdBy: OWNER,
      },
    ]);
}, 120_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("starting a review-agent request", () => {
  it("records the tagged agent's engine and model, and a retry returns the same request", async () => {
    const { request, started, requestId, threadId, rootId } = await start();

    expect(started).toBe(true);
    expect(await stored(requestId)).toMatchObject({
      deckId: DECK,
      threadId,
      rootCommentId: rootId,
      triggerCommentId: rootId,
      slideId: "slide-2",
      requesterEmail: OWNER,
      status: "queued",
      engine: "ai-sdk:openai",
      model: "gpt-6-luna",
    });
    expect(request).toMatchObject({
      status: "queued",
      mine: true,
      agentName: "GPT-6 Luna",
      session: {
        model: "gpt-6-luna",
        engine: "ai-sdk:openai",
        actionScope: { kind: SLIDE_REVIEW_AGENT_SCOPE, requestId },
      },
    });

    const retry = await as(OWNER, () =>
      startSlideReviewAgentRequest({
        requestId,
        deckId: DECK,
        threadId,
        triggerCommentId: rootId,
        engine: AGENT.engine,
        model: AGENT.model,
      }),
    );
    expect(retry).toMatchObject({ started: false, request: { requestId } });
  });

  it("refuses a second active request on the same thread", async () => {
    const { threadId, rootId } = await start();
    const requestId = randomUUID();

    await expect(
      as(OWNER, () =>
        startSlideReviewAgentRequest({
          requestId,
          deckId: DECK,
          threadId,
          triggerCommentId: rootId,
          engine: AGENT.engine,
          model: AGENT.model,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "busy", statusCode: 409 });
    expect(await stored(requestId)).toBeUndefined();
  });

  it.each([
    ["a viewer", VIEWER, {}, "editor_required", 403],
    ["someone else's comment", EDITOR, {}, "trigger_comment_not_found", 404],
    [
      "a comment that tags only a person",
      OWNER,
      {
        mentions: [{ id: "user:sam", label: "Sam", email: "sam@example.com" }],
      },
      "no_agent_mention",
      400,
    ],
    [
      "a resolved thread",
      OWNER,
      { status: "resolved" as const },
      "thread_not_open",
      409,
    ],
  ])(
    "refuses %s",
    async (_label, requester, options, errorCode, statusCode) => {
      const { threadId, rootId } = await thread(options);
      const requestId = randomUUID();

      await expect(
        as(requester, () =>
          startSlideReviewAgentRequest({
            requestId,
            deckId: DECK,
            threadId,
            triggerCommentId: rootId,
            engine: AGENT.engine,
            model: AGENT.model,
          }),
        ),
      ).rejects.toMatchObject({ errorCode, statusCode });
      expect(await stored(requestId)).toBeUndefined();
    },
  );
});

describe("review-agent tool surface", () => {
  it("leaves ordinary chats on the default surface", async () => {
    await expect(
      resolveSlideReviewAgentActionSurface({
        ownerEmail: OWNER,
        threadId: "chat-thread-1",
      }),
    ).resolves.toEqual({ mode: "default" });
  });

  it("limits a request's own thread to the review-agent actions", async () => {
    const { requestId } = await start();
    const row = await stored(requestId);

    await expect(
      resolveSlideReviewAgentActionSurface({
        ownerEmail: OWNER,
        threadId: present(row).agentThreadId,
      }),
    ).resolves.toEqual({
      allowedActionNames: [...SLIDE_REVIEW_AGENT_ALLOWED_ACTIONS],
      actionScope: { kind: SLIDE_REVIEW_AGENT_SCOPE, requestId },
    });
  });

  it("fails closed for a reserved thread with no request or another owner", async () => {
    const { requestId } = await start();
    const row = await stored(requestId);

    await expect(
      resolveSlideReviewAgentActionSurface({
        ownerEmail: OWNER,
        threadId: `slides-review-agent-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ errorCode: "scope_mismatch" });
    await expect(
      resolveSlideReviewAgentActionSurface({
        ownerEmail: EDITOR,
        threadId: present(row).agentThreadId,
      }),
    ).rejects.toMatchObject({ errorCode: "scope_mismatch" });
    await expect(
      resolveSlideReviewAgentActionSurface({
        ownerEmail: OWNER,
        threadId: "chat-thread-1",
        actionScope: { kind: SLIDE_REVIEW_AGENT_SCOPE, requestId },
      }),
    ).rejects.toMatchObject({ errorCode: "scope_mismatch" });
  });
});

describe("finishing a review-agent request", () => {
  it("refuses the finishing actions outside a scoped run", async () => {
    await expect(
      as(OWNER, () => postSlideReviewAgentReply({ body: "Hi" }, undefined)),
    ).rejects.toMatchObject({ errorCode: "scope_required", statusCode: 403 });
    await expect(
      as(OWNER, () =>
        applySlideReviewAgentChanges({ summary: "Done" }, undefined),
      ),
    ).rejects.toMatchObject({ errorCode: "scope_required", statusCode: 403 });
  });

  it("posts the agent's reply and marks the request replied, once", async () => {
    const { requestId, threadId, rootId } = await start();

    const result = await inRun(OWNER, requestId, () =>
      postSlideReviewAgentReply({ body: "It reads well." }, undefined),
    );

    expect(result.request.status).toBe("replied");
    expect(await stored(requestId)).toMatchObject({
      status: "replied",
      replyCommentId: result.commentId,
    });
    const reply = (await threadComments(threadId)).find(
      (comment) => comment.id === result.commentId,
    );
    expect(reply).toMatchObject({
      parentCommentId: rootId,
      body: "It reads well.",
      createdBy: "agent",
      status: "open",
    });
    await expect(
      inRun(OWNER, requestId, () =>
        postSlideReviewAgentReply({ body: "Again" }, undefined),
      ),
    ).rejects.toMatchObject({ errorCode: "request_not_active" });
  });

  it("posts the summary, resolves the thread and marks the request applied", async () => {
    const { requestId, threadId } = await start();

    const result = await inRun(OWNER, requestId, () =>
      applySlideReviewAgentChanges(
        { summary: "Shortened the title." },
        undefined,
      ),
    );

    expect(result).toMatchObject({
      resolved: true,
      request: { status: "applied" },
    });
    expect(await stored(requestId)).toMatchObject({
      status: "applied",
      replyCommentId: result.commentId,
    });
    const comments = await threadComments(threadId);
    expect(comments.map((comment) => comment.status)).toEqual([
      "resolved",
      "resolved",
    ]);
    expect(
      comments.find((comment) => comment.id === result.commentId),
    ).toMatchObject({
      body: "Shortened the title.",
      createdBy: "agent",
    });
  });

  it("lets only the requester cancel", async () => {
    const { requestId } = await start();

    await expect(
      as(EDITOR, () => cancelSlideReviewAgentRequest({ requestId })),
    ).rejects.toMatchObject({
      errorCode: "request_not_found",
      statusCode: 404,
    });
    expect(present(await stored(requestId)).status).toBe("queued");

    const cancelled = await as(OWNER, () =>
      cancelSlideReviewAgentRequest({ requestId }),
    );
    const row = await stored(requestId);
    expect(present(row).status).toBe("cancelled");
    expect(cancelled).toMatchObject({
      changed: true,
      receipt: {
        threadId: present(row).agentThreadId,
        turnId: present(row).agentTurnId,
      },
    });
    await expect(
      as(OWNER, () => cancelSlideReviewAgentRequest({ requestId })),
    ).resolves.toMatchObject({ changed: false, receipt: null });
  });

  it("fails, rather than cancels, a request whose run never started", async () => {
    const { requestId } = await start();

    const result = await as(OWNER, () =>
      cancelSlideReviewAgentRequest({ requestId, failure: "dispatch_failed" }),
    );
    expect(result).toMatchObject({ changed: true, receipt: null });
    expect(await stored(requestId)).toMatchObject({
      status: "failed",
      errorCode: "dispatch_failed",
    });
  });

  it("refuses a chip naming a different model than the one sent", async () => {
    const { threadId, rootId } = await thread({ mentions: [AGENT_MENTION] });
    await expect(
      as(OWNER, () =>
        startSlideReviewAgentRequest({
          requestId: randomUUID(),
          deckId: DECK,
          threadId,
          triggerCommentId: rootId,
          engine: "ai-sdk:openai",
          model: "gpt-5-5",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "no_agent_mention" });
  });

  it("fails a run that ended without finishing, and cancels an aborted one", async () => {
    const unfinished = await start();
    const aborted = await start();
    const continuing = await start();
    const scope = (requestId: string) => ({
      type: SLIDE_REVIEW_AGENT_SCOPE,
      id: requestId,
    });

    await finalizeSlideReviewAgentRun(
      scope(unfinished.requestId),
      { status: "completed" },
      { turnContinues: false },
    );
    await finalizeSlideReviewAgentRun(
      scope(aborted.requestId),
      { status: "aborted" },
      { turnContinues: false },
    );
    await finalizeSlideReviewAgentRun(
      scope(continuing.requestId),
      { status: "completed" },
      { turnContinues: true },
    );

    expect(await stored(unfinished.requestId)).toMatchObject({
      status: "failed",
      errorCode: "no_result",
    });
    expect(await stored(aborted.requestId)).toMatchObject({
      status: "cancelled",
      errorCode: null,
    });
    expect(present(await stored(continuing.requestId)).status).toBe("queued");
  });

  it("leaves a request that already finished alone", async () => {
    const { requestId } = await start();
    await inRun(OWNER, requestId, () =>
      postSlideReviewAgentReply({ body: "Done." }, undefined),
    );

    await finalizeSlideReviewAgentRun(
      { type: SLIDE_REVIEW_AGENT_SCOPE, id: requestId },
      { status: "completed" },
      { turnContinues: false },
    );

    expect(present(await stored(requestId)).status).toBe("replied");
  });
});
