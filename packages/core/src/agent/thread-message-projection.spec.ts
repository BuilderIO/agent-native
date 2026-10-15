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
});
