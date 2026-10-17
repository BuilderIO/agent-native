import { isLocalRuntimeEngine } from "@agent-native/toolkit/app/chat/composer";

export type CodeAgentAiReadiness = "configured" | "missing" | "unavailable";

type CodeAgentHostReadiness = {
  status?: unknown;
  llmProvider?: { configured?: unknown } | null;
};

export async function readCodeAgentAiReadiness(
  getHostMetadata?: () => Promise<unknown>,
): Promise<CodeAgentAiReadiness> {
  if (!getHostMetadata) return "unavailable";

  try {
    const metadata = (await getHostMetadata()) as CodeAgentHostReadiness | null;
    if (
      metadata?.status !== "ok" ||
      typeof metadata.llmProvider?.configured !== "boolean"
    ) {
      return "unavailable";
    }
    return metadata.llmProvider.configured ? "configured" : "missing";
  } catch {
    return "unavailable";
  }
}

export function createCodeAgentAiReadinessGate(
  getHostMetadata: (() => Promise<unknown>) | undefined,
  engine?: string,
  onBlocked?: (readiness: Exclude<CodeAgentAiReadiness, "configured">) => void,
): () => Promise<boolean> {
  return async () => {
    if (isLocalRuntimeEngine(engine)) return true;
    const readiness = await readCodeAgentAiReadiness(getHostMetadata);
    if (readiness === "configured") return true;
    onBlocked?.(readiness);
    return false;
  };
}
