export type DecisionProvider = "openai" | "jev";

export type DecisionInputPart =
  | { type: "text"; text: string }
  | { type: "json"; value: unknown }
  | { type: "image"; url: string };

export type DecisionInput = string | readonly DecisionInputPart[];

export interface PredicateQuestion {
  type: "predicate";
  name: string;
  instructions: string;
}

export interface ChoiceQuestion {
  type: "choice";
  name: string;
  instructions: string;
  choices: readonly { value: string; description: string }[];
}

export interface ScoreQuestion {
  type: "score";
  name: string;
  instructions: string;
  levels: readonly { label: string; description: string }[];
}

export type DecisionQuestion =
  | PredicateQuestion
  | ChoiceQuestion
  | ScoreQuestion;

export type DecisionQuestionType = DecisionQuestion["type"];

export interface DecisionQuestionCapability {
  status: "verified" | "unverified";
  enabled: boolean;
}

export interface DecisionsCapabilities {
  jev: {
    builderProxy: Record<DecisionQuestionType, DecisionQuestionCapability>;
  };
  openai: {
    decisionsApi: Record<DecisionQuestionType, DecisionQuestionCapability>;
  };
}

export interface DecisionProbability<Value extends string | number = string> {
  value: Value;
  probability: number;
}

export type DecisionAnswer =
  | {
      type: "predicate";
      name: string;
      probability: number;
    }
  | {
      type: "choice";
      name: string;
      choice: string;
      probabilities?: DecisionProbability[];
      confidence?: number;
    }
  | {
      type: "score";
      name: string;
      score: number;
      levels: Array<{ value: number; label: string; description: string }>;
      probabilities?: DecisionProbability<number>[];
      confidence?: number;
    };

export type DecisionFailureReason =
  | "aborted"
  | "timeout"
  | "credentials_unavailable"
  | "invalid_input"
  | "unsupported_input"
  | "unverified_capability"
  | "provider_error"
  | "invalid_response"
  | "refusal";

export type DecisionResult =
  | {
      status: "ok";
      provider: DecisionProvider;
      model: string;
      answers: Record<string, DecisionAnswer>;
      cached?: boolean;
      usage?: { inputTokens?: number; outputTokens?: number };
    }
  | {
      status: "not_configured";
      reason: "missing_credentials";
      providers: DecisionProvider[];
    }
  | {
      status: "failed";
      reason: DecisionFailureReason;
      provider?: DecisionProvider;
      questionNames?: string[];
    };

export type DecideResult = DecisionResult;

export interface DecideOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  providers?: readonly DecisionProvider[];
  cacheKey?: string;
}

export interface DecisionsStatus {
  providerOrder: DecisionProvider[];
  capabilities: DecisionsCapabilities;
  providers: Array<{
    provider: DecisionProvider;
    status: "ready" | "not_configured" | "unknown";
  }>;
}
