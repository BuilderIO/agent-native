import { describe, expect, expectTypeOf, it } from "vitest";

import { inferAgentActivityKind } from "./index.js";
import type {
  AgentEvent,
  AgentCustomMessagePart,
  AgentMessage,
  AgentTransport,
  AgentWidget,
  AnnotationPart,
  QueueMessageInput,
  WidgetPart,
} from "./index.js";

describe("AgentKit protocol composition", () => {
  it("classifies stable tool identifiers into semantic activity kinds", () => {
    expect(inferAgentActivityKind("docs-search")).toBe("search");
    expect(inferAgentActivityKind("run_checks")).toBe("check");
    expect(inferAgentActivityKind("read_file")).toBe("read");
    expect(inferAgentActivityKind("mcp__slack__search_messages")).toBe("mcp");
    expect(inferAgentActivityKind("provider-api-request")).toBe("mcp");
    expect(inferAgentActivityKind("hello")).toBe("tool");
  });

  it("keeps widgets and annotations as first-class message parts", () => {
    const widget: AgentWidget = {
      id: "widget-1",
      kind: "choice-list",
      data: { options: ["Keep", "Change"] },
      actions: [{ id: "keep", label: "Keep", payload: { choice: "keep" } }],
    };
    const message: AgentMessage = {
      id: "message-1",
      role: "assistant",
      parts: [
        { type: "widget", widget },
        {
          type: "annotation",
          annotation: { id: "source-1", kind: "source", label: "README" },
        },
      ],
    };

    expectTypeOf<
      Extract<(typeof message.parts)[number], { type: "widget" }>
    >().toEqualTypeOf<WidgetPart>();
    expectTypeOf<
      Extract<(typeof message.parts)[number], { type: "annotation" }>
    >().toEqualTypeOf<AnnotationPart>();
  });

  it("allows hosts to add namespaced message parts", () => {
    const part: AgentCustomMessagePart = {
      type: "x-workspace-card",
      resourceId: "resource-1",
      data: { status: "ready" },
    };
    const message: AgentMessage<AgentCustomMessagePart> = {
      id: "message-2",
      role: "assistant",
      parts: [part, { type: "text", text: "The card is ready." }],
    };

    expect(message.parts[0]?.type).toBe("x-workspace-card");
  });

  it("keeps thread and queue operations optional for small transports", () => {
    const input: QueueMessageInput = {
      threadId: "thread-1",
      text: "Run the checks",
    };
    const transport: AgentTransport = {
      startRun: async () => ({ runId: "run-1" }),
      subscribeToRun: async function* () {
        const event: AgentEvent = {
          id: "event-1",
          threadId: "thread-1",
          runId: "run-1",
          sequence: 1,
          occurredAt: new Date().toISOString(),
          type: "run.started",
        };
        yield event;
      },
      cancelRun: async () => {},
    };

    expect(input.threadId).toBe("thread-1");
    expectTypeOf(transport.queueMessage).toEqualTypeOf<
      AgentTransport["queueMessage"]
    >();
  });

  it("models structured approval responses for choice and input cards", () => {
    const event: AgentEvent = {
      id: "event-2",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 2,
      occurredAt: new Date().toISOString(),
      type: "approval.resolved",
      approvalId: "approval-1",
      response: {
        decision: "approve",
        optionIds: ["keep"],
        other: "Keep it, but add a summary",
        input: { note: "Ship it" },
      },
    };

    expect(event.response.decision).toBe("approve");
    expect(event.response?.optionIds).toEqual(["keep"]);
    expect(event.response.other).toBe("Keep it, but add a summary");
  });
});
