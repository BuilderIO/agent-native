import { getContextWindowForModel } from "../../agent/model-config.js";

export const CONTEXT_XRAY_MODEL_LIMIT = 200_000;

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
