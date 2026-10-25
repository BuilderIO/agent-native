import { afterEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  getOwnerApiKeyForEngine: vi.fn(),
  isJevEnabled: vi.fn(),
  JevProviderRequestError: class JevProviderRequestError extends Error {},
  requestJev: vi.fn(),
  DecisionProviderRequestError: class DecisionProviderRequestError extends Error {},
  requestOpenAiDecision: vi.fn(),
}));

vi.mock("../agent/production-agent.js", () => ({
  getJevContextCredentials: providerMocks.getJevContextCredentials,
  getOwnerApiKeyForEngine: providerMocks.getOwnerApiKeyForEngine,
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({
    decisions: { providerOrder: ["jev", "openai"], timeoutMs: 10_000 },
  }),
}));
vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => "org-example",
}));
vi.mock("./providers/jev.js", () => ({
  JevProviderRequestError: providerMocks.JevProviderRequestError,
  isJevEnabled: providerMocks.isJevEnabled,
  requestJev: providerMocks.requestJev,
}));
vi.mock("./providers/openai.js", () => ({
  OPENAI_DECISIONS_MODEL: "gpt-6-luna",
  DecisionProviderRequestError: providerMocks.DecisionProviderRequestError,
  requestOpenAiDecision: providerMocks.requestOpenAiDecision,
}));

import { decide } from "./decide.js";
import type { DecisionInput } from "./types.js";
import {
  MAX_DECISION_PAYLOAD_BYTES,
  validateDecisionInput,
} from "./validation.js";

afterEach(() => {
  vi.clearAllMocks();
});

function decisionInput(value: unknown) {
  return {
    input: [{ type: "json", value }],
    questions: [
      {
        type: "choice",
        name: "route",
        instructions: "Choose a route.",
        choices: [
          { value: "billing", description: "Payment questions" },
          { value: "technical", description: "Product questions" },
        ],
      },
    ],
  };
}

describe("validateDecisionInput JSON values", () => {
  it.each([
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["undefined object properties", { nested: { missing: undefined } }],
    ["undefined array entries", ["present", undefined]],
    ["bigints", { value: BigInt(1) }],
    ["functions", { value: () => "value" }],
    ["symbols", { value: Symbol("value") }],
  ])("rejects %s", (_label, value) => {
    expect(validateDecisionInput(decisionInput(value))).toBe(false);
  });

  it("rejects cycles but accepts a repeated acyclic reference", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateDecisionInput(decisionInput(cyclic))).toBe(false);

    const shared = { nested: ["value", 2] };
    expect(
      validateDecisionInput(decisionInput({ first: shared, second: shared })),
    ).toBe(true);
  });

  it("rejects sparse arrays and arrays with extra properties", () => {
    const sparse = new Array(2);
    sparse[1] = "present";
    expect(validateDecisionInput(decisionInput(sparse))).toBe(false);

    const extra = ["value"] as unknown[] & { label?: string };
    extra.label = "ignored by JSON.stringify";
    expect(validateDecisionInput(decisionInput(extra))).toBe(false);

    const customArray = ["value"];
    Object.setPrototypeOf(customArray, {});
    expect(validateDecisionInput(decisionInput(customArray))).toBe(false);
  });

  it("rejects non-plain prototypes, accessors, hidden properties, and symbols", () => {
    expect(validateDecisionInput(decisionInput(new Date()))).toBe(false);
    expect(
      validateDecisionInput(
        decisionInput(
          Object.assign(Object.create({ inherited: true }), { value: 1 }),
        ),
      ),
    ).toBe(false);

    let getterCalled = false;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "hidden side effect";
      },
    });
    expect(validateDecisionInput(decisionInput(accessor))).toBe(false);
    expect(getterCalled).toBe(false);

    const hidden = { value: 1 };
    Object.defineProperty(hidden, "secret", { value: 2 });
    expect(validateDecisionInput(decisionInput(hidden))).toBe(false);

    expect(
      validateDecisionInput(decisionInput({ [Symbol("hidden")]: "value" })),
    ).toBe(false);

    const uninspectable = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("unreadable object");
        },
      },
    );
    expect(validateDecisionInput(decisionInput(uninspectable))).toBe(false);
  });

  it("accepts valid nested JSON", () => {
    expect(
      validateDecisionInput(
        decisionInput({
          nullish: null,
          text: "value",
          enabled: true,
          count: 3,
          nested: [{ safe: "value" }],
        }),
      ),
    ).toBe(true);
  });
});

describe("decision payload size", () => {
  const oversizedInputs: Array<[string, DecisionInput]> = [
    ["text", "x".repeat(MAX_DECISION_PAYLOAD_BYTES)],
    ["JSON", [{ type: "json", value: "x".repeat(MAX_DECISION_PAYLOAD_BYTES) }]],
    [
      "aggregate text parts",
      [
        { type: "text", text: "x".repeat(130 * 1024) },
        { type: "text", text: "x".repeat(130 * 1024) },
      ],
    ],
  ];

  it.each(oversizedInputs)(
    "rejects oversized %s before provider calls",
    async (_label, input) => {
      const result = await decide({
        ownerEmail: "owner@example.test",
        input,
        questions: decisionInput(null).questions,
        options: { providers: ["openai"] },
      });

      expect(result).toEqual({ status: "failed", reason: "invalid_input" });
      expect(providerMocks.requestJev).not.toHaveBeenCalled();
      expect(providerMocks.requestOpenAiDecision).not.toHaveBeenCalled();
    },
  );

  it("accepts a payload below the aggregate limit", () => {
    expect(
      validateDecisionInput({
        input: "x".repeat(MAX_DECISION_PAYLOAD_BYTES - 1024),
        questions: decisionInput(null).questions,
      }),
    ).toBe(true);
  });

  it("counts UTF-8 bytes at the aggregate payload limit", () => {
    const questions = decisionInput(null).questions;
    const emptyInputPayloadBytes = new TextEncoder().encode(
      JSON.stringify({ input: "", questions }),
    ).length;
    const remainingBytes = MAX_DECISION_PAYLOAD_BYTES - emptyInputPayloadBytes;
    const input =
      "🧪".repeat(Math.floor(remainingBytes / 4)) +
      "x".repeat(remainingBytes % 4);

    expect(validateDecisionInput({ input, questions })).toBe(true);
    expect(validateDecisionInput({ input: `${input}x`, questions })).toBe(
      false,
    );
  });
});
