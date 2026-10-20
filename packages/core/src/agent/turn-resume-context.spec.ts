import { describe, expect, it } from "vitest";

import { AGENT_INTERNAL_CONTINUE_PROMPT } from "./continuation-prompt.js";
import type { EngineMessage } from "./engine/types.js";
import { buildTurnResumeContext } from "./turn-resume-context.js";
import type { AgentChatEvent } from "./types.js";

describe("buildTurnResumeContext", () => {
  it("preserves an earlier turn when the current turn reuses its provider call id", () => {
    const callId = "provider-call-reused";
    const executionStepId = "current-turn-write";
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Write the earlier record" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: callId,
            name: "write-record",
            input: { value: "earlier" },
          },
          {
            type: "tool-result",
            toolCallId: callId,
            toolName: "write-record",
            toolInput: '{"value":"earlier"}',
            content: "Earlier record written",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Write the current record" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: callId,
            name: "write-record",
            input: { value: "current" },
            executionStepId,
          },
          {
            type: "tool-result",
            toolCallId: callId,
            toolName: "write-record",
            toolInput: '{"value":"current"}',
            content: "Current record written",
            executionStepId,
          },
        ],
      },
    ];
    const events: AgentChatEvent[] = [
      {
        type: "tool_start",
        id: callId,
        tool: "write-record",
        input: { value: "current" },
        executionStepId,
      },
      {
        type: "tool_done",
        id: callId,
        tool: "write-record",
        input: { value: "current" },
        result: "Current record written",
        executionStepId,
      },
    ];

    const resumed = buildTurnResumeContext({
      messages,
      journal: null,
      events,
    });
    const calls = resumed.messages.flatMap(({ content }) =>
      content.flatMap((part) => (part.type === "tool-call" ? [part] : [])),
    );
    const results = resumed.messages.flatMap(({ content }) =>
      content.flatMap((part) => (part.type === "tool-result" ? [part] : [])),
    );

    expect(calls).toHaveLength(2);
    expect(calls.map(({ input }) => input)).toEqual([
      { value: "earlier" },
      { value: "current" },
    ]);
    expect(results.map(({ content }) => content)).toEqual([
      "Earlier record written",
      "Current record written",
    ]);
  });

  it("does not duplicate completed calls from the same turn after continuation", () => {
    const executionStepId = "completed-write";
    const resumed = buildTurnResumeContext({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Write the record." }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "provider-call",
              name: "write-record",
              input: { value: "saved" },
              executionStepId,
            },
            {
              type: "tool-result",
              toolCallId: "provider-call",
              toolName: "write-record",
              toolInput: '{"value":"saved"}',
              content: "Record saved",
              executionStepId,
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ],
      journal: null,
      events: [
        {
          type: "tool_start",
          id: "provider-call",
          tool: "write-record",
          input: { value: "saved" },
          executionStepId,
        },
        {
          type: "tool_done",
          id: "provider-call",
          tool: "write-record",
          input: { value: "saved" },
          result: "Record saved",
          executionStepId,
        },
      ],
    });
    const calls = resumed.messages.flatMap(({ content }) =>
      content.flatMap((part) => (part.type === "tool-call" ? [part] : [])),
    );
    const results = resumed.messages.flatMap(({ content }) =>
      content.flatMap((part) => (part.type === "tool-result" ? [part] : [])),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.executionStepId).toBe(executionStepId);
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe("Record saved");
  });

  it("preserves a legacy call when a step-identified ledger call reuses its id", () => {
    const callId = "provider-call-reused";
    const executionStepId = "current-turn-write";
    const resumed = buildTurnResumeContext({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Write both records" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: callId,
              name: "write-record",
              input: { value: "legacy" },
            },
            {
              type: "tool-result",
              toolCallId: callId,
              toolName: "write-record",
              toolInput: '{"value":"legacy"}',
              content: "Legacy record written",
            },
          ],
        },
      ],
      journal: null,
      events: [
        {
          type: "tool_start",
          id: callId,
          tool: "write-record",
          input: { value: "step-identified" },
          executionStepId,
        },
        {
          type: "tool_done",
          id: callId,
          tool: "write-record",
          input: { value: "step-identified" },
          result: "Step-identified record written",
          executionStepId,
        },
      ],
    });
    const calls = resumed.messages.flatMap(({ content }) =>
      content.flatMap((part) => (part.type === "tool-call" ? [part] : [])),
    );
    const results = resumed.messages.flatMap(({ content }) =>
      content.flatMap((part) => (part.type === "tool-result" ? [part] : [])),
    );

    expect(calls.map(({ input }) => input)).toEqual([
      { value: "legacy" },
      { value: "step-identified" },
    ]);
    expect(results.map(({ content }) => content)).toEqual([
      "Legacy record written",
      "Step-identified record written",
    ]);
  });
});
