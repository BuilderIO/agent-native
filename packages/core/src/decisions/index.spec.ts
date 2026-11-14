import { describe, expect, it } from "vitest";

import {
  DECISION_PROVIDER_CAPABILITIES,
  decide,
  getDecisionsStatus,
  JEV_DECISIONS_MODEL,
  MAX_DECISION_PAYLOAD_BYTES,
  OPENAI_DECISIONS_MODEL,
} from "./index.js";
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionQuestionFailureReason,
} from "./index.js";

describe("public Decisions exports", () => {
  it("exports the shared providers, capabilities, and payload budget", () => {
    expect(typeof decide).toBe("function");
    expect(typeof getDecisionsStatus).toBe("function");
    expect(JEV_DECISIONS_MODEL).toBe("jev-latest");
    expect(OPENAI_DECISIONS_MODEL).toBe("gpt-6-luna");
    expect(MAX_DECISION_PAYLOAD_BYTES).toBe(256 * 1024);
    expect(DECISION_PROVIDER_CAPABILITIES).toHaveProperty("openai");
    expect(DECISION_PROVIDER_CAPABILITIES).toHaveProperty("jev");
  });

  it("exports the public answer and provider types", () => {
    const provider: DecisionProvider = "openai";
    const failure: DecisionQuestionFailureReason = "invalid_response";
    const answer: DecisionAnswer = {
      type: "predicate",
      name: "urgent",
      probability: 0.9,
    };

    expect(provider).toBe("openai");
    expect(failure).toBe("invalid_response");
    expect(answer.type).toBe("predicate");
  });
});
