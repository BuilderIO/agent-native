import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => ({ status: "no-recipients" })),
}));
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: vi.fn(async () => new Map()),
}));

const directory = mkdtempSync(join(tmpdir(), "content-comment-attribution-"));
const owner = "comment-author@example.com";
let dbModule: typeof import("../server/db/index.js");
let addComment: typeof import("./add-comment.js").default;
let listComments: typeof import("./list-comments.js").default;
let updateComment: typeof import("./update-comment.js").default;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "db")}`);
  dbModule = await import("../server/db/index.js");
  const { runContentMigrations } = await import("../server/plugins/db.js");
  await runContentMigrations();
  addComment = (await import("./add-comment.js")).default;
  listComments = (await import("./list-comments.js")).default;
  updateComment = (await import("./update-comment.js")).default;
  await dbModule.getDb().insert(dbModule.schema.documents).values({
    id: "attribution-doc",
    ownerEmail: owner,
    title: "Comment attribution test",
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it("persists distinct sources through reads, edits, and resolution without changing ownership", async () => {
  await runWithRequestContext(
    { userEmail: owner, userName: "Comment Author" },
    async () => {
      const human = await addComment.run(
        { documentId: "attribution-doc", content: "Human comment" },
        { caller: "frontend", userEmail: owner },
      );
      const mcp = await addComment.run(
        { documentId: "attribution-doc", content: "MCP comment" },
        { caller: "mcp", userEmail: owner },
      );
      const agent = await addComment.run(
        {
          documentId: "attribution-doc",
          content: "Agent reply",
          threadId: human.threadId,
          parentId: human.id,
        },
        { caller: "tool", userEmail: owner, runId: "attribution-run" },
      );
      await dbModule.getDb().insert(dbModule.schema.documentComments).values({
        id: "historical-comment",
        documentId: "attribution-doc",
        threadId: "historical-comment",
        ownerEmail: owner,
        authorEmail: owner,
        content: "Historical comment",
      });
      await updateComment.run(
        {
          id: agent.id,
          documentId: "attribution-doc",
          content: "Edited by the account",
          resolved: true,
        },
        { caller: "frontend", userEmail: owner },
      );
      const result = await listComments.run(
        { documentId: "attribution-doc" },
        { caller: "frontend", userEmail: owner },
      );
      const comments = new Map(
        result.comments.map((comment) => [comment.id, comment]),
      );
      expect(comments.get(human.id)).toMatchObject({
        submission_source: "frontend",
        resolved: 1,
        author_email: owner,
      });
      expect(comments.get(mcp.id)).toMatchObject({
        submission_source: "mcp",
        author_email: owner,
      });
      expect(comments.get(agent.id)).toMatchObject({
        submission_source: "agent",
        submission_run_id: "attribution-run",
        content: "Edited by the account",
        resolved: 1,
        author_email: owner,
      });
      expect(comments.get("historical-comment")).toMatchObject({
        submission_source: null,
        submission_run_id: null,
      });
      const rows = await dbModule
        .getDb()
        .select()
        .from(dbModule.schema.documentComments)
        .where(
          eq(dbModule.schema.documentComments.documentId, "attribution-doc"),
        );
      expect(
        rows.every(
          (row) => row.ownerEmail === owner && row.authorEmail === owner,
        ),
      ).toBe(true);
    },
  );
});

it("records the model, effort, and conversation behind an AI comment, and no run for a person's", async () => {
  await runWithRequestContext(
    {
      userEmail: owner,
      run: {
        runId: "effort-run",
        threadId: "effort-thread",
        model: "claude-sonnet-4-6",
        reasoningEffort: "medium",
      },
    },
    async () => {
      const ai = await addComment.run(
        {
          documentId: "attribution-doc",
          content: "@Comment Author this reads well",
          mentions: [{ kind: "person", email: owner, name: "Comment Author" }],
        },
        { caller: "tool", userEmail: owner, runId: "effort-run" },
      );
      const result = await listComments.run(
        { documentId: "attribution-doc" },
        { caller: "frontend", userEmail: owner },
      );
      expect(
        result.comments.find((comment) => comment.id === ai.id),
      ).toMatchObject({
        author_model: "claude-sonnet-4-6",
        author_effort: "medium",
        submission_run_id: "effort-run",
        submission_thread_id: "effort-thread",
        mentions: [{ kind: "person", email: owner, name: "Comment Author" }],
      });
    },
  );
  await runWithRequestContext({ userEmail: owner }, async () => {
    const human = await addComment.run(
      { documentId: "attribution-doc", content: "Written by hand" },
      { caller: "frontend", userEmail: owner },
    );
    const result = await listComments.run(
      { documentId: "attribution-doc" },
      { caller: "frontend", userEmail: owner },
    );
    expect(
      result.comments.find((comment) => comment.id === human.id),
    ).toMatchObject({
      author_model: null,
      author_effort: null,
      submission_thread_id: null,
    });
  });
});

it("replays a retried AI comment from a run on another model as the first one", async () => {
  const submit = (runId: string, model: string, reasoningEffort: string) =>
    runWithRequestContext(
      { userEmail: owner, run: { runId, model, reasoningEffort } },
      () =>
        addComment.run(
          {
            documentId: "attribution-doc",
            content: "Retried reply",
            idempotencyKey: "retried-ai-reply",
          },
          { caller: "tool", userEmail: owner, runId },
        ),
    );

  const first = await submit("first-run", "claude-opus-5-5", "high");
  const retry = await submit("retry-run", "claude-sonnet-5-5", "medium");

  expect(retry).toMatchObject({ id: first.id, replayed: true });
  const result = await runWithRequestContext({ userEmail: owner }, () =>
    listComments.run(
      { documentId: "attribution-doc" },
      { caller: "frontend", userEmail: owner },
    ),
  );
  expect(
    result.comments.find((comment) => comment.id === first.id),
  ).toMatchObject({
    author_model: "claude-opus-5-5",
    author_effort: "high",
    submission_run_id: "first-run",
  });
});
