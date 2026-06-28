export const CLIPS_BUILDER_CREDITS_STATE_KEY = "clips-builder-credits";

export const BUILDER_CREDITS_UPGRADE_URL =
  "https://builder.io/account/subscription?signupSource=agent-native&agentNativeConnectSource=clips_builder_credits&agentNativeFlow=connect_llm&framework=agent-native";

export const BUILDER_CREDIT_FEATURES = [
  "backup-transcription",
  "cleanup",
  "summaries",
  "titles",
] as const;

export type BuilderCreditFeature = (typeof BUILDER_CREDIT_FEATURES)[number];

export type BuilderCreditsSource =
  | "transcription"
  | "cleanup"
  | "summary"
  | "title";

export interface BuilderCreditsStatus {
  exhausted: boolean;
  source?: BuilderCreditsSource;
  message?: string;
  upgradeUrl: string;
  updatedAt?: string;
  features: BuilderCreditFeature[];
}

const BUILDER_CREDITS_SOURCES = new Set<BuilderCreditsSource>([
  "transcription",
  "cleanup",
  "summary",
  "title",
]);

export function isBuilderCreditsExhaustedMessage(
  reason: string | null | undefined,
): boolean {
  if (!reason) return false;
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("builder transcription credits exhausted") ||
    normalized.includes("credits-limit") ||
    normalized.includes("credit limit") ||
    normalized.includes("credits limit") ||
    normalized.includes("monthly ai credits") ||
    normalized.includes("daily ai credits") ||
    normalized.includes("builder.io plan") ||
    (normalized.includes("builder") && normalized.includes("credits"))
  );
}

export function createBuilderCreditsExhaustedStatus({
  source,
  message,
  now = new Date().toISOString(),
}: {
  source: BuilderCreditsSource;
  message: string;
  now?: string;
}): BuilderCreditsStatus {
  return {
    exhausted: true,
    source,
    message,
    upgradeUrl: BUILDER_CREDITS_UPGRADE_URL,
    updatedAt: now,
    features: [...BUILDER_CREDIT_FEATURES],
  };
}

export function emptyBuilderCreditsStatus(): BuilderCreditsStatus {
  return {
    exhausted: false,
    upgradeUrl: BUILDER_CREDITS_UPGRADE_URL,
    features: [...BUILDER_CREDIT_FEATURES],
  };
}

export function normalizeBuilderCreditsStatus(
  value: unknown,
): BuilderCreditsStatus {
  if (!value || typeof value !== "object") {
    return emptyBuilderCreditsStatus();
  }

  const raw = value as Record<string, unknown>;
  if (raw.exhausted !== true) {
    return emptyBuilderCreditsStatus();
  }

  const source =
    typeof raw.source === "string" &&
    BUILDER_CREDITS_SOURCES.has(raw.source as BuilderCreditsSource)
      ? (raw.source as BuilderCreditsSource)
      : "transcription";

  const message =
    typeof raw.message === "string" && raw.message.trim()
      ? raw.message
      : "Builder.io credits are paused.";

  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt
      : undefined;

  return {
    exhausted: true,
    source,
    message,
    upgradeUrl:
      typeof raw.upgradeUrl === "string" && raw.upgradeUrl.trim()
        ? raw.upgradeUrl
        : BUILDER_CREDITS_UPGRADE_URL,
    updatedAt,
    features: [...BUILDER_CREDIT_FEATURES],
  };
}
