import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetAppConfigForTests } from "@agent-native/core/app-config";
import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import {
  PrivateBlobError,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import {
  getQueuedSubmissionReceipt,
  getRequestRunContext,
  getThread,
  runWithRequestContext,
} from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import getThreadSummary from "../../actions/get-thread-summary.js";
import recordUpload from "../../actions/record-analytics-thread-upload.js";
import searchThreadMembers from "../../actions/search-analytics-thread-members.js";
import startThread from "../../actions/start-analytics-thread.js";
import submitTurn from "../../actions/submit-analytics-thread-turn.js";
import { createAskControl } from "../../e2e/phase1/fixtures/ask-control.js";
import {
  setThreadAccessInput,
  startThreadInput,
  startThreadReceipt,
  stopThreadInput,
} from "../../shared/analytics-thread.js";
import { getDb, schema } from "../db/index.js";
import { phase1AskFixtureKey } from "../lib/phase1-ask-fixture.js";
import {
  setAnalyticsThreadAccess,
  saveAnalyticsThreadProject,
} from "./analytics-thread-access.js";
import {
  provisionAnalyticsThread,
  readAnalyticsThreadAccess,
} from "./analytics-thread-bootstrap.js";
import {
  persistAnalyticsThreadRun,
  readAnalyticsThreadTurns,
} from "./analytics-thread-transcript.js";
import {
  prepareAnalyticsThreadContext,
  stopAnalyticsThread,
} from "./analytics-thread-turns.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { uploadProjectFile } from "./project-files.js";
import {
  listProjects,
  listWorkspaceVisibleProjects,
} from "./projects-store.js";
import { readShellProjects } from "./shell-projects.js";

const fixtures = vi.hoisted(() => ({ ready: true, journal: vi.fn() }));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  isAgentChatAiSetupReady: async () => fixtures.ready,
  getCurrentTurnRunEventsForThread: fixtures.journal,
}));

const owner = "ask-owner@example.test";
const colleague = "ask-colleague@example.test";
const stranger = "ask-stranger@example.test";
const orgId = "ask-workspace";
const wrongOrg = "other-ask-workspace";
const memberId = "ask-colleague-member";
const appId = "analytics-2";
const scope = { ownerEmail: owner, orgId, appId };
const context = { caller: "frontend" as const, appId, userEmail: owner, orgId };
const as = <T>(run: () => T, userEmail = owner, workspace = orgId) =>
  runWithRequestContext(
    { userEmail, orgId: workspace, authUserId: userEmail },
    run,
  );

const prompt = (text: string) => ({
  text,
  attachmentIds: [],
  mentions: [],
  sourceIds: [],
  approval: "ask" as const,
});
const request = (text: string) =>
  startThreadInput.parse({
    intentId: randomUUID(),
    trigger: { kind: "submit", prompt: prompt(text) },
  });

it("restores the submitting tab for a queued turn on the thread page", async () => {
  const input = request("open project Orders by month");
  const tabId = "browser-tab-home";
  const started = await runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      run: { browserTabId: tabId },
    },
    () => startThread.run(input, context),
  );
  if (started.phase === "binding") throw new Error("Thread was not submitted");
  const receipt = await getQueuedSubmissionReceipt(
    started.threadId,
    input.intentId,
  );
  expect(receipt?.message?.metadata?.analyticsBrowserTabId).toBe(tabId);
  const body: Record<string, unknown> = { queuedMessageId: input.intentId };
  await runWithRequestContext(
    { userEmail: owner, orgId, run: {} },
    async () => {
      await prepareAnalyticsThreadContext({
        event: { context: { __agentChatBackgroundBody: body } } as never,
        ownerEmail: owner,
        threadId: started.threadId,
      });
      expect(getRequestRunContext()?.browserTabId).toBe(tabId);
      expect(body.browserTabId).toBe(tabId);
    },
  );
});
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "analytics-ask-db-"));
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "test-ask-attachment-encryption");
  resetAppConfigForTests();
  await closeDbExec();
  await runMigrations(
    ORG_MIGRATIONS.map(({ name, ...migration }) => ({
      ...migration,
      ...(name === undefined ? {} : { name }),
    })),
    { table: "ask_db_org_migrations" },
  )(null);
  await ensureAnalyticsDatabase();
  await getDbExec().execute(sql`
    CREATE TABLE IF NOT EXISTS "user" (email text PRIMARY KEY, name text NOT NULL)
  `);
  await getDbExec().execute(sql`
    INSERT INTO "user" (email, name) VALUES (${sql.value(colleague)}, 'ask-colleague')
  `);
  await getDb()
    .insert(organizations)
    .values(
      [orgId, wrongOrg].map((id) => ({
        id,
        name: id,
        createdBy: owner,
        createdAt: Date.now(),
      })),
    );
  await getDb()
    .insert(orgMembers)
    .values([
      { id: "owner", orgId, email: owner, role: "owner", joinedAt: Date.now() },
      {
        id: memberId,
        orgId,
        email: colleague,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: "stranger",
        orgId,
        email: stranger,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: "colleague-other",
        orgId: wrongOrg,
        email: colleague,
        role: "member",
        joinedAt: Date.now(),
      },
    ]);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("recovers a lost bind reply with competing callers and queues one initial prompt plus one ordered follow-up", async () => {
  const input = request("initial question");
  const bound = await as(() => provisionAnalyticsThread(scope, input));
  expect(bound.phase).toBe("ready");
  const [left, right] = await Promise.all([
    as(() => startThread.run(input, context)),
    as(() => startThread.run(input, context)),
  ]);
  const receipt = startThreadReceipt.parse(left);
  expect(right).toEqual(left);
  expect(receipt).toMatchObject({
    phase: "submitted",
    threadId: bound.threadId,
    projectId: bound.projectId,
    bindingId: bound.bindingId,
    initialTurn: { messageId: input.intentId, sequence: "1" },
  });
  expect(
    await getQueuedSubmissionReceipt(bound.threadId, input.intentId),
  ).toMatchObject({ message: { text: "initial question" } });

  const next = {
    threadId: bound.threadId,
    messageId: randomUUID(),
    prompt: prompt("follow-up question"),
  };
  const nextReceipt = await as(() => submitTurn.run(next, context));
  expect(nextReceipt).toMatchObject({
    threadId: bound.threadId,
    messageId: next.messageId,
    sequence: "2",
  });
  expect(await as(() => submitTurn.run(next, context))).toEqual(nextReceipt);
  const thread = await getThread(bound.threadId);
  expect(thread?.visibility).toBe("private");
  expect(
    JSON.parse(thread?.threadData ?? "null").queuedMessages.map(
      ({ id }: { id: string }) => id,
    ),
  ).toEqual([input.intentId, next.messageId]);
  await expect(
    as(() =>
      startThread.run(
        {
          ...input,
          trigger: { kind: "submit", prompt: prompt("different prompt") },
        },
        context,
      ),
    ),
  ).rejects.toMatchObject({ errorCode: "intent_mismatch" });
  const [stored] = await getDb()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, receipt.projectId))
    .limit(1);
  expect(stored).toMatchObject({ ownerEmail: owner, orgId, listed: false });
});

it("keeps Ask out of Projects, Search and the shell until an owner publishes discovery, independently of viewer grants", async () => {
  const input = request("discovery and sharing");
  const receipt = startThreadReceipt.parse(
    await as(() => startThread.run(input, context)),
  );
  const { threadId, projectId } = receipt;
  expect(
    await as(() =>
      searchThreadMembers.run({ threadId, search: "ask-colleague" }, context),
    ),
  ).toEqual({
    members: [{ id: memberId, email: colleague, displayName: "ask-colleague" }],
  });
  expect((await listProjects(scope)).map(({ id }) => id)).not.toContain(
    projectId,
  );
  expect(
    (await listWorkspaceVisibleProjects(scope)).map(({ id }) => id),
  ).not.toContain(projectId);
  expect(
    (await readShellProjects(scope)).recent.map(({ id }) => id),
  ).not.toContain(projectId);
  await expect(
    as(
      () =>
        readAnalyticsThreadAccess({ ...scope, ownerEmail: stranger }, threadId),
      stranger,
    ),
  ).rejects.toMatchObject({ errorCode: "thread_not_found" });

  const grant = setThreadAccessInput.parse({
    threadId,
    opId: randomUUID(),
    expectedRevision: "0",
    change: { kind: "grant" as const, memberId },
  });
  const grantReceipt = await as(() => setAnalyticsThreadAccess(scope, grant));
  expect(grantReceipt).toMatchObject({
    effect: "added",
    revision: "1",
    href: receipt.href,
  });
  expect(await as(() => setAnalyticsThreadAccess(scope, grant))).toEqual(
    grantReceipt,
  );
  const viewerSummary = await as(
    () => getThreadSummary.run({ threadId }, context),
    colleague,
  );
  expect(viewerSummary).toMatchObject({
    binding: { projectId, threadId },
    listed: false,
    canSubmit: false,
    canShare: false,
    workingHead: null,
  });
  await expect(
    as(
      () =>
        submitTurn.run(
          { threadId, messageId: randomUUID(), prompt: prompt("unauthorized") },
          context,
        ),
      colleague,
    ),
  ).rejects.toMatchObject({ errorCode: "thread_forbidden" });
  expect(
    await as(
      () =>
        readAnalyticsThreadAccess(
          { ...scope, orgId: wrongOrg, ownerEmail: colleague },
          threadId,
        ),
      colleague,
      wrongOrg,
    ),
  ).toBeNull();

  const expectedHead = (
    await as(() => getThreadSummary.run({ threadId }, context))
  ).workingHead;
  expect(expectedHead).not.toBeNull();
  const save = {
    threadId,
    opId: randomUUID(),
    expectedHead: saveAnalyticsThreadProjectInput(expectedHead),
  };
  const saved = await as(() => saveAnalyticsThreadProject(scope, save));
  expect(saved).toMatchObject({
    listed: true,
    projectId,
    operation: { status: "applied", delta: { listed: true } },
  });
  expect(await as(() => saveAnalyticsThreadProject(scope, save))).toEqual(
    saved,
  );
  expect(
    (await listProjects(scope)).filter(({ id }) => id === projectId),
  ).toHaveLength(1);
  expect(
    (await listWorkspaceVisibleProjects(scope)).filter(
      ({ id }) => id === projectId,
    ),
  ).toHaveLength(1);
  expect(
    (await readShellProjects(scope)).recent.filter(
      ({ id }) => id === projectId,
    ),
  ).toHaveLength(1);

  await as(() =>
    setAnalyticsThreadAccess(
      scope,
      setThreadAccessInput.parse({
        threadId,
        opId: randomUUID(),
        expectedRevision: "1",
        change: { kind: "revoke", grantId: grantReceipt.grantId },
      }),
    ),
  );
  await expect(
    as(
      () =>
        readAnalyticsThreadAccess(
          { ...scope, ownerEmail: colleague },
          threadId,
        ),
      colleague,
    ),
  ).rejects.toMatchObject({ errorCode: "thread_not_found" });
});

const saveAnalyticsThreadProjectInput = (
  head: Awaited<ReturnType<typeof getThreadSummary.run>>["workingHead"],
) => {
  if (!head) throw new Error("The test thread has no working head.");
  return head;
};

it("rejects unavailable AI before reserving a project or a thread", async () => {
  const input = request("keep this draft");
  fixtures.ready = false;
  try {
    await expect(
      as(() => startThread.run(input, context)),
    ).rejects.toMatchObject({
      errorCode: "ai_provider_unavailable",
      statusCode: 503,
    });
    const intent = await getDbExec().execute(
      sql`SELECT intent_id FROM analytics2_thread_bootstraps WHERE intent_id = ${sql.value(input.intentId)} LIMIT 1`,
    );
    expect(intent.rows).toHaveLength(0);
  } finally {
    fixtures.ready = true;
  }
});

it("only the selected Ask prompt sees the model fixture outage before admission", async () => {
  const outage = request("Model fixture outage");
  const control = createAskControl();
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
  Object.defineProperty(globalThis, phase1AskFixtureKey, {
    value: control.bridge,
    configurable: true,
  });
  try {
    expect(
      control.control({
        operation: "ask-model-unavailable",
        prompt: "Model fixture outage",
        unavailable: true,
      }),
    ).toEqual({ unavailable: true });
    await expect(
      as(() => startThread.run(outage, context)),
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "ai_provider_unavailable",
    });
    const untouched = await getDb()
      .select()
      .from(schema.analyticsThreadBootstraps)
      .where(eq(schema.analyticsThreadBootstraps.intentId, outage.intentId))
      .limit(1);
    expect(untouched).toEqual([]);
    await expect(
      as(() => startThread.run(request("Another Ask prompt"), context)),
    ).resolves.toMatchObject({ phase: "submitted" });
    expect(
      control.control({
        operation: "ask-model-unavailable",
        prompt: "Model fixture outage",
        unavailable: false,
      }),
    ).toEqual({ unavailable: false });
    await expect(
      as(() => startThread.run(outage, context)),
    ).resolves.toMatchObject({ phase: "submitted" });
  } finally {
    Reflect.deleteProperty(globalThis, phase1AskFixtureKey);
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", undefined);
  }
});

it("stops only the targeted queue prefix and keeps the later question eligible", async () => {
  const input = request("First queued question");
  const started = startThreadReceipt.parse(
    await as(() => startThread.run(input, context)),
  );
  const threadId = started.threadId;
  const second = {
    threadId,
    messageId: randomUUID(),
    prompt: prompt("Later queued question"),
  };
  await as(() => submitTurn.run(second, context));
  const stop = stopThreadInput.parse({
    threadId,
    opId: randomUUID(),
    throughSequence: "1",
  });
  const result = await as(() => stopAnalyticsThread(scope, stop));
  expect(result).toMatchObject({
    outcome: "stopped",
    stoppedMessageIds: [input.intentId],
  });
  expect(await as(() => stopAnalyticsThread(scope, stop))).toEqual(result);
  expect(
    await getQueuedSubmissionReceipt(threadId, input.intentId),
  ).toMatchObject({ state: "removed" });
  expect(
    await getQueuedSubmissionReceipt(threadId, second.messageId),
  ).toMatchObject({ state: "queued" });
});

it("retains a shared terminal answer and trace after the core run journal expires", async () => {
  const input = request("What should I try?");
  const created = startThreadReceipt.parse(
    await as(() => startThread.run(input, context)),
  );
  const threadId = created.threadId;
  const runId = "completed-ask-run";
  const turnId = `queued-${input.intentId}`;
  fixtures.journal.mockResolvedValueOnce([
    {
      runId,
      seq: 1,
      event: {
        type: "tool_start",
        tool: "get-thread-summary",
        id: "read-thread",
        input: { threadId },
      },
    },
    {
      runId,
      seq: 2,
      event: {
        type: "tool_done",
        tool: "get-thread-summary",
        id: "read-thread",
        result: "{}",
      },
    },
    { runId, seq: 3, event: { type: "text", text: "Try a count by channel." } },
    { runId, seq: 4, event: { type: "done", durationMs: 250 } },
  ]);
  try {
    await persistAnalyticsThreadRun(
      null,
      { threadId, turnId, runId, status: "completed" },
      { turnContinues: false },
    );
    await as(() =>
      setAnalyticsThreadAccess(
        scope,
        setThreadAccessInput.parse({
          threadId,
          opId: randomUUID(),
          expectedRevision: "0",
          change: { kind: "grant", memberId },
        }),
      ),
    );
    fixtures.journal.mockRejectedValue(new Error("Core journal pruned"));
    const view = await as(
      () =>
        readAnalyticsThreadTurns(
          { ...scope, ownerEmail: colleague },
          { threadId, limit: 25 },
        ),
      colleague,
    );
    expect(view.turns).toEqual([
      expect.objectContaining({
        receipt: expect.objectContaining({
          threadId,
          runId,
          phase: "complete",
        }),
        answerBlocks: [{ kind: "markdown", text: "Try a count by channel." }],
        toolReceipts: [
          { id: "read-thread", name: "get-thread-summary", state: "complete" },
        ],
        durationMs: 250,
        denied: false,
      }),
    ]);
    expect(fixtures.journal).toHaveBeenCalledExactlyOnceWith(threadId, turnId);
  } finally {
    fixtures.journal.mockReset();
  }
});

it.each(["provider", "phase1 fixture"] as const)(
  "retries a failed private attachment on the same binding after a %s fault",
  retryPrivateUpload,
);

async function retryPrivateUpload(boundary: "provider" | "phase1 fixture") {
  let attempts = 0;
  let storedBytes: Uint8Array | undefined;
  const provider: PrivateBlobProvider = {
    id: "ask-attachment-test",
    name: "Ask attachment test",
    isConfigured: () => true,
    async put(input) {
      if (++attempts === 1 && boundary === "provider")
        throw new PrivateBlobError("Test upload failed", "unavailable");
      storedBytes = new Uint8Array(input.data);
      return {
        id: "test-upload",
        provider: this.id,
        opaque: true,
        encrypted: false,
      };
    },
    async read(handle) {
      if (!storedBytes)
        throw new PrivateBlobError("Test file missing", "not_found");
      return { data: storedBytes, handle };
    },
    async delete() {
      return { deleted: true, provider: this.id };
    },
  };
  const control = createAskControl();
  const name = `phase1-ask-${randomUUID()}.csv`;
  if (boundary === "phase1 fixture") {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
    Object.defineProperty(globalThis, phase1AskFixtureKey, {
      value: control.bridge,
      configurable: true,
    });
    expect(
      control.control({
        operation: "ask-fail-upload",
        filename: name,
        armed: true,
      }),
    ).toEqual({ armed: true });
  }
  registerPrivateBlobProvider(provider);
  try {
    const mime = "text/csv";
    const bytes = Buffer.from("web 14042\n");
    const input = startThreadInput.parse({
      intentId: randomUUID(),
      trigger: {
        kind: "attach",
        uploads: [
          {
            clientFileId: randomUUID(),
            name,
            byteLength: bytes.length,
            mime,
          },
        ],
      },
    });
    const created = startThreadReceipt.parse(
      await as(() => startThread.run(input, context)),
    );
    const slot = created.uploadSlots[0];
    if (!slot) throw new Error("Missing test upload slot.");
    const file = {
      projectId: created.projectId,
      filename: name,
      mimeType: mime,
      dataBase64: bytes.toString("base64"),
    };
    const turn = {
      threadId: created.threadId,
      messageId: randomUUID(),
      prompt: {
        ...prompt("Read the attached sales data."),
        attachmentIds: [slot.uploadId],
      },
    };
    await expect(as(() => uploadProjectFile(file))).rejects.toMatchObject({
      errorCode: "attachment_storage_unavailable",
    });
    const failure = await as(() =>
      recordUpload.run(
        {
          threadId: created.threadId,
          uploadId: slot.uploadId,
          attachment: null,
        },
        context,
      ),
    );
    expect(failure).toMatchObject({
      threadId: created.threadId,
      phase: "awaiting_upload",
      uploadSlots: [{ uploadId: slot.uploadId, state: "failed" }],
    });
    expect(await as(() => startThread.run(input, context))).toEqual(failure);
    await expect(as(() => submitTurn.run(turn, context))).rejects.toMatchObject(
      { errorCode: "attachments_pending" },
    );
    expect(
      await getQueuedSubmissionReceipt(created.threadId, turn.messageId),
    ).toBeNull();
    const uploaded = await as(() => uploadProjectFile(file));
    await as(() =>
      recordUpload.run(
        {
          threadId: created.threadId,
          uploadId: slot.uploadId,
          attachment: uploaded.file.id,
        },
        context,
      ),
    );
    const first = await as(() => submitTurn.run(turn, context));
    expect(first.sequence).toBe("1");
    expect(await as(() => submitTurn.run(turn, context))).toEqual(first);
    expect(
      await getQueuedSubmissionReceipt(created.threadId, turn.messageId),
    ).toMatchObject({
      message: {
        text: turn.prompt.text,
        attachments: [{ fileId: uploaded.file.id, name }],
      },
    });
    expect(attempts).toBe(boundary === "provider" ? 2 : 1);
  } finally {
    unregisterPrivateBlobProvider(provider.id);
    if (boundary === "phase1 fixture") {
      Reflect.deleteProperty(globalThis, phase1AskFixtureKey);
      vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", undefined);
    }
  }
}
