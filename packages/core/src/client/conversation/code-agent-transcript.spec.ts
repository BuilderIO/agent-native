import { describe, expect, it } from "vitest";

import { normalizeCodeAgentTranscriptForConversation } from "./code-agent-transcript.js";
import type { CodeAgentConversationTranscriptEvent } from "./code-agent-transcript.js";

describe("normalizeCodeAgentTranscriptForConversation", () => {
  it("groups Code transcript events into shared conversation messages", () => {
    const events: CodeAgentConversationTranscriptEvent[] = [
      {
        id: "user-1",
        runId: "run-1",
        type: "user",
        text: "Fix the chat",
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: {
          attachments: [
            {
              name: "screenshot.png",
              type: "image/png",
              size: 42,
              dataUrl: "data:image/png;base64,abc",
            },
          ],
        },
      },
      {
        id: "assistant-1",
        runId: "run-1",
        kind: "system",
        message: "I will inspect the code.",
        createdAt: "2026-01-01T00:00:01.000Z",
        metadata: { role: "assistant" },
      },
      {
        id: "tool-start-1",
        runId: "run-1",
        type: "status",
        text: "Reading files",
        createdAt: "2026-01-01T00:00:02.000Z",
        metadata: {
          type: "tool_start",
          tool: "read_file",
          input: { path: "chat.tsx" },
        },
      },
      {
        id: "tool-done-1",
        runId: "run-1",
        type: "status",
        text: "Read files",
        createdAt: "2026-01-01T00:00:03.000Z",
        metadata: {
          type: "tool_done",
          tool: "read_file",
          result: "ok",
        },
      },
      {
        id: "artifact-1",
        runId: "run-1",
        type: "artifact",
        text: "Patch",
        artifactPath: "/tmp/patch.diff",
        artifactUrl: "file:///tmp/patch.diff",
        createdAt: "2026-01-01T00:00:04.000Z",
      },
    ];

    const messages = normalizeCodeAgentTranscriptForConversation(events);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "user-1",
      role: "user",
      text: "Fix the chat",
      attachments: [
        {
          name: "screenshot.png",
          type: "image/png",
          size: 42,
          dataUrl: "data:image/png;base64,abc",
        },
      ],
    });
    expect(messages[1]?.parts?.map((part) => part.type)).toEqual([
      "text",
      "tool",
      "artifact",
    ]);
    expect(messages[1]?.tools?.[0]).toMatchObject({
      name: "read_file",
      state: "completed",
      summary: "finished",
    });
    expect(messages[1]?.artifacts?.[0]).toMatchObject({
      label: "Patch",
      path: "/tmp/patch.diff",
      url: "file:///tmp/patch.diff",
    });
  });

  it("preserves MCP App payloads on completed Code tool calls", () => {
    const events: CodeAgentConversationTranscriptEvent[] = [
      {
        id: "tool-start",
        runId: "run-1",
        type: "status",
        text: "Running render",
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: {
          type: "tool_start",
          tool: "mcp__apps__render",
          input: { id: "1" },
        },
      },
      {
        id: "tool-done",
        runId: "run-1",
        type: "status",
        text: "Finished render",
        createdAt: "2026-01-01T00:00:01.000Z",
        metadata: {
          type: "tool_done",
          tool: "mcp__apps__render",
          result: "Rendered",
          mcpApp: {
            serverId: "apps",
            toolName: "mcp__apps__render",
            originalToolName: "render",
            resourceUri: "ui://apps/render",
            toolInput: { id: "1" },
            toolResult: { content: [{ type: "text", text: "Rendered" }] },
          },
        },
      },
    ];

    const messages = normalizeCodeAgentTranscriptForConversation(events);
    expect(messages[0]?.tools?.[0]?.mcpApp).toMatchObject({
      serverId: "apps",
      resourceUri: "ui://apps/render",
      originalToolName: "render",
    });
  });

  it("marks pending user turns and can hide credential notices", () => {
    const events: CodeAgentConversationTranscriptEvent[] = [
      {
        id: "user-1",
        runId: "run-1",
        type: "user",
        text: "Continue",
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: { pending: true },
      },
      {
        id: "credentials-1",
        runId: "run-1",
        type: "status",
        text: "No LLM provider key was found.",
        createdAt: "2026-01-01T00:00:01.000Z",
        metadata: { phase: "missing-credentials" },
      },
    ];

    const visible = normalizeCodeAgentTranscriptForConversation(events);
    const hidden = normalizeCodeAgentTranscriptForConversation(events, {
      hideCredentialMessages: true,
    });

    expect(visible[0]?.pending).toBe(true);
    expect(visible[1]?.notices?.[0]?.tone).toBe("warning");
    expect(hidden).toHaveLength(1);
  });
});
