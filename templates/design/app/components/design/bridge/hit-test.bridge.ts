/**
 * Lightweight hit-test bridge — injected into every inline canvas iframe so the
 * parent editor can resolve drop-anchor positions via postMessage without a full
 * editor-chrome bridge in non-edit views (e.g. multi-screen overview).
 *
 * Protocol (parent → iframe via postMessage):
 *   { type: 'agent-native:hit-test', correlationId: string, x: number, y: number }
 *   where x/y are in this iframe's viewport coordinate space.
 *   When preview is true, the iframe also renders its local insertion guide.
 *   { type: 'agent-native:hit-test-preview-clear' } hides that guide.
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
  var insertionGuide: HTMLDivElement | null = null;

  function ensureInsertionGuide(): HTMLDivElement {
    if (insertionGuide && document.body.contains(insertionGuide)) {
      return insertionGuide;
    }
    insertionGuide = document.createElement("div");
    insertionGuide.setAttribute("data-agent-native-hit-test-preview", "");
    insertionGuide.setAttribute("data-agent-native-edit-overlay", "drop-guide");
    insertionGuide.style.cssText =
      "position:fixed;pointer-events:none;z-index:99995;display:none;box-sizing:border-box;";
    document.body.appendChild(insertionGuide);
    return insertionGuide;
  }

  function hideInsertionGuide(): void {
    if (insertionGuide) insertionGuide.style.display = "none";
  }

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

  function isAutoLayoutElement(el: Element | null): boolean {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    return (
      cs.display === "flex" ||
      cs.display === "inline-flex" ||
      cs.display === "grid" ||
      cs.display === "inline-grid"
    );
  }

  function isAbsolutePrimitiveContainer(el: Element | null): boolean {
    if (!el || (el.tagName || "").toLowerCase() !== "div") return false;
    var primitive = (
      el.getAttribute("data-an-primitive") ||
      el.getAttribute("data-agent-native-primitive") ||
      ""
    ).toLowerCase();
    if (primitive !== "rectangle" && primitive !== "rect") return false;
    var cs = window.getComputedStyle(el);
    return cs.position === "absolute" || cs.position === "fixed";
  }

  function absolutePrimitiveContainerTargetForPoint(
    clientX: number,
    clientY: number,
  ): {
    anchor: Element;
    placement: string;
    axis: string;
    dropMode: string;
  } | null {
    var hits: Element[] = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : ([document.elementFromPoint(clientX, clientY)] as Element[]);
    var seen: Element[] = [];
    for (var i = 0; i < hits.length; i += 1) {
      var cursor: Element | null = hits[i];
      var candidate: Element | null = null;
      while (cursor && cursor !== document.body) {
        if (isAbsolutePrimitiveContainer(cursor)) {
          candidate = cursor;
          break;
        }
        cursor = cursor.parentElement;
      }
      if (!candidate || seen.indexOf(candidate) !== -1) continue;
      seen.push(candidate);
      if (isOverlayElement(candidate) || isLayerInteractionBlocked(candidate)) {
        continue;
      }
      return {
        anchor: candidate,
        placement: "inside",
        axis: "y",
        dropMode: "absolute-container",
      };
    }
    return null;
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
  ): {
    anchor: Element;
    placement: string;
    axis: string;
    dropMode: string;
  } | null {
    var hit = elementFromEditorPoint(clientX, clientY);
    if (!hit || hit === document.documentElement) return null;

    var cursor: Element | null = hit;
    while (cursor && cursor !== document.body) {
      if (isLayerInteractionBlocked(cursor)) return null;
      var parent: Element | null = cursor.parentElement;
      if (parent && isAutoLayoutElement(parent)) {
        var parentAxis = parentFlowAxis(parent);
        var childRect = cursor.getBoundingClientRect();
        var childCenter =
          parentAxis === "x"
            ? childRect.left + childRect.width / 2
            : childRect.top + childRect.height / 2;
        var childPointer = parentAxis === "x" ? clientX : clientY;
        return {
          anchor: cursor,
          placement: childPointer < childCenter ? "before" : "after",
          axis: parentAxis,
          dropMode: "flow-insert",
        };
      }
      if (isAutoLayoutElement(cursor) && isContainerDropTarget(cursor)) {
        var containerRect = cursor.getBoundingClientRect();
        var edgeAxis = parent ? parentFlowAxis(parent) : parentFlowAxis(cursor);
        var edgePlacement = edgePlacementForRect(
          containerRect,
          edgeAxis,
          clientX,
          clientY,
        );
        if (edgePlacement && parent && isAutoLayoutElement(parent)) {
          return {
            anchor: cursor,
            placement: edgePlacement,
            axis: edgeAxis,
            dropMode: "flow-insert",
          };
        }
        return {
          anchor: cursor,
          placement: "inside",
          axis: parentFlowAxis(cursor),
          dropMode: "flow-insert",
        };
      }
      if (isAbsolutePrimitiveContainer(cursor)) {
        return {
          anchor: cursor,
          placement: "inside",
          axis: "y",
          dropMode: "absolute-container",
        };
      }
      cursor = parent;
    }

    return absolutePrimitiveContainerTargetForPoint(clientX, clientY);
  }

  function showInsertionGuideFor(
    target: { anchor: Element; placement: string; axis: string } | null,
  ): void {
    if (!target || !target.anchor) {
      hideInsertionGuide();
      return;
    }
    var guide = ensureInsertionGuide();
    var rect = target.anchor.getBoundingClientRect();
    guide.style.display = "block";
    guide.style.background = "var(--design-editor-accent-color)";
    guide.style.border = "0";
    guide.style.borderRadius = "999px";
    guide.style.boxShadow = "0 0 0 1px var(--design-editor-accent-color)";
    if (target.placement === "inside") {
      guide.style.left = rect.left + "px";
      guide.style.top = rect.top + "px";
      guide.style.width = rect.width + "px";
      guide.style.height = rect.height + "px";
      guide.style.background =
        "color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)";
      guide.style.border = "2px solid var(--design-editor-accent-color)";
      guide.style.borderRadius = "2px";
      guide.style.boxShadow = "none";
      return;
    }
    if (target.axis === "x") {
      var x = target.placement === "before" ? rect.left : rect.right;
      guide.style.left = x + "px";
      guide.style.top = rect.top + "px";
      guide.style.width = "2px";
      guide.style.height = rect.height + "px";
    } else {
      var y = target.placement === "before" ? rect.top : rect.bottom;
      guide.style.left = rect.left + "px";
      guide.style.top = y + "px";
      guide.style.width = rect.width + "px";
      guide.style.height = "2px";
    }
  }

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    if (!e.data) return;
    if (e.data.type === "agent-native:hit-test-preview-clear") {
      hideInsertionGuide();
      return;
    }
    if (e.data.type !== "agent-native:hit-test") return;
    var correlationId: string = e.data.correlationId;
    var x: number = Number(e.data.x);
    var y: number = Number(e.data.y);
    if (!correlationId) return;
    var result = resolveHitTarget(x, y);
    if (e.data.preview) showInsertionGuideFor(result);
    var anchorNodeId: string = result ? getNodeId(result.anchor) : "";
    var placement: string = result ? result.placement : "inside";
    var axis: string = result ? result.axis : "y";
    var dropMode: string = result ? result.dropMode : "flow-insert";
    var anchorRect = result ? result.anchor.getBoundingClientRect() : null;
    try {
      (window.parent as Window).postMessage(
        {
          type: "agent-native:hit-test-result",
          correlationId: correlationId,
          anchorNodeId: anchorNodeId,
          placement: placement,
          axis: axis,
          dropMode: dropMode,
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
