import type {
  AgentEvent,
  AgentMessage,
  AgentWidget,
} from "@agent-native/agentkit/protocol";
import { describe, expect, it } from "vitest";

import {
  orderMessageContent,
  type AgentMessageContentOrderResolver,
} from "./message-content-order.js";

const widget: AgentWidget = {
  id: "chart-1",
  kind: "core.data-chart",
  data: { toolCallId: "tool-1" },
};

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
    occurredAt: `2026-10-21T00:00:0${sequence}.000Z`,
    ...payload,
  } as AgentEvent;
}

describe("orderMessageContent", () => {
  it("keeps an attached chart between the streamed introduction and conclusion", () => {
    const message: AgentMessage = {
      id: "assistant-1",
      role: "assistant",
      status: "complete",
      parts: [
        {
          type: "text",
          text: "Intro before chart. Conclusion after chart.",
          format: "markdown",
        },
      ],
    };
    const events: AgentEvent[] = [
      event(1, {
        type: "message.created",
        message: { ...message, status: "streaming", parts: [] },
      }),
      event(2, {
        type: "message.delta",
        messageId: message.id,
        text: "Intro before chart. ",
        format: "markdown",
      }),
      event(3, { type: "widget.created", messageId: message.id, widget }),
      event(4, {
        type: "message.delta",
        messageId: message.id,
        text: "Conclusion after chart.",
        format: "markdown",
      }),
      event(5, { type: "message.completed", message }),
    ];

    const result = orderMessageContent(
      message,
      message.parts,
      [widget],
      events,
    );

    expect(result.map((item) => item.type)).toEqual(["part", "widget", "part"]);
    expect(result[0]).toMatchObject({
      type: "part",
      part: { text: "Intro before chart. " },
    });
    expect(result[1]).toMatchObject({ type: "widget", widget });
    expect(result[2]).toMatchObject({
      type: "part",
      part: { text: "Conclusion after chart." },
    });
  });

  it("keeps legacy append order when streamed text cannot be matched exactly", () => {
    const message: AgentMessage = {
      id: "assistant-2",
      role: "assistant",
      parts: [{ type: "text", text: "Final answer" }],
    };

    const result = orderMessageContent(message, message.parts, [widget], []);

    expect(result.map((item) => item.type)).toEqual(["part", "widget"]);
  });

  it("lets a host split text around a widget when stream order is unavailable", () => {
    const message: AgentMessage = {
      id: "assistant-3",
      role: "assistant",
      parts: [{ type: "text", text: "Intro. Summary." }],
    };
    const textPart = message.parts[0];
    if (textPart?.type !== "text") throw new Error("Expected text part");

    const result = orderMessageContent(
      message,
      message.parts,
      [widget],
      [],
      ({ parts, widgets }) => {
        const part = parts[0];
        const chart = widgets[0];
        if (part?.type !== "text" || !chart) return [];
        return [
          {
            key: "intro",
            type: "part",
            part: { ...part, text: "Intro. " },
          },
          { key: chart.id, type: "widget", widget: chart },
          {
            key: "summary",
            type: "part",
            part: { ...part, text: "Summary." },
          },
        ];
      },
    );

    expect(result.map((item) => item.type)).toEqual(["part", "widget", "part"]);
    expect(result[0]).toMatchObject({ part: { text: "Intro. " } });
    expect(result[1]).toMatchObject({ type: "widget", widget });
    expect(result[2]).toMatchObject({ part: { text: "Summary." } });
    expect(textPart.text).toBe("Intro. Summary.");
  });

  it("falls back when the host ordering result drops all visible content", () => {
    const message: AgentMessage = {
      id: "assistant-4",
      role: "assistant",
      parts: [{ type: "text", text: "A saved answer" }],
    };

    const result = orderMessageContent(
      message,
      message.parts,
      [widget],
      [],
      () => [],
    );

    expect(result).toEqual([
      {
        key: "assistant-4-text-0",
        type: "part",
        part: message.parts[0],
      },
      { key: widget.id, type: "widget", widget },
    ]);
  });

  it("falls back when the host ordering result loses text or a widget", () => {
    const message: AgentMessage = {
      id: "assistant-5",
      role: "assistant",
      parts: [{ type: "text", text: "Visible answer" }],
    };
    const incompleteOrders: AgentMessageContentOrderResolver[] = [
      () => [{ key: widget.id, type: "widget" as const, widget }],
      ({ defaultOrder }) => defaultOrder.slice(0, 1),
    ];

    for (const resolveOrder of incompleteOrders) {
      const result = orderMessageContent(
        message,
        message.parts,
        [widget],
        [],
        resolveOrder,
      );
      expect(result.map((item) => item.type)).toEqual(["part", "widget"]);
    }
  });

  it("keeps the leading text key when a widget arrives mid-stream", () => {
    const streaming: AgentMessage = {
      id: "assistant-6",
      role: "assistant",
      status: "streaming",
      parts: [
        { type: "text", text: "Intro before chart. ", format: "markdown" },
      ],
    };
    const beforeWidget = orderMessageContent(
      streaming,
      streaming.parts,
      [],
      [
        event(1, {
          type: "message.created",
          message: { ...streaming, parts: [] },
        }),
        event(2, {
          type: "message.delta",
          messageId: streaming.id,
          text: "Intro before chart. ",
          format: "markdown",
        }),
      ],
    );
    const grown: AgentMessage = {
      ...streaming,
      parts: [
        {
          type: "text",
          text: "Intro before chart. More after.",
          format: "markdown",
        },
      ],
    };
    const afterWidget = orderMessageContent(
      grown,
      grown.parts,
      [widget],
      [
        event(1, {
          type: "message.created",
          message: { ...streaming, parts: [] },
        }),
        event(2, {
          type: "message.delta",
          messageId: streaming.id,
          text: "Intro before chart. ",
          format: "markdown",
        }),
        event(3, { type: "widget.created", messageId: streaming.id, widget }),
        event(4, {
          type: "message.delta",
          messageId: streaming.id,
          text: "More after.",
          format: "markdown",
        }),
      ],
    );

    expect(afterWidget.map((item) => item.type)).toEqual([
      "part",
      "widget",
      "part",
    ]);
    expect(afterWidget[0]?.key).toBe(beforeWidget[0]?.key);
    expect(afterWidget[2]?.key).not.toBe(afterWidget[0]?.key);
  });
});
