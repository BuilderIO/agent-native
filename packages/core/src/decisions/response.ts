import type {
  DecisionAnswer,
  DecisionProbability,
  DecisionProvider,
  DecisionQuestion,
} from "./types.js";

const SCORE_PROBABILITY_SUM_TOLERANCE = 1e-6;

export class DecisionResponseError extends Error {
  constructor(readonly reason: "invalid_response" | "refusal") {
    super(`Decision provider returned ${reason}.`);
    this.name = "DecisionResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function probability(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : undefined;
}

function parseProbabilities<Value extends string | number>(
  value: unknown,
  allowedValues: readonly Value[],
): DecisionProbability<Value>[] | undefined {
  if (value === undefined) return undefined;
  const entries: DecisionProbability<Value>[] = [];
  if (Array.isArray(value)) {
    const seenValues = new Set<Value>();
    for (const entry of value) {
      if (!isRecord(entry) || !allowedValues.includes(entry.value as Value)) {
        return undefined;
      }
      const entryValue = entry.value as Value;
      if (seenValues.has(entryValue)) return undefined;
      const p = probability(entry.probability);
      if (p === undefined) return undefined;
      seenValues.add(entryValue);
      entries.push({ value: entryValue, probability: p });
    }
  } else if (isRecord(value)) {
    for (const [key, rawProbability] of Object.entries(value)) {
      const entryValue = allowedValues.find(
        (candidate) => String(candidate) === key,
      );
      const p = probability(rawProbability);
      if (entryValue === undefined || p === undefined) return undefined;
      entries.push({ value: entryValue, probability: p });
    }
  } else {
    return undefined;
  }
  return entries;
}

function parseJevScoreProbabilities(
  question: Extract<DecisionQuestion, { type: "score" }>,
  legendValue: unknown,
  probabilitiesValue: unknown,
): { score: number; probabilities: DecisionProbability<number>[] } {
  if (!isRecord(legendValue) || !isRecord(probabilitiesValue)) {
    throw new DecisionResponseError("invalid_response");
  }

  const keys = Object.keys(probabilitiesValue);
  if (
    keys.length !== question.levels.length ||
    Object.keys(legendValue).length !== question.levels.length ||
    keys.some((key) => !Object.hasOwn(legendValue, key))
  ) {
    throw new DecisionResponseError("invalid_response");
  }

  const usesIndexKeys = question.levels.every((_, index) =>
    Object.hasOwn(probabilitiesValue, String(index)),
  );
  const probabilitiesByLevel = new Map<number, number>();
  for (const key of keys) {
    const legend = legendValue[key];
    const p = probability(probabilitiesValue[key]);
    if (typeof legend !== "string" || p === undefined) {
      throw new DecisionResponseError("invalid_response");
    }

    let index: number;
    if (usesIndexKeys) {
      index = Number(key);
    } else {
      const matchingLevels = new Set<number>();
      const addMatchingLevel = (value: string): void => {
        const matchingIndex = question.levels.findIndex(
          ({ label, description }) =>
            value === label || value === `${label}: ${description}`,
        );
        if (matchingIndex >= 0) matchingLevels.add(matchingIndex);
      };
      addMatchingLevel(legend);

      if (matchingLevels.size !== 1) {
        throw new DecisionResponseError("invalid_response");
      }
      const matchingLevel = matchingLevels.values().next();
      if (matchingLevel.done) {
        throw new DecisionResponseError("invalid_response");
      }
      index = matchingLevel.value;
    }
    if (index >= question.levels.length || probabilitiesByLevel.has(index)) {
      throw new DecisionResponseError("invalid_response");
    }
    probabilitiesByLevel.set(index, p);
  }

  const probabilities = question.levels.map((_, index) => {
    const p = probabilitiesByLevel.get(index);
    if (p === undefined) throw new DecisionResponseError("invalid_response");
    return { value: index, probability: p };
  });
  if (probabilities.every(({ probability: p }) => p === 0)) {
    throw new DecisionResponseError("invalid_response");
  }
  const totalProbability = probabilities.reduce(
    (total, { probability: p }) => total + p,
    0,
  );
  if (
    !Number.isFinite(totalProbability) ||
    Math.abs(totalProbability - 1) > SCORE_PROBABILITY_SUM_TOLERANCE
  ) {
    throw new DecisionResponseError("invalid_response");
  }
  const normalizedProbabilities = probabilities.map(
    ({ value, probability: p }) => ({
      value,
      probability: p / totalProbability,
    }),
  );

  return {
    score: normalizedProbabilities.reduce(
      (expectedIndex, { value, probability: p }) => expectedIndex + value * p,
      0,
    ),
    probabilities: normalizedProbabilities,
  };
}

function answerForQuestion(
  provider: DecisionProvider,
  question: DecisionQuestion,
  value: unknown,
): DecisionAnswer {
  if (!isRecord(value)) throw new DecisionResponseError("invalid_response");
  if (value.type === "refusal") throw new DecisionResponseError("refusal");

  if (question.type === "predicate") {
    const expectedType = provider === "jev" ? "noul" : "predicate";
    const rawProbability = provider === "jev" ? value.noul : value.probability;
    const p = probability(rawProbability);
    if (value.type !== expectedType || p === undefined) {
      throw new DecisionResponseError("invalid_response");
    }
    return { type: "predicate", name: question.name, probability: p };
  }

  if (value.type !== question.type) {
    throw new DecisionResponseError("invalid_response");
  }
  const answerConfidence = probability(value.confidence);
  const hasConfidence = Object.hasOwn(value, "confidence");
  if (hasConfidence && answerConfidence === undefined) {
    throw new DecisionResponseError("invalid_response");
  }
  const confidence = hasConfidence ? answerConfidence : undefined;

  if (question.type === "choice") {
    const choice = value.choice;
    if (
      typeof choice !== "string" ||
      !question.choices.some((item) => item.value === choice)
    ) {
      throw new DecisionResponseError("invalid_response");
    }
    const probabilities = parseProbabilities(
      value.probabilities,
      question.choices.map(({ value: choiceValue }) => choiceValue),
    );
    if (value.probabilities !== undefined && !probabilities) {
      throw new DecisionResponseError("invalid_response");
    }
    return {
      type: "choice",
      name: question.name,
      choice,
      ...(probabilities ? { probabilities } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }

  const score = value.score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new DecisionResponseError("invalid_response");
  }
  const levels = question.levels.map((level, index) => ({
    value: index,
    label: level.label,
    description: level.description,
  }));
  if (provider === "jev") {
    if (confidence === undefined) {
      throw new DecisionResponseError("invalid_response");
    }
    const normalized = parseJevScoreProbabilities(
      question,
      value.legend,
      value.probabilities,
    );
    return {
      type: "score",
      name: question.name,
      score: normalized.score,
      levels,
      probabilities: normalized.probabilities,
      confidence,
    };
  }

  if (score < 0 || score > question.levels.length - 1) {
    throw new DecisionResponseError("invalid_response");
  }
  const probabilities = parseProbabilities(
    value.probabilities,
    levels.map(({ value: levelValue }) => levelValue),
  );
  if (value.probabilities !== undefined && !probabilities) {
    throw new DecisionResponseError("invalid_response");
  }
  return {
    type: "score",
    name: question.name,
    score,
    levels,
    ...(probabilities ? { probabilities } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

export function parseDecisionAnswers(
  provider: DecisionProvider,
  questions: readonly DecisionQuestion[],
  value: unknown,
): {
  answers: Record<string, DecisionAnswer>;
  usage?: { inputTokens?: number; outputTokens?: number };
} {
  if (!isRecord(value)) throw new DecisionResponseError("invalid_response");
  const rawAnswers = value.answers;
  if (provider === "openai" && Array.isArray(rawAnswers)) {
    const answerMap = new Map<string, unknown>();
    for (const answer of rawAnswers) {
      if (!isRecord(answer) || typeof answer.name !== "string") {
        throw new DecisionResponseError("invalid_response");
      }
      if (answerMap.has(answer.name)) {
        throw new DecisionResponseError("invalid_response");
      }
      answerMap.set(answer.name, answer);
    }
    return buildParsedAnswers(provider, questions, answerMap, value.usage);
  }
  if (!isRecord(rawAnswers))
    throw new DecisionResponseError("invalid_response");
  return buildParsedAnswers(
    provider,
    questions,
    new Map(Object.entries(rawAnswers)),
    value.usage,
  );
}

function buildParsedAnswers(
  provider: DecisionProvider,
  questions: readonly DecisionQuestion[],
  values: Map<string, unknown>,
  rawUsage: unknown,
): {
  answers: Record<string, DecisionAnswer>;
  usage?: { inputTokens?: number; outputTokens?: number };
} {
  if (values.size !== questions.length) {
    throw new DecisionResponseError("invalid_response");
  }
  const answers: Record<string, DecisionAnswer> = {};
  for (const question of questions) {
    if (!values.has(question.name)) {
      throw new DecisionResponseError("invalid_response");
    }
    Object.defineProperty(answers, question.name, {
      configurable: true,
      enumerable: true,
      value: answerForQuestion(provider, question, values.get(question.name)),
      writable: true,
    });
  }

  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  if (isRecord(rawUsage)) {
    const inputTokens = rawUsage.input_tokens;
    const outputTokens = rawUsage.output_tokens;
    if (
      (inputTokens !== undefined &&
        (!Number.isInteger(inputTokens) || (inputTokens as number) < 0)) ||
      (outputTokens !== undefined &&
        (!Number.isInteger(outputTokens) || (outputTokens as number) < 0))
    ) {
      throw new DecisionResponseError("invalid_response");
    }
    if (inputTokens !== undefined || outputTokens !== undefined) {
      usage = {
        ...(inputTokens !== undefined
          ? { inputTokens: inputTokens as number }
          : {}),
        ...(outputTokens !== undefined
          ? { outputTokens: outputTokens as number }
          : {}),
      };
    }
  }
  return { answers, ...(usage ? { usage } : {}) };
}
