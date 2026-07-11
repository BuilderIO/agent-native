export type RecapUsageCostSource = "reported" | "estimated" | "unavailable";

export interface RecapUsageCostInput {
  agent?: "claude" | "codex" | "openai-compatible";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reportedCostUsd?: number;
}

type CostEstimator = (
  inputTokens: number,
  outputTokens: number,
  model: string,
  cacheReadTokens: number,
  cacheWriteTokens: number,
) => number;

export function resolveRecapUsageCost(
  input: RecapUsageCostInput,
  estimateCost?: CostEstimator,
): { costCentsX100: number | null; costSource: RecapUsageCostSource } {
  if (input.reportedCostUsd != null) {
    return {
      costCentsX100: Math.max(1, Math.round(input.reportedCostUsd * 10_000)),
      costSource: "reported",
    };
  }
  if (input.agent === "openai-compatible") {
    return { costCentsX100: null, costSource: "unavailable" };
  }
  if (!estimateCost) {
    throw new Error(
      "A cost estimator is required for standard recap backends.",
    );
  }
  return {
    costCentsX100: estimateCost(
      input.inputTokens,
      input.outputTokens,
      input.model,
      input.cacheReadTokens,
      input.cacheWriteTokens,
    ),
    costSource: "estimated",
  };
}
