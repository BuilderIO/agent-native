import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ decide: vi.fn() }));

vi.mock("../decide.js", () => ({ decide: mocks.decide }));

import type { ActionRunContext } from "../../action.js";
import action from "./decide.js";

const args = {
  input: [{ type: "json" as const, value: { task: "Sort this request" } }],
  questions: [
    {
      type: "score" as const,
      name: "priority",
      instructions: "Rate the priority.",
      levels: [
        { label: "low", description: "Can wait" },
        { label: "high", description: "Needs attention soon" },
      ],
    },
  ],
  options: {
    timeoutMs: 5_000,
    providers: ["openai" as const],
    cacheKey: "priority-sort",
  },
};

function context(
  userEmail: string | undefined,
  signal?: AbortSignal,
): ActionRunContext {
  return {
    caller: "frontend",
    actionName: "decide",
    userEmail,
    ...(signal ? { signal } : {}),
  };
}

describe("decision action", () => {
  beforeEach(() => {
    mocks.decide.mockReset();
  });

  it("describes verified score support through the Builder Jev proxy", () => {
    expect(action.tool.description).toContain(
      "Builder Jev proxy is verified for predicate, choice, and score questions",
    );
  });

  it("passes the authenticated request and score question to decide", async () => {
    const signal = new AbortController().signal;
    const result = {
      status: "ok" as const,
      provider: "openai" as const,
      model: "gpt-6-luna",
      answers: {
        priority: {
          type: "score" as const,
          name: "priority",
          score: 2,
          levels: [
            {
              value: 1,
              label: "low",
              description: "Can wait",
            },
            {
              value: 2,
              label: "high",
              description: "Needs attention soon",
            },
          ],
        },
      },
    };
    mocks.decide.mockResolvedValue(result);

    await expect(
      action.run(args, context("owner@example.test", signal)),
    ).resolves.toEqual(result);
    expect(mocks.decide).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      input: args.input,
      questions: args.questions,
      options: {
        timeoutMs: 5_000,
        providers: ["openai"],
        cacheKey: "priority-sort",
        signal,
      },
    });
    expect(action.outputSchema?.parse(result)).toEqual(result);
  });

  it("rejects callers without an email before invoking the decision service", async () => {
    await expect(action.run(args, context(undefined))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
