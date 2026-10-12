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
});
