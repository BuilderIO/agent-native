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
 * `anchorSelector` accompanies `pendingNodeId`: a body-rooted structural
 * `tag:nth-of-type(n) > …` path whose nth indexes are SOURCE-EQUIVALENT —
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
  // keep in sync with editor-chrome.bridge.ts BRIDGE_INTERACTIVE_LEAF_TAGS
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

  // keep in sync with editor-chrome.bridge.ts hasOnlyLeafContent
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
    if (
      primitive !== "rectangle" &&
      primitive !== "rect" &&
      primitive !== "frame"
    )
      return false;
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

  // Detects an Alpine `<template x-for>` runtime clone: Alpine keeps the
  // `<template>` element itself in the live DOM (as a hidden, zero-size
  // marker) and inserts every rendered instance as a DIRECT SIBLING of that
  // template, all still children of the same parent — so `ul > template,
  // li, li, li` is the live shape for `<ul><template x-for>...</template>
  // rendering 3 items</ul>`. The static SOURCE HTML the host resolves moves
  // against only ever contains the single template child, never the N
  // runtime clones, so a hit-test anchor resolved onto a clone — or onto a
  // container whose only children are clones, if the caller doesn't skip
  // them — can never resolve on the host and always comes back
  // `applied:false`. Detected once per hit-test via an ancestor walk (not
  // just the immediate parent) so nested x-for clones (e.g. a subtask `<li>`
  // inside a per-task `<ul>` that is itself x-for'd) are also caught,
  // stopping at the first stable-id ancestor (anything inside a stamped
  // subtree has a real anchor and is fine).
  //
  // keep in sync with editor-chrome.bridge.ts isTemplateCloneElement
  function isTemplateCloneElement(el: Element | null): boolean {
    var node: Element | null = el;
    while (node && node !== document.documentElement) {
      if (getNodeId(node)) return false;
      var parent = node.parentElement;
      if (!parent) return false;
      var siblings = parent.children;
      for (var i = 0; i < siblings.length; i += 1) {
        var sib = siblings[i];
        if (
          sib !== node &&
          sib.tagName &&
          sib.tagName.toLowerCase() === "template" &&
          sib.hasAttribute("x-for")
        ) {
          return true;
        }
      }
      node = parent;
    }
    return false;
  }

  // Anchor-candidate gate (companion to isTemplateCloneElement above): a
  // template clone can never be used as an insertion ANCHOR — it has no
  // counterpart in the static source HTML, so before/after placement
  // against it can never resolve on the host. Filtering clones out of the
  // candidate list here is what fixes drops into a container whose ONLY
  // children are x-for clones: without this, nearestChildInsertionTarget's
  // "nearest child" search would happily pick a clone as the anchor, and
  // the resulting move would silently fail on the host (layerMoveFailed
  // toast) even though the drop gesture itself was completely valid.
  //
  // keep in sync with editor-chrome.bridge.ts draggableElementChildren
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

  // keep in sync with editor-chrome.bridge.ts freshRuntimeNodeId
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

  // Id-on-demand fallback (see the file header comment): when the resolved
  // anchor has no stable id, mint one and stamp it as
  // data-an-pending-node-id — same marker/contract as editor-chrome.bridge.ts's
  // getElementInfo — and return it so the caller can expose it as
  // `pendingNodeId` for a host caller to persist. Deliberately NOT read by
  // getNodeId itself (a pending id is not a stable id until persisted).
  function getOrMintPendingNodeId(el: Element | null): string {
    if (!el || !el.getAttribute || !el.setAttribute) return "";
    // Defensive guard: resolveHitTarget's anchor-candidate gates (see
    // isTemplateCloneElement call sites there) already keep template clones
    // out of `result.anchor`, so this should never fire in practice — but a
    // pending id stamped on a clone would be dead weight: the clone itself
    // has no counterpart in source HTML, so no host persist call could ever
    // write data-agent-native-node-id anywhere durable for it, and Alpine
    // re-renders the clone from scratch on next data change anyway (the
    // stamped attribute would vanish). Fail closed instead of minting.
    if (isTemplateCloneElement(el)) return "";
    var existing = el.getAttribute("data-an-pending-node-id");
    if (existing) return existing;
    var minted = freshRuntimeNodeId("pending");
    try {
      el.setAttribute("data-an-pending-node-id", minted);
    } catch (_err) {}
    return minted;
  }

  // ── Source-equivalent structural selector (anchorSelector) ────────────────
  //
  // The persisted source HTML never contains Alpine-generated runtime nodes
  // (x-for clones, x-if instantiations) or editor-injected overlays, so a
  // naive live-DOM nth-of-type path would mis-resolve on the host whenever
  // any of those precede the anchor among same-tag siblings. These helpers
  // compute nth indexes that count only source-present siblings, so the
  // emitted path resolves to the SAME element in the host's DOMParser/
  // projection view of the stored document.

  // Elements generated by an Alpine template sibling: x-for clones are the
  // values of the template's `_x_lookup` map; the x-if instantiation is the
  // template's `_x_currentIfEl`. Both live as DIRECT SIBLINGS of their
  // template in the live DOM while the source only contains the template.
  //
  // COUPLING WARNING: `_x_lookup` / `_x_currentIfEl` are Alpine.js PRIVATE
  // internals (verified against the Alpine 3.x line served by the prototype
  // CDN pin). If a future Alpine major renames them, the try/catch below
  // swallows the breakage silently and generated clones would be counted as
  // source siblings — buildSourceEquivalentSelector could then resolve a
  // pending node id onto the WRONG source element. When bumping Alpine,
  // re-verify these fields and the clone-vs-source guard tests in
  // bridge.guard.spec.ts.
  function alpineGeneratedChildrenOf(parent: Element): Element[] {
    var generated: Element[] = [];
    var children = parent.children;
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i] as Element & {
        _x_lookup?: Record<string, Element>;
        _x_currentIfEl?: Element;
      };
      if (!child.tagName || child.tagName.toLowerCase() !== "template") {
        continue;
      }
      try {
        if (child._x_currentIfEl) generated.push(child._x_currentIfEl);
        var lookup = child._x_lookup;
        if (lookup) {
          for (var key in lookup) {
            if (Object.prototype.hasOwnProperty.call(lookup, key)) {
              var item = lookup[key];
              if (item) generated.push(item);
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

  // Body-rooted `tag:nth-of-type(n) > …` path with source-equivalent nth
  // indexes, or "" when the anchor (or any ancestor on the way up) is itself
  // an Alpine-generated instance — such elements have no per-instance source
  // node, so no selector can honestly identify them in the stored document.
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

  // Resolves a between-children insertion inside `container` from the
  // pointer position: the nearest visible child (by flow-axis center)
  // becomes the anchor with before/after placement, which renders as the
  // Figma-style insertion LINE between children. Returns null when the
  // container has no eligible children (caller falls back to "inside").
  //
  // This is the finding-6 fix, ported from editor-chrome.bridge.ts's own
  // B5-4 fix (nearestChildInsertionTarget there): hovering the container's
  // own background — its padding, or the gaps BETWEEN children, which is
  // where the pointer naturally sits when dropping "between two cards" —
  // used to resolve to placement "inside" (append at end) instead of
  // inserting at the hovered slot. hit-test.bridge.ts never has a dragged
  // element of its own (it only resolves anchors for a cross-screen/
  // canvas-to-screen drag whose source lives in a different iframe), so
  // this version omits the editor-chrome original's `excludeEls` parameter.
  //
  // keep in sync with editor-chrome.bridge.ts nearestChildInsertionTarget
  function nearestChildInsertionTarget(
    container: Element,
    clientX: number,
    clientY: number,
  ) {
    var children = draggableElementChildren(container);
    if (!children.length) return null;
    var axis = parentFlowAxis(container);
    var best: Element | null = null;
    var bestDistance = Infinity;
    var placement = "after";
    for (var j = 0; j < children.length; j += 1) {
      var rect = children[j].getBoundingClientRect();
      // Skip zero-size children (e.g. Alpine <template> nodes, hidden
      // elements) — they are not visible slots.
      if (rect.width <= 0 || rect.height <= 0) continue;
      var center =
        axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      var pointer = axis === "x" ? clientX : clientY;
      var distance = Math.abs(pointer - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = children[j];
        placement = pointer < center ? "before" : "after";
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
        // Anchor-candidate gate: cursor is a plain flex/grid item being used
        // as a before/after anchor — but if it's a template clone (no
        // counterpart in source HTML), fall back to the nearest non-clone
        // sibling via nearestChildInsertionTarget, else the container itself
        // with "inside" placement. Mirrors editor-chrome.bridge.ts's
        // reorderTargetForPoint / autoLayoutInsertionTargetForPoint clone
        // fallback — this is the primary path a cursor hits when hovering
        // directly over a rendered x-for clone item inside a flex/grid
        // container (e.g. a filter card whose only children are clones).
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
        // finding 6: the pointer is over the container's inner area — its
        // padding or the gap BETWEEN children (a direct child under the
        // pointer would have been the hit instead). Resolve to the nearest
        // child slot so the drop lands between children with the insertion
        // LINE, instead of placement:"inside" append-after-last.
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
    // Id-on-demand fallback (see file header): only mint when there is a
    // real resolved anchor with no stable id — never for a null/no-target
    // result. getOrMintPendingNodeId is idempotent per-element (reuses the
    // existing data-an-pending-node-id if already stamped), so repeated
    // hover-phase hit-tests over the same anchor do not re-mint or spam
    // attribute writes; a HOST caller decides whether/when to persist it.
    var pendingNodeId: string =
      result && !anchorNodeId ? getOrMintPendingNodeId(result.anchor) : "";
    // Only computed alongside a minted pendingNodeId — it exists so a host
    // can persist that pending id into the stored document (see the file
    // header's anchorSelector contract). "" (omitted) when the anchor is an
    // Alpine-generated instance with no source node.
    var anchorSelector: string = pendingNodeId
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
          pendingNodeId: pendingNodeId || undefined,
          anchorSelector: anchorSelector || undefined,
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
