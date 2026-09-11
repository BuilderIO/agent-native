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
