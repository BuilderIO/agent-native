import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mockEvent } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { SCHEMA_SNAPSHOT } from "../db/schema-snapshot.generated.js";
import { __setSchemaSnapshotForTests } from "../db/store-registry.js";
import { runWithRequestContext } from "../server/request-context.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineStreamOptions,
} from "./engine/types.js";
import type { ActionEntry } from "./production-agent.js";
import { ensureRunTables } from "./run-store.js";
import type { AgentChatStructuredMessage } from "./types.js";

const consumeApproval = vi.hoisted(() => vi.fn(async () => true));

vi.mock("./tool-approval-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tool-approval-store.js")>()),
  resolveAgentToolApprovalTurnId: vi.fn(async () => null),
  createAgentToolApproval: vi.fn(async () => "approval-1"),
  consumeAgentToolApproval: consumeApproval,
  isAgentToolAlwaysAllowed: vi.fn(async () => false),
}));

const { createProductionAgentHandler, toolCallCacheKey } =
  await import("./production-agent.js");

const previousDatabaseUrl = process.env.DATABASE_URL;
let databaseDirectory: string;

beforeAll(async () => {
  await closeDbExec();
  databaseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "approved-tool-gone-"),
  );
  process.env.DATABASE_URL = `pglite:${databaseDirectory}`;
  // Retain release-owned inbox schema while leaving the thread store cold.
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
});
afterAll(async () => {
  __setSchemaSnapshotForTests(undefined);
  await closeDbExec();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (databaseDirectory)
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
});

const EMAIL = { to: "customer@example.com", body: "Your refund is approved." };

// The paused turn as the client replays it after the user clicks Approve.
const pausedTurn: AgentChatStructuredMessage[] = [
  { role: "user", content: [{ type: "text", text: "Email the customer" }] },
  {
    role: "assistant",
    content: [
      { type: "tool-call", id: "email-1", name: "send-email", input: EMAIL },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool-result",
        toolCallId: "email-1",
        toolName: "send-email",
        content:
          "Awaiting human approval. The send-email call did NOT execute.",
        approvalPause: true,
      },
    ],
  },
];

function testEngine() {
  const messages: EngineStreamOptions["messages"][] = [];
  const stream = vi.fn(async function* (
    options: EngineStreamOptions,
  ): AsyncIterable<EngineEvent> {
    messages.push(options.messages);
    yield {
      type: "assistant-content",
      parts: [{ type: "text", text: "I'll draft it another way." }],
    };
    yield { type: "stop", reason: "end_turn" };
  });
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
    stream,
  };
  return { engine, stream, messages };
}

async function approve(
  threadId: string,
  actions: Record<string, ActionEntry>,
  structuredHistory: AgentChatStructuredMessage[] = pausedTurn,
) {
  const { engine, stream, messages } = testEngine();
  const handler = createProductionAgentHandler({
    systemPrompt: "Test",
    engine,
    actions,
    assertAiSetupReady: async () => {},
  });
  const response = await runWithRequestContext(
    { userEmail: "alice@example.com", orgId: "acme", run: {} },
    () =>
      handler(
        mockEvent(
          new Request("http://app.example.com/_agent-native/agent-chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              message: "Approved",
              threadId,
              turnId: `${threadId}-turn`,
              structuredHistory,
              approvedToolCalls: [toolCallCacheKey("send-email", EMAIL)],
            }),
          }),
        ),
      ),
  );
  const body = await new Response(response as ReadableStream).text();
  const events = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return { stream, events, messages };
}

describe("an approved call", () => {
  it("stops the turn without the model when its tool is gone", async () => {
    const { stream, events } = await approve("thread-gone", {});

    expect(stream).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "email-1",
        tool: "send-email",
        isError: true,
        completedSideEffect: false,
        result: expect.stringMatching(
          /^Error: Tool no longer available: "send-email"/,
        ),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "tool_unavailable",
      }),
    );
    expect(events.map((event) => event.type)).not.toContain("done");
  });

  it("continues with the result when the approved tool is still there", async () => {
    consumeApproval.mockClear();
    const sendEmail = vi.fn(async () => "Sent email receipt-1");

    const { stream, events, messages } = await approve("thread-present", {
      "send-email": {
        tool: {
          description: "Send an email",
          parameters: { type: "object", properties: {} },
        },
        readOnly: false,
        needsApproval: true,
        run: sendEmail,
      },
    });

    expect(consumeApproval).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(stream).toHaveBeenCalled();
    const continuedResult = messages
      .flatMap((messagesForCall) => messagesForCall)
      .flatMap((message) => message.content)
      .find(
        (part) => part.type === "tool-result" && part.toolCallId === "email-1",
      );
    expect(continuedResult).toMatchObject({
      type: "tool-result",
      content: "Sent email receipt-1",
    });
    expect(continuedResult).not.toHaveProperty("approvalPause");
    expect(continuedResult).not.toHaveProperty("approvalAskId");
    expect(events).not.toContainEqual(
      expect.objectContaining({ errorCode: "tool_unavailable" }),
    );
  });

  it("does not execute an approved action when its paused result is not resumable", async () => {
    consumeApproval.mockClear();
    const sendEmail = vi.fn(async () => "Sent email receipt-1");
    const structuredHistory = [
      pausedTurn[0]!,
      pausedTurn[1]!,
      { ...pausedTurn[2]!, role: "system" },
    ] as unknown as AgentChatStructuredMessage[];

    const { stream, events } = await approve(
      "thread-unresumable-result",
      {
        "send-email": {
          tool: {
            description: "Send an email",
            parameters: { type: "object", properties: {} },
          },
          readOnly: false,
          needsApproval: true,
          run: sendEmail,
        },
      },
      structuredHistory,
    );

    expect(consumeApproval).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "approved_tool_call_result_missing",
      }),
    );
  });
});
