import { getContextWindowForModel } from "../../agent/model-config.js";

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
