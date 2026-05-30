import { describe, it, expect, beforeEach, vi } from "vitest";

// feedback.ts has two real surfaces worth testing:
//  1. submitFeedback — input validation + the persisted entry shape, and
//     that userId scoping reaches the row.
//  2. computeSatisfactionScore — a deterministic frustration heuristic
//     built from several sub-scores (rephrasing, abandonment, sentiment,
//     length trend, retry). These are pure functions of the thread's
//     messages, so we drive them by stubbing the thread_data read and
//     assert on the resulting score breakdown. No LLM, no network.
//
// We use the capturing/mock-DB pattern: the only DB read feedback.ts
// performs is `SELECT thread_data FROM chat_threads`, which we control
// per-test so we can shape the conversation.

const insertFeedback = vi.hoisted(() => vi.fn());
const upsertSatisfactionScore = vi.hoisted(() => vi.fn());
const ensureObservabilityTables = vi.hoisted(() => vi.fn());

// threadData is the JSON string returned for the chat_threads row.
let threadData: string | null = null;

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  insertFeedback: (...args: unknown[]) => insertFeedback(...args),
  upsertSatisfactionScore: (...args: unknown[]) =>
    upsertSatisfactionScore(...args),
  ensureObservabilityTables: (...args: unknown[]) =>
    ensureObservabilityTables(...args),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

const { submitFeedback, computeSatisfactionScore } =
  await import("./feedback.js");

function setThread(messages: unknown[] | null): void {
  threadData = messages === null ? null : JSON.stringify({ messages });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertFeedback.mockResolvedValue(undefined);
  upsertSatisfactionScore.mockResolvedValue(undefined);
  ensureObservabilityTables.mockResolvedValue(undefined);
  threadData = null;
  mockExecute.mockImplementation(async () => ({
    rows: threadData === null ? [] : [{ thread_data: threadData }],
  }));
});

describe("submitFeedback", () => {
  it("rejects a missing threadId", async () => {
    await expect(
      submitFeedback({ threadId: "", feedbackType: "thumbs_up" }),
    ).rejects.toThrow(/threadId is required/);
    expect(insertFeedback).not.toHaveBeenCalled();
  });

  it("rejects an unknown feedbackType", async () => {
    await expect(
      submitFeedback({
        threadId: "t1",
        feedbackType: "explosion" as any,
      }),
    ).rejects.toThrow(/Invalid feedbackType/);
    expect(insertFeedback).not.toHaveBeenCalled();
  });

  it("persists a fully-formed entry with defaults and the owner userId", async () => {
    const entry = await submitFeedback({
      threadId: "t1",
      feedbackType: "thumbs_down",
      userId: "alice",
    });

    expect(insertFeedback).toHaveBeenCalledTimes(1);
    const persisted = insertFeedback.mock.calls[0][0];
    // Defaults: runId/messageSeq null, value "".
    expect(persisted).toMatchObject({
      threadId: "t1",
      feedbackType: "thumbs_down",
      userId: "alice",
      runId: null,
      messageSeq: null,
      value: "",
    });
    expect(typeof persisted.id).toBe("string");
    expect(typeof persisted.createdAt).toBe("number");
    // submitFeedback returns the same entry it stored.
    expect(entry).toEqual(persisted);
  });

  it("defaults userId to null when no auth context is supplied", async () => {
    await submitFeedback({ threadId: "t1", feedbackType: "category" });
    expect(insertFeedback.mock.calls[0][0].userId).toBeNull();
  });
});

describe("computeSatisfactionScore", () => {
  it("returns an all-zero (content) score for a clean, successful thread", async () => {
    setThread([
      { role: "user", content: "Please write a detailed project plan" },
      {
        role: "assistant",
        content: "Sure, here is a thorough plan with milestones...",
      },
    ]);

    const score = await computeSatisfactionScore("t1", { userId: "alice" });

    expect(score.rephrasingScore).toBe(0); // <2 user msgs
    expect(score.abandonmentScore).toBe(0); // ends with assistant
    expect(score.sentimentScore).toBe(0); // no negative patterns, not terse
    expect(score.lengthTrendScore).toBe(0); // <3 user msgs
    expect(score.frustrationScore).toBe(0);
    expect(score.userId).toBe("alice");
    expect(score.id).toBe("sat-t1");
    expect(upsertSatisfactionScore).toHaveBeenCalledTimes(1);
  });

  it("flags abandonment when the thread ends on an unanswered user message", async () => {
    setThread([{ role: "user", content: "Can you help me with the report?" }]);

    const score = await computeSatisfactionScore("t1");

    // computeAbandonmentScore => 80 when last message is from the user.
    expect(score.abandonmentScore).toBe(80);
    // Composite weights abandonment at 0.2 => 16, but sentiment also
    // fires here? "Can you help me with the report?" has no negative
    // pattern and is not terse, so only abandonment contributes.
    expect(score.frustrationScore).toBe(16);
    expect(score.userId).toBeNull();
  });

  it("scores rephrasing high when consecutive user messages are near-identical", async () => {
    const q = "how do i export the analytics dashboard to a pdf file";
    setThread([
      { role: "user", content: q },
      { role: "assistant", content: "..." },
      { role: "user", content: q }, // identical => jaccard 1.0
      { role: "assistant", content: "..." },
    ]);

    const score = await computeSatisfactionScore("t1");

    // Two identical user messages: peak similarity 1.0, ratio 1/1=1.
    // rephrasing = (1.0*60 + 1*40) = 100.
    expect(score.rephrasingScore).toBe(100);
    expect(score.frustrationScore).toBeGreaterThan(0);
  });

  it("detects negative sentiment from explicit frustration phrases", async () => {
    setThread([
      { role: "user", content: "no that's not what I asked for" },
      { role: "assistant", content: "..." },
      { role: "user", content: "still wrong, this is useless" },
      { role: "assistant", content: "..." },
    ]);

    const score = await computeSatisfactionScore("t1");

    // BUG: computeSentimentScore double-scales — the formula is
    //   Math.min(100, (negativeRatio * 70 + terseRatio * 30) * 100)
    // where negativeRatio/terseRatio are already in [0,1]. The trailing
    // `* 100` means a single matching message already yields 70*100=7000,
    // which clamps to 100. So sentiment saturates at 100 the moment ANY
    // negative phrase appears, making the 70/30 sub-weights meaningless.
    // Asserting the current (buggy) saturated value; see bugsFound.
    expect(score.sentimentScore).toBe(100);
  });

  it("treats short final user replies as mild abandonment", async () => {
    setThread([
      { role: "user", content: "Give me a long answer about widgets please" },
      { role: "assistant", content: "Here is a long answer..." },
      { role: "user", content: "ok" }, // short (<15 chars)
      { role: "assistant", content: "Anything else?" },
    ]);

    const score = await computeSatisfactionScore("t1");
    // Ends with assistant; second-to-last user msg "ok" is <15 chars => 40.
    expect(score.abandonmentScore).toBe(40);
  });

  it("scores a length downtrend (messages getting shorter) as frustration", async () => {
    setThread([
      {
        role: "user",
        content:
          "I would like a comprehensive walkthrough of the entire onboarding flow with examples",
      },
      { role: "assistant", content: "..." },
      { role: "user", content: "show me the second step in more detail" },
      { role: "assistant", content: "..." },
      { role: "user", content: "next" },
      { role: "assistant", content: "..." },
    ]);

    const score = await computeSatisfactionScore("t1");
    // Lengths strictly decreasing => negative slope => >0.
    expect(score.lengthTrendScore).toBeGreaterThan(0);
  });

  it("scores retry phrasing as frustration", async () => {
    setThread([
      { role: "user", content: "make me a logo" },
      { role: "assistant", content: "..." },
      { role: "user", content: "try again, that's wrong" },
      { role: "assistant", content: "..." },
    ]);

    const score = await computeSatisfactionScore("t1");
    // 1 of 2 user msgs hits a RETRY pattern => ratio .5 * 150 = 75.
    // retry contributes 0.2 weight => at least 15 toward frustration.
    expect(score.frustrationScore).toBeGreaterThanOrEqual(15);
  });

  it("returns all zeros and still upserts when the thread has no messages", async () => {
    setThread(null); // no chat_threads row at all

    const score = await computeSatisfactionScore("t1");

    expect(score.frustrationScore).toBe(0);
    expect(score.rephrasingScore).toBe(0);
    expect(score.abandonmentScore).toBe(0);
    expect(upsertSatisfactionScore).toHaveBeenCalledTimes(1);
  });

  it("tolerates malformed thread_data JSON without throwing", async () => {
    threadData = "{ this is not valid json";

    const score = await computeSatisfactionScore("t1");
    expect(score.frustrationScore).toBe(0);
  });

  it("clamps the composite frustration score at 100", async () => {
    // Maximize every sub-score: identical negative+retry messages that
    // also shrink in length and abandon at the end.
    const long = "no that is wrong, try again, this is completely useless x";
    setThread([
      { role: "user", content: long },
      { role: "assistant", content: "..." },
      { role: "user", content: long },
      { role: "assistant", content: "..." },
      { role: "user", content: "no" },
    ]);

    const score = await computeSatisfactionScore("t1");
    expect(score.frustrationScore).toBeLessThanOrEqual(100);
  });

  it("reads thread_data scoped by threadId (parameterized, no injection)", async () => {
    setThread([{ role: "user", content: "hi" }]);
    await computeSatisfactionScore("thread-xyz");

    const call = mockExecute.mock.calls[0][0];
    expect(call.sql).toMatch(
      /SELECT thread_data FROM chat_threads WHERE id = \?/,
    );
    expect(call.args).toEqual(["thread-xyz"]);
  });

  it("parses structured (array-of-parts) message content", async () => {
    setThread([
      {
        role: "user",
        content: [
          { type: "text", text: "first part " },
          { type: "image", url: "x" },
          { type: "text", text: "second part" },
        ],
      },
      { role: "assistant", content: "ok" },
    ]);

    // If the text parts were joined correctly it's a normal sentence,
    // not terse — sentiment stays 0. This exercises the content mapper.
    const score = await computeSatisfactionScore("t1");
    expect(score.sentimentScore).toBe(0);
  });
});
