import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { z } from "zod";

import { isElementInfoPayload } from "../design-canvas/element-payload";
import { sizeNeedsMeasurement } from "../edit-panel/element-classification";
import type { ElementInfo } from "../types";
import {
  findCanvasIframeForScreen,
  getBreakpointIframeId,
} from "./iframe-targeting";

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const rect = point.extend({
  width: z.number().finite(),
  height: z.number().finite(),
});
const framework = z.enum(["html", "react", "vue", "svelte", "angular", "lwc"]);
const method = z.enum([
  "data-attribute",
  "debug-source",
  "debug-stack",
  "debug-stack-remapped",
  "vue-inspector",
  "svelte-meta",
]);

function isPortableSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.nodes) ||
    (snapshot.rootSourceId !== undefined &&
      typeof snapshot.rootSourceId !== "string")
  )
    return false;
  return snapshot.nodes.every((node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const entry = node as Record<string, unknown>;
    if (
      (entry.sourceId !== undefined && typeof entry.sourceId !== "string") ||
      !Array.isArray(entry.path) ||
      !entry.path.every(Number.isFinite) ||
      !entry.styles ||
      typeof entry.styles !== "object" ||
      Array.isArray(entry.styles)
    )
      return false;
    return Object.values(entry.styles).every(
      (style) => typeof style === "string",
    );
  });
}

// Only measurement replies merge their remaining metadata into existing selection state.
const measurementMetadata = z
  .object({
    componentName: z.string(),
    componentAnnotation: z.string(),
    id: z.string(),
    pendingNodeId: z.string(),
    primitiveKind: z.string(),
    textContent: z.string(),
    htmlContent: z.string(),
    imageSource: z.string(),
    parentDisplay: z.string(),
    hasOwnText: z.boolean(),
    wholeTextStyleRoot: z.boolean(),
    isGroup: z.boolean(),
    vectorStrokeCanAlign: z.boolean(),
    styleSnapshotCaptureFailed: z.boolean(),
    styleSnapshotReadOnDemand: z.boolean(),
    textContentTruncated: z.boolean(),
    htmlContentTruncated: z.boolean(),
    isGridContainer: z.boolean(),
    childElementCount: z.number().finite(),
    confidence: z.number().finite(),
    parentBoundingRect: rect,
    positionReferenceRect: rect,
    positionContainingBlockOrigin: point,
    absoluteSiblingVisualOrigin: point,
    positionContainingBlockTransform: z.object({
      a: z.number().finite(),
      b: z.number().finite(),
      c: z.number().finite(),
      d: z.number().finite(),
    }),
    svgShapeOffset: point.nullable(),
    relativeContainingBlockDirection: z.enum(["ltr", "rtl"]),
    portableStyleSnapshot: z.custom(isPortableSnapshot),
    childLayouts: z.object({
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
    }),
    parentAutoLayout: z.object({
      display: z.string().optional(),
      selector: z.string().optional(),
      sourceId: z.string().optional(),
      boundingRect: rect,
    }),
    parentLayout: z
      .object({
        display: z.string(),
        flexDirection: z.string(),
        alignItems: z.string(),
        justifyContent: z.string(),
        gap: z.string(),
        gridAutoFlow: z.string(),
        gridTemplateColumns: z.string(),
        gridTemplateRows: z.string(),
        position: z.string(),
      })
      .partial(),
    repeat: z.object({
      sourceSelector: z.string(),
      instanceCount: z.number().finite(),
      instanceIndex: z.number().finite(),
      xFor: z.string(),
      itemIndex: z.number().finite(),
      textBinding: z.string(),
      keyExpression: z.string(),
      itemKey: z.string(),
    }),
    provenance: z
      .object({
        framework,
        sourceFile: z.string(),
        line: z.number().finite(),
        column: z.number().finite(),
        component: z.string(),
        ownerSourceFile: z.string(),
        ownerLine: z.number().finite(),
        ownerColumn: z.number().finite(),
        ownerComponentName: z.string(),
        ownerKey: z.string(),
        method,
        ownerMethod: method,
        unavailableReason: z.enum([
          "not-framework",
          "not-react",
          "no-debug-info",
        ]),
      })
      .partial(),
    runtimeComponent: z.object({
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
    }),
  })
  .partial();

export function selectionMeasurementBreakpoint(
  viewMode: "single" | "overview",
  activeBreakpointWidth: number | undefined,
  overviewBreakpointWidth: number | undefined,
): number | undefined {
  return viewMode === "single"
    ? activeBreakpointWidth
    : overviewBreakpointWidth;
}

export function useSelectionMeasurement({
  selectedElement,
  setSelectedElement,
  screenId,
  breakpointWidth,
  viewMode,
  boardFileId,
  activeFileIdRef,
}: {
  selectedElement: ElementInfo | null;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  screenId: string;
  breakpointWidth?: number | undefined;
  viewMode: "single" | "overview";
  boardFileId?: string | undefined;
  activeFileIdRef: RefObject<string | null>;
}) {
  const lastMeasured = useRef<{
    element: ElementInfo;
    identity: string;
    scope: string;
  } | null>(null);
  const scope = JSON.stringify([
    screenId,
    breakpointWidth,
    viewMode,
    boardFileId,
  ]);
  const selectionSelector =
    selectedElement?.runtimeSelector ?? selectedElement?.selector ?? null;
  const identity = JSON.stringify([
    screenId,
    selectedElement?.sourceLayerIdentity?.screenId,
    selectedElement?.sourceLayerIdentity?.nodeId,
    selectedElement?.sourceId,
    selectedElement?.runtimeSourceId,
    selectionSelector,
  ]);
  const selector =
    selectedElement &&
    (selectedElement.needsLiveMeasurement ||
      (sizeNeedsMeasurement(selectedElement.computedStyles) &&
        (lastMeasured.current?.identity !== identity ||
          lastMeasured.current.scope !== scope)) ||
      (lastMeasured.current?.identity === identity &&
        lastMeasured.current.scope !== scope))
      ? selectionSelector
      : null;
  useEffect(() => {
    if (lastMeasured.current?.identity !== identity)
      lastMeasured.current = null;
    if (
      !selector ||
      !selectedElement ||
      !screenId ||
      (lastMeasured.current?.element === selectedElement &&
        lastMeasured.current.scope === scope)
    )
      return;
    let cancelled = false;
    void requestSelectionMeasurement({
      targetWindows: () =>
        designPreviewWindowsForScreen(
          screenId,
          viewMode === "overview" ? breakpointWidth : undefined,
          viewMode === "overview" ? boardFileId : undefined,
        ),
      screenId,
      selector,
    }).then((measured) => {
      if (cancelled || !measured || activeFileIdRef.current !== screenId)
        return;
      const {
        selector: _selector,
        sourceId: _sourceId,
        runtimeSelector: _runtimeSelector,
        runtimeSourceId: _runtimeSourceId,
        sourceLayerIdentity: _sourceLayerIdentity,
        classes: _classes,
        ...measurement
      } = measured;
      const next: ElementInfo = {
        ...selectedElement,
        ...measurement,
        needsLiveMeasurement: false,
      };
      lastMeasured.current = { element: next, identity, scope };
      setSelectedElement((prev) =>
        prev === selectedElement && activeFileIdRef.current === screenId
          ? next
          : prev,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    selectedElement,
    selector,
    screenId,
    breakpointWidth,
    viewMode,
    boardFileId,
    activeFileIdRef,
    setSelectedElement,
    scope,
    identity,
  ]);
}

export async function requestSelectionMeasurement(args: {
  targetWindows: () => (Window | null | undefined)[];
  screenId: string;
  selector?: string;
  attempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}): Promise<ElementInfo | null> {
  const attempts = Math.max(1, args.attempts ?? 3);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const measured = await measureOnce(args);
    if (measured) return measured;
    if (attempt < attempts - 1) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, args.retryDelayMs ?? 150),
      );
    }
  }
  return null;
}

function measureOnce(args: {
  targetWindows: () => (Window | null | undefined)[];
  screenId: string;
  selector?: string;
  timeoutMs?: number;
}): Promise<ElementInfo | null> {
  const targets = args.targetWindows().filter((w): w is Window => Boolean(w));
  if (targets.length === 0) return Promise.resolve(null);
  const correlationId = `measure-${globalThis.crypto.randomUUID()}`;
  return new Promise((resolve) => {
    const settle = (value: ElementInfo | null) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(value);
    };
    const timer = window.setTimeout(() => settle(null), args.timeoutMs ?? 250);
    const listener = (event: MessageEvent) => {
      if (
        !event.data ||
        event.data.type !== "agent-native:selection-measured" ||
        event.data.correlationId !== correlationId ||
        event.data.screenId !== args.screenId ||
        !targets.includes(event.source as Window)
      ) {
        return;
      }
      const payload: unknown = event.data.payload;
      if (
        isElementInfoPayload(payload) &&
        measurementMetadata.safeParse(payload).success
      ) {
        settle(payload);
      }
    };
    window.addEventListener("message", listener);
    for (const target of targets) {
      target.postMessage(
        {
          type: "agent-native:measure-selection",
          correlationId,
          screenId: args.screenId,
          selector: args.selector,
        },
        "*",
      );
    }
  });
}

export function designPreviewWindows(): Window[] {
  return [
    ...document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe], iframe[data-screen-iframe-id]",
    ),
  ]
    .map((iframe) => iframe.contentWindow)
    .filter((w): w is Window => Boolean(w));
}

export function designPreviewWindowsForScreen(
  screenId: string,
  breakpointWidth?: number,
  boardFileId?: string,
): Window[] {
  if (typeof document === "undefined") return [];
  const iframeId =
    boardFileId && screenId === boardFileId
      ? boardFileId
      : breakpointWidth === undefined
        ? screenId
        : getBreakpointIframeId(screenId, breakpointWidth);
  const iframe = findCanvasIframeForScreen(
    document.body,
    iframeId,
    boardFileId,
  );
  return iframe?.contentWindow ? [iframe.contentWindow] : [];
}
