import { EventSchemas, EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { decodeAgUiEvent, encodeAgentEvent } from "./agui-codec.js";
import {
  AGENTKIT_METADATA_KEY,
  AGENTKIT_NATIVE_EVENT_TYPES,
  AGENTKIT_PROFILE_EVENT_TYPES,
  approvalResponseFromResume,
  isProfileEventType,
  resumeEntryFromApproval,
  resumeOptionId,
} from "./agui.js";
import type { AgentEvent } from "./index.js";
import { AgentProtocolValidationError } from "./validation.js";

const THREAD_ID = "thread_1";
const RUN_ID = "run_1";
const CONTEXT = { threadId: THREAD_ID, runId: RUN_ID };

let nextSequence = 0;

function base(type: string) {
  nextSequence += 1;
  return {
    id: `evt_${nextSequence}`,
    type,
    threadId: THREAD_ID,
    runId: RUN_ID,
    sequence: nextSequence,
    occurredAt: "2026-09-09T12:00:00.000Z",
  };
}

const activity = {
  id: "activity_1",
  kind: "search" as const,
  label: "Searching",
  status: "running" as const,
};

const toolCall = {
  id: "tool_1",
  name: "search",
  status: "running" as const,
  messageId: "msg_1",
};

const participant = {
  id: "agent_1",
  name: "Researcher",
  status: "working" as const,
};

const task = { id: "task_1", title: "Draft", status: "running" as const };

const message = {
  id: "msg_1",
  role: "assistant" as const,
  parts: [{ type: "text" as const, text: "hello" }],
};

const taskGroup = { id: "group_1", taskIds: ["task_1"] };

/** One event per domain type, so a missed mapping fails rather than hides. */
function everyEventType(): AgentEvent[] {
  nextSequence = 0;
  return [
    { ...base("run.started"), agentId: "agent_1" },
    { ...base("run.status"), status: "running" },
    { ...base("agent.registered"), agent: participant },
    { ...base("agent.updated"), agent: participant },
    { ...base("agent.unregistered"), agent: participant },
    {
      ...base("agent.interaction"),
      interaction: { id: "int_1", kind: "handoff", agentId: "agent_1" },
    },
    { ...base("message.created"), message },
    { ...base("message.delta"), messageId: "msg_1", text: "hel" },
    { ...base("message.completed"), message },
    { ...base("reasoning.delta"), messageId: "msg_1", text: "thinking" },
    { ...base("tool.started"), toolCall },
    { ...base("tool.delta"), toolCallId: "tool_1", inputTextDelta: "{}" },
    { ...base("tool.updated"), toolCall: { ...toolCall, status: "completed" } },
    { ...base("activity.started"), activity },
    { ...base("activity.updated"), activity },
    { ...base("activity.completed"), activity },
    { ...base("task.created"), task },
    { ...base("task.updated"), task },
    { ...base("task.completed"), task },
    { ...base("task-group.created"), taskGroup },
    { ...base("task-group.updated"), taskGroup },
    { ...base("task-group.completed"), taskGroup },
    { ...base("task-group.removed"), taskGroupId: "group_1" },
    {
      ...base("approval.requested"),
      request: { id: "approval_1", title: "Delete the row?" },
    },
    {
      ...base("approval.resolved"),
      approvalId: "approval_1",
      response: { decision: "approve" },
    },
    {
      ...base("connection.requested"),
      request: {
        id: "conn_1",
        provider: "github",
        reason: "connect",
        status: "requested",
      },
    },
    {
      ...base("connection.updated"),
      request: {
        id: "conn_1",
        provider: "github",
        reason: "connect",
        status: "connected",
      },
    },
    {
      ...base("artifact.created"),
      artifact: { id: "artifact_1", kind: "file" },
    },
    {
      ...base("widget.created"),
      widget: { id: "widget_1", kind: "table", data: { rows: [] } },
    },
    {
      ...base("widget.updated"),
      widget: { id: "widget_1", kind: "table", data: { rows: [] } },
    },
    { ...base("widget.removed"), widgetId: "widget_1" },
    {
      ...base("annotation.created"),
      annotation: { id: "note_1", kind: "source", label: "Docs" },
    },
    {
      ...base("annotation.updated"),
      annotation: { id: "note_1", kind: "source", label: "Docs" },
    },
    { ...base("annotation.removed"), annotationId: "note_1" },
    {
      ...base("suggestions.updated"),
      suggestions: [{ id: "sug_1", label: "Keep going" }],
    },
    {
      ...base("action.started"),
      invocation: { id: "inv_1", action: "refresh", threadId: THREAD_ID },
    },
    {
      ...base("action.completed"),
      result: { invocationId: "inv_1", status: "completed" },
    },
    {
      ...base("action.failed"),
      result: {
        invocationId: "inv_1",
        status: "failed",
        error: { code: "boom", message: "failed" },
      },
    },
    {
      ...base("upload.progress"),
      progress: { uploadId: "upload_1", loaded: 1, total: 2 },
    },
    { ...base("client.effect"), name: "scroll" },
    { ...base("client.deeplink"), name: "open", data: { path: "/" } },
    {
      ...base("thread.updated"),
      thread: {
        id: THREAD_ID,
        createdAt: "2026-09-09T11:00:00.000Z",
        updatedAt: "2026-09-09T12:00:00.000Z",
      },
    },
    { ...base("queue.updated"), messages: [] },
    { ...base("run.completed"), usage: { totalTokens: 10 } },
    { ...base("run.failed"), error: { code: "internal", message: "exploded" } },
    { ...base("run.cancelled") },
    { ...base("x-builder.custom"), payload: { anything: true } },
  ] as AgentEvent[];
}

describe("AG-UI codec", () => {
  it("has a fixture for every mapped event type", () => {
    const encountered = new Set(everyEventType().map((event) => event.type));
    const mapped = [
      ...Object.keys(AGENTKIT_NATIVE_EVENT_TYPES),
      ...AGENTKIT_PROFILE_EVENT_TYPES,
    ];
    for (const type of mapped) {
      expect(encountered.has(type), `missing fixture for ${type}`).toBe(true);
    }
  });

  it("round-trips every domain event without loss", () => {
    for (const event of everyEventType()) {
      const decoded = decodeAgUiEvent(encodeAgentEvent(event), CONTEXT);
      expect(decoded, `${event.type} decoded to nothing`).toEqual(event);
    }
  });

  it("preserves formatting on message deltas", () => {
    const source = {
      ...base("message.delta"),
      messageId: "msg_1",
      text: "**hello**",
      format: "markdown",
    } as AgentEvent;

    expect(decodeAgUiEvent(encodeAgentEvent(source), CONTEXT)).toEqual(source);
  });

  it("projects tool-role messages onto valid AG-UI without losing the role", () => {
    const source = {
      ...base("message.created"),
      message: { ...message, role: "tool" },
    } as AgentEvent;
    const wire = encodeAgentEvent(source) as { role: string };

    expect(wire.role).toBe("assistant");
    expect(EventSchemas.safeParse(wire).success).toBe(true);
    expect(decodeAgUiEvent(wire, CONTEXT)).toEqual(source);
  });

  it("restores static typing for profile events carried over CUSTOM", () => {
    const source = everyEventType().find(
      (event) => event.type === "task-group.updated",
    )!;
    const wire = encodeAgentEvent(source) as { type: EventType; name: string };
    expect(wire.type).toBe(EventType.CUSTOM);
    expect(wire.name).toBe("builder.agentkit.v1/task-group.updated");

    const decoded = decodeAgUiEvent(wire, CONTEXT);
    if (decoded?.type !== "task-group.updated") {
      throw new Error("expected a task-group.updated event");
    }
    expect(decoded.taskGroup.taskIds).toEqual(["task_1"]);
  });

  it("emits frames a stock AG-UI client can parse", () => {
    for (const event of everyEventType()) {
      const parsed = EventSchemas.safeParse(encodeAgentEvent(event));
      expect(parsed.success, `${event.type} is not valid AG-UI`).toBe(true);
    }
  });

  it("keeps the Builder sequence and domain type on every frame", () => {
    for (const event of everyEventType()) {
      const wire = encodeAgentEvent(event) as {
        metadata: Record<string, { seq: number; t: string }>;
      };
      expect(wire.metadata[AGENTKIT_METADATA_KEY]?.seq).toBe(event.sequence);
      expect(wire.metadata[AGENTKIT_METADATA_KEY]?.t).toBe(event.type);
    }
  });

  it("skips frames from another producer instead of inventing a gap", () => {
    const foreign = {
      type: EventType.CUSTOM,
      name: "someone-else/thing",
      value: {},
    };
    expect(decodeAgUiEvent(foreign, CONTEXT)).toBeUndefined();
    expect(
      decodeAgUiEvent(
        { type: EventType.STATE_SNAPSHOT, snapshot: {} },
        CONTEXT,
      ),
    ).toBeUndefined();
  });

  it("refuses a Builder frame it cannot read rather than dropping it", () => {
    const wire = encodeAgentEvent(everyEventType()[0]!) as {
      metadata: Record<string, Record<string, unknown>>;
    };
    wire.metadata[AGENTKIT_METADATA_KEY]!.seq = 0;
    expect(() => decodeAgUiEvent(wire, CONTEXT)).toThrow(
      AgentProtocolValidationError,
    );
  });

  it("rejects a profiled custom frame with a foreign name", () => {
    const wire = encodeAgentEvent(
      everyEventType().find((event) => event.type === "widget.removed")!,
    ) as { name: string };
    wire.name = "someone-else/thing";

    expect(() => decodeAgUiEvent(wire, CONTEXT)).toThrow(
      AgentProtocolValidationError,
    );
  });

  it("rejects a name that disagrees with the declared event type", () => {
    const wire = encodeAgentEvent(
      everyEventType().find((event) => event.type === "widget.removed")!,
    ) as { name: string };
    wire.name = "builder.agentkit.v1/widget.created";
    expect(() => decodeAgUiEvent(wire, CONTEXT)).toThrow(
      AgentProtocolValidationError,
    );
  });

  it.each([null, "cancelled", 1, []])(
    "rejects a non-object profile payload: %j",
    (value) => {
      const wire = encodeAgentEvent(
        everyEventType().find((event) => event.type === "run.cancelled")!,
      ) as { value: unknown };
      wire.value = value;

      expect(() => decodeAgUiEvent(wire, CONTEXT)).toThrow(
        AgentProtocolValidationError,
      );
    },
  );

  it("rejects a native frame that disagrees with its profile event type", () => {
    const wire = encodeAgentEvent(
      everyEventType().find((event) => event.type === "run.started")!,
    ) as { type: EventType };
    wire.type = EventType.RUN_ERROR;

    expect(() => decodeAgUiEvent(wire, CONTEXT)).toThrow(
      AgentProtocolValidationError,
    );
  });

  it("runs reconstructed residuals through domain validation", () => {
    const wire = encodeAgentEvent({
      ...base("message.delta"),
      messageId: "msg_1",
      text: "hello",
      format: "markdown",
    } as AgentEvent) as {
      metadata: Record<string, { residual: Record<string, unknown> }>;
    };
    wire.metadata[AGENTKIT_METADATA_KEY]!.residual.format = "html";

    expect(() => decodeAgUiEvent(wire, CONTEXT)).toThrow(
      AgentProtocolValidationError,
    );
  });

  it("maps approvals onto an AG-UI interrupt outcome", () => {
    const approval = everyEventType().find(
      (event) => event.type === "approval.requested",
    )!;
    const wire = encodeAgentEvent(approval) as {
      type: EventType;
      outcome: { type: string; interrupts: { id: string; reason: string }[] };
    };
    expect(wire.type).toBe(EventType.RUN_FINISHED);
    expect(wire.outcome.type).toBe("interrupt");
    expect(wire.outcome.interrupts[0]).toMatchObject({
      id: "approval_1",
      reason: "Delete the row?",
    });
  });

  it("keeps explicit denial distinct from interrupt cancellation", () => {
    const denied = resumeEntryFromApproval({
      approvalId: "approval_1",
      response: { decision: "deny" },
    });

    expect(denied.status).toBe("resolved");
    expect(approvalResponseFromResume(denied)).toEqual({ decision: "deny" });
    expect(
      approvalResponseFromResume({
        interruptId: "approval_1",
        status: "cancelled",
      }),
    ).toEqual({ decision: "deny" });
    expect(() =>
      approvalResponseFromResume({
        interruptId: "approval_1",
        status: "cancelled",
        payload: { decision: "approve" },
      }),
    ).toThrow(AgentProtocolValidationError);
  });

  it("rejects payloads that redefine trusted event identity", () => {
    const native = encodeAgentEvent(
      everyEventType().find((event) => event.type === "message.created")!,
    ) as {
      metadata: Record<string, { residual: Record<string, unknown> }>;
    };
    native.metadata[AGENTKIT_METADATA_KEY]!.residual.sequence = 999;

    expect(() => decodeAgUiEvent(native, CONTEXT)).toThrow(
      AgentProtocolValidationError,
    );

    const custom = encodeAgentEvent(
      everyEventType().find((event) => event.type === "widget.removed")!,
    ) as { value: Record<string, unknown> };
    custom.value.runId = "run-forged";

    expect(() => decodeAgUiEvent(custom, CONTEXT)).toThrow(
      AgentProtocolValidationError,
    );
  });

  it("validates approval payload fields before they reach a runtime", () => {
    expect(() =>
      approvalResponseFromResume({
        interruptId: "approval_1",
        status: "resolved",
        payload: { decision: "approve", optionIds: [1] },
      }),
    ).toThrow(AgentProtocolValidationError);
    expect(() =>
      resumeOptionId({
        interruptId: "approval_1",
        status: "resolved",
        payload: { decision: "approve", optionId: 1 },
      }),
    ).toThrow(AgentProtocolValidationError);
  });

  it("classifies every fixture as native or profile", () => {
    for (const event of everyEventType()) {
      const known =
        event.type in AGENTKIT_NATIVE_EVENT_TYPES ||
        isProfileEventType(event.type);
      expect(known, `${event.type} has no mapping`).toBe(true);
    }
  });
});

describe("AG-UI reconnect cursor", () => {
  function stream(): AgentEvent[] {
    return everyEventType().slice(0, 10);
  }

  function cursorOf(wire: unknown): number {
    return (wire as { metadata: Record<string, { seq: number }> }).metadata[
      AGENTKIT_METADATA_KEY
    ]!.seq;
  }

  it("resumes after the last delivered cursor with no gap or duplicate", () => {
    const wire = stream().map(encodeAgentEvent);
    const delivered = wire.slice(0, 4);
    const lastSequence = cursorOf(delivered.at(-1));

    const resumed = wire.filter((frame) => cursorOf(frame) > lastSequence);
    const replayed = [...delivered, ...resumed].map(
      (frame) => decodeAgUiEvent(frame, CONTEXT)!,
    );

    expect(replayed).toEqual(stream());
  });

  it("makes a dropped frame detectable from the cursor alone", () => {
    const wire = stream().map(encodeAgentEvent);
    const sequences = [...wire.slice(0, 3), ...wire.slice(4)].map(cursorOf);

    const gaps = sequences.filter(
      (value, index) => index > 0 && value !== sequences[index - 1]! + 1,
    );
    expect(gaps).toHaveLength(1);
  });
});
