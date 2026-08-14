import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import { buildCodeLayerProjection } from "@shared/code-layer";

import type { ElementInfo } from "@/components/design/types";
import { designSelectionStateKeysForTab } from "@/hooks/use-navigation-state";
import type {
  PostAuthDesignIntent,
  RuntimeLayerSnapshot,
} from "@/pages/design-editor/command-types";

// Selection is tab-scoped (like navigation) so a second editor tab cannot
// overwrite this tab's selection context. The global key is mirrored as a
// fallback for CLI/external agents that do not send a browser tab id.
export function designSelectionStateKeys(): string[] {
  return designSelectionStateKeysForTab(getBrowserTabId());
}

export function runtimeMultiplicityForElementProvenance(
  snapshots: Record<string, RuntimeLayerSnapshot>,
  info: ElementInfo | null | undefined,
): number {
  const provenance = info?.provenance;
  if (!provenance?.sourceFile || !provenance.line || !provenance.column) {
    return 1;
  }
  let count = 0;
  for (const snapshot of Object.values(snapshots)) {
    const projection = buildCodeLayerProjection(snapshot.html);
    for (const node of projection.nodes) {
      const attrs = node.dataAttributes;
      if (
        attrs["data-source-file"] === provenance.sourceFile &&
        Number(attrs["data-source-line"]) === provenance.line &&
        Number(attrs["data-source-column"]) === provenance.column &&
        (!provenance.component ||
          attrs["data-component-name"] === provenance.component)
      ) {
        count += 1;
      }
    }
  }
  return Math.max(1, count);
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
  return buildSignInReturnHref({ returnTo: window.location.pathname });
}

/**
 * True only when the incoming (intent-less) selection authoritatively refers to
 * a different element than the committed one (sourceId match wins, else CSS
 * selector). Returns false when identity can't be compared, so a real selection
 * is never dropped.
 */
export function isSupersededSelectionEcho(
  incoming: ElementInfo,
  current: ElementInfo | null,
): boolean {
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

/**
 * A code-layer-derived ElementInfo carries authored inline styles and a zero
 * rect, so the inspector shows 0 for anything the source does not state
 * (hug sizing, in-flow position). Measure the live preview node instead.
 */
export function withMeasuredGeometry(
  info: ElementInfo,
  screenId?: string,
): ElementInfo {
  const rect = info.boundingRect;
  if (rect && (rect.width > 0 || rect.height > 0)) return info;
  if (typeof document === "undefined") return info;
  const selector = info.runtimeSelector ?? info.selector;
  if (!selector) return info;
  // Selectors and stamped ids are per-screen, so an unscoped scan can measure
  // identical markup on a different screen.
  const owning = screenId
    ? document.querySelector<HTMLIFrameElement>(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(screenId)}"]`,
      )
    : null;
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
    const computed = frame.contentWindow?.getComputedStyle(node);
    return {
      ...info,
      boundingRect: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      computedStyles: computed
        ? {
            width: computed.width,
            height: computed.height,
            ...info.computedStyles,
          }
        : info.computedStyles,
    };
  }
  return info;
}
