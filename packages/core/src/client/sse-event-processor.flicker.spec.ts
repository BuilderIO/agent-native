import { describe, expect, it } from "vitest";

import { readSSEStreamRaw } from "./sse-event-processor.js";
import type { ContentPart } from "./sse-event-processor.js";

// Regression coverage for the reported tool-call flicker: while a chat run
// streams, tool cards must not "show then hide then show again" and must not
// "pop between newer and older states". These tests drive realistic SSE event
// sequences through the same processor the live UI uses and assert that the
// per-event snapshot trace is monotonic:
//   1. a tool card, once shown, never disappears and reappears; and
//   2. a tool call, once completed, never regresses to pending.
// They also assert a sane final state (each logical call rendered exactly once)
// so an anti-hide fix cannot instead leak duplicate cards.

function eventsStream(events: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const ev of events) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.close();
    },
  });
}

/**
 * Run a sequence of SSE events through the real reconnect/stream processor and
 * capture the ordered list of content snapshots the UI would render — one per
 * meaningful update, plus the final settled array.
 */
async function captureSnapshots(events: object[]): Promise<ContentPart[][]> {
  const snapshots: ContentPart[][] = [];
  const content: ContentPart[] = [];
  await readSSEStreamRaw(
    eventsStream([...events, { type: "done" }]),
    content,
    { value: 0 },
    undefined,
    (snapshot) => {
      snapshots.push(structuredClone(snapshot));
    },
  ).catch(() => {
    // readSSEStreamRaw signals stream end / auto-continue by throwing; the
    // captured snapshots plus the mutated `content` array hold the result.
  });
  snapshots.push(structuredClone(content));
  return snapshots;
}

function toolCallParts(
  snapshot: ContentPart[],
): Extract<ContentPart, { type: "tool-call" }>[] {
  return snapshot.filter(
    (part): part is Extract<ContentPart, { type: "tool-call" }> =>
      part.type === "tool-call",
  );
}

/** Stable identity for a logical tool call, independent of the transient id. */
function toolSignature(
  part: Extract<ContentPart, { type: "tool-call" }>,
): string {
  return `${part.toolName}#${part.argsText}`;
}

/** Signatures of tool cards a user would see as a real (non-placeholder) card. */
function shownToolSignatures(snapshot: ContentPart[]): string[] {
  return toolCallParts(snapshot)
    .filter((part) => part.activity !== true)
    .map(toolSignature);
}

/** Signatures of tool cards that have settled with a result. */
function completedToolSignatures(snapshot: ContentPart[]): string[] {
  return toolCallParts(snapshot)
    .filter((part) => part.result !== undefined)
    .map(toolSignature);
}

function assertNoHideThenShow(snapshots: ContentPart[][]): void {
  const seenAt = new Map<string, number[]>();
  snapshots.forEach((snapshot, index) => {
    for (const sig of new Set(shownToolSignatures(snapshot))) {
      const list = seenAt.get(sig) ?? [];
      list.push(index);
      seenAt.set(sig, list);
    }
  });
  for (const [sig, indices] of seenAt) {
    for (let i = 1; i < indices.length; i++) {
      expect(
        indices[i],
        `tool card "${sig}" was shown, hidden, then shown again (snapshot indices ${indices.join(", ")})`,
      ).toBe(indices[i - 1] + 1);
    }
  }
}

function assertNoCompletedRegression(snapshots: ContentPart[][]): void {
  const firstCompletedAt = new Map<string, number>();
  snapshots.forEach((snapshot, index) => {
    for (const sig of new Set(completedToolSignatures(snapshot))) {
      if (!firstCompletedAt.has(sig)) firstCompletedAt.set(sig, index);
    }
  });
  for (const [sig, firstIndex] of firstCompletedAt) {
    for (let j = firstIndex; j < snapshots.length; j++) {
      expect(
        completedToolSignatures(snapshots[j]).includes(sig),
        `completed tool "${sig}" regressed to pending at snapshot ${j}`,
      ).toBe(true);
    }
  }
}

function assertMonotonicVisibility(snapshots: ContentPart[][]): void {
  assertNoHideThenShow(snapshots);
  assertNoCompletedRegression(snapshots);
}

describe("streaming tool-call visibility (flicker regression)", () => {
  it("keeps a materialized in-flight tool card mounted across a retry clear", async () => {
    const snapshots = await captureSnapshots([
      { type: "activity", tool: "search", label: "Searching" },
      {
        type: "tool_start",
        tool: "search",
        id: "call_1",
        input: { q: "docs" },
      },
      { type: "clear" },
      {
        type: "tool_start",
        tool: "search",
        id: "call_1",
        input: { q: "docs" },
      },
      { type: "tool_done", tool: "search", id: "call_1", result: "found" },
      { type: "text", text: "Done." },
    ]);

    assertMonotonicVisibility(snapshots);

    const final = toolCallParts(snapshots[snapshots.length - 1]);
    expect(final).toHaveLength(1);
    expect(final[0].toolName).toBe("search");
    expect(final[0].result).toBe("found");
    expect(final[0].activity).not.toBe(true);
  });

  it("does not regress a completed tool when a duplicate replay arrives", async () => {
    const snapshots = await captureSnapshots([
      { type: "tool_start", tool: "read", id: "call_1", input: { path: "a" } },
      { type: "tool_done", tool: "read", id: "call_1", result: "ok" },
      { type: "activity", tool: "read", label: "Reading" },
      { type: "tool_start", tool: "read", id: "call_1", input: { path: "a" } },
      { type: "tool_done", tool: "read", id: "call_1", result: "ok" },
      { type: "text", text: "Finished." },
    ]);

    assertMonotonicVisibility(snapshots);

    const final = toolCallParts(snapshots[snapshots.length - 1]);
    expect(final).toHaveLength(1);
    expect(final[0].result).toBe("ok");
  });

  it("keeps parallel in-flight tool cards stable across an interleaved clear", async () => {
    const snapshots = await captureSnapshots([
      { type: "tool_start", tool: "search", id: "call_1", input: { q: "one" } },
      { type: "tool_start", tool: "fetch", id: "call_2", input: { url: "u" } },
      { type: "tool_done", tool: "search", id: "call_1", result: "r1" },
      { type: "clear" },
      { type: "tool_start", tool: "fetch", id: "call_2", input: { url: "u" } },
      { type: "tool_done", tool: "fetch", id: "call_2", result: "r2" },
      { type: "text", text: "Both done." },
    ]);

    assertMonotonicVisibility(snapshots);

    const finalCompleted = completedToolSignatures(
      snapshots[snapshots.length - 1],
    );
    expect(finalCompleted).toContain('search#{"q":"one"}');
    expect(finalCompleted).toContain('fetch#{"url":"u"}');
  });
});
