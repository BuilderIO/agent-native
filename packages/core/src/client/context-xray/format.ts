import { getContextWindowForModel } from "../../agent/model-config.js";
import type { ContextManifestSegment } from "../../shared/context-xray.js";

/**
 * Fallback context-window limit used when no model ID is available.
 * Kept as a named export so existing callers that import this constant
 * directly still compile without changes.
 */
export const CONTEXT_XRAY_MODEL_LIMIT = 200_000;

/**
 * Resolve the effective context-window limit for the given model ID.
 * Falls back to {@link CONTEXT_XRAY_MODEL_LIMIT} (200 K) when the model is
 * unknown or not provided — matching the pre-existing hard-coded behaviour.
 */
export function resolveContextWindow(modelId?: string | null): number {
  if (!modelId) return CONTEXT_XRAY_MODEL_LIMIT;
  return getContextWindowForModel(modelId);
}

export function formatTokens(tokens: number | undefined): string {
  const value = Math.max(0, Math.round(tokens ?? 0));
  if (value >= 1000) {
    const compact = value / 1000;
    return `${compact >= 100 ? compact.toFixed(0) : compact.toFixed(1)}k`;
  }
  return String(value);
}

export function statusLabel(segment: ContextManifestSegment): string {
  if (segment.protected) return "Protected";
  if (segment.status === "pinned") return "Pinned";
  if (segment.status === "evicted") return "Evicted";
  if (segment.status === "summarized") return "Summarized";
  return "Active";
}

export function groupColor(group: string): string {
  if (group === "Pinned") return "bg-emerald-500";
  if (group === "Tool results") return "bg-amber-500";
  if (group === "Files read") return "bg-sky-500";
  if (group === "Thinking") return "bg-violet-500";
  if (group === "Task & instructions") return "bg-rose-500";
  return "bg-slate-400";
}

export function groupFill(group: string): string {
  if (group === "Pinned") return "#10b981";
  if (group === "Tool results") return "#f59e0b";
  if (group === "Files read") return "#0ea5e9";
  if (group === "Thinking") return "#8b5cf6";
  if (group === "Task & instructions") return "#f43f5e";
  return "#94a3b8";
}
