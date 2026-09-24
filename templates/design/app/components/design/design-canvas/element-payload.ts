import type { ElementInfo } from "../types";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isComputedStyleMap(
  value: unknown,
): value is Record<string, string | undefined> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every(
      (entry) => entry === undefined || typeof entry === "string",
    )
  );
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

export function parseRuntimeSnapshotHtml(
  value: unknown,
):
  | { ok: true; html: string }
  | { ok: false; reason: "snapshot-unavailable" | "snapshot-too-large" } {
  if (typeof value !== "string" || !value) {
    return { ok: false, reason: "snapshot-unavailable" };
  }
  if (value.length > 2_000_000) {
    return { ok: false, reason: "snapshot-too-large" };
  }
  return { ok: true, html: value };
}
