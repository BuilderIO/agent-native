export const REASONING_EFFORTS = [
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  auto: "Auto",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

const VISIBLE_STANDARD_EFFORTS: ReasoningEffort[] = [
  "auto",
  "low",
  "medium",
  "high",
];

const VISIBLE_GPT_EFFORTS: ReasoningEffort[] = [
  ...VISIBLE_STANDARD_EFFORTS,
  "xhigh",
];

const VISIBLE_CLAUDE_BUILT_IN_EFFORTS: ReasoningEffort[] = [
  ...VISIBLE_STANDARD_EFFORTS,
  "xhigh",
  "max",
];

const VISIBLE_CLAUDE_EFFORTS: ReasoningEffort[] = [
  ...VISIBLE_STANDARD_EFFORTS,
  "max",
];

const effortSet = new Set<string>(REASONING_EFFORTS);

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && effortSet.has(value);
}

export function getReasoningEffortOptionsForModel(
  model: string | undefined,
): ReasoningEffort[] {
  if (!model) return [];
  if (isGPTReasoningModel(model)) {
    return VISIBLE_GPT_EFFORTS;
  }
  if (isClaudeReasoningModel(model)) {
    return supportsClaudeXHigh(model)
      ? VISIBLE_CLAUDE_BUILT_IN_EFFORTS
      : VISIBLE_CLAUDE_EFFORTS;
  }
  if (isGeminiReasoningModel(model)) {
    return VISIBLE_STANDARD_EFFORTS;
  }
  return [];
}

export function normalizeReasoningEffortForModel(
  model: string | undefined,
  effort: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (!model || !effort || effort === "auto") {
    return undefined;
  }
  let normalized = effort;
  if (
    normalized === "xhigh" &&
    isClaudeReasoningModel(model) &&
    !supportsClaudeXHigh(model)
  ) {
    normalized = "high";
  }
  if (normalized === "max" && isGPTReasoningModel(model)) {
    normalized = "xhigh";
  }
  const options = getReasoningEffortOptionsForModel(model);
  if (!options.length || !options.includes(normalized)) {
    return undefined;
  }
  return normalized;
}

export function reasoningEffortLabel(effort: ReasoningEffort | undefined) {
  return REASONING_EFFORT_LABELS[effort ?? "auto"];
}

/**
 * One tier down from each effort, stopping at "minimal" — "none"/"auto"
 * (not really "tiers") and "minimal" itself are left unchanged. Used by the
 * empty-final-response retry so a retried turn asks for meaningfully less
 * reasoning instead of repeating the exact request that came back empty.
 */
const REASONING_EFFORT_STEP_DOWN: Partial<
  Record<ReasoningEffort, ReasoningEffort>
> = {
  max: "xhigh",
  xhigh: "high",
  high: "medium",
  medium: "low",
  low: "minimal",
};

export function stepDownReasoningEffort(
  effort: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (!effort) return effort;
  return REASONING_EFFORT_STEP_DOWN[effort] ?? effort;
}

function isGPTReasoningModel(model: string) {
  return /^gpt-5/.test(model) || /^o\d/.test(model);
}

function isClaudeReasoningModel(model: string) {
  return /^claude-/.test(model);
}

function supportsClaudeXHigh(model: string) {
  // Models that support the xhigh effort tier (built-in extended thinking via
  // output_config.effort). Keep this version-aware so any future Claude model
  // with a higher patch/minor number is automatically included rather than
  // silently falling back to the lower "high" tier.
  // claude-fable-5 is a Mythos-class model and also supports xhigh.
  if (model.includes("fable-5")) return true;
  // Sonnet 5 supports the expanded effort ladder through Builder/Anthropic.
  if (model.includes("sonnet-5")) return true;
  // opus-4-7 introduced xhigh; all opus-4.x successors (4-8, 4-9…) should too.
  const opusMatch = model.match(/opus-4-(\d+)/);
  if (opusMatch) {
    return parseInt(opusMatch[1], 10) >= 7;
  }
  return false;
}

function isGeminiReasoningModel(model: string) {
  return /^gemini-/.test(model);
}
