import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailMessage } from "../../shared/types.js";

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const mocks = vi.hoisted(() => ({
  completeText: vi.fn(),
  recordUsage: vi.fn(),
  resolveModel: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  completeText: mocks.completeText,
}));
vi.mock("@agent-native/core/usage", () => ({
  recordUsage: mocks.recordUsage,
}));
vi.mock("./automation-model.js", () => ({
  isUnavailableEngineError: (error: unknown) =>
    error instanceof Error && /No LLM provider/.test(error.message),
  resolveTextAutomationModelSettings: mocks.resolveModel,
}));

type Summaries = typeof import("./thread-summary.js");
type Exec = {
  execute: (q: {
    sql: string;
    args?: unknown[];
  }) => Promise<{ rows: unknown[] }>;
};

let summaries: Summaries;
let exec: Exec;

const OWNER = "owner@example.com";
const ACCOUNT = "Work@Example.com";

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  const [{ default: initializeMailDb }, core, summaryModule] =
    await Promise.all([
      import("../plugins/db.js"),
      import("@agent-native/core/db"),
      import("./thread-summary.js"),
    ]);
  await initializeMailDb({});
  exec = core.getDbExec() as unknown as Exec;
  summaries = summaryModule;
  mocks.completeText.mockReset();
  mocks.recordUsage.mockReset();
  mocks.resolveModel.mockReset();
  mocks.resolveModel.mockResolvedValue({
    engine: "builder",
    model: "gpt-6-luna",
  });
});

afterEach(async () => {
  const { closeDbExec } = await import("@agent-native/core/db");
  await closeDbExec();
  Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessLocks",
  );
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessExitCleanupRegistered",
  );
  vi.unstubAllEnvs();
  vi.resetModules();
});

function message(id: string, day: number, extra: Partial<EmailMessage> = {}) {
  return {
    id,
    threadId: "t1",
    from: { name: "Ana", email: "ana@example.com" },
    to: [{ name: "", email: "work@example.com" }],
    subject: "Launch plan",
    snippet: "",
    body: `Message ${id}`,
    date: new Date(Date.UTC(2026, 10, day)).toISOString(),
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: [],
    ...extra,
  } satisfies EmailMessage;
}

function modelReply(line: string, points: string[]) {
  return {
    text: JSON.stringify({ line, points }),
    content: [],
    engine: "builder",
    model: "gpt-6-luna",
    usage: { inputTokens: 900, outputTokens: 60 },
  };
}

function summarize(messages: EmailMessage[]) {
  return summaries.summarizeThread({
    ownerEmail: OWNER,
    accountEmail: ACCOUNT,
    threadId: "t1",
    messages,
  });
}

async function storedRows() {
  const { rows } = await exec.execute({
    sql: `SELECT account_email, last_message_id, message_count, line
      FROM mail_thread_summaries WHERE owner_email = $1`,
    args: [OWNER],
  });
  return rows;
}

describe("summarizeThread (PGlite)", () => {
  it("stores a summary, bills it as Mail's summary workflow, and reuses it until a new message", async () => {
    mocks.completeText.mockResolvedValueOnce(
      modelReply("Launch moves to Friday.", ["Ana asked to ship Friday"]),
    );
    const first = await summarize([message("m1", 1), message("m2", 2)]);
    expect(first).toMatchObject({
      ok: true,
      cached: false,
      summary: {
        accountEmail: "work@example.com",
        line: "Launch moves to Friday.",
        points: ["Ana asked to ship Friday"],
        lastMessageId: "m2",
        messageCount: 2,
      },
    });
    expect(mocks.completeText).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "builder", model: "gpt-6-luna" }),
    );
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: OWNER,
        inputTokens: 900,
        outputTokens: 60,
        model: "gpt-6-luna",
        engineName: "builder",
        label: "summary",
        app: "mail",
      }),
    );

    const again = await summarize([
      message("m1", 1),
      message("m2", 2),
      message("d1", 3, { isDraft: true }),
    ]);
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(mocks.completeText).toHaveBeenCalledTimes(1);
    expect(
      await summaries.readThreadSummary(OWNER, "work@example.com", "t1"),
    ).toMatchObject({ lastMessageId: "m2" });

    mocks.completeText.mockResolvedValueOnce(
      modelReply("Launch is set for Friday.", ["Bo confirmed Friday"]),
    );
    const refreshed = await summarize([
      message("m1", 1),
      message("m2", 2),
      message("m3", 4),
    ]);
    expect(refreshed).toMatchObject({
      ok: true,
      cached: false,
      summary: { lastMessageId: "m3", messageCount: 3 },
    });
    expect(await storedRows()).toEqual([
      {
        account_email: "work@example.com",
        last_message_id: "m3",
        message_count: 3,
        line: "Launch is set for Friday.",
      },
    ]);
  });

  it("refreshes for a message that arrives dated before the newest one", async () => {
    mocks.completeText.mockResolvedValueOnce(
      modelReply("Launch moves to Friday.", []),
    );
    await summarize([message("m1", 1), message("m3", 3)]);
    mocks.completeText.mockResolvedValueOnce(
      modelReply("Launch moves to Friday, and Bo agreed.", []),
    );

    const late = await summarize([
      message("m1", 1),
      message("m2", 2),
      message("m3", 3),
    ]);

    expect(late).toMatchObject({
      ok: true,
      cached: false,
      summary: { lastMessageId: "m3", messageCount: 3 },
    });
    expect(mocks.completeText).toHaveBeenCalledTimes(2);
  });

  it("reads null for a thread nobody summarized", async () => {
    expect(
      await summaries.readThreadSummary(OWNER, ACCOUNT, "never"),
    ).toBeNull();
  });

  it("asks for a provider instead of calling a model when none is connected", async () => {
    mocks.resolveModel.mockResolvedValueOnce({});
    expect(await summarize([message("m1", 1)])).toMatchObject({
      ok: false,
      code: "no_ai_model",
    });
    mocks.completeText.mockRejectedValueOnce(
      new Error("No LLM provider is connected."),
    );
    expect(await summarize([message("m1", 1)])).toMatchObject({
      ok: false,
      code: "no_ai_model",
    });
    expect(await storedRows()).toEqual([]);
  });

  it("reports an unreadable reply without storing it, but still bills the tokens", async () => {
    mocks.completeText.mockResolvedValueOnce({
      ...modelReply("", []),
      text: "Sure! This thread is about a launch.",
    });
    expect(await summarize([message("m1", 1)])).toMatchObject({
      ok: false,
      code: "summary_unreadable",
    });
    expect(mocks.recordUsage).toHaveBeenCalledTimes(1);
    expect(await storedRows()).toEqual([]);
  });

  it("reports a failed model call as summary_failed", async () => {
    mocks.completeText.mockRejectedValueOnce(new Error("upstream 500"));
    expect(await summarize([message("m1", 1)])).toEqual({
      ok: false,
      code: "summary_failed",
      message: "upstream 500",
    });
  });

  it("has nothing to summarize in a thread of drafts", async () => {
    expect(
      await summarize([message("d1", 1, { isDraft: true })]),
    ).toMatchObject({ ok: false, code: "nothing_to_summarize" });
    expect(mocks.resolveModel).not.toHaveBeenCalled();
  });
});
