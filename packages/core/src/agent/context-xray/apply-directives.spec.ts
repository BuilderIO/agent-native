import { describe, expect, it } from "vitest";

import type { ContextDirective } from "../../shared/context-xray.js";
import type { EngineMessage } from "../engine/types.js";
import { applyContextDirectives } from "./apply-directives.js";
import { computeProtectedSegmentIds, computeSegments } from "./segments.js";

function directive(
  threadId: string,
  segmentId: string,
  action: ContextDirective["action"],
): ContextDirective {
  return {
    threadId,
    segmentId,
    action,
    createdBy: "user",
    active: true,
  };
}

describe("applyContextDirectives", () => {
  it("co-evicts tool calls and results by stable pair key", () => {
    const messages: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "tool-a",
            name: "read-file",
            input: { path: "node_modules/big.js" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-a",
            toolName: "read-file",
            toolInput: JSON.stringify({ path: "node_modules/big.js" }),
            content: "large result",
          },
        ],
      },
    ];
    const resultSegment = computeSegments(messages).find(
      (segment) => segment.type === "tool-result",
    )!;

    const transformed = applyContextDirectives(
      messages,
      new Map([
        [
          resultSegment.segmentId,
          directive("thread-1", resultSegment.segmentId, "evict"),
        ],
      ]),
      { protectedSegmentIds: new Set() },
    );

    expect(transformed.messages).toEqual([]);
    expect(transformed.appliedStatus.get(resultSegment.segmentId)).toBe(
      "evicted",
    );
  });

  it("evicts only the targeted duplicate tool pair", () => {
    const messages: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "tool-a",
            name: "read-file",
            input: { path: "repeat.txt" },
          },
          {
            type: "tool-call",
            id: "tool-b",
            name: "read-file",
            input: { path: "repeat.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-a",
            toolName: "read-file",
            toolInput: JSON.stringify({ path: "repeat.txt" }),
            content: "first",
          },
          {
            type: "tool-result",
            toolCallId: "tool-b",
            toolName: "read-file",
            toolInput: JSON.stringify({ path: "repeat.txt" }),
            content: "second",
          },
        ],
      },
    ];
    const resultSegments = computeSegments(messages).filter(
      (segment) => segment.type === "tool-result",
    );

    const transformed = applyContextDirectives(
      messages,
      new Map([
        [
          resultSegments[0]!.segmentId,
          directive("thread-1", resultSegments[0]!.segmentId, "evict"),
        ],
      ]),
      { protectedSegmentIds: new Set() },
    );

    expect(transformed.messages[0]?.content).toEqual([
      {
        type: "tool-call",
        id: "tool-b",
        name: "read-file",
        input: { path: "repeat.txt" },
      },
    ]);
    expect(transformed.messages[1]?.content).toEqual([
      {
        type: "tool-result",
        toolCallId: "tool-b",
        toolName: "read-file",
        toolInput: JSON.stringify({ path: "repeat.txt" }),
        content: "second",
      },
    ]);
  });

  it("merges adjacent same-role turns created by evicting a tool pair", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "check the file" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect it." },
          {
            type: "tool-call",
            id: "tool-a",
            name: "read-file",
            input: { path: "large.log" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-a",
            toolName: "read-file",
            toolInput: JSON.stringify({ path: "large.log" }),
            content: "large result",
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The file is noisy." }],
      },
    ];
    const resultSegment = computeSegments(messages).find(
      (segment) => segment.type === "tool-result",
    )!;

    const transformed = applyContextDirectives(
      messages,
      new Map([
        [
          resultSegment.segmentId,
          directive("thread-1", resultSegment.segmentId, "evict"),
        ],
      ]),
      { protectedSegmentIds: new Set() },
    );

    expect(transformed.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "check the file" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect it." },
          { type: "text", text: "The file is noisy." },
        ],
      },
    ]);
  });

  it("does not mutate canonical messages", () => {
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "drop me" }],
      },
    ];
    const original = JSON.stringify(messages);
    const segment = computeSegments(messages)[0]!;

    applyContextDirectives(
      messages,
      new Map([
        [segment.segmentId, directive("thread-1", segment.segmentId, "evict")],
      ]),
      { protectedSegmentIds: new Set() },
    );

    expect(JSON.stringify(messages)).toBe(original);
  });

  it("keeps protected latest user context even when a directive targets it", () => {
    const messages: EngineMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "older" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "current task" }],
      },
    ];
    const segment = computeSegments(messages).find((candidate) =>
      candidate.label.includes("current task"),
    )!;

    const transformed = applyContextDirectives(
      messages,
      new Map([
        [segment.segmentId, directive("thread-1", segment.segmentId, "evict")],
      ]),
      { protectedSegmentIds: computeProtectedSegmentIds(messages) },
    );

    expect(transformed.messages).toEqual(messages);
    expect(transformed.appliedStatus.get(segment.segmentId)).toBeUndefined();
  });

  it("summarizes a segment without dropping the containing message", () => {
    const messages: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "keep" },
          { type: "text", text: "compress" },
        ],
      },
    ];
    const segment = computeSegments(messages).find((s) =>
      s.label.includes("compress"),
    )!;
    const d = directive("thread-1", segment.segmentId, "summarize");
    d.summaryText = "short version";

    const transformed = applyContextDirectives(
      messages,
      new Map([[segment.segmentId, d]]),
      { protectedSegmentIds: new Set() },
    );

    expect(transformed.messages).toHaveLength(1);
    expect(transformed.messages[0]?.content).toEqual([
      { type: "text", text: "keep" },
      { type: "text", text: "[summarized] short version" },
    ]);
  });
});
