import { describe, expect, it } from "vitest";

import { projectRootAssistantMessages } from "./thread-message-projection";

describe("assistant root projection", () => {
  it.each(["ambiguous", "different-run"])(
    "retains the root for %s exact candidates",
    (kind) => {
      const result = projectRootAssistantMessages({
        rootMessages: [
          {
            id: "server-run-one",
            role: "assistant",
            parts: [{ type: "text", text: "Answer complete" }],
            metadata: { runId: "run-one" },
          },
        ],
        snapshotMessages: ["first", "second"].map((id) => ({
          id,
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
          metadata: { runId: kind === "different-run" ? "run-two" : "run-one" },
        })),
      });
      expect(result.representedRootMessageIds.has("server-run-one")).toBe(
        false,
      );
    },
  );

  it("represents a same-run root with one exact candidate and another prefix segment", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "server-run-one",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
          metadata: { runId: "run-one", custom: { foldedRunIds: ["run-one"] } },
        },
      ],
      snapshotMessages: [
        {
          id: "segment-prefix",
          role: "assistant",
          parts: [{ type: "text", text: "Answer" }],
          metadata: { runId: "run-one" },
        },
        {
          id: "segment-final",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
          metadata: { runId: "run-one" },
        },
      ],
    });
    expect(result.representedRootMessageIds.has("server-run-one")).toBe(true);
    expect(result.snapshotMessageIdsByRootMessageId.get("server-run-one")).toBe(
      "segment-final",
    );
  });

  it("deduplicates repeated snapshots for structured error statuses", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "server-run-one",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
          status: { type: "error" },
          metadata: { runId: "run-one" },
        },
      ],
      snapshotMessages: [
        {
          id: "exact-answer",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
          metadata: { runId: "run-one" },
        },
        {
          id: "repeated-answer",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete\nAnswer complete" }],
          metadata: { runId: "run-one" },
        },
      ],
    });

    expect(result.representedRootMessageIds.has("server-run-one")).toBe(true);
    expect(result.snapshotMessageIdsByRootMessageId.get("server-run-one")).toBe(
      "exact-answer",
    );
    expect(result.supersededSnapshotMessageIds.has("repeated-answer")).toBe(
      true,
    );
  });

  it("does not deduplicate a tool-only durable root with empty text", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "server-run-one",
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "example" },
            },
          ],
          metadata: { runId: "run-one" },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-empty",
          role: "assistant",
          parts: [{ type: "text", text: "" }],
          metadata: { runId: "run-one" },
        },
      ],
    });
    expect(result.representedRootMessageIds.has("server-run-one")).toBe(false);
  });

  it("keeps tool parts when snapshot text matches but omits them", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "server-run-one",
          role: "assistant",
          parts: [
            { type: "text", text: "Answer complete" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "example" },
            },
          ],
          metadata: { runId: "run-one" },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-text",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
          metadata: { runId: "run-one" },
        },
      ],
    });
    expect(result.representedRootMessageIds.has("server-run-one")).toBe(false);
    expect(result.snapshotMessageIdsByRootMessageId.has("server-run-one")).toBe(
      false,
    );
  });

  it("keeps a tool-bearing root when indexed calls have no message id", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "server-run-one",
          role: "assistant",
          parts: [
            { type: "text", text: "Answer complete" },
            {
              type: "data",
              mediaType: "application/x-agent-native-repository-part",
              data: {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "search",
                args: { query: "example" },
              },
            },
          ],
          metadata: { runId: "run-one" },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-text",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
          metadata: { runId: "run-one" },
        },
      ],
      toolCalls: [
        { id: "call-1", name: "search", input: { query: "example" } },
      ],
    });

    expect(result.representedRootMessageIds.has("server-run-one")).toBe(false);
    expect(result.snapshotMessageIdsByRootMessageId.has("server-run-one")).toBe(
      false,
    );
  });

  it("matches a folded root claimed only by an inherited snapshot message id", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "root-answer",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
          metadata: {
            runId: "run-root",
            custom: { foldedRunIds: ["run-root", "run-continuation"] },
          },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-answer",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
        },
      ],
      runs: [
        {
          id: "run-continuation",
          status: "completed",
          inheritedMessageId: "snapshot-answer",
        },
      ],
    });

    expect(result.representedRootMessageIds.has("root-answer")).toBe(true);
  });

  it("keeps a complete folded root when a shared snapshot is only its prefix", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "root-answer",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Answer complete" }],
          metadata: {
            runId: "run-root",
            custom: { foldedRunIds: ["run-root", "run-continuation"] },
          },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-answer",
          role: "assistant",
          parts: [{ type: "text", text: "Answer" }],
        },
      ],
      runs: [
        {
          id: "run-root",
          status: "completed",
          activeMessageId: "snapshot-answer",
        },
        {
          id: "run-continuation",
          status: "running",
          activeMessageId: "snapshot-answer",
        },
      ],
    });

    expect(result.representedRootMessageIds.has("root-answer")).toBe(false);
    expect(result.supersededSnapshotMessageIds.has("snapshot-answer")).toBe(
      true,
    );
  });

  it("keeps a tool-bearing root when one indexed snapshot omits a call", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "root-answer",
          role: "assistant",
          status: "complete",
          parts: [
            { type: "text", text: "Answer complete" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "example" },
            },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "lookup",
              args: { key: "example" },
            },
          ],
          metadata: { runId: "run-one" },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-answer",
          role: "assistant",
          parts: [
            { type: "text", text: "Answer complete" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "example" },
            },
          ],
          metadata: { runId: "run-one" },
        },
      ],
      toolCalls: [
        {
          id: "call-1",
          name: "search",
          input: { query: "example" },
          messageId: "snapshot-answer",
        },
        {
          id: "call-2",
          name: "lookup",
          input: { key: "example" },
          messageId: "snapshot-answer",
        },
      ],
    });

    expect(result.representedRootMessageIds.has("root-answer")).toBe(false);
    expect(result.supersededSnapshotMessageIds.has("snapshot-answer")).toBe(
      true,
    );
  });

  it("suppresses a shared text duplicate while retaining durable tool calls", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "root-answer",
          role: "assistant",
          status: "complete",
          parts: [
            { type: "text", text: "Answer complete" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "example" },
            },
          ],
          metadata: {
            runId: "run-root",
            custom: { foldedRunIds: ["run-root", "run-continuation"] },
          },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-answer",
          role: "assistant",
          parts: [{ type: "text", text: "Answer complete" }],
        },
      ],
      runs: [
        {
          id: "run-root",
          status: "completed",
          activeMessageId: "snapshot-answer",
        },
        {
          id: "run-continuation",
          status: "running",
          activeMessageId: "snapshot-answer",
        },
      ],
    });

    expect(result.representedRootMessageIds.has("root-answer")).toBe(false);
    expect(result.supersededSnapshotMessageIds.has("snapshot-answer")).toBe(
      true,
    );
  });

  it("does not match a split projection with an unindexed durable tool call", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "root-answer",
          role: "assistant",
          status: "complete",
          content: [
            { type: "text", text: "Done." },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "example" },
            },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "lookup",
              args: { key: "example" },
            },
          ],
          metadata: { runId: "run-one" },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-text",
          role: "assistant",
          parts: [{ type: "text", text: "Done." }],
          metadata: { runId: "run-one" },
        },
        {
          id: "snapshot-tool",
          role: "assistant",
          parts: [{ type: "text", text: "" }],
          metadata: { runId: "run-one" },
        },
      ],
      toolCalls: [
        {
          id: "call-1",
          name: "search",
          input: { query: "example" },
          messageId: "snapshot-tool",
        },
        {
          id: "call-2",
          name: "lookup",
          input: { key: "example" },
        },
      ],
    });

    expect(result.representedRootMessageIds.has("root-answer")).toBe(false);
  });

  it("matches durable text and tool calls split across same-run snapshots", () => {
    const result = projectRootAssistantMessages({
      rootMessages: [
        {
          id: "root-answer",
          role: "assistant",
          status: { type: "complete" },
          content: [
            { type: "text", text: "Done." },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "example" },
            },
          ],
          metadata: { runId: "run-one" },
        },
      ],
      snapshotMessages: [
        {
          id: "snapshot-text",
          role: "assistant",
          parts: [{ type: "text", text: "Done." }],
          metadata: { runId: "run-one" },
        },
        {
          id: "snapshot-tool",
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "example" },
            },
          ],
          metadata: { runId: "run-one" },
        },
      ],
      toolCalls: [
        {
          id: "call-1",
          name: "search",
          input: { query: "example" },
          messageId: "snapshot-tool",
        },
      ],
    });

    expect(result.representedRootMessageIds.has("root-answer")).toBe(true);
    expect(result.snapshotMessageIdsByRootMessageId.get("root-answer")).toBe(
      "snapshot-text",
    );
    expect(result.supersededSnapshotMessageIds.has("snapshot-tool")).toBe(
      false,
    );
  });
});
