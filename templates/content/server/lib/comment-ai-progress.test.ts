import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
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

const progress = vi.hoisted(() => ({
  getRunStatus: vi.fn(),
  getRunTurnRef: vi.fn(),
  getActiveRunForThreadAsync: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  ...progress,
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-ai-progress-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "comment-ai-progress@example.com";
const DOCUMENT_ID = "comment-ai-progress-page";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN_RUN_ID = "origin-run";
const AGENT_THREAD_ID = "agent-thread";

let getDb: typeof import("../db/index.js").getDb;
let schema: typeof import("../db/schema.js");
let listCommentAiRequests: typeof import("./comment-ai.js").listCommentAiRequests;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  ({ listCommentAiRequests } = await import("./comment-ai.js"));
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await getDb().delete(schema.commentAiRequests);
  await getDb().delete(schema.documents);

  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Comment AI progress",
    content: "Page body",
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.commentAiRequests).values({
    id: REQUEST_ID,
    ownerEmail: OWNER,
    requesterEmail: OWNER,
    documentId: DOCUMENT_ID,
    threadId: "comment-thread",
    rootCommentId: "root-comment",
    fieldId: "body",
    intent: "reply",
    status: "running",
    threadDigest: "digest",
    snapshotJson: "[]",
    baseRevision: "base-revision",
    suggestionRevision: now,
    runId: ORIGIN_RUN_ID,
    agentThreadId: AGENT_THREAD_ID,
    createdAt: now,
    updatedAt: now,
  });
  progress.getRunStatus.mockResolvedValue("completed");
  progress.getRunTurnRef.mockResolvedValue({
    threadId: AGENT_THREAD_ID,
    turnId: "turn-a",
  });
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("comment AI request run progress", () => {
  it("returns the durable request state without guessing from the latest thread run", async () => {
    const result = await asOwner(() => listCommentAiRequests(DOCUMENT_ID));

    expect(result.requests[0]).toMatchObject({
      requestId: REQUEST_ID,
      status: "running",
      error: null,
    });
    expect(progress.getRunTurnRef).not.toHaveBeenCalled();
    expect(progress.getActiveRunForThreadAsync).not.toHaveBeenCalled();
  });

  it("returns an explicitly persisted review state", async () => {
    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "needs-review", error: "Review the retained operation" })
      .where(eq(schema.commentAiRequests.id, REQUEST_ID));

    const result = await asOwner(() => listCommentAiRequests(DOCUMENT_ID));

    expect(result.requests[0]).toMatchObject({
      requestId: REQUEST_ID,
      status: "needs-review",
      error: "Review the retained operation",
    });
  });

  it("does not misattribute an unrelated successor run", async () => {
    progress.getActiveRunForThreadAsync.mockResolvedValue({
      runId: "unrelated-run",
      threadId: AGENT_THREAD_ID,
      turnId: "another-turn",
      status: "completed",
    });

    const result = await asOwner(() => listCommentAiRequests(DOCUMENT_ID));

    expect(result.requests[0]).toMatchObject({
      requestId: REQUEST_ID,
      status: "running",
      runId: ORIGIN_RUN_ID,
    });
    expect(progress.getActiveRunForThreadAsync).not.toHaveBeenCalled();
  });
});
