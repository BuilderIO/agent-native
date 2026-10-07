import { randomUUID } from "node:crypto";

import { mockEvent } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentConnectionRequiredError } from "../action.js";
import { runWithRequestContext } from "../server/request-context.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import {
  createProductionAgentHandler,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

const mockResolveConnection = vi.hoisted(() =>
  vi.fn(async (): Promise<{ available: boolean }> => ({ available: false })),
);
vi.mock("../workspace-connections/store.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../workspace-connections/store.js")
  >()),
  resolveWorkspaceConnectionForApp: mockResolveConnection,
}));

const mockPriorNote = vi.hoisted(() => ({ spy: vi.fn() }));
vi.mock("./connection-required-note.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./connection-required-note.js")>();
  // The read's own 400ms bound is covered in connection-required-note.spec;
  // a loaded CI box must not turn these runs into unreadable ones.
  mockPriorNote.spy.mockImplementation((input) =>
    actual.resolvePriorConnectionNote({ timeoutMs: 30_000, ...input }),
  );
  return { ...actual, resolvePriorConnectionNote: mockPriorNote.spy };
});

const mockDurable = vi.hoisted(() => ({ enabled: false }));
vi.mock("./durable-background.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./durable-background.js")>()),
  isAgentChatDurableBackgroundEnabled: () => mockDurable.enabled,
}));
const mockDispatch = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../server/self-dispatch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/self-dispatch.js")>()),
  fireInternalDispatch: mockDispatch,
}));

function action(
  run: ActionEntry["run"],
  extra: Partial<ActionEntry> = {},
): ActionEntry {
  return {
    tool: { description: "Test action", parameters: { type: "object" } },
    readOnly: true,
    run,
    ...extra,
  } as ActionEntry;
}

const googleRequired = () =>
  new AgentConnectionRequiredError(
    "Google OAuth token requires an available workspace connection.",
    {
      provider: "google",
      reason: "connect",
      source: {
        id: "google",
        kind: "workspace_connection",
        label: "Google",
      },
    },
  );

function lastUserText(messages: EngineMessage[]): string {
  const last = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  return (last?.content ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

function scriptedEngine(
  script: Array<(messages: EngineMessage[]) => EngineEvent[]>,
  seen: EngineMessage[][] = [],
): AgentEngine {
  let step = 0;
  return {
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
    async *stream(opts): AsyncIterable<EngineEvent> {
      seen.push([...opts.messages]);
      for (const event of script[Math.min(step++, script.length - 1)](
        opts.messages,
      )) {
        yield event;
      }
    },
  };
}

const callTool = (name: string, id: string): EngineEvent[] => [
  {
    type: "assistant-content",
    parts: [{ type: "tool-call", id, name, input: {} }],
  },
  { type: "stop", reason: "tool_use" },
];

const say = (text: string): EngineEvent[] => [
  { type: "assistant-content", parts: [{ type: "text", text }] },
  { type: "stop", reason: "end_turn" },
];

async function runTurn(
  handler: ReturnType<typeof createProductionAgentHandler>,
  threadId: string,
  message: string,
  orgId?: string,
): Promise<AgentChatEvent[]> {
  const event = mockEvent(
    new Request("http://app.example.com/_agent-native/agent-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, threadId }),
    }),
  );
  const response = await runWithRequestContext(
    { userEmail: "owner@example.com", ...(orgId ? { orgId } : {}), run: {} },
    () => handler(event),
  );
  const events: AgentChatEvent[] = [];
  if (response instanceof ReadableStream) {
    const reader = response.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split("\n")) {
        if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
      }
    }
  }
  return events;
}

describe("a thread whose run ended in a connection request", () => {
  beforeEach(() => {
    mockResolveConnection.mockReset();
    mockResolveConnection.mockResolvedValue({ available: false });
  });

  async function twoRuns({
    firstOrgId,
    secondOrgId,
  }: { firstOrgId?: string; secondOrgId?: string } = {}) {
    const threadId = `thread-${randomUUID()}`;
    const provider = vi.fn(async () => {
      throw googleRequired();
    });
    const warehouse = vi.fn(async () => "rows");
    const seenFirst: EngineMessage[][] = [];
    const seenSecond: EngineMessage[][] = [];
    const actions = {
      "provider-api-request": action(provider),
      bigquery: action(warehouse),
    };

    const first = await runTurn(
      createProductionAgentHandler({
        systemPrompt: "Test",
        appId: "analytics",
        engine: scriptedEngine(
          [() => callTool("provider-api-request", "call-1")],
          seenFirst,
        ),
        actions,
      }),
      threadId,
      "How many sessions came from Google last week?",
      firstOrgId,
    );
    expect(first).toContainEqual(
      expect.objectContaining({
        type: "connection_required",
        provider: "google",
      }),
    );
    // The ledger write trails the stream; the next run reads it.
    const { readThreadConnectionRequests } =
      await import("./connection-required-note.js");
    await vi.waitFor(async () =>
      expect(
        await readThreadConnectionRequests(threadId, {
          orgId: firstOrgId ?? null,
        }),
      ).not.toEqual([]),
    );

    const second = await runTurn(
      createProductionAgentHandler({
        systemPrompt: "Test",
        appId: "analytics",
        engine: scriptedEngine(
          [
            () => callTool("bigquery", "call-2"),
            () => say("Answered from the warehouse."),
          ],
          seenSecond,
        ),
        actions,
      }),
      threadId,
      "Try again.",
      secondOrgId,
    );
    return { provider, warehouse, seenSecond, second };
  }

  it("tells the next run not to retry that provider, without re-calling it", async () => {
    const { provider, warehouse, seenSecond, second } = await twoRuns();

    const firstPrompt = lastUserText(seenSecond[0]);
    expect(firstPrompt).toContain("<context-note>Google was not connected");
    expect(firstPrompt).toContain("Do not call it again");
    expect(firstPrompt).toContain("ask a workspace admin to connect it");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(warehouse).toHaveBeenCalledTimes(1);
    expect(second).not.toContainEqual(
      expect.objectContaining({ type: "connection_required" }),
    );
  });

  it("tells the next run in the same organization", async () => {
    const { seenSecond } = await twoRuns({
      firstOrgId: "org-a",
      secondOrgId: "org-a",
    });

    expect(lastUserText(seenSecond[0])).toContain(
      "<context-note>Google was not connected",
    );
  });

  it.each([
    ["another organization", "org-a", "org-b"],
    ["no organization", "org-a", undefined],
    ["an organization after a run with none", undefined, "org-b"],
  ] as const)(
    "does not carry the request into a run in %s",
    async (_name, firstOrgId, secondOrgId) => {
      const { seenSecond } = await twoRuns({ firstOrgId, secondOrgId });

      expect(lastUserText(seenSecond[0])).not.toContain("<context-note>");
    },
  );

  it("drops the note once the workspace connection is available again", async () => {
    mockResolveConnection.mockResolvedValue({ available: true });

    const { seenSecond } = await twoRuns();

    expect(lastUserText(seenSecond[0])).not.toContain("<context-note>");
    expect(mockResolveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "analytics",
        provider: "google",
        requireConnected: true,
      }),
    );
  });
});

describe("the prior connection read on a fresh thread", () => {
  beforeEach(() => {
    mockDurable.enabled = false;
    mockDispatch.mockClear();
    mockPriorNote.spy.mockClear();
  });

  async function turn() {
    const seen: EngineMessage[][] = [];
    const events = await runTurn(
      createProductionAgentHandler({
        systemPrompt: "Test",
        appId: "analytics",
        engine: scriptedEngine([() => say("Hello.")], seen),
        actions: {},
      }),
      `thread-${randomUUID()}`,
      "Hi.",
    );
    return { seen, events };
  }

  it("adds no note when the thread never asked for a connection", async () => {
    const { seen } = await turn();

    expect(mockPriorNote.spy).toHaveBeenCalledTimes(1);
    expect(lastUserText(seen[0])).not.toContain("<context-note>");
  });

  it("tells the model when the earlier connection state could not be read", async () => {
    mockPriorNote.spy.mockResolvedValueOnce({
      status: "unreadable",
      error: "timed out after 400ms",
    });

    const { seen } = await turn();

    expect(lastUserText(seen[0])).toContain(
      "<context-note>Prior-run connection state could not be read this turn; if a provider call returns connection_required, stop and tell the user instead of retrying.</context-note>",
    );
  });

  it("is not read again by the foreground of a run handed to the background worker", async () => {
    mockDurable.enabled = true;

    await turn();

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockPriorNote.spy).not.toHaveBeenCalled();
  });
});

describe("a connection request inside one run", () => {
  const events = (): {
    sent: AgentChatEvent[];
    send: (e: AgentChatEvent) => void;
  } => {
    const sent: AgentChatEvent[] = [];
    return { sent, send: (event) => sent.push(event) };
  };

  it("skips later calls in the same step and ends in a single card", async () => {
    const first = vi.fn(async () => {
      throw googleRequired();
    });
    const second = vi.fn(async () => "never");
    const { sent, send } = events();

    await runAgentLoop({
      engine: scriptedEngine([
        () => [
          {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "a",
                name: "provider-api-catalog",
                input: {},
              },
              {
                type: "tool-call",
                id: "b",
                name: "provider-api-request",
                input: {},
              },
            ],
          },
          { type: "stop", reason: "tool_use" },
        ],
      ]),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "provider-api-catalog": action(first, { readOnly: false }),
        "provider-api-request": action(second, { readOnly: false }),
      },
      send,
      signal: new AbortController().signal,
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(sent.filter((e) => e.type === "connection_required")).toHaveLength(
      1,
    );
  });

  it("emits one card when parallel reads for the provider both fail", async () => {
    const failing = vi.fn(async () => {
      throw googleRequired();
    });
    const { sent, send } = events();

    await runAgentLoop({
      engine: scriptedEngine([
        () => [
          {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "a",
                name: "provider-api-catalog",
                input: {},
              },
              {
                type: "tool-call",
                id: "b",
                name: "provider-api-request",
                input: {},
              },
            ],
          },
          { type: "stop", reason: "tool_use" },
        ],
      ]),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "provider-api-catalog": action(failing),
        "provider-api-request": action(failing),
      },
      send,
      signal: new AbortController().signal,
    });

    expect(sent.filter((e) => e.type === "connection_required")).toHaveLength(
      1,
    );
  });
});

describe("the connection request message", () => {
  async function detailFor(
    reason: "connect" | "grant" | "reauthorize" | "admin_required",
    message = "Connect Slack to continue.",
  ): Promise<string | undefined> {
    const sent: AgentChatEvent[] = [];
    await runAgentLoop({
      engine: scriptedEngine([() => callTool("dispatch", "d")]),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        dispatch: action(async () => {
          throw new AgentConnectionRequiredError(message, {
            provider: "slack",
            reason,
          });
        }),
      },
      send: (event) => sent.push(event),
      signal: new AbortController().signal,
    });
    return sent.find(
      (e): e is Extract<AgentChatEvent, { type: "connection_required" }> =>
        e.type === "connection_required",
    )?.detail;
  }

  it("says who can unblock it when no connection is usable by the member", async () => {
    expect(await detailFor("connect")).toBe(
      "Connect Slack to continue. If you cannot connect it yourself, ask a workspace admin to connect it for the workspace.",
    );
    expect(await detailFor("grant")).toBe(
      "Connect Slack to continue. Ask a workspace admin to grant this app access to the existing connection.",
    );
    expect(await detailFor("admin_required")).toBe(
      "Connect Slack to continue. Only a workspace admin can do this; ask one to connect it.",
    );
  });

  it("leaves a reauthorization and an already-explained message alone", async () => {
    expect(await detailFor("reauthorize")).toBe("Connect Slack to continue.");
    expect(
      await detailFor("connect", "Ask your workspace admin to connect Slack."),
    ).toBe("Ask your workspace admin to connect Slack.");
  });
});
