import type {
  DecisionProvider,
  DecisionQuestionCapability,
  DecisionQuestionType,
} from "./types.js";

export const DECISION_PROVIDER_CAPABILITIES = {
  jev: {
    builderProxy: {
      predicate: { status: "verified", enabled: true },
      choice: { status: "verified", enabled: true },
      // Verified against the Builder proxy's SystemOneRequestSchema and SystemOneResponseSchema.
      score: { status: "verified", enabled: true },
    },
  },
  openai: {
    decisionsApi: {
      predicate: { status: "verified", enabled: true },
      choice: { status: "verified", enabled: true },
      score: { status: "verified", enabled: true },
    },
  },
} as const satisfies {
  jev: {
    builderProxy: Record<DecisionQuestionType, DecisionQuestionCapability>;
  };
  openai: {
    decisionsApi: Record<DecisionQuestionType, DecisionQuestionCapability>;
  };
};

export function getDecisionQuestionCapability(
  provider: DecisionProvider,
  questionType: DecisionQuestionType,
): DecisionQuestionCapability {
  return provider === "jev"
    ? DECISION_PROVIDER_CAPABILITIES.jev.builderProxy[questionType]
    : DECISION_PROVIDER_CAPABILITIES.openai.decisionsApi[questionType];
}
