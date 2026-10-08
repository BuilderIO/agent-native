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
 *     placement: 'before'|'after'|'inside',
 *     guidePlacement: 'before'|'after'|'inside', axis: 'x'|'y',
 *     anchorRect: { left: number, top: number, width: number, height: number },
 *     gridPlacement?: { column: number, columnEnd: number, row: number, rowEnd: number },
 *     guideRect?: { left: number, top: number, width: number, height: number } }
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
  type HitTestRect = {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  type HitTestTarget = {
    anchor: Element;
    placement: string;
    guidePlacement?: string;
    axis: string;
    dropMode: string;
    gridPlacement?: {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    };
    guideRect?: HitTestRect;
  };

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
    var primitiveKind = (
      el.getAttribute("data-an-primitive") ||
      el.getAttribute("data-agent-native-primitive") ||
      ""
    ).toLowerCase();
    if (primitiveKind && !BRIDGE_ADOPTING_PRIMITIVES[primitiveKind]) {
      return false;
    }
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

  function dropContentSize(el: Element): { width: number; height: number } {
    var html = el as HTMLElement;
    var style = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var scaleX = html.offsetWidth ? rect.width / html.offsetWidth : 1;
    var scaleY = html.offsetHeight ? rect.height / html.offsetHeight : 1;
    var paddingLeft = parseFloat(style.paddingLeft) || 0;
    var paddingRight = parseFloat(style.paddingRight) || 0;
    var paddingTop = parseFloat(style.paddingTop) || 0;
    var paddingBottom = parseFloat(style.paddingBottom) || 0;
    return {
      width: (html.clientWidth - paddingLeft - paddingRight) * scaleX,
      height: (html.clientHeight - paddingTop - paddingBottom) * scaleY,
    };
  }

  function dropFitsContainer(
    container: Element,
    sourceWidth: number,
    sourceHeight: number,
  ): boolean {
    var size = dropContentSize(container);
    return size.width >= sourceWidth && size.height >= sourceHeight;
  }

  function dropFitsAutoLayoutFallback(
    container: Element,
    sourceWidth: number,
    sourceHeight: number,
  ): boolean {
    // Direct targets fit both axes; only ancestor fallback may use flex's main
    // axis.
    if (dropFitsContainer(container, sourceWidth, sourceHeight)) return true;
    var style = window.getComputedStyle(container);
    var singleLineFlex =
      (style.display === "flex" || style.display === "inline-flex") &&
      style.flexWrap !== "wrap" &&
      style.flexWrap !== "wrap-reverse";
    if (!singleLineFlex) return false;
    var size = dropContentSize(container);
    var mainAxis = flexMainAxis(style);
    if (mainAxis === "x") {
      return size.width >= sourceWidth;
    }
    if (mainAxis === "y") {
      return size.height >= sourceHeight;
    }
    return false;
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
      if (isOverlayElement(target) || isTransientCloneElement(target)) continue;
      if (isLayerInteractionBlocked(target)) return null;
      return target;
    }
    return null;
  }

  function parentFlowAxis(parent: Element): string {
    var cs = window.getComputedStyle(parent);
    if (cs.display === "flex" || cs.display === "inline-flex") {
      var mainAxis = flexMainAxis(cs);
      var wraps = cs.flexWrap === "wrap" || cs.flexWrap === "wrap-reverse";
      if (!mainAxis) return "y";
      if (!wraps) return mainAxis;
      return mainAxis === "x" ? "y" : "x";
    }
    if (cs.display === "grid" || cs.display === "inline-grid") {
      var cols = hitTestGridTracks(cs.gridTemplateColumns || "").length;
      return cols > 1 ? "x" : "y";
    }
    return "y";
  }

  function flexMainAxis(styles: CSSStyleDeclaration): string | null {
    var writingMode = styles.writingMode || "horizontal-tb";
    if (
      writingMode !== "horizontal-tb" &&
      writingMode !== "vertical-rl" &&
      writingMode !== "vertical-lr"
    ) {
      return null;
    }
    if (
      styles.flexDirection === "row" ||
      styles.flexDirection === "row-reverse"
    ) {
      return writingMode === "horizontal-tb" ? "x" : "y";
    }
    if (
      styles.flexDirection === "column" ||
      styles.flexDirection === "column-reverse"
    ) {
      return writingMode === "horizontal-tb" ? "y" : "x";
    }
    return null;
  }

  function isFlexContainer(el: Element) {
    var display = window.getComputedStyle(el).display;
    return display === "flex" || display === "inline-flex";
  }

  function hasKnownFlexMainAxis(el: Element) {
    return (
      !isFlexContainer(el) || flexMainAxis(window.getComputedStyle(el)) !== null
    );
  }

  function wrappedFlexMainAxis(parent: Element): string | null {
    var cs = window.getComputedStyle(parent);
    if (cs.display !== "flex" && cs.display !== "inline-flex") {
      return null;
    }
    if (cs.flexWrap !== "wrap" && cs.flexWrap !== "wrap-reverse") {
      return null;
    }
    return flexMainAxis(cs);
  }

  function hitTestGridTracks(template: string): number[] {
    if (!template || template === "none") return [];
    var tracks: number[] = [];
    var tokens = template.trim().match(/\[[^\]]*\]|[^\s]+/g) || [];
    for (var index = 0; index < tokens.length; index += 1) {
      var token = tokens[index];
      if (token.charAt(0) === "[" && token.charAt(token.length - 1) === "]") {
        continue;
      }
      if (!/^-?(?:\d+\.?\d*|\.\d+)px$/.test(token)) return [];
      var size = parseFloat(token);
      if (!Number.isFinite(size) || size < 0) return [];
      tracks.push(size);
    }
    return tracks;
  }

  function hitTestGridGap(value: string, contentSize: number): number | null {
    if (!value || value === "normal") return 0;
    var match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(px|%)$/);
    if (!match) return null;
    var amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return match[2] === "%" ? (amount * contentSize) / 100 : amount;
  }

  function hitTestGridItemRange(
    styles: CSSStyleDeclaration,
    axis: "column" | "row",
    trackCount: number,
  ): { start: number; end: number } | null {
    var startValue =
      axis === "column" ? styles.gridColumnStart : styles.gridRowStart;
    var endValue = axis === "column" ? styles.gridColumnEnd : styles.gridRowEnd;
    var startSpan = startValue.trim().match(/^span\s+(\d+)$/);
    var endSpan = endValue.trim().match(/^span\s+(\d+)$/);
    var startValueMatch = startValue.trim().match(/^-?\d+$/);
    var endValueMatch = endValue.trim().match(/^-?\d+$/);
    if (
      (startValue.trim() !== "auto" && !startSpan && !startValueMatch) ||
      (endValue.trim() !== "auto" && !endSpan && !endValueMatch)
    ) {
      return null;
    }
    var startLine = startValueMatch ? Number(startValueMatch[0]) : null;
    var endLine = endValueMatch ? Number(endValueMatch[0]) : null;
    if (startLine !== null && startLine < 0)
      startLine = trackCount + 2 + startLine;
    if (endLine !== null && endLine < 0) endLine = trackCount + 2 + endLine;
    var span = Number((endSpan || startSpan)?.[1] || 0);
    if (!span) {
      span =
        startLine !== null && endLine !== null
          ? Math.abs(endLine - startLine)
          : 1;
    }
    if (!Number.isSafeInteger(span) || span < 1) return null;
    var start =
      startLine !== null ? startLine : endLine !== null ? endLine - span : null;
    if (start === null) return null;
    if (startLine !== null && endLine !== null) {
      start = Math.min(startLine, endLine);
      span = Math.abs(endLine - startLine);
    }
    if (!Number.isSafeInteger(start) || start < 1 || span < 1) return null;
    return { start: start, end: start + span };
  }

  function hitTestGridDistribution(
    tracks: number[],
    contentSize: number,
    gap: number,
    distribution: string,
    reverse: boolean,
  ): { offset: number; gap: number } {
    var used = gap * Math.max(0, tracks.length - 1);
    for (var index = 0; index < tracks.length; index += 1) {
      used += tracks[index];
    }
    var leftover = contentSize - used;
    var alignment = (distribution || "normal").trim().split(/\s+/);
    var mode = alignment.pop() || "normal";
    if (leftover < -0.01) {
      if (alignment.indexOf("safe") !== -1) {
        return { offset: 0, gap: gap };
      }
      if (mode === "center") return { offset: leftover / 2, gap: gap };
      if (mode === "end" || mode === "flex-end") {
        return { offset: leftover, gap: gap };
      }
      if (mode === "right") {
        return { offset: reverse ? 0 : leftover, gap: gap };
      }
      if (mode === "left") {
        return { offset: reverse ? leftover : 0, gap: gap };
      }
      return { offset: 0, gap: gap };
    }
    if (!(leftover > 0.01)) return { offset: 0, gap: gap };
    if (mode === "center") return { offset: leftover / 2, gap: gap };
    if (mode === "end" || mode === "flex-end") {
      return { offset: leftover, gap: gap };
    }
    if (mode === "right") {
      return { offset: reverse ? 0 : leftover, gap: gap };
    }
    if (mode === "left") {
      return { offset: reverse ? leftover : 0, gap: gap };
    }
    if (mode === "space-between" && tracks.length > 1) {
      return { offset: 0, gap: gap + leftover / (tracks.length - 1) };
    }
    if (mode === "space-around" && tracks.length > 0) {
      var around = leftover / tracks.length;
      return { offset: around / 2, gap: gap + around };
    }
    if (mode === "space-evenly" && tracks.length > 0) {
      var evenly = leftover / (tracks.length + 1);
      return { offset: evenly, gap: gap + evenly };
    }
    return { offset: 0, gap: gap };
  }

  function hasTransformedGridAncestor(container: Element): boolean {
    var current: Element | null = container;
    while (current) {
      var styles = window.getComputedStyle(current);
      if (
        styles.transform !== "none" ||
        styles.translate !== "none" ||
        styles.rotate !== "none" ||
        styles.scale !== "none" ||
        (styles.zoom !== "1" && styles.zoom !== "normal")
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function gridEmptyCellInsertionTarget(
    container: Element,
    clientX: number,
    clientY: number,
    sourceGridSpan?: { columns: number; rows: number },
  ): HitTestTarget | null {
    var styles = window.getComputedStyle(container);
    if (
      (styles.display !== "grid" && styles.display !== "inline-grid") ||
      styles.writingMode !== "horizontal-tb"
    ) {
      return null;
    }
    if (hasTransformedGridAncestor(container)) return null;
    var scrollableContainer = container as HTMLElement;
    if (
      scrollableContainer.scrollLeft !== 0 ||
      scrollableContainer.scrollTop !== 0
    ) {
      return null;
    }
    var columns = hitTestGridTracks(styles.gridTemplateColumns);
    var rows = hitTestGridTracks(styles.gridTemplateRows);
    if (!columns.length || !rows.length) return null;
    var columnSpan = sourceGridSpan?.columns ?? 1;
    var rowSpan = sourceGridSpan?.rows ?? 1;
    if (
      !Number.isSafeInteger(columnSpan) ||
      !Number.isSafeInteger(rowSpan) ||
      columnSpan < 1 ||
      rowSpan < 1
    ) {
      return null;
    }
    var rect = container.getBoundingClientRect();
    var px = function (value: string) {
      var parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    var contentLeft =
      rect.left + px(styles.borderLeftWidth) + px(styles.paddingLeft);
    var contentTop =
      rect.top + px(styles.borderTopWidth) + px(styles.paddingTop);
    var contentWidth =
      rect.width -
      px(styles.borderLeftWidth) -
      px(styles.borderRightWidth) -
      px(styles.paddingLeft) -
      px(styles.paddingRight);
    var contentHeight =
      rect.height -
      px(styles.borderTopWidth) -
      px(styles.borderBottomWidth) -
      px(styles.paddingTop) -
      px(styles.paddingBottom);
    var reservedScrollbarWidth =
      scrollableContainer.offsetWidth -
      scrollableContainer.clientWidth -
      px(styles.borderLeftWidth) -
      px(styles.borderRightWidth);
    var reservedScrollbarHeight =
      scrollableContainer.offsetHeight -
      scrollableContainer.clientHeight -
      px(styles.borderTopWidth) -
      px(styles.borderBottomWidth);
    if (reservedScrollbarWidth > 1 || reservedScrollbarHeight > 1) {
      return null;
    }
    var direction = styles.direction === "rtl";
    var columnGap = hitTestGridGap(styles.columnGap, contentWidth);
    var rowGap = hitTestGridGap(styles.rowGap, contentHeight);
    if (columnGap === null || rowGap === null) return null;
    var columnFlow = hitTestGridDistribution(
      columns,
      contentWidth,
      columnGap,
      styles.justifyContent,
      direction,
    );
    var rowFlow = hitTestGridDistribution(
      rows,
      contentHeight,
      rowGap,
      styles.alignContent,
      false,
    );
    var columnBounds: Array<{ start: number; end: number }> = [];
    var columnStart = direction
      ? contentLeft + contentWidth - columnFlow.offset
      : contentLeft + columnFlow.offset;
    for (var columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      if (direction) {
        columnBounds.push({
          start: columnStart - columns[columnIndex],
          end: columnStart,
        });
        columnStart -= columns[columnIndex] + columnFlow.gap;
      } else {
        columnBounds.push({
          start: columnStart,
          end: columnStart + columns[columnIndex],
        });
        columnStart += columns[columnIndex] + columnFlow.gap;
      }
    }
    var rowBounds: Array<{ start: number; end: number }> = [];
    var rowStart = contentTop + rowFlow.offset;
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      rowBounds.push({ start: rowStart, end: rowStart + rows[rowIndex] });
      rowStart += rows[rowIndex] + rowFlow.gap;
    }
    var column = columnBounds.findIndex(
      (bound) => clientX >= bound.start && clientX <= bound.end,
    );
    var row = rowBounds.findIndex(
      (bound) => clientY >= bound.start && clientY <= bound.end,
    );
    if (
      column < 0 ||
      row < 0 ||
      column + columnSpan > columnBounds.length ||
      row + rowSpan > rowBounds.length
    ) {
      return null;
    }
    var firstColumn = columnBounds[column];
    var lastColumn = columnBounds[column + columnSpan - 1];
    var firstRow = rowBounds[row];
    var lastRow = rowBounds[row + rowSpan - 1];
    var cell = {
      left: Math.min(firstColumn.start, lastColumn.start),
      top: Math.min(firstRow.start, lastRow.start),
      width:
        Math.max(firstColumn.end, lastColumn.end) -
        Math.min(firstColumn.start, lastColumn.start),
      height:
        Math.max(firstRow.end, lastRow.end) -
        Math.min(firstRow.start, lastRow.start),
    };
    for (var pseudo of ["::before", "::after"]) {
      var pseudoStyles = window.getComputedStyle(container, pseudo);
      if (
        pseudoStyles.content !== "none" &&
        pseudoStyles.content !== "normal" &&
        pseudoStyles.display !== "none" &&
        pseudoStyles.position !== "absolute" &&
        pseudoStyles.position !== "fixed"
      ) {
        return null;
      }
    }
    var children = Array.prototype.slice.call(container.children) as Element[];
    var childNodes = Array.prototype.slice.call(container.childNodes) as Node[];
    for (var nodeIndex = 0; nodeIndex < childNodes.length; nodeIndex += 1) {
      var node = childNodes[nodeIndex];
      if (node.nodeType === 3 && node.textContent?.trim()) return null;
      if (
        node.nodeType === 1 &&
        window.getComputedStyle(node as Element).display === "contents"
      ) {
        return null;
      }
    }
    for (var childIndex = 0; childIndex < children.length; childIndex += 1) {
      var child = children[childIndex];
      if (isOverlayElement(child) || isTransientCloneElement(child)) continue;
      var childStyles = window.getComputedStyle(child);
      if (
        childStyles.display === "none" ||
        childStyles.position === "absolute" ||
        childStyles.position === "fixed"
      ) {
        continue;
      }
      var childColumnRange = hitTestGridItemRange(
        childStyles,
        "column",
        columns.length,
      );
      var childRowRange = hitTestGridItemRange(childStyles, "row", rows.length);
      if (!childColumnRange || !childRowRange) {
        // Auto-placement can occupy a track even when paint bounds are elsewhere.
        return null;
      }
      if (
        column < childColumnRange.end - 1 &&
        column + columnSpan > childColumnRange.start - 1 && // i18n-ignore non-user-facing grid occupancy math
        row < childRowRange.end - 1 &&
        row + rowSpan > childRowRange.start - 1
      ) {
        return null;
      }
    }
    var autoFlow = (styles.gridAutoFlow || "row").split(/\s+/);
    return {
      anchor: container,
      placement: "inside",
      axis: autoFlow[0] === "column" ? "y" : "x",
      dropMode: "flow-insert",
      gridPlacement: {
        column: column + 1,
        columnEnd: column + columnSpan + 1,
        row: row + 1,
        rowEnd: row + rowSpan + 1,
      },
      guideRect: cell,
    };
  }

  function isReverseFlexFlow(styles: CSSStyleDeclaration, axis: string) {
    if (styles.display !== "flex" && styles.display !== "inline-flex") {
      return false;
    }
    var mainAxis = flexMainAxis(styles);
    if (!mainAxis || axis !== mainAxis) return false;
    if (
      styles.flexDirection === "row" ||
      styles.flexDirection === "row-reverse"
    ) {
      return (
        (styles.flexDirection === "row-reverse") !==
        (styles.direction === "rtl")
      );
    }
    return (
      (styles.flexDirection === "column-reverse") !==
      ((styles.writingMode || "horizontal-tb") === "vertical-rl")
    );
  }

  function flowPlacementsForSide(
    parent: Element,
    axis: string,
    guidePlacement: string,
  ) {
    var reverseFlow = isReverseFlexFlow(window.getComputedStyle(parent), axis);
    return {
      placement: reverseFlow
        ? guidePlacement === "before"
          ? "after"
          : "before"
        : guidePlacement,
      guidePlacement: guidePlacement,
    };
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
      if (isOverlayElement(cursor) || isTransientCloneElement(cursor)) continue;
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
      if (
        isOverlayElement(candidate) ||
        isTransientCloneElement(candidate) ||
        isLayerInteractionBlocked(candidate)
      ) {
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
    if (!anchor || isTransientCloneElement(anchor)) return undefined;
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

  function isTransientCloneElement(el: Element | null): boolean {
    var node: Element | null = el;
    while (node && node !== document.documentElement) {
      var parent = node.parentElement;
      if (!parent) return false;
      if (
        node.getAttribute("data-agent-native-transient-drag-clone") === "true"
      ) {
        return true;
      }
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
        !isTransientCloneElement(child)
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
    if (isTransientCloneElement(el)) return "";
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

  function isMultiTrackGrid(container: Element) {
    var styles = window.getComputedStyle(container);
    return (
      (styles.display === "grid" || styles.display === "inline-grid") &&
      (styles.gridTemplateColumns || "").split(" ").filter(Boolean).length > 1
    );
  }

  function nearestChildInsertionTarget(
    container: Element,
    clientX: number,
    clientY: number,
    sourceGridSpan?: { columns: number; rows: number },
  ) {
    if (!hasKnownFlexMainAxis(container)) return null;
    var gridTarget = gridEmptyCellInsertionTarget(
      container,
      clientX,
      clientY,
      sourceGridSpan,
    );
    if (gridTarget) return gridTarget;
    var children = draggableElementChildren(container);
    if (!children.length) return null;
    var wrappedFlexAxis = wrappedFlexMainAxis(container);
    var axis = wrappedFlexAxis || parentFlowAxis(container);
    var containerStyles = window.getComputedStyle(container);
    var columns = hitTestGridTracks(containerStyles.gridTemplateColumns || "");
    var multiTrackGrid =
      (containerStyles.display === "grid" ||
        containerStyles.display === "inline-grid") &&
      columns.length > 1;
    var reverseFlow =
      !multiTrackGrid && isReverseFlexFlow(containerStyles, axis);
    var best: Element | null = null;
    var bestDistance = Infinity;
    var placement = "after";
    var guidePlacement = "after";
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
        guidePlacement = placementPointer < center ? "before" : "after";
        var before = guidePlacement === "before";
        if (reverseFlow) before = !before;
        placement = before ? "before" : "after";
      }
    }
    if (!best) return null;
    return {
      anchor: best,
      placement: placement,
      guidePlacement: guidePlacement,
      axis: axis,
      dropMode: "flow-insert",
    };
  }

  function screenRootFlowInsertionTargetForPoint(
    clientX: number,
    clientY: number,
    sourceGridSpan?: { columns: number; rows: number },
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
    return nearestChildInsertionTarget(
      document.body,
      clientX,
      clientY,
      sourceGridSpan,
    );
  }

  function resolveHitTarget(
    clientX: number,
    clientY: number,
    forceNestedAutoLayout = false,
    sourceGridSpan?: { columns: number; rows: number },
  ): HitTestTarget | null {
    var hit = elementFromEditorPoint(clientX, clientY);
    if (!hit || hit === document.documentElement) return null;

    var cursor: Element | null = hit;
    if (forceNestedAutoLayout) {
      while (cursor && cursor !== document.body) {
        if (isOverlayElement(cursor) || isLayerInteractionBlocked(cursor)) {
          return null;
        }
        if (isAutoLayoutElement(cursor) && isContainerDropTarget(cursor)) {
          if (!hasKnownFlexMainAxis(cursor)) return null;
          return (
            nearestChildInsertionTarget(
              cursor,
              clientX,
              clientY,
              sourceGridSpan,
            ) || {
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
        if (!hasKnownFlexMainAxis(parent)) return null;
        var emptyGridCell = gridEmptyCellInsertionTarget(
          parent,
          clientX,
          clientY,
          sourceGridSpan,
        );
        if (emptyGridCell) return emptyGridCell;
        if (isTransientCloneElement(cursor)) {
          var cloneFallback = nearestChildInsertionTarget(
            parent,
            clientX,
            clientY,
            sourceGridSpan,
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
          return nearestChildInsertionTarget(
            parent,
            clientX,
            clientY,
            sourceGridSpan,
          );
        }
        var parentAxis = parentFlowAxis(parent);
        var childRect = cursor.getBoundingClientRect();
        var childCenter =
          parentAxis === "x"
            ? childRect.left + childRect.width / 2
            : childRect.top + childRect.height / 2;
        var childPointer = parentAxis === "x" ? clientX : clientY;
        var guidePlacement = childPointer < childCenter ? "before" : "after";
        var flowPlacements = flowPlacementsForSide(
          parent,
          parentAxis,
          guidePlacement,
        );
        return {
          anchor: cursor,
          placement: flowPlacements.placement,
          guidePlacement: flowPlacements.guidePlacement,
          axis: parentAxis,
          dropMode: "flow-insert",
        };
      }
      if (isAutoLayoutElement(cursor) && isContainerDropTarget(cursor)) {
        if (!hasKnownFlexMainAxis(cursor)) return null;
        var containerRect = cursor.getBoundingClientRect();
        var edgeAxis = parent ? parentFlowAxis(parent) : parentFlowAxis(cursor);
        var edgePlacement = edgePlacementForRect(
          containerRect,
          edgeAxis,
          clientX,
          clientY,
        );
        if (edgePlacement && parent && isAutoLayoutElement(parent)) {
          if (!hasKnownFlexMainAxis(parent)) return null;
          if (wrappedFlexMainAxis(parent)) return null;
          var edgeFlowPlacements = flowPlacementsForSide(
            parent,
            edgeAxis,
            edgePlacement,
          );
          return {
            anchor: cursor,
            placement: edgeFlowPlacements.placement,
            guidePlacement: edgeFlowPlacements.guidePlacement,
            axis: edgeAxis,
            dropMode: "flow-insert",
          };
        }
        var betweenChildren = nearestChildInsertionTarget(
          cursor,
          clientX,
          clientY,
          sourceGridSpan,
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
      sourceGridSpan,
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
        if (!hasKnownFlexMainAxis(blockCursor)) return null;
        var emptyContainerGridCell = gridEmptyCellInsertionTarget(
          blockCursor,
          clientX,
          clientY,
          sourceGridSpan,
        );
        if (emptyContainerGridCell) return emptyContainerGridCell;
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
    target: HitTestTarget | null,
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
    target: HitTestTarget | null,
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
      (target.dropMode !== "flow-insert" &&
        target.dropMode !== "absolute-container") ||
      !sourceElementSize ||
      modifiers?.metaKey ||
      modifiers?.ctrlKey ||
      modifiers?.ignoreAutoLayout
    ) {
      return target;
    }
    var container =
      target.placement === "inside"
        ? target.anchor
        : target.anchor.parentElement;
    if (
      !container ||
      container === document.body ||
      container === document.documentElement ||
      !isContainerDropTarget(container)
    ) {
      return target;
    }
    if (
      dropFitsContainer(
        container,
        sourceElementSize.width,
        sourceElementSize.height,
      )
    ) {
      return target;
    }
    // A screen's body is the board boundary, not another fitting ancestor.
    var parent = container.parentElement;
    while (
      parent &&
      parent !== document.documentElement &&
      parent !== document.body
    ) {
      var parentIsFlow = isAutoLayoutElement(parent);
      var parentIsAbsolute =
        isAbsolutePrimitiveContainer(parent) ||
        isFreeformRelativeContainer(parent);
      if (parentIsFlow && !hasKnownFlexMainAxis(parent)) return null;
      if (
        isContainerDropTarget(parent) &&
        parent !== container &&
        (parentIsFlow || parentIsAbsolute)
      ) {
        var parentFits = parentIsFlow
          ? dropFitsAutoLayoutFallback(
              parent,
              sourceElementSize.width,
              sourceElementSize.height,
            )
          : dropFitsContainer(
              parent,
              sourceElementSize.width,
              sourceElementSize.height,
            );
        if (parentFits) {
          if (parentIsFlow) {
            if (isMultiTrackGrid(parent)) {
              var gridAwareInsertionTarget = (
                window as Window & {
                  __agentNativeDesignNearestChildInsertionTarget?: (
                    container: Element,
                    clientX: number,
                    clientY: number,
                  ) => {
                    anchor: Element;
                    placement: string;
                    guidePlacement?: string;
                    axis: string;
                    dropMode: string;
                    gridPlacement?: {
                      column: number;
                      columnEnd: number;
                      row: number;
                      rowEnd: number;
                    };
                    guideRect?: HitTestRect;
                  } | null;
                }
              ).__agentNativeDesignNearestChildInsertionTarget;
              var gridTarget = gridAwareInsertionTarget?.(
                parent,
                clientX,
                clientY,
              );
              if (gridTarget) return gridTarget;
              parent = parent.parentElement;
              continue;
            }
            return (
              nearestChildInsertionTarget(parent, clientX, clientY) || {
                anchor: parent,
                placement: "inside",
                axis: parentFlowAxis(parent),
                dropMode: "flow-insert",
              }
            );
          }
          return {
            anchor: parent,
            placement: "inside",
            axis: "y",
            dropMode: "absolute-container",
          };
        }
      }
      parent = parent.parentElement;
    }
    var containerPrimitive = (
      container.getAttribute("data-an-primitive") ||
      container.getAttribute("data-agent-native-primitive") ||
      ""
    ).toLowerCase();
    if (
      isAutoLayoutElement(container) &&
      container.parentElement === document.body &&
      containerPrimitive !== "frame"
    ) {
      return nearestChildInsertionTarget(document.body, clientX, clientY);
    }
    return null;
  }

  function showInsertionGuideFor(target: HitTestTarget | null): void {
    if (!target || !target.anchor) {
      hideInsertionGuide();
      return;
    }
    var guide = ensureInsertionGuide();
    var anchorRect = target.anchor.getBoundingClientRect();
    var guidePlacement = target.guidePlacement || target.placement;
    guide.style.display = "block";
    guide.style.background = "var(--design-editor-accent-color)";
    guide.style.border = "0";
    guide.style.borderRadius = "999px";
    guide.style.boxShadow = "0 0 0 1px var(--design-editor-accent-color)";
    if (guidePlacement === "inside") {
      var rect = target.guideRect || anchorRect;
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
      var x = guidePlacement === "before" ? anchorRect.left : anchorRect.right;
      guide.style.left = x + "px";
      guide.style.top = anchorRect.top + "px";
      guide.style.width = "2px";
      guide.style.height = anchorRect.height + "px";
    } else {
      var y = guidePlacement === "before" ? anchorRect.top : anchorRect.bottom;
      guide.style.left = anchorRect.left + "px";
      guide.style.top = y + "px";
      guide.style.width = anchorRect.width + "px";
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
        isTransientCloneElement(node) ||
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
    var rawSourceGridSpan = e.data.sourceGridSpan;
    var sourceGridSpan =
      rawSourceGridSpan &&
      Number.isSafeInteger(rawSourceGridSpan.columns) &&
      Number.isSafeInteger(rawSourceGridSpan.rows) &&
      rawSourceGridSpan.columns > 0 &&
      rawSourceGridSpan.rows > 0
        ? {
            columns: rawSourceGridSpan.columns,
            rows: rawSourceGridSpan.rows,
          }
        : undefined;
    var result = ignoreAutoLayoutHitTarget(
      applyHitTestSizeGuard(
        resolveHitTarget(
          x,
          y,
          e.data.modifiers?.forceNestedAutoLayout === true,
          sourceGridSpan,
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
    var guidePlacement: string = result
      ? result.guidePlacement || result.placement
      : "inside";
    var axis: string = result ? result.axis : "y";
    var dropMode: string = result ? result.dropMode : "flow-insert";
    var anchorRect = result ? result.anchor.getBoundingClientRect() : null;
    try {
      (window.parent as Window).postMessage(
        {
          type: "agent-native:hit-test-result",
          correlationId: correlationId,
          anchorNodeId: anchorNodeId,
          anchorParentNodeId:
            result && result.anchor.parentElement
              ? getNodeId(result.anchor.parentElement) || undefined
              : undefined,
          targetAnchorProvenance: targetAnchorProvenance,
          pendingNodeId: pendingNodeId || undefined,
          anchorSelector: anchorSelector || undefined,
          placement: placement,
          guidePlacement: guidePlacement,
          axis: axis,
          dropMode: dropMode,
          gridPlacement: result ? result.gridPlacement : undefined,
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
          guideRect: result ? result.guideRect : undefined,
        },
        "*",
      );
    } catch (_err) {}
  });
})();
