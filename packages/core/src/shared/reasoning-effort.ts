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

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";

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

export function isGPTReasoningModel(model: string) {
  const id = model.toLowerCase().replace(/^openai\//, "");
  return /^gpt-[56]/.test(id) || /^o\d/.test(id);
}

function claudeOpusAtLeast(
  modelId: string,
  minimumMajor: number,
  minimumMinor: number,
) {
  const match = modelId.match(/opus-(\d+)(?:[-.](\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return (
    major > minimumMajor || (major === minimumMajor && minor >= minimumMinor)
  );
}

function isClaudeReasoningModel(model: string) {
  const id = model.toLowerCase().replace(/^anthropic\//, "");
  if (id.includes("fable-5") || id.includes("mythos-5")) return true;
  if (id.includes("sonnet-5") || id.includes("sonnet-4-6")) return true;
  if (id.includes("haiku-4-5")) return true;
  return claudeOpusAtLeast(id, 4, 6);
}

export function supportsClaudeAdaptiveThinking(model: string | undefined) {
  if (!model) return false;
  const id = model.toLowerCase().replace(/^anthropic\//, "");
  if (id.includes("fable-5") || id.includes("mythos-5")) return true;
  if (id.includes("sonnet-5") || id.includes("sonnet-4-6")) return true;
  return claudeOpusAtLeast(id, 4, 6);
}

export function anthropicManualThinkingBudget(effort: ReasoningEffort) {
  switch (effort) {
    case "low":
      return 1_024;
    case "medium":
      return 4_096;
    case "high":
      return 8_000;
    case "xhigh":
      return 16_000;
    case "max":
      return 32_000;
    default:
      return 4_096;
  }
}

function supportsClaudeXHigh(model: string) {
  const id = model.toLowerCase().replace(/^anthropic\//, "");
  if (id.includes("fable-5")) return true;
  if (id.includes("sonnet-5")) return true;
  return claudeOpusAtLeast(id, 4, 7);
}

function isGeminiReasoningModel(model: string) {
  return /^gemini-/.test(model.toLowerCase().replace(/^google\//, ""));
}

function claudeAcceptsSamplingParams(model: string) {
  const id = model.toLowerCase().replace(/^anthropic\//, "");
  if (id.includes("fable-5") || id.includes("mythos-5")) return false;
  if (id.includes("sonnet-5")) return false;
  return !claudeOpusAtLeast(id, 4, 7);
}

export function allowsSamplingParams(args: {
  model: string | undefined;
  thinkingEnabled: boolean;
}): boolean {
  if (!args.model) return true;
  if (args.thinkingEnabled) return false;
  return claudeAcceptsSamplingParams(args.model);
}
