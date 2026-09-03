import { describe, expect, it } from "vitest";

import type { EngineMessage } from "../engine/types.js";
import { computeSegments } from "./segments.js";

describe("context-xray segments", () => {
  it("builds stable tool identities without volatile tool ids", () => {
    const first: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "tool-1",
            name: "read-file",
            input: { path: "src/app.ts", line: 1 },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "read-file",
            toolInput: JSON.stringify({ line: 1, path: "src/app.ts" }),
            content: "file body",
          },
        ],
      },
    ];
    const second: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "history_tc_99",
            name: "read-file",
            input: { line: 1, path: "src/app.ts" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "history_tc_99",
            toolName: "read-file",
            toolInput: JSON.stringify({ path: "src/app.ts", line: 1 }),
            content: "different body",
          },
        ],
      },
    ];

    expect(computeSegments(first).map((s) => s.segmentId)).toEqual(
      computeSegments(second).map((s) => s.segmentId),
    );
  });

  it("adds a duplicate ordinal for repeated content", () => {
    const segments = computeSegments([
      {
        role: "user",
        content: [
          { type: "text", text: "same" },
          { type: "text", text: "same" },
        ],
      },
    ]);

    expect(segments[0]?.segmentId.endsWith(":0")).toBe(true);
    expect(segments[1]?.segmentId.endsWith(":1")).toBe(true);
  });

  it("excludes thinking signatures from identity", () => {
    const one = computeSegments([
      {
        role: "assistant",
        content: [{ type: "thinking", text: "reasoning", signature: "a" }],
      },
    ]);
    const two = computeSegments([
      {
        role: "assistant",
        content: [{ type: "thinking", text: "reasoning", signature: "b" }],
      },
    ]);

    expect(one[0]?.segmentId).toBe(two[0]?.segmentId);
  });
});
