import type { ElementInfo } from "../types";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteRect(value: unknown): value is ElementInfo["boundingRect"] {
  if (!isPlainRecord(value)) return false;
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height)
  );
}

export function isElementInfoPayload(value: unknown): value is ElementInfo {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.tagName === "string" &&
    Array.isArray(value.classes) &&
    isPlainRecord(value.computedStyles) &&
    isFiniteRect(value.boundingRect) &&
    typeof value.isFlexChild === "boolean" &&
    typeof value.isFlexContainer === "boolean"
  );
}
