// @ts-nocheck -- extracted from the inline editor bridge; typed cleanup follows after the migration lands.
/**
 * Editor chrome bridge — injected into the live-edit canvas iframe.
 *
 * This file is the TypeScript source for the editor chrome bridge that was
 * previously inlined as a template literal in DesignCanvas.tsx. It compiles
 * to a self-contained IIFE string via bridge/codegen.ts.
 *
 * Runtime placeholders (replaced by DesignCanvas.tsx before injection):
 *   __READ_ONLY__              — boolean literal "true"/"false"
 *   __TEXT_EDITING_ENABLED__   — boolean literal "true"/"false"
 *   __EDITOR_CHROME_SCALE_X__  — number string, e.g. "1.5"
 *   __EDITOR_CHROME_SCALE_Y__  — number string, e.g. "1.5"
 *   __DESIGN_CANVAS_SCREEN_ID__ — string literal for the owning screen/file id
 *   __DESIGN_CANVAS_BOARD_SURFACE__ — boolean literal for top-level board iframe
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 *
 * keep in sync with hit-test.bridge.ts for the shared container/axis/placement
 * helpers (search for "// keep in sync" comments).
 */
declare var __READ_ONLY__: boolean;
declare var __TEXT_EDITING_ENABLED__: boolean;
declare var __EDITOR_CHROME_SCALE_X__: string;
declare var __EDITOR_CHROME_SCALE_Y__: string;
declare var __DESIGN_CANVAS_SCREEN_ID__: string;
declare var __DESIGN_CANVAS_BOARD_SURFACE__: boolean;

(function () {
  // Idempotency guard: replace-document-content / srcdoc rebuilds can end up
  // re-injecting this script into a document where a previous instance's
  // listeners, overlays, and observers are still alive (e.g. a head-only
  // content swap in replaceRuntimeDocument that preserves persistent overlay
  // nodes but re-runs inline <script> tags). Without this, a second instance
  // would double-post every message and double-attach every document-level
  // listener. Bail out entirely if an instance is already installed.
  if ((window as any).__anEditorChromeBridge) return;
  (window as any).__anEditorChromeBridge = true;

  var readOnly = __READ_ONLY__;
  // Raw host-controlled flag, kept separate from the derived
  // `textEditingEnabled` below. The host (DesignCanvas.tsx) live-updates this
  // via the `set-text-editing-enabled` postMessage instead of rebuilding
  // srcdoc, exactly like `set-read-only`. See that handler for why: baking
  // edit/preview-mode toggles into srcdoc would reload every screen iframe on
  // every mode switch (white flash + lost in-iframe/Alpine state).
  var textEditingEnabledFlag = __TEXT_EDITING_ENABLED__;
  var textEditingEnabled = !readOnly && textEditingEnabledFlag;
  var designCanvasScreenId = __DESIGN_CANVAS_SCREEN_ID__ || "";
  var designCanvasBoardSurface = !!__DESIGN_CANVAS_BOARD_SURFACE__;
  var scaleToolEnabled = false;
  // Interaction-state forced preview (phase 2 — see shared/interaction-states.ts's
  // "Forced-preview mechanism" doc comment). Tracks which single node id
  // currently carries the `data-an-state-preview` attribute so a later
  // `state-preview` message for a DIFFERENT node clears the previous one
  // first — only one element can be force-previewing a state at a time,
  // matching the inspector's single-selection InteractionStatePanel.
  var statePreviewNodeId: string | null = null;
  var editorChromeScaleX = Math.max(
    0.05,
    Number(__EDITOR_CHROME_SCALE_X__) || 1,
  );
  var editorChromeScaleY = Math.max(
    0.05,
    Number(__EDITOR_CHROME_SCALE_Y__) || editorChromeScaleX,
  );

  // Ease the constant-size selection chrome to its new size when overview zoom
  // settles (parent posts set-editor-chrome-scale), matching the canvas chrome.
  // Only chrome-scale-driven props animate; the overlay's live position is excluded.
  var chromeTransitionStyle: HTMLStyleElement | null = null;

  function ensureEditorChromeStyle(): void {
    if (chromeTransitionStyle && chromeTransitionStyle.isConnected) return;
    chromeTransitionStyle = document.createElement("style");
    chromeTransitionStyle.setAttribute(
      "data-agent-native-editor-chrome-style",
      "",
    );
    chromeTransitionStyle.textContent =
      '[data-agent-native-edit-overlay="selection"]{transition:border-width 150ms ease-out}' +
      '[data-agent-native-empty-text-editing="true"] [data-agent-native-edit-overlay="selection"]{display:none!important}' +
      "[data-agent-native-text-editing]{outline:none!important;outline-offset:0!important}" +
      "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle]{transition:width 150ms ease-out,height 150ms ease-out,border-width 150ms ease-out,top 150ms ease-out,bottom 150ms ease-out,left 150ms ease-out,right 150ms ease-out}" +
      "[data-agent-native-spacing-line]{position:absolute;display:none;pointer-events:none;border-radius:999px}" +
      "[data-agent-native-spacing-region]{position:absolute;display:none;box-sizing:border-box;pointer-events:auto;background-size:6px 6px}" +
      '[data-agent-native-spacing-region][data-orientation="vertical"]{cursor:ew-resize}' +
      '[data-agent-native-spacing-region][data-orientation="horizontal"]{cursor:ns-resize}';
    (document.head || document.documentElement).appendChild(
      chromeTransitionStyle,
    );
  }

  ensureEditorChromeStyle();

  function runtimeHeadHtmlWithoutEditorChrome(): string {
    if (!document.head) return "";
    var clone = document.head.cloneNode(true) as HTMLElement;
    Array.prototype.slice
      .call(clone.querySelectorAll("[data-agent-native-editor-chrome-style]"))
      .forEach(function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    return clone.innerHTML;
  }

  function chromeScaleX(): number {
    return 1 / Math.max(0.05, editorChromeScaleX);
  }

  function chromeScaleY(): number {
    return 1 / Math.max(0.05, editorChromeScaleY);
  }

  function chromeLineScale(): number {
    return 1 / Math.max(0.05, Math.max(editorChromeScaleX, editorChromeScaleY));
  }

  function syncEditorChromeScaleVars(): void {
    document.documentElement.style.setProperty(
      "--agent-native-editor-chrome-scale-x",
      String(chromeScaleX()),
    );
    document.documentElement.style.setProperty(
      "--agent-native-editor-chrome-scale-y",
      String(chromeScaleY()),
    );
    document.documentElement.style.setProperty(
      "--agent-native-editor-chrome-line-scale",
      String(chromeLineScale()),
    );
  }

  function escapeIdent(value: unknown): string {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function escapeAttribute(value: unknown): string {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function attributeSelector(el: Element | null, name: string): string {
    var value = el && el.getAttribute && el.getAttribute(name);
    return value ? "[" + name + '="' + escapeAttribute(value) + '"]' : "";
  }

  function classSelectorSuffix(el: Element | null, maxCount: number): string {
    if (!el || !el.classList) return "";
    return Array.prototype.slice
      .call(el.classList, 0, maxCount)
      .map(function (token) {
        return "." + escapeIdent(token);
      })
      .join("");
  }

  function selectorPart(el: Element | null): string {
    if (!el || !el.tagName) return "";
    var stableSelector =
      attributeSelector(el, "data-agent-native-node-id") ||
      attributeSelector(el, "data-code-layer-id") ||
      attributeSelector(el, "data-layer-id") ||
      attributeSelector(el, "data-builder-id") ||
      attributeSelector(el, "data-loc");
    if (stableSelector) return el.tagName.toLowerCase() + stableSelector;
    if (el.id) return "#" + escapeIdent(el.id);
    var part =
      el.tagName.toLowerCase() + (stableSelector || classSelectorSuffix(el, 2));
    var parent = el.parentElement;
    if (parent) {
      var sameTag = Array.prototype.filter.call(
        parent.children,
        function (child) {
          return child.tagName === el.tagName;
        },
      );
      if (sameTag.length > 1) {
        part += ":nth-of-type(" + (sameTag.indexOf(el) + 1) + ")";
      }
    }
    return part;
  }

  function selectorPath(el: Element | null, stopEl?: Element | null): string {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      if (node !== stopEl) parts.unshift(selectorPart(node));
      if (node === stopEl) break;
      node = node.parentElement;
    }
    return parts.slice(-5).join(" > ");
  }

  function getSourceId(el: Element | null): string {
    if (!el || !el.getAttribute) return "";
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

  function isDocumentRootElement(el: Element | null): boolean {
    return el === document.body || el === document.documentElement;
  }

  function isBoardRootMarqueeSurface(el: Element | null): boolean {
    if (!designCanvasBoardSurface || !el) return false;
    if (isDocumentRootElement(el)) return true;
    if (el.parentElement !== document.body) return false;
    var sourceId = (getSourceId(el) || "").toLowerCase();
    var layerName = (
      (el.getAttribute && el.getAttribute("data-agent-native-layer-name")) ||
      ""
    ).toLowerCase();
    return (
      sourceId === "body" || layerName === "body" || layerName === "<body>"
    );
  }

  function closestStableSourceElement(el: Element | null): Element | null {
    if (!el || !el.closest) return null;
    var stable = el.closest(
      "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[data-loc]",
    );
    if (!stable || isDocumentRootElement(stable)) return null;
    return stable;
  }

  function hasStableOwnSource(el: Element | null): boolean {
    return !!(el && !isDocumentRootElement(el) && getSourceId(el));
  }

  function selectionTargetForHit(hit: Element | null): Element | null {
    if (!hit || isDocumentRootElement(hit)) return hit;
    if (selectedEl && hit !== selectedEl && selectedEl.contains(hit))
      return hit;
    if (hasStableOwnSource(hit)) return hit;
    return closestStableSourceElement(hit) || hit;
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
    return "an-" + String(prefix || "copy") + "-" + random;
  }

  function resetRuntimeStableIds(root: Element | null): void {
    if (!root || !root.querySelectorAll) return;
    var nodes = [root].concat(
      Array.prototype.slice.call(
        root.querySelectorAll("[data-agent-native-node-id]"),
      ),
    );
    nodes.forEach(function (node, index) {
      if (node && node.setAttribute) {
        node.setAttribute(
          "data-agent-native-node-id",
          freshRuntimeNodeId(index === 0 ? "copy" : "copy-child"),
        );
      }
    });
  }

  function getSelector(el: Element | null): string {
    if (!el) return "";
    var stableOwnSelector =
      attributeSelector(el, "data-agent-native-node-id") ||
      attributeSelector(el, "data-code-layer-id") ||
      attributeSelector(el, "data-layer-id") ||
      attributeSelector(el, "data-builder-id") ||
      attributeSelector(el, "data-loc");
    if (stableOwnSelector) return stableOwnSelector;

    if (el.id) return "#" + escapeIdent(el.id);
    var stableAncestor = closestStableSourceElement(el);
    if (stableAncestor && stableAncestor !== el) {
      var stableAncestorSelector = selectorPart(stableAncestor);
      if (stableAncestorSelector) {
        var descendantPath = selectorPath(el, stableAncestor);
        var descendantParts = descendantPath ? descendantPath.split(" > ") : [];
        if (descendantParts.length) {
          return stableAncestorSelector + " > " + descendantParts.join(" > ");
        }
        return stableAncestorSelector;
      }
    }

    return selectorPath(el);
  }

  function explicitComponentNameForElement(el: Element | null): string {
    var raw =
      el && el.getAttribute && el.getAttribute("data-agent-native-component");
    return raw && raw.trim ? raw.trim() : "";
  }

  function elementLooksLikeComponent(el: Element | null): boolean {
    if (!el || !el.getAttribute || !el.tagName) return false;
    if (explicitComponentNameForElement(el)) return true;
    var tag = el.tagName.toLowerCase();
    if (
      tag === "button" ||
      tag === "input" ||
      tag === "select" ||
      tag === "textarea"
    ) {
      return true;
    }
    var layerName = el.getAttribute("data-agent-native-layer-name") || "";
    if (/component|card|button|control/i.test(layerName)) return true;
    if (!el.classList) return false;
    for (var i = 0; i < el.classList.length; i += 1) {
      if (/component|card|button|control/i.test(el.classList.item(i) || "")) {
        return true;
      }
    }
    return false;
  }

  function componentNameForElement(el: Element | null): string {
    var explicit = explicitComponentNameForElement(el);
    if (explicit) return explicit;
    if (!elementLooksLikeComponent(el) || !el || !el.getAttribute) return "";
    var layerName = el.getAttribute("data-agent-native-layer-name");
    return layerName && layerName.trim ? layerName.trim() : "";
  }

  function isAutoLayoutDisplay(display: string | undefined): boolean {
    return (
      display === "flex" ||
      display === "inline-flex" ||
      display === "grid" ||
      display === "inline-grid"
    );
  }

  function rectInfoForElement(el: Element) {
    var rect = el.getBoundingClientRect();
    return {
      x: rect.x + (window.scrollX || window.pageXOffset || 0),
      y: rect.y + (window.scrollY || window.pageYOffset || 0),
      width: rect.width,
      height: rect.height,
    };
  }

  function autoLayoutParentInfo(el: Element) {
    var parent = el.parentElement;
    if (
      !parent ||
      parent === document.body ||
      parent === document.documentElement
    ) {
      return undefined;
    }
    var parentStyles = window.getComputedStyle(parent);
    if (!isAutoLayoutDisplay(parentStyles.display)) return undefined;
    return {
      display: parentStyles.display,
      selector: getSelector(parent),
      sourceId: getSourceId(parent) || getSelector(parent),
      boundingRect: rectInfoForElement(parent),
    };
  }

  var PORTABLE_STYLE_PROPERTIES = [
    "alignContent",
    "alignItems",
    "alignSelf",
    "aspectRatio",
    "background",
    "backgroundAttachment",
    "backgroundClip",
    "backgroundColor",
    "backgroundImage",
    "backgroundOrigin",
    "backgroundPosition",
    "backgroundRepeat",
    "backgroundSize",
    "border",
    "borderBottom",
    "borderBottomColor",
    "borderBottomLeftRadius",
    "borderBottomRightRadius",
    "borderBottomStyle",
    "borderBottomWidth",
    "borderColor",
    "borderLeft",
    "borderLeftColor",
    "borderLeftStyle",
    "borderLeftWidth",
    "borderRadius",
    "borderRight",
    "borderRightColor",
    "borderRightStyle",
    "borderRightWidth",
    "borderStyle",
    "borderTop",
    "borderTopColor",
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderTopStyle",
    "borderTopWidth",
    "borderWidth",
    "boxShadow",
    "boxSizing",
    "color",
    "columnGap",
    "display",
    "filter",
    "flex",
    "flexBasis",
    "flexDirection",
    "flexGrow",
    "flexShrink",
    "flexWrap",
    "font",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "gap",
    "gridAutoColumns",
    "gridAutoFlow",
    "gridAutoRows",
    "gridColumn",
    "gridColumnEnd",
    "gridColumnStart",
    "gridRow",
    "gridRowEnd",
    "gridRowStart",
    "gridTemplateColumns",
    "gridTemplateRows",
    "height",
    "justifyContent",
    "justifyItems",
    "justifySelf",
    "letterSpacing",
    "lineHeight",
    "margin",
    "marginBottom",
    "marginLeft",
    "marginRight",
    "marginTop",
    "maxHeight",
    "maxWidth",
    "minHeight",
    "minWidth",
    "mixBlendMode",
    "objectFit",
    "objectPosition",
    "opacity",
    "order",
    "outline",
    "outlineColor",
    "outlineOffset",
    "outlineStyle",
    "outlineWidth",
    "overflow",
    "overflowX",
    "overflowY",
    "padding",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "placeContent",
    "placeItems",
    "placeSelf",
    "position",
    "rowGap",
    "textAlign",
    "textDecoration",
    "textDecorationColor",
    "textDecorationLine",
    "textDecorationStyle",
    "textShadow",
    "textTransform",
    "transform",
    "transformOrigin",
    "verticalAlign",
    "whiteSpace",
    "width",
    "wordBreak",
    "zIndex",
  ];

  function elementPathFromRoot(root: Element, node: Element): number[] {
    var path = [];
    var current: Element | null = node;
    while (current && current !== root && current.parentElement) {
      var siblings = Array.prototype.slice.call(current.parentElement.children);
      path.unshift(Math.max(0, siblings.indexOf(current)));
      current = current.parentElement;
    }
    return path;
  }

  function collectPortableComputedStyles(
    el: Element | null,
  ): Record<string, string> {
    if (!el) return {};
    var cs = window.getComputedStyle(el);
    var styles: Record<string, string> = {};
    PORTABLE_STYLE_PROPERTIES.forEach(function (property) {
      var value = cs[property] || cs.getPropertyValue(property);
      if (typeof value === "string" && value.trim()) {
        styles[property] = value;
      }
    });
    for (var index = 0; index < cs.length; index += 1) {
      var name = cs.item(index);
      if (name && name.indexOf("--") === 0) {
        var customValue = cs.getPropertyValue(name);
        if (customValue && customValue.trim()) {
          styles[name] = customValue.trim();
        }
      }
    }
    return styles;
  }

  function collectPortableStyleSnapshot(root: Element | null) {
    if (!root || isDocumentRootElement(root)) return undefined;
    var nodes = [];
    var maxNodes = 80;
    function pushNode(node: Element) {
      if (nodes.length >= maxNodes) return;
      nodes.push({
        sourceId: getSourceId(node) || undefined,
        path: elementPathFromRoot(root, node),
        styles: collectPortableComputedStyles(node),
      });
    }
    pushNode(root);
    var descendants = Array.prototype.slice.call(root.querySelectorAll("*"));
    for (
      var index = 0;
      index < descendants.length && nodes.length < maxNodes;
      index += 1
    ) {
      pushNode(descendants[index]);
    }
    return {
      version: 1,
      rootSourceId: getSourceId(root) || undefined,
      nodes: nodes,
    };
  }

  // Raw authored (not computed) inline style values for the properties the
  // EditPanel constraints/position/auto-size readers need to distinguish
  // "unset" from "resolved to a computed pixel value" (e.g. an absolutely
  // positioned element with only `left` authored still computes both `left`
  // and `right` — only the inline style tells you which side was actually
  // set). Empty-string values are omitted so callers can treat key-absence as
  // "not authored".
  var INLINE_STYLE_PROPERTIES = [
    "position",
    "left",
    "right",
    "top",
    "bottom",
    "width",
    "height",
    "transform",
    "whiteSpace",
  ];

  function collectInlineStyles(el: Element): Record<string, string> {
    var styles: Record<string, string> = {};
    var inline = (el as HTMLElement).style;
    if (!inline) return styles;
    INLINE_STYLE_PROPERTIES.forEach(function (property) {
      var value = inline[property as never] as unknown as string;
      if (typeof value === "string" && value !== "") {
        styles[property] = value;
      }
    });
    return styles;
  }

  function chromeColorForElement(el: Element | null): string {
    return elementLooksLikeComponent(el)
      ? "var(--design-editor-component-color)"
      : "var(--design-editor-accent-color)";
  }

  function chromeStrongColorForElement(el: Element | null): string {
    return elementLooksLikeComponent(el)
      ? "var(--design-editor-component-strong-color)"
      : "var(--design-editor-accent-strong-color)";
  }

  function chromeContrastColorForElement(el: Element | null): string {
    return elementLooksLikeComponent(el)
      ? "var(--design-editor-component-contrast-color)"
      : "var(--design-editor-accent-contrast-color)";
  }

  function getElementInfo(el: Element): unknown {
    var cs = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var componentName = componentNameForElement(el);
    var parentAutoLayout = autoLayoutParentInfo(el);
    var parentStyles = el.parentElement
      ? window.getComputedStyle(el.parentElement)
      : null;
    var parentDisplay = parentStyles ? parentStyles.display : undefined;
    var sourceBacked =
      hasStableOwnSource(el) || !!closestStableSourceElement(el);
    var sourceId = sourceBacked ? getSourceId(el) || getSelector(el) : "";
    // Id-on-demand (empty-node-id fix, bridge side): AI-generated screens
    // frequently ship with NO data-agent-native-node-id anywhere, which
    // breaks every id-keyed operation host-side ("Could not move that
    // layer", `Node with data-agent-native-node-id="" not found`). When the
    // element has no stable own id, mint a durable candidate once and expose
    // it as `pendingNodeId` in the payload so the HOST can persist it into
    // the source as the element's real data-agent-native-node-id. The mint
    // is stored under data-an-pending-node-id — an attribute that
    // getSourceId/getSelector/closestStableSourceElement deliberately do NOT
    // read — so until the host persists it, resolution still flows through
    // the existing structural-selector fallback unchanged.
    var pendingNodeId = "";
    if (
      !getSourceId(el) &&
      el !== document.body &&
      el !== document.documentElement &&
      el.getAttribute &&
      el.setAttribute
    ) {
      pendingNodeId = el.getAttribute("data-an-pending-node-id") || "";
      if (!pendingNodeId) {
        pendingNodeId = freshRuntimeNodeId("pending");
        try {
          el.setAttribute("data-an-pending-node-id", pendingNodeId);
        } catch (_err) {}
      }
    }
    var parentLayout = parentStyles
      ? {
          display: parentStyles.display,
          flexDirection: parentStyles.flexDirection,
          alignItems: parentStyles.alignItems,
          justifyContent: parentStyles.justifyContent,
          gap: parentStyles.gap,
          gridTemplateColumns: parentStyles.gridTemplateColumns,
          gridTemplateRows: parentStyles.gridTemplateRows,
          position: parentStyles.position,
        }
      : undefined;
    var capabilities = sourceBacked
      ? [
          {
            kind: "deterministic-style-edit",
            label: "deterministic-style-edit",
            confidence: 0.92,
            reason:
              "Inline style can be patched and replayed through HMR/collab.",
          },
        ]
      : [
          {
            kind: "unsupported",
            label: "runtime-only-element",
            confidence: 0.3,
            reason: "This runtime node is not anchored to a source code layer.",
          },
        ];
    if (sourceBacked && el.classList && el.classList.length > 0) {
      capabilities.push({
        kind: "deterministic-class-edit",
        label: "deterministic-class-edit",
        confidence: 0.78,
        reason: "Class tokens are visible on the selected element.",
      });
    }
    if (sourceBacked && isAutoLayoutDisplay(parentDisplay)) {
      capabilities.push({
        kind: "agent-structural-edit",
        label: "agent-structural-edit",
        confidence: 0.54,
        reason:
          "Parent layout context decides whether movement means gap, order, alignment, or wrapper structure.",
      });
    }
    // --- provenance: read source-location attributes when present ---
    // These are emitted by connected apps via @vitejs/plugin-react jsxDEV or a
    // Babel source plugin.  Cross-origin localhost iframes cannot be read (CSP /
    // same-origin policy), so this will be undefined in that case — expected.
    var provenance:
      | {
          sourceFile?: string;
          line?: number;
          column?: number;
          component?: string;
        }
      | undefined = undefined;
    var dataSourceFile = el.getAttribute("data-source-file");
    var dataSourceLine = el.getAttribute("data-source-line");
    var dataSourceColumn = el.getAttribute("data-source-column");
    var dataComponentName = el.getAttribute("data-component-name");
    var dataLoc = el.getAttribute("data-loc");
    // data-loc may encode "file:line:col" (Babel source plugin convention).
    // Only parse it when data-source-file is absent, to avoid double-reads.
    if (!dataSourceFile && dataLoc) {
      var lastColonIndex = dataLoc.lastIndexOf(":");
      var lastPart =
        lastColonIndex >= 0 ? dataLoc.slice(lastColonIndex + 1) : "";
      if (lastColonIndex >= 0 && /^\d+$/.test(lastPart)) {
        var beforeLastPart = dataLoc.slice(0, lastColonIndex);
        var previousColonIndex = beforeLastPart.lastIndexOf(":");
        var previousPart =
          previousColonIndex >= 0
            ? beforeLastPart.slice(previousColonIndex + 1)
            : "";
        var hasColumn = /^\d+$/.test(previousPart);
        dataSourceFile = hasColumn
          ? beforeLastPart.slice(0, previousColonIndex)
          : beforeLastPart;
        dataSourceLine = hasColumn ? previousPart : lastPart;
        if (hasColumn) dataSourceColumn = lastPart;
      }
    }
    if (
      dataSourceFile ||
      dataSourceLine ||
      dataSourceColumn ||
      dataComponentName
    ) {
      provenance = {};
      if (dataSourceFile) provenance.sourceFile = dataSourceFile;
      if (dataSourceLine) {
        var ln = parseInt(dataSourceLine, 10);
        if (!isNaN(ln)) provenance.line = ln;
      }
      if (dataSourceColumn) {
        var col = parseInt(dataSourceColumn, 10);
        if (!isNaN(col)) provenance.column = col;
      }
      if (dataComponentName) provenance.component = dataComponentName;
    }
    return {
      tagName: el.tagName.toLowerCase(),
      componentName: componentName || undefined,
      id: el.id || undefined,
      sourceId: sourceId,
      pendingNodeId: pendingNodeId || undefined,
      selector: getSelector(el),
      classes: Array.from(el.classList),
      computedStyles: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        backgroundPosition: cs.backgroundPosition,
        backgroundRepeat: cs.backgroundRepeat,
        backgroundSize: cs.backgroundSize,
        backgroundBlendMode: cs.backgroundBlendMode,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        textAlign: cs.textAlign,
        display: cs.display,
        overflow: cs.overflow,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        alignSelf: cs.alignSelf,
        flexGrow: cs.flexGrow,
        flexShrink: cs.flexShrink,
        flexBasis: cs.flexBasis,
        order: cs.order,
        gridColumn: cs.gridColumn,
        gridRow: cs.gridRow,
        position: cs.position,
        top: cs.top,
        right: cs.right,
        bottom: cs.bottom,
        left: cs.left,
        gap: cs.gap,
        width: cs.width,
        height: cs.height,
        opacity: cs.opacity,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        marginTop: cs.marginTop,
        marginRight: cs.marginRight,
        marginBottom: cs.marginBottom,
        marginLeft: cs.marginLeft,
        borderWidth: cs.borderWidth,
        borderStyle: cs.borderStyle,
        borderColor: cs.borderColor,
        borderRadius: cs.borderRadius,
        borderTopLeftRadius: cs.borderTopLeftRadius,
        borderTopRightRadius: cs.borderTopRightRadius,
        borderBottomRightRadius: cs.borderBottomRightRadius,
        borderBottomLeftRadius: cs.borderBottomLeftRadius,
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
        // Text glyph outline (Figma-parity text "Stroke") — CSS has no
        // unprefixed alias, so this is read via the vendor-prefixed
        // longhands directly. See applyStyleEdit/normalizeStyleProperty in
        // shared/code-layer.ts for the matching write-side allow-list entry.
        webkitTextStrokeWidth: (
          cs as unknown as { webkitTextStrokeWidth?: string }
        ).webkitTextStrokeWidth,
        webkitTextStrokeColor: (
          cs as unknown as { webkitTextStrokeColor?: string }
        ).webkitTextStrokeColor,
        boxShadow: cs.boxShadow,
        textShadow: cs.textShadow,
        filter: cs.filter,
        mixBlendMode: cs.mixBlendMode,
        zIndex: cs.zIndex,
        transform: cs.transform,
        scale: cs.scale,
        visibility: cs.visibility,
        backdropFilter: cs.backdropFilter,
        webkitBackdropFilter: (
          cs as unknown as { webkitBackdropFilter?: string }
        ).webkitBackdropFilter,
        flexWrap: cs.flexWrap,
        alignContent: cs.alignContent,
        isolation: cs.isolation,
        whiteSpace: cs.whiteSpace,
      },
      inlineStyles: collectInlineStyles(el),
      primitiveKind: el.getAttribute("data-an-primitive") || undefined,
      portableStyleSnapshot: collectPortableStyleSnapshot(el),
      boundingRect: {
        x: rect.x + (window.scrollX || window.pageXOffset || 0),
        y: rect.y + (window.scrollY || window.pageYOffset || 0),
        width: rect.width,
        height: rect.height,
      },
      textContent: el.textContent ? el.textContent.slice(0, 200) : undefined,
      htmlContent:
        el.innerHTML && el.innerHTML !== el.textContent
          ? el.innerHTML.slice(0, 4000)
          : undefined,
      childElementCount: el.children ? el.children.length : 0,
      isFlexContainer: cs.display === "flex" || cs.display === "inline-flex",
      isGridContainer: cs.display === "grid" || cs.display === "inline-grid",
      isFlexChild: parentDisplay === "flex" || parentDisplay === "inline-flex",
      parentDisplay: parentDisplay,
      parentAutoLayout: parentAutoLayout,
      parentLayout: parentLayout,
      editCapabilities: capabilities,
      confidence: capabilities.reduce(function (best, item) {
        return Math.max(best, item.confidence || 0);
      }, 0),
      provenance: provenance,
    };
  }

  // Light hover descriptor: every pointer hover posts one of these instead of
  // the full getElementInfo() payload. getElementInfo() runs getComputedStyle
  // over ~130 properties on the element PLUS (via collectPortableStyleSnapshot)
  // up to 80 descendants — fine at select/drag-start time, too expensive to run
  // on every mousemove. Hover-only consumers (outline positioning, code-layer
  // resolution by selector/id/tagName/classes/text) never read computedStyles
  // or portableStyleSnapshot, so this intentionally omits both. Full detail is
  // still posted on element-select / drag-start / edit-time messages via
  // getElementInfo().
  function getLightElementInfo(el: Element): unknown {
    var rect = el.getBoundingClientRect();
    var componentName = componentNameForElement(el);
    var sourceBacked =
      hasStableOwnSource(el) || !!closestStableSourceElement(el);
    var sourceId = sourceBacked ? getSourceId(el) || getSelector(el) : "";
    var parentStyles = el.parentElement
      ? window.getComputedStyle(el.parentElement)
      : null;
    var parentDisplay = parentStyles ? parentStyles.display : undefined;
    var cs = window.getComputedStyle(el);
    return {
      tagName: el.tagName.toLowerCase(),
      componentName: componentName || undefined,
      id: el.id || undefined,
      sourceId: sourceId,
      selector: getSelector(el),
      classes: Array.from(el.classList),
      computedStyles: {},
      boundingRect: {
        x: rect.x + (window.scrollX || window.pageXOffset || 0),
        y: rect.y + (window.scrollY || window.pageYOffset || 0),
        width: rect.width,
        height: rect.height,
      },
      textContent: el.textContent ? el.textContent.slice(0, 200) : undefined,
      childElementCount: el.children ? el.children.length : 0,
      isFlexContainer: cs.display === "flex" || cs.display === "inline-flex",
      isGridContainer: cs.display === "grid" || cs.display === "inline-grid",
      isFlexChild: parentDisplay === "flex" || parentDisplay === "inline-flex",
      parentDisplay: parentDisplay,
    };
  }

  function selectionIntentFromEvent(e): {
    additive: boolean;
    range: boolean;
    source: "pointer";
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
  } {
    var additive = Boolean(e && (e.metaKey || e.ctrlKey || e.shiftKey));
    return {
      additive: additive,
      range: Boolean(e && e.shiftKey),
      source: "pointer",
      shiftKey: Boolean(e && e.shiftKey),
      metaKey: Boolean(e && e.metaKey),
      ctrlKey: Boolean(e && e.ctrlKey),
    };
  }

  function postElementSelect(el: Element, e?: MouseEvent): void {
    var message: {
      type: string;
      payload: unknown;
      intent?: ReturnType<typeof selectionIntentFromEvent>;
    } = {
      type: "element-select",
      payload: getElementInfo(el),
    };
    if (e) message.intent = selectionIntentFromEvent(e);
    (window.parent as Window).postMessage(message, "*");
  }

  function collectSelectableElements(): Element[] {
    var nodes = Array.prototype.slice.call(
      document.querySelectorAll(
        "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[data-loc]",
      ),
    ) as Element[];
    var seen = new Set<Element>();
    var elements: Element[] = [];
    nodes.forEach(function (node) {
      var target = selectionTargetForHit(node);
      if (
        !target ||
        isDocumentRootElement(target) ||
        isBoardRootMarqueeSurface(target) ||
        isOverlayElement(target) ||
        isLayerInteractionBlocked(target) ||
        seen.has(target)
      ) {
        return;
      }
      var rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      seen.add(target);
      elements.push(target);
    });
    return elements;
  }

  function collectSelectableElementInfos(): unknown[] {
    return collectSelectableElements().map(function (target) {
      return getElementInfo(target);
    });
  }

  var shieldOverlay = document.createElement("div");
  shieldOverlay.setAttribute("data-agent-native-edit-overlay", "shield");
  shieldOverlay.style.cssText =
    "position:fixed;inset:0;z-index:99990;background:transparent;pointer-events:auto;touch-action:none;cursor:default;";
  document.body.appendChild(shieldOverlay);

  var highlightOverlay = document.createElement("div");
  highlightOverlay.setAttribute("data-agent-native-edit-overlay", "highlight");
  highlightOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:99997;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;";
  document.body.appendChild(highlightOverlay);

  var marqueeSelectionOverlay = document.createElement("div");
  marqueeSelectionOverlay.setAttribute(
    "data-agent-native-edit-overlay",
    "marquee-selection",
  );
  marqueeSelectionOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:99995;border:1px solid var(--design-editor-accent-color);background:color-mix(in srgb,var(--design-editor-accent-color) 14%,transparent);display:none;box-sizing:border-box;";
  document.body.appendChild(marqueeSelectionOverlay);

  var parentAutoLayoutOverlay = document.createElement("div");
  parentAutoLayoutOverlay.setAttribute(
    "data-agent-native-edit-overlay",
    "parent-auto-layout",
  );
  parentAutoLayoutOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:99996;border:1px dashed var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;border-radius:2px;opacity:0.68;";
  document.body.appendChild(parentAutoLayoutOverlay);

  var selectionOverlay = document.createElement("div");
  selectionOverlay.setAttribute("data-agent-native-edit-overlay", "selection");
  selectionOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:99998;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;cursor:default;";
  ["n", "e", "s", "w"].forEach(function (pos) {
    var edge = document.createElement("span");
    edge.setAttribute("data-agent-native-edge-handle", pos);
    var cursor = pos === "n" || pos === "s" ? "ns-resize" : "ew-resize";
    edge.style.cssText =
      "position:absolute;pointer-events:auto;cursor:" +
      cursor +
      ";background:transparent;";
    if (pos === "n") {
      edge.style.left = "0";
      edge.style.right = "0";
      edge.style.top = "-5px";
      edge.style.height = "10px";
    }
    if (pos === "s") {
      edge.style.left = "0";
      edge.style.right = "0";
      edge.style.bottom = "-5px";
      edge.style.height = "10px";
    }
    if (pos === "e") {
      edge.style.top = "0";
      edge.style.bottom = "0";
      edge.style.right = "-5px";
      edge.style.width = "10px";
    }
    if (pos === "w") {
      edge.style.top = "0";
      edge.style.bottom = "0";
      edge.style.left = "-5px";
      edge.style.width = "10px";
    }
    selectionOverlay.appendChild(edge);
  });
  ["nw", "ne", "se", "sw"].forEach(function (pos) {
    var handle = document.createElement("span");
    handle.setAttribute("data-agent-native-edit-handle", pos);
    var cursor =
      pos === "n" || pos === "s"
        ? "ns-resize"
        : pos === "e" || pos === "w"
          ? "ew-resize"
          : pos === "nw" || pos === "se"
            ? "nwse-resize"
            : "nesw-resize";
    handle.style.cssText =
      "position:absolute;z-index:1;width:7px;height:7px;border:1px solid var(--design-editor-accent-color);background:var(--design-editor-accent-contrast-color);box-sizing:border-box;border-radius:1px;pointer-events:auto;cursor:" +
      cursor +
      ";";
    if (pos.indexOf("n") !== -1) handle.style.top = "-4px";
    if (pos.indexOf("s") !== -1) handle.style.bottom = "-4px";
    if (pos.indexOf("w") !== -1) handle.style.left = "-4px";
    if (pos.indexOf("e") !== -1) handle.style.right = "-4px";
    if (pos === "n" || pos === "s") {
      handle.style.left = "50%";
      handle.style.transform = "translateX(-50%)";
    }
    if (pos === "e" || pos === "w") {
      handle.style.top = "50%";
      handle.style.transform = "translateY(-50%)";
    }
    selectionOverlay.appendChild(handle);
  });
  ["nw", "ne", "se", "sw"].forEach(function (pos) {
    var rotate = document.createElement("span");
    rotate.setAttribute("data-agent-native-rotate-handle", pos);
    rotate.style.cssText =
      "position:absolute;width:18px;height:18px;border-radius:999px;pointer-events:auto;cursor:grab;";
    if (pos.indexOf("n") !== -1) rotate.style.top = "-26px";
    if (pos.indexOf("s") !== -1) rotate.style.bottom = "-26px";
    if (pos.indexOf("w") !== -1) rotate.style.left = "-26px";
    if (pos.indexOf("e") !== -1) rotate.style.right = "-26px";
    selectionOverlay.appendChild(rotate);
  });
  var spacingOverlay = document.createElement("div");
  spacingOverlay.setAttribute("data-agent-native-spacing-overlay", "");
  spacingOverlay.style.cssText =
    "position:absolute;inset:0;display:none;pointer-events:none;";
  selectionOverlay.appendChild(spacingOverlay);
  document.body.appendChild(selectionOverlay);

  // ── Gradient edit overlay (in-iframe parity for MultiScreenCanvas's
  // GradientEditOverlay) ──────────────────────────────────────────────────
  // Renders the same gradient line + endpoint squares + round stop markers
  // over an element *inside* this screen's iframe content, driven entirely
  // by `gradient-edit-target` / `gradient-edit-clear` postMessages from the
  // parent (DesignEditor forwards its existing `gradientEditTarget` state
  // for the active screen — see the doc comment on
  // `gradientEditOverlayTarget` below for the exact wiring contract). Linear
  // gradients only, matching MultiScreenCanvas's overlay scope: an
  // unparseable or non-linear `cssValue` renders nothing.
  //
  // The math below (gradientLineEndpoints/gradientStopPoints/
  // angleFromDraggedEndpoint/stopPercentFromDraggedPoint) is a direct port
  // of the same-named pure functions exported from MultiScreenCanvas.tsx —
  // this file cannot import them (bridge sources may not import/require
  // anything, see bridge.guard.spec.ts), so the formulas are duplicated
  // here verbatim. Keep both copies in sync if the math ever changes.
  var gradientOverlay = document.createElement("div");
  gradientOverlay.setAttribute("data-agent-native-edit-overlay", "gradient");
  gradientOverlay.style.cssText =
    "position:fixed;z-index:99998;pointer-events:none;display:none;box-sizing:border-box;";
  var gradientOverlaySvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  gradientOverlaySvg.setAttribute("data-gradient-edit-line", "");
  gradientOverlaySvg.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;";
  var gradientOverlayLineOutline = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "line",
  );
  gradientOverlayLineOutline.setAttribute("stroke", "rgba(255,255,255,0.95)");
  var gradientOverlayLine = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "line",
  );
  gradientOverlayLine.setAttribute(
    "stroke",
    "var(--design-editor-accent-color)",
  );
  gradientOverlaySvg.appendChild(gradientOverlayLineOutline);
  gradientOverlaySvg.appendChild(gradientOverlayLine);
  gradientOverlay.appendChild(gradientOverlaySvg);
  var gradientOverlayStartHandle = document.createElement("span");
  gradientOverlayStartHandle.setAttribute("data-gradient-endpoint", "start");
  gradientOverlayStartHandle.setAttribute("role", "slider");
  gradientOverlayStartHandle.setAttribute(
    "aria-label",
    "Gradient start" /* i18n-ignore */,
  );
  gradientOverlayStartHandle.style.cssText =
    "position:absolute;pointer-events:auto;cursor:move;border-radius:2px;box-sizing:border-box;background:var(--design-editor-accent-contrast-color);border:1px solid var(--design-editor-accent-color);box-shadow:0 1px 2px rgba(0,0,0,0.3);";
  var gradientOverlayEndHandle = document.createElement("span");
  gradientOverlayEndHandle.setAttribute("data-gradient-endpoint", "end");
  gradientOverlayEndHandle.setAttribute("role", "slider");
  gradientOverlayEndHandle.setAttribute(
    "aria-label",
    "Gradient end" /* i18n-ignore */,
  );
  gradientOverlayEndHandle.style.cssText =
    gradientOverlayStartHandle.style.cssText;
  gradientOverlay.appendChild(gradientOverlayStartHandle);
  gradientOverlay.appendChild(gradientOverlayEndHandle);
  document.body.appendChild(gradientOverlay);

  var transformBadge = document.createElement("div");
  transformBadge.setAttribute("data-agent-native-transform-badge", "");
  transformBadge.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;border:1px solid hsl(var(--border));border-radius:4px;background:hsl(var(--background) / 0.96);color:hsl(var(--foreground));font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 5px;box-shadow:0 8px 20px color-mix(in srgb, hsl(var(--foreground)) 16%, transparent);";
  document.body.appendChild(transformBadge);

  var spacingBadge = document.createElement("div");
  spacingBadge.setAttribute("data-agent-native-spacing-badge", "");
  spacingBadge.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;border-radius:3px;color:white;font:10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;padding:2px 4px;box-shadow:0 4px 14px rgba(0,0,0,0.18);";
  document.body.appendChild(spacingBadge);

  var insertionGuide = document.createElement("div");
  insertionGuide.setAttribute("data-agent-native-insertion-guide", "");
  insertionGuide.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;background:var(--design-editor-accent-color);border-radius:999px;box-shadow:0 0 0 1px var(--design-editor-accent-color);";
  document.body.appendChild(insertionGuide);

  // Alignment/smart-guide lines shown while dragging (and resizing) an
  // element inside the iframe — Figma-style snap-to-sibling guides. Two
  // shared singleton divs (one per axis) are repositioned per-frame rather
  // than pooled, matching the insertionGuide convention above. Tagged as an
  // edit-overlay so elementFromEditorPoint/isOverlayElement never treat a
  // guide line as a hit-test or drop target. Color matches the overview
  // canvas's alignment guides (bg-destructive/90) translated to raw CSS.
  var snapGuideV = document.createElement("div");
  snapGuideV.setAttribute("data-agent-native-edit-overlay", "snap-guide");
  snapGuideV.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;width:1px;background:hsl(var(--destructive) / 0.9);";
  document.body.appendChild(snapGuideV);

  var snapGuideH = document.createElement("div");
  snapGuideH.setAttribute("data-agent-native-edit-overlay", "snap-guide");
  snapGuideH.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;height:1px;background:hsl(var(--destructive) / 0.9);";
  document.body.appendChild(snapGuideH);

  var measurementOverlay = document.createElement("div");
  measurementOverlay.setAttribute("data-agent-native-measurement-overlay", "");
  measurementOverlay.style.cssText =
    "position:fixed;inset:0;z-index:100001;display:none;pointer-events:none;color:var(--design-editor-measure-color);font:11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;";
  document.body.appendChild(measurementOverlay);

  // Component-instance tag: a small pill that floats above the selection
  // outline whenever the selected element carries a data-agent-native-component
  // attribute.  Clicking it sends a 'component-source-jump' message to the
  // parent so the editor can invoke open-component-source.
  var componentTagOverlay = document.createElement("div");
  componentTagOverlay.setAttribute(
    "data-agent-native-edit-overlay",
    "component-tag",
  );
  componentTagOverlay.style.cssText =
    [
      "position:fixed",
      "z-index:100002",
      "display:none",
      "pointer-events:auto",
      "cursor:pointer",
      "padding:2px 6px",
      "border-radius:4px",
      "font:11px/1.6 ui-sans-serif,system-ui,sans-serif",
      "white-space:nowrap",
      "user-select:none",
      "-webkit-user-select:none",
      "background:var(--design-editor-component-color)",
      "color:var(--design-editor-component-contrast-color)",
      "box-shadow:0 1px 4px color-mix(in srgb,var(--design-editor-component-color) 40%,transparent)",
      "border:1px solid color-mix(in srgb,var(--design-editor-component-strong-color) 60%,transparent)",
      "outline:2px solid transparent",
      "transition:opacity 0.1s",
    ].join(";") + ";";
  document.body.appendChild(componentTagOverlay);

  componentTagOverlay.addEventListener("click", function (e) {
    e.stopPropagation();
    e.preventDefault();
    var nodeId =
      componentTagOverlay.getAttribute("data-component-node-id") || "";
    var componentName =
      componentTagOverlay.getAttribute("data-component-name") || "";
    if (!nodeId || !componentName) return;
    try {
      (window.parent as Window).postMessage(
        {
          type: "component-source-jump",
          nodeId: nodeId,
          componentName: componentName,
        },
        "*",
      );
    } catch (_err) {}
  });

  function updateComponentTag(el: Element | null, knownRect?: DOMRect): void {
    if (!el) {
      clearComponentTag();
      return;
    }
    var compName = explicitComponentNameForElement(el);
    if (!compName) {
      clearComponentTag();
      return;
    }
    var nodeId =
      el.getAttribute("data-agent-native-node-id") ||
      el.getAttribute("data-code-layer-id") ||
      el.getAttribute("data-layer-id") ||
      el.id ||
      "";
    componentTagOverlay.textContent = compName + " →";
    componentTagOverlay.setAttribute("data-component-node-id", nodeId);
    componentTagOverlay.setAttribute("data-component-name", compName);

    // Reuse the caller's fresh rect when available: positionOverlay() already
    // read this element's rect this frame, and an extra getBoundingClientRect
    // here is a second forced layout when overlay styles were just written.
    var rect = knownRect || el.getBoundingClientRect();
    // Constant-screen-size chrome: pill font/padding/offsets and the
    // component-root outline compensate for the host's iframe scale.
    var line = chromeLineScale();
    var tagHeight = 22 * line;
    var tagTop = rect.top - tagHeight - 4 * line;
    if (tagTop < 4 * line) tagTop = rect.top + 4 * line;
    componentTagOverlay.style.display = "block";
    componentTagOverlay.style.fontSize = 11 * line + "px";
    componentTagOverlay.style.padding = 2 * line + "px " + 6 * line + "px";
    componentTagOverlay.style.borderRadius = 4 * line + "px";
    componentTagOverlay.style.borderWidth = 1 * line + "px";
    componentTagOverlay.style.left = rect.left + "px";
    componentTagOverlay.style.top = tagTop + "px";
    // Purple outline on the selection overlay distinguishes component roots.
    selectionOverlay.style.outline =
      2 * line + "px solid " + chromeStrongColorForElement(el);
    selectionOverlay.style.outlineOffset = 2 * line + "px";
  }

  function clearComponentTag(): void {
    componentTagOverlay.style.display = "none";
    componentTagOverlay.removeAttribute("data-component-node-id");
    componentTagOverlay.removeAttribute("data-component-name");
    selectionOverlay.style.outline = "";
    selectionOverlay.style.outlineOffset = "";
  }

  function applyElementOverlayChrome(
    overlay: HTMLElement,
    el: Element | null,
  ): void {
    var color = chromeColorForElement(el);
    var contrast = chromeContrastColorForElement(el);
    overlay.style.borderColor = color;
    overlay
      .querySelectorAll(
        "[data-agent-native-edit-handle],[data-agent-native-edit-overlay='multi-selection-handle']",
      )
      .forEach(function (node) {
        if (!(node instanceof HTMLElement)) return;
        node.style.borderColor = color;
        node.style.background = contrast;
      });
  }

  function applySelectionChrome(el: Element | null): void {
    applyElementOverlayChrome(selectionOverlay, el);
  }

  function hideParentAutoLayoutOverlay(): void {
    parentAutoLayoutOverlay.style.display = "none";
  }

  function updateParentAutoLayoutOverlay(el: Element | null): void {
    var parent = el && el.parentElement;
    if (
      !parent ||
      parent === document.body ||
      parent === document.documentElement
    ) {
      hideParentAutoLayoutOverlay();
      return;
    }
    var parentStyles = window.getComputedStyle(parent);
    if (!isAutoLayoutDisplay(parentStyles.display)) {
      hideParentAutoLayoutOverlay();
      return;
    }
    positionOverlay(parentAutoLayoutOverlay, parent);
    var color = chromeColorForElement(el);
    parentAutoLayoutOverlay.style.borderColor =
      "color-mix(in srgb," + color + " 68%,transparent)";
    parentAutoLayoutOverlay.style.background =
      "color-mix(in srgb," + color + " 5%,transparent)";
  }

  function hideSelectionOverlay(): void {
    selectionOverlay.style.display = "none";
    hideSpacingOverlay();
    hideParentAutoLayoutOverlay();
    clearComponentTag();
  }

  var selectedEl: Element | null = null;
  var hoveredEl: Element | null = null;
  var passiveSelectionEls: Element[] = [];
  var passiveSelectionOverlays: HTMLElement[] = [];
  var activeMarqueeSelection: {
    startX: number;
    startY: number;
    additive: boolean;
    moved: boolean;
    pointerId?: number;
    move: string;
    up: string;
    onMove: (ev: MouseEvent) => void;
    onUp: (ev: MouseEvent) => void;
  } | null = null;
  var activeTextEditEl: HTMLElement | null = null;
  // Session-captured original min-width/min-height for the active text edit
  // (T19): refreshOverlays() re-applies these on every reflow via
  // updateTextEditingChrome, so it needs the real originals rather than "" —
  // otherwise every overlay refresh during an edit clobbers the saved size
  // back to the "1px"/"1em" empty-text defaults.
  var activeTextEditOriginalMinWidth = "";
  var activeTextEditOriginalMinHeight = "";
  // Module-level ref to the in-flight text edit session's finish() closure
  // (T4). replaceRuntimeDocument (forceFullDocument path, e.g. HMR/localhost
  // reload) must commit or discard the active edit through the same path a
  // user Escape/blur would use — removing its listeners and clearing overlay
  // chrome — instead of only resetting the activeTextEditEl variable, which
  // left the session's keydown/blur/paste/input/selectionchange listeners
  // (including a document-level "selectionchange" listener) attached forever.
  var finishActiveTextEdit: ((commit: boolean) => void) | null = null;
  // Buffered runtime-content-update payload dropped while a text edit session
  // is active (T13). replaceRuntimeDocument silently no-ops non-force updates
  // during an edit (so the user's in-progress typing isn't yanked out from
  // under them), but the host's one-shot queue still marks the update as
  // applied. Without buffering, the canvas is left stale once the edit
  // session ends. We keep only the latest dropped payload — a newer update
  // supersedes an older one.
  var pendingRuntimeDocumentUpdate: {
    html: string;
    preferredSelector: string;
    selectorCandidates: string[];
  } | null = null;
  var textEditPointerState: {
    shield: string;
    selection: string;
    highlight: string;
  } | null = null;
  var pendingStructureMoves: Record<
    string,
    {
      requestId: string;
      el: Element;
      target: { anchor: Element; placement: string; axis?: string };
      origin: { prevParent: Element; prevNextSibling: Node | null } | null;
    }
  > = {};
  var pendingShieldDrag: {
    el: Element;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    requestId: string;
    offsetX: number;
    offsetY: number;
    originalPointerEvents: string;
    lastReorder: { anchor: Element; placement: string; axis?: string } | null;
  } | null = null;
  var suppressNextShieldClick = false;
  var suppressNextShieldClickTimer: ReturnType<typeof setTimeout> | null = null;
  var selectedSpacingHovered = false;
  var hoveredSpacingHandleKey = "";
  var spacingHoverClearTimer: ReturnType<typeof setTimeout> | null = null;
  var lastSpacingPointerPoint: { x: number; y: number } | null = null;
  var spacingHandleStateByKey: Record<string, { value: number }> = {};
  var spacingHandleNodesByKey: Record<string, Element> = {};
  var spacingHatchNodesByKey: Record<string, Element> = {};
  var spacingOverlayRenderKey = "";
  var activeDragCancel: (() => boolean) | null = null;
  var activeCrossScreenStyleSnapshot: unknown | undefined = undefined;
  var spacingDrag: {
    key: string;
    groupKey: string;
    property: string;
    oppositeProperty: string;
    side: string;
    orientation: string;
    baseValue: number;
    baseOppositeValue: number;
    startX: number;
    startY: number;
    el: Element;
  } | null = null;
  var lockedSelectors: string[] = [];
  var hiddenSelectors: string[] = [];
  var lastEditorPointWasBlocked = false;

  function clearRuntimeSelection(): void {
    selectedEl = null;
    hoveredEl = null;
    setPassiveSelectionElements([]);
    clearSpacingHoverTimer();
    selectedSpacingHovered = false;
    hoveredSpacingHandleKey = "";
    lastSpacingPointerPoint = null;
    spacingDrag = null;
    hideSelectionOverlay();
    highlightOverlay.style.display = "none";
    marqueeSelectionOverlay.style.display = "none";
    clearActiveMarqueeSelection();
    hideSpacingOverlay();
    hideMeasurements();
  }

  function postEditorDragState(active: boolean): void {
    (window.parent as Window).postMessage(
      { type: "agent-native:editor-drag-state", active },
      "*",
    );
  }

  function setActiveDragCancel(cancel: () => boolean): void {
    activeDragCancel = cancel;
    postEditorDragState(true);
  }

  function clearActiveDragCancel(cancel?: () => boolean): void {
    if (cancel && activeDragCancel !== cancel) return;
    if (!activeDragCancel) return;
    activeDragCancel = null;
    postEditorDragState(false);
  }

  function cancelActiveBridgeDrag(): boolean {
    var cancel = activeDragCancel;
    if (!cancel) return false;
    activeDragCancel = null;
    postEditorDragState(false);
    return cancel();
  }

  function removePassiveSelectionOverlays(): void {
    passiveSelectionOverlays.forEach(function (overlay) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });
    passiveSelectionOverlays = [];
  }

  function appendPassiveSelectionHandles(overlay: HTMLElement): void {
    ["nw", "ne", "se", "sw"].forEach(function (pos) {
      var handle = document.createElement("span");
      handle.setAttribute(
        "data-agent-native-edit-overlay",
        "multi-selection-handle",
      );
      handle.setAttribute("data-corner", pos);
      handle.style.cssText =
        "position:absolute;z-index:1;width:7px;height:7px;border:1px solid var(--design-editor-accent-color);background:var(--design-editor-accent-contrast-color);box-sizing:border-box;border-radius:1px;pointer-events:none;";
      if (pos.indexOf("n") !== -1) handle.style.top = "-4px";
      if (pos.indexOf("s") !== -1) handle.style.bottom = "-4px";
      if (pos.indexOf("w") !== -1) handle.style.left = "-4px";
      if (pos.indexOf("e") !== -1) handle.style.right = "-4px";
      overlay.appendChild(handle);
    });
    scalePassiveSelectionOverlay(overlay);
  }

  function makePassiveSelectionOverlay(): HTMLElement {
    var overlay = document.createElement("div");
    overlay.setAttribute("data-agent-native-edit-overlay", "multi-selection");
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:99996;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;";
    appendPassiveSelectionHandles(overlay);
    document.body.appendChild(overlay);
    return overlay;
  }

  function scalePassiveSelectionOverlay(overlay: HTMLElement): void {
    var sx = chromeScaleX();
    var sy = chromeScaleY();
    var line = chromeLineScale();
    overlay.style.borderWidth = 1.5 * line + "px";
    overlay
      .querySelectorAll(
        "[data-agent-native-edit-overlay='multi-selection-handle']",
      )
      .forEach(function (handle) {
        var pos = handle.getAttribute("data-corner") || "";
        handle.style.width = 7 * sx + "px";
        handle.style.height = 7 * sy + "px";
        handle.style.borderWidth = 1 * line + "px";
        if (pos.indexOf("n") !== -1) handle.style.top = -4 * sy + "px";
        if (pos.indexOf("s") !== -1) handle.style.bottom = -4 * sy + "px";
        if (pos.indexOf("w") !== -1) handle.style.left = -4 * sx + "px";
        if (pos.indexOf("e") !== -1) handle.style.right = -4 * sx + "px";
      });
  }

  function setPassiveSelectionElements(elements: Element[]): void {
    passiveSelectionEls = elements.filter(function (el, index, all) {
      return (
        el &&
        el !== selectedEl &&
        document.documentElement.contains(el) &&
        all.indexOf(el) === index
      );
    });
    removePassiveSelectionOverlays();
    passiveSelectionEls.forEach(function (el) {
      var overlay = makePassiveSelectionOverlay();
      passiveSelectionOverlays.push(overlay);
      positionOverlay(overlay, el);
    });
  }

  function preservePreviousSelectedElementForShiftClick(
    previous: Element | null,
    next: Element | null,
    e?: MouseEvent,
  ): void {
    if (
      !e?.shiftKey ||
      !previous ||
      !next ||
      previous === next ||
      !document.documentElement.contains(previous) ||
      isLayerInteractionBlocked(previous)
    ) {
      return;
    }
    setPassiveSelectionElements([previous].concat(passiveSelectionEls));
  }

  function matchesSelectorList(
    el: Element | null,
    selectors: string[],
  ): boolean {
    if (!el || !selectors || selectors.length === 0) return false;
    for (var i = 0; i < selectors.length; i += 1) {
      try {
        if (el.matches(selectors[i]) || el.closest(selectors[i])) return true;
      } catch (_err) {}
    }
    return false;
  }

  function matchesExactSelectorList(
    el: Element | null,
    selectors: string[],
  ): boolean {
    if (!el || !selectors || selectors.length === 0) return false;
    for (var i = 0; i < selectors.length; i += 1) {
      try {
        if (el.matches(selectors[i])) return true;
      } catch (_err) {}
    }
    return false;
  }

  function isLayerInteractionBlocked(el: Element | null): boolean {
    if (!el) return false;
    if (
      el.closest &&
      el.closest(
        '[data-agent-native-locked="true"], [data-agent-native-hidden="true"]',
      )
    ) {
      return true;
    }
    return (
      matchesSelectorList(el, lockedSelectors) ||
      matchesSelectorList(el, hiddenSelectors)
    );
  }

  function applyHiddenSelectors(): void {
    document
      .querySelectorAll("[data-agent-native-runtime-hidden]")
      .forEach(function (el: HTMLElement) {
        var previous = el.getAttribute("data-agent-native-previous-display");
        if (previous === null) {
          el.style.removeProperty("display");
        } else {
          el.style.display = previous;
        }
        el.removeAttribute("data-agent-native-runtime-hidden");
        el.removeAttribute("data-agent-native-previous-display");
      });
    hiddenSelectors.forEach(function (selector) {
      try {
        document.querySelectorAll(selector).forEach(function (el) {
          if (!el.hasAttribute("data-agent-native-runtime-hidden")) {
            el.setAttribute(
              "data-agent-native-previous-display",
              el.style.display || "",
            );
          }
          el.setAttribute("data-agent-native-runtime-hidden", "true");
          el.style.display = "none";
        });
      } catch (_err) {}
    });
  }

  function replaceRuntimeDocument(
    html: string,
    preferredSelector: string,
    selectorCandidates: string[],
    forceFullDocument?: boolean,
  ): void {
    if (typeof html !== "string") return;
    if (activeTextEditEl && !forceFullDocument) {
      // Don't yank a runtime content update out from under an in-progress
      // text edit — but don't silently lose it either (T13). Buffer only the
      // latest payload; it is applied once the edit session ends via
      // finishActiveTextEdit's replay below.
      pendingRuntimeDocumentUpdate = {
        html: html,
        preferredSelector: preferredSelector,
        selectorCandidates: Array.isArray(selectorCandidates)
          ? selectorCandidates
          : [],
      };
      applyHiddenSelectors();
      refreshOverlays();
      return;
    }
    if (activeTextEditEl) {
      // Commit (or discard, if empty) the active edit through the same path
      // Escape/blur would use — this removes the session's listeners
      // (including the document-level "selectionchange" listener) instead of
      // just resetting activeTextEditEl, which leaked them (T4).
      if (finishActiveTextEdit) {
        finishActiveTextEdit(true);
      } else {
        postTextEditingState(activeTextEditEl, false);
        activeTextEditEl = null;
        setTextEditingPointerPassthrough(false);
        setSelectionOverlayResizeChromeVisible(true);
      }
    }
    var parser = new DOMParser();
    var nextDoc = parser.parseFromString(html, "text/html");
    if (!nextDoc || !nextDoc.body) return;

    var persistentNodes = Array.prototype.slice.call(
      document.querySelectorAll("[data-agent-native-edit-overlay]"),
    );
    var activeSelector =
      preferredSelector || (selectedEl ? getSelector(selectedEl) : "");
    var activeCandidates: string[] = [];
    if (Array.isArray(selectorCandidates)) {
      selectorCandidates.forEach(function (selector) {
        if (
          typeof selector === "string" &&
          selector &&
          activeCandidates.indexOf(selector) === -1
        ) {
          activeCandidates.push(selector);
        }
      });
    }
    if (activeSelector && activeCandidates.indexOf(activeSelector) === -1) {
      activeCandidates.push(activeSelector);
    }

    var nextHeadHtml = nextDoc.head ? nextDoc.head.innerHTML : "";
    ensureEditorChromeStyle();
    var currentHeadHtml = runtimeHeadHtmlWithoutEditorChrome();
    if (nextHeadHtml === currentHeadHtml && activeCandidates.length > 0) {
      var currentMatch = null;
      var nextMatch = null;
      var matchedSelector = "";
      var fallbackCurrentMatch = null;
      var fallbackSelector = "";
      for (
        var matchIndex = 0;
        matchIndex < activeCandidates.length;
        matchIndex += 1
      ) {
        try {
          var currentCandidate = document.querySelector(
            activeCandidates[matchIndex],
          );
          var nextCandidate = nextDoc.querySelector(
            activeCandidates[matchIndex],
          );
          if (currentCandidate && !fallbackCurrentMatch) {
            fallbackCurrentMatch = currentCandidate;
            fallbackSelector = activeCandidates[matchIndex];
          }
          if (currentCandidate && nextCandidate) {
            currentMatch = currentCandidate;
            nextMatch = nextCandidate;
            matchedSelector = activeCandidates[matchIndex];
            break;
          }
        } catch (_err) {
          // Keep trying later aliases; bridge selectors can differ between
          // runtime and DOMParser passes.
        }
      }
      if (!currentMatch && fallbackCurrentMatch) {
        currentMatch = fallbackCurrentMatch;
        matchedSelector = fallbackSelector;
      }
      if (
        currentMatch &&
        currentMatch !== document.body &&
        currentMatch !== document.documentElement &&
        !isOverlayElement(currentMatch)
      ) {
        if (nextMatch) {
          currentMatch.replaceWith(document.importNode(nextMatch, true));
        } else if (
          currentMatch !== document.body &&
          currentMatch !== document.documentElement
        ) {
          if (
            currentMatch.parentNode &&
            currentMatch.parentNode.contains(currentMatch)
          ) {
            currentMatch.remove();
          }
        }
        applyHiddenSelectors();
        selectedEl = null;
        if (nextMatch) {
          try {
            selectedEl = document.querySelector(matchedSelector);
          } catch (_err) {}
        }
        hoveredEl = null;
        if (selectedEl && !isLayerInteractionBlocked(selectedEl)) {
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
        } else {
          hideSelectionOverlay();
        }
        highlightOverlay.style.display = "none";
        hideMeasurements();
        refreshOverlays();
        return;
      }
    }
    if (currentHeadHtml !== nextHeadHtml) {
      document.head.innerHTML = nextHeadHtml;
      ensureEditorChromeStyle();
    }
    Array.prototype.slice.call(document.body.attributes).forEach(function (
      attribute: Attr,
    ) {
      document.body.removeAttribute(attribute.name);
    });
    Array.prototype.slice.call(nextDoc.body.attributes).forEach(function (
      attribute: Attr,
    ) {
      document.body.setAttribute(attribute.name, attribute.value);
    });
    document.body.innerHTML = nextDoc.body.innerHTML;
    persistentNodes.forEach(function (node) {
      document.body.appendChild(node);
    });
    applyHiddenSelectors();

    selectedEl = null;
    hoveredEl = null;
    for (var i = 0; i < activeCandidates.length && !selectedEl; i += 1) {
      try {
        var match = document.querySelector(activeCandidates[i]);
        // Skip the editor's own injected overlay chrome and re-anchor to a
        // source-backed element. A stale positional candidate like
        // body > div:nth-of-type(6) can otherwise re-match an overlay div
        // (the only direct div children of body at runtime), which then has
        // no code-layer node and fails every edit.
        if (
          match &&
          !isLayerInteractionBlocked(match) &&
          !isOverlayElement(match)
        ) {
          selectedEl = selectionTargetForHit(match) || match;
        }
      } catch (_err) {}
    }
    if (selectedEl) {
      positionOverlay(selectionOverlay, selectedEl);
      postElementSelect(selectedEl);
    } else {
      hideSelectionOverlay();
    }
    highlightOverlay.style.display = "none";
    hideMeasurements();
    refreshOverlays();
  }

  function hideSpacingOverlay(): void {
    spacingOverlay.style.display = "none";
    spacingOverlay.innerHTML = "";
    spacingHandleStateByKey = {};
    spacingHandleNodesByKey = {};
    spacingHatchNodesByKey = {};
    spacingOverlayRenderKey = "";
    if (!spacingDrag) spacingBadge.style.display = "none";
  }

  function clearSpacingHoverTimer(): void {
    if (spacingHoverClearTimer !== null) {
      clearTimeout(spacingHoverClearTimer);
      spacingHoverClearTimer = null;
    }
  }

  function visibleLayoutChildren(el: Element | null): Element[] {
    if (!el || !el.children) return [];
    return Array.prototype.slice.call(el.children).filter(function (child) {
      if (
        !child ||
        child.nodeType !== 1 ||
        isOverlayElement(child) ||
        isLayerInteractionBlocked(child)
      )
        return false;
      var cs = window.getComputedStyle(child);
      if (
        cs.display === "none" ||
        cs.visibility === "hidden" ||
        cs.position === "fixed"
      )
        return false;
      var rect = child.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function spacingColor(kind: string): string {
    return kind === "gap" ? "#ff4fd8" : "var(--design-editor-accent-color)";
  }

  function spacingFill(kind: string, orientation: string): string {
    var tint =
      kind === "gap" ? "rgba(255, 79, 216, 0.28)" : "rgba(46, 168, 255, 0.24)";
    var stripe =
      kind === "gap" ? "rgba(255, 79, 216, 0.58)" : "rgba(46, 168, 255, 0.52)";
    var angle = orientation === "vertical" ? "135deg" : "45deg";
    // Constant-screen-size chrome: stripe density compensates for the host's
    // iframe scale so the hatch pattern reads identically at any canvas zoom
    // instead of blurring together at low zoom.
    var scale = chromeLineScale();
    return (
      "repeating-linear-gradient(" +
      angle +
      ", " +
      stripe +
      " 0 " +
      1 * scale +
      "px, " +
      tint +
      " " +
      1 * scale +
      "px " +
      4 * scale +
      "px, transparent " +
      4 * scale +
      "px " +
      7 * scale +
      "px)"
    );
  }

  function clampSpacingValue(value: number): number {
    var rounded = Math.round(value);
    if (!Number.isFinite(rounded)) return 0;
    return Math.max(0, Math.min(999, rounded));
  }

  // Figma-style handle hit area: only the small handle *line* itself (plus a
  // few px of pointer tolerance) should start a padding drag. The rest of the
  // padding band must fall through to normal element move/select — dragging
  // anywhere else inside the element (even inside the padding region) moves
  // the element, it does not resize padding. Gap handles keep the previous
  // full-region hit area (out of scope for this fix; not covered by the
  // reported UX regression). Base tolerance is in editor-chrome (unscaled)
  // pixels; callers multiply by chromeLineScale() so the hit area keeps a
  // constant on-screen size regardless of canvas zoom, matching how the
  // handle line's own thickness (chromeLineScale()) is derived.
  var PADDING_HANDLE_HIT_TOLERANCE_BASE = 4;

  function hitRectForPaddingHandle(
    line: { x: number; y: number; width: number; height: number } | undefined,
    region: { x: number; y: number; width: number; height: number },
    tolerance: number,
  ): { x: number; y: number; width: number; height: number } {
    if (!line) return region;
    var minX = Math.min(line.x, region.x);
    var minY = Math.min(line.y, region.y);
    var maxX = Math.max(line.x + line.width, region.x + region.width);
    var maxY = Math.max(line.y + line.height, region.y + region.height);
    // Only the line itself matters for hit-testing; expand just the line's own
    // rect by the tolerance, then clamp to the padding region bounds so the
    // hit area never spills outside the visual padding band.
    var hitX = Math.max(minX, line.x - tolerance);
    var hitY = Math.max(minY, line.y - tolerance);
    var hitRight = Math.min(maxX, line.x + line.width + tolerance);
    var hitBottom = Math.min(maxY, line.y + line.height + tolerance);
    return {
      x: hitX,
      y: hitY,
      width: Math.max(1, hitRight - hitX),
      height: Math.max(1, hitBottom - hitY),
    };
  }

  function makeSpacingHandle(config: {
    key: string;
    groupKey?: string;
    kind: string;
    property: string;
    oppositeProperty?: string;
    side?: string;
    orientation: string;
    value: number;
    region: { x: number; y: number; width: number; height: number };
    line?: { x: number; y: number; width: number; height: number };
  }): unknown {
    var region = config.region;
    if (!region || region.width <= 0 || region.height <= 0) return null;
    var roundedRegion = {
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.max(1, Math.round(region.width)),
      height: Math.max(1, Math.round(region.height)),
    };
    var hit =
      config.kind === "padding"
        ? hitRectForPaddingHandle(
            config.line,
            roundedRegion,
            PADDING_HANDLE_HIT_TOLERANCE_BASE * chromeLineScale(),
          )
        : roundedRegion;
    return {
      key: config.key,
      groupKey: config.groupKey || config.key,
      kind: config.kind,
      property: config.property,
      oppositeProperty: config.oppositeProperty || "",
      side: config.side || "",
      orientation: config.orientation,
      value: clampSpacingValue(config.value),
      region: roundedRegion,
      hit: hit,
      line: config.line,
    };
  }

  function childLocalRect(
    child: Element,
    containerRect: DOMRect | { left: number; top: number },
  ): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } {
    var rect = child.getBoundingClientRect();
    return {
      left: rect.left - containerRect.left,
      top: rect.top - containerRect.top,
      right: rect.right - containerRect.left,
      bottom: rect.bottom - containerRect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function childRectsOverlap(
    a: { top: number; bottom: number; left: number; right: number },
    b: { top: number; bottom: number; left: number; right: number },
    axis: string,
  ): boolean {
    if (axis === "x") {
      return Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
    }
    return Math.max(a.left, b.left) < Math.min(a.right, b.right);
  }

  function buildPaddingSpacingHandles(
    el: Element,
    rect: DOMRect,
    cs: CSSStyleDeclaration,
  ): unknown[] {
    var handles = [];
    var borderTop = readPx(cs.borderTopWidth);
    var borderRight = readPx(cs.borderRightWidth);
    var borderBottom = readPx(cs.borderBottomWidth);
    var borderLeft = readPx(cs.borderLeftWidth);
    var paddingTop = readPx(cs.paddingTop);
    var paddingRight = readPx(cs.paddingRight);
    var paddingBottom = readPx(cs.paddingBottom);
    var paddingLeft = readPx(cs.paddingLeft);
    var sx = chromeScaleX();
    var sy = chromeScaleY();
    var line = chromeLineScale();
    var hLineWidth = Math.max(6, Math.min(18, rect.width * 0.12)) * sx;
    var vLineHeight = Math.max(6, Math.min(18, rect.height * 0.12)) * sy;
    var innerLeft = borderLeft;
    var innerTop = borderTop;
    var innerWidth = Math.max(1, rect.width - borderLeft - borderRight);
    var innerHeight = Math.max(1, rect.height - borderTop - borderBottom);
    if (paddingTop > 0) {
      handles.push(
        makeSpacingHandle({
          key: "padding:top",
          kind: "padding",
          property: "paddingTop",
          oppositeProperty: "paddingBottom",
          side: "top",
          orientation: "horizontal",
          value: paddingTop,
          region: {
            x: innerLeft,
            y: innerTop,
            width: innerWidth,
            height: paddingTop,
          },
          line: {
            x: rect.width / 2 - hLineWidth / 2,
            y: innerTop + paddingTop / 2 - line / 2,
            width: hLineWidth,
            height: line,
          },
        }),
      );
    }
    if (paddingBottom > 0) {
      handles.push(
        makeSpacingHandle({
          key: "padding:bottom",
          kind: "padding",
          property: "paddingBottom",
          oppositeProperty: "paddingTop",
          side: "bottom",
          orientation: "horizontal",
          value: paddingBottom,
          region: {
            x: innerLeft,
            y: rect.height - borderBottom - paddingBottom,
            width: innerWidth,
            height: paddingBottom,
          },
          line: {
            x: rect.width / 2 - hLineWidth / 2,
            y: rect.height - borderBottom - paddingBottom / 2 - line / 2,
            width: hLineWidth,
            height: line,
          },
        }),
      );
    }
    if (paddingLeft > 0) {
      handles.push(
        makeSpacingHandle({
          key: "padding:left",
          kind: "padding",
          property: "paddingLeft",
          oppositeProperty: "paddingRight",
          side: "left",
          orientation: "vertical",
          value: paddingLeft,
          region: {
            x: innerLeft,
            y: innerTop,
            width: paddingLeft,
            height: innerHeight,
          },
          line: {
            x: innerLeft + paddingLeft / 2 - line / 2,
            y: rect.height / 2 - vLineHeight / 2,
            width: line,
            height: vLineHeight,
          },
        }),
      );
    }
    if (paddingRight > 0) {
      handles.push(
        makeSpacingHandle({
          key: "padding:right",
          kind: "padding",
          property: "paddingRight",
          oppositeProperty: "paddingLeft",
          side: "right",
          orientation: "vertical",
          value: paddingRight,
          region: {
            x: rect.width - borderRight - paddingRight,
            y: innerTop,
            width: paddingRight,
            height: innerHeight,
          },
          line: {
            x: rect.width - borderRight - paddingRight / 2 - line / 2,
            y: rect.height / 2 - vLineHeight / 2,
            width: line,
            height: vLineHeight,
          },
        }),
      );
    }
    return handles.filter(Boolean);
  }

  function buildGapSpacingHandles(
    el: Element,
    rect: DOMRect,
    cs: CSSStyleDeclaration,
  ): unknown[] {
    var children = visibleLayoutChildren(el);
    if (children.length < 2) return [];
    var handles = [];
    var sx = chromeScaleX();
    var sy = chromeScaleY();
    var line = chromeLineScale();
    var hLineWidth = 8 * sx;
    var vLineHeight = 8 * sy;
    var isFlex = cs.display === "flex" || cs.display === "inline-flex";
    var isGrid = cs.display === "grid" || cs.display === "inline-grid";
    if (!isFlex && !isGrid) return handles;
    var primaryAxis =
      isFlex && cs.flexDirection && cs.flexDirection.indexOf("column") === 0
        ? "y"
        : "x";
    var childRects = children.map(function (child) {
      return childLocalRect(child, rect);
    });

    function addAxisGaps(axis, property, groupKey) {
      var cssGap = readPx(cs[property]);
      if (cssGap <= 0) return;
      var sorted = childRects.slice().sort(function (a, b) {
        return axis === "x" ? a.left - b.left : a.top - b.top;
      });
      var count = 0;
      for (var i = 0; i < sorted.length - 1; i += 1) {
        var a = sorted[i];
        var b = sorted[i + 1];
        if (!childRectsOverlap(a, b, axis)) continue;
        var gap = axis === "x" ? b.left - a.right : b.top - a.bottom;
        if (gap <= 1) continue;
        if (axis === "x") {
          var top = Math.max(a.top, b.top);
          var bottom = Math.min(a.bottom, b.bottom);
          var height = Math.max(1, bottom - top);
          handles.push(
            makeSpacingHandle({
              key: groupKey + ":" + count,
              groupKey: groupKey,
              kind: "gap",
              property: property,
              orientation: "vertical",
              value: cssGap,
              region: { x: a.right, y: top, width: gap, height: height },
              line: {
                x: a.right + gap / 2 - line / 2,
                y: top + height / 2 - vLineHeight / 2,
                width: line,
                height: vLineHeight,
              },
            }),
          );
        } else {
          var left = Math.max(a.left, b.left);
          var right = Math.min(a.right, b.right);
          var width = Math.max(1, right - left);
          handles.push(
            makeSpacingHandle({
              key: groupKey + ":" + count,
              groupKey: groupKey,
              kind: "gap",
              property: property,
              orientation: "horizontal",
              value: cssGap,
              region: { x: left, y: a.bottom, width: width, height: gap },
              line: {
                x: left + width / 2 - hLineWidth / 2,
                y: a.bottom + gap / 2 - line / 2,
                width: hLineWidth,
                height: line,
              },
            }),
          );
        }
        count += 1;
      }
    }

    if (primaryAxis === "x") {
      addAxisGaps("x", "columnGap", "gap:column");
      if (isGrid) addAxisGaps("y", "rowGap", "gap:row");
    } else {
      addAxisGaps("y", "rowGap", "gap:row");
      if (isGrid) addAxisGaps("x", "columnGap", "gap:column");
    }
    return handles.filter(Boolean);
  }

  function buildSpacingHandles(el: Element | null): ({
    key: string;
    groupKey: string;
    kind: string;
    property: string;
    oppositeProperty: string;
    side: string;
    orientation: string;
    value: number;
    region: { x: number; y: number; width: number; height: number };
    line: { x: number; y: number; width: number; height: number } | undefined;
  } | null)[] {
    if (!el || !document.documentElement.contains(el)) return [];
    if (Math.abs(currentRotation(el)) > 0.01) return [];
    var children = visibleLayoutChildren(el);
    if (children.length === 0) return [];
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    var cs = window.getComputedStyle(el);
    return buildPaddingSpacingHandles(el, rect, cs).concat(
      buildGapSpacingHandles(el, rect, cs),
    );
  }

  // Figma-style live value readout for the padding handle: shown while
  // hovering OR dragging the handle line, positioned ~12px above and to the
  // right of the pointer (matching showTransformBadge's cursor-relative
  // offset idiom, but anchored to the badge's bottom-left corner via
  // translateY(-100%) so the box actually sits above the cursor instead of
  // growing downward through it) and live-updating as the value changes.
  // Falls back to the handle-region center when no cursor point is known yet
  // (e.g. a hover activated programmatically rather than by a pointer move).
  function showSpacingBadgeForHandle(
    handle: {
      key: string;
      groupKey: string;
      kind: string;
      property: string;
      oppositeProperty: string;
      side: string;
      orientation: string;
      value: number;
      region: { x: number; y: number; width: number; height: number };
      line: { x: number; y: number; width: number; height: number } | undefined;
    } | null,
    value: number,
    cursorPoint?: { x: number; y: number } | null,
  ): void {
    if (!selectedEl || !handle) {
      spacingBadge.style.display = "none";
      return;
    }
    // Constant-screen-size chrome: the host CSS-scales this iframe by the
    // canvas zoom, so every intrinsic size here (font, padding, radius,
    // cursor offset) multiplies by chromeLineScale() to render at the same
    // apparent size at any zoom — the badge was previously unscaled, which
    // made it microscopic at low overview zooms (the "value box never
    // appears" report) and oversized when zoomed in.
    var line = chromeLineScale();
    var point = cursorPoint || lastSpacingPointerPoint;
    var x: number;
    var y: number;
    if (point) {
      x = point.x + 12 * line;
      y = point.y - 12 * line;
    } else {
      var rect = selectedEl.getBoundingClientRect();
      x = rect.left + handle.region.x + handle.region.width / 2;
      y = rect.top + handle.region.y + handle.region.height / 2;
    }
    spacingBadge.textContent = String(clampSpacingValue(value)) + "px";
    spacingBadge.style.display = "block";
    spacingBadge.style.background = spacingColor(handle.kind);
    spacingBadge.style.fontSize = 10 * line + "px";
    spacingBadge.style.padding = 2 * line + "px " + 4 * line + "px";
    spacingBadge.style.borderRadius = 3 * line + "px";
    spacingBadge.style.left = x + "px";
    spacingBadge.style.top = y + "px";
    spacingBadge.style.transform = point
      ? "translateY(-100%)"
      : "translate(-50%, -50%)";
  }

  function renderSpacingHandle(
    handle: {
      key: string;
      groupKey: string;
      kind: string;
      property: string;
      oppositeProperty: string;
      side: string;
      orientation: string;
      value: number;
      region: { x: number; y: number; width: number; height: number };
      hit: { x: number; y: number; width: number; height: number };
      line: { x: number; y: number; width: number; height: number } | undefined;
    } | null,
    activeGroupKeys: Record<string, boolean>,
    hoverGroupKeys: Record<string, boolean>,
  ): void {
    if (!handle) return;
    spacingHandleStateByKey[handle.key] = handle;
    var active = Boolean(activeGroupKeys[handle.groupKey]);
    var hovered = Boolean(hoverGroupKeys[handle.groupKey]);
    var lineNode = document.createElement("span");
    lineNode.setAttribute("data-agent-native-spacing-line", handle.kind);
    lineNode.style.position = "absolute";
    lineNode.style.display = "block";
    lineNode.style.pointerEvents = "none";
    lineNode.style.borderRadius = "999px";
    lineNode.style.left = handle.line.x + "px";
    lineNode.style.top = handle.line.y + "px";
    // No 1px floor: at zoom > 100% the pill's thickness is intentionally
    // sub-1px in iframe space (thickness * host scale = constant screen px).
    lineNode.style.width = handle.line.width + "px";
    lineNode.style.height = handle.line.height + "px";
    lineNode.style.background = spacingColor(handle.kind);
    spacingOverlay.appendChild(lineNode);

    // Visual-only hatch band over the full padding region. Purely decorative
    // (pointer-events: none) — it must never intercept clicks, since only the
    // small hit node below is allowed to start a padding drag. Hatch is a
    // hover affordance only: it shows the band the user is about to resize,
    // and disappears the instant a drag starts (kind === "padding" only, per
    // the reported regression; gap handles are out of scope for this fix).
    // Constant-screen-size chrome: tile the hatch pattern at a size that
    // compensates for the host's iframe scale (matches spacingFill's scaled
    // stripe stops — a fixed 6px tile would clip the scaled pattern).
    var hatchTile = 6 * chromeLineScale() + "px";
    if (handle.kind === "padding") {
      var hatchNode = document.createElement("span");
      hatchNode.setAttribute("data-agent-native-spacing-hatch", handle.kind);
      hatchNode.style.position = "absolute";
      hatchNode.style.display = "block";
      hatchNode.style.boxSizing = "border-box";
      hatchNode.style.pointerEvents = "none";
      hatchNode.style.backgroundSize = hatchTile + " " + hatchTile;
      hatchNode.style.left = handle.region.x + "px";
      hatchNode.style.top = handle.region.y + "px";
      hatchNode.style.width = handle.region.width + "px";
      hatchNode.style.height = handle.region.height + "px";
      hatchNode.style.background = hovered
        ? spacingFill(handle.kind, handle.orientation)
        : "transparent";
      spacingHatchNodesByKey[handle.key] = hatchNode;
      spacingOverlay.appendChild(hatchNode);
    }

    var regionNode = document.createElement("span");
    regionNode.setAttribute("data-agent-native-spacing-region", handle.kind);
    regionNode.setAttribute("data-orientation", handle.orientation);
    regionNode.setAttribute("data-spacing-key", handle.key);
    regionNode.style.position = "absolute";
    regionNode.style.display = "block";
    regionNode.style.boxSizing = "border-box";
    regionNode.style.pointerEvents = "auto";
    regionNode.style.backgroundSize = hatchTile + " " + hatchTile;
    regionNode.style.cursor =
      handle.orientation === "vertical" ? "ew-resize" : "ns-resize";
    var hitRect = handle.kind === "padding" ? handle.hit : handle.region;
    regionNode.style.left = hitRect.x + "px";
    regionNode.style.top = hitRect.y + "px";
    regionNode.style.width = hitRect.width + "px";
    regionNode.style.height = hitRect.height + "px";
    // The gap-handle band keeps its previous always-tintable full-region
    // background (unaffected by this fix); padding handles no longer paint
    // the hatch on this node — buildSpacingHandles' dedicated hatchNode above
    // owns that so it can stay outside the (now much smaller) hit area.
    regionNode.style.background =
      handle.kind !== "padding" && active
        ? spacingFill(handle.kind, handle.orientation)
        : "transparent";
    regionNode.style.outline =
      handle.kind !== "padding" && active
        ? "1px solid " + spacingColor(handle.kind)
        : "0";
    regionNode.style.outlineOffset = "-1px";
    regionNode.addEventListener(
      "pointerdown",
      function (event) {
        activateSpacingHandle(handle.key);
        startSpacingDrag(handle.key, event);
      },
      true,
    );
    regionNode.addEventListener(
      "mousedown",
      function (event) {
        startSpacingDrag(handle.key, event);
      },
      true,
    );
    spacingHandleNodesByKey[handle.key] = regionNode;
    spacingOverlay.appendChild(regionNode);
  }

  function updateSpacingHandleHighlights(
    handles: ({
      key: string;
      groupKey: string;
      kind: string;
      property?: string;
      orientation: string;
    } | null)[],
    activeGroupKeys: Record<string, boolean>,
    hoverGroupKeys: Record<string, boolean>,
  ): void {
    handles.forEach(function (handle) {
      if (!handle) return;
      var active = Boolean(activeGroupKeys[handle.groupKey]);
      var hovered = Boolean(hoverGroupKeys[handle.groupKey]);
      var regionNode = spacingHandleNodesByKey[handle.key];
      if (regionNode) {
        var gapHighlighted = handle.kind !== "padding" && active;
        (regionNode as HTMLElement).style.background = gapHighlighted
          ? spacingFill(handle.kind, handle.orientation)
          : "transparent";
        (regionNode as HTMLElement).style.outline = gapHighlighted
          ? "1px solid " + spacingColor(handle.kind)
          : "0";
      }
      var hatchNode = spacingHatchNodesByKey[handle.key];
      if (hatchNode) {
        (hatchNode as HTMLElement).style.background = hovered
          ? spacingFill(handle.kind, handle.orientation)
          : "transparent";
      }
    });
  }

  function activeSpacingGroupKeys(
    handles: ({
      groupKey: string;
      kind: string;
      property: string;
    } | null)[],
    activeHandle: {
      groupKey: string;
      kind: string;
      oppositeProperty: string;
    } | null,
  ): Record<string, boolean> {
    var activeGroupKeys: Record<string, boolean> = {};
    if (!activeHandle) return activeGroupKeys;
    activeGroupKeys[activeHandle.groupKey] = true;
    if (
      spacingDrag &&
      spacingDrag.mirrorOpposite &&
      activeHandle.kind === "padding" &&
      activeHandle.oppositeProperty
    ) {
      handles.forEach(function (handle) {
        if (!handle) return;
        if (handle.property === activeHandle.oppositeProperty) {
          activeGroupKeys[handle.groupKey] = true;
        }
      });
    }
    return activeGroupKeys;
  }

  // Figma-parity: the diagonal hatch fill over the padding band is a
  // hover-only VISUAL affordance layered on top of handles that are always
  // mounted and hit-testable for the selected element (mounting itself is
  // never gated on hover — see buildSpacingHandles/renderSpacingHandle, which
  // render every handle unconditionally). The hatch must be visible while the
  // pointer rests over the handle line (so the user can see the full padding
  // band they are about to resize) and hidden the instant an actual drag
  // starts — during the drag only the live value badge communicates the
  // current amount. This is intentionally a separate concept from
  // activeSpacingGroupKeys (which mirrors the opposite side during an
  // alt-drag and still applies while dragging) — hover-hatch and drag-mirror
  // never overlap in time because a drag suppresses hover state (see
  // startSpacingDrag).
  function hoverSpacingGroupKeys(
    handles: ({
      key: string;
      groupKey: string;
    } | null)[],
  ): Record<string, boolean> {
    var hoverGroupKeys: Record<string, boolean> = {};
    if (spacingDrag) return hoverGroupKeys;
    var hoveredKey = hoveredSpacingHandleKey;
    if (!hoveredKey) return hoverGroupKeys;
    var handleByKey: Record<string, { groupKey: string }> = {};
    handles.forEach(function (handle) {
      if (!handle) return;
      handleByKey[handle.key] = handle;
    });
    var hoveredHandle = handleByKey[hoveredKey];
    if (hoveredHandle) hoverGroupKeys[hoveredHandle.groupKey] = true;
    return hoverGroupKeys;
  }

  function updateSpacingOverlay(el: Element | null): void {
    if (el && el !== selectedEl) {
      hideSpacingOverlay();
      return;
    }
    if (!selectedEl || !document.documentElement.contains(selectedEl)) {
      hideSpacingOverlay();
      return;
    }
    var handles = buildSpacingHandles(selectedEl);
    if (handles.length === 0) {
      hideSpacingOverlay();
      return;
    }
    var activeHandle = spacingDrag ? spacingDrag.handle : null;
    var activeGroupKeys = activeSpacingGroupKeys(handles, activeHandle);
    var hoverGroupKeys = hoverSpacingGroupKeys(handles);
    var badgeHandle =
      activeHandle || (spacingDrag ? null : hoveredHandleFor(handles));
    var nextRenderKey = handles
      .map(function (handle) {
        return [
          handle.key,
          handle.value,
          handle.region.x,
          handle.region.y,
          handle.region.width,
          handle.region.height,
          handle.line.x,
          handle.line.y,
          handle.line.width,
          handle.line.height,
        ].join(",");
      })
      .join("|");
    if (
      spacingOverlay.style.display === "block" &&
      spacingOverlayRenderKey === nextRenderKey
    ) {
      updateSpacingHandleHighlights(handles, activeGroupKeys, hoverGroupKeys);
      if (badgeHandle) {
        showSpacingBadgeForHandle(
          badgeHandle,
          activeHandle && spacingDrag
            ? spacingDrag.currentValue
            : badgeHandle.value,
        );
      } else {
        spacingBadge.style.display = "none";
      }
      return;
    }
    spacingOverlayRenderKey = nextRenderKey;
    spacingOverlay.style.display = "block";
    spacingOverlay.innerHTML = "";
    spacingHandleStateByKey = {};
    spacingHandleNodesByKey = {};
    spacingHatchNodesByKey = {};
    handles.forEach(function (handle) {
      renderSpacingHandle(handle, activeGroupKeys, hoverGroupKeys);
    });
    if (badgeHandle) {
      showSpacingBadgeForHandle(
        badgeHandle,
        activeHandle && spacingDrag
          ? spacingDrag.currentValue
          : badgeHandle.value,
      );
    } else {
      spacingBadge.style.display = "none";
    }
  }

  // Resolves the handle object matching hoveredSpacingHandleKey, if any — used
  // to keep the value badge visible on hover (not just during an active drag)
  // per the padding-handle UX fix: hovering the handle line shows the live
  // "Npx" readout, dragging keeps showing it with the in-progress value. Note
  // this only affects which handle drives the *badge* — every handle stays
  // mounted/hit-testable regardless of hover (see buildSpacingHandles).
  function hoveredHandleFor(
    handles: ({ key: string } | null)[],
  ): { key: string } | null {
    var hoveredKey = hoveredSpacingHandleKey;
    if (!hoveredKey) return null;
    var handleByKey: Record<string, { key: string }> = {};
    handles.forEach(function (handle) {
      if (!handle) return;
      handleByKey[handle.key] = handle;
    });
    return handleByKey[hoveredKey] || null;
  }

  function spacingKeyFromTarget(target: Element | null): string {
    var region =
      target && target.closest
        ? target.closest("[data-agent-native-spacing-region]")
        : null;
    return region && region.getAttribute
      ? region.getAttribute("data-spacing-key") || ""
      : "";
  }

  function setHoverToSelectedElementFromSpacingSurface(): void {
    if (!selectedEl || !document.documentElement.contains(selectedEl)) return;
    var changed = hoveredEl !== selectedEl;
    hoveredEl = selectedEl;
    highlightOverlay.style.display = "none";
    hideMeasurements();
    if (changed) {
      (window.parent as Window).postMessage(
        { type: "element-hover", payload: getLightElementInfo(selectedEl) },
        "*",
      );
    }
  }

  function activateSpacingHandle(spacingKey: string): void {
    if (!spacingKey) return;
    clearSpacingHoverTimer();
    selectedSpacingHovered = true;
    setHoverToSelectedElementFromSpacingSurface();
    if (
      hoveredSpacingHandleKey !== spacingKey ||
      spacingOverlay.style.display !== "block"
    ) {
      hoveredSpacingHandleKey = spacingKey;
      updateSpacingOverlay(selectedEl);
    }
  }

  function handleSpacingOverlayPointerMove(e: PointerEvent): void {
    if (spacingDrag) return;
    lastSpacingPointerPoint = { x: e.clientX, y: e.clientY };
    var spacingKey = spacingKeyFromTarget(
      e.target && e.target.nodeType === 1 ? e.target : null,
    );
    if (!spacingKey) return;
    stopNativeInteraction(e);
    activateSpacingHandle(spacingKey);
  }

  // Geometry-based fallback for the padding/gap handle hover: resolves the
  // handle whose hit rect (line + scaled tolerance zone) contains the given
  // client point, using the handle state captured at the last overlay
  // render. The event-target path above (spacingKeyFromTarget) only fires
  // when the pointermove's target IS the region node — which depends on
  // overlay z-order and event routing; this direct hit test makes the
  // hover badge reliable from the shield's pointermove too, so hovering
  // anywhere on the handle line (with its tolerance zone) always shows the
  // "Npx" value box.
  function spacingHandleKeyAtPoint(clientX: number, clientY: number): string {
    if (!selectedEl || !document.documentElement.contains(selectedEl)) {
      return "";
    }
    var rect = selectedEl.getBoundingClientRect();
    var localX = clientX - rect.left;
    var localY = clientY - rect.top;
    var keys = Object.keys(spacingHandleStateByKey);
    for (var i = 0; i < keys.length; i += 1) {
      var handle = spacingHandleStateByKey[keys[i]];
      if (!handle) continue;
      var hit = handle.hit || handle.region;
      if (!hit) continue;
      if (
        localX >= hit.x &&
        localX <= hit.x + hit.width &&
        localY >= hit.y &&
        localY <= hit.y + hit.height
      ) {
        return handle.key;
      }
    }
    return "";
  }

  function spacingRegionFromPoint(
    clientX: number,
    clientY: number,
  ): Element | null {
    var targets = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)];
    for (var i = 0; i < targets.length; i += 1) {
      var target = targets[i];
      if (!target || target.nodeType !== 1 || !target.closest) continue;
      var region = target.closest("[data-agent-native-spacing-region]");
      if (region) return region;
    }
    return null;
  }

  function selectedSpacingSurfaceContainsPoint(
    clientX: number,
    clientY: number,
  ): boolean {
    if (!selectedEl || !document.documentElement.contains(selectedEl))
      return false;
    var region = spacingRegionFromPoint(clientX, clientY);
    if (region) {
      var spacingKey = region.getAttribute
        ? region.getAttribute("data-spacing-key")
        : "";
      if (spacingKey) activateSpacingHandle(spacingKey);
      setHoverToSelectedElementFromSpacingSurface();
      return true;
    }
    var hit = elementFromEditorPoint(clientX, clientY);
    if (
      hit &&
      (hit === selectedEl || (selectedEl.contains && selectedEl.contains(hit)))
    ) {
      selectedSpacingHovered = true;
      return true;
    }
    return false;
  }

  function scheduleSpacingHoverClear(e: PointerEvent): void {
    if (spacingDrag) return;
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      lastSpacingPointerPoint = { x: e.clientX, y: e.clientY };
    }
    clearSpacingHoverTimer();
    spacingHoverClearTimer = setTimeout(function () {
      spacingHoverClearTimer = null;
      var point = lastSpacingPointerPoint;
      if (point && selectedSpacingSurfaceContainsPoint(point.x, point.y)) {
        updateSpacingOverlay(selectedEl);
        return;
      }
      selectedSpacingHovered = false;
      hoveredSpacingHandleKey = "";
      updateSpacingOverlay(selectedEl);
    }, 80);
  }

  function shouldKeepSpacingOverlayForLeave(e: PointerEvent): boolean {
    if (spacingDrag) return true;
    if (e.relatedTarget && isOverlayElement(e.relatedTarget)) return true;
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      return selectedSpacingSurfaceContainsPoint(e.clientX, e.clientY);
    }
    return false;
  }

  function applyEditorChromeScale() {
    syncEditorChromeScaleVars();
    var sx = chromeScaleX();
    var sy = chromeScaleY();
    var line = chromeLineScale();
    // Figma parity: the hover outline is visibly thinner than the selection
    // outline — hover is a light "you could select this" hint, selection is
    // the stronger confirmed-state chrome. Matches the overview canvas's
    // hover (1 * chromeScale) vs selection (1.5 * chromeScale) ratio.
    highlightOverlay.style.borderWidth = 1 * line + "px";
    parentAutoLayoutOverlay.style.borderWidth = 1 * line + "px";
    selectionOverlay.style.borderWidth = 1.5 * line + "px";
    marqueeSelectionOverlay.style.borderWidth = 1 * line + "px";
    passiveSelectionOverlays.forEach(scalePassiveSelectionOverlay);
    if (selectedEl) updateSpacingOverlay(selectedEl);

    selectionOverlay
      .querySelectorAll("[data-agent-native-edge-handle]")
      .forEach(function (edge) {
        var pos = edge.getAttribute("data-agent-native-edge-handle");
        if (pos === "n" || pos === "s") {
          edge.style.height = 10 * sy + "px";
          edge.style[pos === "n" ? "top" : "bottom"] = -5 * sy + "px";
        }
        if (pos === "e" || pos === "w") {
          edge.style.width = 10 * sx + "px";
          edge.style[pos === "w" ? "left" : "right"] = -5 * sx + "px";
        }
      });

    selectionOverlay
      .querySelectorAll("[data-agent-native-edit-handle]")
      .forEach(function (handle) {
        var pos = handle.getAttribute("data-agent-native-edit-handle") || "";
        handle.style.width = 7 * sx + "px";
        handle.style.height = 7 * sy + "px";
        handle.style.borderWidth = 1 * line + "px";
        if (pos.indexOf("n") !== -1) handle.style.top = -4 * sy + "px";
        if (pos.indexOf("s") !== -1) handle.style.bottom = -4 * sy + "px";
        if (pos.indexOf("w") !== -1) handle.style.left = -4 * sx + "px";
        if (pos.indexOf("e") !== -1) handle.style.right = -4 * sx + "px";
      });

    selectionOverlay
      .querySelectorAll("[data-agent-native-rotate-handle]")
      .forEach(function (handle) {
        var pos = handle.getAttribute("data-agent-native-rotate-handle") || "";
        handle.style.width = 18 * sx + "px";
        handle.style.height = 18 * sy + "px";
        if (pos.indexOf("n") !== -1) handle.style.top = -26 * sy + "px";
        if (pos.indexOf("s") !== -1) handle.style.bottom = -26 * sy + "px";
        if (pos.indexOf("w") !== -1) handle.style.left = -26 * sx + "px";
        if (pos.indexOf("e") !== -1) handle.style.right = -26 * sx + "px";
      });
  }

  // Rotation-aware local-box placement shared by selectionOverlay, the hover
  // highlightOverlay, and the passive multi-selection overlays: prefer the CSS
  // box + rotation transform so the outline hugs the rotated element rather
  // than its inflated axis-aligned bounding box. Returns true when it placed
  // the overlay (caller should skip the AABB fallback), false when the element
  // has no usable local box (falls back to getBoundingClientRect).
  function positionOverlayForRotatedLocalBox(
    overlay: HTMLElement,
    el: Element,
  ): boolean {
    var elCs = window.getComputedStyle(el);
    var elLeft = readFinitePx(el.style.left || elCs.left);
    var elTop = readFinitePx(el.style.top || elCs.top);
    var elW = readFinitePx(el.style.width || elCs.width);
    var elH = readFinitePx(el.style.height || elCs.height);
    var elRot = currentRotation(el);
    var canUseLocalBox =
      Math.abs(elRot) > 0.01 &&
      elLeft !== null &&
      elTop !== null &&
      elW !== null &&
      elH !== null;
    if (!canUseLocalBox) return false;
    // Convert element-local left/top to viewport coords by walking to the
    // nearest positioned ancestor (same reference frame as getBoundingClientRect).
    var parentRect = (
      (el as HTMLElement).offsetParent || document.documentElement
    ).getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = parentRect.left + elLeft + "px";
    overlay.style.top = parentRect.top + elTop + "px";
    overlay.style.width = elW + "px";
    overlay.style.height = elH + "px";
    overlay.style.transform = "rotate(" + elRot + "deg)";
    overlay.style.transformOrigin = "0 0";
    return true;
  }

  function positionOverlay(overlay: HTMLElement, el: Element): void {
    if (!el || !document.documentElement.contains(el)) {
      overlay.style.display = "none";
      if (overlay === selectionOverlay) hideSelectionOverlay();
      return;
    }
    var placedRotatedLocalBox = positionOverlayForRotatedLocalBox(overlay, el);
    if (!placedRotatedLocalBox) {
      var rect = el.getBoundingClientRect();
      overlay.style.display = "block";
      overlay.style.top = rect.top + "px";
      overlay.style.left = rect.left + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
      overlay.style.transform = "";
    }
    if (overlay === selectionOverlay) {
      applySelectionChrome(el);
      updateSpacingOverlay(el);
      // `rect` is undefined on the rotated-local-box path; updateComponentTag
      // falls back to its own read in that case.
      updateComponentTag(el, rect);
      updateParentAutoLayoutOverlay(el);
    } else {
      applyElementOverlayChrome(overlay, el);
    }
  }

  function refreshOverlays(): void {
    var textEditingEl =
      activeTextEditEl ||
      (document.querySelector(
        "[data-agent-native-text-editing]",
      ) as HTMLElement | null);
    if (hoveredEl && hoveredEl !== selectedEl) {
      positionOverlay(highlightOverlay, hoveredEl);
    } else {
      highlightOverlay.style.display = "none";
    }
    if (textEditingEl) {
      if (activeTextEditEl === textEditingEl) {
        updateTextEditingChrome(
          textEditingEl,
          activeTextEditOriginalMinWidth,
          activeTextEditOriginalMinHeight,
        );
      }
      if (!hasTextCharacters(textEditingEl)) {
        hideSelectionOverlay();
      }
    } else if (selectedEl) {
      positionOverlay(selectionOverlay, selectedEl);
    } else {
      hideParentAutoLayoutOverlay();
    }
    passiveSelectionEls.forEach(function (el, index) {
      var overlay = passiveSelectionOverlays[index];
      if (overlay) positionOverlay(overlay, el);
    });
    positionGradientOverlay();
    syncOverlayObservers();
  }

  // Coalesced overlay refresh: ResizeObserver/MutationObserver callbacks can
  // fire in bursts (e.g. a font/image load reflowing many ancestors, or an
  // Alpine x-show toggling several siblings in one microtask). Collapse any
  // number of triggers within a frame into a single refreshOverlays() call.
  var refreshOverlaysScheduled = false;
  function scheduleRefreshOverlays(): void {
    if (refreshOverlaysScheduled) return;
    refreshOverlaysScheduled = true;
    window.requestAnimationFrame(function () {
      refreshOverlaysScheduled = false;
      refreshOverlays();
    });
  }

  // ResizeObserver on the selected + hovered elements catches size changes
  // that scroll/resize listeners miss entirely: webfont swap reflow, image
  // decode, CSS transitions/animations, and Alpine/Vue reactivity toggling
  // classes on the element itself. MutationObserver (attributes + childList,
  // scoped to the selected element and its parent) catches structural/attr
  // changes that resize an element without necessarily firing a ResizeObserver
  // entry on that exact node (e.g. a sibling insertion shifting layout).
  var overlayResizeObserver: ResizeObserver | null = null;
  var overlayMutationObserver: MutationObserver | null = null;
  var observedResizeEls: Element[] = [];
  var observedMutationRoot: Element | null = null;

  function ensureOverlayObservers(): void {
    if (!overlayResizeObserver && typeof ResizeObserver !== "undefined") {
      overlayResizeObserver = new ResizeObserver(function () {
        scheduleRefreshOverlays();
      });
    }
    if (!overlayMutationObserver && typeof MutationObserver !== "undefined") {
      overlayMutationObserver = new MutationObserver(function () {
        scheduleRefreshOverlays();
      });
    }
  }

  function syncOverlayObservers(): void {
    ensureOverlayObservers();
    if (overlayResizeObserver) {
      var nextTargets: Element[] = [];
      if (selectedEl && document.documentElement.contains(selectedEl)) {
        nextTargets.push(selectedEl);
      }
      if (
        hoveredEl &&
        hoveredEl !== selectedEl &&
        document.documentElement.contains(hoveredEl)
      ) {
        nextTargets.push(hoveredEl);
      }
      var targetsChanged =
        nextTargets.length !== observedResizeEls.length ||
        nextTargets.some(function (el, i) {
          return observedResizeEls[i] !== el;
        });
      if (targetsChanged) {
        observedResizeEls.forEach(function (el) {
          overlayResizeObserver!.unobserve(el);
        });
        nextTargets.forEach(function (el) {
          overlayResizeObserver!.observe(el);
        });
        observedResizeEls = nextTargets;
      }
    }
    if (overlayMutationObserver) {
      var nextRoot: Element | null =
        selectedEl && document.documentElement.contains(selectedEl)
          ? selectedEl.parentElement || selectedEl
          : null;
      if (nextRoot !== observedMutationRoot) {
        overlayMutationObserver.disconnect();
        if (nextRoot) {
          overlayMutationObserver.observe(nextRoot, {
            attributes: true,
            childList: true,
            subtree: false,
          });
          // Also watch the selected element itself for attribute changes
          // (e.g. class/style toggles) when it isn't the observed root.
          if (nextRoot !== selectedEl && selectedEl) {
            overlayMutationObserver.observe(selectedEl, {
              attributes: true,
              childList: true,
              subtree: false,
            });
          }
        }
        observedMutationRoot = nextRoot;
      }
    }
  }

  function hideMeasurements(): void {
    measurementOverlay.style.display = "none";
    measurementOverlay.innerHTML = "";
  }

  function addMeasurementLine(x1, y1, x2, y2, label) {
    var horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    var line = document.createElement("div");
    var labelEl = document.createElement("div");
    // Constant-screen-size chrome: line thickness, label font/padding, and
    // label offsets all compensate for the host's iframe scale so the
    // measurement readout looks identical at any canvas zoom.
    var scale = chromeLineScale();
    var lineWidth = 1 * chromeLineScale();
    var labelChrome =
      "transform-origin:center;border-radius:" +
      3 * scale +
      "px;background:var(--design-editor-measure-color);color:white;padding:" +
      1 * scale +
      "px " +
      4 * scale +
      "px;font-size:" +
      11 * scale +
      "px;";
    if (horizontal) {
      var left = Math.min(x1, x2);
      var width = Math.max(1, Math.abs(x2 - x1));
      line.style.cssText =
        "position:fixed;left:" +
        left +
        "px;top:" +
        y1 +
        "px;width:" +
        width +
        "px;border-top:" +
        lineWidth +
        "px dashed var(--design-editor-measure-color);";
      labelEl.style.cssText =
        "position:fixed;left:" +
        (left + width / 2) +
        "px;top:" +
        (y1 - 9 * scale) +
        "px;transform:translateX(-50%);" +
        labelChrome;
    } else {
      var top = Math.min(y1, y2);
      var height = Math.max(1, Math.abs(y2 - y1));
      line.style.cssText =
        "position:fixed;left:" +
        x1 +
        "px;top:" +
        top +
        "px;height:" +
        height +
        "px;border-left:" +
        lineWidth +
        "px dashed var(--design-editor-measure-color);";
      labelEl.style.cssText =
        "position:fixed;left:" +
        (x1 + 5 * scale) +
        "px;top:" +
        (top + height / 2) +
        "px;transform:translateY(-50%);" +
        labelChrome;
    }
    labelEl.textContent = label;
    measurementOverlay.appendChild(line);
    measurementOverlay.appendChild(labelEl);
  }

  function showMeasurements(a, b) {
    if (!a || !b || a === b) {
      hideMeasurements();
      return;
    }
    var selectedRect = a.getBoundingClientRect();
    var hoverRect = b.getBoundingClientRect();
    measurementOverlay.innerHTML = "";
    measurementOverlay.style.display = "block";

    if (hoverRect.right <= selectedRect.left) {
      var yLeft = Math.max(
        hoverRect.top,
        Math.min(hoverRect.bottom, selectedRect.top + selectedRect.height / 2),
      );
      addMeasurementLine(
        hoverRect.right,
        yLeft,
        selectedRect.left,
        yLeft,
        Math.round(selectedRect.left - hoverRect.right) + "px",
      );
      return;
    }
    if (selectedRect.right <= hoverRect.left) {
      var yRight = Math.max(
        selectedRect.top,
        Math.min(selectedRect.bottom, hoverRect.top + hoverRect.height / 2),
      );
      addMeasurementLine(
        selectedRect.right,
        yRight,
        hoverRect.left,
        yRight,
        Math.round(hoverRect.left - selectedRect.right) + "px",
      );
      return;
    }
    if (hoverRect.bottom <= selectedRect.top) {
      var xTop = Math.max(
        hoverRect.left,
        Math.min(hoverRect.right, selectedRect.left + selectedRect.width / 2),
      );
      addMeasurementLine(
        xTop,
        hoverRect.bottom,
        xTop,
        selectedRect.top,
        Math.round(selectedRect.top - hoverRect.bottom) + "px",
      );
      return;
    }
    if (selectedRect.bottom <= hoverRect.top) {
      var xBottom = Math.max(
        selectedRect.left,
        Math.min(selectedRect.right, hoverRect.left + hoverRect.width / 2),
      );
      addMeasurementLine(
        xBottom,
        selectedRect.bottom,
        xBottom,
        hoverRect.top,
        Math.round(hoverRect.top - selectedRect.bottom) + "px",
      );
      return;
    }
    addMeasurementLine(
      selectedRect.left + selectedRect.width / 2,
      selectedRect.top + selectedRect.height / 2,
      hoverRect.left + hoverRect.width / 2,
      hoverRect.top + hoverRect.height / 2,
      Math.round(
        Math.hypot(
          hoverRect.left +
            hoverRect.width / 2 -
            (selectedRect.left + selectedRect.width / 2),
          hoverRect.top +
            hoverRect.height / 2 -
            (selectedRect.top + selectedRect.height / 2),
        ),
      ) + "px",
    );
  }

  function dragEventNames(e) {
    var pointerGesture = e && e.type && e.type.indexOf("pointer") === 0;
    return pointerGesture
      ? { move: "pointermove", up: "pointerup" }
      : { move: "mousemove", up: "mouseup" };
  }

  function elementFromEditorPoint(
    clientX: number,
    clientY: number,
  ): Element | null {
    lastEditorPointWasBlocked = false;
    var shieldPointerEvents = shieldOverlay.style.pointerEvents;
    var selectionPointerEvents = selectionOverlay.style.pointerEvents;
    var highlightPointerEvents = highlightOverlay.style.pointerEvents;
    shieldOverlay.style.pointerEvents = "none";
    selectionOverlay.style.pointerEvents = "none";
    highlightOverlay.style.pointerEvents = "none";
    var targets = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)];
    shieldOverlay.style.pointerEvents = shieldPointerEvents;
    selectionOverlay.style.pointerEvents = selectionPointerEvents;
    highlightOverlay.style.pointerEvents = highlightPointerEvents;
    for (var i = 0; i < targets.length; i += 1) {
      var target = targets[i];
      if (!target || target.nodeType !== 1) continue;
      if (isOverlayElement(target)) continue;
      if (isLayerInteractionBlocked(target)) {
        lastEditorPointWasBlocked = true;
        return null;
      }
      return target;
    }
    return null;
  }

  function stopNativeInteraction(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function normalizedWheelDelta(e: WheelEvent): { x: number; y: number } {
    var multiplier =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? Math.max(
              1,
              window.innerHeight || document.documentElement.clientHeight,
            )
          : 1;
    return {
      x: e.deltaX * multiplier,
      y: e.deltaY * multiplier,
    };
  }

  function scrollableOverflow(value: string | undefined): boolean {
    return value === "auto" || value === "scroll" || value === "overlay";
  }

  function canScrollElement(
    el: Element | null,
    axis: "x" | "y",
    delta: number,
  ): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    var style = window.getComputedStyle(el);
    var overflow = axis === "y" ? style.overflowY : style.overflowX;
    if (!scrollableOverflow(overflow)) return false;
    var max =
      axis === "y"
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth;
    if (max <= 1) return false;
    var current = axis === "y" ? el.scrollTop : el.scrollLeft;
    if (delta < 0) return current > 0;
    if (delta > 0) return current < max - 1;
    return false;
  }

  function findScrollableElementForWheel(
    start: Element | null,
    deltaX: number,
    deltaY: number,
  ): HTMLElement | Element | null {
    var node: Element | null = start;
    while (node && node.nodeType === 1) {
      if (
        canScrollElement(node, "y", deltaY) ||
        canScrollElement(node, "x", deltaX)
      ) {
        return node;
      }
      node = node.parentElement;
    }

    var scrollingElement =
      document.scrollingElement || document.documentElement;
    var maxY = scrollingElement.scrollHeight - scrollingElement.clientHeight;
    var maxX = scrollingElement.scrollWidth - scrollingElement.clientWidth;
    var canScrollUp = false;
    var canScrollDown = false;
    var canScrollLeft = false;
    var canScrollRight = false;
    if (deltaY < 0) {
      canScrollUp = scrollingElement.scrollTop > 0;
    }
    if (deltaY > 0) {
      canScrollDown = scrollingElement.scrollTop < maxY - 1;
    }
    if (deltaX < 0) {
      canScrollLeft = scrollingElement.scrollLeft > 0;
    }
    if (deltaX > 0) {
      canScrollRight = scrollingElement.scrollLeft < maxX - 1;
    }
    if (canScrollUp || canScrollDown || canScrollLeft || canScrollRight) {
      return scrollingElement;
    }
    return null;
  }

  function scrollElementByWheelDelta(
    el: HTMLElement | Element,
    deltaX: number,
    deltaY: number,
  ): boolean {
    var anyEl = el as HTMLElement;
    var beforeLeft = anyEl.scrollLeft || 0;
    var beforeTop = anyEl.scrollTop || 0;
    if (typeof anyEl.scrollBy === "function") {
      anyEl.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" });
    } else {
      anyEl.scrollLeft = beforeLeft + deltaX;
      anyEl.scrollTop = beforeTop + deltaY;
    }
    return anyEl.scrollLeft !== beforeLeft || anyEl.scrollTop !== beforeTop;
  }

  function scrollUnderlyingElementAtWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) return;
    if (Math.abs(e.deltaX) < 0.01 && Math.abs(e.deltaY) < 0.01) return;
    var delta = normalizedWheelDelta(e);
    var target = elementFromEditorPoint(e.clientX, e.clientY);
    var scrollTarget = findScrollableElementForWheel(target, delta.x, delta.y);
    if (!scrollTarget) return;
    var didScroll = scrollElementByWheelDelta(scrollTarget, delta.x, delta.y);
    if (!didScroll) return;
    stopNativeInteraction(e);
    // Coalesced (not a raw requestAnimationFrame(refreshOverlays)): trackpads
    // emit several wheel events per frame, and scheduling one full overlay
    // refresh per event stacks N redundant refreshOverlays() runs into every
    // frame. With an element selected each run forces multiple synchronous
    // layout reads, which is exactly the per-event work that froze scrolling
    // on layout-heavy pages while a selection was active.
    scheduleRefreshOverlays();
  }

  function isEditorTypingTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      'input, textarea, select, [contenteditable], [role="textbox"], [data-agent-native-text-editing]',
    );
  }

  function shouldForwardDesignHotkey(e) {
    // Read-only surfaces (e.g. background/inactive board screens) must never
    // forward edit hotkeys or preventDefault() native browser shortcuts —
    // Escape/Enter/Tab/Delete/arrow-key/undo-redo forwarding is an editing
    // affordance and has no business intercepting keys on a passive view.
    if (readOnly) return false;
    if (activeTextEditEl || isEditorTypingTarget(e.target) || e.isComposing)
      return false;
    var key = e.key;
    var normalized = key && key.length === 1 ? key.toLowerCase() : key;
    var primary = e.metaKey || e.ctrlKey;
    if (key === "Escape" || key === "Enter") return true;
    // Space arms Figma-style temporary hand-tool panning while the cursor is
    // over the preview iframe. Only forward the plain (no-modifier) chord —
    // the isEditorTypingTarget guard above already keeps this from hijacking
    // Space while the user is typing in an editable in-iframe target.
    if (key === " " && e.code === "Space") {
      return !primary && !e.altKey && !e.shiftKey;
    }
    // Forward Tab only when an element is actively selected so the iframe does
    // not intercept Tab when the user is tabbing through browser UI with nothing
    // selected (preserves native keyboard accessibility).
    if (key === "Tab") return !!selectedEl;
    if (key === "Delete" || key === "Backspace") return !primary;
    if (/^Arrow/.test(key || "")) return !e.altKey;
    if (primary) {
      return (
        [
          "z",
          "y",
          "a",
          "x",
          "c",
          "v",
          "d",
          "g",
          "=",
          "+",
          "-",
          "0",
          "]",
          "[",
        ].indexOf(normalized) !== -1 ||
        e.code === "Digit1" ||
        e.code === "Digit2" ||
        key === "1" ||
        key === "2"
      );
    }
    if (
      e.shiftKey &&
      (e.code === "Digit1" || e.code === "Digit2" || key === "1" || key === "2")
    )
      return true;
    return (
      !e.altKey &&
      !e.shiftKey &&
      ["v", "f", "r", "t", "p", "h", "c", "k"].indexOf(normalized) !== -1
    );
  }

  function blurActiveTextEditor(): void {
    var active = document.activeElement;
    if (
      active &&
      active.closest &&
      active.closest("[data-agent-native-text-editing]") &&
      typeof active.blur === "function"
    ) {
      active.blur();
    }
  }

  function setTextEditingPointerPassthrough(enabled: boolean): void {
    if (enabled) {
      if (!textEditPointerState) {
        textEditPointerState = {
          shield: shieldOverlay.style.pointerEvents,
          selection: selectionOverlay.style.pointerEvents,
          highlight: highlightOverlay.style.pointerEvents,
        };
      }
      shieldOverlay.style.pointerEvents = "none";
      selectionOverlay.style.pointerEvents = "none";
      highlightOverlay.style.pointerEvents = "none";
      return;
    }
    if (!textEditPointerState) return;
    shieldOverlay.style.pointerEvents = textEditPointerState.shield;
    selectionOverlay.style.pointerEvents = textEditPointerState.selection;
    highlightOverlay.style.pointerEvents = textEditPointerState.highlight;
    textEditPointerState = null;
  }

  function hasTextContent(el: Element | null): boolean {
    return !!(el && el.textContent && el.textContent.trim().length > 0);
  }

  function hasTextCharacters(el: Element | null): boolean {
    return !!(el && el.textContent && el.textContent.length > 0);
  }

  function setSelectionOverlayResizeChromeVisible(visible: boolean): void {
    selectionOverlay
      .querySelectorAll(
        "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle]",
      )
      .forEach(function (node) {
        if (!(node instanceof HTMLElement)) return;
        node.style.display = visible ? "" : "none";
      });
  }

  function updateTextEditingChrome(
    target: HTMLElement,
    originalMinWidth: string,
    originalMinHeight: string,
  ): void {
    target.style.outline = "none";
    target.style.outlineStyle = "none";
    target.style.outlineWidth = "0px";
    target.style.outlineColor = "transparent";
    target.style.outlineOffset = "0px";
    if (hasTextCharacters(target)) {
      document.documentElement.removeAttribute(
        "data-agent-native-empty-text-editing",
      );
      target.style.minWidth = originalMinWidth;
      target.style.minHeight = originalMinHeight;
      positionOverlay(selectionOverlay, target);
      setSelectionOverlayResizeChromeVisible(false);
      return;
    }
    target.style.minWidth = originalMinWidth || "1px";
    target.style.minHeight = originalMinHeight || "1em";
    document.documentElement.setAttribute(
      "data-agent-native-empty-text-editing",
      "true",
    );
    hideSelectionOverlay();
    setSelectionOverlayResizeChromeVisible(false);
  }

  function isInlineEditableDescendant(el: Element | null): boolean {
    if (!el || !el.tagName) return false;
    // Allowlist covers inline markup AND common block-level text containers
    // (p, h1-h6, li, etc.) so that paragraphs with inline markup like
    // <p>Hello <strong>world</strong></p> can be double-click edited.
    return (
      [
        // Inline formatting
        "a",
        "abbr",
        "b",
        "br",
        "cite",
        "code",
        "em",
        "i",
        "mark",
        "small",
        "span",
        "strong",
        "sub",
        "sup",
        "time",
        "u",
        "wbr",
        // Block-level text containers
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "ul",
        "ol",
        "dl",
        "dt",
        "dd",
        "label",
        "caption",
        "td",
        "th",
      ].indexOf(el.tagName.toLowerCase()) !== -1
    );
  }

  function hasOnlyInlineEditableChildren(el) {
    if (!el || !hasTextContent(el)) return false;
    var descendants = el.querySelectorAll ? el.querySelectorAll("*") : [];
    for (var i = 0; i < descendants.length; i += 1) {
      if (!isInlineEditableDescendant(descendants[i])) return false;
    }
    return true;
  }

  function findTextEditTarget(hit) {
    if (
      !hit ||
      hit.nodeType !== 1 ||
      hit === document.body ||
      hit === document.documentElement
    )
      return null;
    var selectedContainsHit =
      selectedEl && selectedEl.contains && selectedEl.contains(hit);
    if (selectedContainsHit && hasOnlyInlineEditableChildren(selectedEl))
      return selectedEl;

    var candidate = null;
    var node = hit;
    while (
      node &&
      node.nodeType === 1 &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      if (hasOnlyInlineEditableChildren(node)) {
        candidate = node;
      }
      if (selectedEl && node === selectedEl) break;
      node = node.parentElement;
    }
    // Return null (not the raw hit) when no text-editable ancestor is found.
    // Falling back to the raw hit element makes non-text nodes like <img> or
    // <canvas> contenteditable, which leaves the editor in a broken state.
    return candidate || null;
  }

  function selectElementAtEvent(e) {
    stopNativeInteraction(e);
    blurActiveTextEditor();
    if (suppressNextShieldClick) {
      suppressNextShieldClick = false;
      if (suppressNextShieldClickTimer !== null) {
        clearTimeout(suppressNextShieldClickTimer);
        suppressNextShieldClickTimer = null;
      }
      return;
    }
    // Suppress the first click in a double-click sequence — the dblclick
    // handler (beginTextEditingFromEvent) will fire immediately after and a
    // spurious element-select would cause inspector flicker.
    if (e.detail >= 2) return;
    var target = elementFromEditorPoint(e.clientX, e.clientY);
    if (!target && lastEditorPointWasBlocked) return;
    if (
      !target ||
      target === document.body ||
      target === document.documentElement
    ) {
      // Click on empty canvas: clear the current selection (matches Figma).
      clearRuntimeSelection();
      (window.parent as Window).postMessage({ type: "clear-selection" }, "*");
      return;
    }
    selectedSpacingHovered = false;
    hoveredSpacingHandleKey = "";
    var previousSelectedEl = selectedEl;
    selectedEl = selectionTargetForHit(target);
    if (!selectedEl || isLayerInteractionBlocked(selectedEl)) {
      selectedEl = null;
      hideSelectionOverlay();
      return;
    }
    positionOverlay(selectionOverlay, selectedEl);
    preservePreviousSelectedElementForShiftClick(
      previousSelectedEl,
      selectedEl,
      e,
    );
    postElementSelect(selectedEl, e);
  }

  function suppressNextShieldClickBriefly() {
    suppressNextShieldClick = true;
    if (suppressNextShieldClickTimer !== null) {
      clearTimeout(suppressNextShieldClickTimer);
    }
    suppressNextShieldClickTimer = setTimeout(function () {
      suppressNextShieldClick = false;
      suppressNextShieldClickTimer = null;
    }, 250);
  }

  function clearActiveMarqueeSelection(): void {
    if (!activeMarqueeSelection) return;
    document.removeEventListener(
      activeMarqueeSelection.move,
      activeMarqueeSelection.onMove,
      true,
    );
    document.removeEventListener(
      activeMarqueeSelection.up,
      activeMarqueeSelection.onUp,
      true,
    );
    if (
      activeMarqueeSelection.pointerId !== undefined &&
      shieldOverlay.releasePointerCapture
    ) {
      try {
        shieldOverlay.releasePointerCapture(activeMarqueeSelection.pointerId);
      } catch (_err) {}
    }
    activeMarqueeSelection = null;
  }

  function marqueeRectFromPoints(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } {
    var left = Math.min(startX, endX);
    var top = Math.min(startY, endY);
    var right = Math.max(startX, endX);
    var bottom = Math.max(startY, endY);
    return {
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  function rectsIntersect(
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    return (
      a.left <= b.right &&
      a.right >= b.left &&
      a.top <= b.bottom &&
      a.bottom >= b.top
    );
  }

  function postElementMarqueeSelect(
    elements: Element[],
    additive: boolean,
    e,
  ): void {
    (window.parent as Window).postMessage(
      {
        type: "agent-native:layer-marquee-selection",
        phase: "change",
        payload: elements.map(function (el) {
          return getElementInfo(el);
        }),
        intent: {
          additive: additive,
          range: Boolean(e && e.shiftKey),
          source: "marquee",
          shiftKey: Boolean(e && e.shiftKey),
          metaKey: Boolean(e && e.metaKey),
          ctrlKey: Boolean(e && e.ctrlKey),
        },
      },
      "*",
    );
  }

  function updateMarqueeSelection(e): void {
    if (!activeMarqueeSelection) return;
    var rect = marqueeRectFromPoints(
      activeMarqueeSelection.startX,
      activeMarqueeSelection.startY,
      e.clientX,
      e.clientY,
    );
    marqueeSelectionOverlay.style.display = "block";
    marqueeSelectionOverlay.style.left = rect.left + "px";
    marqueeSelectionOverlay.style.top = rect.top + "px";
    marqueeSelectionOverlay.style.width = rect.width + "px";
    marqueeSelectionOverlay.style.height = rect.height + "px";

    var hitElements = collectSelectableElements().filter(function (el) {
      var bounds = el.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;
      return rectsIntersect(rect, {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      });
    });
    var primary = hitElements[hitElements.length - 1] || null;
    if (primary) {
      selectedEl = primary;
      positionOverlay(selectionOverlay, primary);
    } else if (!activeMarqueeSelection.additive) {
      selectedEl = null;
      hideSelectionOverlay();
    }
    setPassiveSelectionElements(hitElements);
    postElementMarqueeSelect(hitElements, activeMarqueeSelection.additive, e);
  }

  function beginMarqueeSelection(e): void {
    if (e.button !== 0 || activeTextEditEl) return;
    clearActiveMarqueeSelection();
    var events = dragEventNames(e);
    var additive = Boolean(e && (e.metaKey || e.ctrlKey || e.shiftKey));
    function onMove(ev) {
      if (!activeMarqueeSelection) return;
      if (
        !activeMarqueeSelection.moved &&
        Math.hypot(
          ev.clientX - activeMarqueeSelection.startX,
          ev.clientY - activeMarqueeSelection.startY,
        ) <= 3
      ) {
        return;
      }
      if (!activeMarqueeSelection.moved) {
        activeMarqueeSelection.moved = true;
        suppressNextShieldClickBriefly();
      }
      stopNativeInteraction(ev);
      updateMarqueeSelection(ev);
    }
    function onUp(ev) {
      var didMove = Boolean(activeMarqueeSelection?.moved);
      if (didMove) {
        stopNativeInteraction(ev);
        updateMarqueeSelection(ev);
        suppressNextShieldClickBriefly();
      }
      marqueeSelectionOverlay.style.display = "none";
      clearActiveMarqueeSelection();
    }
    activeMarqueeSelection = {
      startX: e.clientX,
      startY: e.clientY,
      additive: additive,
      moved: false,
      pointerId: e.pointerId,
      move: events.move,
      up: events.up,
      onMove: onMove,
      onUp: onUp,
    };
    if (e.pointerId !== undefined && shieldOverlay.setPointerCapture) {
      try {
        shieldOverlay.setPointerCapture(e.pointerId);
      } catch (_err) {}
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
  }

  function openContextMenuAtEvent(e) {
    stopNativeInteraction(e);
    blurActiveTextEditor();
    var target = elementFromEditorPoint(e.clientX, e.clientY);
    if (!target && lastEditorPointWasBlocked) return;
    var info = null;
    if (target) {
      selectedSpacingHovered = false;
      hoveredSpacingHandleKey = "";
      selectedEl = selectionTargetForHit(target);
      if (selectedEl && !isLayerInteractionBlocked(selectedEl)) {
        info = getElementInfo(selectedEl);
        positionOverlay(selectionOverlay, selectedEl);
        postElementSelect(selectedEl, e);
      } else {
        selectedEl = null;
        hideSelectionOverlay();
      }
    }
    (window.parent as Window).postMessage(
      {
        type: "element-contextmenu",
        clientX: e.clientX,
        clientY: e.clientY,
        payload: info,
      },
      "*",
    );
  }

  function findRuntimeTarget(selector, selectorCandidates) {
    var candidates: string[] = [];
    if (Array.isArray(selectorCandidates)) {
      selectorCandidates.forEach(function (candidate) {
        if (
          typeof candidate === "string" &&
          candidate &&
          candidates.indexOf(candidate) === -1
        ) {
          candidates.push(candidate);
        }
      });
    }
    if (selector && candidates.indexOf(selector) === -1)
      candidates.push(selector);
    if (
      selectedEl &&
      document.documentElement.contains(selectedEl) &&
      (candidates.length === 0 ||
        matchesExactSelectorList(selectedEl, candidates))
    ) {
      return selectedEl;
    }
    for (var i = 0; i < candidates.length; i += 1) {
      try {
        var match = document.querySelector(candidates[i]);
        if (match && !isLayerInteractionBlocked(match)) return match;
      } catch (_err) {}
    }
    return null;
  }

  function removeRuntimeTarget(selector, selectorCandidates) {
    var target = findRuntimeTarget(selector, selectorCandidates);
    if (
      !target ||
      target === document.body ||
      target === document.documentElement
    )
      return false;
    if (target.parentElement) target.parentElement.removeChild(target);
    if (
      selectedEl === target ||
      !document.documentElement.contains(selectedEl)
    ) {
      selectedEl = null;
      hideSelectionOverlay();
    }
    hoveredEl = null;
    highlightOverlay.style.display = "none";
    hideMeasurements();
    refreshOverlays();
    return true;
  }

  function readPx(value: string): number {
    var num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
  }

  function readFinitePx(value) {
    if (!value || value === "auto") return null;
    var num = parseFloat(value);
    return Number.isFinite(num) ? num : null;
  }

  // ── Gradient edit overlay: math + minimal linear-gradient CSS parser ────
  // Ports of MultiScreenCanvas.tsx's exported `gradientLineEndpoints` /
  // `gradientStopPoints` / `angleFromDraggedEndpoint` /
  // `stopPercentFromDraggedPoint` (see that file's doc comments for the
  // full derivation) — duplicated verbatim since this file cannot import.

  function clampGradientT(t: number): number {
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.min(1, t));
  }

  function gradientLineEndpoints(
    angleDeg: number,
    width: number,
    height: number,
  ) {
    var rad = (angleDeg * Math.PI) / 180;
    var dx = Math.sin(rad);
    var dy = -Math.cos(rad);
    var halfLength = Math.abs((width / 2) * dx) + Math.abs((height / 2) * dy);
    var center = { x: width / 2, y: height / 2 };
    return {
      start: { x: center.x - dx * halfLength, y: center.y - dy * halfLength },
      end: { x: center.x + dx * halfLength, y: center.y + dy * halfLength },
    };
  }

  function gradientStopPoints(
    angleDeg: number,
    width: number,
    height: number,
    stops: Array<{ position: number }>,
  ) {
    var line = gradientLineEndpoints(angleDeg, width, height);
    return stops.map(function (stop) {
      var t = clampGradientT(stop.position / 100);
      return {
        x: line.start.x + (line.end.x - line.start.x) * t,
        y: line.start.y + (line.end.y - line.start.y) * t,
        position: stop.position,
      };
    });
  }

  function angleFromDraggedEndpoint(
    point: { x: number; y: number },
    width: number,
    height: number,
    which: "start" | "end",
  ): number {
    var center = { x: width / 2, y: height / 2 };
    var dx = point.x - center.x;
    var dy = point.y - center.y;
    if (dx === 0 && dy === 0) return 0;
    var deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (which === "start") deg += 180;
    deg = ((deg % 360) + 360) % 360;
    return deg;
  }

  function stopPercentFromDraggedPoint(
    point: { x: number; y: number },
    angleDeg: number,
    width: number,
    height: number,
  ): number {
    var line = gradientLineEndpoints(angleDeg, width, height);
    var lineDx = line.end.x - line.start.x;
    var lineDy = line.end.y - line.start.y;
    var lengthSquared = lineDx * lineDx + lineDy * lineDy;
    if (lengthSquared === 0) return 0;
    var t =
      ((point.x - line.start.x) * lineDx + (point.y - line.start.y) * lineDy) /
      lengthSquared;
    return clampGradientT(t) * 100;
  }

  // Minimal linear-only port of GradientEditor.tsx's parseGradientCss /
  // gradientToCss (that component owns the canonical parser; this is a
  // reduced copy scoped to just `linear-gradient(...)`, matching the
  // MultiScreenCanvas overlay's own linear-only scope).
  var GRADIENT_LINEAR_RE = /^linear-gradient\s*\(([\s\S]*)\)\s*$/i;
  var GRADIENT_ANGLE_RE = /(-?\d+(?:\.\d+)?)deg/;
  function splitGradientTopLevel(input: string): string[] {
    var parts: string[] = [];
    var depth = 0;
    var current = "";
    for (var i = 0; i < input.length; i += 1) {
      var char = input.charAt(i);
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }
  function parseLinearGradientCss(value: string): {
    angle: number;
    stops: Array<{ id: string; color: string; position: number }>;
  } | null {
    var match = String(value || "")
      .trim()
      .match(GRADIENT_LINEAR_RE);
    if (!match) return null;
    var segments = splitGradientTopLevel(match[1]);
    if (segments.length === 0) return null;
    var angle = 90;
    var stopStart = 0;
    var first = segments[0];
    var angleMatch = first.match(GRADIENT_ANGLE_RE);
    if (angleMatch) {
      angle = Number(angleMatch[1]);
      stopStart = 1;
    } else if (/to\s+/i.test(first)) {
      stopStart = 1;
    }
    var stopSegments = segments.slice(stopStart);
    var stops: Array<{ id: string; color: string; position: number }> = [];
    stopSegments.forEach(function (seg, index) {
      var posMatch = seg.match(/(-?\d+(?:\.\d+)?)%\s*$/);
      var color = posMatch ? seg.slice(0, posMatch.index).trim() : seg.trim();
      if (!color) return;
      var position = posMatch
        ? Math.max(0, Math.min(100, Number(posMatch[1])))
        : (index / Math.max(1, stopSegments.length - 1)) * 100;
      stops.push({ id: "gstop-" + index, color: color, position: position });
    });
    if (stops.length < 2) return null;
    return { angle: angle, stops: stops };
  }
  function linearGradientToCss(gradient: {
    angle: number;
    stops: Array<{ id: string; color: string; position: number }>;
  }): string {
    var sorted = gradient.stops.slice().sort(function (a, b) {
      return a.position - b.position;
    });
    var stopsCss = sorted
      .map(function (stop) {
        return stop.color + " " + Math.round(stop.position * 100) / 100 + "%";
      })
      .join(", ");
    return (
      "linear-gradient(" +
      Math.round(gradient.angle * 100) / 100 +
      "deg, " +
      stopsCss +
      ")"
    );
  }

  // gradientEditOverlayTarget doc / parent wiring contract:
  //
  // This bridge only RENDERS the overlay + emits drag deltas; it has no idea
  // which element on the host side "is" the gradient-edited node beyond the
  // `nodeId` the parent gives it. The parent (DesignEditor.tsx, NOT owned by
  // this change — see the report) is expected to:
  //
  //   1. Keep its existing `gradientEditTarget` state (already threaded into
  //      MultiScreenCanvas's board/screen-frame overlay) as the single
  //      source of truth for "is a gradient edit session active, for which
  //      node, with which CSS value".
  //   2. Whenever that target refers to an element *inside* the active
  //      screen's iframe content (as opposed to a board/draft primitive
  //      MultiScreenCanvas already draws chrome for directly), postMessage
  //      `{ type: "gradient-edit-target", nodeId, cssValue }` into that
  //      screen's iframe — `nodeId` being the element's
  //      `data-agent-native-node-id`. Post `{ type: "gradient-edit-clear" }`
  //      when the session ends (selection changes, popover closes, or the
  //      target moves to a different screen/board node).
  //   3. Listen for this bridge's `{ type: "gradient-edit-change", nodeId,
  //      cssValue, phase }` postMessages and route them through the same
  //      style-apply path `visual-style-change` already uses (phase
  //      "preview" for live feedback, "commit" once on release — mirroring
  //      GradientEditOverlayTarget's own onChange contract in
  //      MultiScreenCanvas.tsx).
  //
  // Until that parent-side wiring lands, this bridge simply never receives
  // `gradient-edit-target` and stays fully inert (see the early-return checks
  // below), so this is a strictly additive, zero-behavior-change surface
  // until wired up.
  var gradientEditTarget: { nodeId: string; cssValue: string } | null = null;
  var gradientDrag: {
    kind: "endpoint" | "stop";
    which?: "start" | "end";
    stopId?: string;
    pointerId: number;
  } | null = null;

  function gradientEditTargetElement(): HTMLElement | null {
    if (!gradientEditTarget) return null;
    return document.querySelector(
      '[data-agent-native-node-id="' +
        String(gradientEditTarget.nodeId)
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"') +
        '"]',
    ) as HTMLElement | null;
  }

  function hideGradientOverlay(): void {
    gradientOverlay.style.display = "none";
    while (gradientOverlay.querySelectorAll("[data-gradient-stop]").length) {
      var stopEl = gradientOverlay.querySelector("[data-gradient-stop]");
      if (stopEl && stopEl.parentNode) stopEl.parentNode.removeChild(stopEl);
    }
  }

  function positionGradientOverlay(): void {
    var target = gradientEditTarget;
    if (!target) {
      hideGradientOverlay();
      return;
    }
    var el = gradientEditTargetElement();
    if (!el || !document.documentElement.contains(el)) {
      hideGradientOverlay();
      return;
    }
    var gradient = parseLinearGradientCss(target.cssValue);
    if (!gradient) {
      // Non-linear/unparseable — render nothing (linear-only scope, matches
      // MultiScreenCanvas's GradientEditOverlay contract exactly).
      hideGradientOverlay();
      return;
    }
    var rect = el.getBoundingClientRect();
    var width = Math.max(1, rect.width);
    var height = Math.max(1, rect.height);
    gradientOverlay.style.display = "block";
    gradientOverlay.style.left = rect.left + "px";
    gradientOverlay.style.top = rect.top + "px";
    gradientOverlay.style.width = width + "px";
    gradientOverlay.style.height = height + "px";

    var line = gradientLineEndpoints(gradient.angle, width, height);
    var stopPoints = gradientStopPoints(
      gradient.angle,
      width,
      height,
      gradient.stops,
    );

    var line1 = chromeLineScale();
    var lineStrokeWidth = 1.5 * line1;
    gradientOverlaySvg.setAttribute("viewBox", "0 0 " + width + " " + height);
    [gradientOverlayLineOutline, gradientOverlayLine].forEach(
      function (lineEl, index) {
        lineEl.setAttribute("x1", String(line.start.x));
        lineEl.setAttribute("y1", String(line.start.y));
        lineEl.setAttribute("x2", String(line.end.x));
        lineEl.setAttribute("y2", String(line.end.y));
        lineEl.setAttribute(
          "stroke-width",
          String(index === 0 ? lineStrokeWidth + 1.5 * line1 : lineStrokeWidth),
        );
      },
    );

    var endpointSize = 10 * line1;
    var endpointBorderWidth = 1.5 * line1;
    [
      { el: gradientOverlayStartHandle, point: line.start, which: "start" },
      { el: gradientOverlayEndHandle, point: line.end, which: "end" },
    ].forEach(function (entry) {
      entry.el.style.left = entry.point.x - endpointSize / 2 + "px";
      entry.el.style.top = entry.point.y - endpointSize / 2 + "px";
      entry.el.style.width = endpointSize + "px";
      entry.el.style.height = endpointSize + "px";
      entry.el.style.borderWidth = endpointBorderWidth + "px";
      entry.el.setAttribute(
        "aria-valuenow",
        String(Math.round(gradient.angle)),
      );
    });

    // Stop markers are rebuilt each render (cheap: 2-8 stops typical) rather
    // than pooled, matching the overlay's overall "small + self-contained"
    // design (see the doc comment on MultiScreenCanvas's GradientEditOverlay).
    hideGradientOverlayStops();
    var stopSize = 12 * line1;
    var stopBorderWidth = 2 * line1;
    stopPoints.forEach(function (point, index) {
      var stop = gradient.stops[index];
      if (!stop) return;
      var stopEl = document.createElement("span");
      stopEl.setAttribute("data-gradient-stop", stop.id);
      stopEl.setAttribute("role", "slider");
      stopEl.setAttribute(
        "aria-label",
        stop.color + " at " + Math.round(stop.position) + "%",
      );
      stopEl.setAttribute("aria-valuenow", String(Math.round(stop.position)));
      stopEl.style.cssText =
        "position:absolute;pointer-events:auto;cursor:grab;border-radius:999px;box-sizing:border-box;border:1px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.25);";
      stopEl.style.left = point.x - stopSize / 2 + "px";
      stopEl.style.top = point.y - stopSize / 2 + "px";
      stopEl.style.width = stopSize + "px";
      stopEl.style.height = stopSize + "px";
      stopEl.style.borderWidth = stopBorderWidth + "px";
      stopEl.style.backgroundColor = stop.color;
      stopEl.addEventListener("pointerdown", function (ev: PointerEvent) {
        beginGradientDrag(ev, { kind: "stop", stopId: stop.id });
      });
      gradientOverlay.appendChild(stopEl);
    });
  }

  function hideGradientOverlayStops(): void {
    Array.prototype.slice
      .call(gradientOverlay.querySelectorAll("[data-gradient-stop]"))
      .forEach(function (node: Element) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
  }

  function gradientOverlayLocalPoint(event: PointerEvent): {
    x: number;
    y: number;
  } {
    var rect = gradientOverlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function emitGradientChange(
    gradient: {
      angle: number;
      stops: Array<{ id: string; color: string; position: number }>;
    },
    phase: "preview" | "commit",
  ): void {
    if (!gradientEditTarget) return;
    (window.parent as Window).postMessage(
      {
        type: "gradient-edit-change",
        nodeId: gradientEditTarget.nodeId,
        cssValue: linearGradientToCss(gradient),
        phase: phase,
      },
      "*",
    );
    // Keep the local target's cssValue in sync so a subsequent drag tick (or
    // a re-render triggered by scroll/resize) reflects the in-progress value
    // instead of waiting for the parent to round-trip a fresh
    // gradient-edit-target message.
    gradientEditTarget = {
      nodeId: gradientEditTarget.nodeId,
      cssValue: linearGradientToCss(gradient),
    };
  }

  function beginGradientDrag(
    event: PointerEvent,
    kind:
      | { kind: "endpoint"; which: "start" | "end" }
      | { kind: "stop"; stopId: string },
  ): void {
    event.stopPropagation();
    event.preventDefault();
    gradientDrag = {
      kind: kind.kind,
      which: kind.kind === "endpoint" ? kind.which : undefined,
      stopId: kind.kind === "stop" ? kind.stopId : undefined,
      pointerId: event.pointerId,
    };
    var handleEl = event.currentTarget as Element;
    if (handleEl && (handleEl as HTMLElement).setPointerCapture) {
      (handleEl as HTMLElement).setPointerCapture(event.pointerId);
    }
    document.addEventListener("pointermove", onGradientDragMove, true);
    document.addEventListener("pointerup", onGradientDragEnd, true);
    document.addEventListener("pointercancel", onGradientDragEnd, true);
  }

  function onGradientDragMove(event: PointerEvent): void {
    var drag = gradientDrag;
    var target = gradientEditTarget;
    var el = gradientEditTargetElement();
    if (!drag || drag.pointerId !== event.pointerId || !target || !el) return;
    var gradient = parseLinearGradientCss(target.cssValue);
    if (!gradient) return;
    var rect = el.getBoundingClientRect();
    var width = Math.max(1, rect.width);
    var height = Math.max(1, rect.height);
    var local = gradientOverlayLocalPoint(event);
    if (drag.kind === "endpoint" && drag.which) {
      var nextAngle = angleFromDraggedEndpoint(
        local,
        width,
        height,
        drag.which,
      );
      emitGradientChange(
        { angle: nextAngle, stops: gradient.stops },
        "preview",
      );
      positionGradientOverlay();
      return;
    }
    if (drag.kind === "stop" && drag.stopId) {
      var nextPosition = stopPercentFromDraggedPoint(
        local,
        gradient.angle,
        width,
        height,
      );
      var stopId = drag.stopId;
      emitGradientChange(
        {
          angle: gradient.angle,
          stops: gradient.stops.map(function (stop) {
            return stop.id === stopId
              ? { id: stop.id, color: stop.color, position: nextPosition }
              : stop;
          }),
        },
        "preview",
      );
      positionGradientOverlay();
    }
  }

  function onGradientDragEnd(event: PointerEvent): void {
    var drag = gradientDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gradientDrag = null;
    document.removeEventListener("pointermove", onGradientDragMove, true);
    document.removeEventListener("pointerup", onGradientDragEnd, true);
    document.removeEventListener("pointercancel", onGradientDragEnd, true);
    var target = gradientEditTarget;
    if (!target) return;
    var gradient = parseLinearGradientCss(target.cssValue);
    if (!gradient) return;
    emitGradientChange(gradient, "commit");
  }

  gradientOverlayStartHandle.addEventListener(
    "pointerdown",
    function (ev: PointerEvent) {
      beginGradientDrag(ev, { kind: "endpoint", which: "start" });
    },
  );
  gradientOverlayEndHandle.addEventListener(
    "pointerdown",
    function (ev: PointerEvent) {
      beginGradientDrag(ev, { kind: "endpoint", which: "end" });
    },
  );

  function currentRotation(el) {
    var transform =
      el.style.transform || window.getComputedStyle(el).transform || "";
    var match = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
    if (match) return parseFloat(match[1]) || 0;
    if (transform && transform !== "none" && window.DOMMatrixReadOnly) {
      try {
        var matrix = new DOMMatrixReadOnly(transform);
        return Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI);
      } catch (err) {}
    }
    return 0;
  }

  function mergeRotation(el, degrees) {
    var inline = el.style.transform || "";
    var next = inline.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/)
      ? inline.replace(
          /rotate\((-?\d+(?:\.\d+)?)deg\)/,
          "rotate(" + degrees + "deg)",
        )
      : (inline && inline !== "none" ? inline + " " : "") +
        "rotate(" +
        degrees +
        "deg)";
    return next.trim();
  }

  function ensurePositionable(el) {
    var cs = window.getComputedStyle(el);
    if (cs.position === "static") {
      el.style.position = "relative";
      if (!el.style.left) el.style.left = "0px";
      if (!el.style.top) el.style.top = "0px";
    }
  }

  function postVisualStyleChange(styles) {
    if (!selectedEl) return;
    (window.parent as Window).postMessage(
      {
        type: "visual-style-change",
        selector: getSelector(selectedEl),
        styles: styles,
        payload: getElementInfo(selectedEl),
      },
      "*",
    );
  }

  function spacingValueFromPointer(
    handle,
    originValue,
    startX,
    startY,
    clientX,
    clientY,
  ) {
    var delta =
      handle.orientation === "vertical" ? clientX - startX : clientY - startY;
    if (
      handle.kind === "padding" &&
      (handle.side === "right" || handle.side === "bottom")
    ) {
      delta = -delta;
    }
    return clampSpacingValue(originValue + delta);
  }

  function applySpacingDragValue(
    target: Element,
    handle: {
      key: string;
      groupKey: string;
      kind: string;
      property: string;
      oppositeProperty: string;
      side: string;
      orientation: string;
      value: number;
      region: { x: number; y: number; width: number; height: number };
      line: { x: number; y: number; width: number; height: number } | undefined;
    } | null,
    value: number,
    mirrorOpposite: boolean,
  ): void {
    if (!target || !handle) return;
    target.style[handle.property] = value + "px";
    if (
      handle.kind === "padding" &&
      mirrorOpposite &&
      handle.oppositeProperty
    ) {
      target.style[handle.oppositeProperty] = value + "px";
    }
  }

  function startSpacingDrag(key, e) {
    if (spacingDrag) {
      stopNativeInteraction(e);
      return;
    }
    var handle = spacingHandleStateByKey[key];
    if (!selectedEl || !handle || isLayerInteractionBlocked(selectedEl)) return;
    clearSpacingHoverTimer();
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var events = dragEventNames(e);
    var dragEl = selectedEl;
    var originValue = handle.value;
    var originInlineValue = (dragEl as HTMLElement).style[handle.property];
    var originInlineOppositeValue = handle.oppositeProperty
      ? (dragEl as HTMLElement).style[handle.oppositeProperty]
      : "";
    var startX = e.clientX;
    var startY = e.clientY;
    lastSpacingPointerPoint = { x: startX, y: startY };
    hoveredSpacingHandleKey = key;
    selectedSpacingHovered = true;
    spacingDrag = {
      handle: handle,
      currentValue: originValue,
      mirrorOpposite: !!e.altKey,
    };
    // Hide the hover-only hatch fill the instant the drag begins (Figma-style:
    // hatch communicates "this is the resizable band" on hover; once dragging,
    // only the live value badge should be visible over the padding band).
    updateSpacingOverlay(selectedEl);
    showSpacingBadgeForHandle(handle, originValue);

    function updateSpacingDragMirrorState(mirrorOpposite: boolean) {
      if (!spacingDrag) return;
      if (spacingDrag.mirrorOpposite === mirrorOpposite) return;
      spacingDrag = {
        handle: handle,
        currentValue: spacingDrag.currentValue,
        mirrorOpposite: mirrorOpposite,
      };
      positionOverlay(selectionOverlay, dragEl);
      showSpacingBadgeForHandle(handle, spacingDrag.currentValue);
    }

    function cleanupSpacingDrag() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKey, true);
      clearActiveDragCancel(cancelSpacingDrag);
    }

    function restoreSpacingDragValue() {
      if (dragEl && document.documentElement.contains(dragEl)) {
        (dragEl as HTMLElement).style[handle.property] = originInlineValue;
        if (handle.oppositeProperty) {
          (dragEl as HTMLElement).style[handle.oppositeProperty] =
            originInlineOppositeValue;
        }
        selectedEl = dragEl;
        positionOverlay(selectionOverlay, dragEl);
      }
      spacingDrag = null;
      spacingBadge.style.display = "none";
    }

    function cancelSpacingDrag() {
      cleanupSpacingDrag();
      restoreSpacingDragValue();
      return true;
    }

    function onKey(ev) {
      if (ev.key === "Escape") {
        stopNativeInteraction(ev);
        cancelSpacingDrag();
        return;
      }
      if (ev.key !== "Alt") return;
      updateSpacingDragMirrorState(!!ev.altKey);
    }

    function onMove(ev) {
      if (!dragEl || !document.documentElement.contains(dragEl)) return;
      var nextValue = spacingValueFromPointer(
        handle,
        originValue,
        startX,
        startY,
        ev.clientX,
        ev.clientY,
      );
      spacingDrag = {
        handle: handle,
        currentValue: nextValue,
        mirrorOpposite: !!ev.altKey,
      };
      lastSpacingPointerPoint = { x: ev.clientX, y: ev.clientY };
      applySpacingDragValue(dragEl, handle, nextValue, !!ev.altKey);
      positionOverlay(selectionOverlay, dragEl);
      showSpacingBadgeForHandle(handle, nextValue);
    }

    function onUp(ev) {
      cleanupSpacingDrag();
      if (!dragEl || !document.documentElement.contains(dragEl)) {
        spacingDrag = null;
        spacingBadge.style.display = "none";
        return;
      }
      var finalValue = spacingDrag ? spacingDrag.currentValue : originValue;
      var mirrorOpposite = spacingDrag
        ? spacingDrag.mirrorOpposite
        : !!ev.altKey;
      applySpacingDragValue(dragEl, handle, finalValue, mirrorOpposite);
      selectedEl = dragEl;
      spacingDrag = null;
      var styles = {};
      styles[handle.property] = finalValue + "px";
      if (
        handle.kind === "padding" &&
        mirrorOpposite &&
        handle.oppositeProperty
      ) {
        styles[handle.oppositeProperty] = finalValue + "px";
      }
      postVisualStyleChange(styles);
      positionOverlay(selectionOverlay, dragEl);
    }

    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKey, true);
    setActiveDragCancel(cancelSpacingDrag);
  }

  function postTextContentChange(el, value, html) {
    (window.parent as Window).postMessage(
      {
        type: "text-content-change",
        selector: getSelector(el),
        value: value,
        html: html,
        payload: getElementInfo(el),
      },
      "*",
    );
  }

  function postTextEditingState(el: Element | null, active: boolean): void {
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    (window.parent as Window).postMessage(
      {
        type: "text-editing-state",
        active: !!active,
        selector: el ? getSelector(el) : "",
        hasRange: !!(
          active &&
          selection &&
          selection.rangeCount > 0 &&
          !selection.isCollapsed &&
          selectionBelongsToElement(selection, el)
        ),
      },
      "*",
    );
  }

  function insertPlainTextAtSelection(text: string): void {
    if (!text) return;
    if (
      document.queryCommandSupported &&
      document.queryCommandSupported("insertText")
    ) {
      document.execCommand("insertText", false, text);
      return;
    }
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    if (!selection || selection.rangeCount === 0) return;
    var range = selection.getRangeAt(0);
    range.deleteContents();
    var textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // T2: Figma-style text editing treats Enter as a line break while editing
  // (Escape or blur commits and exits). Uses the same insertText execCommand
  // path as insertPlainTextAtSelection so undo grouping/IME behavior matches,
  // falling back to a manual <br> insertion when insertText isn't supported.
  function insertLineBreak(): void {
    if (
      document.queryCommandSupported &&
      document.queryCommandSupported("insertText")
    ) {
      document.execCommand("insertText", false, "\n");
      return;
    }
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    if (!selection || selection.rangeCount === 0) return;
    var range = selection.getRangeAt(0);
    range.deleteContents();
    var br = document.createElement("br");
    range.insertNode(br);
    range.setStartAfter(br);
    range.setEndAfter(br);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // T12: applyTextRangeStyle wraps a fresh <span> per invocation, so repeated
  // scrub/commit cycles on the same range nest span chains
  // (<span><span><span>text</span></span></span>) that persist in saved HTML.
  // Collapse any run of nested spans that carry the exact same style
  // attribute and no other attributes down to a single span. Only merges
  // spans that are the sole child of their parent span (an exact 1:1 nesting,
  // not spans that merely overlap a wider range).
  function normalizeNestedIdenticalSpans(root: Element | null): void {
    if (!root) return;
    var spans = Array.prototype.slice.call(root.querySelectorAll("span"));
    for (var i = 0; i < spans.length; i += 1) {
      var span = spans[i];
      if (!span || !span.parentNode) continue;
      var parent = span.parentNode;
      while (
        parent &&
        parent.nodeType === 1 &&
        (parent as Element).tagName === "SPAN" &&
        (parent as Element).childNodes.length === 1 &&
        (parent as Element).getAttribute("style") ===
          span.getAttribute("style") &&
        (parent as Element).attributes.length === span.attributes.length
      ) {
        var grandparent = parent.parentNode;
        if (!grandparent) break;
        grandparent.insertBefore(span, parent);
        grandparent.removeChild(parent);
        parent = grandparent;
      }
    }
  }

  function selectionBelongsToElement(
    selection: Selection | null,
    el: Element | null,
  ): boolean {
    if (!selection || !el || selection.rangeCount === 0) return false;
    var range = selection.getRangeAt(0);
    var ancestor = range.commonAncestorContainer;
    var ancestorEl =
      ancestor && ancestor.nodeType === 1
        ? ancestor
        : ancestor && ancestor.parentElement;
    return !!(ancestorEl && (ancestorEl === el || el.contains(ancestorEl)));
  }

  function normalizeCssPropertyName(property: unknown): string {
    var prop = String(property || "").trim();
    if (!prop) return "";
    if (prop.indexOf("--") === 0) return prop;
    return prop.replace(/([A-Z])/g, "-$1").toLowerCase();
  }

  function applyInlineStyleProperty(
    el: HTMLElement | null,
    property: unknown,
    value: unknown,
  ): boolean {
    if (!el || !property) return false;
    var cssProperty = normalizeCssPropertyName(property);
    if (!cssProperty) return false;
    el.style.setProperty(cssProperty, String(value));
    return true;
  }

  // T12: if the current selection exactly covers an existing <span>'s content
  // (i.e. the user is re-scrubbing/re-applying a style to the same range
  // rather than a new sub-range), reuse that span instead of wrapping another
  // one around it. Without this, a scrub gesture that fires applyTextRangeStyle
  // many times per gesture nests a new <span> on every tick
  // (<span><span><span>text</span></span></span>), and those chains persist
  // in the saved HTML.
  function exactCoverSpanForRange(range: Range): HTMLSpanElement | null {
    var start = range.startContainer;
    var end = range.endContainer;
    if (start !== end) return null;

    // Shape A: start/end container IS the span itself, with node-offsets
    // spanning all of its children (this is what
    // Range.selectNodeContents(span) produces — offsets into an Element
    // container count child nodes, not characters).
    if (start.nodeType === 1) {
      var containerEl = start as HTMLElement;
      if (containerEl.tagName !== "SPAN") return null;
      if (containerEl.childNodes.length !== 1) return null;
      if (range.startOffset !== 0 || range.endOffset !== 1) return null;
      return containerEl as HTMLSpanElement;
    }

    // Shape B: start/end container is a text node, with character offsets
    // spanning its full length (this is what surroundContents +
    // selectNodeContents(span) round-trips to on a subsequent read, or what a
    // caller-constructed range over the text node directly looks like).
    if (start.nodeType !== 3) return null; // text node
    var parent = start.parentNode;
    if (!parent || parent.nodeType !== 1) return null;
    var el = parent as HTMLElement;
    if (el.tagName !== "SPAN") return null;
    // The span must contain exactly this one text node, and the range must
    // span the text node's full content (not a sub-range within it).
    if (el.childNodes.length !== 1 || el.childNodes[0] !== start) return null;
    if (
      range.startOffset !== 0 ||
      range.endOffset !== start.textContent!.length
    )
      return null;
    return el as HTMLSpanElement;
  }

  function applyTextRangeStyle(property: unknown, value: unknown): boolean {
    if (!activeTextEditEl || !property) return false;
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
      return false;
    if (!selectionBelongsToElement(selection, activeTextEditEl)) return false;
    var range = selection.getRangeAt(0);
    var reused = exactCoverSpanForRange(range);
    if (reused) {
      if (!applyInlineStyleProperty(reused, property, value)) return false;
      selection.removeAllRanges();
      var reusedRange = document.createRange();
      reusedRange.selectNodeContents(reused);
      selection.addRange(reusedRange);
      return true;
    }
    var span = document.createElement("span");
    applyInlineStyleProperty(span, property, value);
    if (!span.getAttribute("style")) return false;
    try {
      range.surroundContents(span);
    } catch (err) {
      var contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
    selection.removeAllRanges();
    var nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.addRange(nextRange);
    return true;
  }

  function showTransformBadge(
    text: string,
    clientX: number,
    clientY: number,
  ): void {
    // Constant-screen-size chrome (see showSpacingBadgeForHandle): scale the
    // label's intrinsic sizes by chromeLineScale() so the move/resize badge
    // reads the same at any canvas zoom.
    var line = chromeLineScale();
    transformBadge.textContent = text;
    transformBadge.style.display = "block";
    transformBadge.style.fontSize = 11 * line + "px";
    transformBadge.style.padding = 3 * line + "px " + 5 * line + "px";
    transformBadge.style.borderRadius = 4 * line + "px";
    transformBadge.style.borderWidth = 1 * line + "px";
    transformBadge.style.left = clientX + 12 * line + "px";
    transformBadge.style.top = clientY + 12 * line + "px";
  }

  function hideTransformBadge(): void {
    transformBadge.style.display = "none";
  }

  function hideInsertionGuide(): void {
    insertionGuide.style.display = "none";
  }

  function isOverlayElement(el: Element | null): boolean {
    // Use closest() so that children of overlay elements (e.g. spacing-region
    // spans inside selectionOverlay that have pointer-events:auto via a CSS rule
    // and can therefore still be returned by elementFromPoint even when the
    // parent overlay has pointer-events:none set inline) are also treated as
    // overlay elements and never used as drag-drop anchor targets.
    return Boolean(
      el && el.closest && el.closest("[data-agent-native-edit-overlay]"),
    );
  }

  function draggableElementChildren(parent: Element): Element[] {
    return Array.prototype.slice.call(parent.children).filter(function (child) {
      return (
        child.nodeType === 1 &&
        !isOverlayElement(child) &&
        !isLayerInteractionBlocked(child)
      );
    });
  }

  function isFlowReorderCandidate(el) {
    if (!el || !el.parentElement) return false;
    if (el === document.body || el === document.documentElement) return false;
    var cs = window.getComputedStyle(el);
    if (cs.position === "absolute" || cs.position === "fixed") return false;
    return true;
  }

  // Multi-select group move: when the user drags an element that is a member
  // of the current multi-selection (primary selectedEl + the passive
  // shift-click/marquee set), the whole group moves together — Figma
  // behavior. Returns the full member list in DOCUMENT ORDER (so a group
  // flow-insert lands the members consecutively in their existing visual
  // order) when gestureEl belongs to a 2+ selection, or just [gestureEl]
  // otherwise. Members nested inside another member are dropped: moving the
  // ancestor already moves them, and double-applying the delta would fling
  // them.
  function collectMoveGroupMembers(gestureEl: Element): Element[] {
    if (!gestureEl) return [];
    var raw: Element[] = [];
    if (selectedEl) raw.push(selectedEl);
    for (var i = 0; i < passiveSelectionEls.length; i += 1) {
      raw.push(passiveSelectionEls[i]);
    }
    var members: Element[] = [];
    for (var j = 0; j < raw.length; j += 1) {
      var candidate = raw[j];
      if (
        !candidate ||
        candidate === document.body ||
        candidate === document.documentElement ||
        !document.documentElement.contains(candidate) ||
        isLayerInteractionBlocked(candidate) ||
        members.indexOf(candidate) !== -1
      ) {
        continue;
      }
      members.push(candidate);
    }
    // Drop members contained by another member.
    members = members.filter(function (member) {
      return !members.some(function (other) {
        return other !== member && other.contains(member);
      });
    });
    var gestureMember: Element | null = null;
    for (var k = 0; k < members.length; k += 1) {
      if (
        members[k] === gestureEl ||
        (members[k].contains && members[k].contains(gestureEl))
      ) {
        gestureMember = members[k];
        break;
      }
    }
    if (!gestureMember || members.length < 2) return [gestureEl];
    members.sort(function (a, b) {
      var position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return members;
  }

  // Resolves the group member that owns a drag gesture's target element (the
  // member itself or an ancestor member), or null when the target is not
  // part of the current multi-selection.
  function groupMemberForGestureTarget(target: Element | null): Element | null {
    if (!target) return null;
    var raw: Element[] = selectedEl
      ? [selectedEl].concat(passiveSelectionEls)
      : passiveSelectionEls.slice();
    for (var i = 0; i < raw.length; i += 1) {
      var member = raw[i];
      if (
        member &&
        document.documentElement.contains(member) &&
        (member === target || (member.contains && member.contains(target)))
      ) {
        return member;
      }
    }
    return null;
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

  // Figma-parity "drop into a frame" conversion: when a plain rect/div drop
  // target isn't already auto-layout, dropping a child into it turns it into
  // one. Direction/gap are inferred from the container's existing children
  // (same spread-axis heuristic as inferAutoLayoutFromChildren in
  // DesignEditor.tsx: whichever axis the children's bounding boxes spread
  // further along wins) when it already has other children; an empty
  // container defaults to flex-direction:column, matching the product
  // decision for a fresh single-child drop with no layout signal yet.
  function inferAutoLayoutConversionForContainer(
    container: Element,
    excludeEls: Element[],
  ): { direction: "row" | "column"; gap: number } {
    var siblings = draggableElementChildren(container).filter(function (child) {
      return excludeEls.indexOf(child) === -1;
    });
    if (siblings.length === 0) {
      return { direction: "column", gap: 10 };
    }
    var rects = siblings.map(function (child) {
      return child.getBoundingClientRect();
    });
    var minX = Math.min.apply(
      null,
      rects.map(function (r) {
        return r.left;
      }),
    );
    var maxX = Math.max.apply(
      null,
      rects.map(function (r) {
        return r.left + r.width;
      }),
    );
    var minY = Math.min.apply(
      null,
      rects.map(function (r) {
        return r.top;
      }),
    );
    var maxY = Math.max.apply(
      null,
      rects.map(function (r) {
        return r.top + r.height;
      }),
    );
    var direction: "row" | "column" =
      maxX - minX >= maxY - minY ? "row" : "column";
    if (rects.length < 2) {
      return { direction: direction, gap: 10 };
    }
    var sorted = rects.slice().sort(function (a, b) {
      return direction === "row" ? a.left - b.left : a.top - b.top;
    });
    var gaps: number[] = [];
    for (var i = 1; i < sorted.length; i += 1) {
      var prev = sorted[i - 1];
      var current = sorted[i];
      var gapValue =
        direction === "row"
          ? current.left - (prev.left + prev.width)
          : current.top - (prev.top + prev.height);
      if (isFinite(gapValue) && gapValue > 0) gaps.push(gapValue);
    }
    if (gaps.length === 0) {
      return { direction: direction, gap: 10 };
    }
    gaps.sort(function (a, b) {
      return a - b;
    });
    var mid = Math.floor(gaps.length / 2);
    var median =
      gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
    return { direction: direction, gap: Math.round(median) };
  }

  // Applies the flex conversion to `container` and posts it to the host as a
  // normal visual-style-change for that container's own selector/elementInfo
  // — the same message shape the style panel already uses, just targeting
  // the drop-target anchor instead of the current selection, so no host-side
  // routing changes are needed. Runs BEFORE the moved-element's own
  // visual-structure-change post so the host's synchronous same-tick content
  // refs (see DesignEditor.tsx's getFreshActiveContent) compose the two
  // edits in order: container becomes flex, then the child moves into it.
  // `excludeEls`: the dragged element(s) — every member of a group drag —
  // so the direction/gap inference only looks at the container's existing
  // children, never the incoming ones.
  function applyAutoLayoutConversionForDrop(
    container: Element,
    excludeEls: Element[],
  ): void {
    var inferred = inferAutoLayoutConversionForContainer(container, excludeEls);
    var el = container as HTMLElement;
    el.style.display = "flex";
    el.style.flexDirection = inferred.direction;
    el.style.gap = inferred.gap + "px";
    (window.parent as Window).postMessage(
      {
        type: "visual-style-change",
        selector: getSelector(container),
        styles: {
          display: "flex",
          "flex-direction": inferred.direction,
          gap: inferred.gap + "px",
        },
        payload: getElementInfo(container),
      },
      "*",
    );
  }

  // ── Board-text auto-color adaptation on nest ─────────────────────────────
  //
  // Board-drawn text on the dark infinite canvas gets an explicit inline
  // default `color:#ffffff` (+ Inter) from DesignEditor's
  // appendCanvasPrimitiveToHtml — necessary there because "currentColor"
  // would inherit the unstyled document's black and vanish on the dark
  // board. But when that text is later dragged INTO a (typically light)
  // container, the stale inline white makes it white-on-white invisible.
  //
  // On re-parent into a different container, adapt: if the text's inline
  // color is the auto-applied board default (marker present, or —
  // pre-marker content — exactly the default white AND the destination is
  // light), switch it to `color:inherit` so it picks up the container's
  // effective text color. A color the user explicitly set is NEVER touched:
  // DesignEditor should stamp `data-an-auto-text-color` when IT auto-picks
  // the color at creation and remove the marker on any explicit color edit;
  // when the marker is present the color is definitely auto (always safe to
  // adapt), and when absent the conservative default-white + light-target
  // heuristic below only fires in the exact case where the text would be
  // invisible anyway.
  var BOARD_TEXT_AUTO_COLOR_MARKER = "data-an-auto-text-color";

  function parseCssRgb(
    value: string,
  ): { r: number; g: number; b: number; a: number } | null {
    var match = /^rgba?\(([^)]+)\)$/.exec((value || "").trim());
    if (!match) return null;
    var parts = match[1].split(",").map(function (part) {
      return parseFloat(part.trim());
    });
    if (parts.length < 3 || parts.some(isNaN)) return null;
    return {
      r: parts[0],
      g: parts[1],
      b: parts[2],
      a: parts.length > 3 ? parts[3] : 1,
    };
  }

  // Walks up from the container until it finds a non-transparent computed
  // background and reports whether it is light (relative-luminance
  // threshold). An unstyled chain means the default white page background.
  function containerBackgroundIsLight(container: Element): boolean {
    var cursor: Element | null = container;
    while (cursor && cursor !== document.documentElement) {
      var bg = window.getComputedStyle(cursor).backgroundColor;
      var rgb = parseCssRgb(bg);
      if (rgb && rgb.a > 0.01) {
        var luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
        return luminance > 150;
      }
      cursor = cursor.parentElement;
    }
    return true;
  }

  function adaptAutoTextColorForNest(
    member: Element,
    container: Element | null,
  ): void {
    if (!container || member.parentElement === container) return;
    var kind = (
      member.getAttribute("data-an-primitive") ||
      member.getAttribute("data-agent-native-primitive") ||
      ""
    ).toLowerCase();
    if (kind !== "text") return;
    var el = member as HTMLElement;
    var inline = el.style.color;
    if (!inline || inline === "inherit" || inline === "currentcolor") return;
    var hasAutoMarker = member.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER);
    if (!hasAutoMarker) {
      var normalized = inline.replace(/\s+/g, "").toLowerCase();
      var isDefaultWhite =
        normalized === "#ffffff" ||
        normalized === "#fff" ||
        normalized === "rgb(255,255,255)" ||
        normalized === "white";
      if (!isDefaultWhite) return;
      if (!containerBackgroundIsLight(container)) return;
    }
    el.style.color = "inherit";
    (window.parent as Window).postMessage(
      {
        type: "visual-style-change",
        selector: getSelector(member),
        styles: { color: "inherit" },
        payload: getElementInfo(member),
      },
      "*",
    );
  }

  // Resolves the actual container element a drop target lands the moved
  // element(s) in: the anchor itself for "inside" placement, otherwise the
  // anchor's parent.
  function dropContainerForTarget(target): Element | null {
    if (!target || !target.anchor) return null;
    return target.placement === "inside"
      ? target.anchor
      : target.anchor.parentElement;
  }

  function isOutsideIframeViewport(clientX: number, clientY: number): boolean {
    return (
      clientX < 0 ||
      clientY < 0 ||
      clientX > window.innerWidth ||
      clientY > window.innerHeight
    );
  }

  function postCrossScreenDrag(
    phase: "start" | "move" | "end" | "cancel",
    el?: Element | null,
    ev?: { clientX?: number; clientY?: number } | null,
  ): void {
    if (phase === "cancel") {
      activeCrossScreenStyleSnapshot = undefined;
      (window.parent as Window).postMessage(
        { type: "agent-native:cross-screen-drag", phase: "cancel" },
        "*",
      );
      return;
    }
    if (phase === "start") {
      activeCrossScreenStyleSnapshot = collectPortableStyleSnapshot(el ?? null);
    }
    var rect = el ? el.getBoundingClientRect() : null;
    var pointerOffset =
      rect && ev?.clientX !== undefined && ev.clientY !== undefined
        ? {
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
          }
        : undefined;
    (window.parent as Window).postMessage(
      {
        type: "agent-native:cross-screen-drag",
        phase,
        screenId: designCanvasScreenId,
        boardSurface: designCanvasBoardSurface,
        selector: getSelector(el ?? null),
        sourceId: getSourceId(el ?? null),
        iframeX: ev?.clientX ?? 0,
        iframeY: ev?.clientY ?? 0,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        elementRect: rect
          ? {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }
          : undefined,
        pointerOffset,
        styleSnapshot: activeCrossScreenStyleSnapshot,
      },
      "*",
    );
    if (phase === "end") {
      activeCrossScreenStyleSnapshot = undefined;
    }
  }

  // keep in sync with EditPanel.tsx CONTAINER_TAGS/LEAF_TAGS (~line 1679)
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

  function isContainerDropTarget(el: Element | null): boolean {
    if (!el || el === document.documentElement) return false;
    if (isOverlayElement(el) || isLayerInteractionBlocked(el)) return false;
    if (el === document.body) return true;
    var tag = (el.tagName || "").toLowerCase();
    // Reject leaf/text tags — they cannot accept children
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
    ) {
      return true;
    }
    return BRIDGE_CONTAINER_TAGS.indexOf(tag) !== -1;
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

  function parentFlowAxis(parent: Element): string {
    var cs = window.getComputedStyle(parent);
    if (cs.display === "flex" || cs.display === "inline-flex") {
      var isRow = cs.flexDirection && cs.flexDirection.indexOf("row") === 0;
      // Wrapping row containers need Y-axis awareness for inter-row targeting;
      // fall back to column-axis insertion so the heuristic picks the right row.
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

  // Resolves a between-children insertion inside `container` from the
  // pointer position: the nearest visible child (by flow-axis center)
  // becomes the anchor with before/after placement, which renders as the
  // Figma-style insertion LINE between children. Returns null when the
  // container has no eligible children (caller falls back to "inside").
  //
  // This is the B5-4 fix: hovering the container's own background — its
  // padding, or the gaps BETWEEN children, which is where the pointer
  // naturally sits when dropping "between two cards" — used to resolve to
  // placement "inside" (appendChild = always lands after the LAST child,
  // with the container-fill affordance instead of an insertion line). Both
  // in-screen drag paths now route container-background hits through this
  // helper so dropping between children works and shows the line.
  function nearestChildInsertionTarget(
    container: Element,
    clientX: number,
    clientY: number,
    excludeEls?: Element[],
  ) {
    var excluded: Element[] = excludeEls || [];
    function isExcluded(node) {
      for (var i = 0; i < excluded.length; i += 1) {
        var member = excluded[i];
        if (
          member &&
          (member === node || (member.contains && member.contains(node)))
        ) {
          return true;
        }
      }
      return false;
    }
    var children = draggableElementChildren(container).filter(function (child) {
      return !isExcluded(child);
    });
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

  // `excludeEls` (optional): other members of a multi-select group drag.
  // They can never be the anchor/target of their own group's reorder (that
  // would insert the group relative to an element that is itself about to
  // move), so hits on them fall through to the sibling-scan fallback and the
  // sibling scan skips them.
  function reorderTargetForPoint(el, clientX, clientY, excludeEls) {
    if (!el || !el.parentElement) return null;
    var dragged: Element[] = [el].concat(excludeEls || []);
    function isDraggedOrInsideDragged(node) {
      for (var di = 0; di < dragged.length; di += 1) {
        var member = dragged[di];
        if (
          member &&
          (member === node || (member.contains && member.contains(node)))
        ) {
          return true;
        }
      }
      return false;
    }
    var hit = elementFromEditorPoint(clientX, clientY);
    if (
      hit &&
      hit !== document.documentElement &&
      !isDraggedOrInsideDragged(hit) &&
      !isOverlayElement(hit)
    ) {
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
          // B5-4: the pointer is over the container's inner area — its
          // padding or the gap BETWEEN children (a direct child under the
          // pointer would have been the hit instead). Resolve to the
          // nearest child slot so the drop lands between children with the
          // insertion LINE, instead of the old placement:"inside" append-
          // after-last with only the container-fill affordance.
          var betweenChildren = nearestChildInsertionTarget(
            hit,
            clientX,
            clientY,
            dragged,
          );
          if (betweenChildren) return betweenChildren;
          return {
            anchor: hit,
            placement: "inside",
            axis: parentFlowAxis(hit),
            dropMode: isAbsolutePrimitiveContainer(hit)
              ? "absolute-container"
              : "flow-insert",
          };
        }
        return {
          anchor: hit,
          placement: edgePlacement,
          axis: edgeAxis,
          dropMode: "flow-insert",
        };
      }
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
          dropMode: "flow-insert",
        };
      }
    }
    var parent = el.parentElement;
    var axis = parentFlowAxis(parent);
    var siblings = draggableElementChildren(parent).filter(function (child) {
      return !isDraggedOrInsideDragged(child);
    });
    if (!siblings.length) return null;
    var beforeTarget = null;
    for (var i = 0; i < siblings.length; i += 1) {
      var rect = siblings[i].getBoundingClientRect();
      var center =
        axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      var pointer = axis === "x" ? clientX : clientY;
      if (pointer < center) {
        beforeTarget = siblings[i];
        break;
      }
    }
    var anchor = beforeTarget || siblings[siblings.length - 1];
    var placement = beforeTarget ? "before" : "after";
    return {
      anchor: anchor,
      placement: placement,
      axis: axis,
      dropMode: "flow-insert",
    };
  }

  // Accepts a single element or an array (group drags temporarily disable
  // pointer-events on EVERY dragged member so the hit test sees what's
  // underneath the whole group, not a sibling member riding along under the
  // pointer).
  function elementFromEditorPointIgnoring(
    clientX: number,
    clientY: number,
    ignore: Element | Element[] | null,
  ): Element | null {
    var ignoreList: HTMLElement[] = [];
    var previousPointerEvents: string[] = [];
    (Array.isArray(ignore) ? ignore : ignore ? [ignore] : []).forEach(
      function (item) {
        if (item && item instanceof HTMLElement) {
          ignoreList.push(item);
          previousPointerEvents.push(item.style.pointerEvents);
          item.style.pointerEvents = "none";
        }
      },
    );
    var hit = elementFromEditorPoint(clientX, clientY);
    ignoreList.forEach(function (item, index) {
      item.style.pointerEvents = previousPointerEvents[index] ?? "";
    });
    return hit;
  }

  // Item 8 — re-parent policy for absolute-position drags (this function
  // feeds onMove's currentAutoLayoutTarget for the isFlowReorderCandidate
  // === false path, i.e. plain absolute-positioned elements/shapes, NOT flow
  // children — see reorderTargetForPoint above for that separate case).
  //
  // PRODUCT DECISION (supersedes the old "genuine auto-layout only" policy
  // below): dragging one element onto another must nest it as a child with
  // auto-layout, exactly like dropping an element into a frame in Figma —
  // this applies to plain rectangles/divs too, not just existing flex/grid
  // containers. `isContainerDropTarget` (below) is the single nestable-
  // container test shared with reorderTargetForPoint's flow-reorder path and
  // the overview canvas's getPrimitiveDropTargetForPoint, so in-screen and
  // cross-screen drag agree on what counts as a container: any block-level
  // element that can hold children (plain divs/sections/etc. included),
  // excluding text/leaf tags, overlay chrome, and the dragged element's own
  // descendants (cycle guard). When the resolved container is not already an
  // auto-layout (flex/grid) display, the caller (onUp) converts it to
  // display:flex on drop — see needsAutoLayoutConversion below and
  // applyAutoLayoutConversionForDrop.
  //
  // (Historical note: an earlier revision of this policy matched ANY
  // absolute-positioned rect primitive as a drop-into target purely from
  // pointer overlap, with no leaf/text exclusion and no cycle guard, which
  // caused two merely-overlapping absolute elements to silently adopt one
  // another. isContainerDropTarget's tag/role checks plus the cursor
  // ancestor-walk's cycle guard below are what keep this version scoped to
  // Figma's actual "drop into a frame" behavior instead of that regression.)
  // `excludeEls` (optional): additional dragged elements to treat exactly
  // like `el` — used by multi-select group drags so no member of the moving
  // group is hit-tested, walked through, or offered as a nesting container
  // for its own group.
  function autoLayoutInsertionTargetForPoint(el, clientX, clientY, excludeEls) {
    var dragged: Element[] = [el].concat(excludeEls || []);
    function isDraggedOrInsideDragged(node) {
      for (var i = 0; i < dragged.length; i += 1) {
        var member = dragged[i];
        if (
          member &&
          (member === node || (member.contains && member.contains(node)))
        ) {
          return true;
        }
      }
      return false;
    }
    var hit = elementFromEditorPointIgnoring(clientX, clientY, dragged);
    if (!hit || hit === document.documentElement || hit === document.body) {
      return null;
    }
    var cursor = hit;
    while (cursor && cursor !== document.body) {
      if (
        isDraggedOrInsideDragged(cursor) ||
        isOverlayElement(cursor) ||
        isLayerInteractionBlocked(cursor)
      ) {
        cursor = cursor.parentElement;
        continue;
      }
      // document.body is excluded as a nesting target here (both branches
      // below): it is the screen root, not a Figma-style frame, so hovering
      // loose background — including hovering a leaf like an image or text
      // node whose parent happens to be body — must fall through to a plain
      // absolute placement instead of silently wrapping body in auto-layout.
      var parent = cursor.parentElement;
      if (parent && parent !== document.body && isContainerDropTarget(parent)) {
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
          needsAutoLayoutConversion: !isAutoLayoutElement(parent),
          conversionTarget: parent,
        };
      }
      if (cursor !== document.body && isContainerDropTarget(cursor)) {
        // B5-4 (absolute path): pointer over the container's own background
        // — its padding or a gap between children. Prefer the nearest child
        // slot (insertion line at the pointer index) over plain "inside"
        // (which appends after the last child); fall back to "inside" only
        // for containers with no visible children.
        var betweenContainerChildren = nearestChildInsertionTarget(
          cursor,
          clientX,
          clientY,
          dragged,
        );
        if (betweenContainerChildren) {
          return {
            anchor: betweenContainerChildren.anchor,
            placement: betweenContainerChildren.placement,
            axis: betweenContainerChildren.axis,
            dropMode: "flow-insert",
            needsAutoLayoutConversion: !isAutoLayoutElement(cursor),
            conversionTarget: cursor,
          };
        }
        return {
          anchor: cursor,
          placement: "inside",
          axis: parentFlowAxis(cursor),
          dropMode: "flow-insert",
          needsAutoLayoutConversion: !isAutoLayoutElement(cursor),
          conversionTarget: cursor,
        };
      }
      cursor = parent;
    }
    return null;
  }

  function showInsertionGuideFor(target) {
    if (!target || !target.anchor) {
      hideInsertionGuide();
      return;
    }
    // Compensate for the host's inverse-scale chrome model (see
    // applyEditorChromeScale / chromeLineScale): the host shrinks this iframe
    // via a CSS transform at low canvas zoom, so a hardcoded "2px" line here
    // would render sub-pixel (effectively invisible) at typical overview zoom
    // levels — this was the actual regression, not a missing code path. Every
    // other chrome line/border in this file (selection border, spacing lines,
    // handle borders) already scales by chromeLineScale(); the insertion
    // guide must match so it stays a visible bright line at any zoom.
    var line = 2 * chromeLineScale();
    var insideBorder = 2 * chromeLineScale();
    var rect = target.anchor.getBoundingClientRect();
    insertionGuide.style.display = "block";
    insertionGuide.style.background = "var(--design-editor-accent-color)";
    insertionGuide.style.border = "0";
    insertionGuide.style.borderRadius = "999px";
    insertionGuide.style.boxShadow =
      "0 0 0 1px var(--design-editor-accent-color)";
    if (target.placement === "inside") {
      insertionGuide.style.left = rect.left + "px";
      insertionGuide.style.top = rect.top + "px";
      insertionGuide.style.width = rect.width + "px";
      insertionGuide.style.height = rect.height + "px";
      insertionGuide.style.background =
        "color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)";
      insertionGuide.style.border =
        insideBorder + "px solid var(--design-editor-accent-color)";
      insertionGuide.style.borderRadius = "2px";
      insertionGuide.style.boxShadow = "none";
      return;
    }
    if (target.axis === "x") {
      var x = target.placement === "before" ? rect.left : rect.right;
      insertionGuide.style.left = x - line / 2 + "px";
      insertionGuide.style.top = rect.top + "px";
      insertionGuide.style.width = line + "px";
      insertionGuide.style.height = rect.height + "px";
    } else {
      var y = target.placement === "before" ? rect.top : rect.bottom;
      insertionGuide.style.left = rect.left + "px";
      insertionGuide.style.top = y - line / 2 + "px";
      insertionGuide.style.width = rect.width + "px";
      insertionGuide.style.height = line + "px";
    }
  }

  function applyRuntimeReorder(el, target) {
    if (!el || !target || !target.anchor || !target.anchor.parentElement)
      return;
    if (target.placement === "inside") {
      target.anchor.appendChild(el);
      return;
    }
    var parent = target.anchor.parentElement;
    if (target.placement === "before") {
      parent.insertBefore(el, target.anchor);
    } else {
      parent.insertBefore(el, target.anchor.nextSibling);
    }
  }

  function postVisualStructureChange(el, target, origin) {
    if (!el || !target || !target.anchor) return;
    var requestId =
      "move-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    pendingStructureMoves[requestId] = {
      requestId: requestId,
      el: el,
      target: target,
      origin: origin || null,
    };
    (window.parent as Window).postMessage(
      {
        type: "visual-structure-change",
        requestId: requestId,
        selector: getSelector(el),
        sourceId: getSourceId(el),
        anchorSelector: getSelector(target.anchor),
        anchorSourceId: getSourceId(target.anchor),
        placement: target.placement,
        dropMode: target.dropMode || "flow-insert",
        sourceRect: rectInfoForElement(el),
        anchorRect: rectInfoForElement(target.anchor),
        payload: getElementInfo(el),
      },
      "*",
    );
  }

  function postVisualDuplicateChange(originalEl, cloneEl, target) {
    if (!originalEl || !cloneEl) return;
    (window.parent as Window).postMessage(
      {
        type: "visual-duplicate-change",
        selector: getSelector(originalEl),
        sourceId: getSourceId(originalEl),
        anchorSelector:
          target && target.anchor ? getSelector(target.anchor) : "",
        anchorSourceId:
          target && target.anchor ? getSourceId(target.anchor) : "",
        placement: target && target.placement ? target.placement : "after",
        cloneHtml: cloneEl.outerHTML,
        payload: getElementInfo(cloneEl),
      },
      "*",
    );
  }

  // Multi-select group drop: land every member of the group CONSECUTIVELY at
  // the drop target, preserving their existing document order (standard
  // design-tool group-drop semantics). `members` must already be in document
  // order (collectMoveGroupMembers guarantees it). The first member takes the
  // real drop target; each subsequent member chains "after" the previous one
  // so the group stays contiguous regardless of the target placement mode.
  // Persistence reuses the existing per-element visual-structure-change
  // message — one per member, posted in order, which the host composes
  // sequentially against its synchronous same-tick content refs (the same
  // established multi-message pattern as the auto-layout conversion +
  // structure change pairing in onUp). The host handler collapses its
  // selection to each moved node as it processes each message, so a final
  // marquee-selection message restores the full multi-selection afterwards
  // (requirement: selection stays intact after a group drop).
  function applyGroupStructureDrop(members: Element[], target, ev): void {
    var container = dropContainerForTarget(target);
    var previous: Element | null = null;
    for (var i = 0; i < members.length; i += 1) {
      var member = members[i];
      var memberTarget =
        i === 0
          ? target
          : target.dropMode === "absolute-container"
            ? target
            : {
                anchor: previous,
                placement: "after",
                axis: target.axis,
                dropMode: "flow-insert",
              };
      var prevParent = member.parentElement;
      var prevNextSibling = member.nextSibling;
      // Board-text auto-color: adapt before the DOM move so the re-parent
      // check sees the ORIGINAL parent (see adaptAutoTextColorForNest).
      adaptAutoTextColorForNest(member, container);
      applyRuntimeReorder(member, memberTarget);
      postVisualStructureChange(member, memberTarget, {
        prevParent: prevParent,
        prevNextSibling: prevNextSibling,
      });
      previous = member;
    }
    postElementMarqueeSelect(members, false, ev);
  }

  // ── Alignment / smart-guide snapping (Figma parity) ───────────────────────
  //
  // Minimal, dependency-free port of the overview canvas's edge/center snap
  // routine (shared/canvas-math.ts computeMoveSnap) for in-iframe element
  // dragging. The bridge's pointer coordinates and getBoundingClientRect()
  // values are already in the same iframe-local, zoom-normalized coordinate
  // space (the host CSS-scales the whole iframe, not individual elements),
  // so — unlike the overview canvas, which divides a screen-px threshold by
  // its own camera zoom — no extra scale correction is needed here.
  var SNAP_THRESHOLD_PX = 6;
  var SNAP_CANDIDATE_CAP = 200;

  // Accepts either a real DOMRect (getBoundingClientRect()) or a plain
  // {left, top, width, height} object (the moving element's live drag rect,
  // which doesn't have its own DOMRect during the drag since it's derived
  // from pointer deltas) — right/bottom are always derived from
  // left/top/width/height so both shapes work identically.
  function rectBounds(rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };
  }

  // Collects candidate rects to snap against: visible sibling elements that
  // share the dragged element's offsetParent, plus the parent's own content
  // box. Capped and computed once (one getBoundingClientRect pass) at drag
  // start rather than per move event, per the perf requirement below.
  // `excludeEls` (optional): other members of a multi-select group drag —
  // they move together with dragEl, so snapping against them would chase a
  // moving target.
  function collectSnapCandidateRects(dragEl, excludeEls) {
    var rects = [];
    var excluded: Element[] = excludeEls || [];
    var parent = dragEl && dragEl.parentElement;
    if (parent) {
      var parentRect = parent.getBoundingClientRect();
      if (parentRect.width > 0 && parentRect.height > 0) {
        rects.push(rectBounds(parentRect));
      }
    }
    var offsetParent = dragEl && (dragEl as HTMLElement).offsetParent;
    if (parent) {
      var siblings = Array.prototype.slice.call(parent.children);
      for (
        var i = 0;
        i < siblings.length && rects.length < SNAP_CANDIDATE_CAP;
        i += 1
      ) {
        var sibling = siblings[i];
        if (
          !sibling ||
          sibling === dragEl ||
          excluded.indexOf(sibling) !== -1 ||
          sibling.nodeType !== 1 ||
          isOverlayElement(sibling)
        ) {
          continue;
        }
        if (
          offsetParent &&
          (sibling as HTMLElement).offsetParent !== offsetParent
        ) {
          continue;
        }
        var cs = window.getComputedStyle(sibling);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        var rect = sibling.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        rects.push(rectBounds(rect));
      }
    }
    return rects;
  }

  // Mirrors getAxisSnapCandidates/getBestCandidate/getVerticalGuide/
  // getHorizontalGuide from shared/canvas-math.ts: for each axis, compare the
  // moving rect's left/center/right (or top/center/bottom) against every
  // candidate's same three values and keep the closest match within
  // threshold. Exported off the IIFE closure via the return-value shape below
  // so tests can exercise it directly (see the "extractable pure logic"
  // convention used by motion-preview.bridge.ts).
  function computeMoveSnapOffset(movingRect, candidates, threshold) {
    var moving = rectBounds(movingRect);
    var bestX = null;
    var bestY = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      var xValues = [moving.left, moving.centerX, moving.right];
      var xTargets = [candidate.left, candidate.centerX, candidate.right];
      for (var xi = 0; xi < xValues.length; xi += 1) {
        for (var xj = 0; xj < xTargets.length; xj += 1) {
          var offsetX = xTargets[xj] - xValues[xi];
          var distanceX = Math.abs(offsetX);
          if (distanceX > threshold) continue;
          if (!bestX || distanceX < bestX.distance) {
            bestX = {
              distance: distanceX,
              offset: offsetX,
              guide: {
                position: xTargets[xj],
                start: Math.min(moving.top, candidate.top),
                end: Math.max(moving.bottom, candidate.bottom),
              },
            };
          }
        }
      }
      var yValues = [moving.top, moving.centerY, moving.bottom];
      var yTargets = [candidate.top, candidate.centerY, candidate.bottom];
      for (var yi = 0; yi < yValues.length; yi += 1) {
        for (var yj = 0; yj < yTargets.length; yj += 1) {
          var offsetY = yTargets[yj] - yValues[yi];
          var distanceY = Math.abs(offsetY);
          if (distanceY > threshold) continue;
          if (!bestY || distanceY < bestY.distance) {
            bestY = {
              distance: distanceY,
              offset: offsetY,
              guide: {
                position: yTargets[yj],
                start: Math.min(moving.left, candidate.left),
                end: Math.max(moving.right, candidate.right),
              },
            };
          }
        }
      }
    }
    return {
      dx: bestX ? bestX.offset : 0,
      dy: bestY ? bestY.offset : 0,
      guideV: bestX ? bestX.guide : null,
      guideH: bestY ? bestY.guide : null,
    };
  }

  function showSnapGuides(guideV, guideH) {
    // Constant-screen-size chrome: guide THICKNESS compensates for the
    // host's iframe scale (chromeLineScale) so the line stays a crisp 1px
    // on screen at any zoom; the guide's span/position stays in content
    // coordinates.
    var line = 1 * chromeLineScale();
    if (guideV) {
      snapGuideV.style.display = "block";
      snapGuideV.style.width = line + "px";
      snapGuideV.style.left = Math.round(guideV.position) + "px";
      snapGuideV.style.top = Math.round(guideV.start) + "px";
      snapGuideV.style.height = Math.max(1, guideV.end - guideV.start) + "px";
    } else {
      snapGuideV.style.display = "none";
    }
    if (guideH) {
      snapGuideH.style.display = "block";
      snapGuideH.style.height = line + "px";
      snapGuideH.style.top = Math.round(guideH.position) + "px";
      snapGuideH.style.left = Math.round(guideH.start) + "px";
      snapGuideH.style.width = Math.max(1, guideH.end - guideH.start) + "px";
    } else {
      snapGuideH.style.display = "none";
    }
  }

  function hideSnapGuides() {
    snapGuideV.style.display = "none";
    snapGuideH.style.display = "none";
  }

  // `gestureElParam` (optional): the specific multi-selection member the
  // pointer went down on when this drag preserves a 2+ selection instead of
  // collapsing to one element (see beginPotentialShieldDrag's group branch).
  // Defaults to selectedEl — the selection-overlay drag path.
  function startMove(e, gestureElParam?: Element) {
    var gestureEl = gestureElParam || selectedEl;
    if (!gestureEl) return;
    if (isLayerInteractionBlocked(gestureEl)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var events = dragEventNames(e);
    var originalSelectedEl = selectedEl;
    var duplicatedForDrag = false;
    if (
      e.altKey &&
      selectedEl &&
      selectedEl !== document.body &&
      selectedEl !== document.documentElement
    ) {
      var clone = selectedEl.cloneNode(true);
      resetRuntimeStableIds(clone);
      selectedEl.parentElement.insertBefore(clone, selectedEl.nextSibling);
      selectedEl = clone;
      duplicatedForDrag = true;
      gestureEl = clone;
      positionOverlay(selectionOverlay, selectedEl);
      postElementSelect(selectedEl, e);
    }
    // Multi-select group move: every member of the current 2+ selection moves
    // with the gesture when the drag started on a member. Alt-drag duplicates
    // stay single-element (the clone is never part of a selection group).
    var groupEls: Element[] =
      duplicatedForDrag || e.altKey
        ? [gestureEl]
        : collectMoveGroupMembers(gestureEl);
    if (groupEls.indexOf(gestureEl) === -1) groupEls = [gestureEl];
    var isGroupDrag = groupEls.length > 1;
    var groupOthers = groupEls.filter(function (member) {
      return member !== gestureEl;
    });
    if (isGroupDrag) {
      // beginPotentialShieldDrag armed the host's cross-screen drag state for
      // a single element before this group drag was detected; clear it. Group
      // drags stay in-iframe — the host's cross-screen drop only knows how to
      // move one element, which would tear the group apart.
      postCrossScreenDrag("cancel");
    }
    if (isFlowReorderCandidate(gestureEl)) {
      // Snapshot the element being reordered so a concurrent select-element or
      // clear-selection postMessage cannot mutate the wrong element mid-drag.
      var reorderEl = gestureEl;
      var currentTarget = reorderTargetForPoint(
        reorderEl,
        e.clientX,
        e.clientY,
        groupOthers,
      );
      showInsertionGuideFor(currentTarget);
      // Cross-screen drag state: true when the pointer is outside this iframe's
      // viewport bounds.  The host frame renders the ghost + highlight and owns
      // the drop when this is true; the bridge suppresses its in-iframe reorder.
      var pointerOutsideIframe = false;
      var reorderSelector = getSelector(reorderEl);
      var reorderSourceId = getSourceId(reorderEl);
      var reorderStyleSnapshot = collectPortableStyleSnapshot(reorderEl);
      var reorderRect = reorderEl.getBoundingClientRect();
      var reorderPointerOffset = {
        x: e.clientX - reorderRect.left,
        y: e.clientY - reorderRect.top,
      };
      function onReorderMove(ev) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cx = ev.clientX;
        var cy = ev.clientY;
        var outside = cx < 0 || cy < 0 || cx > vw || cy > vh;
        pointerOutsideIframe = outside;
        // Always notify the host frame so it can track the cursor position,
        // render the ghost, and highlight the target screen. Group drags stay
        // in-iframe (the host's cross-screen drop moves a single element and
        // would tear the group apart), so they never arm the host.
        if (!isGroupDrag) {
          (window.parent as Window).postMessage(
            {
              type: "agent-native:cross-screen-drag",
              phase: "move",
              selector: reorderSelector,
              sourceId: reorderSourceId,
              iframeX: cx,
              iframeY: cy,
              viewportW: vw,
              viewportH: vh,
              pointerOffset: reorderPointerOffset,
              styleSnapshot: reorderStyleSnapshot,
            },
            "*",
          );
        }
        if (outside && !isGroupDrag) {
          // Cursor left this iframe — hide the in-iframe insertion guide so
          // it does not render while the host shows a cross-screen drop target.
          hideInsertionGuide();
          showTransformBadge("Move layer", cx, cy);
        } else {
          // Cursor is inside this iframe — use existing in-iframe behavior.
          currentTarget = reorderTargetForPoint(reorderEl, cx, cy, groupOthers);
          showInsertionGuideFor(currentTarget);
          showTransformBadge(currentTarget ? "Move layer" : "Move", cx, cy);
        }
      }
      function cleanupReorderDrag() {
        document.removeEventListener(events.move, onReorderMove, true);
        document.removeEventListener(events.up, onReorderUp, true);
        document.removeEventListener("keydown", onReorderKeyDown, true);
        clearActiveDragCancel(onReorderEscape);
      }
      function onReorderEscape() {
        cleanupReorderDrag();
        hideTransformBadge();
        hideInsertionGuide();
        (window.parent as Window).postMessage(
          { type: "agent-native:cross-screen-drag", phase: "cancel" },
          "*",
        );
        // Revert any clone that was inserted for alt-drag.
        if (
          duplicatedForDrag &&
          reorderEl &&
          reorderEl !== originalSelectedEl
        ) {
          if (reorderEl.parentElement)
            reorderEl.parentElement.removeChild(reorderEl);
          selectedEl = originalSelectedEl;
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
        }
        suppressNextShieldClickBriefly();
        return true;
      }
      function onReorderKeyDown(ev) {
        if (ev.key === "Escape") {
          stopNativeInteraction(ev);
          onReorderEscape();
        }
      }
      function onReorderUp(ev) {
        cleanupReorderDrag();
        hideTransformBadge();
        hideInsertionGuide();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cx = ev ? ev.clientX : 0;
        var cy = ev ? ev.clientY : 0;
        var outsideOnDrop = cx < 0 || cy < 0 || cx > vw || cy > vh;
        // Post the end message so the host can finalize a cross-screen drop.
        // Group drags never armed the host (see onReorderMove), so posting
        // end here would trigger a bogus single-element cross-screen move.
        if (!isGroupDrag) {
          (window.parent as Window).postMessage(
            {
              type: "agent-native:cross-screen-drag",
              phase: "end",
              selector: reorderSelector,
              sourceId: reorderSourceId,
              iframeX: cx,
              iframeY: cy,
              viewportW: vw,
              viewportH: vh,
              pointerOffset: reorderPointerOffset,
              styleSnapshot: reorderStyleSnapshot,
            },
            "*",
          );
        }
        // When the pointer is outside this iframe at release, the host owns the
        // move (cross-screen drop).  Do NOT apply the in-iframe reorder so we
        // avoid a ghost element left in screen A's DOM. For group drags an
        // outside release is simply a no-op (nothing moved during a flow
        // reorder drag, so there is nothing to restore).
        // Use outsideOnDrop only — pointerOutsideIframe is stale when the user
        // briefly exits the iframe and re-enters before releasing.  The host
        // already clears cross-screen state on re-entry so checking the
        // momentary excursion flag here would wrongly drop the element nowhere.
        if (outsideOnDrop) return;
        if (!currentTarget) {
          // No valid drop target — clean up the clone if one was inserted so
          // no ghost element is left in the DOM.
          if (
            duplicatedForDrag &&
            reorderEl &&
            reorderEl !== originalSelectedEl
          ) {
            if (reorderEl.parentElement)
              reorderEl.parentElement.removeChild(reorderEl);
            selectedEl = originalSelectedEl;
            positionOverlay(selectionOverlay, selectedEl);
            postElementSelect(selectedEl);
          }
          return;
        }
        if (duplicatedForDrag) {
          applyRuntimeReorder(reorderEl, currentTarget);
          postVisualDuplicateChange(
            originalSelectedEl,
            reorderEl,
            currentTarget,
          );
        } else if (isGroupDrag) {
          applyGroupStructureDrop(groupEls, currentTarget, ev);
        } else {
          // Capture the pre-drag DOM anchor so we can revert if the parent
          // reports applied===false on the structure-ack.
          var prevParent = reorderEl.parentElement;
          var prevNextSibling = reorderEl.nextSibling;
          adaptAutoTextColorForNest(
            reorderEl,
            dropContainerForTarget(currentTarget),
          );
          // Optimistically apply the reorder in the DOM for immediate
          // visual feedback; the visual-structure-ack handler will confirm
          // or revert once the parent processes the change.
          applyRuntimeReorder(reorderEl, currentTarget);
          postVisualStructureChange(reorderEl, currentTarget, {
            prevParent: prevParent,
            prevNextSibling: prevNextSibling,
          });
        }
      }
      document.addEventListener(events.move, onReorderMove, true);
      document.addEventListener(events.up, onReorderUp, true);
      document.addEventListener("keydown", onReorderKeyDown, true);
      setActiveDragCancel(onReorderEscape);
      return;
    }
    // Per-member drag state: inline-style snapshots (for escape-cancel
    // restore) plus each member's own drag origin. Single-element drags have
    // exactly one entry; group drags get one per multi-selection member so
    // the SAME delta can be applied to every member each tick, preserving
    // the group's relative offsets (Figma group-move semantics).
    var memberStates = groupEls.map(function (member) {
      var m = member as HTMLElement;
      var snapshot = {
        el: m,
        originalPosition: m.style.position,
        originalLeft: m.style.left,
        originalTop: m.style.top,
        originalOpacity: m.style.opacity,
        originLeft: 0,
        originTop: 0,
      };
      ensurePositionable(m);
      var mcs = window.getComputedStyle(m);
      snapshot.originLeft = readPx(m.style.left || mcs.left);
      snapshot.originTop = readPx(m.style.top || mcs.top);
      return snapshot;
    });
    var gestureState =
      memberStates[groupEls.indexOf(gestureEl)] || memberStates[0];
    var originalInlineOpacity = gestureState.originalOpacity;
    var originLeft = gestureState.originLeft;
    var originTop = gestureState.originTop;
    function setMembersOpacity(value: string | null): void {
      memberStates.forEach(function (state) {
        state.el.style.opacity = value === null ? state.originalOpacity : value;
      });
    }
    var startX = e.clientX;
    var startY = e.clientY;
    // Snapshot the element being moved so that a concurrent select-element or
    // clear-selection postMessage cannot swap selectedEl mid-drag and cause
    // mutations on the wrong element or a null-deref in onUp.
    var dragEl = gestureEl;
    var moved = false;
    var DRAG_THRESHOLD = 3;
    var currentAutoLayoutTarget: {
      anchor: Element;
      placement: string;
      axis?: string;
      needsAutoLayoutConversion?: boolean;
      conversionTarget?: Element;
    } | null = null;
    // Snap candidates (siblings + parent content box) are computed once at
    // drag start — a single getBoundingClientRect pass per candidate — not
    // recomputed on every move event. Other group members are excluded: they
    // move with the drag, so snapping against them would chase a moving
    // target.
    var snapCandidateRects = collectSnapCandidateRects(dragEl, groupOthers);
    var dragElStartRect = (dragEl as HTMLElement).getBoundingClientRect();
    var dragElStartWidth = dragElStartRect.width;
    var dragElStartHeight = dragElStartRect.height;
    if (!duplicatedForDrag && !isGroupDrag) {
      postCrossScreenDrag("start", dragEl, e);
    }
    function onMove(ev) {
      if (
        !moved &&
        Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD
      ) {
        moved = true;
      }
      var rawDx = ev.clientX - startX;
      var rawDy = ev.clientY - startY;
      // Figma dominant-axis lock: while Shift is held, zero out whichever
      // delta has the smaller magnitude so the element only moves along one
      // axis. Read live off the move event (not cached at drag start) so
      // pressing/releasing Shift mid-drag re-evaluates every event, matching
      // how the resize path reads ev.shiftKey per-move rather than once.
      if (ev.shiftKey) {
        if (Math.abs(rawDx) > Math.abs(rawDy)) {
          rawDy = 0;
        } else {
          rawDx = 0;
        }
      }
      var nextLeft = originLeft + rawDx;
      var nextTop = originTop + rawDy;
      // Alignment/smart-guide snapping: disabled while Cmd/Ctrl is held
      // (Figma behavior) and while an auto-layout flow-insert is about to
      // happen instead of a free absolute placement (handled below once
      // currentAutoLayoutTarget is known for this tick).
      var snapBypass = Boolean(ev.metaKey || ev.ctrlKey);
      var snapResult =
        !snapBypass && !duplicatedForDrag
          ? computeMoveSnapOffset(
              {
                left: nextLeft,
                top: nextTop,
                width: dragElStartWidth,
                height: dragElStartHeight,
              },
              snapCandidateRects,
              SNAP_THRESHOLD_PX,
            )
          : { dx: 0, dy: 0, guideV: null, guideH: null };
      nextLeft += snapResult.dx;
      nextTop += snapResult.dy;
      // Apply the SAME delta to every member (one entry for single drags)
      // so relative offsets within a multi-selection are preserved. For the
      // gesture member this reduces exactly to the previous
      // Math.round(nextLeft/nextTop) single-element behavior.
      var appliedDx = nextLeft - originLeft;
      var appliedDy = nextTop - originTop;
      memberStates.forEach(function (state) {
        state.el.style.left = Math.round(state.originLeft + appliedDx) + "px";
        state.el.style.top = Math.round(state.originTop + appliedDy) + "px";
      });
      if (!duplicatedForDrag && !isGroupDrag) {
        postCrossScreenDrag("move", dragEl, ev);
      }
      if (
        !duplicatedForDrag &&
        isOutsideIframeViewport(ev.clientX, ev.clientY)
      ) {
        currentAutoLayoutTarget = null;
        hideInsertionGuide();
        setMembersOpacity(null);
      } else {
        currentAutoLayoutTarget = !duplicatedForDrag
          ? autoLayoutInsertionTargetForPoint(
              dragEl,
              ev.clientX,
              ev.clientY,
              groupOthers,
            )
          : null;
        if (currentAutoLayoutTarget) {
          showInsertionGuideFor(currentAutoLayoutTarget);
          setMembersOpacity("0.4");
        } else {
          hideInsertionGuide();
          setMembersOpacity(null);
        }
      }
      // Snap guides only make sense for a free absolute placement — never at
      // once alongside the auto-layout flow-insert indicator (the element is
      // about to be reflowed into a flex/grid slot, not placed at an x/y
      // coordinate), and never while the pointer has left the iframe (the
      // host owns a cross-screen drop at that point).
      if (
        currentAutoLayoutTarget ||
        (!duplicatedForDrag && isOutsideIframeViewport(ev.clientX, ev.clientY))
      ) {
        hideSnapGuides();
      } else {
        showSnapGuides(snapResult.guideV, snapResult.guideH);
      }
      showTransformBadge(
        Math.round(nextLeft) + ", " + Math.round(nextTop),
        ev.clientX,
        ev.clientY,
      );
      refreshOverlays();
    }
    function restoreSourceDragPosition(): void {
      memberStates.forEach(function (state) {
        state.el.style.position = state.originalPosition;
        state.el.style.left = state.originalLeft;
        state.el.style.top = state.originalTop;
        state.el.style.opacity = state.originalOpacity;
      });
      selectedEl = originalSelectedEl;
      positionOverlay(selectionOverlay, selectedEl);
    }
    function cleanupMoveDrag() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      document.removeEventListener("keydown", onMoveKeyDown, true);
      clearActiveDragCancel(cancelMoveDrag);
    }
    function cancelMoveDrag() {
      cleanupMoveDrag();
      hideTransformBadge();
      hideInsertionGuide();
      hideSnapGuides();
      currentAutoLayoutTarget = null;
      if (duplicatedForDrag) {
        if (dragEl && dragEl.parentElement) {
          dragEl.parentElement.removeChild(dragEl);
        }
        selectedEl = originalSelectedEl;
        positionOverlay(selectionOverlay, selectedEl);
        postElementSelect(selectedEl);
      } else if (dragEl && document.documentElement.contains(dragEl)) {
        restoreSourceDragPosition();
        if (!isGroupDrag) postCrossScreenDrag("cancel");
      }
      suppressNextShieldClickBriefly();
      refreshOverlays();
      return true;
    }
    function onMoveKeyDown(ev) {
      if (ev.key !== "Escape") return;
      stopNativeInteraction(ev);
      cancelMoveDrag();
    }
    function onUp(ev) {
      cleanupMoveDrag();
      hideTransformBadge();
      hideInsertionGuide();
      hideSnapGuides();
      if (!dragEl) return;
      var outsideOnDrop = ev
        ? isOutsideIframeViewport(ev.clientX, ev.clientY)
        : false;
      if (
        ev &&
        !duplicatedForDrag &&
        !isGroupDrag &&
        (outsideOnDrop || designCanvasBoardSurface)
      ) {
        postCrossScreenDrag("end", dragEl, ev);
      }
      if (ev && !duplicatedForDrag && outsideOnDrop) {
        // Outside release: the host owns a single-element cross-screen drop;
        // group drags never armed the host, so an outside release simply
        // restores every member (cancel semantics).
        restoreSourceDragPosition();
        return;
      }
      if (ev && !duplicatedForDrag && !outsideOnDrop) {
        var finalAutoLayoutTarget = autoLayoutInsertionTargetForPoint(
          dragEl,
          ev.clientX,
          ev.clientY,
          groupOthers,
        );
        if (finalAutoLayoutTarget) {
          currentAutoLayoutTarget = finalAutoLayoutTarget;
        }
      }
      if (duplicatedForDrag && !moved) {
        // Alt-click with no real drag — remove the premature clone and restore the original selection.
        if (dragEl.parentElement) dragEl.parentElement.removeChild(dragEl);
        selectedEl = originalSelectedEl;
        positionOverlay(selectionOverlay, selectedEl);
        postElementSelect(selectedEl);
        return;
      }
      if (duplicatedForDrag) {
        postVisualDuplicateChange(originalSelectedEl, dragEl);
      } else if (currentAutoLayoutTarget) {
        setMembersOpacity(null);
        // Figma-parity nest-on-drop: the target container may be a plain
        // rect/div that isn't auto-layout yet (see
        // autoLayoutInsertionTargetForPoint's needsAutoLayoutConversion).
        // Convert it to flex BEFORE reparenting/posting the move so the
        // host applies the two edits in the right order against its
        // synchronous same-tick content refs (container becomes flex, then
        // the child moves into it and loses absolute positioning via the
        // existing "flow-insert" dropMode handling). For group drags the
        // conversion fires ONCE for the container; every member then nests
        // consecutively via applyGroupStructureDrop.
        if (
          currentAutoLayoutTarget.needsAutoLayoutConversion &&
          currentAutoLayoutTarget.conversionTarget
        ) {
          applyAutoLayoutConversionForDrop(
            currentAutoLayoutTarget.conversionTarget,
            groupEls,
          );
        }
        if (isGroupDrag) {
          applyGroupStructureDrop(groupEls, currentAutoLayoutTarget, ev);
        } else {
          var prevParent = dragEl.parentElement;
          var prevNextSibling = dragEl.nextSibling;
          adaptAutoTextColorForNest(
            dragEl,
            dropContainerForTarget(currentAutoLayoutTarget),
          );
          applyRuntimeReorder(dragEl, currentAutoLayoutTarget);
          postVisualStructureChange(dragEl, currentAutoLayoutTarget, {
            prevParent: prevParent,
            prevNextSibling: prevNextSibling,
          });
        }
      } else {
        setMembersOpacity(null);
        // Free absolute placement: one style-change message per member, in
        // order — the host composes them against its synchronous same-tick
        // content refs exactly like multi-property style commits.
        memberStates.forEach(function (state) {
          (window.parent as Window).postMessage(
            {
              type: "visual-style-change",
              selector: getSelector(state.el),
              styles: {
                position: state.el.style.position,
                left: state.el.style.left,
                top: state.el.style.top,
              },
              payload: getElementInfo(state.el),
            },
            "*",
          );
        });
        if (!isGroupDrag) postCrossScreenDrag("cancel");
      }
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onMoveKeyDown, true);
    setActiveDragCancel(cancelMoveDrag);
  }

  function startResize(handle, e) {
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    var events = dragEventNames(e);
    // Snapshot the element so a concurrent clear-selection postMessage cannot
    // cause a null-deref in onMove/onUp.
    var resizeEl = selectedEl;
    var originalInlinePosition = resizeEl.style.position;
    var originalInlineLeft = resizeEl.style.left;
    var originalInlineTop = resizeEl.style.top;
    var originalInlineWidth = resizeEl.style.width;
    var originalInlineHeight = resizeEl.style.height;
    var originalInlineBorderWidth = resizeEl.style.borderWidth;
    var originalInlineFontSize = resizeEl.style.fontSize;
    ensurePositionable(resizeEl);
    var cs = window.getComputedStyle(resizeEl);
    // Bug fix: use CSS width/height (not getBoundingClientRect) for the resize
    // origin dimensions so that rotated elements don't use the inflated
    // axis-aligned bounding box as the starting size.
    var originW = readPx(resizeEl.style.width || cs.width);
    var originH = readPx(resizeEl.style.height || cs.height);
    // K-scale (Figma "Scale" tool) parity: capture the element's own border
    // width and font size once at drag-start so a uniform per-tick scale
    // factor (derived from width/height growth, see nextRect below) can
    // multiply them proportionally, exactly like Figma's Scale tool resizes
    // stroke weight and text size along with the box — a *normal* resize
    // (scaleToolEnabled false) never touches either. Uses the CSS
    // borderWidth/fontSize shorthand (not per-side border-*-width) since
    // canvas-primitive-style.ts / appendCanvasPrimitiveToHtml only ever set a
    // uniform border on these elements; a hand-authored per-side border is
    // left untouched (readPx on the shorthand returns 0 for mixed values,
    // which multiplies to 0 — an explicit non-goal edge case, not silently
    // wrong: scaleToolEnabled is opt-in and mixed-width borders on a
    // draggable primitive are not part of this app's authored shapes).
    var originBorderWidth = readPx(
      resizeEl.style.borderWidth || cs.borderWidth,
    );
    var originFontSize = readPx(resizeEl.style.fontSize || cs.fontSize);
    var origin = {
      left: readPx(resizeEl.style.left || cs.left),
      top: readPx(resizeEl.style.top || cs.top),
      width: originW,
      height: originH,
      ratio: originW / Math.max(1, originH),
    };
    var startX = e.clientX;
    var startY = e.clientY;
    // Capture the element rotation once at drag-start so per-move projection is
    // cheap and consistent even if the transform changes during the drag.
    var resizeTheta = (currentRotation(resizeEl) * Math.PI) / 180;
    function nextRect(ev) {
      var screenDx = ev.clientX - startX;
      var screenDy = ev.clientY - startY;
      // Project the screen-space pointer delta into the element's local
      // (un-rotated) coordinate frame so handles behave relative to the
      // visible rotated box rather than screen axes.
      var cosT = Math.cos(resizeTheta);
      var sinT = Math.sin(resizeTheta);
      var dx = screenDx * cosT + screenDy * sinT;
      var dy = -screenDx * sinT + screenDy * cosT;
      var left = origin.left;
      var top = origin.top;
      var width = origin.width;
      var height = origin.height;
      if (handle.indexOf("w") !== -1) {
        left = origin.left + dx;
        width = origin.width - dx;
      }
      if (handle.indexOf("e") !== -1) width = origin.width + dx;
      if (handle.indexOf("n") !== -1) {
        top = origin.top + dy;
        height = origin.height - dy;
      }
      if (handle.indexOf("s") !== -1) height = origin.height + dy;
      // Apply Shift / scaleToolEnabled aspect-ratio lock BEFORE the min-size
      // clamp so the ratio is computed from unclamped values (bug fix).
      if (ev.shiftKey) {
        // Shift locks aspect ratio for ALL 8 handles (corners and edges).
        if (handle === "e" || handle === "w") {
          height = width / origin.ratio;
        } else if (handle === "n" || handle === "s") {
          width = height * origin.ratio;
        } else if (handle.length === 2) {
          if (Math.abs(dx) > Math.abs(dy)) height = width / origin.ratio;
          else width = height * origin.ratio;
        }
      }
      if (scaleToolEnabled) {
        // Scale tool: enforce aspect ratio on all 8 handles, not just corners.
        if (handle === "e" || handle === "w") {
          height = width / origin.ratio;
        } else if (handle === "n" || handle === "s") {
          width = height * origin.ratio;
        } else if (handle.length === 2) {
          if (Math.abs(dx) > Math.abs(dy)) height = width / origin.ratio;
          else width = height * origin.ratio;
        }
      }
      // Clamp to minimum size.
      var clampedW = Math.max(8, width);
      var clampedH = Math.max(8, height);
      // After clamping, re-apply the ratio if Shift or scale tool is active so
      // the clamped dimension doesn't silently break the locked aspect ratio.
      if (ev.shiftKey || scaleToolEnabled) {
        if (clampedW !== width) {
          // Width was clamped; re-derive height from the clamped width.
          clampedH = Math.max(8, clampedW / origin.ratio);
        } else if (clampedH !== height) {
          // Height was clamped; re-derive width from the clamped height.
          clampedW = Math.max(8, clampedH * origin.ratio);
        }
      }
      width = clampedW;
      height = clampedH;
      // Re-anchor the pinned edge for w/n handles after aspect-ratio lock and
      // clamping so the opposite (e/s) edge stays fixed regardless of whether
      // the dimension change was driven by raw dx/dy or by the ratio lock.
      if (handle.indexOf("w") !== -1)
        left = origin.left + (origin.width - width);
      if (handle.indexOf("n") !== -1)
        top = origin.top + (origin.height - height);
      if (ev.altKey) {
        if (handle.indexOf("w") !== -1 || handle.indexOf("e") !== -1)
          left = origin.left - (width - origin.width) / 2;
        if (handle.indexOf("n") !== -1 || handle.indexOf("s") !== -1)
          top = origin.top - (height - origin.height) / 2;
      }
      return { left: left, top: top, width: width, height: height };
    }
    function onMove(ev) {
      if (!resizeEl) return;
      var rect = nextRect(ev);
      resizeEl.style.left = Math.round(rect.left) + "px";
      resizeEl.style.top = Math.round(rect.top) + "px";
      resizeEl.style.width = Math.round(rect.width) + "px";
      resizeEl.style.height = Math.round(rect.height) + "px";
      if (scaleToolEnabled) {
        // Uniform scale factor: scaleToolEnabled already forces the
        // aspect-ratio lock above (nextRect), so width/origin.width and
        // height/origin.height agree (barring the min-size clamp's rounding)
        // — width is the simpler, always-defined choice.
        var kScaleFactor = rect.width / Math.max(1, origin.width);
        if (originBorderWidth > 0) {
          resizeEl.style.borderWidth =
            Math.max(
              0,
              Math.round(originBorderWidth * kScaleFactor * 100) / 100,
            ) + "px";
        }
        if (originFontSize > 0) {
          resizeEl.style.fontSize =
            Math.max(1, Math.round(originFontSize * kScaleFactor * 100) / 100) +
            "px";
        }
      }
      showTransformBadge(
        Math.round(rect.width) + " x " + Math.round(rect.height),
        ev.clientX,
        ev.clientY,
      );
      refreshOverlays();
    }
    function cleanupResizeDrag() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      document.removeEventListener("keydown", onResizeKeyDown, true);
      clearActiveDragCancel(cancelResizeDrag);
    }
    function cancelResizeDrag() {
      cleanupResizeDrag();
      hideTransformBadge();
      if (resizeEl && document.documentElement.contains(resizeEl)) {
        resizeEl.style.position = originalInlinePosition;
        resizeEl.style.left = originalInlineLeft;
        resizeEl.style.top = originalInlineTop;
        resizeEl.style.width = originalInlineWidth;
        resizeEl.style.height = originalInlineHeight;
        resizeEl.style.borderWidth = originalInlineBorderWidth;
        resizeEl.style.fontSize = originalInlineFontSize;
        selectedEl = resizeEl;
        positionOverlay(selectionOverlay, selectedEl);
      }
      suppressNextShieldClickBriefly();
      refreshOverlays();
      return true;
    }
    function onResizeKeyDown(ev) {
      if (ev.key !== "Escape") return;
      stopNativeInteraction(ev);
      cancelResizeDrag();
    }
    function onUp() {
      cleanupResizeDrag();
      hideTransformBadge();
      if (!resizeEl) return;
      var styles: Record<string, string> = {
        position: resizeEl.style.position,
        left: resizeEl.style.left,
        top: resizeEl.style.top,
        width: resizeEl.style.width,
        height: resizeEl.style.height,
      };
      // Only include borderWidth/fontSize when the K-scale tool actually
      // changed them (originBorderWidth/originFontSize > 0 AND
      // scaleToolEnabled) — a normal resize must never introduce these keys,
      // matching the "normal resize unchanged" requirement.
      if (scaleToolEnabled && originBorderWidth > 0) {
        styles.borderWidth = resizeEl.style.borderWidth;
      }
      if (scaleToolEnabled && originFontSize > 0) {
        styles.fontSize = resizeEl.style.fontSize;
      }
      (window.parent as Window).postMessage(
        {
          type: "visual-style-change",
          selector: getSelector(resizeEl),
          styles: styles,
          payload: getElementInfo(resizeEl),
        },
        "*",
      );
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onResizeKeyDown, true);
    setActiveDragCancel(cancelResizeDrag);
  }

  function startRotate(e) {
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    var events = dragEventNames(e);
    // getBoundingClientRect is correct here — we only need the element center
    // for angle math, and the element's visual position is what we want.
    var rect = selectedEl.getBoundingClientRect();
    var center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    var originAngle =
      (Math.atan2(e.clientY - center.y, e.clientX - center.x) * 180) / Math.PI;
    var originRotation = currentRotation(selectedEl);
    // Snapshot so a concurrent clear-selection postMessage cannot cause a
    // null-deref in onMove/onUp.
    var rotateEl = selectedEl;
    var originalInlineTransform = rotateEl.style.transform;
    function onMove(ev) {
      if (!rotateEl) return;
      var pointerAngle =
        (Math.atan2(ev.clientY - center.y, ev.clientX - center.x) * 180) /
        Math.PI;
      var next = originRotation + pointerAngle - originAngle;
      if (ev.shiftKey) next = Math.round(next / 15) * 15;
      next = Math.round(next);
      rotateEl.style.transform = mergeRotation(rotateEl, next);
      showTransformBadge(next + "deg", ev.clientX, ev.clientY);
      refreshOverlays();
    }
    function cleanupRotateDrag() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      document.removeEventListener("keydown", onRotateKeyDown, true);
      clearActiveDragCancel(cancelRotateDrag);
    }
    function cancelRotateDrag() {
      cleanupRotateDrag();
      hideTransformBadge();
      if (rotateEl && document.documentElement.contains(rotateEl)) {
        rotateEl.style.transform = originalInlineTransform;
        selectedEl = rotateEl;
        positionOverlay(selectionOverlay, selectedEl);
      }
      suppressNextShieldClickBriefly();
      refreshOverlays();
      return true;
    }
    function onRotateKeyDown(ev) {
      if (ev.key !== "Escape") return;
      stopNativeInteraction(ev);
      cancelRotateDrag();
    }
    function onUp() {
      cleanupRotateDrag();
      hideTransformBadge();
      if (!rotateEl) return;
      (window.parent as Window).postMessage(
        {
          type: "visual-style-change",
          selector: getSelector(rotateEl),
          styles: { transform: rotateEl.style.transform },
          payload: getElementInfo(rotateEl),
        },
        "*",
      );
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onRotateKeyDown, true);
    setActiveDragCancel(cancelRotateDrag);
  }

  function clearPendingShieldDrag() {
    if (!pendingShieldDrag) return;
    document.removeEventListener(
      pendingShieldDrag.move,
      pendingShieldDrag.onMove,
      true,
    );
    document.removeEventListener(
      pendingShieldDrag.up,
      pendingShieldDrag.onUp,
      true,
    );
    if (
      pendingShieldDrag.pointerId !== undefined &&
      shieldOverlay.releasePointerCapture
    ) {
      try {
        shieldOverlay.releasePointerCapture(pendingShieldDrag.pointerId);
      } catch (_err) {}
    }
    pendingShieldDrag = null;
  }

  function beginPotentialShieldDrag(e) {
    stopNativeInteraction(e);
    if (e.button !== 0 || activeTextEditEl) return;
    var events = dragEventNames(e);
    var hit = elementFromEditorPoint(e.clientX, e.clientY);
    var hitTarget = selectionTargetForHit(hit);
    if (
      !hit ||
      hit === document.body ||
      hit === document.documentElement ||
      isBoardRootMarqueeSurface(hitTarget)
    ) {
      beginMarqueeSelection(e);
      return;
    }
    var dragTarget =
      selectedEl &&
      document.documentElement.contains(selectedEl) &&
      selectedEl.contains(hit)
        ? selectedEl
        : hitTarget;
    var clickTarget = hitTarget;
    if (
      !dragTarget ||
      dragTarget === document.body ||
      dragTarget === document.documentElement ||
      isLayerInteractionBlocked(dragTarget)
    ) {
      return;
    }
    if (
      e.pointerId !== undefined &&
      shieldOverlay.setPointerCapture &&
      !e.altKey
    ) {
      try {
        shieldOverlay.setPointerCapture(e.pointerId);
      } catch (_err) {}
    }
    if (!e.altKey) {
      postCrossScreenDrag("start", dragTarget, e);
    }
    var startX = e.clientX;
    var startY = e.clientY;
    var didStartDrag = false;
    function selectTarget(target, ev?: MouseEvent) {
      var previousSelectedEl = selectedEl;
      selectedEl = target;
      positionOverlay(selectionOverlay, selectedEl);
      preservePreviousSelectedElementForShiftClick(
        previousSelectedEl,
        selectedEl,
        ev,
      );
      postElementSelect(selectedEl, ev);
    }
    function onMove(ev) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 3) return;
      clearPendingShieldDrag();
      didStartDrag = true;
      // Multi-select group move: when the drag starts on a member of the
      // current 2+ selection, PRESERVE the whole selection (no
      // selectTarget collapse) and move the group together — Figma
      // behavior. A plain click (no drag) still collapses to the clicked
      // element via onUp below (existing disambiguation). Alt-drag
      // duplication stays single-element.
      var groupGestureMember = !e.altKey
        ? groupMemberForGestureTarget(dragTarget)
        : null;
      if (
        groupGestureMember &&
        collectMoveGroupMembers(groupGestureMember).length > 1
      ) {
        suppressNextShieldClickBriefly();
        startMove(ev, groupGestureMember);
        return;
      }
      selectTarget(dragTarget, ev);
      suppressNextShieldClickBriefly();
      startMove(ev);
    }
    function onUp(ev) {
      clearPendingShieldDrag();
      if (didStartDrag) return;
      if (!e.altKey) {
        postCrossScreenDrag("cancel");
      }
      if (ev) stopNativeInteraction(ev);
      selectTarget(clickTarget || dragTarget, ev);
      suppressNextShieldClickBriefly();
    }
    clearPendingShieldDrag();
    pendingShieldDrag = {
      move: events.move,
      up: events.up,
      onMove: onMove,
      onUp: onUp,
      pointerId: e.pointerId,
    };
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
  }

  selectionOverlay.addEventListener(
    "mousedown",
    function (e) {
      var spacingKey =
        e.target &&
        e.target.getAttribute &&
        e.target.getAttribute("data-spacing-key");
      if (spacingKey) {
        startSpacingDrag(spacingKey, e);
        return;
      }
      var resizeHandle =
        e.target &&
        e.target.getAttribute &&
        e.target.getAttribute("data-agent-native-edit-handle");
      if (!resizeHandle && e.target && e.target.getAttribute) {
        resizeHandle = e.target.getAttribute("data-agent-native-edge-handle");
      }
      if (resizeHandle) {
        startResize(resizeHandle, e);
        return;
      }
      var rotateHandle =
        e.target &&
        e.target.getAttribute &&
        e.target.getAttribute("data-agent-native-rotate-handle");
      if (rotateHandle) {
        startRotate(e);
        return;
      }
      startMove(e);
    },
    true,
  );

  shieldOverlay.addEventListener("pointerdown", beginPotentialShieldDrag, true);
  shieldOverlay.addEventListener("wheel", scrollUnderlyingElementAtWheel, {
    passive: false,
    capture: true,
  });

  ["pointerdown", "pointerup", "mousedown", "mouseup", "auxclick"].forEach(
    function (type) {
      shieldOverlay.addEventListener(type, stopNativeInteraction, true);
    },
  );

  function stopBlockedLayerInteraction(e) {
    if (isOverlayElement(e.target)) return;
    var target = e.target && e.target.nodeType === 1 ? e.target : null;
    if (!target || !isLayerInteractionBlocked(target)) return;
    stopNativeInteraction(e);
  }

  [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "auxclick",
  ].forEach(function (type) {
    document.addEventListener(type, stopBlockedLayerInteraction, true);
  });

  shieldOverlay.addEventListener("click", selectElementAtEvent, true);
  shieldOverlay.addEventListener("contextmenu", openContextMenuAtEvent, true);
  selectionOverlay.addEventListener(
    "contextmenu",
    openContextMenuAtEvent,
    true,
  );
  document.addEventListener(
    "contextmenu",
    function (e) {
      if (isOverlayElement(e.target)) return;
      openContextMenuAtEvent(e);
    },
    true,
  );

  var pendingPlainPasteHotkeyTimer: number | null = null;

  function clearPendingPlainPasteHotkey() {
    if (pendingPlainPasteHotkeyTimer === null) return;
    window.clearTimeout(pendingPlainPasteHotkeyTimer);
    pendingPlainPasteHotkeyTimer = null;
  }

  function postDesignHotkey(payload) {
    (window.parent as Window).postMessage(
      {
        type: "design-hotkey",
        key: payload.key,
        code: payload.code,
        metaKey: !!payload.metaKey,
        ctrlKey: !!payload.ctrlKey,
        shiftKey: !!payload.shiftKey,
        altKey: !!payload.altKey,
        repeat: !!payload.repeat,
      },
      "*",
    );
  }

  document.addEventListener(
    "keydown",
    function (e) {
      if (!shouldForwardDesignHotkey(e)) return;
      var key = e.key;
      var normalized = key && key.length === 1 ? key.toLowerCase() : key;
      var primary = e.metaKey || e.ctrlKey;
      var plainPasteHotkey =
        primary && normalized === "v" && !e.altKey && !e.shiftKey;
      if (e.key === "Escape" && cancelActiveBridgeDrag()) {
        stopNativeInteraction(e);
        return;
      }
      var payload = {
        key: e.key,
        code: e.code,
        metaKey: !!e.metaKey,
        ctrlKey: !!e.ctrlKey,
        shiftKey: !!e.shiftKey,
        altKey: !!e.altKey,
        repeat: !!e.repeat,
      };
      if (plainPasteHotkey) {
        clearPendingPlainPasteHotkey();
        pendingPlainPasteHotkeyTimer = window.setTimeout(function () {
          pendingPlainPasteHotkeyTimer = null;
          postDesignHotkey(payload);
        }, 0);
        return;
      }
      stopNativeInteraction(e);
      if (e.key === "Escape") clearRuntimeSelection();
      postDesignHotkey(payload);
    },
    true,
  );

  // Space-pan release: keydown forwarding above arms the parent's temporary
  // hand tool (see postDesignHotkey/"design-hotkey"), but the parent also
  // needs the matching keyup to release it — without this, holding Space
  // inside the preview iframe would arm panning but never let go. Forwarded
  // as its own message (not reusing "design-hotkey", which the parent only
  // ever re-dispatches as a synthetic keydown) so the parent can drive its
  // real keyup-driven release logic.
  document.addEventListener(
    "keyup",
    function (e) {
      if (e.key !== " " || e.code !== "Space") return;
      if (activeTextEditEl || isEditorTypingTarget(e.target)) return;
      stopNativeInteraction(e);
      (window.parent as Window).postMessage(
        { type: "design-hotkey-up", key: e.key, code: e.code },
        "*",
      );
    },
    true,
  );

  function hasFigmaClipboardPayload(value) {
    return /<[^>]+\sdata-(metadata|buffer)=["'][^"']*\((figmeta|figma)\)[^"']*["']/i.test(
      String(value || ""),
    );
  }

  function getFigmaClipboardContent(data) {
    if (!data || !data.getData) return "";
    var html = data.getData("text/html") || "";
    if (hasFigmaClipboardPayload(html)) return html;
    var text = data.getData("text/plain") || "";
    return hasFigmaClipboardPayload(text) ? text : "";
  }

  document.addEventListener(
    "paste",
    function (e) {
      if (
        (activeTextEditEl && e.target && activeTextEditEl.contains(e.target)) ||
        isEditorTypingTarget(e.target)
      ) {
        return;
      }
      var content = getFigmaClipboardContent(e.clipboardData);
      clearPendingPlainPasteHotkey();
      if (!content) return;
      stopNativeInteraction(e);
      (window.parent as Window).postMessage(
        {
          type: "figma-clipboard-paste",
          content: content,
        },
        "*",
      );
    },
    true,
  );

  function placeTextCaretFromPoint(target, clientX, clientY) {
    try {
      var range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(clientX, clientY);
      } else if (document.caretPositionFromPoint) {
        var position = document.caretPositionFromPoint(clientX, clientY);
        if (position) {
          range = document.createRange();
          range.setStart(position.offsetNode, position.offset);
        }
      }
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
      }
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (err) {
      try {
        var fallbackRange = document.createRange();
        fallbackRange.selectNodeContents(target);
        fallbackRange.collapse(false);
        var fallbackSelection = window.getSelection();
        fallbackSelection.removeAllRanges();
        fallbackSelection.addRange(fallbackRange);
      } catch (_err) {}
    }
  }

  // T5: elements that must never become contenteditable via the raw-target
  // fallback below, even when a caller opts into programmatic text editing.
  // Chrome overlays are never real content; img/svg/canvas cannot host a text
  // selection/caret the way findTextEditTarget expects and would leave the
  // editor in a broken state (see the warning comment in findTextEditTarget).
  function isRejectedRawTextEditTarget(el: Element | null): boolean {
    if (!el) return true;
    if (isOverlayElement(el)) return true;
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    return tag === "img" || tag === "svg" || tag === "canvas";
  }

  function beginTextEditingFromEvent(e, forceTextEditing) {
    if (activeTextEditEl && e.target && activeTextEditEl.contains(e.target))
      return;
    if (!textEditingEnabled && !forceTextEditing) {
      stopNativeInteraction(e);
      return;
    }
    stopNativeInteraction(e);
    var eventTarget =
      e && e.target && e.target.nodeType === 1 ? e.target : null;
    // The raw `eventTarget` fallback (no findTextEditTarget resolution at
    // all) bypasses findTextEditTarget's editable-ancestor check entirely, so
    // it is only safe when the caller has explicitly opted into programmatic
    // text editing (e.g. an agent action creating a new text primitive and
    // immediately entering edit mode on it) — and even then, never for a
    // chrome overlay or an img/svg/canvas element, which cannot be made
    // sensibly contenteditable.
    var programmaticFlag =
      !!e &&
      (e as unknown as { agentNativeProgrammaticTextEdit?: boolean })
        .agentNativeProgrammaticTextEdit === true;
    var rawTargetFallback =
      programmaticFlag && !isRejectedRawTextEditTarget(eventTarget)
        ? eventTarget
        : null;
    // Programmatic edits (e.g. begin-text-edit on a just-created text node)
    // already carry the exact node to edit as e.target. A freshly-created text
    // node is 0×0, so elementFromEditorPoint at its synthesized edge point
    // resolves to whatever is underneath — the parent screen container
    // (<main>) — and editing would bind to the ENTIRE screen instead of the new
    // node (keystrokes land in the wrong element, the node stays empty, focus is
    // lost). So for the programmatic path, honor the explicit target first and
    // never re-resolve from a point.
    var target = programmaticFlag
      ? // Prefer the raw explicit node (rawTargetFallback === eventTarget) over
        // findTextEditTarget, which climbs UP to the highest inline-editable
        // ancestor (→ <main>) and would put the whole screen into edit mode.
        rawTargetFallback || findTextEditTarget(eventTarget)
      : findTextEditTarget(elementFromEditorPoint(e.clientX, e.clientY)) ||
        findTextEditTarget(eventTarget) ||
        rawTargetFallback;
    if (!target || target.nodeType !== 1) {
      // Figma parity: double-clicking a non-text element descends one level
      // into the current selection instead of doing nothing — select the
      // hit-tested element under the pointer (selectionTargetForHit already
      // returns the raw, deeper hit when it falls inside the current
      // selection, and climbs to the nearest stable-source ancestor
      // otherwise, so this reuses the same selection-filtering rules a
      // normal click uses). Skip this for the programmatic path: there is no
      // real pointer position to hit-test, and we already tried the explicit
      // target above.
      if (!programmaticFlag) {
        var descendHit = elementFromEditorPoint(e.clientX, e.clientY);
        if (
          descendHit &&
          descendHit !== document.body &&
          descendHit !== document.documentElement &&
          !isLayerInteractionBlocked(descendHit)
        ) {
          var previousSelectedElForDescend = selectedEl;
          var descendTarget = selectionTargetForHit(descendHit);
          if (descendTarget && !isLayerInteractionBlocked(descendTarget)) {
            selectedEl = descendTarget;
            positionOverlay(selectionOverlay, selectedEl);
            preservePreviousSelectedElementForShiftClick(
              previousSelectedElForDescend,
              selectedEl,
              e,
            );
            postElementSelect(selectedEl, e);
          }
        }
      }
      return;
    }
    // Anchor the selection identity to the nearest source-backed element. Text
    // editing still operates on the actual target text node, but a later
    // style edit posts from selectedEl, so it must point at a patchable
    // code-layer node rather than a runtime-only descendant (which would emit a
    // brittle body > div:nth-of-type(...) selector that never resolves).
    selectedEl = selectionTargetForHit(target) || target;
    var programmaticTextEdit = programmaticFlag;
    var originalText = target.textContent || "";
    var originalHtml = target.innerHTML || "";
    var originalMinWidth = target.style.minWidth;
    var originalMinHeight = target.style.minHeight;
    var originalBorderColor = target.style.borderColor;
    var originalOutline = target.style.outline;
    var originalOutlineOffset = target.style.outlineOffset;
    var committed = false;
    activeTextEditEl = target;
    // T19: publish this session's captured originals so refreshOverlays()
    // (which runs on ResizeObserver/MutationObserver ticks during the edit,
    // not just from inside this closure) can pass the real values instead of
    // "" to updateTextEditingChrome.
    activeTextEditOriginalMinWidth = originalMinWidth;
    activeTextEditOriginalMinHeight = originalMinHeight;
    // T20: per-keystroke chrome updates (onInput/onSelectionChange) and the
    // 3-4 postMessages they cause (text-editing-state + a caret-move
    // selectionchange on every arrow key / click) are coalesced into a single
    // rAF tick instead of firing synchronously on every event.
    var chromeUpdateScheduled = false;
    function scheduleTextEditingChromeUpdate() {
      if (chromeUpdateScheduled) return;
      chromeUpdateScheduled = true;
      window.requestAnimationFrame(function () {
        chromeUpdateScheduled = false;
        if (committed) return;
        updateTextEditingChrome(target, originalMinWidth, originalMinHeight);
        postTextEditingState(target, true);
      });
    }
    target.setAttribute("contenteditable", "true");
    target.setAttribute("data-agent-native-text-editing", "true");
    target.style.cursor = "text";
    target.style.borderColor = "transparent";
    target.style.outline = "none";
    target.style.outlineStyle = "none";
    target.style.outlineWidth = "0px";
    target.style.outlineColor = "transparent";
    target.style.outlineOffset = "0px";
    setTextEditingPointerPassthrough(true);
    updateTextEditingChrome(target, originalMinWidth, originalMinHeight);
    if (!programmaticTextEdit) {
      postElementSelect(target, e);
      (window.parent as Window).postMessage(
        { type: "element-dblclick-text", payload: getElementInfo(target) },
        "*",
      );
    }
    postTextEditingState(target, true);

    function finish(commit) {
      if (committed) return;
      committed = true;
      target.removeEventListener("blur", onBlur, true);
      target.removeEventListener("keydown", onKeyDown, true);
      target.removeEventListener("paste", onPaste, true);
      target.removeEventListener("input", onInput, true);
      target.removeEventListener("keyup", onSelectionChange, true);
      target.removeEventListener("mouseup", onSelectionChange, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      target.removeAttribute("contenteditable");
      target.removeAttribute("data-agent-native-text-editing");
      document.documentElement.removeAttribute(
        "data-agent-native-empty-text-editing",
      );
      target.style.cursor = "";
      target.style.outline = originalOutline;
      target.style.outlineOffset = originalOutlineOffset;
      target.style.minWidth = originalMinWidth;
      target.style.minHeight = originalMinHeight;
      target.style.borderColor = originalBorderColor;
      setTextEditingPointerPassthrough(false);
      setSelectionOverlayResizeChromeVisible(true);
      if (activeTextEditEl === target) activeTextEditEl = null;
      // T4: this session no longer owns the active-edit slot.
      if (finishActiveTextEdit === finish) finishActiveTextEdit = null;
      postTextEditingState(target, false);
      if (!commit) {
        target.innerHTML = originalHtml;
        refreshOverlays();
        return;
      }
      // T12: collapse any nested-identical-style <span> chains left behind by
      // repeated applyTextRangeStyle scrub/commit cycles before reading out
      // the committed HTML.
      normalizeNestedIdenticalSpans(target);
      var next = target.textContent || "";
      var nextHtml = target.innerHTML || "";
      refreshOverlays();
      if (next !== originalText || nextHtml !== originalHtml) {
        postTextContentChange(target, next, nextHtml);
      }
      // T13: replay the latest runtime-content update that arrived (and was
      // buffered) while this edit session was active, so the canvas isn't
      // left stale now that editing has ended.
      if (pendingRuntimeDocumentUpdate) {
        var pending = pendingRuntimeDocumentUpdate;
        pendingRuntimeDocumentUpdate = null;
        replaceRuntimeDocument(
          pending.html,
          pending.preferredSelector,
          pending.selectorCandidates,
          true,
        );
      }
    }
    // T4: publish this session's finish() so replaceRuntimeDocument (and any
    // other caller that must end an in-progress edit deterministically) can
    // commit/discard through the same listener-teardown path a user
    // Escape/blur would take, instead of only resetting activeTextEditEl.
    finishActiveTextEdit = finish;

    function onBlur() {
      if (programmaticTextEdit && !(target.textContent || "").trim()) {
        window.setTimeout(function () {
          if (committed || (target.textContent || "").trim()) return;
          target.focus();
          updateTextEditingChrome(target, originalMinWidth, originalMinHeight);
          postTextEditingState(target, true);
        }, 0);
        return;
      }
      finish(true);
    }

    function onKeyDown(ev) {
      // T3: bail out on IME composition input (e.g. CJK/Korean input method
      // candidate selection) so a composing Enter/Escape keystroke isn't
      // intercepted as a commit/newline before the IME has finished composing
      // the character. keyCode 229 is the legacy signal browsers send for
      // composition keydowns that don't set isComposing.
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(true);
        target.blur();
        return;
      }
      // T2: Enter inserts a line break while editing (Figma convention);
      // Escape or blur (click-out) is what commits and exits the session.
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        insertLineBreak();
        scheduleTextEditingChromeUpdate();
        return;
      }
      // T21: forward Cmd/Ctrl+B, Cmd/Ctrl+I, and Cmd/Ctrl+U within the edit
      // session to execCommand bold/italic/underline on the current selection.
      // normalizeNestedIdenticalSpans (T12) cleans up any span nesting
      // execCommand leaves behind when the session commits.
      var metaOrCtrl = ev.metaKey || ev.ctrlKey;
      if (metaOrCtrl && !ev.altKey && ev.key.toLowerCase() === "b") {
        ev.preventDefault();
        document.execCommand("bold");
        scheduleTextEditingChromeUpdate();
        return;
      }
      if (metaOrCtrl && !ev.altKey && ev.key.toLowerCase() === "i") {
        ev.preventDefault();
        document.execCommand("italic");
        scheduleTextEditingChromeUpdate();
        return;
      }
      if (metaOrCtrl && !ev.altKey && ev.key.toLowerCase() === "u") {
        ev.preventDefault();
        document.execCommand("underline");
        scheduleTextEditingChromeUpdate();
        return;
      }
    }

    function onPaste(ev) {
      ev.preventDefault();
      insertPlainTextAtSelection(
        (ev.clipboardData && ev.clipboardData.getData("text/plain")) || "",
      );
      scheduleTextEditingChromeUpdate();
    }

    function onInput() {
      scheduleTextEditingChromeUpdate();
    }

    function onSelectionChange() {
      scheduleTextEditingChromeUpdate();
    }

    target.addEventListener("blur", onBlur, true);
    target.addEventListener("keydown", onKeyDown, true);
    target.addEventListener("paste", onPaste, true);
    target.addEventListener("input", onInput, true);
    target.addEventListener("keyup", onSelectionChange, true);
    target.addEventListener("mouseup", onSelectionChange, true);
    document.addEventListener("selectionchange", onSelectionChange);
    target.focus();
    if (programmaticTextEdit) {
      // The synthesized point sits at the (0×0) node's edge and resolves to the
      // parent element, so caretRangeFromPoint would drop the caret OUTSIDE the
      // editable node. Collapse to the end of the target's own contents instead.
      try {
        var progRange = document.createRange();
        progRange.selectNodeContents(target);
        progRange.collapse(false);
        var progSel = window.getSelection();
        progSel.removeAllRanges();
        progSel.addRange(progRange);
      } catch {
        /* selection APIs unavailable — focus() alone still enables typing */
      }
    } else {
      placeTextCaretFromPoint(target, e.clientX, e.clientY);
    }
  }

  shieldOverlay.addEventListener("dblclick", beginTextEditingFromEvent, true);
  selectionOverlay.addEventListener(
    "dblclick",
    beginTextEditingFromEvent,
    true,
  );
  document.addEventListener(
    "dblclick",
    function (e) {
      if (isOverlayElement(e.target)) return;
      beginTextEditingFromEvent(e);
    },
    true,
  );

  shieldOverlay.addEventListener(
    "pointermove",
    function (e) {
      stopNativeInteraction(e);
      hoveredEl = elementFromEditorPoint(e.clientX, e.clientY);
      if (!hoveredEl) {
        highlightOverlay.style.display = "none";
        if (!spacingDrag) {
          scheduleSpacingHoverClear(e);
        }
        hideMeasurements();
        return;
      }
      if (hoveredEl && hoveredEl.closest("[data-agent-native-text-editing]"))
        return;
      if (!spacingDrag) {
        var hoveringSelectedSpacingSurface = Boolean(
          selectedEl &&
          hoveredEl &&
          (hoveredEl === selectedEl ||
            (selectedEl.contains && selectedEl.contains(hoveredEl))),
        );
        if (hoveringSelectedSpacingSurface) {
          clearSpacingHoverTimer();
          selectedSpacingHovered = true;
          lastSpacingPointerPoint = { x: e.clientX, y: e.clientY };
          updateSpacingOverlay(selectedEl);
          // Reliable padding/gap hover: hit-test the handle geometry
          // directly from the pointer position instead of depending on the
          // pointermove's event target being the region node (see
          // spacingHandleKeyAtPoint). Shows/updates the "Npx" value box
          // while hovering the handle line; clears it when the pointer
          // leaves the tolerance zone.
          var pointSpacingKey = spacingHandleKeyAtPoint(e.clientX, e.clientY);
          if (pointSpacingKey) {
            activateSpacingHandle(pointSpacingKey);
          } else if (hoveredSpacingHandleKey) {
            hoveredSpacingHandleKey = "";
            updateSpacingOverlay(selectedEl);
          }
        } else {
          scheduleSpacingHoverClear(e);
        }
      }
      if (hoveredEl === selectedEl) {
        highlightOverlay.style.display = "none";
      } else {
        positionOverlay(highlightOverlay, hoveredEl);
      }
      if (e.altKey && selectedEl && hoveredEl && selectedEl !== hoveredEl) {
        showMeasurements(selectedEl, hoveredEl);
      } else {
        hideMeasurements();
      }
      var info = getLightElementInfo(hoveredEl);
      (window.parent as Window).postMessage(
        { type: "element-hover", payload: info },
        "*",
      );
    },
    true,
  );

  selectionOverlay.addEventListener(
    "pointermove",
    handleSpacingOverlayPointerMove,
    true,
  );

  selectionOverlay.addEventListener(
    "pointerleave",
    function (e) {
      stopNativeInteraction(e);
      if (shouldKeepSpacingOverlayForLeave(e)) {
        updateSpacingOverlay(selectedEl);
        return;
      }
      if (!spacingDrag) {
        scheduleSpacingHoverClear(e);
      }
    },
    true,
  );

  shieldOverlay.addEventListener(
    "pointerleave",
    function (e) {
      stopNativeInteraction(e);
      if (shouldKeepSpacingOverlayForLeave(e)) {
        updateSpacingOverlay(selectedEl);
        return;
      }
      hoveredEl = null;
      if (!spacingDrag) {
        scheduleSpacingHoverClear(e);
      }
      highlightOverlay.style.display = "none";
      hideMeasurements();
      (window.parent as Window).postMessage(
        { type: "element-hover", payload: null },
        "*",
      );
    },
    true,
  );

  window.addEventListener(
    "keyup",
    function (e) {
      if (e.key === "Alt") hideMeasurements();
    },
    true,
  );

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    if (!e.data) return;
    // NOTE: no message type in this handler is sourced from a `payload`
    // sub-object — every host sender (DesignCanvas.tsx) puts its fields
    // directly on the top-level message. A previous blanket
    // `Object.keys(e.data.payload).forEach(...)` hoist here copied every key
    // of an arbitrary `payload` object onto `e.data` for ANY message type,
    // which could let an attacker-controlled `payload` (e.g. relayed through
    // a less-trusted surface) inject fields like `readOnly`, `force`, or
    // `content` into a message type that never intended to accept them. If a
    // future message type needs payload-sourced fields, extract them
    // explicitly inside that type's own branch below instead of reintroducing
    // a blanket hoist.
    // set-read-only: toggle the bridge's readOnly state in-place without a reload.
    // When readOnly becomes true the shield/selection/drag/edit entry points are
    // gated so the surface is safe for background/inactive display use.
    if (e.data.type === "set-read-only") {
      var nextReadOnly = !!e.data.readOnly;
      if (readOnly === nextReadOnly) return;
      readOnly = nextReadOnly;
      textEditingEnabled = !readOnly && textEditingEnabledFlag;
      if (readOnly) {
        // Leave the text editor gracefully before going read-only.
        if (activeTextEditEl) {
          activeTextEditEl.blur();
        }
        clearRuntimeSelection();
        shieldOverlay.style.pointerEvents = "none";
      } else {
        shieldOverlay.style.pointerEvents = "auto";
      }
      return;
    }
    // set-text-editing-enabled: toggle the bridge's edit/preview-mode flag
    // in-place without a reload, mirroring set-read-only above. The host
    // flips this whenever DesignCanvas's `editMode` prop changes (Edit ⇄
    // Preview). Without this postMessage path, `editMode` would need to stay
    // a srcdoc dependency, which rebuilds and reloads every screen iframe on
    // every edit/preview toggle.
    if (e.data.type === "set-text-editing-enabled") {
      var nextTextEditingEnabledFlag = !!e.data.enabled;
      if (textEditingEnabledFlag === nextTextEditingEnabledFlag) return;
      textEditingEnabledFlag = nextTextEditingEnabledFlag;
      var nextTextEditingEnabled = !readOnly && textEditingEnabledFlag;
      if (textEditingEnabled === nextTextEditingEnabled) return;
      textEditingEnabled = nextTextEditingEnabled;
      // Leaving text-editing-enabled mode: gracefully exit any in-progress
      // text edit rather than leaving a live contenteditable behind, mirroring
      // the readOnly transition above.
      if (!textEditingEnabled && activeTextEditEl) {
        activeTextEditEl.blur();
      }
      return;
    }
    // begin-text-edit: enter text-editing mode for the element identified by
    // nodeId immediately (no double-click needed). Used after programmatic
    // text-element creation so the user can type right away and the autosize
    // CSS (width:max-content or similar) takes effect from the first keystroke.
    if (e.data.type === "begin-text-edit") {
      var forceBeginTextEdit = e.data.force === true;
      if ((readOnly || !textEditingEnabled) && !forceBeginTextEdit) return;
      var nodeId: string =
        typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      if (!nodeId) return;
      var nodeTarget: Element | null = document.querySelector(
        '[data-agent-native-node-id="' +
          nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
          '"]',
      );
      if (!nodeTarget || nodeTarget.nodeType !== 1) return;
      // Edit the EXACT node identified by nodeId. Do NOT run it through
      // findTextEditTarget here — that helper climbs UP to the highest
      // inline-editable ancestor, which for a text node inside a text-heavy
      // screen resolves all the way to <main>, putting the ENTIRE screen into
      // edit mode instead of this node (keystrokes land in the wrong element).
      var textTarget: HTMLElement | null = nodeTarget as HTMLElement;
      if (!textTarget || textTarget.nodeType !== 1) return;
      // If we are already editing this element, do nothing.
      if (activeTextEditEl && activeTextEditEl === textTarget) return;
      // Synthesise coordinates at the end of the element content so the caret
      // lands at the insertion point (right after any placeholder text).
      var bteRect = textTarget.getBoundingClientRect();
      var bteCenterX = bteRect.right - 2;
      var bteCenterY = bteRect.top + bteRect.height / 2;
      // Delegate to the canonical path so all state, events, and postMessages
      // stay consistent with a normal double-click text edit.
      beginTextEditingFromEvent(
        {
          clientX: bteCenterX,
          clientY: bteCenterY,
          target: textTarget,
          agentNativeProgrammaticTextEdit: true,
          preventDefault: function () {},
          stopPropagation: function () {},
          stopImmediatePropagation: function () {},
        } as unknown as MouseEvent,
        forceBeginTextEdit,
      );
      return;
    }
    if (e.data.type === "set-editor-chrome-scale") {
      // Live-update the constant-size chrome scale WITHOUT rebuilding srcdoc.
      // Rebuilding srcdoc reloads the iframe and flashes the content white.
      editorChromeScaleX = Math.max(0.05, Number(e.data.scaleX) || 1);
      editorChromeScaleY = Math.max(
        0.05,
        Number(e.data.scaleY) || editorChromeScaleX,
      );
      applyEditorChromeScale();
      if (selectedEl || hoveredEl) refreshOverlays();
      return;
    }
    if (e.data.type === "scale-tool-mode") {
      scaleToolEnabled = !!e.data.enabled;
      return;
    }
    // gradient-edit-target / gradient-edit-clear: see the gradientEditTarget
    // doc comment above (near parseLinearGradientCss) for the full parent
    // wiring contract. `nodeId` must be a `data-agent-native-node-id` value;
    // `cssValue` is the live gradient CSS (only linear-gradient(...) renders
    // handles — anything else is accepted but draws nothing).
    if (e.data.type === "gradient-edit-target") {
      var gradientTargetNodeId =
        typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      var gradientTargetCssValue =
        typeof e.data.cssValue === "string" ? e.data.cssValue : "";
      if (!gradientTargetNodeId || !gradientTargetCssValue) {
        gradientEditTarget = null;
        hideGradientOverlay();
        return;
      }
      gradientEditTarget = {
        nodeId: gradientTargetNodeId,
        cssValue: gradientTargetCssValue,
      };
      positionGradientOverlay();
      return;
    }
    if (e.data.type === "gradient-edit-clear") {
      gradientEditTarget = null;
      hideGradientOverlay();
      return;
    }
    // state-preview: force-render one element's interaction-state styling by
    // setting/removing the `data-an-state-preview="<state>"` attribute — see
    // `shared/interaction-states.ts`'s "Forced-preview mechanism" doc comment
    // for the full contract this implements. This bridge does ZERO CSS work:
    // the twin `[data-agent-native-node-id="…"][data-an-state-preview="…"]`
    // rule already lives in the persisted `<style data-agent-native-states>`
    // block (written by `duplicateStatePreviewRules`), so setting the
    // attribute is the entire preview mechanism. `state: null` (or a missing/
    // empty `nodeId`) clears any currently-previewing element.
    if (e.data.type === "state-preview") {
      var statePreviewTargetNodeId =
        typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      var statePreviewState =
        typeof e.data.state === "string" ? e.data.state : "";
      // Clear the PREVIOUS target first — only one element force-previews a
      // state at a time, and the new message may target a different node
      // (e.g. the selection changed) or clear entirely.
      if (statePreviewNodeId) {
        var previousStatePreviewEl = document.querySelector(
          '[data-agent-native-node-id="' +
            String(statePreviewNodeId)
              .replace(/\\/g, "\\\\")
              .replace(/"/g, '\\"') +
            '"]',
        ) as HTMLElement | null;
        if (previousStatePreviewEl) {
          previousStatePreviewEl.removeAttribute("data-an-state-preview");
        }
        statePreviewNodeId = null;
      }
      if (!statePreviewTargetNodeId || !statePreviewState) return;
      var statePreviewEl = document.querySelector(
        '[data-agent-native-node-id="' +
          String(statePreviewTargetNodeId)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"') +
          '"]',
      ) as HTMLElement | null;
      if (!statePreviewEl) return;
      statePreviewEl.setAttribute("data-an-state-preview", statePreviewState);
      statePreviewNodeId = statePreviewTargetNodeId;
      return;
    }
    if (e.data.type === "agent-native:cancel-active-drag") {
      cancelActiveBridgeDrag();
      return;
    }
    if (e.data.type === "clear-selection") {
      // During marquee drag, empty hit sets are replayed back from the host as a
      // clear-selection state. Keep the drag-owned rectangle alive until pointer-up.
      if (activeMarqueeSelection) return;
      clearRuntimeSelection();
      return;
    }
    if (e.data.type === "agent-native:collect-selectable-rects") {
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
    // agent-native:text-edit-status: host-side query used instead of a direct
    // (now sandbox-blocked) iframe.contentDocument read. Mirrors the exact
    // resolution `postBeginTextEditToPreviewIframes` (DesignEditor.tsx) used to
    // do itself: find the node by data-agent-native-node-id, and report whether
    // a text-edit session is currently "active" on it (focused element carries
    // data-agent-native-text-editing), "done" (non-empty committed text and not
    // actively focused), or neither.
    if (e.data.type === "agent-native:text-edit-status") {
      var textEditStatusCorrelationId: string =
        typeof e.data.correlationId === "string" ? e.data.correlationId : "";
      var textEditStatusNodeId: string =
        typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      var textEditStatus: "active" | "done" | false = false;
      if (textEditStatusNodeId) {
        var escapedTextEditStatusNodeId = textEditStatusNodeId
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        var textEditStatusNode: Element | null = document.querySelector(
          '[data-agent-native-node-id="' + escapedTextEditStatusNodeId + '"]',
        );
        var textEditStatusEditingEl: Element | null = document.querySelector(
          '[data-agent-native-node-id="' +
            escapedTextEditStatusNodeId +
            '"][data-agent-native-text-editing]',
        );
        if (
          textEditStatusEditingEl &&
          document.activeElement === textEditStatusEditingEl
        ) {
          textEditStatus = "active";
        } else if (
          textEditStatusNode &&
          (textEditStatusNode.textContent ?? "").trim().length > 0
        ) {
          textEditStatus = "done";
        }
      }
      (window.parent as Window).postMessage(
        {
          type: "agent-native:text-edit-status-result",
          correlationId: textEditStatusCorrelationId,
          status: textEditStatus,
        },
        "*",
      );
      return;
    }
    if (e.data.type === "select-elements") {
      var passiveTargets: Element[] = [];
      var selectorGroups: unknown[] = Array.isArray(e.data.selectorGroups)
        ? e.data.selectorGroups
        : [];
      selectorGroups.forEach(function (group) {
        var selectors: string[] = [];
        if (Array.isArray(group)) {
          group.forEach(function (selector) {
            if (
              typeof selector === "string" &&
              selector &&
              selectors.indexOf(selector) === -1
            ) {
              selectors.push(selector);
            }
          });
        }
        for (var i = 0; i < selectors.length; i += 1) {
          try {
            var matches = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < matches.length; j += 1) {
              if (!isLayerInteractionBlocked(matches[j])) {
                passiveTargets.push(matches[j]);
                return;
              }
            }
          } catch (_err) {}
        }
      });
      setPassiveSelectionElements(passiveTargets);
      return;
    }
    if (e.data.type === "select-element") {
      var candidates: string[] = [];
      if (Array.isArray(e.data.selectorCandidates)) {
        e.data.selectorCandidates.forEach(function (selector) {
          if (
            typeof selector === "string" &&
            selector &&
            candidates.indexOf(selector) === -1
          ) {
            candidates.push(selector);
          }
        });
      }
      if (
        e.data.selector &&
        candidates.indexOf(String(e.data.selector)) === -1
      ) {
        candidates.push(String(e.data.selector));
      }
      var target =
        selectedEl &&
        document.documentElement.contains(selectedEl) &&
        matchesExactSelectorList(selectedEl, candidates)
          ? selectedEl
          : null;
      for (var i = 0; i < candidates.length && !target; i += 1) {
        try {
          var matches = document.querySelectorAll(candidates[i]);
          for (var j = 0; j < matches.length; j += 1) {
            if (!isLayerInteractionBlocked(matches[j])) {
              target = matches[j];
              break;
            }
          }
        } catch (_err) {}
      }
      if (!target) return;
      // Only reset the spacing hover state when the replay actually CHANGES
      // the selection. The host re-sends select-element on every
      // application-state poll tick (~1-2s) even when nothing changed; the
      // old unconditional reset silently killed the padding/gap hover state
      // — the "Npx" value box and the hatch band vanished within a poll tick
      // whenever the cursor RESTED on a handle (the user only ever saw the
      // badge flash, i.e. "the value box never shows"). A same-element
      // replay must be a no-op for hover state.
      if (target !== selectedEl) {
        selectedSpacingHovered = false;
        hoveredSpacingHandleKey = "";
      }
      selectedEl = target;
      positionOverlay(selectionOverlay, target);
      if (hoveredEl === selectedEl) highlightOverlay.style.display = "none";
      return;
    }
    if (e.data.type === "hover-element") {
      var hoverCandidates: string[] = [];
      if (Array.isArray(e.data.selectorCandidates)) {
        e.data.selectorCandidates.forEach(function (selector) {
          if (
            typeof selector === "string" &&
            selector &&
            hoverCandidates.indexOf(selector) === -1
          ) {
            hoverCandidates.push(selector);
          }
        });
      }
      if (
        e.data.selector &&
        hoverCandidates.indexOf(String(e.data.selector)) === -1
      ) {
        hoverCandidates.push(String(e.data.selector));
      }
      if (hoverCandidates.length === 0) {
        hoveredEl = null;
        highlightOverlay.style.display = "none";
        hideMeasurements();
        return;
      }
      var hoverTarget = findRuntimeTarget(
        String(e.data.selector || ""),
        hoverCandidates,
      );
      hoveredEl = hoverTarget;
      if (
        hoveredEl &&
        !isLayerInteractionBlocked(hoveredEl) &&
        hoveredEl !== selectedEl
      ) {
        positionOverlay(highlightOverlay, hoveredEl);
      } else {
        highlightOverlay.style.display = "none";
        hideMeasurements();
      }
      return;
    }
    if (e.data.type === "layer-states") {
      lockedSelectors = Array.isArray(e.data.lockedSelectors)
        ? e.data.lockedSelectors.filter(function (item) {
            return typeof item === "string";
          })
        : [];
      hiddenSelectors = Array.isArray(e.data.hiddenSelectors)
        ? e.data.hiddenSelectors.filter(function (item) {
            return typeof item === "string";
          })
        : [];
      if (selectedEl && isLayerInteractionBlocked(selectedEl)) {
        selectedEl = null;
        hideSelectionOverlay();
      }
      if (hoveredEl && isLayerInteractionBlocked(hoveredEl)) {
        hoveredEl = null;
        highlightOverlay.style.display = "none";
      }
      applyHiddenSelectors();
      return;
    }
    if (e.data.type === "visual-structure-ack") {
      var move = pendingStructureMoves[e.data.requestId];
      if (!move) return;
      delete pendingStructureMoves[e.data.requestId];
      if (e.data.applied) {
        if (move.el && move.el.isConnected) {
          applyRuntimeReorder(move.el, move.target);
          selectedEl = move.el;
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
        }
      } else {
        // Revert the optimistic reorder to its pre-drag position.
        if (
          move.el &&
          move.el.isConnected &&
          move.origin &&
          move.origin.prevParent &&
          move.origin.prevParent.isConnected
        ) {
          move.origin.prevParent.insertBefore(
            move.el,
            move.origin.prevNextSibling,
          );
          selectedEl = move.el;
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
        }
      }
      return;
    }
    if (e.data.type === "replace-document-content") {
      replaceRuntimeDocument(
        e.data.content,
        e.data.forceFullDocument ? "" : e.data.selectedSelector,
        e.data.forceFullDocument ? [] : e.data.selectorCandidates,
        Boolean(e.data.forceFullDocument),
      );
      return;
    }
    if (e.data.type === "delete-element") {
      removeRuntimeTarget(e.data.selector, e.data.selectorCandidates);
      return;
    }
    if (e.data.type !== "style-change") return;
    var sel = e.data.selector;
    var prop = e.data.property;
    var val = e.data.value;
    var candidatesForStyle = Array.isArray(e.data.selectorCandidates)
      ? e.data.selectorCandidates
      : [];
    if (sel && candidatesForStyle.indexOf(String(sel)) === -1)
      candidatesForStyle.push(String(sel));
    if (e.data.nodeId) {
      candidatesForStyle.push(
        '[data-agent-native-node-id="' +
          String(e.data.nodeId).replace(/"/g, '\\"') +
          '"]',
      );
    }
    var el = findRuntimeTarget(String(sel || ""), candidatesForStyle);
    // T11: a live text-edit session's selection lives inside activeTextEditEl,
    // but the incoming style-change's selector/candidates were captured from
    // selectedEl at edit-start time, which selectionTargetForHit may have
    // anchored to a source-backed ancestor rather than activeTextEditEl
    // itself (when the actual edit target is a runtime-only descendant).
    // Requiring `el === activeTextEditEl` then never matches, and the whole
    // ancestor gets restyled instead of just the visible range. Route on
    // activeTextEditEl's own relationship to the resolved target instead: a
    // style-change should still be treated as "editing the active session"
    // when the resolved element IS activeTextEditEl, or IS an ancestor that
    // activeTextEditEl lives inside (the panel is targeting "the thing the
    // user double-clicked into", which is this edit session, even though the
    // selector re-anchored to its stable container).
    var styleChangeTargetsActiveTextEdit =
      !!activeTextEditEl &&
      !!el &&
      (el === activeTextEditEl || el.contains(activeTextEditEl));
    if (
      prop &&
      styleChangeTargetsActiveTextEdit &&
      applyTextRangeStyle(prop, val)
    ) {
      postTextContentChange(
        activeTextEditEl,
        activeTextEditEl!.textContent || "",
        activeTextEditEl!.innerHTML || "",
      );
      refreshOverlays();
      return;
    }
    if (!el) return;
    var didPatchDom = false;
    var attributeOverrides = e.data.attributeOverrides;
    if (
      attributeOverrides &&
      typeof attributeOverrides === "object" &&
      !Array.isArray(attributeOverrides)
    ) {
      Object.keys(attributeOverrides).forEach(function (name) {
        if (!/^(?!on)[a-zA-Z][a-zA-Z0-9:_.-]*$/i.test(name)) return;
        var nextValue = attributeOverrides[name];
        if (
          nextValue === null ||
          nextValue === undefined ||
          nextValue === false
        ) {
          el.removeAttribute(name);
        } else {
          el.setAttribute(name, String(nextValue));
        }
        didPatchDom = true;
      });
    }
    var classEdit = e.data.classEdit;
    if (classEdit && typeof classEdit === "object") {
      var currentClass = (el.getAttribute("class") || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      var nextClass = currentClass.slice();
      if (classEdit.operation === "replace" && classEdit.from && classEdit.to) {
        var replaced = false;
        nextClass = currentClass.map(function (token) {
          if (token === classEdit.from) {
            replaced = true;
            return String(classEdit.to);
          }
          return token;
        });
        if (!replaced && nextClass.indexOf(String(classEdit.to)) === -1)
          nextClass.push(String(classEdit.to));
        didPatchDom = true;
      } else if (classEdit.operation === "add" && classEdit.className) {
        if (nextClass.indexOf(String(classEdit.className)) === -1)
          nextClass.push(String(classEdit.className));
        didPatchDom = true;
      } else if (classEdit.operation === "remove" && classEdit.className) {
        nextClass = currentClass.filter(function (token) {
          return token !== String(classEdit.className);
        });
        didPatchDom = true;
      }
      if (didPatchDom) el.setAttribute("class", nextClass.join(" "));
    }
    if (prop && typeof prop === "string") {
      applyInlineStyleProperty(el, prop, val);
      didPatchDom = true;
    }
    if (didPatchDom) {
      refreshOverlays();
    }
  });

  // rAF-coalesced on purpose: scroll events can fire several times per frame
  // (nested scrollers, high-rate trackpads), and running the full overlay
  // pipeline synchronously per event — with its interleaved rect reads and
  // overlay style writes — forces repeated synchronous reflows while a
  // selection is active. Coalescing to one refreshOverlays() per frame keeps
  // overlays visually locked to the content (rAF runs before paint) while
  // bounding the per-frame cost regardless of the incoming event rate.
  window.addEventListener("scroll", scheduleRefreshOverlays, true);
  window.addEventListener("resize", scheduleRefreshOverlays);
  applyEditorChromeScale();

  // One-time ready signal: tells the host that every message listener above is
  // now attached, so one-shot commands (begin-text-edit, set-editor-chrome-scale,
  // style-change, delete-element, replace-document-content) sent immediately
  // after (re)creating this iframe are safe to deliver. Without this, a command
  // posted before the bridge script has executed — or while the iframe is
  // reloading — is simply lost; replayIframeEditorState only replays
  // steady-state selection/hover/tweak/motion state, not one-shot commands.
  (window.parent as Window).postMessage(
    { type: "agent-native:editor-chrome-ready" },
    "*",
  );
})();
