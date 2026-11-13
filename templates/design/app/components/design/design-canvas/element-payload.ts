import { z } from "zod";

import type { ElementInfo } from "../types";

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const rect = point.extend({
  width: z.number().finite(),
  height: z.number().finite(),
});
const strings = z.record(z.string(), z.string());
const framework = z.enum(["html", "react", "vue", "svelte", "angular", "lwc"]);
const method = z.enum([
  "data-attribute",
  "debug-source",
  "debug-stack",
  "debug-stack-remapped",
  "vue-inspector",
  "svelte-meta",
]);
const optionalElementInfo = z.object({
  componentName: z.string().optional(),
  componentAnnotation: z.string().optional(),
  id: z.string().optional(),
  pendingNodeId: z.string().optional(),
  primitiveKind: z.string().optional(),
  textContent: z.string().optional(),
  htmlContent: z.string().optional(),
  imageSource: z.string().optional(),
  parentDisplay: z.string().optional(),
  hasOwnText: z.boolean().optional(),
  wholeTextStyleRoot: z.boolean().optional(),
  needsLiveMeasurement: z.boolean().optional(),
  isGroup: z.boolean().optional(),
  vectorStrokeCanAlign: z.boolean().optional(),
  styleSnapshotCaptureFailed: z.boolean().optional(),
  styleSnapshotReadOnDemand: z.boolean().optional(),
  textContentTruncated: z.boolean().optional(),
  htmlContentTruncated: z.boolean().optional(),
  isGridContainer: z.boolean().optional(),
  childElementCount: z.number().finite().optional(),
  confidence: z.number().finite().optional(),
  sourceLayerIdentity: z
    .object({ screenId: z.string(), nodeId: z.string() })
    .optional(),
  parentBoundingRect: rect.optional(),
  positionReferenceRect: rect.optional(),
  positionContainingBlockOrigin: point.optional(),
  absoluteSiblingVisualOrigin: point.optional(),
  positionContainingBlockTransform: z
    .object({
      a: z.number().finite(),
      b: z.number().finite(),
      c: z.number().finite(),
      d: z.number().finite(),
    })
    .optional(),
  svgShapeOffset: point.nullable().optional(),
  relativeContainingBlockDirection: z.enum(["ltr", "rtl"]).optional(),
  editCapabilities: z
    .array(
      z.object({
        kind: z.enum([
          "deterministic-style-edit",
          "deterministic-class-edit",
          "agent-structural-edit",
          "unsupported",
        ]),
        label: z.string(),
        confidence: z.number().finite(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
  portableStyleSnapshot: z
    .object({
      version: z.literal(1),
      rootSourceId: z.string().optional(),
      nodes: z.array(
        z.object({
          sourceId: z.string().optional(),
          path: z.array(z.number().finite()),
          styles: strings,
        }),
      ),
    })
    .optional(),
  childLayouts: z
    .object({
      children: z.array(
        z.object({
          nodeId: z.string().optional(),
          tagName: z.string(),
          position: z.string(),
          display: z.string(),
          flexGrow: z.string(),
          alignSelf: z.string(),
          justifySelf: z.string(),
          float: z.string(),
          width: z.string().optional(),
          height: z.string().optional(),
          rect,
        }),
      ),
      complete: z.boolean(),
      looseText: z.boolean(),
    })
    .optional(),
  parentAutoLayout: z
    .object({
      display: z.string().optional(),
      selector: z.string().optional(),
      sourceId: z.string().optional(),
      boundingRect: rect,
    })
    .optional(),
  parentLayout: z
    .object({
      display: z.string().optional(),
      flexDirection: z.string().optional(),
      alignItems: z.string().optional(),
      justifyContent: z.string().optional(),
      gap: z.string().optional(),
      gridAutoFlow: z.string().optional(),
      gridTemplateColumns: z.string().optional(),
      gridTemplateRows: z.string().optional(),
      position: z.string().optional(),
    })
    .optional(),
  repeat: z
    .object({
      sourceSelector: z.string(),
      instanceCount: z.number().finite(),
      instanceIndex: z.number().finite(),
      xFor: z.string(),
      itemIndex: z.number().finite(),
      textBinding: z.string(),
      keyExpression: z.string(),
      itemKey: z.string(),
    })
    .optional(),
  provenance: z
    .object({
      framework: framework.optional(),
      sourceFile: z.string().optional(),
      line: z.number().finite().optional(),
      column: z.number().finite().optional(),
      component: z.string().optional(),
      ownerSourceFile: z.string().optional(),
      ownerLine: z.number().finite().optional(),
      ownerColumn: z.number().finite().optional(),
      ownerComponentName: z.string().optional(),
      ownerKey: z.string().optional(),
      method: method.optional(),
      ownerMethod: method.optional(),
      unavailableReason: z
        .enum(["not-framework", "not-react", "no-debug-info"])
        .optional(),
    })
    .optional(),
  runtimeComponent: z
    .object({
      componentId: z.string(),
      instanceId: z.string(),
      name: z.string(),
      framework,
      sourceFile: z.string().optional(),
      line: z.number().finite().optional(),
      column: z.number().finite().optional(),
      method: method.optional(),
      ownerKey: z.string().optional(),
      props: z.array(z.object({ name: z.string(), value: z.string() })),
      writeCapability: z.enum(["authored-jsx-literal", "unsupported"]),
      reason: z.string().optional(),
    })
    .optional(),
});

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

export function isElementInfoPayload(value: unknown): value is ElementInfo {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.tagName === "string" &&
    optionalElementInfo.safeParse(value).success &&
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
