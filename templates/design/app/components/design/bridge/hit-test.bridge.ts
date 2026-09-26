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
 *     anchorNodeId: string, pendingNodeId: string | undefined,
 *     anchorSelector: string | undefined,
 *     placement: 'before'|'after'|'inside', axis: 'x'|'y',
 *     anchorRect: { left: number, top: number, width: number, height: number } }
 *
 * `anchorSelector` accompanies `pendingNodeId`, and also accompanies an
 * ambiguous stable anchor id only when the hit-test has an exact source
 * revision proof: a body-rooted structural `tag:nth-of-type(n) > …` path
 * whose nth indexes are SOURCE-EQUIVALENT —
 * computed against the live DOM but skipping Alpine-generated siblings
 * (x-for clones and x-if instantiations, identified via the sibling
 * templates' own `_x_lookup` / `_x_currentIfEl` bookkeeping) and
 * editor-injected overlay elements, so the path resolves to the SAME element
 * in the persisted source HTML (where none of those runtime nodes exist).
 * The host uses it to persist `pendingNodeId` as the anchor's real
 * `data-agent-native-node-id` in the stored document (two-step handshake,
 * mirroring editor-chrome's getElementInfo selection contract) before
 * resolving the drop against it. Omitted when the anchor itself is an
 * Alpine-generated instance (no per-instance source node exists — the host
 * keeps its absolute-placement fallback for that case).
 *
 * Reads DOM only, no event interception — with one narrow, intentional
 * exception mirroring editor-chrome.bridge.ts's getElementInfo: when the
 * resolved anchor has no stable id anywhere in its own ancestry (common on
 * AI-generated screens, which frequently ship with zero
 * data-agent-native-node-id attributes), getNodeId mints and stamps a
 * `data-an-pending-node-id` marker on it and returns that id as
 * `pendingNodeId` alongside an empty `anchorNodeId` — the same
 * mint-then-let-the-host-persist contract getElementInfo already uses for
 * in-screen selection (see the "Id-on-demand" comment there). Without this,
 * every cross-screen/canvas-to-screen flow-insert into an id-less screen
 * silently degrades to absolute placement, because the host has no anchor id
 * to resolve against even when the hit-test correctly found a valid
 * before/after/inside slot. The stamp itself is inert (an extra data-*
 * attribute, not read by getNodeId's own stable-id list) until a host caller
 * persists it into the document's real data-agent-native-node-id — same
 * two-step handshake as the in-screen path. The container-drop and placement
 * logic is intentionally kept in sync with the corresponding helpers inside
 * editor-chrome.bridge.ts (search for "// keep in sync with hit-test.bridge.ts"
 * comments there).
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
  var BRIDGE_INTERACTIVE_LEAF_TAGS = ["button", "summary"];

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

  function hasOnlyLeafContent(el: Element): boolean {
    var children = el.children;
    if (!children.length) return true;
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i] as Element;
      var childTag = (child.tagName || "").toLowerCase();
      if (
        BRIDGE_LEAF_TAGS.indexOf(childTag) === -1 &&
        BRIDGE_TEXT_TAGS.indexOf(childTag) === -1 &&
        BRIDGE_INTERACTIVE_LEAF_TAGS.indexOf(childTag) === -1
      ) {
        return false;
      }
      if (child.children.length && !hasOnlyLeafContent(child)) return false;
    }
    return true;
  }

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
    if (
      BRIDGE_INTERACTIVE_LEAF_TAGS.indexOf(tag) !== -1 &&
      hasOnlyLeafContent(el)
    ) {
      return false;
    }
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
      if (isOverlayElement(target)) continue;
      if (isLayerInteractionBlocked(target)) return null;
      return target;
    }
    return null;
  }

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

  function wrappedFlexMainAxis(parent: Element): string | null {
    var cs = window.getComputedStyle(parent);
    if (cs.display !== "flex" && cs.display !== "inline-flex") {
      return null;
    }
    if (cs.flexWrap !== "wrap" && cs.flexWrap !== "wrap-reverse") {
      return null;
    }
    return cs.flexDirection && cs.flexDirection.indexOf("row") === 0
      ? "x"
      : "y";
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

  var BRIDGE_REPLACED_TAGS: Record<string, boolean> = {
    img: true,
    video: true,
    picture: true,
    audio: true,
    canvas: true,
    svg: true,
    path: true,
    input: true,
    textarea: true,
    select: true,
    br: true,
    hr: true,
    iframe: true,
  };
  var BRIDGE_ADOPTING_PRIMITIVES: Record<string, boolean> = {
    frame: true,
    rectangle: true,
    rect: true,
  };


  function isFreeformRelativeContainer(el: Element | null): boolean {
    if (!el || el === document.body || el === document.documentElement) {
      return false;
    }
    if (isAutoLayoutElement(el)) return false;
    if (window.getComputedStyle(el).position === "static") return false;
    var children = el.children;
    if (children.length === 0) return false;
    for (var i = 0; i < children.length; i += 1) {
      if (isOverlayElement(children[i])) continue;
      var childPosition = window.getComputedStyle(children[i]).position;
      if (childPosition !== "absolute" && childPosition !== "fixed") {
        return false;
      }
    }
    return true;
  }

  function isAbsolutePrimitiveContainer(el: Element | null): boolean {
    if (!el || el.nodeType !== 1) return false;
    if (BRIDGE_REPLACED_TAGS[(el.tagName || "").toLowerCase()]) return false;
    if (isAutoLayoutElement(el)) return false;
    var primitive = (
      el.getAttribute("data-an-primitive") ||
      el.getAttribute("data-agent-native-primitive") ||
      ""
    ).toLowerCase();
    if (primitive) {
      if (!BRIDGE_ADOPTING_PRIMITIVES[primitive]) return false;
    } else if (!hasAbsolutePositionedChild(el)) {
      return false;
    }
    var cs = window.getComputedStyle(el);
    if (primitive === "frame" && cs.position === "relative") return true;
    return cs.position === "absolute" || cs.position === "fixed";
  }

  function hasAbsolutePositionedChild(el: Element): boolean {
    var kids = el.children;
    for (var i = 0; i < kids.length; i += 1) {
      if (isOverlayElement(kids[i])) continue;
      var kidPosition = window.getComputedStyle(kids[i]).position;
      if (kidPosition === "absolute" || kidPosition === "fixed") return true;
    }
    return false;
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
        if (
          isAbsolutePrimitiveContainer(cursor) ||
          isFreeformRelativeContainer(cursor)
        ) {
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

  function getNodeId(el: Element | null): string {
    if (!el) return "";
    return (
      el.getAttribute("data-agent-native-node-id") ||
      el.getAttribute("data-code-layer-id") ||
      el.getAttribute("data-layer-id") ||
      el.getAttribute("data-builder-id") ||
      el.getAttribute("data-loc") ||
      el.id ||
      ""
    );
  }

  function escapeAttribute(value: unknown): string {
    var text = String(value);
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(text);
    }
    return text.replace(/[\0-\x1f\x7f\\"]/g, function (character) {
      if (character === "\\" || character === '"') return "\\" + character;
      return "\\" + character.charCodeAt(0).toString(16) + " ";
    });
  }

  function isUniqueRenderedNodeId(
    nodeId: string,
    expectedElement: Element | null,
  ): boolean {
    if (!nodeId) return false;
    var selectors = [
      '[data-agent-native-node-id="' + escapeAttribute(nodeId) + '"]',
      '[data-code-layer-id="' + escapeAttribute(nodeId) + '"]',
      '[data-layer-id="' + escapeAttribute(nodeId) + '"]',
      '[data-builder-id="' + escapeAttribute(nodeId) + '"]',
      '[data-loc="' + escapeAttribute(nodeId) + '"]',
      '[id="' + escapeAttribute(nodeId) + '"]',
    ];
    var matches = document.querySelectorAll(selectors.join(","));
    return matches.length === 1 && matches[0] === expectedElement;
  }

  function getAnchorNodeProvenance(
    nodeId: string,
    anchor: Element | null,
  ): { versionHash?: string; uniqueNodeId?: string } | undefined {
    if (!anchor || isTemplateCloneElement(anchor)) return undefined;
    var candidate = (window as any).__agentNativeSourceProvenance;
    if (!candidate || typeof candidate !== "object") return undefined;
    var versionHash =
      typeof candidate.versionHash === "string" && candidate.versionHash
        ? candidate.versionHash
        : undefined;
    var uniqueNodeId =
      nodeId &&
      Array.isArray(candidate.uniqueNodeIds) &&
      candidate.uniqueNodeIds.indexOf(nodeId) !== -1 &&
      isUniqueRenderedNodeId(nodeId, anchor)
        ? nodeId
        : undefined;
    if (!versionHash && !uniqueNodeId) return undefined;
    var provenance: { versionHash?: string; uniqueNodeId?: string } = {};
    if (versionHash) provenance.versionHash = versionHash;
    if (uniqueNodeId) provenance.uniqueNodeId = uniqueNodeId;
    return provenance;
  }

  function layerNameForElement(el: Element | null): string {
    if (!el || !el.getAttribute) return "";
    var attributes = [
      "data-agent-native-layer-name",
      "data-layer-name",
      "layer-name",
    ];
    for (var i = 0; i < attributes.length; i += 1) {
      var value = el.getAttribute(attributes[i]);
      var trimmed = value && value.trim ? value.trim() : "";
      if (trimmed) return trimmed;
    }
    return "";
  }

  function isTemplateCloneElement(el: Element | null): boolean {
    var node: Element | null = el;
    while (node && node !== document.documentElement) {
      var parent = node.parentElement;
      if (!parent) return false;
      if (alpineGeneratedChildrenOf(parent).indexOf(node) !== -1) return true;
      node = parent;
    }
    return false;
  }

  function draggableElementChildren(parent: Element): Element[] {
    return Array.prototype.slice.call(parent.children).filter(function (
      child: Element,
    ) {
      return (
        child.nodeType === 1 &&
        !isOverlayElement(child) &&
        !isLayerInteractionBlocked(child) &&
        !isTemplateCloneElement(child)
      );
    });
  }

  function freshRuntimeNodeId(prefix: string): string {
    var random = "";
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var bytes = new Uint32Array(2);
        window.crypto.getRandomValues(bytes);
        random = Array.prototype.map
          .call(bytes, function (part: number) {
            return part.toString(36);
          })
          .join("");
      }
    } catch (_err) {}
    if (!random)
      random = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return "an-" + String(prefix || "pending") + "-" + random;
  }

  function getOrMintPendingNodeId(el: Element | null): string {
    if (!el || !el.getAttribute || !el.setAttribute) return "";
    if (el === document.body || el === document.documentElement) return "";
    if (isTemplateCloneElement(el)) return "";
    var existing = el.getAttribute("data-an-pending-node-id");
    if (existing) return existing;
    var minted = freshRuntimeNodeId("pending");
    try {
      el.setAttribute("data-an-pending-node-id", minted);
    } catch (_err) {}
    return minted;
  }


  // Elements generated by an Alpine template sibling: x-for clones are the
  function alpineGeneratedChildrenOf(parent: Element): Element[] {
    var generated: Element[] = [];
    var children = parent.children;
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i] as Element & {
        _x_lookup?: Map<unknown, Element> | Record<string, Element>;
        _x_currentIfEl?: Element;
      };
      if (!child.tagName || child.tagName.toLowerCase() !== "template") {
        continue;
      }
      try {
        if (child._x_currentIfEl) generated.push(child._x_currentIfEl);
        var lookup = child._x_lookup;
        if (lookup) {
          var map = lookup as Map<unknown, Element>;
          if (
            typeof map.forEach === "function" &&
            typeof map.get === "function"
          ) {
            map.forEach(function (item) {
              if (item) generated.push(item);
            });
          } else {
            var record = lookup as Record<string, Element>;
            for (var key in record) {
              if (Object.prototype.hasOwnProperty.call(record, key)) {
                var item = record[key];
                if (item) generated.push(item);
              }
            }
          }
        }
      } catch (_err) {}
    }
    return generated;
  }

  function isEditorInjectedElement(el: Element): boolean {
    return !!(
      el.getAttribute &&
      (el.getAttribute("data-agent-native-edit-overlay") !== null ||
        el.getAttribute("data-agent-native-hit-test-preview") !== null)
    );
  }

  function buildSourceEquivalentSelector(el: Element | null): string {
    if (!el || el === document.documentElement || el === document.body) {
      return "";
    }
    var parts: string[] = [];
    var node: Element | null = el;
    while (node && node !== document.body) {
      var parent: Element | null = node.parentElement;
      if (!parent) return "";
      var generated = alpineGeneratedChildrenOf(parent);
      if (generated.indexOf(node) !== -1) return "";
      if (isEditorInjectedElement(node)) return "";
      var tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (!tag || tag === "template") return "";
      var nth = 0;
      var siblings = parent.children;
      for (var i = 0; i < siblings.length; i += 1) {
        var sib = siblings[i];
        if (!sib.tagName || sib.tagName.toLowerCase() !== tag) continue;
        if (generated.indexOf(sib) !== -1) continue;
        if (isEditorInjectedElement(sib)) continue;
        nth += 1;
        if (sib === node) break;
      }
      if (nth === 0) return "";
      parts.unshift(tag + ":nth-of-type(" + nth + ")");
      node = parent;
    }
    if (!node) return "";
    parts.unshift("body");
    return parts.join(" > ");
  }

  function nearestChildInsertionTarget(
    container: Element,
    clientX: number,
    clientY: number,
  ) {
    var children = draggableElementChildren(container);
    if (!children.length) return null;
    var wrappedFlexAxis = wrappedFlexMainAxis(container);
    var axis = wrappedFlexAxis || parentFlowAxis(container);
    var containerStyles = window.getComputedStyle(container);
    var multiTrackGrid =
      (containerStyles.display === "grid" ||
        containerStyles.display === "inline-grid") &&
      (containerStyles.gridTemplateColumns || "").split(" ").filter(Boolean)
        .length > 1;
    var best: Element | null = null;
    var bestDistance = Infinity;
    var placement = "after";
    for (var j = 0; j < children.length; j += 1) {
      var rect = children[j].getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      var center =
        axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      var pointer = axis === "x" ? clientX : clientY;
      var distance =
        multiTrackGrid || wrappedFlexAxis
          ? Math.hypot(
              clientX - (rect.left + rect.width / 2),
              clientY - (rect.top + rect.height / 2),
            )
          : Math.abs(pointer - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = children[j];
        var placementPointer = axis === "x" ? clientX : clientY;
        placement =
          multiTrackGrid || wrappedFlexAxis
            ? placementPointer < center
              ? "before"
              : "after"
            : pointer < center
              ? "before"
              : "after";
      }
    }
    if (!best) return null;
    return {
      anchor: best,
      placement: placement,
      axis: axis,
      dropMode: "flow-insert",
    };
  }

  function screenRootFlowInsertionTargetForPoint(
    clientX: number,
    clientY: number,
  ) {
    if (!isAutoLayoutElement(document.body)) return null;
    var bodyRect = document.body.getBoundingClientRect();
    if (
      bodyRect.width <= 0 ||
      bodyRect.height <= 0 ||
      clientX < bodyRect.left ||
      clientX > bodyRect.right || // i18n-ignore non-user-facing pointer geometry condition
      clientY < bodyRect.top ||
      clientY > bodyRect.bottom
    ) {
      return null;
    }
    return nearestChildInsertionTarget(document.body, clientX, clientY);
  }

  function resolveHitTarget(
    clientX: number,
    clientY: number,
    forceNestedAutoLayout = false,
  ): {
    anchor: Element;
    placement: string;
    axis: string;
    dropMode: string;
  } | null {
    var hit = elementFromEditorPoint(clientX, clientY);
    if (!hit || hit === document.documentElement) return null;

    var cursor: Element | null = hit;
    if (forceNestedAutoLayout) {
      while (cursor && cursor !== document.body) {
        if (isOverlayElement(cursor) || isLayerInteractionBlocked(cursor)) {
          return null;
        }
        if (isAutoLayoutElement(cursor) && isContainerDropTarget(cursor)) {
          return (
            nearestChildInsertionTarget(cursor, clientX, clientY) || {
              anchor: cursor,
              placement: "inside",
              axis: parentFlowAxis(cursor),
              dropMode: "flow-insert",
            }
          );
        }
        cursor = cursor.parentElement;
      }
      cursor = hit;
    }
    while (cursor && cursor !== document.body) {
      if (isLayerInteractionBlocked(cursor)) return null;
      var parent: Element | null = cursor.parentElement;
      if (parent && isAutoLayoutElement(parent)) {
        if (isTemplateCloneElement(cursor)) {
          var cloneFallback = nearestChildInsertionTarget(
            parent,
            clientX,
            clientY,
          );
          if (cloneFallback) return cloneFallback;
          return {
            anchor: parent,
            placement: "inside",
            axis: parentFlowAxis(parent),
            dropMode: "flow-insert",
          };
        }
        var wrappedParentAxis = wrappedFlexMainAxis(parent);
        if (wrappedParentAxis) {
          var wrappedParentSlot = nearestChildInsertionTarget(
            parent,
            clientX,
            clientY,
          );
          if (wrappedParentSlot) return wrappedParentSlot;
        }
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
        var betweenChildren = nearestChildInsertionTarget(
          cursor,
          clientX,
          clientY,
        );
        if (betweenChildren) return betweenChildren;
        return {
          anchor: cursor,
          placement: "inside",
          axis: parentFlowAxis(cursor),
          dropMode: "flow-insert",
        };
      }
      if (
        isAbsolutePrimitiveContainer(cursor) ||
        isFreeformRelativeContainer(cursor)
      ) {
        return {
          anchor: cursor,
          placement: "inside",
          axis: "y",
          dropMode: "absolute-container",
        };
      }
      cursor = parent;
    }

    var screenRootTarget = screenRootFlowInsertionTargetForPoint(
      clientX,
      clientY,
    );
    if (screenRootTarget) return screenRootTarget;

    var absoluteTarget = absolutePrimitiveContainerTargetForPoint(
      clientX,
      clientY,
    );
    if (absoluteTarget) return absoluteTarget;
    var blockCursor: Element | null = hit;
    while (blockCursor) {
      if (isContainerDropTarget(blockCursor)) {
        return {
          anchor: blockCursor,
          placement: "inside",
          axis: "y",
          dropMode: "flow-insert",
        };
      }
      blockCursor = blockCursor.parentElement;
    }
    return null;
  }

  function ignoreAutoLayoutHitTarget(
    target: {
      anchor: Element;
      placement: string;
      axis: string;
      dropMode: string;
    } | null,
    ignoreAutoLayout = false,
  ) {
    if (!ignoreAutoLayout || !target || target.dropMode !== "flow-insert") {
      return target;
    }
    var container =
      target.placement === "inside"
        ? target.anchor
        : target.anchor.parentElement;
    if (!container || !isAutoLayoutElement(container)) return target;
    return {
      anchor: container,
      placement: "inside",
      axis: parentFlowAxis(container),
      dropMode: "absolute-container",
    };
  }

  function applyHitTestSizeGuard(
    target: {
      anchor: Element;
      placement: string;
      axis: string;
      dropMode: string;
    } | null,
    clientX: number,
    clientY: number,
    sourceElementSize?: { width: number; height: number },
    modifiers?: {
      metaKey?: boolean;
      ctrlKey?: boolean;
      ignoreAutoLayout?: boolean;
      forceNestedAutoLayout?: boolean;
    },
  ) {
    if (
      !target ||
      target.placement !== "inside" ||
      target.dropMode !== "flow-insert" ||
      !sourceElementSize ||
      modifiers?.metaKey ||
      modifiers?.ctrlKey ||
      modifiers?.ignoreAutoLayout
    ) {
      return target;
    }
    var container = target.anchor;
    if (
      container === document.body ||
      container === document.documentElement ||
      !isAutoLayoutElement(container)
    ) {
      return target;
    }
    var crect = container.getBoundingClientRect();
    if (
      crect.width >= sourceElementSize.width &&
      crect.height >= sourceElementSize.height
    ) {
      return target;
    }
    var parent = container.parentElement;
    if (!parent) return null;
    var pAxis = parentFlowAxis(parent);
    var center =
      pAxis === "x"
        ? crect.left + crect.width / 2
        : crect.top + crect.height / 2;
    var pointer = pAxis === "x" ? clientX : clientY;
    return {
      anchor: container,
      placement: pointer < center ? "before" : "after",
      axis: pAxis,
      dropMode: "flow-insert",
    };
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

  function reviewAnchorElementAtPoint(
    clientX: number,
    clientY: number,
  ): Element | null {
    var element = elementFromEditorPoint(clientX, clientY);
    if (!element) return null;
    var identifiedAncestor: Element | null = null;
    var current: Element | null = element;
    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      if (
        current.matches(
          "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[id]",
        )
      ) {
        identifiedAncestor = current;
        break;
      }
      current = current.parentElement;
    }
    if (
      identifiedAncestor &&
      identifiedAncestor !== document.body &&
      identifiedAncestor !== document.documentElement
    ) {
      return identifiedAncestor;
    }
    if (element === document.body || element === document.documentElement) {
      return null;
    }
    return element;
  }

  function reviewNodeElements(nodeIds: string[]): Record<string, Element> {
    var wanted: Record<string, boolean> = {};
    var found: Record<string, Element> = {};
    for (var index = 0; index < nodeIds.length; index += 1) {
      var nodeId = nodeIds[index];
      if (nodeId) wanted[nodeId] = true;
    }
    var candidates = document.querySelectorAll(
      "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[id]",
    );
    for (
      var candidateIndex = 0;
      candidateIndex < candidates.length;
      candidateIndex += 1
    ) {
      var candidate = candidates[candidateIndex];
      var candidateId = getNodeId(candidate);
      if (candidateId && wanted[candidateId] && !found[candidateId]) {
        found[candidateId] = candidate;
      }
    }
    return found;
  }

  function postReviewLayout(): void {
    try {
      (window.parent as Window).postMessage(
        { type: "agent-native:review-layout" },
        "*",
      );
    } catch (_err) {}
  }

  var reviewLayoutFrame = 0;
  function scheduleReviewLayout(): void {
    if (reviewLayoutFrame) return;
    reviewLayoutFrame = window.requestAnimationFrame(function () {
      reviewLayoutFrame = 0;
      postReviewLayout();
    });
  }

  window.addEventListener("scroll", scheduleReviewLayout, true);
  window.addEventListener("resize", scheduleReviewLayout);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleReviewLayout, {
      once: true,
    });
  } else {
    scheduleReviewLayout();
  }

  var NON_SELECTABLE_TAGS = [
    "script",
    "style",
    "template",
    "link",
    "meta",
    "title",
    "noscript",
    "br",
  ];
  var MIN_SELECTABLE_EXTENT_PX = 4;

  function collectSelectableElementInfos(): unknown[] {
    var nodes = Array.prototype.slice.call(
      document.body ? document.body.querySelectorAll("*") : [],
    ) as Element[];
    var infos: unknown[] = [];
    nodes.forEach(function (node) {
      if (
        NON_SELECTABLE_TAGS.indexOf(node.tagName.toLowerCase()) !== -1 ||
        isEditorInjectedElement(node) ||
        isTemplateCloneElement(node) ||
        (node as SVGElement).ownerSVGElement
      ) {
        return;
      }
      var rect = node.getBoundingClientRect();
      if (
        rect.width < MIN_SELECTABLE_EXTENT_PX ||
        rect.height < MIN_SELECTABLE_EXTENT_PX
      ) {
        var cs = window.getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden") return;
      }
      var padX =
        rect.width < MIN_SELECTABLE_EXTENT_PX
          ? MIN_SELECTABLE_EXTENT_PX / 2
          : 0;
      var padY =
        rect.height < MIN_SELECTABLE_EXTENT_PX
          ? MIN_SELECTABLE_EXTENT_PX / 2
          : 0;
      var nodeId = getNodeId(node);
      infos.push({
        tagName: node.tagName.toLowerCase(),
        sourceId: nodeId || undefined,
        selector: nodeId
          ? undefined
          : buildSourceEquivalentSelector(node) || undefined,
        layerName: layerNameForElement(node) || undefined,
        boundingRect: {
          x: rect.left - padX,
          y: rect.top - padY,
          width: rect.width + padX * 2,
          height: rect.height + padY * 2,
        },
      });
    });
    return infos;
  }

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    if (!e.data) return;
    if (e.data.type === "agent-native:review-anchor-at-point") {
      var reviewPointCorrelationId: string = e.data.correlationId;
      var reviewPointX: number = Number(e.data.x);
      var reviewPointY: number = Number(e.data.y);
      if (!reviewPointCorrelationId) return;
      var reviewPointElement = reviewAnchorElementAtPoint(
        reviewPointX,
        reviewPointY,
      );
      var reviewPointNodeId = reviewPointElement
        ? getNodeId(reviewPointElement)
        : "";
      var reviewPointSelector =
        reviewPointElement && !reviewPointNodeId
          ? buildSourceEquivalentSelector(reviewPointElement)
          : "";
      try {
        (window.parent as Window).postMessage(
          {
            type: "agent-native:review-anchor-at-point-result",
            correlationId: reviewPointCorrelationId,
            nodeId: reviewPointNodeId || undefined,
            targetSelector: reviewPointSelector || undefined,
            layerName: layerNameForElement(reviewPointElement) || undefined,
            tagName: reviewPointElement?.tagName?.toLowerCase() || undefined,
          },
          "*",
        );
      } catch (_err) {}
      return;
    }
    if (e.data.type === "agent-native:review-node-rects") {
      var reviewRectsCorrelationId: string = e.data.correlationId;
      var rawReviewNodeIds: unknown = e.data.nodeIds;
      if (!reviewRectsCorrelationId || !Array.isArray(rawReviewNodeIds)) return;
      var reviewNodeIds = rawReviewNodeIds
        .filter(function (value): value is string {
          return typeof value === "string" && value.length > 0;
        })
        .slice(0, 500);
      var reviewElements = reviewNodeElements(reviewNodeIds);
      var reviewRects: Record<
        string,
        { left: number; top: number; width: number; height: number }
      > = {};
      for (
        var reviewIndex = 0;
        reviewIndex < reviewNodeIds.length;
        reviewIndex += 1
      ) {
        var reviewNodeId = reviewNodeIds[reviewIndex];
        var reviewElement = reviewElements[reviewNodeId];
        if (!reviewElement) continue;
        var reviewRect = reviewElement.getBoundingClientRect();
        reviewRects[reviewNodeId] = {
          left: reviewRect.left,
          top: reviewRect.top,
          width: reviewRect.width,
          height: reviewRect.height,
        };
      }
      try {
        (window.parent as Window).postMessage(
          {
            type: "agent-native:review-node-rects-result",
            correlationId: reviewRectsCorrelationId,
            rects: reviewRects,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          },
          "*",
        );
      } catch (_err) {}
      return;
    }
    if (e.data.type === "agent-native:review-focus") {
      var reviewFocusCorrelationId: string = e.data.correlationId;
      var reviewFocusNodeId: string = String(e.data.nodeId || "");
      if (!reviewFocusCorrelationId || !reviewFocusNodeId) return;
      var reviewFocusElement = reviewNodeElements([reviewFocusNodeId])[
        reviewFocusNodeId
      ] as HTMLElement | undefined;
      if (reviewFocusElement) {
        reviewFocusElement.scrollIntoView({
          block: "center",
          inline: "center",
        });
        var previousReviewBoxShadow = reviewFocusElement.style.boxShadow;
        reviewFocusElement.style.boxShadow =
          "0 0 0 2px var(--design-editor-accent-color, #2563eb)";
        window.setTimeout(function () {
          reviewFocusElement!.style.boxShadow = previousReviewBoxShadow;
        }, 700);
      }
      try {
        (window.parent as Window).postMessage(
          {
            type: "agent-native:review-focus-result",
            correlationId: reviewFocusCorrelationId,
            focused: Boolean(reviewFocusElement),
          },
          "*",
        );
      } catch (_err) {}
      return;
    }
    if (e.data.type === "agent-native:hit-test-preview-clear") {
      hideInsertionGuide();
      return;
    }
    if (e.data.type === "agent-native:collect-selectable-rects") {
      if (
        (window as unknown as Record<string, boolean>).__agentNativeEditorChrome
      ) {
        return;
      }
      (window.parent as Window).postMessage(
        {
          type: "agent-native:selectable-rects-result",
          correlationId:
            typeof e.data.correlationId === "string"
              ? e.data.correlationId
              : "",
          payload: collectSelectableElementInfos(),
        },
        "*",
      );
      return;
    }
    if (e.data.type !== "agent-native:hit-test") return;
    var correlationId: string = e.data.correlationId;
    var x: number = Number(e.data.x);
    var y: number = Number(e.data.y);
    if (!correlationId) return;
    var sourceElementSize = e.data.sourceElementSize;
    var validSourceElementSize =
      sourceElementSize &&
      Number.isFinite(sourceElementSize.width) &&
      Number.isFinite(sourceElementSize.height) &&
      sourceElementSize.width > 0 &&
      sourceElementSize.height > 0
        ? {
            width: sourceElementSize.width,
            height: sourceElementSize.height,
          }
        : undefined;
    var result = ignoreAutoLayoutHitTarget(
      applyHitTestSizeGuard(
        resolveHitTarget(
          x,
          y,
          e.data.modifiers?.forceNestedAutoLayout === true,
        ),
        x,
        y,
        validSourceElementSize,
        e.data.modifiers,
      ),
      e.data.modifiers?.ignoreAutoLayout === true,
    );
    if (e.data.preview) showInsertionGuideFor(result);
    var anchorNodeId: string = result ? getNodeId(result.anchor) : "";
    var pendingNodeId: string =
      result && !anchorNodeId ? getOrMintPendingNodeId(result.anchor) : "";
    var targetAnchorProvenance = getAnchorNodeProvenance(
      anchorNodeId,
      result ? result.anchor : null,
    );
    var needsSourceSelector =
      Boolean(pendingNodeId) ||
      Boolean(
        anchorNodeId &&
        targetAnchorProvenance &&
        targetAnchorProvenance.versionHash &&
        !targetAnchorProvenance.uniqueNodeId,
      );
    var anchorSelector: string = needsSourceSelector
      ? buildSourceEquivalentSelector(result ? result.anchor : null)
      : "";
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
          targetAnchorProvenance: targetAnchorProvenance,
          pendingNodeId: pendingNodeId || undefined,
          anchorSelector: anchorSelector || undefined,
          placement: placement,
          axis: axis,
          dropMode: dropMode,
          layerName: result
            ? layerNameForElement(result.anchor) || undefined
            : undefined,
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
