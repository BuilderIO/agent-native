import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../protocol/index.js";
import {
  classifyAgentEvent,
  createAgentThreadState,
  hasActiveAgentRuns,
  reduceAgentEvent,
  retireSupersededConnectionRequests,
  selectActiveAgentRoster,
} from "./state.js";

const occurredAt = "2026-08-29T00:00:00.000Z";

describe("hasActiveAgentRuns", () => {
  it("keeps an unprojected approval active until a run status resolves it", () => {
    const thread = createAgentThreadState("thread-1");
    thread.activeRunIds = ["run-1"];
    thread.runs["run-1"] = {
      id: "run-1",
      status: "awaiting_approval",
      lastSequence: 1,
    };

    expect(hasActiveAgentRuns(thread)).toBe(true);

    thread.runs["run-1"].status = "completed";
    expect(hasActiveAgentRuns(thread)).toBe(false);
  });

  it("matches approval resolution by ID across continuation event ordering", () => {
    const thread = createAgentThreadState("thread-1");
    thread.activeRunIds = ["run-1"];
    thread.runs["run-1"] = {
      id: "run-1",
      status: "awaiting_approval",
      lastSequence: 1,
    };
    const resolved = {
      ...event(2, {
        type: "approval.resolved",
        approvalId: "approval-1",
        response: { decision: "approve" },
      }),
      id: "event-continuation-resolution",
      runId: "run-continuation",
    };
    const requested = event(1, {
      type: "approval.requested",
      request: { id: "approval-1", title: "Continue?" },
    });
    thread.events = [requested];

    expect(hasActiveAgentRuns(thread)).toBe(true);
    thread.events = [resolved, requested];
    expect(hasActiveAgentRuns(thread)).toBe(false);
  });

  it("treats an active id with a missing run projection as active", () => {
    const thread = createAgentThreadState("thread-1");
    thread.activeRunIds = ["run-unprojected"];

    expect(hasActiveAgentRuns(thread)).toBe(true);
  });

  it("restores a pending approval run when its active-id projection is missing", () => {
    const started = reduceAgentEvent(
      createAgentThreadState("thread-1"),
      event(1, { type: "run.started" }),
    );
    const withoutActiveId = { ...started, activeRunIds: [] };
    const awaitingApproval = reduceAgentEvent(
      withoutActiveId,
      event(2, {
        type: "approval.requested",
        request: { id: "approval-1", title: "Continue?" },
      }),
    );

    expect(awaitingApproval.activeRunIds).toEqual(["run-1"]);
    expect(hasActiveAgentRuns(awaitingApproval)).toBe(true);
  });
});

function event(
  sequence: number,
  payload: Omit<
    AgentEvent,
    "id" | "threadId" | "runId" | "sequence" | "occurredAt"
  >,
): AgentEvent {
  return {
    id: `event-${sequence}`,
    threadId: "thread-1",
    runId: "run-1",
    sequence,
    occurredAt,
    ...payload,
  } as AgentEvent;
}

describe("classifyAgentEvent", () => {
  const started = reduceAgentEvent(
    createAgentThreadState("thread-1"),
    event(1, { type: "run.started" }),
  );

  it("accepts the next contiguous sequence", () => {
    expect(
      classifyAgentEvent(started, event(2, { type: "run.completed" })),
    ).toEqual({ status: "accepted", sequence: 2 });
  });

  it("names a replayed sequence so the caller can count it", () => {
    expect(
      classifyAgentEvent(started, event(1, { type: "run.started" })),
    ).toEqual({ status: "duplicate", lastSequence: 1 });
  });

  it("names a gap with both sequences so the caller can count it", () => {
    expect(
      classifyAgentEvent(started, event(5, { type: "run.completed" })),
    ).toEqual({ status: "gap", expectedSequence: 2, receivedSequence: 5 });
  });

  it("ignores an event addressed to a different thread", () => {
    expect(
      classifyAgentEvent(
        createAgentThreadState("other"),
        event(1, {
          type: "run.started",
        }),
      ),
    ).toEqual({ status: "foreign" });
  });

  it("agrees with the reducer it backs", () => {
    expect(reduceAgentEvent(started, event(1, { type: "run.started" }))).toBe(
      started,
    );
    expect(() =>
      reduceAgentEvent(started, event(5, { type: "run.completed" })),
    ).toThrow(/must be contiguous; expected 2 after 1, received 5/u);
  });
});

describe("AgentKit lifecycle projections", () => {
  it("keeps deltas when lifecycle markers arrive late", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "reasoning.delta",
        messageId: "assistant-1",
        text: "Thinking first",
      }),
      event(3, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      }),
      event(4, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Answer",
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.messages).toEqual([
      expect.objectContaining({
        id: "assistant-1",
        status: "streaming",
        parts: [
          { type: "reasoning", text: "Thinking first", visibility: "summary" },
          { type: "text", text: "Answer" },
        ],
      }),
    ]);
  });

  it("retains tool deltas even when the start marker is missing", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "tool.delta",
        toolCallId: "tool-1",
        inputTextDelta: '{"query":"agentkit"}',
        outputTextDelta: "result",
        metadata: { toolName: "search" },
      }),
      event(3, { type: "run.completed" }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.tools["tool-1"]).toMatchObject({
      id: "tool-1",
      name: "search",
      input: '{"query":"agentkit"}',
      output: "result",
      status: "completed",
    });
  });

  it("settles incomplete run work from an authoritative terminal event", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [{ type: "text", text: "Partial response" }],
        },
      }),
      event(3, {
        type: "activity.started",
        activity: {
          id: "activity-1",
          kind: "tool",
          label: "Search workspace",
          status: "running",
        },
      }),
      event(4, {
        type: "tool.started",
        toolCall: { id: "tool-1", name: "Search", status: "running" },
      }),
      event(5, {
        type: "task.created",
        task: { id: "task-1", title: "Search", status: "running" },
      }),
      event(6, { type: "run.completed" }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.runs["run-1"]?.status).toBe("completed");
    expect(reduced.activeRunIds).toEqual([]);
    expect(reduced.messages[0]?.status).toBe("complete");
    expect(reduced.activities["activity-1"]?.status).toBe("completed");
    expect(reduced.tools["tool-1"]?.status).toBe("completed");
    expect(reduced.tasks["task-1"]?.status).toBe("completed");
  });

  it("ignores late work after a terminal lifecycle event", () => {
    const terminal = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [{ type: "text", text: "Done" }],
        },
      }),
      event(3, { type: "run.status", status: "completed" }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    const late = reduceAgentEvent(
      terminal,
      event(4, { type: "message.delta", messageId: "assistant-1", text: "!" }),
    );

    expect(late).toBe(terminal);
    expect(late.messages[0]).toMatchObject({
      status: "complete",
      parts: [{ type: "text", text: "Done" }],
    });
  });

  it("does not mutate a completed message with late lifecycle work", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      }),
      event(3, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Answer",
      }),
      event(4, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          parts: [],
        },
      }),
      event(5, {
        type: "message.delta",
        messageId: "assistant-1",
        text: " should be ignored",
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.messages).toEqual([
      expect.objectContaining({
        status: "complete",
        parts: [{ type: "text", text: "Answer" }],
      }),
    ]);
  });

  it("defaults empty completion status and preserves deltas", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      }),
      event(3, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Answer",
      }),
      event(4, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [],
        },
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.messages[0]).toMatchObject({
      status: "complete",
      parts: [{ type: "text", text: "Answer" }],
    });
  });

  it("preserves a failed synthetic completion status while retaining deltas", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      }),
      event(3, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Partial response",
      }),
      event(4, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "error",
          parts: [],
        },
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.messages).toEqual([
      expect.objectContaining({
        status: "error",
        parts: [{ type: "text", text: "Partial response" }],
      }),
    ]);
  });

  it("ignores late tool deltas after a tool reaches a terminal status", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "tool.updated",
        toolCall: {
          id: "tool-1",
          name: "Search",
          status: "completed",
          output: "final result",
        },
      }),
      event(3, {
        type: "tool.delta",
        toolCallId: "tool-1",
        inputTextDelta: "late input",
        outputTextDelta: "late output",
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.tools["tool-1"]).toMatchObject({
      status: "completed",
      output: "final result",
    });
    expect(reduced.tools["tool-1"]?.input).toBeUndefined();
  });

  it("preserves the message association when a terminal tool update omits it", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "tool.started",
        toolCall: {
          id: "tool-1",
          name: "Search",
          status: "running",
          messageId: "assistant-1",
          input: { query: "report" },
        },
      }),
      event(3, {
        type: "tool.updated",
        toolCall: {
          id: "tool-1",
          name: "Search",
          status: "completed",
          output: "Found it.",
        },
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.tools["tool-1"]).toMatchObject({
      status: "completed",
      messageId: "assistant-1",
      input: { query: "report" },
      output: "Found it.",
    });
  });

  it("preserves streamed output when a terminal tool update omits it", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "tool.delta",
        toolCallId: "tool-1",
        outputTextDelta: "Found ",
      }),
      event(3, {
        type: "tool.delta",
        toolCallId: "tool-1",
        outputTextDelta: "it.",
      }),
      event(4, {
        type: "tool.updated",
        toolCall: {
          id: "tool-1",
          name: "Search",
          status: "completed",
        },
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.tools["tool-1"]).toMatchObject({
      status: "completed",
      output: "Found it.",
    });
  });

  it("preserves streamed output when a running tool update omits it", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "tool.delta",
        toolCallId: "tool-1",
        outputTextDelta: "Found ",
      }),
      event(3, {
        type: "tool.updated",
        toolCall: {
          id: "tool-1",
          name: "Search",
          status: "running",
        },
      }),
      event(4, {
        type: "tool.delta",
        toolCallId: "tool-1",
        outputTextDelta: "it.",
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.tools["tool-1"]).toMatchObject({
      status: "running",
      output: "Found it.",
    });
  });

  it("uses the output provided by a terminal tool update", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "tool.delta",
        toolCallId: "tool-1",
        outputTextDelta: "partial output",
      }),
      event(3, {
        type: "tool.updated",
        toolCall: {
          id: "tool-1",
          name: "Search",
          status: "completed",
          output: "final output",
        },
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.tools["tool-1"]).toMatchObject({
      status: "completed",
      output: "final output",
    });
  });

  it("does not reopen settled tool, activity, task, or action projections", () => {
    const reduced = [
      event(1, { type: "run.started" }),
      event(2, {
        type: "activity.completed",
        activity: {
          id: "activity-1",
          kind: "tool",
          label: "Search",
          status: "completed",
        },
      }),
      event(3, {
        type: "activity.updated",
        activity: {
          id: "activity-1",
          kind: "tool",
          label: "Search",
          status: "running",
        },
      }),
      event(4, {
        type: "tool.updated",
        toolCall: { id: "tool-1", name: "Search", status: "completed" },
      }),
      event(5, {
        type: "tool.started",
        toolCall: { id: "tool-1", name: "Search", status: "running" },
      }),
      event(6, {
        type: "task.completed",
        task: { id: "task-1", title: "Search", status: "completed" },
      }),
      event(7, {
        type: "task.updated",
        task: { id: "task-1", title: "Search", status: "running" },
      }),
      event(8, {
        type: "action.started",
        invocation: {
          id: "action-1",
          action: "search",
          threadId: "thread-1",
          runId: "run-1",
        },
      }),
      event(9, {
        type: "action.completed",
        result: { invocationId: "action-1", status: "completed" },
      }),
      event(10, {
        type: "action.started",
        invocation: {
          id: "action-1",
          action: "search",
          threadId: "thread-1",
          runId: "run-1",
        },
      }),
    ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));

    expect(reduced.activities["activity-1"]?.status).toBe("completed");
    expect(reduced.tools["tool-1"]?.status).toBe("completed");
    expect(reduced.tasks["task-1"]?.status).toBe("completed");
    expect(reduced.actions["action-1"]).toMatchObject({
      result: { status: "completed" },
    });
  });

  it("rejects sequence gaps without advancing the run projection", () => {
    const initial = reduceAgentEvent(
      createAgentThreadState("thread-1"),
      event(1, { type: "run.started" }),
    );

    expect(() =>
      reduceAgentEvent(initial, event(3, { type: "run.completed" })),
    ).toThrow("expected 2 after 1, received 3");
    expect(initial.runs["run-1"]?.lastSequence).toBe(1);
    expect(initial.events.map((item) => item.sequence)).toEqual([1]);
  });

  it("removes unregistered agents from the live roster without losing attribution", () => {
    const registered = reduceAgentEvent(
      createAgentThreadState("thread-1"),
      event(1, {
        type: "agent.registered",
        agent: {
          id: "agent-1",
          name: "Planner",
          status: "working",
        },
      }),
    );
    const unregistered = reduceAgentEvent(
      registered,
      event(2, {
        type: "agent.unregistered",
        agent: {
          id: "agent-1",
          name: "Planner",
          status: "completed",
        },
      }),
    );

    expect(unregistered.agents["agent-1"]).toMatchObject({
      id: "agent-1",
      name: "Planner",
      status: "closed",
      completedAt: occurredAt,
    });
    expect(selectActiveAgentRoster(unregistered.agents)).toEqual([]);
  });

  it("replays task-group lifecycle events idempotently", () => {
    const events = [
      event(1, {
        type: "task-group.created",
        taskGroup: {
          id: "group-1",
          title: "Release",
          status: "running",
          taskIds: ["task-1"],
        },
      }),
      event(2, {
        type: "task-group.completed",
        taskGroup: {
          id: "group-1",
          title: "Release",
          status: "completed",
          taskIds: ["task-1", "task-2"],
        },
      }),
    ];
    const reduced = events.reduce(
      reduceAgentEvent,
      createAgentThreadState("thread-1"),
    );
    const replayed = events.reduce(reduceAgentEvent, reduced);

    expect(replayed).toBe(reduced);
    expect(reduced.taskGroups["group-1"]).toMatchObject({
      status: "completed",
      taskIds: ["task-1", "task-2"],
    });

    const removed = reduceAgentEvent(
      reduced,
      event(3, { type: "task-group.removed", taskGroupId: "group-1" }),
    );
    expect(removed.taskGroups).toEqual({});
  });

  it("updates and removes annotations and widgets without stale ownership", () => {
    const events = [
      event(1, {
        type: "annotation.created",
        messageId: "message-1",
        annotation: { id: "annotation-1", kind: "source", label: "Draft" },
      }),
      event(2, {
        type: "annotation.updated",
        annotation: { id: "annotation-1", kind: "source", label: "Final" },
      }),
      event(3, {
        type: "widget.created",
        messageId: "message-1",
        widget: { id: "widget-1", kind: "status", data: { ready: false } },
      }),
      event(4, {
        type: "widget.updated",
        messageId: "message-2",
        widget: { id: "widget-1", kind: "status", data: { ready: true } },
      }),
    ];
    const reduced = events.reduce(
      reduceAgentEvent,
      createAgentThreadState("thread-1"),
    );

    expect(reduced.annotations["annotation-1"]?.label).toBe("Final");
    expect(reduced.annotationMessageIds["annotation-1"]).toBe("message-1");
    expect(reduced.widgets["widget-1"]?.data).toEqual({ ready: true });
    expect(reduced.widgetMessageIds["widget-1"]).toBe("message-2");

    const withoutAnnotation = reduceAgentEvent(
      reduced,
      event(5, { type: "annotation.removed", annotationId: "annotation-1" }),
    );
    const cleared = reduceAgentEvent(
      withoutAnnotation,
      event(6, { type: "widget.removed", widgetId: "widget-1" }),
    );
    expect(cleared.annotations).toEqual({});
    expect(cleared.annotationMessageIds).toEqual({});
    expect(cleared.widgets).toEqual({});
    expect(cleared.widgetMessageIds).toEqual({});
  });

  it("preserves the connection request lifecycle with its owning run", () => {
    const requested = reduceAgentEvent(
      createAgentThreadState("thread-1"),
      event(1, {
        type: "connection.requested",
        request: {
          id: "connection-1",
          provider: "slack",
          reason: "connect",
          status: "requested",
        },
      }),
    );
    const connected = reduceAgentEvent(
      requested,
      event(2, {
        type: "connection.updated",
        request: {
          ...requested.connectionRequests["connection-1"]!,
          status: "connected",
        },
      }),
    );

    expect(connected.connectionRequests["connection-1"]?.status).toBe(
      "connected",
    );
    expect(connected.connectionRequestRunIds["connection-1"]).toBe("run-1");
  });

  describe("retiring connection requests nobody can answer any more", () => {
    const request = (
      id: string,
      status: "requested" | "connecting" | "connected",
    ) =>
      ({
        type: "connection.requested",
        request: { id, provider: "slack", reason: "connect", status },
      }) as const;

    function awaitingConnection() {
      return [
        event(1, { type: "run.started" }),
        event(2, request("open", "requested")),
        event(3, request("connecting", "connecting")),
        event(4, request("answered", "connected")),
      ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));
    }

    it.each([
      [
        "run.failed",
        { type: "run.failed", error: { code: "x", message: "x" } },
      ],
      ["run.cancelled", { type: "run.cancelled" }],
      [
        "a terminal failed run.status",
        { type: "run.status", status: "failed" },
      ],
    ] as const)(
      "drops the still-open requests of a run that ends on %s",
      (_name, terminal) => {
        const ended = reduceAgentEvent(
          awaitingConnection(),
          event(5, terminal),
        );

        expect(Object.keys(ended.connectionRequests)).toEqual(["answered"]);
        expect(Object.keys(ended.connectionRequestRunIds)).toEqual([
          "answered",
        ]);
      },
    );

    it("keeps a completed run's request: the yielded turn is waiting on the user", () => {
      const completed = reduceAgentEvent(
        awaitingConnection(),
        event(5, { type: "run.completed" }),
      );

      expect(Object.keys(completed.connectionRequests).sort()).toEqual([
        "answered",
        "connecting",
        "open",
      ]);
    });

    it("drops the older run's open request when a newer run starts in the thread", () => {
      const next = reduceAgentEvent(
        reduceAgentEvent(
          awaitingConnection(),
          event(5, { type: "run.completed" }),
        ),
        {
          ...event(1, { type: "run.started" }),
          id: "event-run-2-1",
          runId: "run-2",
        },
      );

      expect(Object.keys(next.connectionRequests)).toEqual(["answered"]);
      expect(Object.keys(next.connectionRequestRunIds)).toEqual(["answered"]);
    });

    it("leaves another run's request alone when a different run fails", () => {
      const withSecondRun = reduceAgentEvent(awaitingConnection(), {
        ...event(1, { type: "run.started" }),
        id: "event-run-2-1",
        runId: "run-2",
      });
      // run-2 starting already retired run-1's open requests; give run-2 its own.
      const requested = reduceAgentEvent(withSecondRun, {
        ...event(2, request("second", "requested")),
        id: "event-run-2-2",
        runId: "run-2",
      });
      const firstFailed = reduceAgentEvent(requested, {
        ...event(5, { type: "run.failed", error: { code: "x", message: "x" } }),
        id: "event-run-1-5",
        runId: "run-1",
      });

      expect(Object.keys(firstFailed.connectionRequests).sort()).toEqual([
        "answered",
        "second",
      ]);
    });
  });

  describe("retiring requests of runs a loaded snapshot shows as superseded", () => {
    // One open request per run, keyed by the run's startedAt string.
    function openRequestsAfterRetiring(startedAt: Record<string, string>) {
      const thread = createAgentThreadState("thread-1");
      for (const [runId, at] of Object.entries(startedAt)) {
        const id = `request-${runId}`;
        thread.runs[runId] = {
          id: runId,
          status: "completed",
          lastSequence: 1,
          startedAt: at,
        };
        thread.connectionRequests[id] = {
          id,
          provider: "slack",
          reason: "connect",
          status: "requested",
        };
        thread.connectionRequestRunIds[id] = runId;
      }
      return Object.keys(
        retireSupersededConnectionRequests(thread).connectionRequests,
      );
    }

    it("orders runs by instant, not by how their timestamps are spelled", () => {
      // "…:00.500Z" sorts before "…:00Z" as text but is the later instant.
      expect(
        openRequestsAfterRetiring({
          "run-1": "2026-08-29T00:00:00.500Z",
          "run-2": "2026-08-29T00:00:00Z",
        }),
      ).toEqual(["request-run-1"]);
    });

    it("does not retire either run when two spellings name the same instant", () => {
      expect(
        openRequestsAfterRetiring({
          "run-1": "2026-08-29T00:00:00.000Z",
          "run-2": "2026-08-29T00:00:00Z",
        }).sort(),
      ).toEqual(["request-run-1", "request-run-2"]);
    });

    it("honours a UTC offset", () => {
      // 01:00+02:00 is 23:00Z the day before, an hour older than run-2.
      expect(
        openRequestsAfterRetiring({
          "run-1": "2026-08-29T01:00:00+02:00",
          "run-2": "2026-08-29T00:00:00Z",
        }),
      ).toEqual(["request-run-2"]);
    });

    it("leaves a run with an unreadable start time alone and ignores it as the latest", () => {
      expect(
        openRequestsAfterRetiring({
          "run-1": "2026-08-29T00:00:00Z",
          "run-2": "not a timestamp",
        }),
      ).toEqual(["request-run-1", "request-run-2"]);
    });
  });
});
