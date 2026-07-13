import { beforeEach, describe, expect, it, vi } from "vitest";

// `hasCompletedFirstSessionPersonalization` is a plain module-level function
// in agent-chat-plugin.ts (it was hoisted out of the per-request plugin
// closure specifically so it's unit-testable here without booting the whole
// plugin — see its doc comment in agent-chat-plugin.ts). The only external
// dependency it has is `appStateGet`, so that's the only mock this file needs;
// agent-chat-plugin.ts's other top-level imports are already proven safe to
// import unmocked by agent-chat-plugin.surface.spec.ts.
const appStateGetMock = vi.hoisted(() => vi.fn());

vi.mock("../application-state/store.js", () => ({
  appStateGet: (...args: any[]) => appStateGetMock(...args),
}));

import { hasCompletedFirstSessionPersonalization } from "./agent-chat-plugin.js";
import { FIRST_SESSION_PERSONALIZATION } from "./prompts/index.js";

/**
 * Mirrors the exact ternary in agent-chat-plugin.ts's prod/dev `systemPrompt`
 * callbacks: `(await hasCompletedFirstSessionPersonalization(owner)) ? "" :
 * FIRST_SESSION_PERSONALIZATION`. Used here to assert on the actual system
 * prompt segment produced for a request, not just the boolean.
 */
async function personalizationBlockFor(owner: string): Promise<string> {
  return (await hasCompletedFirstSessionPersonalization(owner))
    ? ""
    : FIRST_SESSION_PERSONALIZATION;
}

describe("hasCompletedFirstSessionPersonalization", () => {
  beforeEach(() => {
    appStateGetMock.mockReset();
  });

  it("turn 1 and turn 2 of the same thread produce identical system-prompt personalization segments", async () => {
    // Neither turn 1 nor turn 2 has completed the flow yet: the flow spans
    // two turns (turn 1 asks and waits, turn 2 answers and only THEN writes
    // the "done" flag) — the write happens mid-turn-2's tool calls, strictly
    // after this turn's system prompt was already assembled. So the
    // appstate read at prompt-assembly time is still absent for BOTH turns.
    appStateGetMock.mockResolvedValue(null);

    const owner = "user@example.test";
    const turn1Done = await hasCompletedFirstSessionPersonalization(owner);
    const turn2Done = await hasCompletedFirstSessionPersonalization(owner);

    expect(turn1Done).toBe(false);
    expect(turn2Done).toBe(false);

    const turn1Block = await personalizationBlockFor(owner);
    const turn2Block = await personalizationBlockFor(owner);

    // The actual regression this replaces the old `isNewThread()` gate for:
    // turn 1 and turn 2 must render the identical system-prompt segment so
    // the prompt-cache prefix survives into the thread's second request.
    expect(turn1Block).toBe(turn2Block);
    expect(turn1Block).toBe(FIRST_SESSION_PERSONALIZATION);
  });

  it("stops including the block once the agent records done:true, and never reverts", async () => {
    const owner = "user@example.test";

    appStateGetMock.mockResolvedValueOnce(null); // turn 1
    appStateGetMock.mockResolvedValueOnce(null); // turn 2 (pre-write)
    appStateGetMock.mockResolvedValue({ done: true }); // turn 3 onward

    const turn1 = await personalizationBlockFor(owner);
    const turn2 = await personalizationBlockFor(owner);
    const turn3 = await personalizationBlockFor(owner);
    const turn4 = await personalizationBlockFor(owner);

    expect(turn1).toBe(FIRST_SESSION_PERSONALIZATION);
    expect(turn2).toBe(FIRST_SESSION_PERSONALIZATION);
    expect(turn3).toBe("");
    expect(turn4).toBe("");
  });

  it("a later thread created by the same owner never re-shows the block once done", async () => {
    // Unlike the old `isNewThread()` gate (per-thread, re-triggered on turn 1
    // of every new thread), this is owner-scoped: once true, it stays true
    // for every thread the same owner creates afterward.
    appStateGetMock.mockResolvedValue({ done: true });

    const owner = "user@example.test";
    expect(await personalizationBlockFor(owner)).toBe("");
    expect(await personalizationBlockFor(owner)).toBe("");
  });

  it("fails open to 'not done' (block shown) when the appstate read errors", async () => {
    appStateGetMock.mockRejectedValue(new Error("transient db error"));

    expect(
      await hasCompletedFirstSessionPersonalization("user@example.test"),
    ).toBe(false);
  });

  it("treats a missing or falsy done flag as not completed", async () => {
    for (const value of [null, {}, { done: false }, { done: "true" }]) {
      appStateGetMock.mockResolvedValueOnce(value);
      expect(
        await hasCompletedFirstSessionPersonalization("user@example.test"),
      ).toBe(false);
    }
  });
});
