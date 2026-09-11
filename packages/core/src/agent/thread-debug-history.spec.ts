import { describe, expect, it } from "vitest";

import {
  appendThreadDebugHistory,
  hashThreadDebugPrompt,
  MAX_THREAD_DEBUG_RUNS,
} from "./thread-debug-history.js";

describe("appendThreadDebugHistory", () => {
  it("migrates duplicate full prompts into one dictionary entry", () => {
    const prompt = "same system prompt";
    const threadData = {
      custom: { preserved: true },
      _debug: {
        runId: "run-2",
        systemPrompt: prompt,
        legacyCurrentField: "keep",
      },
      _debugRuns: [
        {
          runId: "run-1",
          systemPrompt: prompt,
          legacyRunField: "keep",
        },
        {
          runId: "run-2",
          systemPrompt: prompt,
        },
      ],
    };

    const result = appendThreadDebugHistory(threadData, {
      runId: "run-3",
      systemPrompt: prompt,
      model: "gpt-5-6-terra",
      currentField: "keep",
    });
    const promptHash = hashThreadDebugPrompt(prompt);

    expect(result.custom).toEqual({ preserved: true });
    expect(result._debugPrompts).toEqual({ [promptHash]: prompt });
    expect(result._debug).toEqual({
      runId: "run-3",
      systemPromptHash: promptHash,
      model: "gpt-5-6-terra",
      currentField: "keep",
    });
    expect(result._debugRuns).toEqual([
      {
        runId: "run-1",
        systemPromptHash: promptHash,
        legacyRunField: "keep",
      },
      {
        runId: "run-2",
        systemPromptHash: promptHash,
      },
      {
        runId: "run-3",
        systemPromptHash: promptHash,
        model: "gpt-5-6-terra",
        currentField: "keep",
      },
    ]);
    expect(threadData._debugRuns[0]).toHaveProperty("systemPrompt", prompt);
  });

  it("keeps 50 lightweight runs and prunes prompts they no longer reference", () => {
    const oldPrompt = "prompt-0";
    const threadData = {
      topLevelUnknown: "keep",
      _debugPrompts: {
        [hashThreadDebugPrompt("already-unreferenced")]: "already-unreferenced",
      },
      _debugRuns: Array.from({ length: MAX_THREAD_DEBUG_RUNS }, (_, index) => ({
        runId: `run-${index}`,
        systemPrompt: `prompt-${index}`,
        unknown: index,
      })),
    };

    const result = appendThreadDebugHistory(threadData, {
      runId: "run-current",
      systemPrompt: "prompt-current",
    });
    const runs = result._debugRuns as Array<Record<string, unknown>>;
    const prompts = result._debugPrompts as Record<string, string>;

    expect(runs).toHaveLength(MAX_THREAD_DEBUG_RUNS);
    expect(runs[0]).toMatchObject({ runId: "run-1", unknown: 1 });
    expect(runs.at(-1)).toMatchObject({ runId: "run-current" });
    expect(prompts).toHaveProperty(
      hashThreadDebugPrompt("prompt-current"),
      "prompt-current",
    );
    expect(prompts).not.toHaveProperty(hashThreadDebugPrompt(oldPrompt));
    expect(prompts).not.toHaveProperty(
      hashThreadDebugPrompt("already-unreferenced"),
    );
    expect(Object.keys(prompts)).toHaveLength(MAX_THREAD_DEBUG_RUNS);
    expect(result.topLevelUnknown).toBe("keep");
  });

  it("preserves already compacted entries and their referenced prompts", () => {
    const priorPrompt = "prior prompt";
    const priorHash = hashThreadDebugPrompt(priorPrompt);
    const result = appendThreadDebugHistory(
      {
        _debugPrompts: { [priorHash]: priorPrompt },
        _debugRuns: [
          {
            runId: "run-prior",
            systemPromptHash: priorHash,
            futureField: { keep: true },
          },
        ],
      },
      {
        runId: "run-current",
        engine: "builder",
      },
    );

    expect(result._debugPrompts).toEqual({ [priorHash]: priorPrompt });
    expect(result._debugRuns).toEqual([
      {
        runId: "run-prior",
        systemPromptHash: priorHash,
        futureField: { keep: true },
      },
      {
        runId: "run-current",
        engine: "builder",
      },
    ]);
    expect(result._debug).toEqual({
      runId: "run-current",
      engine: "builder",
    });
  });
});
