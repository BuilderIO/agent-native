import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
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
  it("keeps a request active while a same-turn successor is running", async () => {
    progress.getActiveRunForThreadAsync.mockResolvedValue({
      runId: "successor-run",
      threadId: AGENT_THREAD_ID,
      turnId: "turn-a",
      status: "running",
    });

    const result = await asOwner(() => listCommentAiRequests(DOCUMENT_ID));

    expect(result.requests[0]).toMatchObject({
      requestId: REQUEST_ID,
      status: "running",
      error: null,
    });
    expect(progress.getRunTurnRef).toHaveBeenCalledWith(ORIGIN_RUN_ID);
    expect(progress.getActiveRunForThreadAsync).toHaveBeenCalledWith(
      AGENT_THREAD_ID,
    );
  });

  it("does not adopt a running successor from another turn", async () => {
    progress.getActiveRunForThreadAsync.mockResolvedValue({
      runId: "unrelated-run",
      threadId: AGENT_THREAD_ID,
      turnId: "turn-b",
      status: "running",
    });

    const result = await asOwner(() => listCommentAiRequests(DOCUMENT_ID));

    expect(result.requests[0]).toMatchObject({
      requestId: REQUEST_ID,
      status: "needs-review",
      error: "The agent run ended (completed) before this request completed",
    });
  });

  it("reports review needed when a terminal origin has no successor", async () => {
    progress.getActiveRunForThreadAsync.mockResolvedValue(null);

    const result = await asOwner(() => listCommentAiRequests(DOCUMENT_ID));

    expect(result.requests[0]).toMatchObject({
      requestId: REQUEST_ID,
      status: "needs-review",
      error: "The agent run ended (completed) before this request completed",
    });
  });
});
