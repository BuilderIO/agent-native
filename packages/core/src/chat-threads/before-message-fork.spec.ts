import { AgentKitClient } from "@agent-native/agentkit/client";
import {
  parseAgentEvent,
  type AgentEvent,
} from "@agent-native/agentkit/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storeLedgerResult } from "../db/store-ledger.test-helpers.js";

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => {
    const db = {
      execute: async ({
        sql,
        args = [],
      }: {
        sql: string;
        args?: unknown[];
      }) => {
        const ledger = storeLedgerResult(sql);
        if (ledger) return ledger;
        if (/FROM information_schema.columns/.test(sql)) return { rows: [] };
        if (/SELECT .*FROM chat_threads WHERE id =/s.test(sql))
          return {
            rows: state.rows.has(String(args[0]))
              ? [state.rows.get(String(args[0]))]
              : [],
          };
        if (/INSERT INTO chat_threads/.test(sql)) {
          const names = [
            "id",
            "owner_email",
            "title",
            "preview",
            "thread_data",
            "message_count",
            "created_at",
            "updated_at",
            "scope_type",
            "scope_id",
            "scope_label",
            "source_platform",
            "source_app_id",
            "source_url",
            "org_id",
            "edit_root_id",
            "edit_prefix_count",
          ];
          state.rows.set(
            String(args[0]),
            Object.fromEntries(names.map((name, i) => [name, args[i]])),
          );
        }
        return { rows: [], rowsAffected: 1 };
      },
      transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    };
    return db;
  },
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn(),
  ensureIndexExists: vi.fn(),
  ensureTableExists: vi.fn(),
}));
vi.mock("./emitter.js", () => ({ emitChatThreadChange: vi.fn() }));
vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => "qa-org",
}));
vi.mock("../client/use-agent-chat-running-threads.js", () => ({
  dispatchAgentChatRunning: vi.fn(),
}));
import { createAgentNativeAgentKitTransport } from "../client/chat/agentkit-agent-native.js";
import { forkThread } from "./store.js";

function fixture() {
  const ids = ["user-first", "answer-first", "user-middle", "answer-middle"];
  const messages = ids.map((id, i) => ({
    id,
    role: i % 2 ? "assistant" : "user",
    parts: [{ type: "text", text: id }],
  }));
  return {
    messages: [],
    queuedMessages: [{ id: "late-queued", text: "Later queued prompt" }],
    resumeState: { answer: "late-state" },
    agentKit: {
      version: 1,
      messages,
      resumeState: { answer: "late-state" },
      events: [1, 3].map((i) => ({
        id: `event-${i}`,
        type: "message.completed",
        runId: `run-${i}`,
        threadId: "source",
        sequence: 1,
        occurredAt: "2026-11-07T00:00:00.000Z",
        message: messages[i],
      })),
      runs: [1, 3].map((i) => ({
        id: `run-${i}`,
        threadId: "source",
        status: "completed",
        activeMessageId: ids[i],
        lastSequence: 1,
      })),
      toolCalls: [1, 3].map((i) => ({
        id: `tool-${i}`,
        name: "read",
        status: "completed",
        messageId: ids[i],
        runId: `run-${i}`,
      })),
      widgets: [1, 3].map((i) => ({
        messageId: ids[i],
        widget: { id: `widget-${i}`, kind: "table", data: {} },
      })),
      annotations: [1, 3].map((i) => ({
        messageId: ids[i],
        annotation: {
          id: `annotation-${i}`,
          kind: "reference",
          label: `annotation-${i}`,
        },
      })),
      suggestions: [{ id: "late-suggestion", label: "Later suggestion" }],
      activeRunIds: [],
    },
  };
}
beforeEach(() => {
  state.rows.clear();
  state.rows.set("source", {
    id: "source",
    owner_email: "qa@example.com",
    title: "Question",
    preview: "answer-middle",
    thread_data: JSON.stringify(fixture()),
    message_count: 4,
    created_at: 1,
    updated_at: 1,
    scope_type: "workspace",
    scope_id: "qa-workspace",
    scope_label: "QA",
    org_id: "qa-org",
  });
});
function sourceSnapshot(boundary: Record<string, unknown>) {
  return {
    threadData: JSON.stringify(fixture()),
    messageCount: 4,
    ...boundary,
  };
}

describe("exclusive message forks", () => {
  it.each([
    ["user-first", []],
    ["user-middle", ["user-first", "answer-first"]],
  ] as const)(
    "forks before %s through the real controller and persisted adapter",
    async (beforeMessageId, expected) => {
      const original = state.rows.get("source")!.thread_data;
      let witnessedMessageCount: number | undefined;
      const transport = createAgentNativeAgentKitTransport({
        apiUrl: "/_agent-native/agent-chat",
        adapter: { createId: () => "edited" },
        fetch: async (input, init) => {
          const url = String(input);
          if (url.endsWith("/threads/source/fork")) {
            const body = JSON.parse(String(init?.body));
            // The server receives a full boundary witness, never an unverifiable empty snapshot.
            witnessedMessageCount = body.source
              ? JSON.parse(body.source.threadData).agentKit.messages.length
              : undefined;
            const fork = await forkThread("source", "qa@example.com", {
              id: body.id,
              source: body.source,
            });
            return Response.json(fork);
          }
          if (url.endsWith("/threads/source"))
            return Response.json({
              id: "source",
              title: "Question",
              threadData: original,
            });
          return Response.json({ error: "Not found" }, { status: 404 });
        },
      });
      const client = new AgentKitClient({
        transport,
        aiSetupReadiness: "not-applicable",
      });
      try {
        await client.forkThread("source", undefined, {
          beforeMessageId,
        });
        const saved = state.rows.get("edited")!;
        const data = JSON.parse(String(saved.thread_data));
        expect(data.agentKit.messages.map((m: { id: string }) => m.id)).toEqual(
          expected,
        );
        expect(witnessedMessageCount).toBe(4);
        expect(saved.message_count).toBe(expected.length);
        expect(saved.preview).toBe("");
        expect(saved.scope_id).toBe("qa-workspace");
        expect(saved.org_id).toBe("qa-org");
        expect(data.queuedMessages).toEqual([]);
        expect(data.resumeState).toBeUndefined();
        expect(data.agentKit.resumeState).toBeUndefined();
        expect(
          data.agentKit.toolCalls.map((t: { id: string }) => t.id),
        ).toEqual(expected.length ? ["tool-1"] : []);
        expect(data.agentKit.widgets).toHaveLength(expected.length ? 1 : 0);
        expect(data.agentKit.annotations).toHaveLength(expected.length ? 1 : 0);
        expect(data.agentKit.events).toHaveLength(expected.length ? 1 : 0);
        expect(data.agentKit.runs).toHaveLength(expected.length ? 1 : 0);
        expect(data.agentKit.suggestions).toEqual([]);
        expect(state.rows.get("source")!.thread_data).toBe(original);
      } finally {
        await client.shutdown();
      }
    },
  );
  it("records trusted edit lineage without changing the title", async () => {
    state.rows.get("source")!.source_app_id = "app";
    const edit = await forkThread("source", "qa@example.com", {
      id: "edit",
      forkPurpose: "edit",
      trustedAppId: "app",
      source: sourceSnapshot({ beforeMessageId: "user-middle" }),
    });
    expect(edit?.title).toBe("Question");
    expect(edit?.editRootId).toBe("source");
    expect(state.rows.get("edit")?.edit_prefix_count).toBe(2);
  });
  it.each([
    ["foreign app", { source_app_id: "another" }, "qa@example.com"],
    ["missing provenance", { source_app_id: null }, "qa@example.com"],
    [
      "foreign org",
      { source_app_id: "app", org_id: "another" },
      "qa@example.com",
    ],
    ["foreign owner", { source_app_id: "app" }, "other@example.com"],
    [
      "external source",
      { source_app_id: "app", source_platform: "external" },
      "qa@example.com",
    ],
  ])("does not join lineage for %s", async (_label, fields, owner) => {
    Object.assign(state.rows.get("source")!, fields, {
      edit_root_id: "forged-root",
    });
    const edit = await forkThread("source", owner, {
      id: "isolated",
      forkPurpose: "edit",
      trustedAppId: "app",
      sourceAccessGranted: true,
      source: sourceSnapshot({ beforeMessageId: "user-middle" }),
    });
    expect(edit?.editRootId).toBeUndefined();
    expect(state.rows.get("isolated")?.edit_root_id).toBeNull();
    expect(state.rows.get("isolated")?.edit_prefix_count).toBe(2);
  });
  it("keeps the durable root through another edit and resets it for an ordinary fork", async () => {
    state.rows.get("source")!.source_app_id = "app";
    await forkThread("source", "qa@example.com", {
      id: "edit-one",
      forkPurpose: "edit",
      trustedAppId: "app",
      source: sourceSnapshot({ beforeMessageId: "user-middle" }),
    });
    const edit = await forkThread("edit-one", "qa@example.com", {
      id: "edit-two",
      forkPurpose: "edit",
      trustedAppId: "app",
      source: sourceSnapshot({ beforeMessageId: "user-first" }),
    });
    expect(edit?.editRootId).toBe("source");
    const ordinary = await forkThread("edit-one", "qa@example.com", {
      id: "ordinary",
    });
    expect(ordinary?.editRootId).toBeUndefined();
    expect(ordinary?.title).toBe("Question (fork)");
  });
  it("resolves physical boundary aliases to the canonical message", async () => {
    const data = fixture();
    data.messages = data.agentKit.messages.map((message) => ({
      ...message,
      id: `root-${message.id}`,
      metadata: { custom: { agentKitMessageId: message.id } },
    })) as never[];
    state.rows.get("source")!.thread_data = JSON.stringify(data);
    const result = await forkThread("source", "qa@example.com", {
      id: "physical",
      source: sourceSnapshot({ beforeMessageId: "root-user-middle" }),
    });
    expect(
      JSON.parse(result!.threadData).agentKit.messages.map(
        (m: { id: string }) => m.id,
      ),
    ).toEqual(["user-first", "answer-first"]);
    expect(JSON.parse(result!.threadData).headId).toBe("root-answer-first");
  });
  it("rejects ambiguous physical and canonical boundary aliases", async () => {
    const data = fixture();
    data.messages = [
      {
        id: "ambiguous",
        role: "user",
        metadata: { custom: { agentKitMessageId: "user-first" } },
      },
      {
        id: "ambiguous",
        role: "user",
        metadata: { custom: { agentKitMessageId: "user-middle" } },
      },
    ] as never[];
    state.rows.get("source")!.thread_data = JSON.stringify(data);
    await expect(
      forkThread("source", "qa@example.com", {
        source: sourceSnapshot({ beforeMessageId: "ambiguous" }),
      }),
    ).rejects.toThrow("Invalid fork message boundary");
  });
  it("resolves a physical alias in legacy-only history", async () => {
    const data = {
      messages: [
        {
          id: "legacy-root",
          metadata: { custom: { agentKitMessageId: "legacy-id" } },
        },
      ],
      headId: "legacy-root",
    };
    state.rows.get("source")!.thread_data = JSON.stringify(data);
    const fork = await forkThread("source", "qa@example.com", {
      id: "legacy-alias",
      source: sourceSnapshot({ beforeMessageId: "legacy-root" }),
    });
    expect(JSON.parse(fork!.threadData).messages).toEqual([]);
  });
  it("settles only retained activities with cut terminal events", async () => {
    const data = fixture();
    const base = {
      threadId: "source",
      runId: "run-1",
      occurredAt: "2026-11-07T00:00:00.000Z",
    };
    const running = {
      id: "dangling",
      kind: "tool",
      label: "Running",
      status: "running",
      runId: "run-1",
    } as const;
    const done = {
      id: "done",
      kind: "tool",
      label: "Done",
      status: "completed",
      runId: "run-1",
    } as const;
    const validEvents: AgentEvent[] = [
      {
        ...base,
        id: "a",
        sequence: 1,
        type: "activity.started",
        activity: running,
      },
      {
        ...base,
        id: "b",
        sequence: 2,
        type: "activity.completed",
        activity: done,
      },
      {
        ...base,
        id: "c",
        sequence: 3,
        type: "message.completed",
        message: data.agentKit.messages[1],
      },
      {
        ...base,
        id: "d",
        sequence: 4,
        type: "activity.completed",
        activity: { ...running, status: "completed" },
      },
    ].map((event) => parseAgentEvent(event));
    data.agentKit.events =
      validEvents as unknown as typeof data.agentKit.events;
    data.agentKit.runs = [
      {
        id: "run-1",
        threadId: "source",
        status: "completed",
        activeMessageId: "answer-middle",
        lastSequence: 4,
      },
    ];
    Object.assign(data.agentKit, { activities: [running, done] });
    state.rows.get("source")!.thread_data = JSON.stringify(data);
    const fork = await forkThread("source", "qa@example.com", {
      id: "activities",
      source: sourceSnapshot({ beforeMessageId: "user-middle" }),
    });
    const result = JSON.parse(fork!.threadData).agentKit;
    expect(result.events.find((e: any) => e.id === "a").activity.status).toBe(
      "cancelled",
    );
    expect(result.events.find((e: any) => e.id === "b").activity.status).toBe(
      "completed",
    );
    expect(result.activities.find((a: any) => a.id === "dangling").status).toBe(
      "cancelled",
    );
    expect(result.activities.find((a: any) => a.id === "done").status).toBe(
      "completed",
    );
  });
  it.each(["malformed", "gapped", "snapshot-only"] as const)(
    "settles snapshot activities when retained replay is %s",
    async (replay) => {
      const data = fixture();
      const activities = [
        {
          id: "running-snapshot",
          kind: "tool",
          label: "Retained work",
          status: "running",
          runId: "run-1",
        },
        {
          id: "completed-snapshot",
          kind: "tool",
          label: "Completed work",
          status: "completed",
          runId: "run-1",
        },
      ];
      Object.assign(data.agentKit, { activities });
      if (replay === "malformed") {
        data.agentKit.events.unshift({
          id: "legacy-event",
          type: "legacy",
          threadId: "source",
          runId: "run-1",
          sequence: 1,
        } as never);
      } else if (replay === "gapped") {
        data.agentKit.events[0]!.sequence = 2;
        data.agentKit.runs[0]!.lastSequence = 2;
      } else {
        data.agentKit.events = [];
      }
      state.rows.get("source")!.thread_data = JSON.stringify(data);
      const forkId = `snapshot-${replay}`;
      const fork = await forkThread("source", "qa@example.com", {
        id: forkId,
        source: sourceSnapshot({ beforeMessageId: "user-middle" }),
      });
      const retained = JSON.parse(fork!.threadData).agentKit;
      expect(retained.events).toEqual([]);
      expect(retained.activities).toEqual([
        { ...activities[0], status: "cancelled" },
        activities[1],
      ]);
      const transport = createAgentNativeAgentKitTransport({
        apiUrl: "/_agent-native/agent-chat",
        fetch: async () => Response.json(fork),
      });
      const client = new AgentKitClient({
        transport,
        aiSetupReadiness: "not-applicable",
      });
      try {
        const loaded = await client.loadThread(forkId);
        expect(loaded.messages.map((message) => message.id)).toEqual([
          "user-first",
          "answer-first",
        ]);
        expect(client.getThread(forkId).activeRunIds).toEqual([]);
        expect(
          client.getThread(forkId).activities["running-snapshot"]?.status,
        ).toBe("cancelled");
        expect(
          client.getThread(forkId).activities["completed-snapshot"]?.status,
        ).toBe("completed");
      } finally {
        await client.shutdown();
      }
    },
  );
  it("keeps sliceable history when optional replay contains a malformed legacy event", async () => {
    const data = fixture();
    data.agentKit.events.unshift({
      id: "old",
      type: "legacy",
      threadId: "source",
      runId: "run-1",
      sequence: 1,
    } as never);
    state.rows.get("source")!.thread_data = JSON.stringify(data);
    const fork = await forkThread("source", "qa@example.com", {
      id: "legacy",
      source: sourceSnapshot({ beforeMessageId: "user-middle" }),
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: async () => Response.json(fork),
    });
    const client = new AgentKitClient({
      transport,
      aiSetupReadiness: "not-applicable",
    });
    try {
      const loaded = await client.loadThread("legacy");
      expect(loaded.messages.map((m) => m.id)).toEqual([
        "user-first",
        "answer-first",
      ]);
    } finally {
      await client.shutdown();
    }
  });
  it("replays out-of-order events within each run in sequence", async () => {
    const data = fixture();
    const base = {
      threadId: "source",
      runId: "run-1",
      occurredAt: "2026-11-07T00:00:00.000Z",
    };
    data.agentKit.events = [
      {
        ...base,
        id: "interaction",
        sequence: 2,
        type: "agent.interaction",
        interaction: { id: "i", kind: "started", agentId: "a" },
      },
      {
        ...base,
        runId: "run-2",
        id: "other-start",
        sequence: 1,
        type: "run.started",
      },
      {
        ...base,
        id: "agent",
        sequence: 1,
        type: "agent.registered",
        agent: { id: "a", name: "Agent", status: "working" },
      },
      {
        ...base,
        runId: "run-2",
        id: "other-message",
        sequence: 2,
        type: "message.completed",
        message: data.agentKit.messages[1],
      },
      {
        ...base,
        id: "message",
        sequence: 3,
        type: "message.completed",
        message: data.agentKit.messages[1],
      },
    ] as unknown as typeof data.agentKit.events;
    data.agentKit.runs[0]!.lastSequence = 3;
    state.rows.get("source")!.thread_data = JSON.stringify(data);
    const fork = await forkThread("source", "qa@example.com", {
      id: "ordered",
      source: sourceSnapshot({ beforeMessageId: "user-middle" }),
    });
    expect(
      JSON.parse(fork!.threadData).agentKit.events.map(
        (event: { sequence: number; runId: string }) =>
          `${event.runId}:${event.sequence}`,
      ),
    ).toEqual(["run-1:1", "run-2:1", "run-1:2", "run-2:2", "run-1:3"]);
  });
  it("preserves valid omission markers when replaying a retained run", async () => {
    const data = fixture();
    const base = {
      threadId: "source",
      runId: "run-1",
      occurredAt: "2026-11-07T00:00:00.000Z",
    };
    data.agentKit.events = [
      {
        ...base,
        id: "marker",
        sequence: 1,
        type: "x-agent-native.persisted-event-omission-range",
        payload: { lastSequence: 2, sourceType: "runtime_history_prefix" },
      },
      {
        ...base,
        id: "message",
        sequence: 3,
        type: "message.completed",
        message: data.agentKit.messages[1],
      },
    ] as unknown as typeof data.agentKit.events;
    data.agentKit.runs[0]!.lastSequence = 3;
    state.rows.get("source")!.thread_data = JSON.stringify(data);
    const fork = await forkThread("source", "qa@example.com", {
      id: "omissions",
      source: sourceSnapshot({ beforeMessageId: "user-middle" }),
    });
    const events = JSON.parse(fork!.threadData).agentKit.events;
    expect(events.map((event: { sequence: number }) => event.sequence)).toEqual(
      [1, 3],
    );
    expect(events[0].payload.lastSequence).toBe(2);
  });
  it("keeps full and inclusive existing forks", async () => {
    const full = await forkThread("source", "qa@example.com", { id: "full" });
    expect(JSON.parse(full!.threadData).agentKit.messages).toHaveLength(4);
    const inclusive = await forkThread("source", "qa@example.com", {
      id: "inclusive",
      source: sourceSnapshot({ fromMessageId: "answer-first" }),
    });
    expect(
      JSON.parse(inclusive!.threadData).agentKit.messages.map(
        (m: { id: string }) => m.id,
      ),
    ).toEqual(["user-first", "answer-first"]);
  });
  it.each([
    { beforeMessageId: "unknown" },
    { beforeMessageId: "" },
    { beforeMessageId: 3 },
    { beforeMessageId: "user-first", fromMessageId: "answer-first" },
  ])("rejects invalid boundary %j before inserting", async (boundary) => {
    await expect(
      forkThread("source", "qa@example.com", {
        id: "invalid",
        source: sourceSnapshot(boundary),
      }),
    ).rejects.toThrow();
    expect(state.rows.has("invalid")).toBe(false);
  });
  it("refuses a foreign owner and never changes source", async () => {
    expect(
      await forkThread("source", "other@example.com", {
        id: "foreign",
        source: sourceSnapshot({ beforeMessageId: "user-first" }),
      }),
    ).toBeNull();
    expect(state.rows.has("foreign")).toBe(false);
  });
  it("rejects a boundary forged only into the client snapshot", async () => {
    const forged = fixture();
    forged.agentKit.messages.push({
      id: "forged",
      role: "user",
      parts: [{ type: "text", text: "Forged" }],
    });
    await expect(
      forkThread("source", "qa@example.com", {
        id: "forged",
        source: {
          threadData: JSON.stringify(forged),
          beforeMessageId: "forged",
        },
      }),
    ).rejects.toThrow();
    expect(state.rows.has("forged")).toBe(false);
  });
  it("does not bootstrap an absent source or accept an empty boundary witness", async () => {
    expect(
      await forkThread("absent", "qa@example.com", {
        id: "absent-fork",
        source: sourceSnapshot({ beforeMessageId: "user-first" }),
      }),
    ).toBeNull();
    expect(state.rows.has("absent")).toBe(false);
    await expect(
      forkThread("source", "qa@example.com", {
        id: "empty",
        source: {
          threadData: JSON.stringify({ messages: [] }),
          beforeMessageId: "user-first",
        },
      }),
    ).rejects.toThrow();
    expect(state.rows.has("empty")).toBe(false);
  });
  it("cuts legacy root history before its first message", async () => {
    state.rows.get("source")!.thread_data = JSON.stringify({
      messages: [
        {
          id: "legacy-user",
          role: "user",
          content: [{ type: "text", text: "Original" }],
        },
      ],
      headId: "legacy-user",
      resumeState: { old: "state" },
    });
    const fork = await forkThread("source", "qa@example.com", {
      id: "legacy",
      source: {
        threadData: String(state.rows.get("source")!.thread_data),
        beforeMessageId: "legacy-user",
      },
    });
    expect(JSON.parse(fork!.threadData)).toMatchObject({
      messages: [],
      headId: null,
      queuedMessages: [],
    });
    expect(JSON.parse(fork!.threadData).resumeState).toBeUndefined();
    expect(fork!.messageCount).toBe(0);
  });
  it("uses the canonical exclusive prefix when legacy ordering disagrees", async () => {
    const data = fixture();
    const legacy = [data.agentKit.messages[1]!, data.agentKit.messages[0]!].map(
      (message) => ({ message, parentId: null }),
    );
    state.rows.get("source")!.thread_data = JSON.stringify({
      ...data,
      messages: legacy,
    });
    const fork = await forkThread("source", "qa@example.com", {
      id: "canonical",
      source: {
        threadData: String(state.rows.get("source")!.thread_data),
        beforeMessageId: "user-first",
      },
    });
    const saved = JSON.parse(fork!.threadData);
    expect(saved.messages).toEqual([]);
    expect(saved.headId).toBeNull();
    expect(saved.agentKit.messages).toEqual([]);
    expect(saved.agentKit.toolCalls).toEqual([]);
    expect(saved.agentKit.widgets).toEqual([]);
    expect(saved.agentKit.runs).toEqual([]);
  });

  it("retains only prefix-derived projections and drops later checkpoints and pending decisions", async () => {
    const data = fixture();
    const projections = Object.fromEntries(
      [
        "activities",
        "tasks",
        "taskGroups",
        "agents",
        "interactions",
        "artifacts",
      ].map((key) => [
        key,
        [
          { id: "kept", runId: "run-1" },
          { id: "excluded", runId: "run-3" },
          { id: "unscoped" },
        ],
      ]),
    );
    state.rows.get("source")!.thread_data = JSON.stringify({
      ...data,
      agentKit: {
        ...data.agentKit,
        ...projections,
        checkpoint: { id: "late", sequenceByRun: { "run-1": 1, "run-3": 1 } },
        approvals: [{ id: "late" }],
        connectionRequests: [{ id: "late" }],
      },
    });
    const fork = await forkThread("source", "qa@example.com", {
      id: "derived",
      source: {
        threadData: JSON.stringify(data),
        beforeMessageId: "user-middle",
      },
    });
    const saved = JSON.parse(fork!.threadData).agentKit;
    for (const key of Object.keys(projections))
      expect(saved[key]).toEqual([{ id: "kept", runId: "run-1" }]);
    expect(saved.checkpoint).toBeUndefined();
    expect(saved.approvals).toEqual([]);
    expect(saved.connectionRequests).toEqual([]);
  });
  it("retains aliased root message identities and physical head for a canonical prefix", async () => {
    const data = fixture();
    const root = [
      {
        message: {
          id: "server-user-run-1",
          role: "user",
          content: [{ type: "text", text: "First" }],
          metadata: {
            custom: {
              submittedRunId: "run-1",
              agentKitMessageId: "user-first",
            },
          },
        },
        parentId: null,
      },
      {
        message: {
          id: "answer-first",
          role: "assistant",
          content: [{ type: "text", text: "First answer" }],
        },
        parentId: "server-user-run-1",
      },
      {
        message: {
          id: "server-user-run-3",
          role: "user",
          content: [{ type: "text", text: "Later" }],
          metadata: {
            custom: {
              submittedRunId: "run-3",
              agentKitMessageId: "user-middle",
            },
          },
        },
        parentId: "answer-first",
      },
    ];
    state.rows.get("source")!.thread_data = JSON.stringify({
      ...data,
      messages: root,
      headId: "server-user-run-3",
    });
    const fork = await forkThread("source", "qa@example.com", {
      id: "aliased",
      source: {
        threadData: JSON.stringify(data),
        beforeMessageId: "user-middle",
      },
    });
    const saved = JSON.parse(fork!.threadData);
    expect(
      saved.messages.map(
        (entry: { message: { id: string } }) => entry.message.id,
      ),
    ).toEqual(["server-user-run-1", "answer-first"]);
    expect(saved.headId).toBe("answer-first");
    expect(
      saved.agentKit.messages.map((entry: { id: string }) => entry.id),
    ).toEqual(["user-first", "answer-first"]);
    expect(fork!.messageCount).toBe(2);
  });
  it("preserves full and inclusive continuation state and queued messages", async () => {
    for (const boundary of [undefined, "answer-first"]) {
      const fork = await forkThread("source", "qa@example.com", {
        id: boundary ?? "full-compatible",
        ...(boundary
          ? { source: sourceSnapshot({ fromMessageId: boundary }) }
          : {}),
      });
      const saved = JSON.parse(fork!.threadData);
      expect(saved.resumeState).toEqual({ answer: "late-state" });
      expect(saved.agentKit.resumeState).toEqual({ answer: "late-state" });
      expect(saved.queuedMessages).toEqual([
        { id: "late-queued", text: "Later queued prompt" },
      ]);
    }
  });
  it("clears excluded steered-message journals for exclusive forks only", async () => {
    const data = fixture();
    const journal = [
      {
        runId: "run-3",
        message: { id: "steered-later", text: "Excluded prompt" },
        continuationMessageId: "answer-middle",
      },
    ];
    state.rows.get("source")!.thread_data = JSON.stringify({
      ...data,
      _steeredQueuedMessages: journal,
    });
    const fork = await forkThread("source", "qa@example.com", {
      id: "no-steers",
      source: sourceSnapshot({ beforeMessageId: "user-first" }),
    });
    expect(JSON.parse(fork!.threadData)._steeredQueuedMessages).toBeUndefined();
    const full = await forkThread("source", "qa@example.com", {
      id: "with-steers",
    });
    expect(JSON.parse(full!.threadData)._steeredQueuedMessages).toEqual(
      journal,
    );
  });
  it("reconstructs protocol-valid prefix participants interactions and run-less artifacts from retained events", async () => {
    const data = fixture();
    const keptAgent = {
      id: "agent-prefix",
      name: "Researcher",
      status: "completed",
    };
    const laterAgent = {
      id: "agent-later",
      name: "Later agent",
      status: "completed",
    };
    const keptInteraction = {
      id: "interaction-prefix",
      kind: "started",
      agentId: "agent-prefix",
    };
    const laterInteraction = {
      id: "interaction-later",
      kind: "started",
      agentId: "agent-later",
    };
    const keptArtifact = {
      id: "artifact-prefix",
      kind: "report",
      title: "Prefix report",
    };
    const laterArtifact = {
      id: "artifact-later",
      kind: "report",
      title: "Later report",
    };
    const eventGroups = [
      [
        "run-1",
        keptAgent,
        keptInteraction,
        keptArtifact,
        data.agentKit.messages[1],
      ],
      [
        "run-3",
        laterAgent,
        laterInteraction,
        laterArtifact,
        data.agentKit.messages[3],
      ],
    ];
    const events = eventGroups.flatMap(
      ([runId, agent, interaction, artifact, message]) =>
        [
          { type: "agent.registered", agent },
          { type: "agent.interaction", interaction },
          { type: "artifact.created", artifact },
          { type: "message.completed", message },
        ].map((payload, index) => ({
          ...payload,
          id: String(runId) + "-" + index,
          runId,
          threadId: "source",
          sequence: index + 1,
          occurredAt: "2026-11-07T00:00:00.000Z",
        })),
    );
    for (const event of events) parseAgentEvent(event);
    state.rows.get("source")!.thread_data = JSON.stringify({
      ...data,
      agentKit: {
        ...data.agentKit,
        events,
        runs: data.agentKit.runs.map((run) => ({ ...run, lastSequence: 4 })),
        agents: [
          { ...keptAgent, name: "Later renamed researcher" },
          laterAgent,
        ],
        interactions: [keptInteraction, laterInteraction],
        artifacts: [
          { ...keptArtifact, title: "Later changed report" },
          laterArtifact,
        ],
      },
    });
    const fork = await forkThread("source", "qa@example.com", {
      id: "events-prefix",
      source: sourceSnapshot({ beforeMessageId: "user-middle" }),
    });
    const saved = JSON.parse(fork!.threadData).agentKit;
    expect(saved.agents).toEqual([keptAgent]);
    expect(saved.interactions).toEqual([keptInteraction]);
    expect(saved.artifacts).toEqual([keptArtifact]);
  });
});
