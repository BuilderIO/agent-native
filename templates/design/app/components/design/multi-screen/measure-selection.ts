import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import { isElementInfoPayload } from "../design-canvas/element-payload";
import { sizeNeedsMeasurement } from "../edit-panel/element-classification";
import type { ElementInfo } from "../types";
import {
  findCanvasIframeForScreen,
  getBreakpointIframeId,
} from "./iframe-targeting";

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
  breakpointWidth?: number;
  viewMode: "single" | "overview";
  boardFileId?: string;
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
      sizeNeedsMeasurement(selectedElement.computedStyles) ||
      (lastMeasured.current?.identity === identity &&
        lastMeasured.current.scope !== scope))
      ? selectionSelector
      : null;
  useEffect(() => {
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
      const next: ElementInfo = {
        ...selectedElement,
        ...measured,
        selector: selectedElement.selector,
        sourceId: selectedElement.sourceId,
        runtimeSelector: selectedElement.runtimeSelector,
        runtimeSourceId: selectedElement.runtimeSourceId,
        sourceLayerIdentity: selectedElement.sourceLayerIdentity,
        classes: selectedElement.classes,
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
      if (isElementInfoPayload(payload)) settle(payload);
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
