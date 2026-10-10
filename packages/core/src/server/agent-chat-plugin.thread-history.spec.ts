import { MAX_AGENT_REQUEST_ATTACHMENTS } from "@agent-native/agentkit/protocol";
import { describe, expect, it } from "vitest";

import {
  buildAssistantMessage,
  mergeThreadDataForClientSave,
} from "../agent/thread-data-builder.js";
import {
  foldAgentChatRunCompletion,
  parseQueuedMessageForThread,
} from "./agent-chat-plugin.js";

describe("AgentKit thread history", () => {
  it("rejects queued messages with invalid run options", () => {
    const queued = {
      id: "queued-options",
      threadId: "thread-1",
      text: "Run once",
      options: { reasoningEffort: "unbounded" },
    };

    expect(parseQueuedMessageForThread(queued, "thread-1")).toBeNull();
    expect(
      parseQueuedMessageForThread(
        { ...queued, options: { reasoningEffort: "high" } },
        "thread-1",
      ),
    ).toMatchObject({
      id: "queued-options",
      options: { reasoningEffort: "high" },
    });
  });

  it("rejects data URLs before a queued message can be persisted", () => {
    const queued = {
      id: "queued-data-url",
      threadId: "thread-1",
      text: "Inspect this image",
      requestAttachments: [
        {
          type: "image",
          name: "screen.png",
          url: "data:image/png;base64,iVBORw==",
        },
      ],
    };

    expect(parseQueuedMessageForThread(queued, "thread-1")).toBeNull();
    expect(
      parseQueuedMessageForThread(
        {
          ...queued,
          requestAttachments: [
            {
              type: "image",
              name: "screen.png",
              url: "https://files.example.test/screen.png",
            },
          ],
        },
        "thread-1",
      ),
    ).toMatchObject({
      id: "queued-data-url",
      requestAttachments: [{ url: "https://files.example.test/screen.png" }],
    });
  });

  it("preserves legacy queued rows with more attachments than new writes allow", () => {
    const attachments = Array.from(
      { length: MAX_AGENT_REQUEST_ATTACHMENTS + 1 },
      (_, index) => ({
        type: "file",
        name: `file-${index}.pdf`,
        url: `https://files.example.test/file-${index}.pdf`,
      }),
    );

    expect(
      parseQueuedMessageForThread(
        {
          id: "queued-legacy-many-attachments",
          threadId: "thread-1",
          text: "Read these files",
          attachments,
        },
        "thread-1",
      )?.attachments,
    ).toHaveLength(MAX_AGENT_REQUEST_ATTACHMENTS + 1);
  });

  it("deduplicates plain replies across thread snapshot saves", () => {
    const reply = "Hello, AgentKit Browser!";
    const message = (id: string) => ({
      id,
      role: "assistant",
      parts: [{ type: "text", text: reply }],
      status: "complete",
    });
    const completion = (id: string, runId: string) => ({
      id: `event-${id}`,
      runId,
      type: "message.completed",
      message: { id, role: "assistant" },
    });
    const liveMessages = [message("message-live-reply")];
    const existing = {
      messages: [],
      agentKit: {
        messages: [message("message-server-reply")],
        events: [completion("message-server-reply", "run-plain-reply")],
      },
    };

    expect(liveMessages).toHaveLength(1);
    const saved = mergeThreadDataForClientSave(existing, {
      messages: [],
      agentKit: {
        messages: liveMessages,
        events: [completion("message-live-reply", "run-plain-reply")],
      },
    });
    const restored = JSON.parse(JSON.stringify(saved));

    expect(
      restored.agentKit.messages.filter((message: any) =>
        message.parts.some(
          (part: any) => part.type === "text" && part.text === reply,
        ),
      ),
    ).toHaveLength(1);
    expect(restored.agentKit.messages[0].id).toBe("message-live-reply");
    expect(restored.agentKit.messages[0].status).toBe("complete");

    const nextTurn = mergeThreadDataForClientSave(existing, {
      messages: [],
      agentKit: {
        messages: [message("message-live-next-turn")],
        events: [completion("message-live-next-turn", "run-next-turn")],
      },
    });
    expect(nextTurn.agentKit.messages).toHaveLength(2);
  });

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
        threadId: "thread-approval",
        status: "completed",
        startedAt: Date.now(),
        events: [{ seq: 0, event: { type: "done" } }],
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
