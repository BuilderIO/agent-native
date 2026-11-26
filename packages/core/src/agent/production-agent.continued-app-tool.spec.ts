import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mockEvent } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createThread,
  ensureChatThreadTables,
  registerChatThreadsShareable,
} from "../chat-threads/store.js";
import { closeDbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { SCHEMA_SNAPSHOT } from "../db/schema-snapshot.generated.js";
import { __setSchemaSnapshotForTests } from "../db/store-registry.js";
import { runWithRequestContext } from "../server/request-context.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineStreamOptions,
} from "./engine/types.js";
import type { ActionEntry } from "./production-agent.js";
import { ensureRunTables } from "./run-store.js";
import type { AgentChatStructuredMessage } from "./types.js";

vi.mock("./tool-approval-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tool-approval-store.js")>()),
  resolveAgentToolApprovalTurnId: vi.fn(async () => null),
  createAgentToolApproval: vi.fn(async () => "approval-1"),
  consumeAgentToolApproval: vi.fn(async () => true),
  isAgentToolAlwaysAllowed: vi.fn(async () => false),
}));

const { createProductionAgentHandler } = await import("./production-agent.js");
const { attachToolSearch } = await import("./tool-search.js");

const previousDatabaseUrl = process.env.DATABASE_URL;
let databaseDirectory: string;

beforeAll(async () => {
  await closeDbExec();
  databaseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "continued-app-tool-"),
  );
  process.env.DATABASE_URL = `pglite:${databaseDirectory}`;
  __setSchemaSnapshotForTests({
    ...SCHEMA_SNAPSHOT,
    statements: SCHEMA_SNAPSHOT.statements.filter(
      (statement) => !/\bchat_threads\b/.test(statement),
    ),
    tables: SCHEMA_SNAPSHOT.tables.filter((table) => table !== "chat_threads"),
    migrations: SCHEMA_SNAPSHOT.migrations.filter(
      ([storeId]) => storeId !== "chat_threads",
    ),
  });
  await withMigrationRuntime(ensureRunTables);
  registerChatThreadsShareable();
  await withMigrationRuntime(ensureChatThreadTables);
});
afterAll(async () => {
  __setSchemaSnapshotForTests(undefined);
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (databaseDirectory)
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
});

const TOOL = "run-sample-cell";

function appTool(run: ActionEntry["run"]): ActionEntry {
  return {
    tool: {
      description: "Run one saved sample cell",
      parameters: { type: "object", properties: {} },
    },
    readOnly: false,
    run,
  } as ActionEntry;
}

function scriptedEngine(turns: EngineContentPart[][]) {
  const messages: EngineStreamOptions["messages"][] = [];
  const tools: string[][] = [];
  let call = 0;
  const engine: AgentEngine = {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(options): AsyncIterable<EngineEvent> {
      messages.push(structuredClone(options.messages));
      tools.push(options.tools.map((tool) => tool.name));
      const parts: EngineContentPart[] = turns[call++] ?? [
        { type: "text", text: "wrapped up" },
      ];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: parts.some((part) => part.type === "tool-call")
          ? "tool_use"
          : "end_turn",
      };
    },
  };
  return { engine, messages, tools };
}

async function send(
  threadId: string,
  body: Record<string, unknown>,
  options: Parameters<typeof createProductionAgentHandler>[0],
) {
  await createThread("alice@example.com", { id: threadId, orgId: "acme" });
  const handler = createProductionAgentHandler({
    ...options,
    assertAiSetupReady: async () => {},
  });
  const deferredWork: Promise<unknown>[] = [];
  const response = await runWithRequestContext(
    {
      userEmail: "alice@example.com",
      orgId: "acme",
      run: { waitUntil: (work) => void deferredWork.push(work) },
    },
    () =>
      handler(
        mockEvent(
          new Request("http://app.example.com/_agent-native/agent-chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              threadId,
              turnId: `${threadId}-turn`,
              ...body,
            }),
          }),
        ),
      ),
  );
  const text = await new Response(response as ReadableStream).text();
  await Promise.allSettled(deferredWork);
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

const loadedHistory: AgentChatStructuredMessage[] = [
  { role: "user", content: [{ type: "text", text: "How many rows?" }] },
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        id: "s1",
        name: "tool-search",
        input: { names: [TOOL] },
      },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool-result",
        toolCallId: "s1",
        toolName: "tool-search",
        content: JSON.stringify({ loadedForNextStep: [TOOL] }),
      },
    ],
  },
];

const callTool: EngineContentPart[] = [
  { type: "tool-call", id: "c1", name: TOOL, input: {} },
];

describe("an app-owned tool loaded earlier in the turn", () => {
  it("still runs when the continuation resolves it for the same caller", async () => {
    const run = vi.fn(async () => "cell ran");
    const { engine } = scriptedEngine([callTool]);

    const events = await send(
      "thread-continued-present",
      { message: "continue", structuredHistory: loadedHistory },
      {
        systemPrompt: "Test",
        engine,
        initialToolNames: [],
        actions: attachToolSearch({}),
        resolveAdditionalActions: async () => ({ [TOOL]: appTool(run) }),
      },
    );

    expect(run).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: TOOL,
        result: "cell ran",
      }),
    );
    expect(events.map((event) => event.type)).toContain("done");
  });

  it("is refused without running once the caller no longer resolves it", async () => {
    const run = vi.fn(async () => "cell ran");
    const { engine } = scriptedEngine([
      callTool,
      [{ type: "text", text: "Sorry." }],
    ]);

    const events = await send(
      "thread-continued-revoked",
      { message: "continue", structuredHistory: loadedHistory },
      {
        systemPrompt: "Test",
        engine,
        initialToolNames: [],
        actions: attachToolSearch({}),
        resolveAdditionalActions: async () => ({}),
      },
    );

    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: TOOL,
        isError: true,
        completedSideEffect: false,
        result: expect.stringMatching(/^Error: Tool no longer available/),
      }),
    );
  });

  it("fails the turn naming the tool when the model ends empty after the refusal", async () => {
    const { engine } = scriptedEngine([callTool, [], [], []]);

    const events = await send(
      "thread-continued-empty",
      { message: "continue", structuredHistory: loadedHistory },
      {
        systemPrompt: "Test",
        engine,
        initialToolNames: [],
        actions: attachToolSearch({}),
        resolveAdditionalActions: async () => ({}),
      },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "tool_unavailable",
        error: expect.stringContaining(TOOL),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("empty_final_response");
    expect(events.map((event) => event.type)).not.toContain("done");
  });

  it("keeps the empty-response failure for an empty reply with no refusal", async () => {
    const { engine } = scriptedEngine([[], [], []]);

    const events = await send(
      "thread-continued-plain-empty",
      { message: "How many rows?" },
      { systemPrompt: "Test", engine, actions: attachToolSearch({}) },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "empty_final_response",
        error: expect.stringContaining("The model returned an empty response"),
      }),
    );
  });

  it("keeps the empty-response failure when another tool succeeded after the refusal", async () => {
    const lookup: ActionEntry = {
      tool: {
        description: "Look something up",
        parameters: { type: "object", properties: {} },
      },
      readOnly: true,
      run: async () => "found it",
    } as ActionEntry;
    const { engine } = scriptedEngine([
      callTool,
      [{ type: "tool-call", id: "c2", name: "lookup", input: {} }],
      [],
      [],
      [],
    ]);

    const events = await send(
      "thread-continued-recovered",
      { message: "continue", structuredHistory: loadedHistory },
      {
        systemPrompt: "Test",
        engine,
        initialToolNames: ["lookup"],
        actions: attachToolSearch({ lookup }),
        resolveAdditionalActions: async () => ({}),
      },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "lookup",
        result: "found it",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "empty_final_response",
      }),
    );
  });
});
