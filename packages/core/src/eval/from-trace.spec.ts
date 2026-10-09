import { describe, expect, it } from "vitest";

import {
  generateEvalModuleSource,
  promoteTraceToEval,
  promotedDatasetIdempotencyKey,
  promotedEvalSpecFromDataset,
  PROMOTED_EVAL_PRIVACY_VERSION,
  type PromoteTraceEvent,
  type PromoteTraceSpan,
} from "./from-trace.js";
import type { AgentRunOutput } from "./types.js";

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
    expect(result.value.eval.input.prompt).toBe("[redacted production prompt]");
    expect(result.value.eval.threshold).toBe(0.5);
    expect(result.value.eval.source).toEqual({
      kind: "trace",
      runId: "run-abcdef123456",
    });
    expect(result.value.eval.scorers.map((s) => s.name)).toEqual([
      "uses_tool_success:search-docs",
      "uses_tool_success:create-item",
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
    expect(result.value.dataset.idempotencyKey).toBe(
      "from-trace:v3::run-abcdef123456",
    );
    expect(result.value.dataset.entries[0]?.context).toMatchObject({
      privacyVersion: PROMOTED_EVAL_PRIVACY_VERSION,
    });
    expect(result.value.dataset.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(
      promotedEvalSpecFromDataset(result.value.dataset, "run-abcdef123456"),
    ).toEqual(result.value.spec);
  });

  it("keys the dataset by owner and source run", () => {
    const result = promoteTraceToEval({
      runId: "run-with-space",
      run: { status: "completed" },
      events: events({ type: "user-message", text: "hello" }),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
      options: { userId: "alice@example.com" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dataset.idempotencyKey).toBe(
      promotedDatasetIdempotencyKey("run-with-space", "alice@example.com"),
    );
    expect(result.value.dataset.userId).toBe("alice@example.com");
  });

  it("does not copy trace prompt or assistant text into the promoted eval", () => {
    const result = promoteTraceToEval({
      runId: "run-hist",
      run: { status: "completed" },
      events: events(
        { type: "text", text: "Welcome back." },
        {
          type: "user-message",
          text: "Now search docs for Alice Smith at Builder.io",
        },
        { type: "tool_done", tool: "search-docs", result: "ok" },
      ),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eval.input).toEqual({
      prompt: "[redacted production prompt]",
    });
    expect(JSON.stringify(result.value)).not.toContain("Alice Smith");
    expect(JSON.stringify(result.value)).not.toContain("Builder.io");
    expect(JSON.stringify(result.value)).not.toContain("Welcome back.");
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
      { type: "contains", needle: "[number] days" },
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

  it("reads the prompt from a persisted thread when the run events have no user-message", () => {
    // Shape produced by persistSubmittedUserMessage → buildUserMessage and
    // onRunComplete → buildAssistantMessage / foldAssistantTurn. Run events
    // are the AgentChatEvent variants the loop actually persists.
    const runId = "run-abcdef123456";
    const result = promoteTraceToEval({
      runId,
      run: { status: "completed" },
      threadInput: {
        headId: `server-${runId}`,
        messages: [
          {
            message: {
              id: "server-user-run-prev",
              role: "user",
              content: [{ type: "text", text: "Who can help at Acme Corp?" }],
              metadata: { custom: { submittedRunId: "run-prev" } },
            },
            parentId: null,
          },
          {
            message: {
              id: "server-run-prev",
              role: "assistant",
              content: [{ type: "text", text: "I can file expenses." }],
              status: { type: "complete", reason: "stop" },
              metadata: {
                runId: "run-prev",
                custom: { foldedRunIds: ["run-prev"], turnId: "turn-prev" },
              },
            },
            parentId: "server-user-run-prev",
          },
          {
            message: {
              id: `server-user-${runId}`,
              role: "user",
              content: [
                {
                  type: "text",
                  text: "File an expense for Alice Smith at Builder.io",
                },
              ],
              metadata: { custom: { submittedRunId: runId } },
            },
            parentId: "server-run-prev",
          },
          {
            message: {
              id: `server-${runId}`,
              role: "assistant",
              content: [{ type: "text", text: "Filed it." }],
              status: { type: "complete", reason: "stop" },
              metadata: {
                runId,
                custom: { foldedRunIds: [runId], turnId: "turn-1" },
              },
            },
            parentId: `server-user-${runId}`,
          },
        ],
      },
      events: events(
        {
          type: "tool_start",
          tool: "search-docs",
          id: "call-1",
          input: { query: "lunch" },
        },
        {
          type: "tool_done",
          tool: "search-docs",
          id: "call-1",
          result: "ok",
        },
        { type: "text", text: "Filed it." },
        { type: "done" },
      ),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eval.input).toEqual({
      prompt: "[redacted production prompt]",
    });
    expect(JSON.stringify(result.value)).not.toContain("Alice Smith");
    expect(JSON.stringify(result.value)).not.toContain("Builder.io");
    expect(JSON.stringify(result.value)).not.toContain("Acme Corp");
    expect(JSON.stringify(result.value)).not.toContain("I can file expenses.");
    expect(result.value.spec.scorers).toEqual([
      { type: "usesTool", toolName: "search-docs" },
    ]);
  });

  it("uses the preceding user turn when this run is only a folded continuation", () => {
    const result = promoteTraceToEval({
      runId: "run-chunk-2",
      run: { status: "completed" },
      threadInput: JSON.stringify({
        messages: [
          {
            message: {
              id: "server-user-run-chunk-1",
              role: "user",
              content: [{ type: "text", text: "Finish the report" }],
              metadata: { custom: { submittedRunId: "run-chunk-1" } },
            },
            parentId: null,
          },
          {
            message: {
              id: "server-run-chunk-1",
              role: "assistant",
              content: [{ type: "text", text: "Done." }],
              metadata: {
                runId: "run-chunk-2",
                custom: {
                  turnId: "turn-9",
                  foldedRunIds: ["run-chunk-1", "run-chunk-2"],
                },
              },
            },
            parentId: "server-user-run-chunk-1",
          },
        ],
      }),
      events: events({ type: "text", text: "Done." }, { type: "done" }),
      spans: [],
      options: { mustContain: "Done" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eval.input).toEqual({
      prompt: "[redacted production prompt]",
    });
  });

  it("scrubs and bounds explicitly reviewer-redacted text before fixture output", () => {
    const result = promoteTraceToEval({
      runId: "run-private-text",
      run: { status: "completed" },
      events: events(
        {
          type: "user-message",
          text: "Search the account for Alice Example at alice@example.com",
        },
        {
          type: "tool_done",
          tool: "search-docs",
          result: "Found Alice Example",
        },
        { type: "text", text: "The record is available." },
      ),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
      options: {
        reviewedPrompt:
          "Search the account for alice@example.com or call +1 (415) 555-0199 at https://private.example/account",
        reviewedHistory: [
          { role: "user", text: "Use account id abcdefghijklmnop1234" },
        ],
        mustContain: "alice@example.com should be found",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fixture = generateEvalModuleSource(result.value.spec);
    const persisted = JSON.stringify({
      dataset: result.value.dataset,
      spec: result.value.spec,
      fixture,
    });
    expect(result.value.spec.input.prompt).toContain("[email]");
    expect(result.value.spec.input.prompt).toContain("[phone]");
    expect(result.value.spec.input.prompt).toContain("[url]");
    expect(result.value.spec.input.history?.[0]?.text).toContain("[id]");
    expect(result.value.spec.scorers).toContainEqual({
      type: "contains",
      needle: "[email] should be found",
    });
    expect(persisted).not.toContain("alice@example.com");
    expect(persisted).not.toContain("555-0199");
    expect(persisted).not.toContain("private.example");
    expect(persisted).not.toContain("abcdefghijklmnop1234");
    expect(persisted).not.toContain("Alice Example");
    expect(persisted).not.toContain("The record is available.");

    const longPrompt = promoteTraceToEval({
      runId: "run-bounded-text",
      run: { status: "completed" },
      events: events({ type: "user-message", text: "sensitive trace prompt" }),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
      options: { reviewedPrompt: "active ".repeat(600) },
    });
    expect(longPrompt.ok).toBe(true);
    if (longPrompt.ok) {
      expect(longPrompt.value.spec.input.prompt.length).toBeLessThanOrEqual(
        3_000,
      );
      expect(
        promotedEvalSpecFromDataset(
          longPrompt.value.dataset,
          "run-bounded-text",
        ),
      ).not.toBeNull();
    }
  });

  it.each([
    ["person name", "How many Alice Smith users last week?"],
    ["Steve's name", "How many users did Steve create last week?"],
    ["Brent's name", "How many users did Brent create last week?"],
    ["organization name", "How many Builder.io users last week?"],
    ["lowercase organization name", "How many acme corp users last week?"],
  ])("rejects reviewer text containing a %s", (_label, reviewedPrompt) => {
    const result = promoteTraceToEval({
      runId: "run-identity-review",
      run: { status: "completed" },
      events: events({ type: "user-message", text: "production prompt" }),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
      options: { reviewedPrompt },
    });

    expect(result).toEqual({ ok: false, error: "unsafe_reviewed_text" });
  });

  it("rejects names in reviewer-provided history and expected output", () => {
    for (const options of [
      {
        reviewedHistory: [
          { role: "user" as const, text: "Show Alice Smith users" },
        ],
      },
      { mustContain: "Acme Corp was found" },
    ]) {
      const result = promoteTraceToEval({
        runId: "run-history-identity",
        run: { status: "completed" },
        events: events({ type: "user-message", text: "production prompt" }),
        spans: [
          { spanType: "tool_call", name: "search-docs", status: "success" },
        ],
        options,
      });

      expect(result).toEqual({ ok: false, error: "unsafe_reviewed_text" });
    }
  });

  it("does not rebuild a spec from a dataset with an older privacy version", () => {
    expect(
      promotedEvalSpecFromDataset(
        {
          id: "legacy",
          name: "from-trace:run-legacy",
          description: "legacy",
          idempotencyKey: "from-trace:v2::run-legacy",
          entries: [
            {
              input: "Search for Alice Example",
              context: {
                runId: "run-legacy",
                history: [],
                tools: ["search-docs"],
                privacyVersion: 2,
              },
            },
          ],
          createdAt: 1,
          updatedAt: 1,
          userId: "alice@example.com",
        },
        "run-legacy",
      ),
    ).toBeNull();
  });

  it("does not score a legacy tool_done whose result starts with Error", () => {
    const result = promoteTraceToEval({
      runId: "run-legacy-err",
      run: { status: "completed" },
      events: events(
        { type: "user-message", text: "read the file" },
        {
          type: "tool_done",
          tool: "legacy-read",
          result: "Error: disk full",
        },
        {
          type: "tool_done",
          tool: "legacy-exec",
          result: "Error running legacy-exec: timeout",
        },
        { type: "tool_done", tool: "search-docs", result: "ok" },
      ),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spec.scorers).toEqual([
      { type: "usesTool", toolName: "search-docs" },
    ]);
  });

  it("does not score a tool whose span already records failure", () => {
    const result = promoteTraceToEval({
      runId: "run-span-err",
      run: { status: "completed" },
      events: events(
        { type: "user-message", text: "read the file" },
        { type: "tool_done", tool: "legacy-read", result: "ok-looking" },
        { type: "tool_done", tool: "search-docs", result: "ok" },
      ),
      spans: [
        { spanType: "tool_call", name: "legacy-read", status: "error" },
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spec.scorers).toEqual([
      { type: "usesTool", toolName: "search-docs" },
    ]);
  });

  it("does not pass when the replayed tool fails or never finishes", async () => {
    const result = promoteTraceToEval({
      runId: "run-tool-success",
      run: { status: "completed" },
      events: events({ type: "user-message", text: "Search then reply" }),
      spans: [
        { spanType: "tool_call", name: "search-docs", status: "success" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scorer = result.value.eval.scorers[0]!;
    const base = {
      text: "done",
      toolCalls: ["search-docs"],
      ok: true,
      runId: "eval:1",
      durationMs: 1,
    };
    const score = async (
      toolCallDetails: AgentRunOutput["toolCallDetails"],
    ) => {
      const analysis = await scorer.analyze!(
        { ...base, toolCallDetails },
        undefined as never,
      );
      return scorer.generateScore(analysis);
    };
    expect(
      await score([
        { name: "search-docs", input: {}, completed: true, isError: true },
      ]),
    ).toBe(0);
    expect(await score([{ name: "search-docs", input: {} }])).toBe(0);
    expect(await score(undefined)).toBe(0);
    expect(
      await score([
        { name: "search-docs", input: {}, completed: true, isError: false },
      ]),
    ).toBe(1);
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
      'import { defineEval, createScorer, contains } from "@agent-native/core/eval";',
    );
    expect(source).toContain("export default defineEval(");
    expect(source).toContain('usesToolSuccessfully("search-docs")');
    expect(source).toContain("call.completed === true");
    expect(source).toContain("call.isError !== true");
    expect(source).not.toContain("usesTool(");
    expect(source).toContain('contains("found it")');
    expect(source).toContain('source: { kind: "trace", runId: "run-write" }');
  });
});
