import { describe, expect, it } from "vitest";

import {
  AGENTKIT_PROTOCOL_VERSION,
  AgentProtocolValidationError,
  createAgentProtocolEnvelope,
  isAgentEvent,
  parseAgentCapabilities,
  parseAgentApprovalResponse,
  parseAgentConnectionRequest,
  parseAgentConnectionResponse,
  parseAgentEvent,
  parseAgentEventSequence,
  parseAgentProtocolEnvelope,
  parseInvokeActionInput,
  parseQueueMessageInput,
  parseResolveApprovalInput,
  parseAgentThreadSnapshot,
  parseStartRunInput,
} from "./index.js";

const event = {
  id: "event-1",
  threadId: "thread-1",
  runId: "run-1",
  sequence: 1,
  occurredAt: "2026-08-29T00:00:00.000Z",
  type: "tool.delta",
  toolCallId: "tool-1",
  outputTextDelta: "12 passed",
} as const;

describe("AgentKit protocol validation", () => {
  it("requires an explicit provider-neutral approval decision", () => {
    expect(
      parseAgentApprovalResponse({
        decision: "deny",
        optionIds: ["stop"],
      }),
    ).toEqual({ decision: "deny", optionIds: ["stop"] });
    expect(() =>
      parseAgentApprovalResponse({ optionIds: ["approve"] }),
    ).toThrow("approvalResponse.decision");
    expect(() =>
      parseResolveApprovalInput({
        threadId: "thread-1",
        runId: "run-1",
        approvalId: "approval-1",
      }),
    ).toThrow("resolveApproval.response");
  });

  it("keeps custom choice responses distinct from predefined option ids", () => {
    expect(
      parseAgentApprovalResponse({
        decision: "approve",
        optionIds: ["brief"],
        other: "Include a decision table",
      }),
    ).toEqual({
      decision: "approve",
      optionIds: ["brief"],
      other: "Include a decision table",
    });
    expect(() =>
      parseAgentApprovalResponse({ decision: "approve", other: "" }),
    ).toThrow("approvalResponse.other");
  });

  it("accepts typed connection requests without accepting agent-authored authority", () => {
    expect(
      parseAgentConnectionRequest({
        id: "connection-1",
        provider: "slack",
        reason: "grant",
        status: "requested",
        appId: "dispatch",
      }),
    ).toMatchObject({ provider: "slack", reason: "grant" });
    expect(
      parseAgentConnectionResponse({
        status: "connected",
        connectionId: "workspace-connection-1",
      }),
    ).toMatchObject({ status: "connected" });
    expect(() =>
      parseAgentConnectionRequest({
        id: "connection-1",
        provider: "slack",
        reason: "connect",
        status: "requested",
        url: "https://agent-authored.example/connect",
      }),
    ).toThrow("connectionRequest.url");
    expect(() =>
      parseAgentConnectionRequest({
        id: "connection-1",
        provider: "slack",
        reason: "connect",
        status: "requested",
        scopes: ["admin"],
      }),
    ).toThrow("connectionRequest.scopes");
  });

  it("rejects a replay sequence gap before returning a cursor-safe batch", () => {
    const replay = [
      event,
      { ...event, id: "event-2", sequence: 2, type: "run.completed" },
    ];
    expect(
      parseAgentEventSequence(replay, {
        threadId: "thread-1",
        runId: "run-1",
      }),
    ).toEqual(replay);
    expect(() =>
      parseAgentEventSequence([{ ...event, id: "event-3", sequence: 3 }], {
        afterSequence: 1,
      }),
    ).toThrow("must be contiguous; expected 2");
  });

  it("accepts versioned envelopes and first-class lifecycle events", () => {
    const envelope = createAgentProtocolEnvelope("event", event, "request-1");

    expect(
      parseAgentProtocolEnvelope(envelope, (payload, path) =>
        parseAgentEvent(payload, path),
      ),
    ).toEqual(envelope);
    expect(isAgentEvent(event)).toBe(true);
  });

  it("validates delegable task lifecycle events", () => {
    expect(
      parseAgentEvent({
        ...event,
        type: "task.updated",
        task: {
          id: "task-1",
          title: "Verify dashboard",
          status: "running",
          progress: { completed: 1, total: 3 },
        },
      }),
    ).toMatchObject({ type: "task.updated" });
    expect(() =>
      parseAgentEvent({
        ...event,
        type: "task.updated",
        task: {
          id: "task-1",
          title: "Verify dashboard",
          status: "running",
          progress: { completed: 4, total: 3 },
        },
      }),
    ).toThrow("completed no greater than total");
  });

  it("validates task-group, annotation, and widget lifecycle events", () => {
    expect(
      parseAgentEvent({
        ...event,
        type: "task-group.completed",
        taskGroup: {
          id: "group-1",
          title: "Release review",
          status: "completed",
          runId: "run-1",
          taskIds: ["task-1", "task-2"],
          source: { id: "plan-1", kind: "plan", label: "Release plan" },
        },
      }),
    ).toMatchObject({ type: "task-group.completed" });
    expect(
      parseAgentEvent({
        ...event,
        type: "annotation.updated",
        annotation: {
          id: "annotation-1",
          kind: "source",
          label: "Updated source",
        },
      }),
    ).toMatchObject({ type: "annotation.updated" });
    expect(
      parseAgentEvent({
        ...event,
        type: "annotation.removed",
        annotationId: "annotation-1",
      }),
    ).toMatchObject({ type: "annotation.removed" });
    expect(
      parseAgentEvent({
        ...event,
        type: "widget.removed",
        widgetId: "widget-1",
      }),
    ).toMatchObject({ type: "widget.removed" });
    expect(() =>
      parseAgentEvent({
        ...event,
        type: "task-group.updated",
        taskGroup: {
          id: "group-1",
          status: "running",
          taskIds: ["task-1", "task-1"],
        },
      }),
    ).toThrow("must be unique within the task group");
  });

  it("validates multi-agent identity, lifecycle, and off-surface activity", () => {
    expect(
      parseAgentEvent({
        ...event,
        type: "agent.registered",
        agent: {
          id: "agent-planck",
          name: "Planck",
          kind: "subagent",
          status: "working",
          origin: {
            id: "app-dispatch",
            kind: "app",
            label: "Dispatch",
            uri: "/dispatch",
          },
        },
      }),
    ).toMatchObject({ type: "agent.registered" });
    expect(
      parseAgentEvent({
        ...event,
        type: "agent.interaction",
        interaction: {
          id: "interaction-1",
          kind: "delegated",
          agentId: "agent-primary",
          targetAgentId: "agent-planck",
          scope: "workspace",
          object: {
            id: "task-release",
            kind: "task",
            label: "Release review",
          },
        },
      }),
    ).toMatchObject({ type: "agent.interaction" });
    expect(
      parseAgentEvent({
        ...event,
        type: "activity.started",
        activity: {
          id: "activity-1",
          kind: "read",
          label: "Read framework contracts",
          status: "running",
          agentId: "agent-planck",
          scope: "external",
          source: {
            id: "app-agent-native",
            kind: "app",
            label: "Agent-Native",
          },
        },
      }),
    ).toMatchObject({ type: "activity.started" });

    expect(() =>
      parseAgentEvent({
        ...event,
        type: "agent.updated",
        agent: { id: "agent-planck", name: "Planck", status: "busy" },
      }),
    ).toThrow("unsupported participant status");
    expect(() =>
      parseAgentEvent({
        ...event,
        type: "agent.interaction",
        interaction: {
          id: "interaction-1",
          kind: "started",
          agentId: "agent-planck",
          scope: "somewhere",
        },
      }),
    ).toThrow("unsupported work scope");
  });

  it("fails loudly for incompatible protocol versions", () => {
    expect(() =>
      parseAgentProtocolEnvelope({
        protocol: "agentkit",
        version: AGENTKIT_PROTOCOL_VERSION + 1,
        kind: "event",
        payload: event,
      }),
    ).toThrow(AgentProtocolValidationError);
  });

  it("validates run inputs at a transport boundary", () => {
    expect(
      parseStartRunInput({
        threadId: "thread-1",
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "Inspect the workspace" }],
          },
        ],
        options: { model: "frontier", reasoningEffort: "high" },
      }).threadId,
    ).toBe("thread-1");
  });

  it("rejects malformed standard capabilities while preserving extensions", () => {
    expect(
      parseAgentCapabilities({
        protocolVersion: AGENTKIT_PROTOCOL_VERSION,
        feedback: true,
        multiAgentActivity: true,
        widgets: true,
        "x-host-preview": { version: 2 },
      }),
    ).toMatchObject({ feedback: true, widgets: true });
    expect(() => parseAgentCapabilities({ widgets: "yes" })).toThrow(
      AgentProtocolValidationError,
    );
    expect(() => parseAgentCapabilities({ widgtes: true })).toThrow(
      "unknown capabilities must use an x- namespace",
    );
  });

  it("validates queue and action commands before they reach a backend", () => {
    expect(
      parseQueueMessageInput({
        threadId: "thread-1",
        text: "Run checks",
        attachments: [{ type: "file", name: "brief.md", fileId: "file-1" }],
      }).text,
    ).toBe("Run checks");
    expect(
      parseInvokeActionInput({
        invocation: {
          id: "action-1",
          action: "dashboard.publish",
          threadId: "thread-1",
        },
      }).invocation.action,
    ).toBe("dashboard.publish");
    expect(() =>
      parseQueueMessageInput({ threadId: "thread-1", text: 42 }),
    ).toThrow(AgentProtocolValidationError);
  });

  it("validates rich snapshots as one internally consistent projection", () => {
    const snapshot = {
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      messages: [],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 1,
        },
      ],
      activeRunIds: ["run-1"],
      events: [{ ...event, type: "run.started" }],
      taskGroups: [
        {
          id: "group-1",
          title: "Release review",
          status: "running",
          taskIds: ["task-1"],
        },
      ],
    };

    expect(parseAgentThreadSnapshot(snapshot)).toMatchObject({
      activeRunIds: ["run-1"],
    });
    expect(() =>
      parseAgentThreadSnapshot({
        ...snapshot,
        activeRunIds: ["run-missing"],
      }),
    ).toThrow("must reference a run included in the snapshot");
    expect(() =>
      parseAgentThreadSnapshot({
        ...snapshot,
        events: [event, { ...event, id: "event-2", sequence: 1 }],
      }),
    ).toThrow("must be contiguous within each run");
    expect(() =>
      parseAgentThreadSnapshot({
        ...snapshot,
        events: [event, { ...event, id: "event-2", sequence: 3 }],
      }),
    ).toThrow("expected 2");
    expect(() =>
      parseAgentThreadSnapshot({
        ...snapshot,
        runs: [{ ...snapshot.runs[0], threadId: "thread-2" }],
      }),
    ).toThrow("must match the snapshot thread");
  });
});
