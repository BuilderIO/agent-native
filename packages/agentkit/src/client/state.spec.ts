import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../protocol/index.js";
import {
  classifyAgentEvent,
  createAgentThreadState,
  reduceAgentEvent,
  selectActiveAgentRoster,
} from "./state.js";

const occurredAt = "2026-08-29T00:00:00.000Z";

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
});
