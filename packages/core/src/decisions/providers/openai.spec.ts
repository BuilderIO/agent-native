import { afterEach, describe, expect, it, vi } from "vitest";

import type { DecisionQuestion } from "../types.js";
import { requestOpenAiDecision } from "./openai.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestOpenAiDecision", () => {
  it("sends JSON evidence as input_json without stringifying it", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json({ answers: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const questions: DecisionQuestion[] = [
      {
        type: "predicate",
        name: "duplicate",
        instructions: "Does the ticket describe a duplicate charge?",
      },
    ];
    await requestOpenAiDecision({
      input: [
        { type: "text", text: "Evaluate the ticket." },
        { type: "json", value: { chargeIds: ["charge-a", "charge-b"] } },
      ],
      questions,
      apiKey: "test-key",
      timeoutMs: 10_000,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      input?: Array<{ content?: unknown[] }>;
    };
    expect(body.input?.[0]?.content).toEqual([
      { type: "input_text", text: "Evaluate the ticket." },
      {
        type: "input_json",
        data: { chargeIds: ["charge-a", "charge-b"] },
      },
    ]);
  });
});
