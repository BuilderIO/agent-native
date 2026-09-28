import { describe, expect, it } from "vitest";

import {
  buildAssistantMessage,
  mergeThreadDataForClientSave,
} from "../agent/thread-data-builder.js";
import { foldAgentChatRunCompletion } from "./agent-chat-plugin.js";

describe("AgentKit approval continuation history", () => {
  it("keeps continuation output out of the server placeholder before reload", () => {
    const toolCallId = "accept-release-call";
    const serverSnapshot = {
      messages: [
        {
          message: {
            id: "server-run-approval",
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Waiting for your approval to run accept-agentkit-release.",
              },
              {
                type: "tool-call",
                toolCallId,
                toolName: "accept-agentkit-release",
                args: { release: "agentkit-acceptance" },
                result: "Awaiting human approval. This action did NOT execute.",
              },
            ],
            metadata: {
              custom: { turnId: "turn-approval" },
            },
          },
        },
      ],
    };
    const continuation = buildAssistantMessage(
      [
        { seq: 0, event: { type: "text", text: "Release accepted." } },
        {
          seq: 1,
          event: {
            type: "tool_start",
            id: toolCallId,
            tool: "accept-agentkit-release",
            input: { release: "agentkit-acceptance" },
          },
        },
        {
          seq: 2,
          event: {
            type: "tool_done",
            id: toolCallId,
            tool: "accept-agentkit-release",
            result: "Release accepted.",
          },
        },
      ],
      "runtime-continuation",
      { turnId: "turn-approval" },
    );

    expect(continuation).toBeDefined();
    const afterServerCompletion = foldAgentChatRunCompletion(
      serverSnapshot,
      continuation!,
      {
        runId: "runtime-continuation",
        turnId: "turn-approval",
        agentKitApprovalContinuation: true,
      },
    );
    const legacyPlaceholder = afterServerCompletion.messages[0].message;
    expect(JSON.stringify(legacyPlaceholder)).not.toContain(
      "Release accepted.",
    );

    const afterClientSnapshot = mergeThreadDataForClientSave(
      afterServerCompletion,
      {
        ...afterServerCompletion,
        agentKit: {
          messages: [
            {
              id: "message-approval",
              role: "assistant",
              parts: [
                {
                  type: "text",
                  text: "Waiting for your approval to run accept-agentkit-release.",
                },
              ],
            },
            {
              id: "message-canonical",
              role: "assistant",
              parts: [{ type: "text", text: "Release accepted." }],
            },
          ],
          toolCalls: [
            {
              id: toolCallId,
              name: "accept-agentkit-release",
              input: { release: "agentkit-acceptance" },
              output: "Release accepted.",
              status: "completed",
              messageId: "message-canonical",
            },
          ],
        },
      },
    );
    const restored = JSON.parse(JSON.stringify(afterClientSnapshot));
    const releaseText = [
      ...restored.messages.flatMap((entry: any) =>
        entry.message.content.flatMap((part: any) =>
          part.type === "text" ? [part.text] : [],
        ),
      ),
      ...restored.agentKit.messages.flatMap((message: any) =>
        message.parts.flatMap((part: any) =>
          part.type === "text" ? [part.text] : [],
        ),
      ),
    ].filter((text: string) => text.includes("Release accepted"));

    expect(releaseText).toEqual(["Release accepted."]);
  });

  it("keeps completed AgentKit history when an older snapshot arrives later", () => {
    const earlier = {
      messages: [],
      agentKit: {
        messages: [
          {
            id: "message-1",
            role: "assistant",
            parts: [{ type: "text", text: "Partial" }],
            status: "streaming",
          },
        ],
        widgets: [
          {
            messageId: "message-1",
            widget: {
              id: "widget-1",
              kind: "action-card",
              data: {},
              state: "active",
            },
          },
        ],
        toolCalls: [{ id: "call-1", name: "save", status: "running" }],
      },
    };
    const completed = {
      messages: [],
      agentKit: {
        messages: [
          {
            id: "message-1",
            role: "assistant",
            parts: [{ type: "text", text: "Complete result" }],
            status: "complete",
          },
          {
            id: "message-2",
            role: "assistant",
            parts: [{ type: "text", text: "Second result" }],
            status: "complete",
          },
        ],
        widgets: [
          {
            messageId: "message-1",
            widget: {
              id: "widget-1",
              kind: "action-card",
              data: {},
              state: "submitted",
            },
          },
          {
            messageId: "message-2",
            widget: {
              id: "widget-2",
              kind: "action-card",
              data: {},
              state: "active",
            },
          },
        ],
        toolCalls: [
          {
            id: "call-1",
            name: "save",
            status: "completed",
            output: { ok: true },
          },
          { id: "call-2", name: "notify", status: "completed" },
        ],
      },
    };

    const afterNewerWrite = mergeThreadDataForClientSave(earlier, completed);
    const afterStaleWrite = mergeThreadDataForClientSave(
      afterNewerWrite,
      earlier,
    );
    const restored = JSON.parse(JSON.stringify(afterStaleWrite));

    expect(restored.agentKit.messages).toEqual(completed.agentKit.messages);
    expect(restored.agentKit.widgets).toEqual(completed.agentKit.widgets);
    expect(restored.agentKit.toolCalls).toEqual(completed.agentKit.toolCalls);
  });
});
