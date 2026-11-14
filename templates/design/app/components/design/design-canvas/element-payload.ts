import { z } from "zod";

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

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isEditCapabilities(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          isPlainRecord(item) &&
          (item.kind === "deterministic-style-edit" ||
            item.kind === "deterministic-class-edit" ||
            item.kind === "agent-structural-edit" ||
            item.kind === "unsupported") &&
          typeof item.label === "string" &&
          Number.isFinite(item.confidence) &&
          (item.reason === undefined || typeof item.reason === "string"),
      ))
  );
}

export function isElementInfoPayload(value: unknown): value is ElementInfo {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.tagName === "string" &&
    isEditCapabilities(value.editCapabilities) &&
    Array.isArray(value.classes) &&
    value.classes.every((name) => typeof name === "string") &&
    isStringMap(value.computedStyles) &&
    (value.inlineStyles === undefined || isStringMap(value.inlineStyles)) &&
    (value.authoredSizeStyles === undefined ||
      isStringMap(value.authoredSizeStyles)) &&
    [
      value.selector,
      value.sourceId,
      value.runtimeSelector,
      value.runtimeSourceId,
    ].every((entry) => entry === undefined || typeof entry === "string") &&
    isFiniteRect(value.boundingRect) &&
    typeof value.isFlexChild === "boolean" &&
    typeof value.isFlexContainer === "boolean"
  );
}

const provenance = z
  .object({
    framework: z.enum(["html", "react", "vue", "svelte", "angular", "lwc"]),
    sourceFile: z.string(),
    line: z.number().finite(),
    column: z.number().finite(),
    component: z.string(),
    ownerSourceFile: z.string(),
    ownerLine: z.number().finite(),
    ownerColumn: z.number().finite(),
    ownerComponentName: z.string(),
    ownerKey: z.string(),
    method: z.enum([
      "data-attribute",
      "debug-source",
      "debug-stack",
      "debug-stack-remapped",
      "vue-inspector",
      "svelte-meta",
    ]),
    ownerMethod: z.enum([
      "data-attribute",
      "debug-source",
      "debug-stack",
      "debug-stack-remapped",
      "vue-inspector",
      "svelte-meta",
    ]),
    unavailableReason: z.enum(["not-framework", "not-react", "no-debug-info"]),
  })
  .partial();

export function isSelectionElementInfoPayload(
  value: unknown,
): value is ElementInfo {
  if (!isElementInfoPayload(value)) return false;
  if (
    value.provenance !== undefined &&
    !provenance.safeParse(value.provenance).success
  )
    return false;
  const snapshot = value.portableStyleSnapshot;
  if (snapshot === undefined) return true;
  if (
    !isPlainRecord(snapshot) ||
    snapshot.version !== 1 ||
    (snapshot.rootSourceId !== undefined &&
      typeof snapshot.rootSourceId !== "string") ||
    !Array.isArray(snapshot.nodes)
  )
    return false;
  return snapshot.nodes.every(
    (node: unknown) =>
      isPlainRecord(node) &&
      (node.sourceId === undefined || typeof node.sourceId === "string") &&
      Array.isArray(node.path) &&
      node.path.every(Number.isFinite) &&
      isStringMap(node.styles),
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
