import type { AgentEvent } from "@agent-native/agentkit-protocol";
import { describe, expect, it } from "vitest";

import {
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

describe("AgentKit lifecycle projections", () => {
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
