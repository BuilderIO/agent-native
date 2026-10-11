import { createApp } from "h3";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const harness = vi.hoisted(() => ({
  initPromises: [] as Promise<void>[],
  requireAgentChatAiSetup: vi.fn(async () => {}),
}));

// The real shim also bootstraps every default plugin. This keeps its routing
// contract: prefix mounts, and a thrown error answers `{ error }` with its
// status. Paths stay unstripped, as on Node where handlers read the raw URL.
vi.mock("./framework-request-handler.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./framework-request-handler.js")>();
  return {
    ...actual,
    awaitBootstrap: () => Promise.resolve(),
    getH3App: (nitroApp: any) => ({
      use(arg1: any, arg2?: any) {
        const path = typeof arg1 === "string" ? arg1 : "";
        const handler = typeof arg1 === "string" ? arg2 : arg1;
        nitroApp.h3App.use(async (event: any, next: () => unknown) => {
          const pathname: string = event.url.pathname;
          if (path && pathname !== path && !pathname.startsWith(`${path}/`)) {
            return next();
          }
          try {
            const result = await handler(event);
            return result === undefined ? next() : result;
          } catch (error: any) {
            return Response.json(
              { error: error?.message || "Internal server error" },
              { status: error?.statusCode ?? error?.status ?? 500 },
            );
          }
        });
      },
    }),
    markDefaultPluginProvided: vi.fn(),
    trackPluginInit: (_nitroApp: any, promise: Promise<void>) => {
      harness.initPromises.push(promise);
    },
  };
});

vi.mock("../agent/run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/run-store.js")>();
  return {
    ...actual,
    listUnclaimedBackgroundRunRows: vi.fn(async () => []),
    reapAllStaleRuns: vi.fn(async () => ({
      scanned: 0,
      reaped: 0,
      failed: 0,
      truncated: false,
    })),
  };
});

vi.mock("../mcp-client/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../mcp-client/index.js")>();
  return {
    ...actual,
    buildMergedConfig: vi.fn(async () => null),
    startMcpConfigRefresh: () => () => {},
  };
});

vi.mock("../jobs/scheduler.js", () => ({
  processRecurringJobs: vi.fn(async () => {}),
}));

vi.mock("../triggers/dispatcher.js", () => ({
  initTriggerDispatcher: vi.fn(async () => {}),
}));

vi.mock("../chat-threads/migrations.js", () => ({
  runChatThreadDataMigrations: vi.fn(async () => {}),
}));

vi.mock("./social-og-image.js", () => ({
  createAgentNativeOgImageHandler: () => () => new Response(),
}));

// The provider-credential gate is not under test; the scripted engine below
// needs no credential.
vi.mock("./agent-chat-ai-setup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-chat-ai-setup.js")>()),
  requireAgentChatAiSetup: harness.requireAgentChatAiSetup,
}));

import {
  registerAgentEngine,
  unregisterAgentEngine,
} from "../agent/engine/registry.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "../agent/engine/types.js";
import * as chatThreadStore from "../chat-threads/store.js";
import {
  createThread,
  getThread,
  mutateThreadQueuedMessages,
} from "../chat-threads/store.js";
import { resetAgentEngineReadinessForTests } from "../client/agent-engine-readiness.js";
import { startBackgroundAgentSession } from "../client/background-agent-session.js";
import * as fileUploadRegistry from "../file-upload/registry.js";
import { PDF_BASE64 } from "../file-upload/test-image-fixtures.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";
import { seedAgentRunOwnerContext } from "./agent-run-context.js";

const OWNER = "owner@example.com";
const ORIGIN = "http://localhost:3000";
const ENGINE_NAME = "background-session-test";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

interface RecordedResponse {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  status: number;
  error: string | null;
}

const scriptedEngine: AgentEngine = {
  name: ENGINE_NAME,
  label: "Background session test",
  defaultModel: "test-model",
  supportedModels: ["test-model"],
  capabilities: {
    thinking: false,
    promptCaching: false,
    vision: false,
    computerUse: false,
    parallelToolCalls: false,
  },
  async *stream({ messages }): AsyncIterable<EngineEvent> {
    engineMessages.push(messages);
    yield {
      type: "assistant-content",
      parts: [{ type: "text", text: "Replied to the comment." }],
    };
    yield { type: "stop", reason: "end_turn" };
  },
};

const hooks = new Map<string, Array<() => void | Promise<void>>>();
const requests: RecordedResponse[] = [];
const externalFiles = new Map<string, Uint8Array>();
const engineMessages: EngineMessage[][] = [];

function agentChatPosts(threadId: string): RecordedResponse[] {
  return requests.filter(
    (entry) =>
      entry.method === "POST" &&
      entry.path === "/_agent-native/agent-chat" &&
      entry.body?.threadId === threadId,
  );
}

async function userMessagesFor(threadId: string, queuedMessageId: string) {
  const thread = await getThread(threadId);
  const repo = JSON.parse(thread?.threadData || "{}");
  return (Array.isArray(repo.messages) ? repo.messages : [])
    .map((entry: any) => entry?.message ?? entry)
    .filter(
      (message: any) =>
        message?.role === "user" &&
        message?.metadata?.custom?.agentNativeQueuedMessageId ===
          queuedMessageId,
    );
}

function settle(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "settled",
    (error: unknown) =>
      `rejected: ${error instanceof Error ? error.message : String(error)}`,
  );
}

beforeAll(async () => {
  registerAgentEngine({
    name: ENGINE_NAME,
    label: scriptedEngine.label,
    description: "Scripted engine for the background-session route test",
    capabilities: scriptedEngine.capabilities,
    defaultModel: scriptedEngine.defaultModel,
    supportedModels: scriptedEngine.supportedModels,
    requiredEnvVars: [],
    create: () => scriptedEngine,
  });

  const h3App = createApp();
  // Stands in for the session middleware: the browser request arrives
  // authenticated as OWNER.
  h3App.use((event) => {
    const anonymous = event.req.headers.get("x-test-anonymous") === "1";
    const ownerless = event.req.headers.get("x-test-ownerless") === "1";
    seedAgentRunOwnerContext(event, {
      owner: ownerless ? "" : anonymous ? "anonymous-owner@example.com" : OWNER,
      anonymous,
      orgId: null,
    });
  });
  createAgentChatPlugin({
    actions: () => ({}),
    a2aAgentDelegation: false,
    durableBackgroundRuns: true,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: false },
    anonymousOwner: async () => "anonymous-owner@example.com",
  })({
    h3App,
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        hooks.set(name, [...(hooks.get(name) ?? []), callback]);
      },
    },
  });
  const initPromise = harness.initPromises.at(-1);
  if (!initPromise) throw new Error("Agent chat plugin did not initialize");
  await initPromise;

  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const externalFile = externalFiles.get(raw);
      if (externalFile) {
        return new Response(externalFile.slice(), {
          headers: { "content-type": "application/pdf" },
        });
      }
      if (!raw.startsWith("/") && !raw.startsWith(ORIGIN)) {
        return realFetch(input, init);
      }
      const url = new URL(raw, ORIGIN);
      if (url.pathname === "/_agent-native/agent-engine/status") {
        return Response.json({ configured: true, chatEligible: true });
      }
      const headers = new Headers(init?.headers);
      headers.set("user-agent", BROWSER_USER_AGENT);
      const response = await h3App.fetch(
        new Request(url, { ...init, cache: undefined, headers }),
      );
      requests.push({
        method: (init?.method ?? "GET").toUpperCase(),
        path: url.pathname,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null,
        status: response.status,
        error: response.ok
          ? null
          : (((await response.clone().json()) as { error?: string }).error ??
            null),
      });
      return response;
    },
  );
  // Plugin init imports the whole server graph.
}, 60_000);

beforeEach(() => {
  resetAgentEngineReadinessForTests();
  harness.requireAgentChatAiSetup.mockClear();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await Promise.all((hooks.get("close") ?? []).map((callback) => callback()));
  unregisterAgentEngine(ENGINE_NAME);
});

describe("background agent sessions through the agent-chat plugin", () => {
  it("accepts a background session and persists its user message", async () => {
    const handle = startBackgroundAgentSession({
      message: "Reply to this comment",
      operationId: "comment-ai-operation-1",
      threadId: "comment-ai-thread-1",
      engine: ENGINE_NAME,
    });
    await handle.accepted;
    const completion = await settle(handle.completion);

    const [post] = agentChatPosts(handle.threadId);
    expect
      .soft({ status: post?.status, error: post?.error })
      .toEqual({ status: 200, error: null });
    expect.soft(completion).toBe("settled");
    expect((await getThread(handle.threadId))?.title).toBe(
      "Reply to this comment",
    );
    expect
      .soft(await userMessagesFor(handle.threadId, handle.operationId))
      .toHaveLength(1);
    const snapshot = await handle.status();
    expect
      .soft({
        status: snapshot.status,
        terminalReason: snapshot.terminalReason ?? null,
      })
      .toEqual({ status: "completed", terminalReason: "done" });
  });

  it("keeps a repeated background POST from adding a second user message or poisoning the turn status", async () => {
    const session = {
      message: "Resolve this comment",
      operationId: "comment-ai-operation-2",
      threadId: "comment-ai-thread-2",
      engine: ENGINE_NAME,
    };
    const first = startBackgroundAgentSession(session);
    await first.accepted;
    await settle(first.completion);

    const repeat = startBackgroundAgentSession(session);
    await repeat.accepted;
    await settle(repeat.completion);

    // A completed turn's repeat replays it from the run store before the
    // user message is persisted again.
    expect
      .soft(
        agentChatPosts(session.threadId).map(({ status, error }) => ({
          status,
          error,
        })),
      )
      .toEqual([
        { status: 200, error: null },
        { status: 200, error: null },
      ]);
    expect
      .soft(await userMessagesFor(session.threadId, session.operationId))
      .toHaveLength(1);
    const snapshot = await repeat.status();
    expect
      .soft({
        status: snapshot.status,
        terminalReason: snapshot.terminalReason ?? null,
      })
      .toEqual({ status: "completed", terminalReason: "done" });
  });

  it("checks thread scope and access before replaying a completed non-vision turn", async () => {
    const scope = { type: "workspace-app", id: "analytics" };
    const session = {
      message: "Resolve this comment",
      operationId: "comment-ai-scope-operation",
      threadId: "comment-ai-scope-thread",
      engine: ENGINE_NAME,
      scope,
    };
    const first = startBackgroundAgentSession(session);
    await first.accepted;
    await settle(first.completion);
    const engineMessageCount = engineMessages.length;

    const wrongScopeReplay = startBackgroundAgentSession({
      ...session,
      scope: { ...scope, id: "another-app" },
    });
    const wrongScopeResult = await settle(wrongScopeReplay.accepted);
    expect(wrongScopeResult).toContain("HTTP 404");

    const denyAccess = vi
      .spyOn(chatThreadStore, "resolveThreadAccess")
      .mockResolvedValue(null);
    try {
      const deniedReplay = startBackgroundAgentSession(session);
      const deniedResult = await settle(deniedReplay.accepted);
      expect(deniedResult).toContain("HTTP 404");
      expect(denyAccess).toHaveBeenCalledWith(
        OWNER,
        session.threadId,
        "editor",
        { orgId: undefined },
      );
    } finally {
      denyAccess.mockRestore();
    }

    expect(
      agentChatPosts(session.threadId).map(({ status }) => status),
    ).toEqual([200, 404, 404]);
    expect(engineMessages).toHaveLength(engineMessageCount);
    expect(
      await userMessagesFor(session.threadId, session.operationId),
    ).toHaveLength(1);
  });

  it("rejects a saved thread request without an owner while allowing a fresh request", async () => {
    const previousDurableFlag = process.env.AGENT_CHAT_DURABLE_BACKGROUND;
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "0";
    const threadId = "ownerless-saved-thread";
    await createThread(OWNER, { id: threadId });
    const engineMessageCount = engineMessages.length;

    try {
      const freshResponse = await fetch("/_agent-native/agent-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-ownerless": "1",
        },
        body: JSON.stringify({ message: "Fresh request", engine: ENGINE_NAME }),
      });
      expect(freshResponse.status).toBe(200);
      await freshResponse.text();
      const freshEngineMessageCount = engineMessages.length;
      expect(freshEngineMessageCount).toBeGreaterThan(engineMessageCount);

      const savedResponse = await fetch("/_agent-native/agent-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-ownerless": "1",
        },
        body: JSON.stringify({
          message: "Read the saved thread",
          engine: ENGINE_NAME,
          threadId,
        }),
      });
      expect(savedResponse.status).toBe(404);
      expect(await savedResponse.json()).toEqual({ error: "Thread not found" });
      expect(engineMessages).toHaveLength(freshEngineMessageCount);
    } finally {
      if (previousDurableFlag === undefined) {
        delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
      } else {
        process.env.AGENT_CHAT_DURABLE_BACKGROUND = previousDurableFlag;
      }
    }
  });

  it("rehydrates an uploaded PDF in the durable worker before sending it to the engine", async () => {
    const previousDurableFlag = process.env.AGENT_CHAT_DURABLE_BACKGROUND;
    const previousA2ASecret = process.env.A2A_SECRET;
    const url = "https://storage.example.test/uploads/background-report.pdf";
    const pdfBytes = Buffer.from(PDF_BASE64, "base64");
    const uploadFile = vi
      .spyOn(fileUploadRegistry, "uploadFile")
      .mockResolvedValue({ url, provider: "test-storage" });
    const findProvider = vi
      .spyOn(fileUploadRegistry, "findFileUploadProviderOwningUrl")
      .mockResolvedValue({ id: "test-storage" } as any);
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "1";
    process.env.A2A_SECRET = "fixture-a2a-secret";
    externalFiles.set(url, pdfBytes);
    engineMessages.length = 0;
    const requestStart = requests.length;

    try {
      const handle = startBackgroundAgentSession({
        message: "Summarize the uploaded report",
        operationId: "pdf-background-operation",
        threadId: "pdf-background-thread",
        engine: ENGINE_NAME,
        attachments: [
          {
            type: "file",
            name: "background-report.pdf",
            contentType: "application/pdf",
            data: `data:application/pdf;base64,${PDF_BASE64}`,
          },
        ],
      });
      await handle.accepted;
      await handle.completion;

      const userParts = engineMessages
        .flatMap((messages) => messages)
        .filter((message) => message.role === "user")
        .flatMap((message) => message.content);
      expect(userParts).toContainEqual({
        type: "file",
        data: PDF_BASE64,
        mediaType: "application/pdf",
        filename: "background-report.pdf",
      });
      expect(
        userParts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      ).not.toContain("<chat-attachment-processing-error");
      expect(uploadFile).toHaveBeenCalledOnce();
      expect(findProvider).toHaveBeenCalledWith(url);
      expect((await handle.status()).status).toBe("completed");
      const workerDispatch = requests
        .slice(requestStart)
        .find(
          (request) =>
            request.method === "POST" &&
            request.path === "/_agent-native/agent-chat/_process-run",
        );
      expect(workerDispatch?.body).toMatchObject({
        __backgroundRun: { payloadRef: true },
      });
    } finally {
      externalFiles.delete(url);
      uploadFile.mockRestore();
      findProvider.mockRestore();
      if (previousDurableFlag === undefined) {
        delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
      } else {
        process.env.AGENT_CHAT_DURABLE_BACKGROUND = previousDurableFlag;
      }
      if (previousA2ASecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = previousA2ASecret;
    }
  });

  it("still refuses a queued-message promotion that carries no live claim", async () => {
    const threadId = "queued-promotion-thread";
    const queuedId = "queued-message-1";
    await createThread(OWNER, { id: threadId });
    await mutateThreadQueuedMessages(threadId, {
      type: "append",
      message: { id: queuedId, text: "Queued follow-up", threadId },
    });

    const response = await fetch("/_agent-native/agent-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Queued follow-up",
        queuedMessageId: queuedId,
        threadId,
        turnId: `queue-${queuedId}`,
        history: [],
        engine: ENGINE_NAME,
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Queued message promotion claim expired",
    });
    expect(await userMessagesFor(threadId, queuedId)).toHaveLength(0);
    const repo = JSON.parse((await getThread(threadId))?.threadData || "{}");
    expect(repo.queuedMessages).toEqual([
      expect.objectContaining({ id: queuedId }),
    ]);
  });

  it("allows an anonymous read-only visitor to queue a prompt without a user AI identity", async () => {
    const threadId = "anonymous-queued-thread";
    await createThread("anonymous-owner@example.com", { id: threadId });

    const response = await fetch(
      `/_agent-native/agent-chat/threads/${threadId}/queued`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-anonymous": "1",
        },
        body: JSON.stringify({
          mutation: {
            type: "append",
            message: {
              id: "anonymous-queued-prompt",
              threadId,
              text: "Summarize this public page",
            },
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(harness.requireAgentChatAiSetup).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      queuedMessages: [
        expect.objectContaining({
          id: "anonymous-queued-prompt",
          text: "Summarize this public page",
        }),
      ],
    });
  });
});
