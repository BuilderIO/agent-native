import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.

const t3 = vi.hoisted(() => ({
  labOn: true,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  reads: [] as unknown[],
  launchHold: null as Promise<void> | null,
}));

vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => ({ status: "no-recipients" })),
}));
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: vi.fn(async () => new Map()),
}));
vi.mock("@agent-native/core/labs/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/labs/server")>();
  return {
    ...actual,
    getUserLabEnabled: vi.fn(async () => t3.labOn),
    assertLabEnabled: vi.fn(async () => {
      if (!t3.labOn) throw new Error("Lab off");
    }),
  };
});
vi.mock("@agent-native/core/mcp-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/mcp-client")>();
  return {
    ...actual,
    withT3Code: vi.fn(
      async (
        _email: string,
        fn: (
          call: (name: string, args: Record<string, unknown>) => unknown,
        ) => unknown,
      ) =>
        fn(async (name, args) => {
          t3.calls.push({ name, args });
          if (name === "orchestrator_capabilities") {
            return {
              providers: [
                {
                  providerInstanceId: "claude-main",
                  driverKind: "claudeAgent",
                  models: [{ id: "claude-opus-5-5" }],
                  constraints: [],
                },
              ],
            };
          }
          if (name === "t3_thread_launch") {
            if (t3.launchHold) await t3.launchHold;
            return { threadId: "t3-new", link: "t3://thread/t3-new" };
          }
          if (name === "t3_thread_send") return { accepted: true };
          if (name === "t3_thread_read") return t3.reads.shift() ?? {};
          throw new Error(`unexpected ${name}`);
        }),
    ),
  };
});

const directory = mkdtempSync(join(tmpdir(), "content-t3-agent-requests-"));
const owner = "alice@example.com";
const documentId = "t3-doc";
let dbModule: typeof import("../server/db/index.js");
let addComment: typeof import("./add-comment.js").default;
let syncRequests: typeof import("./sync-t3-agent-requests.js").default;
let listRequests: typeof import("./list-t3-agent-requests.js").default;

const claudeCode = {
  kind: "agent",
  model: "claude-code",
  engine: "t3-code",
  provider: "T3 Code",
  name: "Claude Code",
};

const asAlice = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner, userName: "Alice" }, run);

const ctx = { caller: "frontend", userEmail: owner } as never;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "db")}`);
  dbModule = await import("../server/db/index.js");
  const { runContentMigrations } = await import("../server/plugins/db.js");
  await runContentMigrations();
  addComment = (await import("./add-comment.js")).default;
  syncRequests = (await import("./sync-t3-agent-requests.js")).default;
  listRequests = (await import("./list-t3-agent-requests.js")).default;
  await dbModule.getDb().insert(dbModule.schema.documents).values({
    id: documentId,
    ownerEmail: owner,
    title: "Launch notes",
    content: "The launch moves to Thursday because the docs aren't ready.",
  });
}, 60_000);

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  t3.labOn = true;
  t3.calls.length = 0;
  t3.reads.length = 0;
  t3.launchHold = null;
  await dbModule.getDb().delete(dbModule.schema.t3AgentRequests);
});

async function requestsFor(commentId: string) {
  return dbModule
    .getDb()
    .select()
    .from(dbModule.schema.t3AgentRequests)
    .where(eq(dbModule.schema.t3AgentRequests.commentId, commentId));
}

async function tag(content: string, mention: Record<string, unknown>) {
  return asAlice(() =>
    addComment.run(
      { documentId, content, mentions: JSON.stringify([mention]) },
      ctx,
    ),
  );
}

it("records a person's tag of their own agent, and never an agent's", async () => {
  const human = await tag("@Claude Code why Thursday?", claudeCode);
  const [request] = await requestsFor(human.id);
  expect(request).toMatchObject({
    ownerEmail: owner,
    documentId,
    threadId: human.threadId,
    agent: "claude-code",
    status: "sending",
    t3ThreadId: null,
  });

  const byAgent = await asAlice(() =>
    addComment.run(
      {
        documentId,
        content: "@Claude Code take a look",
        mentions: JSON.stringify([claudeCode]),
      },
      { caller: "mcp", userEmail: owner } as never,
    ),
  );
  expect(await requestsFor(byAgent.id)).toEqual([]);
});

it("refuses a tag while the Lab is off", async () => {
  t3.labOn = false;
  await expect(tag("@Claude Code hello", claudeCode)).rejects.toThrow(/Lab/);
});

it("starts a new thread with the comment, the discussion and the page, then posts the answer once", async () => {
  const human = await tag("@Claude Code why Thursday?", claudeCode);
  const [request] = await requestsFor(human.id);

  await asAlice(() => syncRequests.run({ documentId }, ctx));
  const launch = t3.calls.find((call) => call.name === "t3_thread_launch");
  expect(launch?.args).toMatchObject({
    scratch: true,
    clientRequestId: request.id,
    modelSelection: { instanceId: "claude-main", model: "claude-opus-5-5" },
  });
  const message = String(launch?.args.message);
  expect(message).toContain(
    "Their comment is the request:\n\n@Claude Code why Thursday?",
  );
  expect(message).toContain("the docs aren't ready");
  const [working] = await requestsFor(human.id);
  expect(working).toMatchObject({
    status: "working",
    t3ThreadId: "t3-new",
    t3ThreadLink: "t3://thread/t3-new",
  });

  const finished = {
    thread: { title: "Content: Launch notes", status: "idle" },
    recentRuns: [{ runId: "run-1", ordinal: 1, status: "completed" }],
    items: [
      {
        runId: "run-1",
        type: "assistant_message",
        text: "Because the docs slipped.",
      },
    ],
  };
  t3.reads.push(finished, finished);
  const syncs = [
    await asAlice(() => syncRequests.run({ documentId }, ctx)),
    await asAlice(() => syncRequests.run({ documentId }, ctx)),
  ];
  expect(syncs.filter((sync) => sync.posted)).toHaveLength(1);

  const [answered] = await requestsFor(human.id);
  expect(answered.status).toBe("answered");
  const replies = await dbModule
    .getDb()
    .select()
    .from(dbModule.schema.documentComments)
    .where(eq(dbModule.schema.documentComments.parentId, human.id));
  expect(replies).toHaveLength(1);
  expect(replies[0]).toMatchObject({
    id: answered.replyCommentId,
    content: "Because the docs slipped.",
    authorEmail: owner,
    actorKind: "agent",
    authorModel: "claude-opus-5-5",
    authorClient: "claude-code",
    submissionSource: "t3-code",
    submissionThreadId: "t3-new",
  });
  expect(await requestsFor(replies[0].id)).toEqual([]);

  const followUp = await asAlice(() =>
    addComment.run(
      {
        documentId,
        threadId: human.threadId,
        parentId: human.id,
        content: "@Claude Code and the banner?",
        mentions: JSON.stringify([{ ...claudeCode, thread: "t3-new" }]),
      },
      ctx,
    ),
  );
  expect(await requestsFor(followUp.id)).toHaveLength(1);
  t3.calls.length = 0;
  t3.reads.length = 0;
  t3.reads.push({
    thread: { title: "Content: Launch notes", status: "idle" },
    recentRuns: [{ runId: "run-1", ordinal: 1, status: "completed" }],
  });
  await asAlice(() => syncRequests.run({ documentId }, ctx));
  const sent = String(
    t3.calls.find((call) => call.name === "t3_thread_send")?.args.message,
  );
  expect(sent).toContain(
    "- Alice (the person asking): @Claude Code why Thursday?",
  );
  expect(sent).toContain("- Claude Code, for Alice: Because the docs slipped.");
  expect(sent).not.toContain("(the person asking): Because the docs slipped.");
});

it("messages a picked thread and says when the thread is waiting on its person", async () => {
  const human = await tag("@Claude Code check the dates", {
    ...claudeCode,
    thread: "t3-picked",
  });
  t3.reads.push({
    thread: { title: "Launch planning", status: "idle" },
    recentRuns: [{ runId: "run-4", ordinal: 4, status: "completed" }],
  });
  await asAlice(() => syncRequests.run({ documentId }, ctx));
  expect(
    t3.calls.find((call) => call.name === "t3_thread_send")?.args,
  ).toMatchObject({ threadId: "t3-picked", mode: "auto" });
  const [working] = await requestsFor(human.id);
  expect(working).toMatchObject({
    status: "working",
    baseRunOrdinal: 4,
    t3ThreadTitle: "Launch planning",
  });

  t3.reads.push({
    thread: {
      title: "Launch planning",
      status: "waiting",
      pendingRequestCount: 1,
    },
    recentRuns: [
      { runId: "run-5", ordinal: 5, status: "running" },
      { runId: "run-4", ordinal: 4, status: "completed" },
    ],
  });
  await asAlice(() => syncRequests.run({ documentId }, ctx));
  expect((await requestsFor(human.id))[0].status).toBe("needs-you");

  t3.reads.push({
    thread: { title: "Launch planning", status: "idle" },
    recentRuns: [{ runId: "run-5", ordinal: 5, status: "interrupted" }],
  });
  await asAlice(() => syncRequests.run({ documentId }, ctx));
  expect((await requestsFor(human.id))[0]).toMatchObject({
    status: "failed",
    error: expect.stringContaining("stopped"),
  });
});

it("keeps a person's tags and their T3 threads from a teammate on the same page", async () => {
  const teammate = "sam@example.com";
  await dbModule
    .getDb()
    .insert(dbModule.schema.documentShares)
    .values({
      id: `share-${crypto.randomUUID()}`,
      resourceId: documentId,
      principalType: "user",
      principalId: teammate,
      role: "editor",
      createdBy: owner,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
  const human = await tag("@Claude Code mine only", claudeCode);
  const asSam = <T>(run: () => Promise<T>) =>
    runWithRequestContext({ userEmail: teammate, userName: "Sam" }, run);
  const samCtx = { caller: "frontend", userEmail: teammate } as never;

  expect(await asSam(() => listRequests.run({ documentId }, samCtx))).toEqual({
    requests: [],
  });
  await asSam(() => syncRequests.run({ documentId }, samCtx));
  expect(t3.calls).toEqual([]);
  expect((await requestsFor(human.id))[0].status).toBe("sending");
});

it("starts each tag once when two tabs sync at the same time", async () => {
  const human = await tag("@Claude Code once only", claudeCode);
  let release!: () => void;
  t3.launchHold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstTab = asAlice(() => syncRequests.run({ documentId }, ctx));
  await vi.waitFor(() =>
    expect(t3.calls.map((call) => call.name)).toContain("t3_thread_launch"),
  );
  await asAlice(() => syncRequests.run({ documentId }, ctx));
  release();
  await firstTab;
  const [request] = await requestsFor(human.id);
  const launches = t3.calls.filter(
    (call) =>
      call.name === "t3_thread_launch" &&
      call.args.clientRequestId === request.id,
  );
  expect(launches).toHaveLength(1);
});
