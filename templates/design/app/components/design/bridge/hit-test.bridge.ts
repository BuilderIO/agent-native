/**
 * Lightweight hit-test bridge — injected into every inline canvas iframe so the
 * parent editor can resolve drop-anchor positions via postMessage without a full
 * editor-chrome bridge in non-edit views (e.g. multi-screen overview).
 *
 * Protocol (parent → iframe via postMessage):
 *   { type: 'agent-native:hit-test', correlationId: string, x: number, y: number }
 *   where x/y are in this iframe's viewport coordinate space.
 *
 * Reply (iframe → window.parent):
 *   { type: 'agent-native:hit-test-result', correlationId: string,
 *     anchorNodeId: string, placement: 'before'|'after'|'inside',
 *     axis: 'x'|'y',
 *     anchorRect: { left: number, top: number, width: number, height: number } }
 *
 * Reads DOM only — no mutations, no event interception. The container-drop and
 * placement logic is intentionally kept in sync with the corresponding helpers
 * inside editor-chrome.bridge.ts (search for "// keep in sync with
 * hit-test.bridge.ts" comments there).
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  // keep in sync with editor-chrome.bridge.ts container/leaf/text tag lists
  var BRIDGE_CONTAINER_TAGS = [
    "div",
    "section",
    "main",
    "header",
    "footer",
    "nav",
    "article",
    "aside",
    "form",
    "ul",
    "ol",
    "figure",
    "fieldset",
    "details",
    "dialog",
    "blockquote",
    "table",
    "tbody",
    "thead",
    "tr",
  ];
  var BRIDGE_LEAF_TAGS = [
    "img",
    "video",
    "picture",
    "audio",
    "canvas",
    "svg",
    "path",
    "input",
    "textarea",
    "select",
    "br",
    "hr",
    "iframe",
  ];
  var BRIDGE_TEXT_TAGS = [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "span",
    "a",
    "strong",
    "em",
    "label",
    "li",
  ];

  function isOverlayElement(el: Element | null): boolean {
    return Boolean(
      el && el.closest && el.closest("[data-agent-native-edit-overlay]"),
    );
  }

  function isLayerInteractionBlocked(el: Element | null): boolean {
    if (!el) return false;
    if (
      el.closest &&
      el.closest(
        '[data-agent-native-locked="true"],[data-agent-native-hidden="true"]',
      )
    )
      return true;
    return false;
  }

  // keep in sync with editor-chrome.bridge.ts isContainerDropTarget
  function isContainerDropTarget(el: Element | null): boolean {
    if (!el || el === document.documentElement) return false;
    if (isOverlayElement(el) || isLayerInteractionBlocked(el)) return false;
    if (el === document.body) return true;
    var tag = (el.tagName || "").toLowerCase();
    if (
      BRIDGE_LEAF_TAGS.indexOf(tag) !== -1 ||
      BRIDGE_TEXT_TAGS.indexOf(tag) !== -1
    )
      return false;
    var cs = window.getComputedStyle(el);
    if (
      cs.display === "flex" ||
      cs.display === "inline-flex" ||
      cs.display === "grid" ||
      cs.display === "inline-grid"
    )
      return true;
    return BRIDGE_CONTAINER_TAGS.indexOf(tag) !== -1;
  }

  // keep in sync with editor-chrome.bridge.ts elementFromEditorPoint
  function elementFromEditorPoint(
    clientX: number,
    clientY: number,
  ): Element | null {
    var targets: Element[] = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : ([document.elementFromPoint(clientX, clientY)] as Element[]);
    for (var i = 0; i < targets.length; i += 1) {
      var target = targets[i];
      if (!target || target.nodeType !== 1) continue;
      // Skip injected bridge overlays so they don't shadow real content.
      if (isOverlayElement(target)) continue;
      if (isLayerInteractionBlocked(target)) return null;
      return target;
    }
    return null;
  }

  // keep in sync with editor-chrome.bridge.ts parentFlowAxis
  function parentFlowAxis(parent: Element): string {
    var cs = window.getComputedStyle(parent);
    if (cs.display === "flex" || cs.display === "inline-flex") {
      var isRow = cs.flexDirection && cs.flexDirection.indexOf("row") === 0;
      var wraps = cs.flexWrap === "wrap" || cs.flexWrap === "wrap-reverse";
      if (isRow && !wraps) return "x";
      return "y";
    }
    if (cs.display === "grid" || cs.display === "inline-grid") {
      var cols = (cs.gridTemplateColumns || "")
        .split(" ")
        .filter(Boolean).length;
      return cols > 1 ? "x" : "y";
    }
    return "y";
  }

  // keep in sync with editor-chrome.bridge.ts edgePlacementForRect
  function edgePlacementForRect(
    rect: DOMRect,
    axis: string,
    clientX: number,
    clientY: number,
  ): string | null {
    var size = axis === "x" ? rect.width : rect.height;
    if (!size) return null;
    var offset = axis === "x" ? clientX - rect.left : clientY - rect.top;
    if (offset < size * 0.22) return "before";
    if (offset > size * 0.78) return "after";
    return null;
  }

  function draggableElementChildren(parent: Element): Element[] {
    return Array.prototype.slice.call(parent.children).filter(function (
      child: Element,
    ) {
      return (
        child.nodeType === 1 &&
        !isOverlayElement(child) &&
        !isLayerInteractionBlocked(child)
      );
    });
  }

  function getNodeId(el: Element | null): string {
    if (!el) return "";
    return (
      el.getAttribute("data-agent-native-node-id") ||
      el.getAttribute("data-code-layer-id") ||
      el.getAttribute("data-layer-id") ||
      el.getAttribute("data-builder-id") ||
      el.id ||
      ""
    );
  }

  /**
   * Resolve the deepest container element under (x, y) and a placement hint,
   * mirroring reorderTargetForPoint from editor-chrome.bridge.ts but
   * without a dragged element (we only need the anchor + placement).
   *
   * keep in sync with editor-chrome.bridge.ts reorderTargetForPoint
   */
  function resolveHitTarget(
    clientX: number,
    clientY: number,
  ): { anchor: Element; placement: string; axis: string } | null {
    var hit = elementFromEditorPoint(clientX, clientY);
    if (!hit || hit === document.documentElement) return null;

    if (isContainerDropTarget(hit)) {
      var containerRect = hit.getBoundingClientRect();
      var edgeAxis = hit.parentElement
        ? parentFlowAxis(hit.parentElement)
        : parentFlowAxis(hit);
      var edgePlacement = edgePlacementForRect(
        containerRect,
        edgeAxis,
        clientX,
        clientY,
      );
      if (!edgePlacement) {
        return { anchor: hit, placement: "inside", axis: parentFlowAxis(hit) };
      }
      return { anchor: hit, placement: edgePlacement, axis: edgeAxis };
    }

    // Non-container: use sibling before/after placement.
    var hitParent = hit.parentElement;
    if (hitParent) {
      var hitAxis = parentFlowAxis(hitParent);
      var hitRect = hit.getBoundingClientRect();
      var hitCenter =
        hitAxis === "x"
          ? hitRect.left + hitRect.width / 2
          : hitRect.top + hitRect.height / 2;
      var hitPointer = hitAxis === "x" ? clientX : clientY;
      return {
        anchor: hit,
        placement: hitPointer < hitCenter ? "before" : "after",
        axis: hitAxis,
      };
    }

    // Fallback: body-level, treat as inside.
    if (hit === document.body || !hit.parentElement) {
      return { anchor: document.body, placement: "inside", axis: "y" };
    }

    return null;
  }

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    if (!e.data || e.data.type !== "agent-native:hit-test") return;
    var correlationId: string = e.data.correlationId;
    var x: number = Number(e.data.x);
    var y: number = Number(e.data.y);
    if (!correlationId) return;
    var result = resolveHitTarget(x, y);
    var anchorNodeId: string = result ? getNodeId(result.anchor) : "";
    var placement: string = result ? result.placement : "inside";
    var axis: string = result ? result.axis : "y";
    var anchorRect = result ? result.anchor.getBoundingClientRect() : null;
    try {
      (window.parent as Window).postMessage(
        {
          type: "agent-native:hit-test-result",
          correlationId: correlationId,
          anchorNodeId: anchorNodeId,
          placement: placement,
          axis: axis,
          anchorRect: anchorRect
            ? {
                left: anchorRect.left,
                top: anchorRect.top,
                width: anchorRect.width,
                height: anchorRect.height,
              }
            : undefined,
        },
        "*",
      );
    } catch (_err) {}
  });
})();
