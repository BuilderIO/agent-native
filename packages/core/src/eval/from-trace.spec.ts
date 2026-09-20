import { describe, expect, it } from "vitest";

import {
  generateEvalModuleSource,
  promoteTraceToEval,
  type PromoteTraceEvent,
  type PromoteTraceSpan,
} from "./from-trace.js";

function events(...items: Array<Record<string, unknown>>): PromoteTraceEvent[] {
  return items.map((item, i) => ({
    seq: i + 1,
    eventData: JSON.stringify(item),
  }));
}

const twoToolSpans: PromoteTraceSpan[] = [
  { spanType: "tool_call", name: "search-docs", status: "success" },
  { spanType: "tool_call", name: "create-item", status: "success" },
];

describe("promoteTraceToEval", () => {
  it("maps a completed run with a user prompt and successful tools", () => {
    const result = promoteTraceToEval({
      runId: "run-abcdef123456",
      run: { status: "completed" },
      events: events(
        { type: "user-message", text: "File an expense for lunch" },
        { type: "tool_start", tool: "search-docs", input: {} },
        { type: "tool_done", tool: "search-docs", result: "ok" },
        { type: "tool_start", tool: "create-item", input: {} },
        { type: "tool_done", tool: "create-item", result: "ok" },
        { type: "text-delta", text: "Filed it." },
      ),
      spans: twoToolSpans,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eval.name).toBe("from-trace:run-abcd");
    expect(result.value.eval.input.prompt).toBe("File an expense for lunch");
    expect(result.value.eval.threshold).toBe(0.5);
    expect(result.value.eval.source).toEqual({
      kind: "trace",
      runId: "run-abcdef123456",
    });
    expect(result.value.eval.scorers.map((s) => s.name)).toEqual([
      "uses_tool:search-docs",
      "uses_tool:create-item",
    ]);
    expect(result.value.spec.scorers).toEqual([
      { type: "usesTool", toolName: "search-docs" },
      { type: "usesTool", toolName: "create-item" },
    ]);
    expect(result.value.dataset.entries[0]?.tags).toEqual([
      "from-trace",
      "run-abcdef123456",
    ]);
    expect(result.value.dataset.name).toBe("from-trace:run-abcdef123456");
  });

  it("puts prior assistant text into history and uses the first user message as the prompt", () => {
    const result = promoteTraceToEval({
      runId: "run-hist",
      run: { status: "completed" },
      events: events(
        { type: "text", text: "Welcome back." },
        { type: "user-message", text: "Now search docs" },
        { type: "tool_done", tool: "search-docs", result: "ok" },
      ),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eval.input).toEqual({
      prompt: "Now search docs",
      history: [{ role: "assistant", text: "Welcome back." }],
    });
  });

  it("refuses a truncated run", () => {
    const result = promoteTraceToEval({
      runId: "run-trunc",
      run: { status: "truncated" },
      events: events({ type: "user-message", text: "hello" }),
      spans: twoToolSpans,
    });
    expect(result).toEqual({ ok: false, error: "run_not_completed" });
  });

  it("refuses an aborted run", () => {
    const result = promoteTraceToEval({
      runId: "run-abort",
      run: { status: "aborted" },
      events: events({ type: "user-message", text: "hello" }),
      spans: twoToolSpans,
    });
    expect(result).toEqual({ ok: false, error: "run_not_completed" });
  });

  it("refuses a missing run", () => {
    const result = promoteTraceToEval({
      runId: "run-missing",
      run: null,
      events: events({ type: "user-message", text: "hello" }),
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a completed run with no user prompt", () => {
    const result = promoteTraceToEval({
      runId: "run-noprompt",
      run: { status: "completed" },
      events: events({ type: "text-delta", text: "I spoke first" }),
      spans: twoToolSpans,
    });
    expect(result).toEqual({ ok: false, error: "no_user_prompt" });
  });

  it("adds contains(mustContain) when the tool list is empty", () => {
    const result = promoteTraceToEval({
      runId: "run-needle",
      run: { status: "completed" },
      events: events({ type: "user-message", text: "What is the policy?" }),
      spans: [],
      options: { mustContain: "30 days" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spec.scorers).toEqual([
      { type: "contains", needle: "30 days" },
    ]);
    expect(result.value.eval.scorers[0]?.name).toBe("contains");
  });

  it("returns no_signal when there are neither tools nor mustContain", () => {
    const result = promoteTraceToEval({
      runId: "run-empty",
      run: { status: "completed" },
      events: events({ type: "user-message", text: "hello" }),
      spans: [],
    });
    expect(result).toEqual({ ok: false, error: "no_signal" });
  });

  it("deduplicates tools and caps at 8", () => {
    const spans: PromoteTraceSpan[] = Array.from({ length: 12 }, (_, i) => ({
      spanType: "tool_call",
      name: `tool-${i}`,
      status: "success" as const,
    }));
    spans.splice(1, 0, {
      spanType: "tool_call",
      name: "tool-0",
      status: "success",
    });
    const result = promoteTraceToEval({
      runId: "run-noisy",
      run: { status: "completed" },
      events: events({ type: "user-message", text: "do many things" }),
      spans,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spec.scorers).toHaveLength(8);
    expect(result.value.spec.scorers[0]).toEqual({
      type: "usesTool",
      toolName: "tool-0",
    });
    expect(result.value.spec.scorers[1]).toEqual({
      type: "usesTool",
      toolName: "tool-1",
    });
  });

  it("emits a loadable defineEval module", () => {
    const result = promoteTraceToEval({
      runId: "run-write",
      run: { status: "completed" },
      events: events({ type: "user-message", text: "Search then reply" }),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
      options: { mustContain: "found it" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const source = generateEvalModuleSource(result.value.spec);
    expect(source).toContain(
      'import { defineEval, usesTool, contains } from "@agent-native/core/eval";',
    );
    expect(source).toContain("export default defineEval(");
    expect(source).toContain('usesTool("search-docs")');
    expect(source).toContain('contains("found it")');
    expect(source).toContain('source: { kind: "trace", runId: "run-write" }');
  });
});
