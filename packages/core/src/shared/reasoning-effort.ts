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

/**
 * Shared chat always chooses an explicit reasoning tier. Keep `auto` in the
 * accepted type only so older persisted selections and external callers can
 * migrate cleanly; new UI and engine defaults resolve it to Medium.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

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

const VISIBLE_STANDARD_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

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
  if (!model) return undefined;
  let normalized =
    !effort || effort === "auto" ? DEFAULT_REASONING_EFFORT : effort;
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

/**
 * Normalize a chat request before it reaches an engine. Explicit off/minimal
 * sentinels must survive this layer so the engine can distinguish them from a
 * missing selection, which now means the Medium default.
 */
export function normalizeReasoningEffortForRequest(
  model: string | undefined,
  effort: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (effort === "none" || effort === "minimal") return effort;
  return normalizeReasoningEffortForModel(model, effort);
}

export function reasoningEffortLabel(effort: ReasoningEffort | undefined) {
  return REASONING_EFFORT_LABELS[
    !effort || effort === "auto" ? DEFAULT_REASONING_EFFORT : effort
  ];
}

/**
 * Resolve a user-facing selection for a model. Legacy `auto`, missing values,
 * and tiers unsupported by the newly selected model all become Medium.
 * Non-reasoning models still retain Medium in persisted chat state so moving
 * back to a reasoning model has a predictable default; their engines omit the
 * effort through `normalizeReasoningEffortForModel`.
 */
export function resolveReasoningEffortSelection(
  model: string | undefined,
  effort: ReasoningEffort | undefined,
): ReasoningEffort {
  const requested =
    !effort || effort === "auto" ? DEFAULT_REASONING_EFFORT : effort;
  const options = getReasoningEffortOptionsForModel(model);
  return options.length === 0 || options.includes(requested)
    ? requested
    : DEFAULT_REASONING_EFFORT;
}

/**
 * One tier down from each effort, stopping at "minimal" — legacy `auto`,
 * "none", and "minimal" itself are left unchanged. Used by the
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
  const id = model.toLowerCase().replace(/^openai\//, "");
  return /^gpt-5/.test(id) || /^o\d/.test(id);
}

function isClaudeReasoningModel(model: string) {
  const id = model.toLowerCase().replace(/^anthropic\//, "");
  if (id.includes("fable-5") || id.includes("mythos-5")) return true;
  if (id.includes("sonnet-5") || id.includes("sonnet-4-6")) return true;
  if (id.includes("haiku-4-5")) return true;
  const opusMatch = id.match(/opus-4[-.](\d+)/);
  return opusMatch ? parseInt(opusMatch[1], 10) >= 6 : false;
}

function supportsClaudeXHigh(model: string) {
  const id = model.toLowerCase().replace(/^anthropic\//, "");
  // Models that support the xhigh effort tier (built-in extended thinking via
  // output_config.effort). Keep this version-aware so any future Claude model
  // with a higher patch/minor number is automatically included rather than
  // silently falling back to the lower "high" tier.
  // claude-fable-5 is a Mythos-class model and also supports xhigh.
  if (id.includes("fable-5")) return true;
  // Sonnet 5 supports the expanded effort ladder through Builder/Anthropic.
  if (id.includes("sonnet-5")) return true;
  // opus-4-7 introduced xhigh; all opus-4.x successors (4-8, 4-9…) should too.
  const opusMatch = id.match(/opus-4[-.](\d+)/);
  if (opusMatch) {
    return parseInt(opusMatch[1], 10) >= 7;
  }
  return false;
}

function isGeminiReasoningModel(model: string) {
  return /^gemini-/.test(model.toLowerCase().replace(/^google\//, ""));
}
