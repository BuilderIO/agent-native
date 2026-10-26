import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDecisionAnswers } from "../response.js";
import type { DecisionQuestion } from "../types.js";
import { requestOpenAiDecision } from "./openai.js";

const documentedScoreRequestFixture = {
  model: "gpt-6-luna",
  input: "Export fails in Safari but works in Chrome.",
  questions: [
    {
      type: "score",
      name: "severity",
      instructions: "How severe is this issue?",
      levels: [
        {
          label: "Cosmetic",
          description: "Appearance only; no lost functionality.",
        },
        {
          label: "Workaround available",
          description: "A task fails, but another way works.",
        },
        {
          label: "Fully blocked",
          description: "A task fails with no workaround.",
        },
      ],
    },
  ],
} satisfies {
  model: string;
  input: string;
  questions: DecisionQuestion[];
};

const documentedScoreResponseFixture = {
  answers: [
    {
      type: "score",
      name: "severity",
      score: 1.1,
      probabilities: [
        { value: 0, label: "Cosmetic", probability: 0.1 },
        { value: 1, label: "Workaround available", probability: 0.7 },
        { value: 2, label: "Fully blocked", probability: 0.2 },
      ],
      confidence: 0.55,
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
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

  it("matches the documented score request and response fixtures", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json(documentedScoreResponseFixture),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestOpenAiDecision({
      input: documentedScoreRequestFixture.input,
      questions: documentedScoreRequestFixture.questions,
      apiKey: "fake-openai-key",
      timeoutMs: 10_000,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.openai.com/v1/decisions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer fake-openai-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual(
      documentedScoreRequestFixture,
    );
    expect(
      parseDecisionAnswers(
        "openai",
        documentedScoreRequestFixture.questions,
        response,
      ),
    ).toEqual({
      answers: {
        severity: {
          type: "score",
          name: "severity",
          score: 1.1,
          levels: [
            {
              value: 0,
              label: "Cosmetic",
              description: "Appearance only; no lost functionality.",
            },
            {
              value: 1,
              label: "Workaround available",
              description: "A task fails, but another way works.",
            },
            {
              value: 2,
              label: "Fully blocked",
              description: "A task fails with no workaround.",
            },
          ],
          probabilities: [
            { value: 0, probability: 0.1 },
            { value: 1, probability: 0.7 },
            { value: 2, probability: 0.2 },
          ],
          confidence: 0.55,
        },
      },
    });
  });

  it("maps a response body read timeout to timeout", async () => {
    vi.useFakeTimers();
    let beginBodyRead!: () => void;
    const bodyReadStarted = new Promise<void>((resolve) => {
      beginBodyRead = resolve;
    });
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        ({
          ok: true,
          json: () => {
            beginBodyRead();
            return new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            });
          },
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = requestOpenAiDecision({
      input: "A ticket",
      questions: documentedScoreRequestFixture.questions,
      apiKey: "fake-openai-key",
      timeoutMs: 1_000,
    });
    const expectedTimeout = expect(pending).rejects.toMatchObject({
      reason: "timeout",
    });
    await bodyReadStarted;
    await vi.advanceTimersByTimeAsync(1_000);

    await expectedTimeout;
  });

  it("preserves caller cancellation while reading the response body", async () => {
    let beginBodyRead!: () => void;
    const bodyReadStarted = new Promise<void>((resolve) => {
      beginBodyRead = resolve;
    });
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        ({
          ok: true,
          json: () => {
            beginBodyRead();
            return new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            });
          },
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const pending = requestOpenAiDecision({
      input: "A ticket",
      questions: documentedScoreRequestFixture.questions,
      apiKey: "fake-openai-key",
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    const expectedAbort = expect(pending).rejects.toMatchObject({
      reason: "aborted",
    });
    await bodyReadStarted;
    controller.abort();

    await expectedAbort;
  });
});
