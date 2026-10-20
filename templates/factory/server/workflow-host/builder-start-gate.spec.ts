import { BuilderBranchError } from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

import type { InboxResult } from "../workflow/adapter.js";
import {
  minutesAfter,
  normalizedItem,
} from "../workflow/testing/engine-fixtures.js";
import {
  aiPerItem,
  aiRouter,
  aiWholeList,
  ok,
  type AiResponder,
  type ScriptedOperation,
} from "../workflow/testing/fakes.js";
import {
  runStoryScript,
  type StoryStep,
} from "../workflow/testing/story-harness.js";
import {
  executeBuilderOperation,
  type BuilderOperationDeps,
} from "./builder-operations.js";

// Story 1 end to end with the real `builder.start` behind it: the graph binds
// the gate's inputs, the operation judges them, and a refusal never reaches
// Builder. Everything else is the story harness's fakes.

const THREAD = { channelId: "C0FEEDBACK", threadTs: "1760000000.000100" };
const report = normalizedItem("m1", {
  kind: "message",
  provider: "slack",
  title: "Checkout button does nothing",
  text: "Clicking Pay does nothing.",
  author: "reporter@example.test",
  thread: THREAD,
});

const assessment = {
  clearBug: true,
  enoughContext: true,
  risk: "low",
  confidence: "high",
  productUxImplications: false,
  alreadyClaimed: false,
  categories: [],
  reason: "Reproducible from the report.",
};

function fakeBuilder() {
  const startAgent = vi.fn(async (args: { branchName?: string }) => ({
    branchName: args.branchName ?? "",
    projectId: "project-1",
    url: "https://builder.test/branches/x",
    status: "processing",
  }));
  const getStatus = vi.fn(async () => {
    throw new BuilderBranchError("branch_not_found", "status", "none");
  });
  const deps = {
    startAgent,
    getStatus,
    sendMessage: vi.fn(),
    now: () => new Date("2026-10-19T12:00:00.000Z"),
    stuckAfterMs: 30 * 60_000,
  } as unknown as BuilderOperationDeps;
  return { startAgent, getStatus, deps };
}

/** The real operation, behind the harness's provider seam. */
function realBuilderStart(deps: BuilderOperationDeps): ScriptedOperation {
  return (request) =>
    executeBuilderOperation({
      operation: request.operation,
      fields: request.fields,
      owner: "owner@example.test",
      signal: request.signal,
      deps,
    });
}

const slackAnswer: ScriptedOperation = (request) =>
  ok(
    {
      ok: true,
      channel: String(request.fields.channel ?? "C0X"),
      ts: "1760001000.000001",
      threadTs: null,
      permalink: "https://slack.test/archives/C0X/p1",
    },
    { externalRef: "1760001000.000001", url: "https://slack.test/x" },
  );

function groupModel(
  group: (assessed: Record<string, unknown>) => Record<string, unknown>,
): AiResponder {
  return aiRouter([
    {
      when: "Assess whether this report is a clear bug",
      respond: aiPerItem(() => assessment),
    },
    {
      when: "Group related bugs",
      respond: (request) =>
        aiWholeList({
          groups: request.items.map((item) => ({
            id: item.id,
            groupId: `g-${item.id}`,
            thread: item.item.thread,
            author: item.item.author,
            ...group(item.nodes.assess as Record<string, unknown>),
          })),
        })(request),
    },
    {
      when: "Summarize the bug for Builder",
      respond: aiPerItem(() => ({ prompt: "Fix the checkout button." })),
    },
  ]);
}

async function run(
  deps: BuilderOperationDeps,
  group: (assessed: Record<string, unknown>) => Record<string, unknown>,
) {
  const offered: InboxResult = { ok: true, items: [report] };
  const steps: StoryStep[] = [
    {
      kind: "provider",
      operation: "slack.readThread",
      thenAlways: ok({ messages: [] }),
    },
    {
      kind: "provider",
      operation: "slack.replyInThread",
      thenAlways: slackAnswer,
    },
    {
      kind: "provider",
      operation: "slack.postMessage",
      thenAlways: slackAnswer,
    },
    {
      kind: "provider",
      operation: "factory.listItems",
      thenAlways: ok({ items: [] }),
    },
    {
      kind: "provider",
      operation: "builder.start",
      thenAlways: realBuilderStart(deps),
    },
    { kind: "ai", thenAlways: groupModel(group) },
    {
      kind: "inbox",
      source: "inbox-poll",
      results: [offered],
      thenAlways: { ok: true, items: [] },
    },
    { kind: "tick", at: minutesAfter(0) },
  ];
  return runStoryScript("bug-report-to-builder", { steps });
}

const stepOf = (
  transcript: Awaited<ReturnType<typeof run>>,
  nodeId: string,
) => {
  const step = transcript.ticks[0].steps.find(
    (entry) => entry.nodeId === nodeId,
  );
  if (!step) throw new Error(`No step for ${nodeId}`);
  return step;
};

describe("story 1 with the real builder.start", () => {
  it("starts Builder when the group the model made passes the gate", async () => {
    const builder = fakeBuilder();

    const result = await run(builder.deps, (assessed) => ({
      clearBug: assessed.clearBug,
      risk: assessed.risk,
      confidence: assessed.confidence,
      productUxImplications: assessed.productUxImplications,
      alreadyClaimed: assessed.alreadyClaimed,
      categories: assessed.categories,
    }));

    expect(builder.startAgent).toHaveBeenCalledTimes(1);
    expect(builder.startAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        branchName: "factory-g-m1",
        userEmail: "reporter@example.test",
      }),
    );
    expect(stepOf(result, "startBuilder").status).toBe("succeeded");
    expect(result.statuses).toEqual({ m1: "automation_started" });
    // Every model turn the engine asks for names the run it belongs to, so the
    // tripwire events the turn records can be tied back to it.
    const [tick] = result.ticks;
    expect(tick.aiRequests.length).toBeGreaterThan(0);
    for (const turn of tick.aiRequests) expect(turn.runId).toBe(tick.runId);
  });

  it("starts one task for work that is reported again, because the gate never sees other reports and the branch name is the duplicate key", async () => {
    const started = new Set<string>();
    const startAgent = vi.fn(async (args: { branchName?: string }) => {
      started.add(args.branchName ?? "");
      return {
        branchName: args.branchName ?? "",
        projectId: "project-1",
        url: "https://builder.test/branches/x",
        status: "processing",
      };
    });
    const getStatus = vi.fn(async (args: { branchName: string }) => {
      if (!started.has(args.branchName)) {
        throw new BuilderBranchError("branch_not_found", "status", "none");
      }
      return { state: "active", agentState: "running", archived: false };
    });
    const deps = {
      startAgent,
      getStatus,
      sendMessage: vi.fn(),
      now: () => new Date("2026-10-19T12:00:00.000Z"),
      stuckAfterMs: 30 * 60_000,
    } as unknown as BuilderOperationDeps;
    const passes = (assessed: Record<string, unknown>) => ({
      clearBug: assessed.clearBug,
      risk: assessed.risk,
      confidence: assessed.confidence,
      productUxImplications: assessed.productUxImplications,
      alreadyClaimed: assessed.alreadyClaimed,
      categories: assessed.categories,
    });

    const first = await run(deps, passes);
    const again = await run(deps, passes);

    expect(startAgent).toHaveBeenCalledTimes(1);
    expect(stepOf(first, "startBuilder").status).toBe("succeeded");
    expect(stepOf(again, "startBuilder").status).toBe("succeeded");
    expect(again.statuses).toEqual({ m1: "automation_started" });
  });

  it("never contacts Builder when the group states a risk or a category the gate refuses", async () => {
    const builder = fakeBuilder();

    const result = await run(builder.deps, (assessed) => ({
      clearBug: assessed.clearBug,
      risk: "medium",
      confidence: assessed.confidence,
      productUxImplications: assessed.productUxImplications,
      alreadyClaimed: assessed.alreadyClaimed,
      categories: ["auth"],
    }));

    expect(builder.startAgent).not.toHaveBeenCalled();
    expect(builder.getStatus).not.toHaveBeenCalled();
    const start = stepOf(result, "startBuilder");
    expect(start.status).toBe("failed");
    expect(start.error).toMatchObject({ code: "operation_not_allowed" });
    expect(start.error?.message).toContain("risk_not_low");
    expect(start.error?.message).toContain("never_automate_category");
    // The reporter was not told Builder had started, and nothing was handed off.
    expect(stepOf(result, "tell").ports.out.count).toBe(0);
    // The refusal is final, so the report is with a person rather than waiting for another try.
    expect(result.statuses).toEqual({ m1: "needs_manual" });
  });

  it("refuses a group that leaves a gate input out, instead of reading it as clean", async () => {
    const builder = fakeBuilder();

    const result = await run(builder.deps, () => ({
      clearBug: true,
      risk: "low",
      confidence: "high",
      productUxImplications: false,
      alreadyClaimed: false,
      // no `categories`
    }));

    expect(builder.startAgent).not.toHaveBeenCalled();
    const start = stepOf(result, "startBuilder");
    expect(start.status).toBe("failed");
    expect(start.error).toMatchObject({ code: "expression_failed" });
    expect(start.error?.message).toContain("categories");
  });
});
