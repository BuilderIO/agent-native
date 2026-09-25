import type { ChatContentPart, ChatMessage } from "./types";

const ALWAYS_VISIBLE_TOOLS = new Set([
  "connect-builder",
  "connect-file-storage",
]);

export function isCollapsibleWorkPart(part: ChatContentPart): boolean {
  if (part.type === "reasoning") return true;
  return (
    part.type === "tool-call" &&
    !ALWAYS_VISIBLE_TOOLS.has(part.toolName) &&
    part.status !== "awaiting-approval"
  );
}

export function hasActiveTool(parts: readonly ChatContentPart[]): boolean {
  return parts.some(
    (part) => part.type === "tool-call" && part.status === "running",
  );
}

export function hasUnresolvedTool(parts: readonly ChatContentPart[]): boolean {
  return parts.some(
    (part) =>
      part.type === "tool-call" &&
      (part.status === "running" || part.status === "awaiting-approval"),
  );
}

export function shouldShowActivityRow(
  activity: string | null,
  messages: readonly ChatMessage[],
): boolean {
  if (!activity?.trim()) return false;
  const last = messages[messages.length - 1];
  const lastPart = last?.role === "assistant" ? last.parts.at(-1) : undefined;
  if (lastPart?.type === "reasoning" && lastPart.text.trim().length > 0) {
    return false;
  }
  if (lastPart?.type === "tool-call" && lastPart.status === "running") {
    return false;
  }
  return true;
}

export function shouldShowWorkSummary({
  isLast,
  isComplete,
  parts,
  isStreaming,
}: {
  isLast: boolean;
  isComplete: boolean;
  parts: readonly ChatContentPart[];
  isStreaming: boolean;
}): boolean {
  if (!parts.some(isCollapsibleWorkPart) || hasActiveTool(parts)) return false;
  if (hasUnresolvedTool(parts)) return !(isLast && isStreaming);
  return isComplete || !isLast;
}

export function formatWorkedDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
