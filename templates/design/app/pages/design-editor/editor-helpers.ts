import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import { buildCodeLayerProjection } from "@shared/code-layer";

import type { ElementInfo } from "@/components/design/types";
import { designSelectionStateKeysForTab } from "@/hooks/use-navigation-state";
import type {
  PostAuthDesignIntent,
  RuntimeLayerSnapshot,
} from "@/pages/design-editor/command-types";

export function designSelectionStateKeys(): string[] {
  return designSelectionStateKeysForTab(getBrowserTabId());
}

export function runtimeMultiplicityForElementProvenance(
  snapshots: Record<string, RuntimeLayerSnapshot>,
  info: ElementInfo | null | undefined,
): number {
  const provenance = info?.provenance;
  const runtimeComponent = info?.runtimeComponent;
  const hasInvocationProvenance = Boolean(
    runtimeComponent?.sourceFile &&
    runtimeComponent.line &&
    runtimeComponent.column,
  );
  const sourceFile = hasInvocationProvenance
    ? runtimeComponent?.sourceFile
    : provenance?.sourceFile;
  const line = hasInvocationProvenance
    ? runtimeComponent?.line
    : provenance?.line;
  const column = hasInvocationProvenance
    ? runtimeComponent?.column
    : provenance?.column;
  const componentName = hasInvocationProvenance
    ? runtimeComponent?.name
    : provenance?.component;
  if (!sourceFile || !line || !column) {
    return 1;
  }
  let count = 0;
  const invocationKeys = hasInvocationProvenance
    ? new Set<string>()
    : undefined;
  for (const snapshot of Object.values(snapshots)) {
    const projection = buildCodeLayerProjection(snapshot.html);
    for (const node of projection.nodes) {
      const attrs = node.dataAttributes;
      if (
        hasInvocationProvenance &&
        runtimeComponent?.componentId &&
        attrs["data-agent-native-runtime-component-id"] !==
          runtimeComponent.componentId
      ) {
        continue;
      }
      const sourceFileAttribute = hasInvocationProvenance
        ? "data-source-owner-file"
        : "data-source-file";
      const lineAttribute = hasInvocationProvenance
        ? "data-source-owner-line"
        : "data-source-line";
      const columnAttribute = hasInvocationProvenance
        ? "data-source-owner-column"
        : "data-source-column";
      if (
        attrs[sourceFileAttribute] === sourceFile &&
        Number(attrs[lineAttribute]) === line &&
        Number(attrs[columnAttribute]) === column &&
        (!componentName || attrs["data-component-name"] === componentName)
      ) {
        if (invocationKeys) {
          invocationKeys.add(
            JSON.stringify([
              runtimeComponent?.componentId ?? "",
              attrs[sourceFileAttribute],
              attrs[lineAttribute],
              attrs[columnAttribute],
              attrs["data-source-owner-key"] ?? "",
              attrs["data-component-name"] ?? "",
            ]),
          );
        } else {
          count += 1;
        }
      }
    }
  }
  return Math.max(1, invocationKeys?.size ?? count);
}

export function buildSignInHrefForDesignIntent(
  intent: PostAuthDesignIntent,
): string {
  if (typeof window === "undefined") return buildSignInReturnHref();
  return buildSignInReturnHref({
    returnTo: `${window.location.pathname}?intent=${encodeURIComponent(intent)}`,
  });
}

export function buildSignInHrefForComment(): string {
  if (typeof window === "undefined") return buildSignInReturnHref();
  return buildSignInReturnHref({
    returnTo: `${window.location.pathname}${window.location.search}`,
  });
}

export function isSupersededSelectionEcho(
  incoming: ElementInfo,
  current: ElementInfo | null,
): boolean {
  if (incoming.runtimeSourceId?.trim()) return false;
  if (!current) return false;
  const incomingId = incoming.sourceId?.trim();
  const currentId = current.sourceId?.trim();
  if (incomingId && currentId) return incomingId !== currentId;
  const incomingSelector = incoming.selector?.trim();
  const currentSelector = current.selector?.trim();
  if (incomingSelector && currentSelector)
    return incomingSelector !== currentSelector;
  return false;
}

export function describeSelectionForHost(element: ElementInfo): {
  label: string;
  detail: string;
} {
  const text = element.textContent?.trim();
  const label =
    element.provenance?.component ||
    element.componentName ||
    (text ? text.slice(0, 60) : "") ||
    element.tagName.toLowerCase();
  const provenance = element.provenance;
  const sourceFile = provenance?.sourceFile
    ? `${provenance.sourceFile}${provenance.line ? `:${provenance.line}` : ""}`
    : null;
  const classSelector = element.classes?.length
    ? `${element.tagName.toLowerCase()}.${element.classes.slice(0, 2).join(".")}`
    : null;
  const detail =
    sourceFile ??
    classSelector ??
    element.selector ??
    element.tagName.toLowerCase();
  return { label, detail };
}

export function reloadRunningAppPreviewFrames(): void {
  if (typeof document === "undefined") return;
  const frames = document.querySelectorAll<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  for (const frame of frames) {
    const src = frame.getAttribute("src");
    if (!src) continue;
    let origin: string;
    try {
      origin = new URL(src, window.location.href).origin;
      // coercion-ok: an unparsable src names no container to reload.
    } catch {
      continue;
    }
    if (origin === window.location.origin) continue;
    frame.contentWindow?.postMessage({ type: "agentNative.reload" }, origin);
  }
}

export function withMeasuredGeometry(
  info: ElementInfo,
  screenId?: string,
): ElementInfo {
  const rect = info.boundingRect;
  if (rect && (rect.width > 0 || rect.height > 0)) return info;
  if (typeof document === "undefined") return info;
  const selector = info.runtimeSelector ?? info.selector;
  if (!selector) return info;
  const owning = screenId
    ? document.querySelector<HTMLIFrameElement>(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(screenId)}"]`,
      )
    : null;
  if (screenId && !owning) return info;
  const frames = owning
    ? [owning]
    : Array.from(
        document.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        ),
      );
  for (const frame of frames) {
    let node: Element | null = null;
    try {
      node = frame.contentDocument?.querySelector(selector) ?? null;
    } catch {
      node = null;
    }
    if (!node) continue;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 && box.height <= 0) continue;
    const parentBox = node.parentElement?.getBoundingClientRect();
    const scrollX = frame.contentWindow?.scrollX ?? 0;
    const scrollY = frame.contentWindow?.scrollY ?? 0;
    const computed = frame.contentWindow?.getComputedStyle(node);
    return {
      ...info,
      boundingRect: {
        x: box.x + scrollX,
        y: box.y + scrollY,
        width: box.width,
        height: box.height,
      },
      parentBoundingRect: parentBox
        ? {
            x: parentBox.x + scrollX,
            y: parentBox.y + scrollY,
            width: parentBox.width,
            height: parentBox.height,
          }
        : info.parentBoundingRect,
      computedStyles: computed
        ? {
            color: computed.color,
            fontFamily: computed.fontFamily,
            fontSize: computed.fontSize,
            fontStyle: computed.fontStyle,
            fontWeight: computed.fontWeight,
            letterSpacing: computed.letterSpacing,
            lineHeight: computed.lineHeight,
            textAlign: computed.textAlign,
            textDecorationLine: computed.textDecorationLine,
            textTransform: computed.textTransform,
            ...info.computedStyles,
            width: computed.width,
            height: computed.height,
          }
        : info.computedStyles,
    };
  }
  return info;
}
