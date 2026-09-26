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
 *   __DESIGN_CANVAS_CONTENT_OFFSET_X__ — embedded board render-window x offset
 *   __DESIGN_CANVAS_CONTENT_OFFSET_Y__ — embedded board render-window y offset
 *   __RUNTIME_LAYER_SNAPSHOT_ENABLED__ — true only for URL-backed localhost apps
 *
 * Rules:
 *   • The shared, build-time-inlined canvas interaction controller is the one
 *     permitted import. No runtime module lookup survives code generation.
 *   • No require of any module (DOM globals only at iframe runtime).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 *
 * keep in sync with hit-test.bridge.ts for the shared container/axis/placement
 * helpers (search for "// keep in sync" comments).
 */
import { createCanvasGestureController } from "@agent-native/toolkit/canvas-interactions";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

declare var __READ_ONLY__: boolean;
declare var __TEXT_EDITING_ENABLED__: boolean;
declare var __EDITOR_CHROME_SCALE_X__: string;
declare var __EDITOR_CHROME_SCALE_Y__: string;
declare var __DESIGN_CANVAS_SCREEN_ID__: string;
declare var __DESIGN_CANVAS_BOARD_SURFACE__: boolean;
declare var __DESIGN_CANVAS_CONTENT_OFFSET_X__: number;
declare var __DESIGN_CANVAS_CONTENT_OFFSET_Y__: number;
declare var __RUNTIME_LAYER_SNAPSHOT_ENABLED__: boolean;
declare var __LIVE_REFLOW_ENABLED__: boolean;
declare var __SELECTED_LAYER_DRAG_PRIORITY__: boolean;
declare var __INITIAL_SOURCE_HEAD__: string;

(function () {
  var readOnly = __READ_ONLY__;
  var textEditingEnabledFlag = __TEXT_EDITING_ENABLED__;
  var interactionMode = false;
  var designCanvasScreenId = __DESIGN_CANVAS_SCREEN_ID__ || "";
  var designCanvasBoardSurface = !!__DESIGN_CANVAS_BOARD_SURFACE__;
  var designCanvasContentOffsetX =
    Number(__DESIGN_CANVAS_CONTENT_OFFSET_X__) || 0;
  var designCanvasContentOffsetY =
    Number(__DESIGN_CANVAS_CONTENT_OFFSET_Y__) || 0;

  function clipboardScreenContext() {
    return !designCanvasBoardSurface && designCanvasScreenId
      ? { screenId: designCanvasScreenId }
      : {};
  }

  var previousEditorChromeBridge = (window as any).__anEditorChromeBridge;
  var previousEditorChromeHost =
    (window as any).__anEditorChromeBridgeHost ||
    (previousEditorChromeBridge &&
    typeof previousEditorChromeBridge === "object"
      ? previousEditorChromeBridge.host
      : null);
  var previousEditorChromeBridgeInstance = (window as any)
    .__anEditorChromeBridgeInstance;
  if (
    previousEditorChromeBridgeInstance &&
    typeof previousEditorChromeBridgeInstance.repair === "function"
  ) {
    if (typeof previousEditorChromeBridgeInstance.updateConfig === "function") {
      previousEditorChromeBridgeInstance.updateConfig({
        readOnly: readOnly,
        textEditingEnabled: textEditingEnabledFlag,
        screenId: designCanvasScreenId,
        boardSurface: designCanvasBoardSurface,
        contentOffsetX: designCanvasContentOffsetX,
        contentOffsetY: designCanvasContentOffsetY,
      });
    }
    previousEditorChromeBridgeInstance.repair();
    return;
  }
  if (
    previousEditorChromeHost instanceof HTMLElement &&
    previousEditorChromeHost.isConnected
  ) {
    (window as any).__anEditorChromeBridge = true;
    (window as any).__anEditorChromeBridgeHost = previousEditorChromeHost;
    return;
  }

  var editorChromeNodes: HTMLElement[] = [];
  var editorChromeHost: HTMLElement | null = null;
  var editorChromeHostObserver: MutationObserver | null = null;
  var editorChromeDocumentObserver: MutationObserver | null = null;
  var editorChromeRootObserver: MutationObserver | null = null;
  var repairingEditorChromeHost = false;

  function sendEditorChromeReady(): void {
    (window.parent as Window).postMessage(
      {
        type: "agent-native:editor-chrome-ready",
        routePath: window.location.pathname + window.location.search,
        documentId: runtimeDocumentId,
      },
      "*",
    );
  }

  function ensureEditorChromeHost(): HTMLElement {
    if (
      editorChromeHost &&
      editorChromeHost.isConnected &&
      editorChromeHost.parentNode === document.documentElement
    ) {
      syncEditorChromeHostStyle(editorChromeHost);
      (window as any).__anEditorChromeBridgeHost = editorChromeHost;
      return editorChromeHost;
    }
    editorChromeHost = document.createElement("div");
    editorChromeHost.setAttribute(
      "data-agent-native-editor-chrome-host",
      "true",
    );
    editorChromeHost.setAttribute("aria-hidden", "true");
    syncEditorChromeHostStyle(editorChromeHost);
    (document.documentElement || document.body).appendChild(editorChromeHost);
    (window as any).__anEditorChromeBridgeHost = editorChromeHost;
    return editorChromeHost;
  }

  function syncEditorChromeHostStyle(host: HTMLElement): void {
    host.style.position = "fixed";
    host.style.inset = "0px";
    host.style.zIndex = readOnly ? "2147483000" : "2147483647";
    host.style.pointerEvents = "none";
    host.style.overflow = "visible";
    var themeVars = (window as any).__anEditorBridgeThemeVars;
    if (themeVars && typeof themeVars === "object") {
      Object.keys(themeVars).forEach(function (name) {
        if (typeof themeVars[name] === "string") {
          host.style.setProperty(name, themeVars[name]);
        }
      });
    }
  }

  function appendEditorChromeNode(node: HTMLElement): void {
    if (editorChromeNodes.indexOf(node) === -1) {
      editorChromeNodes.push(node);
    }
    var host = ensureEditorChromeHost();
    if (node.parentNode !== host) host.appendChild(node);
  }

  function removeEditorChromeNode(node: HTMLElement): void {
    var index = editorChromeNodes.indexOf(node);
    if (index !== -1) editorChromeNodes.splice(index, 1);
    if (node.parentNode) node.parentNode.removeChild(node);
  }

  function repairEditorChromeHost(): void {
    if (repairingEditorChromeHost) return;
    repairingEditorChromeHost = true;
    try {
      var host = ensureEditorChromeHost();
      editorChromeNodes.forEach(function (node) {
        if (node.parentNode !== host) host.appendChild(node);
      });
      sendEditorChromeReady();
    } finally {
      repairingEditorChromeHost = false;
    }
  }

  function observeEditorChromeHost(): void {
    if (typeof MutationObserver === "undefined") return;
    var host = ensureEditorChromeHost();
    editorChromeHostObserver?.disconnect();
    editorChromeDocumentObserver?.disconnect();
    editorChromeHostObserver = new MutationObserver(repairEditorChromeHost);
    editorChromeHostObserver.observe(host, { childList: true });
    editorChromeDocumentObserver = new MutationObserver(function () {
      if (
        !editorChromeHost ||
        !editorChromeHost.isConnected ||
        editorChromeHost.parentNode !== document.documentElement
      ) {
        observeEditorChromeHost();
        repairEditorChromeHost();
      }
    });
    editorChromeDocumentObserver.observe(document.documentElement, {
      childList: true,
    });
    if (!editorChromeRootObserver) {
      editorChromeRootObserver = new MutationObserver(function () {
        observeEditorChromeHost();
        repairEditorChromeHost();
      });
      editorChromeRootObserver.observe(document, { childList: true });
    }
  }

  ensureEditorChromeHost();
  (window as any).__anEditorChromeBridge = true;
  (window as any).__anEditorChromeBridgeHost = editorChromeHost;

  var gridGroupBatchingEnabled = false;
  var textEditingEnabled = !readOnly && textEditingEnabledFlag;
  var runtimeLayerSnapshotEnabled = !!__RUNTIME_LAYER_SNAPSHOT_ENABLED__;
  var liveReflowEnabled = (function () {
    try {
      return !!__LIVE_REFLOW_ENABLED__;
    } catch (_e) {
      return false;
    }
  })();
  var selectedLayerDragPriorityEnabled = (function () {
    try {
      return !!__SELECTED_LAYER_DRAG_PRIORITY__;
    } catch (_e) {
      return false;
    }
  })();
  var scaleToolEnabled = false;

  function dndLog(phase: string, data?: unknown): void {
    if (!(window as any).__DND_DEBUG) return;
    try {
      var tag = "%c[dnd:" + phase + "]";
      var style = "color:#8b5cf6;font-weight:bold";
      if (data === undefined) console.log(tag, style);
      else console.log(tag, style, data);
    } catch (_e) {}
  }
  function dndTarget(t): unknown {
    if (!t) return null;
    try {
      var container = dropContainerForTarget(t);
      return {
        anchor: t.anchor ? getSelector(t.anchor) : null,
        placement: t.placement,
        dropMode: t.dropMode,
        axis: t.axis,
        container: container ? getSelector(container) : null,
        needsConversion: !!t.needsAutoLayoutConversion,
      };
    } catch (_e) {
      return { placement: t.placement, dropMode: t.dropMode };
    }
  }

  var statePreviewElement: HTMLElement | null = null;
  type RuntimeInteractionStatePreview = {
    element: HTMLElement;
    key: string;
    state: string;
    styles: Record<string, string>;
  };
  var runtimeInteractionStatePreviews: RuntimeInteractionStatePreview[] = [];
  var runtimeInteractionStatePreviewSequence = 0;
  var runtimeInteractionStatePreviewStyle: HTMLStyleElement | null = null;
  var editorChromeScaleX = Math.max(
    0.05,
    Number(__EDITOR_CHROME_SCALE_X__) || 1,
  );
  var editorChromeScaleY = Math.max(
    0.05,
    Number(__EDITOR_CHROME_SCALE_Y__) || editorChromeScaleX,
  );

  var chromeTransitionStyle: HTMLStyleElement | null = null;

  function ensureEditorChromeStyle(): void {
    if (chromeTransitionStyle && chromeTransitionStyle.isConnected) return;
    chromeTransitionStyle = document.createElement("style");
    chromeTransitionStyle.setAttribute(
      "data-agent-native-editor-chrome-style",
      "",
    );
    chromeTransitionStyle.textContent =
      "html{overflow:clip}"  +
      '[data-agent-native-edit-overlay="selection"]{transition:border-width 150ms ease-out}' +
      '[data-agent-native-empty-text-editing="true"] [data-agent-native-edit-overlay="selection"]{display:none!important}' +
      "[data-agent-native-text-editing]{outline:none!important;outline-offset:0!important}" +
      "[data-agent-native-drawn-caret]{caret-color:transparent!important}" +
      "[data-agent-native-inspector-styling-range] ::selection{background:transparent!important}" +
      "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle]{transition:width 150ms ease-out,height 150ms ease-out,border-width 150ms ease-out,top 150ms ease-out,bottom 150ms ease-out,left 150ms ease-out,right 150ms ease-out}" +
      "[data-agent-native-suppress-handle-transition] [data-agent-native-edge-handle],[data-agent-native-suppress-handle-transition] [data-agent-native-edit-handle],[data-agent-native-suppress-handle-transition] [data-agent-native-rotate-handle]{transition:none!important}" +
      '[data-agent-native-runtime-locked="true"]{outline:calc(1px * var(--agent-native-editor-chrome-line-scale, 1)) dashed rgba(148,163,184,0.9)!important;outline-offset:0!important;cursor:not-allowed!important}' +
      "[data-agent-native-spacing-line]{position:absolute;display:none;pointer-events:none;border-radius:999px}" +
      "[data-agent-native-spacing-region]{position:absolute;display:none;box-sizing:border-box;pointer-events:auto;background-size:6px 6px}" +
      '[data-agent-native-spacing-region][data-orientation="vertical"]{cursor:ew-resize}' +
      '[data-agent-native-spacing-region][data-orientation="horizontal"]{cursor:ns-resize}';
    (document.head || document.documentElement).appendChild(
      chromeTransitionStyle,
    );
  }

  ensureEditorChromeStyle();

  function isSupportedInteractionState(value: string): boolean {
    return (
      value === "hover" ||
      value === "focus" ||
      value === "focus-visible" ||
      value === "active" ||
      value === "disabled"
    );
  }

  function normalizeInteractionStateProperty(property: string): string {
    return String(property || "")
      .trim()
      .replace(/[A-Z]/g, function (match) {
        return "-" + match.toLowerCase();
      });
  }

  function isSafeInteractionStatePreviewValue(value: string): boolean {
    return (
      value.trim().length > 0 &&
      !/[;{}<>]|\/\*|\*\/|\burl\s*\(/i.test(value) &&
      !/[\u0000-\u001f\u007f]/.test(value)
    );
  }

  function renderRuntimeInteractionStatePreviews(): void {
    runtimeInteractionStatePreviews = runtimeInteractionStatePreviews.filter(
      function (entry) {
        return (
          entry.element.isConnected && Object.keys(entry.styles).length > 0
        );
      },
    );
    if (runtimeInteractionStatePreviewStyle?.isConnected) {
      runtimeInteractionStatePreviewStyle.remove();
    }
    runtimeInteractionStatePreviewStyle = null;
    if (runtimeInteractionStatePreviews.length === 0) return;

    var style = document.createElement("style");
    style.setAttribute("data-agent-native-runtime-state-previews", "");
    (document.head || document.documentElement).appendChild(style);
    runtimeInteractionStatePreviewStyle = style;
    var sheet = style.sheet;
    if (!sheet) return;
    runtimeInteractionStatePreviews.forEach(function (entry) {
      var selector =
        '[data-an-state-preview-key="' +
        entry.key +
        '"][data-an-state-preview="' +
        entry.state +
        '"]';
      try {
        var index = sheet.insertRule(selector + "{}", sheet.cssRules.length);
        var rule = sheet.cssRules[index] as CSSStyleRule;
        Object.keys(entry.styles).forEach(function (rawProperty) {
          var property = normalizeInteractionStateProperty(rawProperty);
          var value = String(entry.styles[rawProperty] || "").trim();
          if (!/^-?[a-z][a-z0-9-]*$/i.test(property) || !value) return;
          rule.style.setProperty(property, value, "important");
        });
      } catch (_err) {}
    });
  }

  function updateRuntimeInteractionStatePreview(
    element: HTMLElement,
    state: string,
    styles: Record<string, unknown> | null,
    replace: boolean,
  ): void {
    if (!isSupportedInteractionState(state)) return;
    var key = element.getAttribute("data-an-state-preview-key");
    if (!key) {
      runtimeInteractionStatePreviewSequence += 1;
      key = String(runtimeInteractionStatePreviewSequence);
      element.setAttribute("data-an-state-preview-key", key);
    }
    var existingIndex = runtimeInteractionStatePreviews.findIndex(
      function (entry) {
        return entry.element === element && entry.state === state;
      },
    );
    var nextStyles: Record<string, string> =
      !replace && existingIndex >= 0
        ? { ...runtimeInteractionStatePreviews[existingIndex]!.styles }
        : {};
    if (styles && typeof styles === "object") {
      Object.keys(styles).forEach(function (property) {
        var value = styles[property];
        if (typeof value !== "string" || value.trim() === "") {
          delete nextStyles[property];
        } else if (isSafeInteractionStatePreviewValue(value)) {
          nextStyles[property] = value;
        }
      });
    }
    if (existingIndex >= 0) {
      if (Object.keys(nextStyles).length === 0) {
        runtimeInteractionStatePreviews.splice(existingIndex, 1);
      } else {
        runtimeInteractionStatePreviews[existingIndex] = {
          element: element,
          key: key,
          state: state,
          styles: nextStyles,
        };
      }
    } else if (Object.keys(nextStyles).length > 0) {
      runtimeInteractionStatePreviews.push({
        element: element,
        key: key,
        state: state,
        styles: nextStyles,
      });
    }
    if (
      !runtimeInteractionStatePreviews.some(function (entry) {
        return entry.element === element;
      })
    ) {
      element.removeAttribute("data-an-state-preview-key");
    }
    renderRuntimeInteractionStatePreviews();
  }

  var lastSourceHeadHtml: string | null =
    typeof __INITIAL_SOURCE_HEAD__ === "string"
      ? __INITIAL_SOURCE_HEAD__ || null
      : null;

  function headNodeSignature(node: Element): string {
    var tag = node.tagName.toLowerCase();
    if (tag === "title" || tag === "base") return tag;
    if (tag === "style") {
      var attrs = node.attributes;
      for (var i = 0; i < attrs.length; i += 1) {
        var name = attrs[i]!.name;
        if (name.indexOf("data-agent-native-") === 0) return "style:" + name;
      }
      return "";
    }
    if (tag === "meta") {
      var meta = ["name", "property", "http-equiv", "charset"];
      for (var m = 0; m < meta.length; m += 1) {
        if (node.hasAttribute(meta[m]!)) {
          return "meta:" + meta[m] + "=" + node.getAttribute(meta[m]!);
        }
      }
      return "";
    }
    return "";
  }

  function findHeadNodeBySignature(signature: string): Element | null {
    var children = document.head ? document.head.children : null;
    if (!children) return null;
    for (var i = 0; i < children.length; i += 1) {
      var candidate = children[i]!;
      if (headNodeSignature(candidate) === signature) return candidate;
    }
    return null;
  }

  function replaceSourceHeadNodes(
    previousSourceHtml: string | null,
    nextSourceHtml: string,
  ): void {
    if (!document.head) return;
    var stale = document.createElement("head");
    stale.innerHTML = previousSourceHtml || "";
    var staleCounts: Record<string, number> = {};
    Array.prototype.forEach.call(stale.children, function (node: Element) {
      var key = node.outerHTML;
      staleCounts[key] = (staleCounts[key] || 0) + 1;
    });
    var retained = document.createElement("head");
    retained.innerHTML = nextSourceHtml || "";
    Array.prototype.forEach.call(retained.children, function (node: Element) {
      var key = node.outerHTML;
      if (staleCounts[key]) staleCounts[key] -= 1;
    });
    Array.prototype.slice.call(document.head.children).forEach(function (
      node: Element,
    ) {
      var key = node.outerHTML;
      if (!staleCounts[key]) return;
      staleCounts[key] -= 1;
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    var next = document.createElement("head");
    next.innerHTML = nextSourceHtml || "";
    var present: Record<string, number> = {};
    Array.prototype.forEach.call(
      document.head.children,
      function (node: Element) {
        var key = node.outerHTML;
        present[key] = (present[key] || 0) + 1;
      },
    );
    var anchor = document.head.firstChild;
    Array.prototype.slice.call(next.children).forEach(function (node: Element) {
      var key = node.outerHTML;
      if (present[key]) {
        present[key] -= 1;
        return;
      }
      var signature =
        previousSourceHtml === null ? headNodeSignature(node) : "";
      if (signature) {
        var existing = findHeadNodeBySignature(signature);
        if (existing) {
          var nextAnchor = existing.nextSibling;
          document.head.replaceChild(document.importNode(node, true), existing);
          if (anchor === existing) anchor = nextAnchor;
          return;
        }
      }
      document.head.insertBefore(document.importNode(node, true), anchor);
    });
    scheduleScreenRootStyleSnapshot();
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
    var text = String(value);
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(text);
    }
    return text.replace(/[\0-\x1f\x7f\\"]/g, function (character) {
      if (character === "\\" || character === '"') return "\\" + character;
      return "\\" + character.charCodeAt(0).toString(16) + " ";
    });
  }

  function attributeSelector(el: Element | null, name: string): string {
    var value = el && el.getAttribute && el.getAttribute(name);
    return value ? "[" + name + '="' + escapeAttribute(value) + '"]' : "";
  }

  function isStableIdentitySelector(selector: string): boolean {
    if (!selector || /[\s>+~,]/.test(selector)) return false;
    if (/^#[^#.:[\]()]+$/.test(selector)) return true;
    return /^\[(data-agent-native-node-id|data-code-layer-id|data-layer-id|data-builder-id|data-loc)="/.test(
      selector,
    );
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

  function selectorPart(el: Element | null, structuralOnly = false): string {
    if (!el || !el.tagName) return "";
    if (isTemplateCloneElement(el)) {
      var cloneTag = el.tagName.toLowerCase();
      var cloneParent = el.parentElement;
      if (!cloneParent) return cloneTag;
      var typeIndex = 0;
      for (var at = 0; at < cloneParent.children.length; at += 1) {
        var sibling = cloneParent.children[at];
        if (sibling.tagName === el.tagName) typeIndex += 1;
        if (sibling === el) break;
      }
      return cloneTag + ":nth-of-type(" + typeIndex + ")";
    }
    var stableSelector =
      attributeSelector(el, "data-agent-native-node-id") ||
      attributeSelector(el, "data-code-layer-id") ||
      attributeSelector(el, "data-layer-id") ||
      attributeSelector(el, "data-builder-id") ||
      attributeSelector(el, "data-loc");
    if (stableSelector && !structuralOnly)
      return el.tagName.toLowerCase() + stableSelector;
    if (el.id && !structuralOnly) return "#" + escapeIdent(el.id);
    var part =
      el.tagName.toLowerCase() +
      (structuralOnly ? "" : stableSelector || classSelectorSuffix(el, 2));
    var parent = el.parentElement;
    if (parent) {
      var sameTag = Array.prototype.filter.call(
        parent.children,
        function (child) {
          if (child.tagName !== el.tagName) return false;
          if (isOverlayElement(child)) return false;
          if (child !== el && isTemplateCloneElement(child)) return false;
          return true;
        },
      );
      if (sameTag.length > 1) {
        part += ":nth-of-type(" + (sameTag.indexOf(el) + 1) + ")";
      }
    }
    return part;
  }

  function selectorPath(
    el: Element | null,
    stopEl?: Element | null,
    structuralOnly = false,
  ): string {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      if (node !== stopEl) parts.unshift(selectorPart(node, structuralOnly));
      if (node === stopEl) break;
      node = node.parentElement;
    }
    return (structuralOnly ? parts : parts.slice(-5)).join(" > ");
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

  function readSourceDocumentProvenance(): {
    versionHash?: string;
    uniqueNodeIds: string[];
  } {
    return sourceDocumentProvenanceSnapshot;
  }

  function isUniqueRenderedSourceId(
    sourceId: string,
    expectedElement?: Element | null,
  ): boolean {
    if (!sourceId) return false;
    var selectors = [
      '[data-agent-native-node-id="' + escapeAttribute(sourceId) + '"]',
      '[data-code-layer-id="' + escapeAttribute(sourceId) + '"]',
      '[data-layer-id="' + escapeAttribute(sourceId) + '"]',
      '[data-builder-id="' + escapeAttribute(sourceId) + '"]',
      '[data-loc="' + escapeAttribute(sourceId) + '"]',
      '[id="' + escapeAttribute(sourceId) + '"]',
    ];
    var matches = document.querySelectorAll(selectors.join(","));
    return (
      matches.length === 1 &&
      (!expectedElement || matches[0] === expectedElement)
    );
  }

  function nodeProvenanceForSourceId(
    sourceId: string,
    element: Element | null,
  ): { versionHash?: string; uniqueNodeId?: string } | undefined {
    if (
      !element ||
      !isSourceOwned(element) ||
      isTemplateCloneElement(element)
    ) {
      return undefined;
    }
    var documentProvenance = readSourceDocumentProvenance();
    var nodeProvenance: { versionHash?: string; uniqueNodeId?: string } = {};
    if (documentProvenance.versionHash) {
      nodeProvenance.versionHash = documentProvenance.versionHash;
    }
    if (
      sourceId &&
      documentProvenance.uniqueNodeIds.indexOf(sourceId) !== -1 &&
      isUniqueRenderedSourceId(sourceId, element)
    ) {
      nodeProvenance.uniqueNodeId = sourceId;
    }
    return nodeProvenance.versionHash || nodeProvenance.uniqueNodeId
      ? nodeProvenance
      : undefined;
  }

  function normalizeSourceDocumentProvenance(
    value: unknown,
  ): { versionHash?: string; uniqueNodeIds: string[] } | undefined {
    if (!value || typeof value !== "object") return undefined;
    var candidate = value as {
      versionHash?: unknown;
      uniqueNodeIds?: unknown;
    };
    var uniqueNodeIds: string[] = [];
    var seenNodeIds = new Set<string>();
    if (Array.isArray(candidate.uniqueNodeIds)) {
      candidate.uniqueNodeIds.forEach(function (nodeId) {
        if (typeof nodeId === "string" && nodeId && !seenNodeIds.has(nodeId)) {
          seenNodeIds.add(nodeId);
          uniqueNodeIds.push(nodeId);
        }
      });
    }
    var provenance: { versionHash?: string; uniqueNodeIds: string[] } = {
      uniqueNodeIds: uniqueNodeIds,
    };
    if (typeof candidate.versionHash === "string" && candidate.versionHash) {
      provenance.versionHash = candidate.versionHash;
    }
    return provenance;
  }

  function publishSourceDocumentProvenance(
    sourceProvenance?: { versionHash?: string; uniqueNodeIds: string[] },
    partialMutation?: boolean,
  ): void {
    var uniqueNodeIds = sourceProvenance
      ? sourceProvenance.uniqueNodeIds
      : partialMutation
        ? readSourceDocumentProvenance().uniqueNodeIds
        : [];
    var published: { versionHash?: string; uniqueNodeIds: string[] } = {
      uniqueNodeIds: uniqueNodeIds,
    };
    if (sourceProvenance?.versionHash) {
      published.versionHash = sourceProvenance.versionHash;
    }
    sourceDocumentProvenanceSnapshot = published;
    (window as any).__agentNativeSourceProvenance = published;
  }

  var sourceDocumentProvenanceSnapshot = normalizeSourceDocumentProvenance(
    (window as any).__agentNativeSourceProvenance,
  ) || { uniqueNodeIds: [] };
  if ((window as any).__agentNativeSourceProvenance) {
    (window as any).__agentNativeSourceProvenance =
      sourceDocumentProvenanceSnapshot;
  }

  var PROVENANCE_NOISE_SEGMENTS: Record<string, true> = {
    node_modules: true,
    dist: true,
    build: true,
    ".next": true,
    public: true,
    ".vite": true,
  };

  var PROVENANCE_REACT_RUNTIME_MODULE_RE =
    /^(?:react|(?:react[-_])?jsx(?:-dev)?-runtime)(?:\.development|\.production(?:\.min)?)?\.(?:m?js|cjs)$/;
  var PROVENANCE_VITE_DEPS_SEGMENT_RE = /^deps(?:_|$)/;

  function isProvenanceNoisePath(
    path: string,
    localServedOutput: boolean,
  ): boolean {
    var segments = path.split("/");
    for (var i = 0; i < segments.length - 1; i += 1) {
      if (
        PROVENANCE_VITE_DEPS_SEGMENT_RE.test(segments[i]!) &&
        PROVENANCE_REACT_RUNTIME_MODULE_RE.test(segments[i + 1]!)
      ) {
        return true;
      }
    }
    for (var i = 0; i < segments.length; i += 1) {
      var segment = segments[i]!;
      if (localServedOutput && (segment === "dist" || segment === "build")) {
        continue;
      }
      if (PROVENANCE_NOISE_SEGMENTS[segment]) return true;
      if (segment === "_next" && segments[i + 1] === "static") return true;
    }
    return false;
  }

  function resolveProvenanceFrameUrl(rawUrl: string): {
    sourceFile: string;
    servedUrl?: string;
    localServedOutput: boolean;
  } | null {
    if (rawUrl.indexOf("webpack-internal:///") === 0) {
      var webpackPath = rawUrl
        .slice("webpack-internal:///".length)
        .replace(/^\.\//, "");
      return webpackPath
        ? { sourceFile: webpackPath, localServedOutput: false }
        : null;
    }
    try {
      var baseUrl =
        typeof document !== "undefined" ? document.baseURI : undefined;
      var url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
      var path = decodeURIComponent(url.pathname);
      var localServedOutput = path.indexOf("/@fs/") === 0;
      if (path.indexOf("/@fs/") === 0) {
        path = path.slice("/@fs".length);
      } else if (url.protocol !== "file:") {
        path = path.replace(/^\/+/, "");
      }
      return path
        ? {
            sourceFile: path,
            servedUrl: url.href,
            localServedOutput: localServedOutput,
          }
        : null;
    } catch (_error) {
      // coercion-ok: malformed stack URLs have no source location.
      return null;
    }
  }

  var PROVENANCE_STACK_FRAME_RE =
    /^\s*at\s+(?:([^\s(]+)\s+\()?([^()\s][^()]*?):(\d+):(\d+)\)?\s*$/;

  function parseProvenanceStackFrame(lineText: string): {
    sourceFile: string;
    line: number;
    column: number;
    functionName?: string;
    servedUrl?: string;
    localServedOutput: boolean;
  } | null {
    var match = PROVENANCE_STACK_FRAME_RE.exec(lineText);
    if (!match) return null;
    var resolved = resolveProvenanceFrameUrl(match[2]!);
    if (!resolved) return null;
    if (
      isProvenanceNoisePath(resolved.sourceFile, resolved.localServedOutput)
    ) {
      return null;
    }
    var line = parseInt(match[3]!, 10);
    var column = parseInt(match[4]!, 10);
    if (!isFinite(line) || !isFinite(column)) return null;
    return {
      sourceFile: resolved.sourceFile,
      line: line,
      column: column,
      functionName: match[1] || undefined,
      servedUrl: resolved.servedUrl,
      localServedOutput: resolved.localServedOutput,
    };
  }

  function fiberDebugLocation(fiber: any): {
    sourceFile: string;
    line: number;
    column?: number;
    functionName?: string;
    structured: boolean;
    servedUrl?: string;
  } | null {
    var source =
      fiber._debugSource ||
      (fiber._debugInfo && fiber._debugInfo.source) ||
      (fiber.stateNode && fiber.stateNode._debugSource) ||
      (fiber.elementType && fiber.elementType._debugSource);
    if (source && source.fileName) {
      return {
        sourceFile: source.fileName,
        line: source.lineNumber,
        column: source.columnNumber,
        structured: true,
      };
    }
    var stack =
      (fiber._debugStack && fiber._debugStack.stack) ||
      (fiber._debugInfo && fiber._debugInfo.stack) ||
      (fiber.stateNode &&
        fiber.stateNode._debugStack &&
        fiber.stateNode._debugStack.stack);
    if (!stack) return null;
    var lines = String(stack).split("\n");
    for (var index = 0; index < lines.length; index += 1) {
      var parsed = parseProvenanceStackFrame(lines[index]!);
      if (parsed) {
        return {
          sourceFile: parsed.sourceFile,
          line: parsed.line,
          column: parsed.column,
          functionName: parsed.functionName,
          structured: false,
          servedUrl: parsed.servedUrl,
        };
      }
    }
    return null;
  }

  type FrameworkDebugProvenance = {
    framework?: "html" | "react" | "vue" | "svelte" | "angular" | "lwc";
    sourceFile?: string;
    line?: number;
    column?: number;
    component?: string;
    ownerSourceFile?: string;
    ownerLine?: number;
    ownerColumn?: number;
    ownerComponentName?: string;
    ownerKey?: string;
    method?:
      | "data-attribute"
      | "debug-source"
      | "debug-stack"
      | "debug-stack-remapped"
      | "vue-inspector"
      | "svelte-meta";
    ownerMethod?: "debug-source" | "debug-stack" | "debug-stack-remapped";
    unavailableReason?: "not-framework" | "no-debug-info";
  };

  function parentElementOrShadowHost(node: any): Element | null {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    if (typeof node.getRootNode !== "function") return null;
    var rootNode = node.getRootNode();
    var isShadowRoot =
      rootNode &&
      typeof rootNode.host !== "undefined" &&
      typeof rootNode.mode === "string";
    return isShadowRoot && rootNode.host ? rootNode.host : null;
  }

  var reactDebugProvenanceCache =
    typeof WeakMap !== "undefined"
      ? new WeakMap<Element, FrameworkDebugProvenance>()
      : null;

  var REACT_FIBER_KEY_PREFIXES = [
    "__reactFiber$",
    "__reactInternalInstance$",
    "__reactInternalFiberCurrent$",
    "__reactInternalFiber$",
  ];

  function reactFiberOf(el: Element): any {
    var keys = Object.getOwnPropertyNames(el);
    var fallback = null;
    for (var i = 0; i < keys.length; i += 1) {
      for (var j = 0; j < REACT_FIBER_KEY_PREFIXES.length; j += 1) {
        if (keys[i]!.indexOf(REACT_FIBER_KEY_PREFIXES[j]!) === 0) {
          var fiber = (el as unknown as Record<string, any>)[keys[i]!];
          if (!fallback) fallback = fiber;
          if (fiber && fiber._debugSource) return fiber;
        }
      }
    }
    return fallback;
  }

  function reactDebugProvenance(el: Element): FrameworkDebugProvenance {
    var cached = reactDebugProvenanceCache?.get(el);
    if (
      cached !== undefined &&
      (cached.method === "debug-source" ||
        cached.method === "debug-stack-remapped")
    ) {
      return cached;
    }
    var leafFiber = reactFiberOf(el);
    if (!leafFiber) return { unavailableReason: "not-framework" };

    var elementLocation = fiberDebugLocation(leafFiber);
    var componentFiber: any = null;
    var fiber = leafFiber.return || leafFiber.parent || leafFiber._debugOwner;
    for (var depth = 0; fiber && depth < 12; depth += 1) {
      if (!componentFiber && typeof fiber.type === "function") {
        componentFiber = fiber;
      }
      if (componentFiber) break;
      fiber = fiber.return || fiber.parent || fiber._debugOwner;
    }
    if (!elementLocation) {
      return { framework: "react", unavailableReason: "no-debug-info" };
    }

    var componentName =
      (componentFiber &&
        componentFiber.type &&
        (componentFiber.type.displayName || componentFiber.type.name)) ||
      elementLocation.functionName ||
      elementLocation.sourceFile.split("/").pop()?.split(".")[0] ||
      undefined;
    var provenance: FrameworkDebugProvenance = {
      framework: "react",
      sourceFile: elementLocation.sourceFile,
      line: elementLocation.line,
      column: elementLocation.column,
      component: componentName,
      method: elementLocation.structured ? "debug-source" : "debug-stack",
    };
    if (componentFiber) {
      var ownerLocation = fiberDebugLocation(componentFiber);
      if (ownerLocation) {
        provenance.ownerSourceFile = ownerLocation.sourceFile;
        provenance.ownerLine = ownerLocation.line;
        provenance.ownerColumn = ownerLocation.column;
        provenance.ownerComponentName = componentName;
        provenance.ownerMethod = ownerLocation.structured
          ? "debug-source"
          : "debug-stack";
      }
      if (typeof componentFiber.key === "string" && componentFiber.key) {
        provenance.ownerKey = componentFiber.key;
      }
    }
    reactDebugProvenanceCache?.set(el, provenance);
    return provenance;
  }

  var sourceMapPromiseCache =
    typeof Map !== "undefined" ? new Map<string, Promise<any>>() : null;

  function unavailableProvenanceValue(): null {
    return null;
  }

  function sourceMapRequestFailure(_error: unknown): null {
    return unavailableProvenanceValue();
  }

  function sourceMapUrlForFrame(servedUrl: string | undefined): string | null {
    if (!servedUrl) return null;
    try {
      var baseUrl =
        typeof document !== "undefined" ? document.baseURI : undefined;
      var url = baseUrl ? new URL(servedUrl, baseUrl) : new URL(servedUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      url.pathname = url.pathname + ".map";
      return url.href;
    } catch (_error) {
      // coercion-ok: a non-URL stack source has no fetchable source map.
      return unavailableProvenanceValue();
    }
  }

  function loadProvenanceSourceMap(
    servedUrl: string | undefined,
  ): Promise<any> {
    var mapUrl = sourceMapUrlForFrame(servedUrl);
    if (!mapUrl) return Promise.resolve(null);
    var cached = sourceMapPromiseCache?.get(mapUrl);
    if (cached) return cached;
    var request = fetch(mapUrl, { credentials: "same-origin" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .catch(sourceMapRequestFailure);
    sourceMapPromiseCache?.set(mapUrl, request);
    return request;
  }

  function sourceFileFromSourceMap(
    source: unknown,
    mapUrl: string,
    sourceRoot: unknown,
  ): string | null {
    if (typeof source !== "string" || !source) return null;
    try {
      var base =
        typeof sourceRoot === "string" && sourceRoot
          ? new URL(sourceRoot, mapUrl)
          : new URL(".", mapUrl);
      var sourceUrl = new URL(source, base);
      return resolveProvenanceFrameUrl(sourceUrl.href)?.sourceFile || null;
    } catch (_error) {
      // coercion-ok: an invalid map source is an unavailable authored path.
      return unavailableProvenanceValue();
    }
  }

  function traceMappedProvenanceLocation(
    location: ReturnType<typeof fiberDebugLocation>,
    map: any,
    mapUrl: string,
  ): any {
    if (!location || !map || typeof map !== "object") return null;
    try {
      var original = originalPositionFor(new TraceMap(map), {
        line: location.line,
        column: Math.max(0, Number(location.column || 1) - 1),
      });
      if (
        !original ||
        typeof original.source !== "string" ||
        !Number.isFinite(original.line) ||
        !Number.isFinite(original.column)
      ) {
        return null;
      }
      var sourceFile = sourceFileFromSourceMap(
        original.source,
        mapUrl,
        map.sourceRoot,
      );
      if (!sourceFile) return null;
      return {
        sourceFile: sourceFile,
        line: original.line,
        column: original.column + 1,
        functionName: original.name || location.functionName,
        structured: false,
        servedUrl: undefined,
      };
    } catch (_error) {
      // coercion-ok: malformed source maps remain a transformed location.
      return unavailableProvenanceValue();
    }
  }

  function remapProvenanceLocation(
    location: ReturnType<typeof fiberDebugLocation>,
  ): Promise<any> {
    if (!location || location.structured || !location.servedUrl) {
      return Promise.resolve(null);
    }
    var mapUrl = sourceMapUrlForFrame(location.servedUrl);
    if (!mapUrl) return Promise.resolve(null);
    return loadProvenanceSourceMap(location.servedUrl).then(function (map) {
      return traceMappedProvenanceLocation(location, map, mapUrl);
    });
  }

  function remapReactElementProvenance(
    el: Element,
    provenance: FrameworkDebugProvenance,
  ): Promise<FrameworkDebugProvenance | null> {
    if (
      provenance.framework !== "react" ||
      (!provenance.sourceFile && !provenance.ownerSourceFile)
    ) {
      return Promise.resolve(null);
    }
    var leafFiber = reactFiberOf(el);
    if (!leafFiber) return Promise.resolve(null);
    var leafLocation = fiberDebugLocation(leafFiber);
    var componentFiber: any = null;
    var fiber = leafFiber.return || leafFiber.parent || leafFiber._debugOwner;
    for (var depth = 0; fiber && depth < 12; depth += 1) {
      if (typeof fiber.type === "function") {
        componentFiber = fiber;
        break;
      }
      fiber = fiber.return || fiber.parent || fiber._debugOwner;
    }
    var ownerLocation = componentFiber
      ? fiberDebugLocation(componentFiber)
      : null;
    return Promise.all([
      provenance.method === "debug-stack"
        ? remapProvenanceLocation(leafLocation)
        : Promise.resolve(null),
      provenance.ownerMethod === "debug-stack"
        ? remapProvenanceLocation(ownerLocation)
        : Promise.resolve(null),
    ]).then(function ([mappedLeaf, mappedOwner]) {
      if (!mappedLeaf && !mappedOwner) return null;
      var next = { ...provenance };
      if (mappedLeaf) {
        next.sourceFile = mappedLeaf.sourceFile;
        next.line = mappedLeaf.line;
        next.column = mappedLeaf.column;
        next.method = "debug-stack-remapped";
      }
      if (mappedOwner) {
        next.ownerSourceFile = mappedOwner.sourceFile;
        next.ownerLine = mappedOwner.line;
        next.ownerColumn = mappedOwner.column;
        next.ownerMethod = "debug-stack-remapped";
      }
      reactDebugProvenanceCache?.set(el, next);
      return next;
    });
  }

  function remapReactDocumentProvenance(): void {
    if (!runtimeLayerSnapshotEnabled || !document.body) return;
    var elements = Array.prototype.slice.call(
      document.body.querySelectorAll("*"),
    ) as Element[];
    var pending: Promise<FrameworkDebugProvenance | null>[] = [];
    elements.forEach(function (element) {
      var provenance = frameworkDebugProvenance(element);
      if (
        provenance.framework === "react" &&
        (provenance.method === "debug-stack" ||
          provenance.ownerMethod === "debug-stack")
      ) {
        pending.push(remapReactElementProvenance(element, provenance));
      }
    });
    if (pending.length === 0) return;
    void Promise.all(pending).then(function (results) {
      if (results.some(Boolean)) scheduleRuntimeLayerSnapshot();
    });
  }

  function parseFrameworkDataLoc(
    value: string,
  ): { sourceFile: string; line: number; column?: number } | null {
    var lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return null;
    var lastPart = value.slice(lastColon + 1);
    if (!/^\d+$/.test(lastPart)) return null;
    var beforeLast = value.slice(0, lastColon);
    var previousColon = beforeLast.lastIndexOf(":");
    var previousPart =
      previousColon >= 0 ? beforeLast.slice(previousColon + 1) : "";
    var hasColumn = /^\d+$/.test(previousPart);
    var sourceFile = (
      hasColumn ? beforeLast.slice(0, previousColon) : beforeLast
    ).trim();
    var line = parseInt(hasColumn ? previousPart : lastPart, 10);
    var column = hasColumn ? parseInt(lastPart, 10) : undefined;
    if (!sourceFile || !isFinite(line)) return null;
    if (column !== undefined && !isFinite(column)) return null;
    return { sourceFile: sourceFile, line: line, column: column };
  }

  function vueDebugProvenance(el: Element): FrameworkDebugProvenance | null {
    var node: any = el;
    var sawVue = false;
    for (var depth = 0; node && depth < 8; depth += 1) {
      var vnode = node.__vnode;
      var component = node.__vueParentComponent;
      if (vnode || component) sawVue = true;
      var inspector =
        vnode && vnode.props && typeof vnode.props.__v_inspector === "string"
          ? vnode.props.__v_inspector
          : null;
      if (inspector) {
        var parsed = parseFrameworkDataLoc(inspector);
        if (parsed) {
          var componentType =
            (component && component.type) || (vnode && vnode.type);
          return {
            framework: "vue",
            sourceFile: parsed.sourceFile,
            line: parsed.line,
            column: parsed.column,
            component:
              componentType &&
              (componentType.name ||
                componentType.__name ||
                componentType.displayName),
            method: "vue-inspector",
          };
        }
      }
      node = parentElementOrShadowHost(node);
    }
    return sawVue
      ? { framework: "vue", unavailableReason: "no-debug-info" }
      : null;
  }

  function svelteDebugProvenance(el: Element): FrameworkDebugProvenance | null {
    var node: any = el;
    var sawSvelte = false;
    for (var depth = 0; node && depth < 8; depth += 1) {
      var meta = node.__svelte_meta;
      if (meta) sawSvelte = true;
      var loc = meta && meta.loc;
      var sourceFile = loc && (loc.file || loc.filename);
      var line = loc && Number(loc.line);
      var column = loc && Number(loc.column);
      if (sourceFile && isFinite(line)) {
        return {
          framework: "svelte",
          sourceFile: String(sourceFile),
          line: line,
          column: isFinite(column) ? column : undefined,
          component:
            typeof meta.component === "string"
              ? meta.component
              : typeof meta.name === "string"
                ? meta.name
                : undefined,
          method: "svelte-meta",
        };
      }
      node = parentElementOrShadowHost(node);
    }
    return sawSvelte
      ? { framework: "svelte", unavailableReason: "no-debug-info" }
      : null;
  }

  function knownUnlocatedFramework(
    el: Element,
  ): FrameworkDebugProvenance | null {
    var node: any = el;
    for (var depth = 0; node && depth < 8; depth += 1) {
      if (node.getAttribute && node.attributes) {
        var tagName =
          typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
        if (
          node.hasAttribute("ng-version") ||
          Array.prototype.some.call(node.attributes, function (attribute) {
            return /^_ng(?:content|host)-/i.test(attribute.name);
          })
        ) {
          return { framework: "angular", unavailableReason: "no-debug-info" };
        }
        if (
          tagName.indexOf("lightning-") === 0 ||
          Array.prototype.some.call(node.attributes, function (attribute) {
            return /^lwc-[a-z0-9]+(?:-host)?$/i.test(attribute.name);
          })
        ) {
          return { framework: "lwc", unavailableReason: "no-debug-info" };
        }
      }
      node = parentElementOrShadowHost(node);
    }
    return null;
  }

  function frameworkDebugProvenance(el: Element): FrameworkDebugProvenance {
    var react = reactDebugProvenance(el);
    if (react.sourceFile || react.unavailableReason === "no-debug-info") {
      return react;
    }
    var vue = vueDebugProvenance(el);
    if (vue) return vue;
    var svelte = svelteDebugProvenance(el);
    if (svelte) return svelte;
    var knownUnlocated = knownUnlocatedFramework(el);
    if (knownUnlocated) return knownUnlocated;
    return { unavailableReason: "not-framework" };
  }

  function explicitDebugProvenance(
    el: Element,
  ): FrameworkDebugProvenance | null {
    var node: any = el;
    var sourceNode: any = null;
    for (var depth = 0; node && depth < 8; depth += 1) {
      if (
        node.getAttribute &&
        (node.getAttribute("data-source-file") || node.getAttribute("data-loc"))
      ) {
        sourceNode = node;
        break;
      }
      node = parentElementOrShadowHost(node);
    }
    if (!sourceNode) return null;

    var sourceFile = sourceNode.getAttribute("data-source-file");
    var lineText = sourceNode.getAttribute("data-source-line");
    var columnText = sourceNode.getAttribute("data-source-column");
    var dataLoc = sourceNode.getAttribute("data-loc");
    if (!sourceFile && dataLoc) {
      var parsed = parseFrameworkDataLoc(dataLoc);
      if (parsed) {
        sourceFile = parsed.sourceFile;
        lineText = String(parsed.line);
        columnText = parsed.column !== undefined ? String(parsed.column) : null;
      }
    }
    if (!sourceFile) return null;

    var line = lineText ? parseInt(lineText, 10) : undefined;
    var column = columnText ? parseInt(columnText, 10) : undefined;
    var declaredFramework = sourceNode.getAttribute("data-source-framework");
    var declaredMethod = sourceNode.getAttribute("data-source-method");
    return {
      framework:
        declaredFramework === "react" ||
        declaredFramework === "vue" ||
        declaredFramework === "svelte" ||
        declaredFramework === "angular" ||
        declaredFramework === "lwc" ||
        declaredFramework === "html"
          ? declaredFramework
          : "html",
      sourceFile: sourceFile,
      line: line !== undefined && isFinite(line) ? line : undefined,
      column: column !== undefined && isFinite(column) ? column : undefined,
      component: sourceNode.getAttribute("data-component-name") || undefined,
      method:
        declaredMethod === "debug-source" ||
        declaredMethod === "debug-stack" ||
        declaredMethod === "debug-stack-remapped" ||
        declaredMethod === "vue-inspector" ||
        declaredMethod === "svelte-meta"
          ? declaredMethod
          : "data-attribute",
    };
  }

  function elementDebugProvenance(el: Element): FrameworkDebugProvenance {
    var framework = frameworkDebugProvenance(el);
    var explicit = explicitDebugProvenance(el);
    if (!explicit) return framework;

    explicit.framework =
      explicit.framework === "html" && framework.framework
        ? framework.framework
        : explicit.framework;
    explicit.ownerSourceFile = framework.ownerSourceFile;
    explicit.ownerLine = framework.ownerLine;
    explicit.ownerColumn = framework.ownerColumn;
    explicit.ownerComponentName = framework.ownerComponentName;
    explicit.ownerMethod = framework.ownerMethod;
    explicit.ownerKey = framework.ownerKey;
    return explicit;
  }

  var runtimeLayerSnapshotTimer: number | null = null;
  var runtimeLayerSnapshotMaxTimer: number | null = null;
  var runtimeLayerSnapshotReservationRequestId = 0;
  var runtimeLayerSnapshotReservationInFlight = false;
  var runtimeLayerSnapshotReservationDirty = false;
  var lastRuntimeLayerSnapshotHtml = "";
  var lastRuntimeLayerSnapshotReservationToken = "";
  var runtimeDocumentId =
    "runtime-" + Date.now() + "-" + Math.random().toString(16).slice(2);

  function runtimeLayerHash(value: string): string {
    var hash = 0x811c9dc5;
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  function runtimeLayerStructuralPath(el: Element): string {
    var parts: string[] = [];
    var node: Element | null = el;
    while (node && node !== document.body) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var sameTag = Array.prototype.filter.call(
          parent.children,
          function (sibling) {
            return sibling.tagName === node!.tagName;
          },
        );
        tag += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
      }
      parts.unshift(tag);
      node = parent;
    }
    return parts.join(" > ") || "body";
  }

  function ensureRuntimeLayerNodeId(el: Element): string {
    var existing = el.getAttribute("data-agent-native-node-id")?.trim();
    if (existing) return existing;
    var provenance = frameworkDebugProvenance(el);
    var provenanceKey = provenance.sourceFile
      ? [
          provenance.sourceFile,
          provenance.line,
          provenance.column || 0,
          provenance.component || "",
        ].join(":")
      : "dom";
    var nodeId =
      "runtime-" +
      runtimeLayerHash(
        designCanvasScreenId +
          ":" +
          provenanceKey +
          ":" +
          runtimeLayerStructuralPath(el),
      );
    el.setAttribute("data-agent-native-node-id", nodeId);
    return nodeId;
  }

  function isRuntimeLayerVisualNode(el: Element): boolean {
    if (
      /^(script|style|template|noscript|link|meta|title)$/i.test(el.tagName)
    ) {
      return false;
    }
    if (
      el instanceof HTMLIFrameElement &&
      !isSourceOwned(el) &&
      el.getAttribute("aria-hidden") === "true" &&
      el.offsetWidth === 0 &&
      el.offsetHeight === 0
    ) {
      return false;
    }
    return !(
      isOverlayElement(el) || el.closest("[data-agent-native-edit-overlay]")
    );
  }

  function serializeRuntimeLayerSnapshot(
    excludedRoot?: Element,
  ):
    | { ok: true; html: string; nodeCount: number; documentId: string }
    | { ok: false; reason: "snapshot-unavailable" | "snapshot-too-large" } {
    if (!document.body) return { ok: false, reason: "snapshot-unavailable" };
    var snapshotComputedProperties = [
      "box-sizing",
      "display",
      "position",
      "inset",
      "top",
      "right",
      "bottom",
      "left",
      "width",
      "height",
      "min-width",
      "min-height",
      "max-width",
      "max-height",
      "margin",
      "padding",
      "flex",
      "flex-flow",
      "flex-grow",
      "flex-shrink",
      "flex-basis",
      "align-items",
      "align-self",
      "align-content",
      "justify-content",
      "justify-items",
      "justify-self",
      "gap",
      "grid-template-columns",
      "grid-template-rows",
      "grid-column",
      "grid-row",
      "order",
      "overflow",
      "overflow-x",
      "overflow-y",
      "background-color",
      "background-image",
      "background-position",
      "background-size",
      "background-repeat",
      "border",
      "border-top",
      "border-right",
      "border-bottom",
      "border-left",
      "border-radius",
      "box-shadow",
      "opacity",
      "transform",
      "transform-origin",
      "color",
      "font-family",
      "font-size",
      "font-style",
      "font-weight",
      "line-height",
      "letter-spacing",
      "text-align",
      "text-decoration",
      "text-transform",
      "white-space",
      "object-fit",
      "object-position",
      "clip-path",
      "visibility",
    ];
    function inlineSnapshotComputedStyle(
      sourceNode: Element,
      cloneNode: Element,
    ): void {
      var computed = getComputedStyle(sourceNode);
      var parts: string[] = [];
      for (
        var propertyIndex = 0;
        propertyIndex < snapshotComputedProperties.length;
        propertyIndex += 1
      ) {
        var property = snapshotComputedProperties[propertyIndex];
        var value = computed.getPropertyValue(property);
        if (value) parts.push(property + ":" + value);
      }
      cloneNode.setAttribute("style", parts.join(";"));
    }
    var sourceNodes = Array.prototype.slice.call(
      document.body.querySelectorAll("*"),
    ) as Element[];
    var cloneBody = document.body.cloneNode(true) as HTMLElement;
    var cloneNodes = Array.prototype.slice.call(
      cloneBody.querySelectorAll("*"),
    ) as Element[];
    var nodeCount = 0;
    for (
      var index = 0;
      index < sourceNodes.length && index < cloneNodes.length;
      index += 1
    ) {
      var sourceNode = sourceNodes[index];
      var cloneNode = cloneNodes[index];
      if (
        excludedRoot?.contains(sourceNode) ||
        !isRuntimeLayerVisualNode(sourceNode)
      ) {
        cloneNode.setAttribute("data-an-runtime-layer-remove", "true");
        continue;
      }
      var runtimeNodeId = ensureRuntimeLayerNodeId(sourceNode);
      cloneNode.setAttribute("data-agent-native-node-id", runtimeNodeId);
      inlineSnapshotComputedStyle(sourceNode, cloneNode);
      var provenance = elementDebugProvenance(sourceNode);
      if (provenance.sourceFile) {
        if (provenance.framework) {
          cloneNode.setAttribute("data-source-framework", provenance.framework);
        }
        cloneNode.setAttribute("data-source-file", provenance.sourceFile);
        cloneNode.setAttribute("data-source-line", String(provenance.line));
        if (provenance.method) {
          cloneNode.setAttribute("data-source-method", provenance.method);
        }
        if (provenance.column) {
          cloneNode.setAttribute(
            "data-source-column",
            String(provenance.column),
          );
        }
        if (provenance.component) {
          cloneNode.setAttribute("data-component-name", provenance.component);
        }
        var runtimeComponent = runtimeComponentIdentityForElement(
          sourceNode,
          provenance,
          runtimeNodeId,
        );
        if (runtimeComponent) {
          cloneNode.setAttribute(
            "data-agent-native-runtime-component-id",
            runtimeComponent.componentId,
          );
          cloneNode.setAttribute(
            "data-agent-native-runtime-instance-id",
            runtimeComponent.instanceId,
          );
          cloneNode.setAttribute(
            "data-agent-native-runtime-component-capability",
            runtimeComponent.writeCapability,
          );
        }
        if (provenance.ownerSourceFile) {
          cloneNode.setAttribute(
            "data-source-owner-file",
            provenance.ownerSourceFile,
          );
          cloneNode.setAttribute(
            "data-source-owner-line",
            String(provenance.ownerLine),
          );
          if (provenance.ownerColumn) {
            cloneNode.setAttribute(
              "data-source-owner-column",
              String(provenance.ownerColumn),
            );
          }
          if (provenance.ownerComponentName) {
            cloneNode.setAttribute(
              "data-source-owner-component",
              provenance.ownerComponentName,
            );
          }
          if (provenance.ownerMethod) {
            cloneNode.setAttribute(
              "data-source-owner-method",
              provenance.ownerMethod,
            );
          }
        }
        if (provenance.ownerKey) {
          cloneNode.setAttribute("data-source-owner-key", provenance.ownerKey);
        }
      } else if (provenance.unavailableReason) {
        cloneNode.setAttribute(
          "data-source-unavailable",
          provenance.unavailableReason,
        );
      }
      nodeCount += 1;
    }
    cloneBody
      .querySelectorAll("[data-an-runtime-layer-remove]")
      .forEach(function (node) {
        node.remove();
      });
    cloneBody
      .querySelectorAll(
        "script,style,template,noscript,link,meta,title,iframe,object,embed,base,foreignObject,video,audio,source,track,animate,set",
      )
      .forEach(function (node) {
        node.remove();
      });
    [cloneBody]
      .concat(
        Array.prototype.slice.call(
          cloneBody.querySelectorAll("*"),
        ) as Element[],
      )
      .forEach(function (node: Element) {
        Array.prototype.slice.call(node.attributes).forEach(function (
          attribute: Attr,
        ) {
          var name = String(attribute.name || "").toLowerCase();
          var value = String(attribute.value || "");
          if (
            name.indexOf("on") === 0 ||
            name === "srcdoc" ||
            name === "autofocus" ||
            name === "action" ||
            name === "formaction" ||
            /javascript\s*:/i.test(value)
          ) {
            node.removeAttribute(attribute.name);
          }
        });
      });
    cloneBody.setAttribute(
      "data-agent-native-node-id",
      ensureRuntimeLayerNodeId(document.body),
    );
    inlineSnapshotComputedStyle(document.body, cloneBody);
    cloneBody.setAttribute("data-an-runtime-layer-snapshot", "true");
    var html = "<!doctype html><html>" + cloneBody.outerHTML + "</html>"; // i18n-ignore serialized runtime-layer HTML payload, not visible UI copy
    if (html.length > 2_000_000)
      return { ok: false, reason: "snapshot-too-large" };
    return {
      ok: true,
      html: html,
      nodeCount: nodeCount,
      documentId: runtimeDocumentId,
    };
  }

  function postRuntimeLayerSnapshot(
    reservationToken?: string,
    requestId?: number,
  ): void {
    if (runtimeLayerSnapshotTimer !== null) {
      window.clearTimeout(runtimeLayerSnapshotTimer);
    }
    if (runtimeLayerSnapshotMaxTimer !== null) {
      window.clearTimeout(runtimeLayerSnapshotMaxTimer);
    }
    runtimeLayerSnapshotTimer = null;
    runtimeLayerSnapshotMaxTimer = null;
    var snapshot = serializeRuntimeLayerSnapshot();
    if (!snapshot.ok) {
      (window.parent as Window).postMessage(
        {
          type: "agent-native:runtime-layer-snapshot-error",
          payload: {
            ...snapshot,
            requestId,
            documentId: runtimeDocumentId,
            ...(reservationToken ? { reservationToken } : {}),
          },
        },
        "*",
      );
      return;
    }
    var snapshotReservationToken = reservationToken || "";
    if (
      snapshot.html === lastRuntimeLayerSnapshotHtml &&
      snapshotReservationToken === lastRuntimeLayerSnapshotReservationToken
    ) {
      (window.parent as Window).postMessage(
        {
          type: "agent-native:runtime-layer-snapshot-unchanged",
          payload: {
            requestId,
            documentId: snapshot.documentId,
            ...(reservationToken ? { reservationToken } : {}),
          },
        },
        "*",
      );
      return;
    }
    lastRuntimeLayerSnapshotHtml = snapshot.html;
    lastRuntimeLayerSnapshotReservationToken = snapshotReservationToken;
    if (requestId !== undefined) snapshot.requestId = requestId;
    if (reservationToken) snapshot.reservationToken = reservationToken;
    (window.parent as Window).postMessage(
      {
        type: "agent-native:runtime-layer-snapshot",
        payload: snapshot,
      },
      "*",
    );
  }

  function requestRuntimeLayerSnapshot(): void {
    if (runtimeLayerSnapshotTimer !== null) {
      window.clearTimeout(runtimeLayerSnapshotTimer);
      runtimeLayerSnapshotTimer = null;
    }
    if (runtimeLayerSnapshotMaxTimer !== null) {
      window.clearTimeout(runtimeLayerSnapshotMaxTimer);
      runtimeLayerSnapshotMaxTimer = null;
    }
    if (runtimeLayerSnapshotReservationInFlight) {
      runtimeLayerSnapshotReservationDirty = true;
      return;
    }
    runtimeLayerSnapshotReservationInFlight = true;
    runtimeLayerSnapshotReservationRequestId += 1;
    (window.parent as Window).postMessage(
      {
        type: "agent-native:runtime-layer-snapshot-reservation-request",
        requestId: runtimeLayerSnapshotReservationRequestId,
        documentId: runtimeDocumentId,
      },
      "*",
    );
  }

  function scheduleRuntimeLayerSnapshot(): void {
    if (runtimeLayerSnapshotTimer !== null) {
      window.clearTimeout(runtimeLayerSnapshotTimer);
    }
    runtimeLayerSnapshotTimer = window.setTimeout(
      requestRuntimeLayerSnapshot,
      300,
    );
    if (runtimeLayerSnapshotMaxTimer === null) {
      runtimeLayerSnapshotMaxTimer = window.setTimeout(
        requestRuntimeLayerSnapshot,
        1500,
      );
    }
  }

  function runtimeLayerClassSignature(value: string | null): string {
    return String(value || "")
      .split(/\s+/)
      .map(function (token) {
        var parts = token.split(":");
        var utility = String(parts[parts.length - 1] || "").replace(/^!/, "");
        if (
          /^(?:flex|inline-flex|grid|inline-grid|hidden|block|inline-block|flex-row|flex-col)$/.test(
            utility,
          ) ||
          /^(?:items|justify)-/.test(utility)
        ) {
          return utility;
        }
        return /(?:component|card|button|control)/.test(utility)
          ? "component-like"
          : "";
      })
      .filter(Boolean)
      .sort()
      .join(" ");
  }

  function runtimeLayerStyleSignature(value: string | null): string {
    var relevant: Record<string, string> = {};
    String(value || "")
      .split(";")
      .forEach(function (declaration) {
        var separator = declaration.indexOf(":");
        if (separator < 0) return;
        var property = declaration.slice(0, separator).trim().toLowerCase();
        if (
          !/^(?:display|flex-direction|align-items|justify-content)$/.test(
            property,
          )
        ) {
          return;
        }
        relevant[property] = declaration.slice(separator + 1).trim();
      });
    return Object.keys(relevant)
      .sort()
      .map(function (property) {
        return property + ":" + relevant[property];
      })
      .join(";");
  }

  function runtimeLayerMutationIsMeaningful(mutation: MutationRecord): boolean {
    var target = mutation.target as Element;
    if (
      target.nodeType === 1 &&
      (isOverlayElement(target) ||
        target.closest?.("[data-agent-native-edit-overlay]"))
    ) {
      return false;
    }
    if (mutation.type === "childList") {
      var changedNodes = Array.prototype.slice
        .call(mutation.addedNodes)
        .concat(Array.prototype.slice.call(mutation.removedNodes));
      return changedNodes.some(function (node: Node) {
        var element =
          node.nodeType === 1
            ? (node as Element)
            : node.parentElement || mutation.target;
        return !(
          element.nodeType === 1 &&
          (isOverlayElement(element as Element) ||
            (element as Element).closest?.("[data-agent-native-edit-overlay]"))
        );
      });
    }
    if (mutation.type === "characterData") {
      return true;
    }
    if (mutation.type !== "attributes") return false;
    var name = mutation.attributeName || "";
    if (name === "class") {
      return (
        runtimeLayerClassSignature(mutation.oldValue) !==
        runtimeLayerClassSignature(target.getAttribute("class"))
      );
    }
    if (name === "style") {
      return (
        runtimeLayerStyleSignature(mutation.oldValue) !==
        runtimeLayerStyleSignature(target.getAttribute("style"))
      );
    }
    return true;
  }

  function isDocumentRootElement(el: Element | null): boolean {
    return el === document.body || el === document.documentElement;
  }

  // selectable-rects only when this flag is absent, or two replies race and the
  (window as unknown as Record<string, boolean>).__agentNativeEditorChrome =
    true;

  var MIN_SELECTABLE_EXTENT_PX = 4;
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

  interface SelectableBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  }

  function selectableBounds(el: Element): SelectableBounds {
    var rect = el.getBoundingClientRect();
    var padX =
      rect.width < MIN_SELECTABLE_EXTENT_PX ? MIN_SELECTABLE_EXTENT_PX / 2 : 0;
    var padY =
      rect.height < MIN_SELECTABLE_EXTENT_PX ? MIN_SELECTABLE_EXTENT_PX / 2 : 0;
    return {
      left: rect.left - padX,
      top: rect.top - padY,
      right: rect.right + padX,
      bottom: rect.bottom + padY,
      width: rect.width + padX * 2,
      height: rect.height + padY * 2,
    };
  }

  function outermostSvgAncestor(el: Element | null): Element | null {
    var owner = el && (el as SVGElement).ownerSVGElement;
    if (!owner) return null;
    var root: Element = owner;
    while ((root as SVGElement).ownerSVGElement) {
      root = (root as SVGElement).ownerSVGElement as Element;
    }
    return root;
  }

  function pastedSvgShapeForHit(
    hit: Element,
    svgRoot: Element,
  ): Element | null {
    if (
      !svgRoot.getAttribute ||
      svgRoot.getAttribute("data-an-primitive") !== "pasted-svg"
    ) {
      return null;
    }
    var target: Element | null = hit;
    while (target && target !== svgRoot) {
      var tag = (target.tagName || "").toLowerCase();
      if (
        tag === "path" ||
        tag === "polygon" ||
        tag === "polyline" ||
        tag === "ellipse" ||
        tag === "circle" ||
        tag === "rect" ||
        tag === "line" ||
        tag === "use"
      ) {
        return target;
      }
      target = target.parentElement;
    }
    return null;
  }

  function isBoardRootMarqueeSurface(el: Element | null): boolean {
    if (!designCanvasBoardSurface || !el) return false;
    if (isDocumentRootElement(el)) return true;
    if (el.parentElement !== document.body) return false;
    var sourceId = (getSourceId(el) || "").toLowerCase();
    var layerName = layerNameForElement(el).toLowerCase();
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

  function isRuntimeOnlyClone(el: Element): boolean {
    var cloneRoot = el.closest('[data-agent-native-clone-root="true"]');
    return !!cloneRoot && !isSourceOwned(cloneRoot);
  }

  function repeatTemplateOwning(node: Element): Element | null {
    var parent = node.parentElement;
    if (!parent) return null;
    var siblings = parent.children;
    for (var i = 0; i < siblings.length; i += 1) {
      var sib = siblings[i];
      if (
        sib === node ||
        !sib.tagName ||
        sib.tagName.toLowerCase() !== "template"
      ) {
        continue;
      }
      var alpineTemplate = sib as Element & {
        _x_lookup?: Map<unknown, Element> | Record<string, Element>;
        _x_currentIfEl?: Element;
      };
      if (alpineTemplate._x_currentIfEl === node) return sib;
      var lookup = alpineTemplate._x_lookup;
      if (!lookup) continue;
      var map = lookup as Map<unknown, Element>;
      if (typeof map.forEach === "function" && typeof map.get === "function") {
        var foundInMap = false;
        map.forEach(function (instance) {
          if (instance === node) foundInMap = true;
        });
        if (foundInMap) return sib;
        continue;
      }
      var record = lookup as Record<string, Element>;
      for (var key in record) {
        if (
          Object.prototype.hasOwnProperty.call(record, key) &&
          record[key] === node
        ) {
          return sib;
        }
      }
    }
    return null;
  }

  function isTemplateCloneElement(el: Element | null): boolean {
    var node: Element | null = el;
    while (node && !isDocumentRootElement(node)) {
      if (repeatTemplateOwning(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function hasOwnTextContent(el: Element): boolean {
    var children = el.childNodes;
    for (var i = 0; i < children.length; i += 1) {
      var node = children[i]!;
      if (node.nodeType === 3 && (node.nodeValue || "").trim()) return true;
    }
    return false;
  }

  function isWholeTextStyleRoot(el: Element): boolean {
    if (
      el === document.body ||
      el === document.documentElement ||
      el.getAttribute("data-agent-native-group") === "true" ||
      el.getAttribute("data-an-primitive") === "frame"
    ) {
      return false;
    }
    if (el.getAttribute("data-an-primitive") === "text") {
      return Boolean((el.textContent || "").trim());
    }
    return (
      hasOnlyInlineEditableChildren(el) &&
      (hasOwnTextContent(el) || isInlineEditableDescendant(el))
    );
  }

  function repeatRowsOf(template: Element, row: Element): Element[] {
    var parent = row.parentElement;
    if (!parent) return [];
    var rows: Element[] = [];
    var siblings = parent.children;
    for (var i = 0; i < siblings.length; i += 1) {
      var sibling = siblings[i]!;
      if (isOverlayElement(sibling)) continue;
      if (repeatTemplateOwning(sibling) === template) rows.push(sibling);
    }
    return rows;
  }

  function rowKeyFor(template: Element | null, row: Element | null): string {
    if (!template || !row) return "";
    var lookup = (
      template as Element & {
        _x_lookup?: Map<unknown, Element> | Record<string, Element>;
      }
    )._x_lookup;
    if (!lookup) return "";
    var map = lookup as Map<unknown, Element>;
    if (typeof map.forEach === "function" && typeof map.get === "function") {
      var fromMap = "";
      map.forEach(function (value, key) {
        if (!fromMap && value === row) fromMap = String(key);
      });
      return fromMap;
    }
    var record = lookup as Record<string, Element>;
    for (var key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      if (record[key] === row) return key;
    }
    return "";
  }

  function repeatRowRootOf(el: Element): Element | null {
    var node: Element | null = el;
    while (node && !isDocumentRootElement(node)) {
      if (repeatTemplateOwning(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function repeatInstanceInfo(el: Element): {
    sourceSelector: string;
    instanceCount: number;
    instanceIndex: number;
    xFor: string;
    itemIndex: number;
    textBinding: string;
    keyExpression: string;
    itemKey: string;
  } | null {
    if (!isTemplateCloneElement(el) || !el.getAttribute) return null;
    var row = repeatRowRootOf(el);
    var template = row ? repeatTemplateOwning(row) : null;
    if (!row || !template) return null;
    var rows = repeatRowsOf(template, row);
    var rowIndex = rows.indexOf(row);
    if (rowIndex === -1) return null;
    var sourceNodeId = el.getAttribute("data-agent-native-node-id") || "";
    var sourceSelector = sourceNodeId
      ? '[data-agent-native-node-id="' + escapeAttribute(sourceNodeId) + '"]'
      : "";
    var instanceIndex = rowIndex + 1;
    if (sourceSelector) {
      var matches = document.querySelectorAll(sourceSelector);
      for (var i = 0; i < matches.length; i += 1) {
        if (matches[i] === el) {
          instanceIndex = i + 1;
          break;
        }
      }
    }
    return {
      sourceSelector: sourceSelector,
      instanceCount: rows.length,
      instanceIndex: instanceIndex,
      xFor: template.getAttribute("x-for") || "",
      itemIndex: rowIndex,
      textBinding: el.getAttribute("x-text") || "",
      keyExpression: template.getAttribute(":key") || "",
      itemKey: rowKeyFor(template, row),
    };
  }

  function repeatStyleTargets(el: Element): Element[] {
    var info = repeatInstanceInfo(el);
    if (!info || info.instanceCount < 2) return [el];
    if (info.sourceSelector) {
      var matches = document.querySelectorAll(info.sourceSelector);
      var targets: Element[] = [];
      for (var i = 0; i < matches.length; i += 1) targets.push(matches[i]!);
      if (targets.length > 0) return targets;
    }
    var row = repeatRowRootOf(el);
    var template = row ? repeatTemplateOwning(row) : null;
    if (!row || !template) return [el];
    var path: number[] = [];
    var walk: Element | null = el;
    while (walk && walk !== row && walk.parentElement) {
      path.unshift(
        Array.prototype.indexOf.call(walk.parentElement.children, walk),
      );
      walk = walk.parentElement;
    }
    if (walk !== row) return [el];
    var siblings: Element[] = [];
    repeatRowsOf(template, row).forEach(function (candidate) {
      var node: Element | null = candidate;
      for (var step = 0; step < path.length && node; step += 1) {
        node = node.children[path[step]!] ?? null;
      }
      if (node) siblings.push(node);
    });
    return siblings.length > 0 ? siblings : [el];
  }

  function unwrapTextOverlay(hit: Element): Element {
    if (hit.hasAttribute && hit.hasAttribute("data-an-text")) {
      var textOwner = hit.parentElement;
      if (textOwner && !isDocumentRootElement(textOwner)) return textOwner;
    }
    return hit;
  }

  function nativeTextPrimitiveForHit(hit: Element | null): Element | null {
    if (!hit || !hit.closest) return null;
    var root = hit.closest('[data-an-primitive="text"]');
    return root && !isDocumentRootElement(root) ? root : null;
  }

  function selectionTargetForHit(
    hit: Element | null,
    descendIntoGroup = false,
  ): Element | null {
    if (!hit || isDocumentRootElement(hit)) return hit;
    var svgRoot = outermostSvgAncestor(hit);
    if (svgRoot) return pastedSvgShapeForHit(hit, svgRoot) || svgRoot;
    var target = unwrapTextOverlay(hit);
    var textPrimitive = nativeTextPrimitiveForHit(target);
    if (textPrimitive) target = textPrimitive;
    if (!descendIntoGroup) {
      var group = target;
      while (group && !isDocumentRootElement(group)) {
        var groupName = layerNameForElement(group);
        var generatedGroupMarker =
          group.getAttribute &&
          group.getAttribute("data-agent-native-group-wrapper") === "true" &&
          group.getAttribute("data-agent-native-clone-root") !== "true";
        var legacyNodeId =
          group.getAttribute && group.getAttribute("data-agent-native-node-id");
        var legacyGeneratedGroup =
          /^an-[a-z0-9]+$/i.test(legacyNodeId || "") &&
          /^group(?: \d+)?$/i.test(groupName.trim()) &&
          group.getAttribute("data-agent-native-preserve-styles") === "true" &&
          group.getAttribute("data-agent-native-clone-root") !== "true";
        if (generatedGroupMarker || legacyGeneratedGroup) {
          return group;
        }
        group = group.parentElement;
      }
    }
    return target;
  }

  // document.body/documentElement even if `scope` is never reached, so a
  // stale or detached scope can never walk the climb past the top level.
  function containerScopeAncestor(el: Element, scope: Element): Element {
    var node = el;
    while (
      node !== scope &&
      node.parentElement &&
      node.parentElement !== scope &&
      node.parentElement !== document.body &&
      node.parentElement !== document.documentElement
    ) {
      node = node.parentElement;
    }
    return node;
  }

  function containerFirstSelectionTarget(
    hit: Element | null,
    descendIntoGroup?: boolean,
  ): Element | null {
    var resolved = selectionTargetForHit(hit, descendIntoGroup);
    if (!resolved || isDocumentRootElement(resolved)) return resolved;
    var scope = selectionContainerScope;
    if (
      !scope ||
      !document.documentElement.contains(scope) ||
      !scope.contains(resolved)
    ) {
      selectionContainerScope = null;
      scope = topLevelBoardFrameOwning(resolved) || document.body;
    }
    return containerScopeAncestor(resolved, scope);
  }

  function topLevelBoardFrameOwning(el: Element): Element | null {
    if (!designCanvasBoardSurface) return null;
    var node: Element | null = el;
    while (node && node.parentElement && node.parentElement !== document.body) {
      node = node.parentElement;
    }
    return node &&
      node !== el &&
      node.parentElement === document.body &&
      node.getAttribute("data-an-primitive") === "frame"
      ? node
      : null;
  }

  /*
   * HUMAN-DIRECTED UX EXCEPTION - DO NOT REVERT TO FIGMA:
   * Screen contents intentionally select the deepest block under a plain
   * single click. This is a rare, 100% intentional deviation from Figma UX,
   * requested by user feedback because people expect to click directly into
   * blocks while working inside a screen. The infinite-canvas board keeps the
   * Figma container-first behavior above. Do not remove or “fix” this branch
   * unless a human explicitly asks for this behavior to change.
   * Feedback: https://builder-internal.slack.com/archives/C0ATH3CCZT4/p1790099891790049?thread_ts=1790099192.113439&cid=C0ATH3CCZT4
   */
  function plainClickSelectionTarget(hit: Element | null): Element | null {
    if (!designCanvasBoardSurface) {
      selectionContainerScope = null;
      return selectionTargetForHit(hit);
    }
    return containerFirstSelectionTarget(hit);
  }

  function clickThroughSelectionTarget(
    hit: Element | null,
    ev: MouseEvent,
  ): Element | null {
    if (ev.detail > 1) return null;
    if (!selectedEl || !document.documentElement.contains(selectedEl)) {
      return null;
    }
    if (collectMoveGroupMembers(selectedEl).length > 1) return null;
    if (!hit || isDocumentRootElement(hit)) return null;
    var svgRoot = outermostSvgAncestor(hit);
    var raw =
      (svgRoot && pastedSvgShapeForHit(hit, svgRoot)) ||
      svgRoot ||
      unwrapTextOverlay(hit);
    raw = nativeTextPrimitiveForHit(raw) || raw;
    if (!raw || raw === selectedEl || !selectedEl.contains(raw)) {
      return null;
    }
    selectionContainerScope = selectedEl;
    return containerScopeAncestor(raw, selectedEl);
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

  var spaceSeparatedDomIdrefAttributes = [
    "aria-controls",
    "aria-describedby",
    "aria-details",
    "aria-errormessage",
    "aria-flowto",
    "aria-labelledby",
    "aria-owns",
    "headers",
  ];
  var singleDomIdrefAttributes = [
    "aria-activedescendant",
    "for",
    "form",
    "list",
  ];
  var fragmentDomReferenceAttributes = ["href", "xlink:href"];

  function rewriteDomUrlIdReferences(
    value: string,
    idMap: { [key: string]: string },
  ): string {
    return value.replace(
      /url\(\s*(["']?)#([^\s)'";]+)\1\s*\)/g,
      function (match, quote: string, id: string) {
        var replacement = idMap[id];
        return replacement
          ? "url(" + quote + "#" + replacement + quote + ")"
          : match;
      },
    );
  }

  function remintCollidingRuntimeNodeIds(root: Element): void {
    var seen = Object.create(null) as { [key: string]: boolean };
    var reminted = Object.create(null) as { [key: string]: string };
    var existing = Object.create(null) as { [key: string]: boolean };
    var existingDomIds = Object.create(null) as { [key: string]: boolean };
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-agent-native-node-id]"),
      function (node: Element) {
        var nodeId = node.getAttribute("data-agent-native-node-id") || "";
        if (nodeId) existing[nodeId] = true;
      },
    );
    Array.prototype.forEach.call(
      document.querySelectorAll("[id]"),
      function (node: Element) {
        var id = node.getAttribute("id") || "";
        if (id) existingDomIds[id] = true;
      },
    );
    var nodes = [root].concat(
      Array.prototype.slice.call(root.querySelectorAll("*")),
    ) as Element[];
    nodes.forEach(function (node, index) {
      var nodeId = node.getAttribute("data-agent-native-node-id") || "";
      if (!nodeId) return;
      var collision = Boolean(seen[nodeId] || existing[nodeId]);
      if (collision) {
        var nextNodeId = freshRuntimeNodeId(
          index === 0 ? "move" : "move-child",
        );
        reminted[nodeId] = nextNodeId;
        nodeId = nextNodeId;
        node.setAttribute("data-agent-native-node-id", nodeId);
      }
      seen[nodeId] = true;
    });
    var remintedDomIds = Object.create(null) as { [key: string]: string };
    var seenDomIds = Object.create(null) as { [key: string]: boolean };
    nodes.forEach(function (node, index) {
      var id = node.getAttribute("id") || "";
      if (!id) return;
      var collision = Boolean(existingDomIds[id] || seenDomIds[id]);
      if (!collision) {
        seenDomIds[id] = true;
        return;
      }
      var nextId = freshRuntimeNodeId(
        index === 0 ? "move-id" : "move-child-id",
      );
      if (existingDomIds[id] && !remintedDomIds[id]) {
        remintedDomIds[id] = nextId;
      }
      node.setAttribute("id", nextId);
      seenDomIds[nextId] = true;
    });
    nodes.forEach(function (node) {
      Array.prototype.forEach.call(node.attributes, function (attribute: Attr) {
        var value = attribute.value;
        if (spaceSeparatedDomIdrefAttributes.includes(attribute.name)) {
          value = value
            .split(/\s+/)
            .map(function (token) {
              return remintedDomIds[token] || token;
            })
            .join(" ");
        } else if (singleDomIdrefAttributes.includes(attribute.name)) {
          value = remintedDomIds[value] || value;
        } else if (fragmentDomReferenceAttributes.includes(attribute.name)) {
          if (value.charAt(0) === "#") {
            var fragmentId = value.slice(1);
            if (remintedDomIds[fragmentId]) {
              value = "#" + remintedDomIds[fragmentId];
            }
          }
        } else if (value.indexOf("url(") >= 0) {
          value = rewriteDomUrlIdReferences(value, remintedDomIds);
        }
        if (value !== attribute.value) node.setAttribute(attribute.name, value);
      });
      ["begin", "end"].forEach(function (attributeName) {
        var value = node.getAttribute(attributeName);
        if (!value) return;
        var rewritten = value
          .split(";")
          .map(function (part) {
            var trimmed = part.trim();
            var separator = trimmed.indexOf(".");
            if (separator <= 0) return trimmed;
            var replacement = remintedDomIds[trimmed.slice(0, separator)];
            return replacement
              ? replacement + trimmed.slice(separator)
              : trimmed;
          })
          .join("; ");
        if (rewritten !== value) node.setAttribute(attributeName, rewritten);
      });
    });
    nodes.forEach(function (node) {
      var runtimeInstanceId = node.getAttribute(
        "data-agent-native-runtime-instance-id",
      );
      var nextInstanceId = runtimeInstanceId && reminted[runtimeInstanceId];
      if (nextInstanceId) {
        node.setAttribute(
          "data-agent-native-runtime-instance-id",
          nextInstanceId,
        );
      }
    });
  }

  function resetRuntimeStableIds(
    root: Element | null,
  ): Array<[string, string]> {
    if (!root || !root.querySelectorAll) return [];
    var sourceNodeIdMap: Array<[string, string]> = [];
    var nodes = [root].concat(
      Array.prototype.slice.call(
        root.querySelectorAll("[data-agent-native-node-id]"),
      ),
    );
    nodes.forEach(function (node, index) {
      if (node && node.setAttribute) {
        var sourceNodeId = node.getAttribute("data-agent-native-node-id");
        var cloneNodeId = freshRuntimeNodeId(
          index === 0 ? "copy" : "copy-child",
        );
        node.setAttribute("data-agent-native-node-id", cloneNodeId);
        if (sourceNodeId) sourceNodeIdMap.push([sourceNodeId, cloneNodeId]);
      }
    });
    return sourceNodeIdMap;
  }

  function getSelector(el: Element | null): string {
    if (!el) return "";
    if (isTemplateCloneElement(el)) return selectorPath(el);
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

  function elementLooksLikeComponent(el: Element | null): boolean {
    if (!el || !el.getAttribute || !el.tagName) return false;
    if (explicitComponentNameForElement(el)) return true;
    var tag = el.tagName.toLowerCase();
    return (
      tag === "button" ||
      tag === "input" ||
      tag === "select" ||
      tag === "textarea"
    );
  }

  function componentNameForElement(el: Element | null): string {
    var explicit = explicitComponentNameForElement(el);
    if (explicit) return explicit;
    if (!elementLooksLikeComponent(el) || !el || !el.getAttribute) return "";
    return layerNameForElement(el);
  }

  function runtimeComponentPropsForElement(
    el: Element,
  ): Array<{ name: string; value: string }> {
    var props: Array<{ name: string; value: string }> = [];
    if (!el.attributes) return props;
    for (var index = 0; index < el.attributes.length; index += 1) {
      var attribute = el.attributes[index];
      if (!attribute || attribute.name.indexOf("data-agent-native-prop-") !== 0)
        continue;
      var rawName = attribute.name.slice("data-agent-native-prop-".length);
      if (!rawName) continue;
      props.push({
        name: rawName.replace(/-([a-z])/g, function (_match, letter) {
          return String(letter).toUpperCase();
        }),
        value: attribute.value,
      });
    }
    return props;
  }

  function runtimeComponentIdentityForElement(
    el: Element,
    provenance: FrameworkDebugProvenance,
    instanceId: string,
  ): any {
    var name = provenance.component && provenance.component.trim();
    var definitionSourceFile =
      provenance.sourceFile && provenance.sourceFile.trim();
    var invocationSourceFile =
      provenance.ownerSourceFile && provenance.ownerSourceFile.trim();
    var invocationLine = provenance.ownerLine;
    var invocationColumn = provenance.ownerColumn;
    var invocationMethod = provenance.ownerMethod;
    if (
      !name ||
      !definitionSourceFile ||
      !provenance.framework ||
      provenance.framework === "html" ||
      !instanceId
    ) {
      return undefined;
    }
    var boundary = [
      provenance.framework,
      definitionSourceFile,
      provenance.line || "",
      provenance.column || "",
      name,
    ].join("|");
    var writable =
      provenance.framework === "react" &&
      invocationSourceFile !== undefined &&
      invocationMethod !== undefined &&
      invocationMethod !== "debug-stack" &&
      Number.isFinite(invocationLine) &&
      Number.isFinite(invocationColumn);
    return {
      componentId: "runtime-component-" + runtimeLayerHash(boundary),
      instanceId: instanceId,
      name: name,
      framework: provenance.framework,
      sourceFile: invocationSourceFile,
      line: invocationLine,
      column: invocationColumn,
      method: invocationMethod,
      ownerKey: provenance.ownerKey,
      props: runtimeComponentPropsForElement(el),
      writeCapability: writable ? "authored-jsx-literal" : "unsupported",
      reason: writable
        ? undefined
        : "The runtime did not expose a verified authored component invocation location.",
    };
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
    if (el.getAttribute("data-an-primitive") === "boolean-operand") {
      var geometry = el as SVGGraphicsElement;
      var box = geometry.getBBox();
      var matrix = geometry.getScreenCTM();
      if (box && matrix) {
        var points = [
          [box.x, box.y],
          [box.x + box.width, box.y],
          [box.x, box.y + box.height],
          [box.x + box.width, box.y + box.height],
        ];
        var xs = points.map(function (point) {
          return matrix.a * point[0]! + matrix.c * point[1]! + matrix.e;
        });
        var ys = points.map(function (point) {
          return matrix.b * point[0]! + matrix.d * point[1]! + matrix.f;
        });
        var scrollX = window.scrollX || window.pageXOffset || 0;
        var scrollY = window.scrollY || window.pageYOffset || 0;
        var left = Math.min.apply(null, xs);
        var top = Math.min.apply(null, ys);
        return {
          x: left + scrollX,
          y: top + scrollY,
          width: Math.max.apply(null, xs) - left,
          height: Math.max.apply(null, ys) - top,
        };
      }
    }
    var rect = el.getBoundingClientRect();
    return {
      x: rect.x + (window.scrollX || window.pageXOffset || 0),
      y: rect.y + (window.scrollY || window.pageYOffset || 0),
      width: rect.width,
      height: rect.height,
    };
  }

  function designParentForElement(el: Element): Element | null {
    if (el.getAttribute("data-an-primitive") === "boolean-operand") {
      return el.closest('svg[data-an-primitive="boolean"]') || el.parentElement;
    }
    return el.parentElement;
  }

  function autoLayoutParentInfo(el: Element) {
    var parent = designParentForElement(el);
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
    "webkitBoxOrient",
    "webkitLineClamp",
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

  function elementPathsFromRoot(
    root: Element,
    descendants: Element[],
  ): Map<Element, number[]> {
    var paths = new Map<Element, number[]>();
    var nextChildIndexes = new Map<Element, number>();
    paths.set(root, []);
    for (var index = 0; index < descendants.length; index += 1) {
      var node = descendants[index];
      var parent = node.parentElement;
      if (!parent) continue;
      var parentPath = paths.get(parent);
      if (!parentPath) continue;
      var childIndex = nextChildIndexes.get(parent) || 0;
      nextChildIndexes.set(parent, childIndex + 1);
      paths.set(node, parentPath.concat(childIndex));
    }
    return paths;
  }

  var EDITOR_INTERNAL_CSS_VAR_PREFIXES = [
    "--design-editor-",
    "--agent-native-editor-chrome-",
    "--agent-native-",
  ];

  function isEditorInternalCssVarName(name: string): boolean {
    for (var i = 0; i < EDITOR_INTERNAL_CSS_VAR_PREFIXES.length; i += 1) {
      if (name.indexOf(EDITOR_INTERNAL_CSS_VAR_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  var portableStyleProbeDoc: Document | null | undefined;
  var portableStyleProbeContainer: HTMLElement | ShadowRoot | null | undefined;

  function portableStyleProbeDocument(): Document | null {
    if (portableStyleProbeDoc !== undefined) return portableStyleProbeDoc;
    if (!document.body) return null;
    var frame: HTMLIFrameElement | undefined;
    try {
      frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText =
        "position:fixed!important;width:0!important;height:0!important;" +
        "border:0!important;visibility:hidden!important;pointer-events:none!important;";
      document.body.appendChild(frame);
      var probeDoc = frame.contentDocument;
      if (probeDoc) {
        portableStyleProbeDoc = probeDoc;
        portableStyleProbeContainer = probeDoc.body;
      } else {
        frame.remove();
        var fallbackHost = document.createElement("div");
        fallbackHost.setAttribute(
          "style",
          "all: initial !important;position: fixed !important;left: 0 !important;top: 0 !important;width: 0 !important;height: 0 !important;overflow: hidden !important;contain: strict !important;",
        );
        document.body.appendChild(fallbackHost);
        portableStyleProbeDoc = document;
        portableStyleProbeContainer = fallbackHost.attachShadow({
          mode: "open",
        });
      }
    } catch (err) {
      frame?.remove();
      console.warn("Portable style probe unavailable", err);
      return null;
    }
    return portableStyleProbeDoc ?? null;
  }

  var portableStyleTagDefaultsCache: Record<
    string,
    Record<string, string>
  > = {};

  function portableStyleTagDefaults(
    el: Element,
  ): Record<string, string> | null {
    var cacheKey = (el.namespaceURI || "") + ":" + el.tagName;
    var cached = portableStyleTagDefaultsCache[cacheKey];
    if (cached) return cached;
    var probeDoc = portableStyleProbeDocument();
    var probeContainer = portableStyleProbeContainer;
    if (!probeDoc || !probeContainer) {
      dndLog("style:probe-unavailable", { tag: el.tagName });
      return null;
    }
    var probe =
      el.namespaceURI && el.namespaceURI !== "http://www.w3.org/1999/xhtml"
        ? probeDoc.createElementNS(el.namespaceURI, el.tagName)
        : probeDoc.createElement(el.tagName);
    probeContainer.appendChild(probe);
    var probeWindow = probeDoc.defaultView || window;
    var probeCs = probeWindow.getComputedStyle(probe);
    var defaults: Record<string, string> = {};
    PORTABLE_STYLE_PROPERTIES.forEach(function (property) {
      defaults[property] =
        probeCs[property] || probeCs.getPropertyValue(property);
    });
    probeContainer.removeChild(probe);
    portableStyleTagDefaultsCache[cacheKey] = defaults;
    return defaults;
  }

  // ponytail: font-relative sizes may canonicalize to pixels; preserving authored
  var PORTABLE_STYLE_BOX_SIZE_PROPERTIES: Record<string, boolean> = {
    width: true,
    height: true,
  };

  type PortableStyleCacheEntry = {
    generation: number;
    styles: Record<string, string> | null;
  };

  type PortableStyleAnimationState = {
    fingerprint: string;
    cacheable: boolean;
  };

  type PortableStyleComputedStylesCache = {
    entries: Map<Element, PortableStyleCacheEntry>;
    animationFingerprints: Map<Element, string>;
    mutationObserver: MutationObserver;
    mutationGeneration: number;
    observedMutationRoots: Node[];
    restoreCssomHooks: () => void;
  };

  type PortableStyleCssomHookSubscriber = {
    cache: PortableStyleComputedStylesCache;
    shouldInvalidate?: (receiver: unknown) => boolean;
  };

  type PortableStyleCssomHook = {
    owner: object;
    property: string;
    kind: "method" | "setter";
    descriptor: PropertyDescriptor;
    wrappedValue?: Function;
    wrappedSetter?: Function;
    subscribers: PortableStyleCssomHookSubscriber[];
  };

  var portableStyleCssomHooks = new WeakMap<
    object,
    Map<string, PortableStyleCssomHook>
  >();

  var portableStyleMutationObserverOptions = {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  };

  function portableStyleMutationAffectsCache(record: MutationRecord): boolean {
    if (record.type === "attributes") {
      return !(
        record.target instanceof Element &&
        (record.attributeName === "data-an-pending-node-id" ||
          isOverlayElement(record.target))
      );
    }
    if (record.type !== "childList") {
      return !(
        record.target instanceof Node &&
        record.target.parentElement &&
        isOverlayElement(record.target.parentElement)
      );
    }
    if (record.target instanceof Element && isOverlayElement(record.target)) {
      return false;
    }
    var nodes = Array.prototype.slice
      .call(record.addedNodes)
      .concat(Array.prototype.slice.call(record.removedNodes));
    return (
      nodes.length === 0 ||
      nodes.some(function (node: Node) {
        return !(
          (node instanceof Element && isOverlayElement(node)) ||
          (node.parentElement && isOverlayElement(node.parentElement))
        );
      })
    );
  }

  function portableStyleMutationGeneration(
    cache: PortableStyleComputedStylesCache,
  ): number {
    try {
      var records = cache.mutationObserver.takeRecords();
      if (records.some(portableStyleMutationAffectsCache)) {
        cache.mutationGeneration += 1;
      }
    } catch (_error) {
      cache.mutationGeneration += 1;
      dndLog("style:mutation-state-unreadable");
    }
    return cache.mutationGeneration;
  }

  function portableStyleObserveMutationRoot(
    cache: PortableStyleComputedStylesCache,
    root: Node,
  ): boolean {
    if (cache.observedMutationRoots.indexOf(root) !== -1) return true;
    try {
      cache.mutationObserver.observe(
        root,
        portableStyleMutationObserverOptions,
      );
      cache.observedMutationRoots.push(root);
      if (cache.observedMutationRoots.length > 1) {
        cache.mutationGeneration += 1;
      }
      return true;
    } catch (_error) {
      cache.mutationGeneration += 1;
      dndLog("style:mutation-root-unavailable");
      return false;
    }
  }

  function portableStyleObserveElementRoot(
    cache: PortableStyleComputedStylesCache,
    el: Element,
  ): boolean {
    try {
      var shadowRoot = (el as Element & { shadowRoot?: ShadowRoot | null })
        .shadowRoot;
      if (shadowRoot && !portableStyleObserveMutationRoot(cache, shadowRoot)) {
        return false;
      }
      var getRootNode = (el as Element & { getRootNode?: () => Node })
        .getRootNode;
      if (typeof getRootNode !== "function") return true;
      var root = getRootNode.call(el);
      if (!(root instanceof Node)) return false;
      return portableStyleObserveMutationRoot(cache, root);
    } catch (_error) {
      cache.mutationGeneration += 1;
      dndLog("style:mutation-root-read-failed", { tag: el.tagName });
      return false;
    }
  }

  function portableStylePropertyDescriptor(
    target: object,
    property: string,
  ): { owner: object; descriptor: PropertyDescriptor } | undefined {
    var current: object | null = target;
    while (current) {
      var descriptor = Object.getOwnPropertyDescriptor(current, property);
      if (descriptor) return { owner: current, descriptor: descriptor };
      var prototype = Object.getPrototypeOf(current);
      current =
        prototype && prototype !== Object.prototype
          ? (prototype as object)
          : null;
    }
    return undefined;
  }

  function portableStyleCssomDeclarationChanged(receiver: unknown): boolean {
    try {
      return (receiver as { parentRule?: unknown }).parentRule !== null;
    } catch (_error) {
      return true;
    }
  }

  function portableStyleCssomHookKey(
    property: string,
    kind: "method" | "setter",
  ): string {
    return kind + ":" + property;
  }

  function portableStyleCssomHookMap(
    owner: object,
    create: boolean,
  ): Map<string, PortableStyleCssomHook> | undefined {
    var hooks = portableStyleCssomHooks.get(owner);
    if (!hooks && create) {
      hooks = new Map<string, PortableStyleCssomHook>();
      portableStyleCssomHooks.set(owner, hooks);
    }
    return hooks;
  }

  function portableStyleCssomHookInstalled(
    found: { owner: object; descriptor: PropertyDescriptor },
    hook: PortableStyleCssomHook,
  ): boolean {
    return hook.kind === "method"
      ? found.descriptor.value === hook.wrappedValue
      : found.descriptor.set === hook.wrappedSetter;
  }

  function portableStyleCssomExistingHook(
    found: { owner: object; descriptor: PropertyDescriptor },
    property: string,
    kind: "method" | "setter",
  ): PortableStyleCssomHook | undefined {
    var hooks = portableStyleCssomHookMap(found.owner, false);
    var key = portableStyleCssomHookKey(property, kind);
    var hook = hooks?.get(key);
    if (!hook) return undefined;
    if (portableStyleCssomHookInstalled(found, hook)) return hook;
    hooks?.delete(key);
    return undefined;
  }

  function portableStyleCssomInvalidateHook(
    hook: PortableStyleCssomHook,
    receiver?: unknown,
  ): void {
    hook.subscribers.slice().forEach(function (subscriber) {
      try {
        if (
          !subscriber.shouldInvalidate ||
          subscriber.shouldInvalidate(receiver)
        ) {
          subscriber.cache.mutationGeneration += 1;
        }
      } catch (_error) {
        subscriber.cache.mutationGeneration += 1;
      }
    });
  }

  function portableStyleCssomSubscribe(
    hook: PortableStyleCssomHook,
    cache: PortableStyleComputedStylesCache,
    shouldInvalidate?: (receiver: unknown) => boolean,
  ): () => void {
    var subscriber = { cache: cache, shouldInvalidate: shouldInvalidate };
    hook.subscribers.push(subscriber);
    var released = false;
    return function () {
      if (released) return;
      released = true;
      var subscriberIndex = hook.subscribers.indexOf(subscriber);
      if (subscriberIndex !== -1) hook.subscribers.splice(subscriberIndex, 1);
      if (hook.subscribers.length > 0) return;
      var hooks = portableStyleCssomHookMap(hook.owner, false);
      var current = Object.getOwnPropertyDescriptor(hook.owner, hook.property);
      if (
        current &&
        portableStyleCssomHookInstalled(
          { owner: hook.owner, descriptor: current },
          hook,
        )
      ) {
        try {
          Object.defineProperty(hook.owner, hook.property, hook.descriptor);
        } catch (_error) {
          dndLog("style:cssom-hook-restore-failed", {
            property: hook.property,
          });
        }
      }
      var key = portableStyleCssomHookKey(hook.property, hook.kind);
      if (hooks?.get(key) === hook) hooks.delete(key);
      if (hooks?.size === 0) portableStyleCssomHooks.delete(hook.owner);
    };
  }

  function portableStyleWrapCssomMethod(
    cache: PortableStyleComputedStylesCache,
    target: object,
    property: string,
    shouldInvalidate?: (receiver: unknown) => boolean,
  ): true | false | (() => void) {
    var found = portableStylePropertyDescriptor(target, property);
    if (!found || typeof found.descriptor.value !== "function") return true;
    var existingHook = portableStyleCssomExistingHook(
      found,
      property,
      "method",
    );
    if (existingHook) {
      return portableStyleCssomSubscribe(existingHook, cache, shouldInvalidate);
    }
    var original = found.descriptor.value as (
      this: unknown,
      ...args: unknown[]
    ) => unknown;
    var hook: PortableStyleCssomHook = {
      owner: found.owner,
      property: property,
      kind: "method",
      descriptor: found.descriptor,
      subscribers: [],
    };
    var wrapped = function (this: unknown, ...args: unknown[]) {
      portableStyleCssomInvalidateHook(hook, this);
      var result = original.apply(this, args);
      if (property === "replace" && result) {
        try {
          var then = (result as { then?: unknown }).then;
          if (typeof then === "function") {
            then.call(
              result,
              function () {
                portableStyleCssomInvalidateHook(hook);
              },
              function () {
                portableStyleCssomInvalidateHook(hook);
              },
            );
          }
        } catch (_error) {
          portableStyleCssomInvalidateHook(hook);
        }
      }
      return result;
    };
    hook.wrappedValue = wrapped;
    try {
      Object.defineProperty(found.owner, property, {
        ...found.descriptor,
        value: wrapped,
      });
    } catch (_error) {
      dndLog("style:cssom-hook-install-failed", { property: property });
      return false;
    }
    portableStyleCssomHookMap(found.owner, true)!.set(
      portableStyleCssomHookKey(property, "method"),
      hook,
    );
    return portableStyleCssomSubscribe(hook, cache, shouldInvalidate);
  }

  function portableStyleWrapCssomSetter(
    cache: PortableStyleComputedStylesCache,
    target: object,
    property: string,
    shouldInvalidate?: (receiver: unknown) => boolean,
  ): true | false | (() => void) {
    var found = portableStylePropertyDescriptor(target, property);
    if (!found || typeof found.descriptor.set !== "function") return true;
    var existingHook = portableStyleCssomExistingHook(
      found,
      property,
      "setter",
    );
    if (existingHook) {
      return portableStyleCssomSubscribe(existingHook, cache, shouldInvalidate);
    }
    var original = found.descriptor.set as (
      this: unknown,
      value: unknown,
    ) => void;
    var hook: PortableStyleCssomHook = {
      owner: found.owner,
      property: property,
      kind: "setter",
      descriptor: found.descriptor,
      subscribers: [],
    };
    var wrapped = function (this: unknown, value: unknown) {
      portableStyleCssomInvalidateHook(hook, this);
      original.call(this, value);
    };
    hook.wrappedSetter = wrapped;
    try {
      Object.defineProperty(found.owner, property, {
        ...found.descriptor,
        set: wrapped,
      });
    } catch (_error) {
      dndLog("style:cssom-hook-install-failed", { property: property });
      return false;
    }
    portableStyleCssomHookMap(found.owner, true)!.set(
      portableStyleCssomHookKey(property, "setter"),
      hook,
    );
    return portableStyleCssomSubscribe(hook, cache, shouldInvalidate);
  }

  function portableStyleWrapCssomSetters(
    cache: PortableStyleComputedStylesCache,
    target: object | undefined,
    shouldInvalidate: ((receiver: unknown) => boolean) | undefined,
    restorers: Array<() => void>,
  ): boolean {
    if (!target) return true;
    var current: object | null = target;
    while (current && current !== Object.prototype) {
      var properties = Object.getOwnPropertyNames(current);
      for (var index = 0; index < properties.length; index += 1) {
        var property = properties[index];
        if (property === "constructor") continue;
        var result = portableStyleWrapCssomSetter(
          cache,
          current,
          property,
          shouldInvalidate,
        );
        if (result === false) return false;
        if (result !== true) restorers.push(result);
      }
      var prototype = Object.getPrototypeOf(current);
      current =
        prototype && prototype !== Object.prototype
          ? (prototype as object)
          : null;
    }
    return true;
  }

  function portableStyleInstallCssomHooks(
    cache: PortableStyleComputedStylesCache,
  ): boolean {
    var restorers: Array<() => void> = [];
    var portableWindow = window as typeof window & {
      CSSStyleDeclaration?: { prototype: object };
      CSSStyleSheet?: { prototype: object };
      Document?: { prototype: object };
      Element?: { prototype: object };
      KeyframeEffect?: { prototype: object };
      ShadowRoot?: { prototype: object };
    };
    var success = true;
    var addMethod = function (target: object | undefined, property: string) {
      if (!success || !target) return;
      var result = portableStyleWrapCssomMethod(cache, target, property);
      if (result === false) success = false;
      else if (result !== true) restorers.push(result);
    };
    var addSetter = function (target: object | undefined, property: string) {
      if (!success || !target) return;
      var result = portableStyleWrapCssomSetter(cache, target, property);
      if (result === false) success = false;
      else if (result !== true) restorers.push(result);
    };
    var styleSheetPrototype = portableWindow.CSSStyleSheet?.prototype;
    addMethod(portableWindow.Element?.prototype, "animate");
    var keyframeEffectPrototype = portableWindow.KeyframeEffect?.prototype;
    addMethod(keyframeEffectPrototype, "setKeyframes");
    addMethod(keyframeEffectPrototype, "updateTiming");
    [
      "insertRule",
      "deleteRule",
      "replace",
      "replaceSync",
      "addRule",
      "removeRule",
    ].forEach(function (property) {
      addMethod(styleSheetPrototype, property);
    });
    addSetter(portableWindow.Document?.prototype, "adoptedStyleSheets");
    addSetter(portableWindow.ShadowRoot?.prototype, "adoptedStyleSheets");
    var styleDeclarationPrototype =
      portableWindow.CSSStyleDeclaration?.prototype;
    if (success && styleDeclarationPrototype) {
      var setPropertyResult = portableStyleWrapCssomMethod(
        cache,
        styleDeclarationPrototype,
        "setProperty",
        portableStyleCssomDeclarationChanged,
      );
      if (setPropertyResult === false) success = false;
      else if (setPropertyResult !== true) restorers.push(setPropertyResult);
      var removePropertyResult = portableStyleWrapCssomMethod(
        cache,
        styleDeclarationPrototype,
        "removeProperty",
        portableStyleCssomDeclarationChanged,
      );
      if (removePropertyResult === false) success = false;
      else if (removePropertyResult !== true)
        restorers.push(removePropertyResult);
    }
    if (
      success &&
      !portableStyleWrapCssomSetters(
        cache,
        styleDeclarationPrototype,
        portableStyleCssomDeclarationChanged,
        restorers,
      )
    ) {
      success = false;
    }
    if (
      success &&
      !portableStyleWrapCssomSetters(
        cache,
        styleSheetPrototype,
        undefined,
        restorers,
      )
    ) {
      success = false;
    }
    if (!success) {
      for (
        var restoreIndex = restorers.length - 1;
        restoreIndex >= 0;
        restoreIndex -= 1
      ) {
        restorers[restoreIndex]();
      }
      return false;
    }
    cache.restoreCssomHooks = function () {
      for (
        var restoreIndex = restorers.length - 1;
        restoreIndex >= 0;
        restoreIndex -= 1
      ) {
        restorers[restoreIndex]();
      }
      restorers = [];
    };
    return true;
  }

  function createPortableStyleComputedStylesCache():
    | PortableStyleComputedStylesCache
    | undefined {
    if (typeof MutationObserver === "undefined") return undefined;
    var cache = {
      entries: new Map<Element, PortableStyleCacheEntry>(),
      animationFingerprints: new Map<Element, string>(),
      mutationObserver: null as unknown as MutationObserver,
      mutationGeneration: 0,
      observedMutationRoots: [],
      restoreCssomHooks: function () {},
    };
    try {
      var observer = new MutationObserver(function (records) {
        if (records.some(portableStyleMutationAffectsCache)) {
          cache.mutationGeneration += 1;
        }
      });
      cache.mutationObserver = observer;
      if (!portableStyleObserveMutationRoot(cache, document)) {
        observer.disconnect();
        return undefined;
      }
      if (!portableStyleInstallCssomHooks(cache)) {
        observer.disconnect();
        return undefined;
      }
      return cache;
    } catch (_error) {
      cache.mutationObserver.disconnect();
      cache.restoreCssomHooks();
      dndLog("style:mutation-observer-unavailable");
      return undefined;
    }
  }

  function portableStyleAnimationParent(
    el: Element,
  ): Element | null | undefined {
    try {
      var assignedSlot = (el as Element & { assignedSlot?: Element | null })
        .assignedSlot;
      if (assignedSlot instanceof Element) return assignedSlot;
      if (el.parentElement) return el.parentElement;
      var getRootNode = (el as Element & { getRootNode?: () => Node })
        .getRootNode;
      if (typeof getRootNode !== "function") return null;
      var root = getRootNode.call(el) as Document | ShadowRoot;
      var host = (root as ShadowRoot).host;
      return host instanceof Element ? host : null;
    } catch (_error) {
      dndLog("style:animation-parent-read-failed", { tag: el.tagName });
      return undefined;
    }
  }

  var portableStyleAnimationEffectIds = new WeakMap<object, number>();
  var nextPortableStyleAnimationEffectId = 1;

  function portableStyleAnimationEffectId(
    effect: object | null,
  ): number | null {
    if (!effect) return null;
    var id = portableStyleAnimationEffectIds.get(effect);
    if (id !== undefined) return id;
    id = nextPortableStyleAnimationEffectId++;
    portableStyleAnimationEffectIds.set(effect, id);
    return id;
  }

  function readPortableAnimationState(
    el: Element,
  ): PortableStyleAnimationState | undefined {
    var animatedElement = el as Element & {
      getAnimations?: () => Array<{
        playState?: string;
        currentTime?: unknown;
        startTime?: unknown;
        playbackRate?: unknown;
        effect?: {
          getKeyframes?: () => unknown;
          getTiming?: () => unknown;
          composite?: unknown;
          iterationComposite?: unknown;
          target?: unknown;
        } | null;
      }>;
    };
    try {
      var getAnimations = animatedElement.getAnimations;
      if (typeof getAnimations !== "function") {
        dndLog("style:animation-state-unreadable", { tag: el.tagName });
        return undefined;
      }
      var animations = getAnimations.call(animatedElement);
      if (!Array.isArray(animations)) {
        dndLog("style:animation-state-unreadable", { tag: el.tagName });
        return undefined;
      }
      var cacheable = true;
      var fingerprintParts: string[] = [];
      for (var index = 0; index < animations.length; index += 1) {
        var animation = animations[index];
        var playState = animation?.playState;
        if (!animation || typeof playState !== "string") {
          dndLog("style:animation-state-unreadable", { tag: el.tagName });
          return undefined;
        }
        if (playState === "running" || playState === "pending") {
          cacheable = false;
        }
        fingerprintParts.push(
          [
            index,
            playState,
            animation.currentTime,
            animation.startTime,
            animation.playbackRate,
            portableStyleAnimationEffectId(animation.effect ?? null),
            animation.effect &&
              JSON.stringify({
                keyframes: animation.effect.getKeyframes?.(),
                timing: animation.effect.getTiming?.(),
                composite: animation.effect.composite,
                iterationComposite: animation.effect.iterationComposite,
                target: animation.effect.target,
              }),
          ]
            .map(function (value) {
              if (value === null) return "null";
              if (value === undefined) return "undefined";
              return `${typeof value}:${String(value)}`;
            })
            .join(":"),
        );
      }
      return {
        cacheable,
        fingerprint: fingerprintParts.join("|") || "none",
      };
    } catch (_error) {
      dndLog("style:animation-state-read-failed", { tag: el.tagName });
      return undefined;
    }
  }

  function recordPortableStyleAnimationState(
    cache: PortableStyleComputedStylesCache,
    el: Element,
  ): void {
    var state = readPortableAnimationState(el);
    if (state) cache.animationFingerprints.set(el, state.fingerprint);
    else cache.animationFingerprints.delete(el);
  }

  function canReusePortableComputedStyles(
    el: Element,
    cache?: PortableStyleComputedStylesCache,
  ): boolean {
    var current: Element | null = el;
    while (current) {
      var parent = portableStyleAnimationParent(current);
      if (
        cache &&
        (!portableStyleObserveElementRoot(cache, current) ||
          (parent && !portableStyleObserveElementRoot(cache, parent)))
      ) {
        return false;
      }
      var animationState = readPortableAnimationState(current);
      if (
        parent === undefined ||
        !animationState ||
        !animationState.cacheable
      ) {
        return false;
      }
      if (cache) {
        var previousFingerprint = cache.animationFingerprints.get(current);
        if (previousFingerprint === undefined) {
          cache.animationFingerprints.set(current, animationState.fingerprint);
        } else if (previousFingerprint !== animationState.fingerprint) {
          cache.entries.delete(current);
          cache.animationFingerprints.set(current, animationState.fingerprint);
          return false;
        }
      }
      current = parent;
    }
    return true;
  }

  var PORTABLE_TEXT_PROPERTIES: Record<string, boolean> = {
    color: true,
    font: true,
    fontFamily: true,
    fontSize: true,
    fontStyle: true,
    fontWeight: true,
    letterSpacing: true,
    lineHeight: true,
    textAlign: true,
    textDecoration: true,
    textDecorationColor: true,
    textDecorationLine: true,
    textDecorationStyle: true,
    textShadow: true,
    textTransform: true,
    whiteSpace: true,
    wordBreak: true,
  };

  function portableBorderSidePaints(
    cs: CSSStyleDeclaration,
    side: string,
  ): boolean {
    var style = cs.getPropertyValue("border-" + side + "-style");
    return (
      style !== "none" &&
      style !== "hidden" &&
      parseFloat(cs.getPropertyValue("border-" + side + "-width")) > 0
    );
  }

  function portableValueRendersNothing(
    el: Element,
    property: string,
    cs: CSSStyleDeclaration,
  ): boolean {
    var sides = ["top", "right", "bottom", "left"];
    if (/^border(Top|Right|Bottom|Left)?(Color|Style|Width)?$/.test(property)) {
      var sideMatch = /^border(Top|Right|Bottom|Left)/.exec(property);
      var checked = sideMatch ? [sideMatch[1].toLowerCase()] : sides;
      return !checked.some(function (side) {
        return portableBorderSidePaints(cs, side);
      });
    }
    if (/^outline(Color|Style|Width|Offset)?$/.test(property)) {
      return cs.outlineStyle === "none" || !(parseFloat(cs.outlineWidth) > 0);
    }
    if (property === "boxSizing") {
      return (
        !sides.some(function (side) {
          return portableBorderSidePaints(cs, side);
        }) &&
        !sides.some(function (side) {
          return parseFloat(cs.getPropertyValue("padding-" + side)) > 0;
        })
      );
    }
    if (property === "display") {
      return (
        cs.display === "block" &&
        (cs.position === "absolute" || cs.position === "fixed")
      );
    }
    if (property === "transformOrigin") {
      return (
        cs.transform === "none" &&
        (cs.rotate || "none") === "none" &&
        (cs.scale || "none") === "none"
      );
    }
    if (!PORTABLE_TEXT_PROPERTIES[property]) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === "img") return true;
    if (!(el instanceof SVGElement) || /^(text|tspan|textpath)$/.test(tag)) {
      return false;
    }
    if (property !== "color") return true;
    return !/currentcolor/i.test(
      (el.getAttribute("fill") || "") +
        (el.getAttribute("stroke") || "") +
        ((el as SVGElement).style.cssText || ""),
    );
  }

  type TypedStyleValue =
    | { status: "available"; value: string | undefined }
    | { status: "failed"; error: unknown };

  function typedStyleValue(el: Element, property: string): TypedStyleValue {
    var typedElement = el as Element & {
      computedStyleMap?: () => StylePropertyMap;
    };
    if (typeof typedElement.computedStyleMap !== "function") {
      return { status: "available", value: undefined };
    }
    try {
      return {
        status: "available",
        value: typedElement.computedStyleMap().get(property)?.toString().trim(),
      };
    } catch (error) {
      return { status: "failed", error };
    }
  }

  function dimensionHasAutoMargin(el: Element, property: string): boolean {
    var margins =
      property === "width"
        ? ["margin-left", "margin-right"]
        : ["margin-top", "margin-bottom"];
    return margins.some(function (margin) {
      var value = typedStyleValue(el, margin);
      return (
        value.status === "failed" ||
        value.value === undefined ||
        value.value.toLowerCase() === "auto"
      );
    });
  }

  function flexMainAxisDimension(parentStyle: CSSStyleDeclaration) {
    var inlineAxis = /^(vertical|sideways)/.test(parentStyle.writingMode)
      ? "height"
      : "width";
    if (!/^column/.test(parentStyle.flexDirection)) return inlineAxis;
    return inlineAxis === "width" ? "height" : "width";
  }

  function gridItemDimensionIsStretched(
    el: Element,
    property: string,
    cs: CSSStyleDeclaration,
    parentStyle: CSSStyleDeclaration,
    typedSize: TypedStyleValue,
  ): boolean {
    if (
      typedSize.status === "failed" ||
      typedSize.value?.toLowerCase() !== "auto" ||
      dimensionHasAutoMargin(el, property)
    ) {
      return false;
    }
    var alignment = property === "width" ? cs.justifySelf : cs.alignSelf;
    if (alignment === "auto") {
      alignment =
        property === "width"
          ? parentStyle.justifyItems
          : parentStyle.alignItems;
    }
    if (alignment === "stretch") return true;
    if (alignment !== "normal" || cs.aspectRatio !== "auto") return false;
    return !/^(audio|canvas|embed|iframe|img|object|video)$/.test(
      el.tagName.toLowerCase(),
    );
  }

  function flexItemDimensionIsStretched(
    el: Element,
    property: string,
    cs: CSSStyleDeclaration,
    parentStyle: CSSStyleDeclaration,
  ): boolean {
    var mainAxis = flexMainAxisDimension(parentStyle);
    if (property === mainAxis || dimensionHasAutoMargin(el, property)) {
      return false;
    }
    var alignment =
      cs.alignSelf === "auto" ? parentStyle.alignItems : cs.alignSelf;
    return alignment === "normal" || alignment === "stretch";
  }

  function portableSizeIsLayoutResolved(
    el: Element,
    property: string,
    cs: CSSStyleDeclaration,
    typedSize: string,
  ): boolean {
    if ((el as HTMLElement).style?.getPropertyValue(property)) return false;
    if (typedSize !== cs[property]) return false;
    if (cs.position === "absolute" || cs.position === "fixed") return false;
    var parent = el.parentElement;
    if (!parent) return false;
    var parentStyle = window.getComputedStyle(parent);
    if (/^(inline-)?flex$/.test(parentStyle.display)) {
      var mainAxis = flexMainAxisDimension(parentStyle);
      return property === mainAxis
        ? cs.flexBasis !== "auto" && cs.flexBasis !== "content"
        : flexItemDimensionIsStretched(el, property, cs, parentStyle);
    }
    if (/^(inline-)?grid$/.test(parentStyle.display)) {
      return gridItemDimensionIsStretched(
        el,
        property,
        cs,
        parentStyle,
        typedSize,
      );
    }
    if (property !== "width") return false;
    if (cs.display !== "block" && cs.display !== "flow-root") return false;
    var parentContentWidth =
      parent.clientWidth -
      parseFloat(parentStyle.paddingLeft || "0") -
      parseFloat(parentStyle.paddingRight || "0");
    return (
      parentContentWidth > 0 &&
      Math.abs(el.getBoundingClientRect().width - parentContentWidth) < 1
    );
  }

  function collectPortableComputedStyles(
    el: Element | null,
    cache?: PortableStyleComputedStylesCache,
    computedStyle?: CSSStyleDeclaration,
  ): Record<string, string> | null {
    if (!el) return {};
    var cacheSafe = !cache || canReusePortableComputedStyles(el, cache);
    var cacheGeneration = cache
      ? portableStyleMutationGeneration(cache)
      : undefined;
    var cached = cache?.entries.get(el);
    if (cacheSafe && cached && cached.generation === cacheGeneration) {
      return cached.styles;
    }
    var cacheFailure = function (): null {
      var failureGeneration = cache
        ? portableStyleMutationGeneration(cache)
        : undefined;
      if (cache && cacheSafe && failureGeneration === cacheGeneration) {
        cache.entries.set(el, { generation: failureGeneration, styles: null });
      }
      return null;
    };
    var cs = computedStyle || window.getComputedStyle(el);
    var defaults = portableStyleTagDefaults(el);
    if (!defaults) return cacheFailure();
    var hostStyle = (el as HTMLElement).style;
    var styles: Record<string, string> = {};
    var typedElement = el as Element & {
      computedStyleMap?: () => StylePropertyMap;
    };
    var typedStyles: StylePropertyMap | null = null;
    if (typeof typedElement.computedStyleMap !== "function") {
      dndLog("style:typed-om-unavailable", { tag: el.tagName });
      // CSSStyleDeclaration can expose used pixel sizes for auto or percentage
      // sizing, so omit only these fields rather than freezing layout geometry.
    } else {
      try {
        typedStyles = typedElement.computedStyleMap();
      } catch (_error) {
        dndLog("style:typed-om-read-failed", { tag: el.tagName });
        return cacheFailure();
      }
      if (!typedStyles) return cacheFailure();
    }
    if (typedStyles) {
      for (var property of Object.keys(PORTABLE_STYLE_BOX_SIZE_PROPERTIES)) {
        var typedValue = typedStyles.get(property);
        if (typedValue == null) {
          dndLog("style:typed-om-value-unavailable", {
            tag: el.tagName,
            property,
          });
          return cacheFailure();
        }
        var size = String(typedValue).trim();
        var preservesSizingMode =
          /%|calc\(|clamp\(|(?:min|max)\(|(?:fit|fill)-content|(?:min|max)-content/i.test(
            size,
          );
        if (
          size &&
          (size !== "auto" || hostStyle?.getPropertyValue(property)) &&
          (!portableSizeIsLayoutResolved(el, property, cs, size) ||
            preservesSizingMode)
        ) {
          styles[property] = size;
        }
      }
    }
    PORTABLE_STYLE_PROPERTIES.forEach(function (property) {
      if (PORTABLE_STYLE_BOX_SIZE_PROPERTIES[property]) return;
      var value = cs[property] || cs.getPropertyValue(property);
      var inlineValue = hostStyle && hostStyle.getPropertyValue(property);
      if (
        typeof value === "string" &&
        value.trim() &&
        (inlineValue ||
          (value !== defaults[property] &&
            !portableValueRendersNothing(el, property, cs)))
      ) {
        styles[property] = value;
      }
    });
    for (var index = 0; index < cs.length; index += 1) {
      var name = cs.item(index);
      if (
        name &&
        name.indexOf("--") === 0 &&
        !isEditorInternalCssVarName(name)
      ) {
        var customValue = cs.getPropertyValue(name);
        if (customValue && customValue.trim()) {
          styles[name] = customValue.trim();
        }
      }
    }
    var finalGeneration = cache
      ? portableStyleMutationGeneration(cache)
      : undefined;
    if (cache && cacheSafe && finalGeneration === cacheGeneration) {
      cache.entries.set(el, { generation: finalGeneration, styles: styles });
    }
    return styles;
  }

  function collectPortableStyleSnapshot(
    root: Element | null,
    cache?: PortableStyleComputedStylesCache,
    rootComputedStyle?: CSSStyleDeclaration,
  ) {
    if (!root || isDocumentRootElement(root)) return undefined;
    var maxNodes = 5000;
    var descendants = Array.prototype.slice.call(root.querySelectorAll("*"));
    var nodeCount = descendants.length + 1;
    if (nodeCount > maxNodes) {
      dndLog("style:snapshot-skipped", {
        el: getSelector(root),
        reason: "node-limit",
        count: nodeCount,
      });
      return null;
    }
    var elementPaths = elementPathsFromRoot(root, descendants);
    if (elementPaths.size !== nodeCount) {
      dndLog("style:snapshot-skipped", {
        el: getSelector(root),
        reason: "path-unavailable",
        count: nodeCount,
      });
      return null;
    }
    var nodes = [];
    var probeFailed = false;
    function pushNode(node: Element) {
      if (nodes.length >= maxNodes || probeFailed) return;
      var path = elementPaths.get(node);
      if (!path) {
        probeFailed = true;
        return;
      }
      var styles = collectPortableComputedStyles(
        node,
        node === root ? undefined : cache,
        node === root ? rootComputedStyle : undefined,
      );
      if (styles === null) {
        probeFailed = true;
        return;
      }
      nodes.push({
        sourceId: getSourceId(node) || undefined,
        path: path,
        styles: styles,
      });
    }
    pushNode(root);
    for (
      var index = 0;
      index < descendants.length && nodes.length < maxNodes && !probeFailed;
      index += 1
    ) {
      pushNode(descendants[index]);
    }
    if (probeFailed) {
      dndLog("style:snapshot-skipped", { el: getSelector(root) });
      return null;
    }
    if (cache) recordPortableStyleAnimationState(cache, root);
    return {
      version: 1,
      rootSourceId: getSourceId(root) || undefined,
      nodes: nodes,
    };
  }

  var INLINE_STYLE_PROPERTIES = [
    "position",
    "left",
    "right",
    "top",
    "bottom",
    "width",
    "height",
    "transform",
    "scale",
    "display",
    "overflow",
    "lineHeight",
    "letterSpacing",
    "gridTemplateColumns",
    "gridTemplateRows",
    "gridAutoFlow",
    "flexDirection",
    "flexWrap",
    "columnGap",
    "rowGap",
    "justifyContent",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "alignItems",
    "alignContent",
    "justifyItems",
    "gap",
    "padding",
    "webkitBoxOrient",
    "webkitLineClamp",
    "--agent-native-truncate-original-display",
    "--agent-native-truncate-original-overflow",
    "--an-vector-start-point",
    "--an-vector-end-point",
    "--an-vector-fill-gradient",
    "--an-vector-stroke-gradient",
    "--an-css-border-gradient",
    "--an-css-border-solid-color",
    "border",
    "borderWidth",
    "borderStyle",
    "borderColor",
    "borderTop",
    "borderRight",
    "borderBottom",
    "borderLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderTopStyle",
    "borderRightStyle",
    "borderBottomStyle",
    "borderLeftStyle",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "borderImageSource",
    "whiteSpace",
    "backgroundImage",
    "backgroundColor",
    "color",
    "objectFit",
    "fill",
    "borderRadius",
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomRightRadius",
    "borderBottomLeftRadius",
  ];

  function collectInlineStyles(el: Element): Record<string, string> {
    var styles: Record<string, string> = {};
    var inline = (el as HTMLElement).style;
    if (!inline) return styles;
    var authoredProperties = new Set<string>();
    var styleText = el.getAttribute("style") || "";
    var declarationStart = 0;
    var propertyEnd = -1;
    var quote = "";
    var nesting = 0;
    var escaped = false;
    for (var index = 0; index <= styleText.length; index++) {
      var character = styleText.charAt(index);
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote) {
        if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === "(" || character === "[") nesting++;
      else if ((character === ")" || character === "]") && nesting > 0)
        nesting--;
      else if (character === ":" && nesting === 0 && propertyEnd < 0)
        propertyEnd = index;
      if ((character === ";" && nesting === 0) || index === styleText.length) {
        if (propertyEnd >= declarationStart) {
          authoredProperties.add(
            styleText.slice(declarationStart, propertyEnd).trim().toLowerCase(),
          );
        }
        declarationStart = index + 1;
        propertyEnd = -1;
      }
    }
    INLINE_STYLE_PROPERTIES.forEach(function (property) {
      var cssProperty =
        property === "webkitBoxOrient"
          ? "-webkit-box-orient"
          : property === "webkitLineClamp"
            ? "-webkit-line-clamp"
            : normalizeInteractionStateProperty(property);
      if (
        /^border(?:Top|Right|Bottom|Left)(?:Width|Style|Color)?$/.test(
          property,
        ) &&
        !authoredProperties.has(cssProperty.toLowerCase())
      ) {
        return;
      }
      var value =
        property.indexOf("--") === 0 || property.indexOf("webkit") === 0
          ? inline.getPropertyValue(cssProperty)
          : (inline[property as never] as unknown as string);
      if (typeof value === "string" && value !== "") {
        styles[property] = value;
      }
    });
    return styles;
  }

  function collectAuthoredSizeStyles(
    el: Element,
  ): Record<string, string> | undefined {
    var computedStyleMap = (
      el as Element & {
        computedStyleMap?: () => { get(property: string): unknown };
      }
    ).computedStyleMap;
    if (typeof computedStyleMap !== "function") return undefined;
    var map = computedStyleMap.call(el);
    var styles: Record<string, string> = {};
    ["width", "height"].forEach(function (property) {
      var value = map.get(property);
      if (value == null) return;
      var cssText = String(value).trim();
      if (cssText) styles[property] = cssText;
    });
    return styles;
  }

  var liveVisualEditOriginalInlineStyles =
    typeof WeakMap !== "undefined"
      ? new WeakMap<Element, Record<string, string>>()
      : null;

  function rememberLiveVisualEditOriginalStyles(el: Element | null): void {
    if (!el || !liveVisualEditOriginalInlineStyles) return;
    if (liveVisualEditOriginalInlineStyles.has(el)) return;
    liveVisualEditOriginalInlineStyles.set(el, collectInlineStyles(el));
  }

  function refreshLiveVisualEditOriginalStyles(el: Element | null): void {
    if (!el || !liveVisualEditOriginalInlineStyles) return;
    liveVisualEditOriginalInlineStyles.delete(el);
    rememberLiveVisualEditOriginalStyles(el);
  }

  function releaseLiveVisualEditOriginalStyles(el: Element | null): void {
    if (!el || !liveVisualEditOriginalInlineStyles) return;
    liveVisualEditOriginalInlineStyles.delete(el);
  }

  function originalInlineStylesForPatch(
    el: Element | null,
    styles: Record<string, string>,
  ): Record<string, string> {
    if (!el || !liveVisualEditOriginalInlineStyles) return {};
    rememberLiveVisualEditOriginalStyles(el);
    var original = liveVisualEditOriginalInlineStyles.get(el) || {};
    var patch: Record<string, string> = {};
    Object.keys(styles).forEach(function (property) {
      patch[property] =
        typeof original[property] === "string" ? original[property] : "";
    });
    return patch;
  }

  function chromeColorForElement(el: Element | null): string {
    return elementLooksLikeComponent(el)
      ? "var(--design-editor-component-color)"
      : "var(--design-editor-accent-color)";
  }

  function chromeContrastColorForElement(el: Element | null): string {
    return elementLooksLikeComponent(el)
      ? "var(--design-editor-component-contrast-color)"
      : "var(--design-editor-accent-contrast-color)";
  }

  function marginValueIsAuto(
    el: Element,
    side: string,
    computedValue: string,
  ): boolean {
    var typedElement = el as Element & {
      computedStyleMap?: () => StylePropertyMap;
    };
    if (typeof typedElement.computedStyleMap === "function") {
      var typedValue = typedElement.computedStyleMap().get("margin-" + side);
      if (String(typedValue).trim().toLowerCase() === "auto") return true;
    }
    var inlineValue = (el as HTMLElement).style.getPropertyValue(
      "margin-" + side,
    );
    return (
      inlineValue.trim().toLowerCase() === "auto" ||
      computedValue.trim().toLowerCase() === "auto"
    );
  }

  function collectComputedStyles(
    cs: CSSStyleDeclaration,
    paintCs: CSSStyleDeclaration,
    strokeCs: CSSStyleDeclaration = paintCs,
  ) {
    var backgroundClip = cs.backgroundClip;
    var webkitBackgroundClip = cs.getPropertyValue("-webkit-background-clip");
    if (
      !/(^|,)\s*text\s*(,|$)/i.test(backgroundClip) &&
      /(^|,)\s*text\s*(,|$)/i.test(webkitBackgroundClip)
    ) {
      backgroundClip = webkitBackgroundClip;
    }
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      backgroundClip,
      backgroundPosition: cs.backgroundPosition,
      backgroundRepeat: cs.backgroundRepeat,
      backgroundSize: cs.backgroundSize,
      backgroundBlendMode: cs.backgroundBlendMode,
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      fontStyle: cs.fontStyle,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      webkitBoxOrient: cs.getPropertyValue("-webkit-box-orient"),
      webkitLineClamp: cs.getPropertyValue("-webkit-line-clamp"),
      textAlign: cs.textAlign,
      textTransform: cs.textTransform,
      textDecorationLine: cs.textDecorationLine,
      display: cs.display,
      overflow: cs.overflow,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      justifyItems: cs.justifyItems,
      alignSelf: cs.alignSelf,
      flexGrow: cs.flexGrow,
      flexShrink: cs.flexShrink,
      flexBasis: cs.flexBasis,
      order: cs.order,
      gridColumn: cs.gridColumn,
      gridRow: cs.gridRow,
      gridTemplateColumns: cs.gridTemplateColumns,
      gridTemplateRows: cs.gridTemplateRows,
      gridAutoFlow: cs.gridAutoFlow,
      position: cs.position,
      top: cs.top,
      right: cs.right,
      bottom: cs.bottom,
      left: cs.left,
      gap: cs.gap,
      rowGap: cs.rowGap,
      columnGap: cs.columnGap,
      width: cs.width,
      height: cs.height,
      minWidth: cs.minWidth,
      maxWidth: cs.maxWidth,
      minHeight: cs.minHeight,
      maxHeight: cs.maxHeight,
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
      borderTopWidth: cs.borderTopWidth,
      borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth,
      borderLeftWidth: cs.borderLeftWidth,
      borderTopStyle: cs.borderTopStyle,
      borderRightStyle: cs.borderRightStyle,
      borderBottomStyle: cs.borderBottomStyle,
      borderLeftStyle: cs.borderLeftStyle,
      borderTopColor: cs.borderTopColor,
      borderRightColor: cs.borderRightColor,
      borderBottomColor: cs.borderBottomColor,
      borderLeftColor: cs.borderLeftColor,
      borderRadius: cs.borderRadius,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      borderTopRightRadius: cs.borderTopRightRadius,
      borderBottomRightRadius: cs.borderBottomRightRadius,
      borderBottomLeftRadius: cs.borderBottomLeftRadius,
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      fill: paintCs.fill,
      fillOpacity: paintCs.fillOpacity,
      stroke: strokeCs.stroke,
      strokeWidth: strokeCs.strokeWidth,
      strokeOpacity: strokeCs.strokeOpacity,
      strokeDasharray: strokeCs.strokeDasharray,
      strokeDashoffset: strokeCs.strokeDashoffset,
      strokeLinecap: strokeCs.strokeLinecap,
      strokeLinejoin: strokeCs.strokeLinejoin,
      strokeMiterlimit: strokeCs.strokeMiterlimit,
      vectorOpacity: paintCs.opacity,
      vectorTransform: paintCs.transform,
      vectorTransformOrigin: paintCs.transformOrigin,
      vectorTransformBox: paintCs.transformBox,
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
      webkitBackdropFilter: (cs as unknown as { webkitBackdropFilter?: string })
        .webkitBackdropFilter,
      flexWrap: cs.flexWrap,
      alignContent: cs.alignContent,
      isolation: cs.isolation,
      whiteSpace: cs.whiteSpace,
    };
  }

  function measureNormalLineHeightPx(
    el: Element,
    cs: CSSStyleDeclaration,
  ): string | undefined {
    if (
      !hasOwnTextContent(el) ||
      cs.lineHeight.trim().toLowerCase() !== "normal" ||
      !document.body
    ) {
      return undefined;
    }

    var probe = document.createElement("span");
    probe.textContent = (el.textContent || "Hg").slice(0, 256);
    probe.setAttribute("aria-hidden", "true");
    probe.setAttribute("data-agent-native-edit-overlay", "line-height-probe");
    probe.style.setProperty("all", "initial");
    probe.style.position = "fixed";
    probe.style.left = "-10000px";
    probe.style.top = "0";
    probe.style.display = "inline-block";
    probe.style.width = "max-content";
    probe.style.whiteSpace = "nowrap";
    probe.style.lineHeight = "normal";
    probe.style.margin = "0";
    probe.style.padding = "0";
    probe.style.border = "0";
    probe.style.visibility = "hidden";
    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontSize = cs.fontSize;
    probe.style.fontStyle = cs.fontStyle;
    probe.style.fontWeight = cs.fontWeight;
    probe.style.fontStretch = cs.fontStretch;
    probe.style.fontVariant = cs.fontVariant;
    probe.style.fontKerning = cs.fontKerning;
    probe.style.fontFeatureSettings = cs.fontFeatureSettings;
    probe.style.fontVariationSettings = cs.fontVariationSettings;
    probe.style.fontOpticalSizing = cs.fontOpticalSizing;
    probe.style.letterSpacing = cs.letterSpacing;
    probe.style.wordSpacing = cs.wordSpacing;
    probe.style.textTransform = cs.textTransform;
    document.body.appendChild(probe);
    var height = probe.getBoundingClientRect().height;
    probe.remove();
    return height > 0 && Number.isFinite(height) ? height + "px" : undefined;
  }

  function collectTextRangeComputedStyles(
    target: Element,
    bookmark: { start: number; end: number; text: string },
  ): Record<string, string> | null {
    var values = {
      color: [] as string[],
      fontFamily: [] as string[],
      fontSize: [] as string[],
      fontStyle: [] as string[],
      fontWeight: [] as string[],
      lineHeight: [] as string[],
      letterSpacing: [] as string[],
      textDecorationLine: [] as string[],
      textTransform: [] as string[],
    };
    var resolvedNormalLineHeights: string[] = [];
    var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    var textOffset = 0;
    while (walker.nextNode()) {
      var text = walker.currentNode as Text;
      var start = textOffset;
      var end = start + text.data.length;
      textOffset = end;
      if (end <= bookmark.start || start >= bookmark.end) {
        continue;
      }
      var styleTarget = text.parentElement || target;
      var styles = window.getComputedStyle(styleTarget);
      values.color.push(styles.color);
      values.fontFamily.push(styles.fontFamily);
      values.fontSize.push(styles.fontSize);
      values.fontStyle.push(styles.fontStyle);
      values.fontWeight.push(styles.fontWeight);
      values.lineHeight.push(styles.lineHeight);
      values.letterSpacing.push(styles.letterSpacing);
      values.textDecorationLine.push(styles.textDecorationLine);
      values.textTransform.push(styles.textTransform);
      var resolvedNormalLineHeight = measureNormalLineHeightPx(
        styleTarget,
        styles,
      );
      if (resolvedNormalLineHeight) {
        resolvedNormalLineHeights.push(resolvedNormalLineHeight);
      }
    }
    if (values.color.length === 0) return null;
    var computed: Record<string, string> = {};
    Object.keys(values).forEach(function (property) {
      var propertyValues = values[property as keyof typeof values];
      computed[property] = propertyValues.every(
        (value) => value === propertyValues[0],
      )
        ? propertyValues[0] || ""
        : "Mixed";
    });
    if (
      computed.lineHeight === "normal" &&
      computed.fontFamily !== "Mixed" &&
      computed.fontSize !== "Mixed" &&
      computed.fontStyle !== "Mixed" &&
      computed.fontWeight !== "Mixed" &&
      resolvedNormalLineHeights.length === values.lineHeight.length &&
      resolvedNormalLineHeights.every(
        (value) => value === resolvedNormalLineHeights[0],
      )
    ) {
      computed.resolvedLineHeightPx = resolvedNormalLineHeights[0]!;
    }
    return computed;
  }

  function collectTextRangeInlineStyles(
    target: Element,
    bookmark: { start: number; end: number; text: string },
  ): Record<string, string> | undefined {
    var lineHeights: string[] = [];
    var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    var textOffset = 0;
    while (walker.nextNode()) {
      var text = walker.currentNode as Text;
      var start = textOffset;
      var end = start + text.data.length;
      textOffset = end;
      if (end <= bookmark.start || start >= bookmark.end) continue;
      var styleTarget = text.parentElement || target;
      var inlineStyle = (styleTarget as HTMLElement).style;
      lineHeights.push(inlineStyle?.lineHeight || "");
    }
    if (lineHeights.length === 0) return undefined;
    var first = lineHeights[0] || "";
    return lineHeights.every(function (value) {
      return value === first;
    })
      ? { lineHeight: first }
      : undefined;
  }

  function textLeafAtCaret(root: Element, range: Range): Text | null {
    if (!range.collapsed || !rangeBelongsToElement(range, root)) return null;
    var container = range.startContainer;
    if (container.nodeType === 3) return container as Text;
    if (container.nodeType !== 1) return null;

    function firstText(node: Node): Text | null {
      if (node.nodeType === 3) return node as Text;
      var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      return (walker.nextNode() as Text | null) || null;
    }

    function lastText(node: Node): Text | null {
      if (node.nodeType === 3) return node as Text;
      var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      var result: Text | null = null;
      while (walker.nextNode()) result = walker.currentNode as Text;
      return result;
    }

    var children = container.childNodes;
    var offset = range.startOffset;
    for (var forward = offset; forward < children.length; forward += 1) {
      var forwardText = firstText(children[forward]!);
      if (forwardText) return forwardText as Text;
    }
    for (var backward = offset - 1; backward >= 0; backward -= 1) {
      var backwardText = lastText(children[backward]!);
      if (backwardText) return backwardText as Text;
    }
    return null;
  }

  function collectCaretTextStyles(target: Element): {
    computedStyles: Record<string, string>;
    inlineStyles?: Record<string, string>;
  } | null {
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return null;
    }
    var caret = selection.getRangeAt(0);
    if (!rangeBelongsToElement(caret, target)) return null;
    var leaf = textLeafAtCaret(target, caret);
    if (!leaf || leaf.length === 0) return null;

    var leafRange = document.createRange();
    leafRange.selectNodeContents(leaf);
    var bookmark = captureTextRangeBookmark(target, leafRange);
    if (!bookmark) return null;
    var computedStyles = collectTextRangeComputedStyles(target, bookmark);
    if (!computedStyles) return null;
    return {
      computedStyles: computedStyles,
      inlineStyles: collectTextRangeInlineStyles(target, bookmark),
    };
  }

  function collectElementComputedStyles(
    el: Element,
    cs: CSSStyleDeclaration,
    paintCs: CSSStyleDeclaration,
  ): Record<string, string> {
    var strokeTarget = vectorStrokeTarget(el);
    var strokeCs = strokeTarget
      ? window.getComputedStyle(strokeTarget)
      : paintCs;
    var computed = collectComputedStyles(cs, paintCs, strokeCs);
    var paintTarget =
      vectorPaintTarget(el) ||
      (el.tagName.toLowerCase() === "path" &&
      el.hasAttribute("data-an-pen-nodes")
        ? el
        : null);
    var penNodesOwner =
      paintTarget && paintTarget.hasAttribute("data-an-pen-nodes")
        ? paintTarget
        : el;
    if (
      paintTarget &&
      paintTarget.getAttribute("fill-opacity") === "0" &&
      (penNodesOwner.getAttribute("data-an-pen-nodes") || "").indexOf("[0") ===
        0
    ) {
      computed.fillOpacity =
        (paintTarget as HTMLElement).style.getPropertyValue("fill-opacity") ||
        "1";
    }
    if (
      el.tagName.toLowerCase() === "svg" &&
      el.getAttribute("data-an-primitive") === "pasted-svg" &&
      !vectorPaintTarget(el) &&
      !el.hasAttribute("fill") &&
      !(el as HTMLElement).style.getPropertyValue("fill")
    ) {
      computed.fill = "";
    }
    if (strokeTarget?.hasAttribute("data-an-vector-stroke-overlay")) {
      computed.strokeWidth =
        strokeTarget.getAttribute("data-an-vector-logical-width") ||
        strokeCs.strokeWidth;
    }
    var wholeText: Record<string, string> | null = null;
    if (isWholeTextStyleRoot(el)) {
      var fullText = el.textContent || "";
      wholeText = collectTextRangeComputedStyles(el, {
        start: 0,
        end: fullText.length,
        text: fullText,
      });
    }
    if (wholeText) {
      computed = { ...computed, ...wholeText };
    } else {
      var resolvedLineHeightPx = measureNormalLineHeightPx(el, cs);
      if (resolvedLineHeightPx) {
        computed.resolvedLineHeightPx = resolvedLineHeightPx;
      }
    }
    if (marginValueIsAuto(el, "top", cs.marginTop)) computed.marginTop = "auto";
    if (marginValueIsAuto(el, "right", cs.marginRight))
      computed.marginRight = "auto";
    if (marginValueIsAuto(el, "bottom", cs.marginBottom))
      computed.marginBottom = "auto";
    if (marginValueIsAuto(el, "left", cs.marginLeft))
      computed.marginLeft = "auto";
    return {
      ...computed,
      "--an-vector-stroke-position":
        el.getAttribute("data-an-vector-stroke-position") || "",
      "--an-vector-start-point": (el as HTMLElement).style.getPropertyValue(
        "--an-vector-start-point",
      ),
      "--an-vector-end-point": (el as HTMLElement).style.getPropertyValue(
        "--an-vector-end-point",
      ),
    };
  }

  function getElementInfo(
    el: Element,
    portableComputedStylesCache?: PortableStyleComputedStylesCache,
    includePortableStyleSnapshot = true,
  ): unknown {
    var cs = window.getComputedStyle(el);
    var paintCs = window.getComputedStyle(vectorPaintTarget(el) || el);
    var boundingRect = rectInfoForElement(el);
    var componentName = componentNameForElement(el);
    var parentAutoLayout = autoLayoutParentInfo(el);
    var designParent = designParentForElement(el);
    var parentStyles = designParent
      ? window.getComputedStyle(designParent)
      : null;
    var authoredSizeStyles = collectAuthoredSizeStyles(el);
    var parentDisplay = parentStyles ? parentStyles.display : undefined;
    var runtimeOnlyClone = isRuntimeOnlyClone(el);
    var sourceBacked =
      !runtimeOnlyClone &&
      (hasStableOwnSource(el) ||
        (!isTemplateCloneElement(el) && !!closestStableSourceElement(el)));
    var sourceId = sourceBacked ? getSourceId(el) || getSelector(el) : "";
    var runtimeSourceId = runtimeOnlyClone ? getSourceId(el) : "";
    var runtimeSelector = runtimeSourceId ? getSelector(el) : "";
    var pendingNodeId = "";
    if (
      !getSourceId(el) &&
      el !== document.body &&
      el !== document.documentElement &&
      el.getAttribute &&
      el.setAttribute &&
      !isTemplateCloneElement(el)
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
          gridAutoFlow: parentStyles.gridAutoFlow,
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
    var provenance: FrameworkDebugProvenance = elementDebugProvenance(el);
    var runtimeComponent = runtimeComponentIdentityForElement(
      el,
      provenance,
      sourceId || runtimeSourceId || pendingNodeId || getSelector(el),
    );
    var portableStyleSnapshot = includePortableStyleSnapshot
      ? collectPortableStyleSnapshot(el, portableComputedStylesCache, cs)
      : undefined;
    return {
      tagName: el.tagName.toLowerCase(),
      componentName: componentName || undefined,
      componentAnnotation: explicitComponentNameForElement(el) || undefined,
      runtimeComponent: runtimeComponent,
      id: el.id || undefined,
      sourceId: sourceId,
      runtimeSelector: runtimeSelector || undefined,
      runtimeSourceId: runtimeSourceId || undefined,
      repeat: repeatInstanceInfo(el) || undefined,
      hasOwnText: hasOwnTextContent(el),
      wholeTextStyleRoot: isWholeTextStyleRoot(el),
      pendingNodeId: pendingNodeId || undefined,
      selector: getSelector(el),
      classes: Array.from(el.classList),
      computedStyles: collectElementComputedStyles(el, cs, paintCs),
      inlineStyles: collectElementInlineStyles(el),
      authoredSizeStyles: authoredSizeStyles,
      primitiveKind: el.getAttribute("data-an-primitive") || undefined,
      isGroup: el.getAttribute("data-agent-native-group") === "true",
      vectorStrokeCanAlign: vectorStrokeCanAlign(el),
      portableStyleSnapshot:
        portableStyleSnapshot === null ? undefined : portableStyleSnapshot,
      styleSnapshotCaptureFailed:
        portableStyleSnapshot === null ? true : undefined,
      boundingRect,
      parentBoundingRect: designParent
        ? rectInfoForElement(designParent)
        : undefined,
      textContent: el.textContent ? el.textContent.slice(0, 200) : undefined,
      textContentTruncated: el.textContent
        ? el.textContent.length > 200
        : undefined,
      htmlContent:
        el.innerHTML && el.innerHTML !== el.textContent
          ? el.innerHTML.slice(0, 4000)
          : undefined,
      htmlContentTruncated:
        el.innerHTML && el.innerHTML !== el.textContent
          ? el.innerHTML.length > 4000
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

  var lastScreenRootStyleSnapshot = "";
  var screenRootStyleSnapshotFrame = 0;
  function postScreenRootStyleSnapshot(): void {
    if (!document.body) return;
    var cs = window.getComputedStyle(document.body);
    var computedStyles = collectComputedStyles(cs, cs);
    var signature = JSON.stringify(computedStyles);
    if (signature === lastScreenRootStyleSnapshot) return;
    lastScreenRootStyleSnapshot = signature;
    (window.parent as Window).postMessage(
      {
        type: "agent-native:screen-root-computed-styles",
        computedStyles: computedStyles,
      },
      "*",
    );
  }
  function scheduleScreenRootStyleSnapshot(): void {
    if (screenRootStyleSnapshotFrame) return;
    screenRootStyleSnapshotFrame = window.requestAnimationFrame(function () {
      screenRootStyleSnapshotFrame = 0;
      postScreenRootStyleSnapshot();
    });
  }

  function getLightElementInfo(
    el: Element,
    includePendingNodeId = false,
  ): unknown {
    var rect = el.getBoundingClientRect();
    var componentName = componentNameForElement(el);
    var runtimeOnlyClone = isRuntimeOnlyClone(el);
    var sourceBacked =
      !runtimeOnlyClone &&
      (hasStableOwnSource(el) ||
        (!isTemplateCloneElement(el) && !!closestStableSourceElement(el)));
    var sourceId = sourceBacked ? getSourceId(el) || getSelector(el) : "";
    var runtimeSourceId = runtimeOnlyClone ? getSourceId(el) : "";
    var runtimeSelector = runtimeSourceId ? getSelector(el) : "";
    var parentStyles = el.parentElement
      ? window.getComputedStyle(el.parentElement)
      : null;
    var parentDisplay = parentStyles ? parentStyles.display : undefined;
    var cs = window.getComputedStyle(el);
    var pendingNodeId = "";
    if (
      includePendingNodeId &&
      !getSourceId(el) &&
      el !== document.body &&
      el !== document.documentElement &&
      el.getAttribute &&
      el.setAttribute &&
      !isTemplateCloneElement(el)
    ) {
      pendingNodeId = el.getAttribute("data-an-pending-node-id") || "";
      if (!pendingNodeId) {
        pendingNodeId = freshRuntimeNodeId("pending");
        el.setAttribute("data-an-pending-node-id", pendingNodeId);
      }
    }
    return {
      tagName: el.tagName.toLowerCase(),
      componentName: componentName || undefined,
      id: el.id || undefined,
      sourceId: sourceId,
      runtimeSelector: runtimeSelector || undefined,
      runtimeSourceId: runtimeSourceId || undefined,
      pendingNodeId: pendingNodeId || undefined,
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
      textContentTruncated: el.textContent
        ? el.textContent.length > 200
        : undefined,
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
    var shiftHeld = Boolean(e && e.shiftKey);
    return {
      additive: shiftHeld,
      range: shiftHeld,
      source: "pointer",
      shiftKey: shiftHeld,
      metaKey: Boolean(e && e.metaKey),
      ctrlKey: Boolean(e && e.ctrlKey),
    };
  }

  function postElementSelect(el: Element, e?: MouseEvent): void {
    var selectionGenerationAtPost = ++selectionGeneration;
    rememberLiveVisualEditOriginalStyles(el);
    var intent = e ? selectionIntentFromEvent(e) : undefined;
    var message: {
      type: string;
      payload: unknown;
      intent?: ReturnType<typeof selectionIntentFromEvent>;
    } = {
      type: "element-select",
      payload: getElementInfo(el),
    };
    if (intent) message.intent = intent;
    (window.parent as Window).postMessage(message, "*");

    var framework = frameworkDebugProvenance(el);
    if (
      framework.framework === "react" &&
      (framework.method === "debug-stack" ||
        framework.ownerMethod === "debug-stack")
    ) {
      void remapReactElementProvenance(el, framework).then(function (mapped) {
        if (
          !mapped ||
          el.isConnected === false ||
          selectedEl !== el ||
          selectionGeneration !== selectionGenerationAtPost
        ) {
          return;
        }
        (window.parent as Window).postMessage(
          { type: "element-select", payload: getElementInfo(el) },
          "*",
        );
        remapReactDocumentProvenance();
      });
    }
  }

  // same scope containerFirstSelectionTarget resolves clicks against — never
  function collectSelectableElements(deep?: boolean): Element[] {
    var nodes = Array.prototype.slice.call(
      document.body ? document.body.querySelectorAll("*") : [],
    ) as Element[];
    var scope: Element | null = null;
    if (!deep) {
      scope = selectionContainerScope;
      if (!scope || !document.documentElement.contains(scope)) {
        scope = document.body;
      }
    }
    var seen = new Set<Element>();
    var elements: Element[] = [];
    nodes.forEach(function (node) {
      if (NON_SELECTABLE_TAGS.indexOf(node.tagName.toLowerCase()) !== -1) {
        return;
      }
      var target = selectionTargetForHit(node);
      if (target && scope && scope.contains(target)) {
        target = containerScopeAncestor(target, scope);
      }
      if (
        !target ||
        isDocumentRootElement(target) ||
        isBoardRootMarqueeSurface(target) ||
        isOverlayElement(target) ||
        isLayerInteractionBlocked(target) ||
        isTemplateCloneElement(target) ||
        seen.has(target) ||
        isPaddedAwayFromView(target)
      ) {
        return;
      }
      seen.add(target);
      elements.push(target);
    });
    return elements;
  }

  function isPaddedAwayFromView(el: Element): boolean {
    var rect = el.getBoundingClientRect();
    if (
      rect.width >= MIN_SELECTABLE_EXTENT_PX &&
      rect.height >= MIN_SELECTABLE_EXTENT_PX
    ) {
      return false;
    }
    var cs = window.getComputedStyle(el);
    return cs.display === "none" || cs.visibility === "hidden";
  }

  function readSelectablePoint(raw: unknown): SelectablePoint | null {
    if (raw === undefined || raw === null) return null;
    var point = raw as Partial<SelectablePoint>;
    if (
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      !isFinite(point.x) ||
      !isFinite(point.y)
    ) {
      throw new Error(
        "agent-native:collect-selectable-rects received a malformed atPoint",
      );
    }
    return { x: point.x, y: point.y };
  }

  interface SelectablePoint {
    x: number;
    y: number;
  }

  function collectSelectableElementInfos(
    deep: boolean,
    atPoint?: SelectablePoint | null,
    includePortableStyleSnapshot = true,
  ): unknown[] {
    var targets = collectSelectableElements(deep);
    if (atPoint) {
      targets = targets.filter(function (el) {
        return documentSpaceBoundsContainPoint(el, atPoint);
      });
    }
    if (!includePortableStyleSnapshot) {
      return targets.map(function (target) {
        return getElementInfo(target, undefined, false);
      });
    }
    portableStyleProbeDocument();
    var portableComputedStylesCache = createPortableStyleComputedStylesCache();
    try {
      return targets.map(function (target) {
        return getElementInfo(target, portableComputedStylesCache, true);
      });
    } finally {
      if (portableComputedStylesCache) {
        portableComputedStylesCache.mutationObserver.disconnect();
        portableComputedStylesCache.restoreCssomHooks();
      }
    }
  }

  function documentSpaceBoundsContainPoint(
    el: Element,
    point: SelectablePoint,
  ): boolean {
    var bounds = selectableBounds(el);
    var scrollX = window.scrollX || window.pageXOffset || 0;
    var scrollY = window.scrollY || window.pageYOffset || 0;
    var tolerance = 1;
    return (
      point.x >= bounds.left + scrollX - tolerance &&
      point.x <= bounds.right + scrollX + tolerance &&
      point.y >= bounds.top + scrollY - tolerance &&
      point.y <= bounds.bottom + scrollY + tolerance
    );
  }

  var shieldOverlay = document.createElement("div");
  shieldOverlay.setAttribute("data-agent-native-edit-overlay", "shield");
  shieldOverlay.style.cssText =
    "position:fixed;inset:0;z-index:99990;background:transparent;pointer-events:auto;touch-action:none;cursor:default;";
  appendEditorChromeNode(shieldOverlay);

  var highlightOverlay = document.createElement("div");
  highlightOverlay.setAttribute("data-agent-native-edit-overlay", "highlight");
  highlightOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:99997;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;";
  appendEditorChromeNode(highlightOverlay);

  var marqueeSelectionOverlay = document.createElement("div");
  marqueeSelectionOverlay.setAttribute(
    "data-agent-native-edit-overlay",
    "marquee-selection",
  );
  marqueeSelectionOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:99995;border:1px solid var(--design-editor-accent-color);background:color-mix(in srgb,var(--design-editor-accent-color) 14%,transparent);display:none;box-sizing:border-box;";
  appendEditorChromeNode(marqueeSelectionOverlay);

  var parentAutoLayoutOverlay = document.createElement("div");
  parentAutoLayoutOverlay.setAttribute(
    "data-agent-native-edit-overlay",
    "parent-auto-layout",
  );
  parentAutoLayoutOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:99996;border:1px dashed var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;border-radius:2px;opacity:0.68;";
  appendEditorChromeNode(parentAutoLayoutOverlay);

  var selectionOverlay = document.createElement("div");
  selectionOverlay.setAttribute("data-agent-native-edit-overlay", "selection");
  selectionOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:99998;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;cursor:default;";
  ["n", "e", "s", "w"].forEach(function (pos) {
    var edge = document.createElement("span");
    edge.setAttribute("data-agent-native-edge-handle", pos);
    var cursor = pos === "n" || pos === "s" ? "ns-resize" : "ew-resize";
    edge.style.cssText =
      "position:absolute;z-index:2;pointer-events:auto;cursor:" +
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
      "position:absolute;z-index:1;width:7px;height:7px;border:1px solid var(--design-editor-accent-color);background:var(--design-editor-accent-contrast-color);box-sizing:border-box;border-radius:2px;box-shadow:0 1px 2px color-mix(in srgb,var(--design-editor-accent-color) 25%,transparent);pointer-events:auto;cursor:" +
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
    var handle = document.createElement("span");
    handle.setAttribute("data-agent-native-radius-handle", pos);
    handle.style.cssText =
      "position:absolute;z-index:2;width:9px;height:9px;border:1.5px solid var(--design-editor-accent-color);background:var(--design-editor-accent-contrast-color);box-sizing:border-box;border-radius:999px;box-shadow:0 1px 2px color-mix(in srgb,var(--design-editor-accent-color) 25%,transparent);pointer-events:auto;cursor:pointer;display:none;";
    selectionOverlay.appendChild(handle);
  });
  (function () {
    var baseAngles = { nw: 270, ne: 0, se: 90, sw: 180 };
    function rotateCursorUri(angleDeg) {
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">' +
        '<g transform="rotate(' +
        angleDeg +
        ' 10 10)" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M 4 8 A 7 7 0 0 1 16 8" stroke="white" stroke-width="3.5"/>' +
        '<path d="M 4 8 A 7 7 0 0 1 16 8"/>' +
        '<path d="M 12.5 3.5 L 16 8 L 11 8.5" fill="white" stroke="white" stroke-width="3.5" stroke-linejoin="round"/>' +
        '<path d="M 12.5 3.5 L 16 8 L 11 8.5" fill="black"/>' +
        "</g></svg>";
      return (
        'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 10 10, grab'
      );
    }
    ["nw", "ne", "se", "sw"].forEach(function (pos) {
      var handle = document.createElement("span");
      handle.setAttribute("data-agent-native-rotate-handle", pos);
      handle.style.cssText =
        "position:absolute;width:28px;height:28px;border-radius:999px;pointer-events:auto;";
      handle.style.cursor = rotateCursorUri(baseAngles[pos]);
      if (pos.indexOf("n") !== -1) handle.style.top = "-34px";
      if (pos.indexOf("s") !== -1) handle.style.bottom = "-34px";
      if (pos.indexOf("w") !== -1) handle.style.left = "-34px";
      if (pos.indexOf("e") !== -1) handle.style.right = "-34px";
      selectionOverlay.appendChild(handle);
    });
  })();
  var spacingOverlay = document.createElement("div");
  spacingOverlay.setAttribute("data-agent-native-spacing-overlay", "");
  spacingOverlay.style.cssText =
    "position:absolute;inset:0;display:none;pointer-events:none;";
  selectionOverlay.appendChild(spacingOverlay);
  appendEditorChromeNode(selectionOverlay);
  if (readOnly) setSelectionOverlayResizeChromeVisible(false);

  // gradients only, matching MultiScreenCanvas's overlay scope: an
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
  appendEditorChromeNode(gradientOverlay);

  var transformBadge = document.createElement("div");
  transformBadge.setAttribute("data-agent-native-transform-badge", "");
  transformBadge.setAttribute(
    "data-agent-native-edit-overlay",
    "transform-badge",
  );
  transformBadge.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;border:1px solid rgba(255,255,255,0.16);border-radius:4px;background:rgba(24,24,27,0.96);color:rgba(255,255,255,0.96);font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 5px;box-shadow:0 8px 20px rgba(0,0,0,0.28);";
  appendEditorChromeNode(transformBadge);

  var spacingBadge = document.createElement("div");
  spacingBadge.setAttribute("data-agent-native-spacing-badge", "");
  spacingBadge.setAttribute("data-agent-native-edit-overlay", "spacing-badge");
  spacingBadge.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;border-radius:3px;color:white;font:10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;padding:2px 4px;box-shadow:0 4px 14px rgba(0,0,0,0.18);";
  appendEditorChromeNode(spacingBadge);

  var constraintGuideLayer = document.createElement("div");
  constraintGuideLayer.setAttribute(
    "data-agent-native-edit-overlay",
    "constraint-guide",
  );
  constraintGuideLayer.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:none;pointer-events:none;";
  appendEditorChromeNode(constraintGuideLayer);

  var sizeBadge = document.createElement("div");
  sizeBadge.setAttribute("data-agent-native-edit-overlay", "size-badge");
  sizeBadge.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;border-radius:4px;background:var(--design-editor-accent-color);color:var(--design-editor-accent-contrast-color);font:600 11px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;padding:2px 6px;white-space:nowrap;box-shadow:0 1px 2px color-mix(in srgb,var(--design-editor-accent-color) 15%,transparent);";
  appendEditorChromeNode(sizeBadge);

  var insertionGuide = document.createElement("div");
  insertionGuide.setAttribute("data-agent-native-insertion-guide", "");
  insertionGuide.setAttribute(
    "data-agent-native-edit-overlay",
    "insertion-guide",
  );
  insertionGuide.style.cssText =
    "position:fixed;z-index:100000;display:none;pointer-events:none;background:var(--design-editor-accent-color);border-radius:999px;box-shadow:0 0 0 1px var(--design-editor-accent-color);";
  appendEditorChromeNode(insertionGuide);

  var snapGuideLayer = document.createElement("div");
  snapGuideLayer.setAttribute("data-agent-native-edit-overlay", "snap-guide");
  snapGuideLayer.style.cssText =
    "position:fixed;inset:0;z-index:100000;display:none;pointer-events:none;";
  appendEditorChromeNode(snapGuideLayer);

  var gridCellOverlay = document.createElement("div");
  gridCellOverlay.setAttribute("data-agent-native-edit-overlay", "grid-cells");
  gridCellOverlay.style.cssText =
    "position:fixed;inset:0;z-index:99993;display:none;pointer-events:none;";
  appendEditorChromeNode(gridCellOverlay);

  var gridTrackOverlay = document.createElement("div");
  gridTrackOverlay.setAttribute(
    "data-agent-native-edit-overlay",
    "grid-tracks",
  );
  gridTrackOverlay.style.cssText =
    "position:fixed;inset:0;z-index:99994;display:none;pointer-events:none;";
  appendEditorChromeNode(gridTrackOverlay);

  var frameLabelLayer = document.createElement("div");
  frameLabelLayer.setAttribute("data-agent-native-edit-overlay", "frame-label");
  frameLabelLayer.style.cssText =
    "position:fixed;inset:0;z-index:99992;display:block;pointer-events:none;";
  appendEditorChromeNode(frameLabelLayer);

  var measurementOverlay = document.createElement("div");
  measurementOverlay.setAttribute("data-agent-native-measurement-overlay", "");
  measurementOverlay.setAttribute(
    "data-agent-native-edit-overlay",
    "measurement",
  );
  measurementOverlay.style.cssText =
    "position:fixed;inset:0;z-index:100001;display:none;pointer-events:none;color:var(--design-editor-measure-color);font:11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;";
  appendEditorChromeNode(measurementOverlay);

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
  appendEditorChromeNode(componentTagOverlay);

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

    var rect = knownRect || el.getBoundingClientRect();
    var line = chromeLineScale();
    var tagHeight = 24 * line;
    var tagTop = rect.top - tagHeight - 6 * line;
    if (tagTop < 4 * line) tagTop = rect.bottom + 40 * line;
    componentTagOverlay.style.display = "block";
    componentTagOverlay.style.fontSize = 11 * line + "px";
    componentTagOverlay.style.padding = 2 * line + "px " + 6 * line + "px";
    componentTagOverlay.style.borderRadius = 4 * line + "px";
    componentTagOverlay.style.borderWidth = 1 * line + "px";
    componentTagOverlay.style.left = rect.left + "px";
    componentTagOverlay.style.top = tagTop + "px";
    // applyElementOverlayChrome already paints this overlay's border the
    // component colour, so a second stroke here double-strokes every
    // component root.
  }

  function clearComponentTag(): void {
    componentTagOverlay.style.display = "none";
    componentTagOverlay.removeAttribute("data-component-node-id");
    componentTagOverlay.removeAttribute("data-component-name");
  }

  function applyElementOverlayChrome(
    overlay: HTMLElement,
    el: Element | null,
  ): void {
    var color = chromeColorForElement(el);
    var contrast = chromeContrastColorForElement(el);
    var softChrome =
      overlay.getAttribute("data-agent-native-soft-chrome") === "true";
    overlay.style.borderColor = softChrome
      ? "color-mix(in srgb," + color + " 64%,transparent)"
      : color;
    if (softChrome) {
      overlay.style.background =
        "color-mix(in srgb," + color + " 5%,transparent)";
    } else if (
      overlay === highlightOverlay ||
      overlay.getAttribute("data-agent-native-edit-overlay") ===
        "multi-selection"
    ) {
      overlay.style.background = "transparent";
    }
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

  function setHighlightOverlayStyle(style: "default" | "soft"): void {
    highlightOverlayStyle = style;
    if (style === "soft") {
      highlightOverlay.setAttribute("data-agent-native-soft-chrome", "true");
    } else {
      highlightOverlay.removeAttribute("data-agent-native-soft-chrome");
    }
    if (hoveredEl && hoveredEl !== selectedEl) {
      applyElementOverlayChrome(highlightOverlay, hoveredEl);
    }
    applyEditorChromeScale();
  }

  function applySelectionChrome(el: Element | null): void {
    applyElementOverlayChrome(selectionOverlay, el);
  }

  function hideParentAutoLayoutOverlay(): void {
    parentAutoLayoutOverlay.style.display = "none";
  }

  function updateParentAutoLayoutOverlay(el: Element | null): void {
    if (el?.getAttribute("data-an-primitive") === "frame") {
      hideParentAutoLayoutOverlay();
      return;
    }
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
    if (designCanvasBoardSurface) {
      window.parent.postMessage(
        { type: "agent-native:board-selection-rect", rect: null },
        "*",
      );
    }
    hideSizeBadge();
    hideSpacingOverlay();
    hideGridCellOverlay();
    refreshFrameNameLabels();
    hideParentAutoLayoutOverlay();
    clearComponentTag();
    removeRepeatInstanceOverlays();
  }

  var selectedEl: Element | null = null;
  var runtimeStructureInsertTransactionKey = Symbol(
    "agent-native-runtime-structure-transaction",
  );
  var selectionContainerScope: Element | null = null;
  var selectionGeneration = 0;
  var selectionChromeHidden = false;
  var hoveredEl: Element | null = null;
  var highlightOverlayStyle: "default" | "soft" = "default";
  type NodeHtmlPreviewSession = {
    proposalId: string;
    originalElement: Element;
    originalOuterHTML: string;
    startMarker: Comment;
    endMarker: Comment;
    currentElement: Element;
    selectedWasInside: boolean;
    hoveredWasInside: boolean;
  };
  var activeNodeHtmlPreview: NodeHtmlPreviewSession | null = null;
  var lastHoverInfoPostedEl: Element | null = null;

  function clearHoverGate(): void {
    hoveredEl = null;
    lastHoverInfoPostedEl = null;
  }

  var passiveSelectionEls: Element[] = [];
  var passiveSelectionOverlays: HTMLElement[] = [];
  var repeatInstanceOverlays: HTMLElement[] = [];
  var repeatInstanceAnchor: Element | null = null;
  var multiSelectionBoundsOverlay: HTMLElement | null = null;
  var activeMarqueeSelection: {
    startX: number;
    startY: number;
    additive: boolean;
    deep: boolean;
    moved: boolean;
    pointerId?: number;
    candidates?: Element[];
    candidateBounds?: SelectableBounds[];
    infoCache?: Map<Element, unknown>;
    lightInfoCache?: Map<Element, unknown>;
    lastReportedElements?: Element[];
    moveFrame?: number | null;
    pendingMoveEvent?: MouseEvent | null;
    move: string;
    up: string;
    onMove: (ev: MouseEvent) => void;
    onUp: (ev: MouseEvent) => void;
  } | null = null;
  var activeTextEditEl: HTMLElement | null = null;
  var activeTextEditRange: Range | null = null;
  var activeTextEditStyleSelector = "";
  var suspendedTextEditRange: {
    target: HTMLElement;
    range: Range;
    selector: string;
  } | null = null;
  var textEditInspectorFocused = false;
  var activeTextEditOriginalMinWidth = "";
  var activeTextEditOriginalMinHeight = "";
  var finishActiveTextEdit: ((commit: boolean) => void) | null = null;
  var pendingRuntimeDocumentUpdate: {
    html: string;
    preferredSelector: string;
    selectorCandidates: string[];
    sourceProvenance?: { versionHash?: string; uniqueNodeIds: string[] };
  } | null = null;
  var textEditPointerState: {
    selection: string;
    highlight: string;
  } | null = null;
  type BeginTextEditRepeat = { sourceSelector: string; itemIndex: number };
  var pendingBeginTextEdit: {
    nodeId: string;
    repeat: BeginTextEditRepeat | null;
    force: boolean;
    commitImmediately: boolean;
    deadline: number;
    raf: number;
    buffer: string;
  } | null = null;
  function cancelPendingBeginTextEdit(): void {
    if (!pendingBeginTextEdit) return;
    if (pendingBeginTextEdit.raf) {
      window.cancelAnimationFrame(pendingBeginTextEdit.raf);
    }
    pendingBeginTextEdit = null;
  }
  function postTextEditPending(
    nodeId: string,
    pending: boolean,
    reason?:
      | "escape"
      | "pointerdown"
      | "superseded"
      | "deadline"
      | "committed"
      | "not-taken",
  ): void {
    (window.parent as Window).postMessage(
      {
        type: "text-edit-pending",
        nodeId: nodeId,
        pending: pending,
        reason: reason,
      },
      "*",
    );
  }
  function postTextEditInsertResult(nodeId: string, inserted: boolean): void {
    (window.parent as Window).postMessage(
      {
        type: "text-edit-insert-result",
        nodeId: nodeId,
        inserted: inserted,
      },
      "*",
    );
  }
  function isTextEditElConnected(): boolean {
    return !!(
      activeTextEditEl &&
      activeTextEditEl.isConnected &&
      document.documentElement.contains(activeTextEditEl)
    );
  }
  function exitStaleTextEditSession(): boolean {
    if (!activeTextEditEl || isTextEditElConnected()) return false;
    var staleEl = activeTextEditEl;
    if (finishActiveTextEdit) {
      finishActiveTextEdit(true);
    } else {
      postTextEditingState(staleEl, false);
      activeTextEditEl = null;
      setTextEditingPointerPassthrough(false);
      setSelectionOverlayResizeChromeVisible(true);
    }
    if (activeTextEditEl === staleEl) {
      activeTextEditEl = null;
      setTextEditingPointerPassthrough(false);
      setSelectionOverlayResizeChromeVisible(true);
    }
    return true;
  }
  var pendingStructureMoves: Record<
    string,
    {
      requestId: string;
      el: Element;
      target: { anchor: Element; placement: string; axis?: string } | null;
      origin:
        | {
            prevParent: Element;
            prevNextSibling: Node | null;
            prevInlinePositionStyles?: Record<string, string> | null;
            prevInlineGridStyles?: Array<{
              property: string;
              value: string;
              priority: string;
            }> | null;
            gridDisplacements?: Array<{
              element: Element;
              styles: Array<{
                property: string;
                value: string;
                priority: string;
              }>;
            }>;
          }
        // A host-driven insert has no previous position to restore: the
        // element did not exist before this request, so a rejected/undone
        // round-trip must REMOVE it. Restoring a prevParent it never had is
        // what would leave an orphan node behind after Cmd+Z.
        | { inserted: true; fallbackSelection?: Element }
        | {
            replaced: true;
            originalElement: Element;
            prevParent: Element;
            prevNextSibling: Node | null;
          }
        // A host-driven delete. The DETACHED element is kept alive here so an
        // undone deletion re-attaches the real node — with its live React
        // state, listeners and children — instead of re-parsing a sanitized
        // snapshot of what it used to look like.
        | {
            removed: true;
            prevParent: Element;
            prevNextSibling: Node | null;
          }
        | null;
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
  var hoveredSpacingHandleKey = "";
  var spacingHoverClearTimer: ReturnType<typeof setTimeout> | null = null;
  var lastSpacingPointerPoint: { x: number; y: number } | null = null;
  var spacingHandleStateByKey: Record<string, { value: number }> = {};
  var spacingHandleNodesByKey: Record<string, Element> = {};
  var spacingHatchNodesByKey: Record<string, Element> = {};
  var spacingOverlayRenderKey = "";
  var activeDragCancel: (() => boolean) | null = null;
  var activeDragStartedAt: number | null = null;
  var editorDragIdCounter = 0;
  var activeEditorDragId = "";
  var bridgeSpaceKeyPressed = false;
  var bridgeIgnoreAutoLayoutKeyPressed = false;
  var hostIgnoreAutoLayoutAtPointerDown = false;
  var bridgeSpaceKeyConsumedByDrag = false;

  function resetBridgeDragModifierStateOnCancel(): void {
    bridgeSpaceKeyPressed = false;
    bridgeSpaceKeyConsumedByDrag = false;
    hostIgnoreAutoLayoutAtPointerDown = false;
  }
  var activeCrossScreenStyleSnapshot: unknown | undefined = undefined;
  var activeCrossScreenSourceHtml: string | undefined = undefined;
  var activeCrossScreenComputedSize:
    | { width?: number; height?: number }
    | undefined;
  var activeCrossScreenDeleteRequestId: string | undefined = undefined;
  var activeCrossScreenDragIdentity: {
    selector: string;
    sourceId: string;
    sourceProvenance?: { versionHash?: string; uniqueNodeId?: string };
  } | null = null;
  var spacingDrag: {
    handle: { key: string; groupKey: string; kind: string };
    currentValue: number;
    mirrorOpposite: boolean;
    syncAllSides: boolean;
  } | null = null;
  var lockedSelectors: string[] = [];
  var hiddenSelectors: string[] = [];
  var lastEditorPointWasBlocked = false;

  function clearRuntimeSelection(): void {
    window.getSelection?.()?.removeAllRanges();
    selectedEl = null;
    selectionContainerScope = null;
    clearHoverGate();
    setPassiveSelectionElements([]);
    clearSpacingHoverTimer();
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

  function postEditorDragState(
    active: boolean,
    preview?: {
      phase: "preview" | "clear";
      sourceId?: string;
      anchorId?: string;
      placement?: "before" | "after" | "inside";
      insert?: boolean;
    },
  ): void {
    (window.parent as Window).postMessage(
      {
        type: "agent-native:editor-drag-state",
        active,
        screenId: designCanvasScreenId,
        dragId: activeEditorDragId || undefined,
        eventAt:
          typeof performance !== "undefined" &&
          typeof performance.timeOrigin === "number" &&
          typeof performance.now === "function"
            ? performance.timeOrigin + performance.now()
            : Date.now(),
        preview,
      },
      "*",
    );
  }

  function postLayerStructurePreview(el, target): void {
    if (!target) {
      postEditorDragState(true, { phase: "clear" });
      return;
    }
    var anchor = target && (target.persistenceAnchor || target.anchor);
    var placement = target && (target.persistencePlacement || target.placement);
    var sourceId = getSourceId(el);
    var anchorId = getSourceId(anchor);
    if (
      !sourceId ||
      !anchorId ||
      (placement !== "before" &&
        placement !== "after" &&
        placement !== "inside")
    ) {
      postEditorDragState(true, { phase: "clear" });
      return;
    }
    postEditorDragState(true, {
      phase: "preview",
      sourceId,
      anchorId,
      placement,
      insert: true,
    });
  }

  function setActiveDragCancel(
    cancel: () => boolean,
    startedAt?: number,
  ): void {
    editorDragIdCounter += 1;
    activeEditorDragId =
      Date.now().toString(36) +
      "-" +
      editorDragIdCounter +
      "-" +
      Math.random().toString(36).slice(2);
    activeDragCancel = cancel;
    activeDragStartedAt =
      typeof startedAt === "number" ? startedAt : Date.now();
    postEditorDragState(true);
  }

  function clearActiveDragCancel(cancel?: () => boolean): void {
    if (cancel && activeDragCancel !== cancel) return;
    if (!activeDragCancel) return;
    activeDragCancel = null;
    activeDragStartedAt = null;
    postEditorDragState(false);
    activeEditorDragId = "";
  }

  function cancelActiveBridgeDrag(): boolean {
    var cancel = activeDragCancel;
    if (!cancel) return false;
    activeDragCancel = null;
    postEditorDragState(false);
    activeEditorDragId = "";
    return cancel();
  }

  var MOVE_CANCEL_RACE_GRACE_MS = 200;
  var dragGestureSequence = 0;
  var pendingMoveCommitRevert: {
    gestureId: number;
    releasedAt: number;
    revert: () => void;
  } | null = null;
  function armPostCommitCancelGrace(
    gestureId: number,
    releasedAt: number,
    revert: () => void,
  ): void {
    pendingMoveCommitRevert = {
      gestureId: gestureId,
      releasedAt: releasedAt,
      revert: revert,
    };
    window.setTimeout(function () {
      if (
        pendingMoveCommitRevert &&
        pendingMoveCommitRevert.gestureId === gestureId
      ) {
        pendingMoveCommitRevert = null;
      }
    }, MOVE_CANCEL_RACE_GRACE_MS);
  }

  function cancelActiveBridgeDragOrPendingCommit(pressedAt?: number): boolean {
    if (
      activeDragCancel &&
      (typeof pressedAt !== "number" ||
        activeDragStartedAt === null ||
        activeDragStartedAt <= pressedAt)
    ) {
      if (cancelActiveBridgeDrag()) return true;
    }
    if (
      pendingMoveCommitRevert &&
      typeof pressedAt === "number" &&
      pressedAt < pendingMoveCommitRevert.releasedAt
    ) {
      var pending = pendingMoveCommitRevert;
      pendingMoveCommitRevert = null;
      pending.revert();
      return true;
    }
    return false;
  }

  function removePassiveSelectionOverlays(): void {
    passiveSelectionOverlays.forEach(function (overlay) {
      removeEditorChromeNode(overlay);
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
        "position:absolute;z-index:1;width:7px;height:7px;border:1px solid var(--design-editor-accent-color);background:var(--design-editor-accent-contrast-color);box-sizing:border-box;border-radius:0;pointer-events:auto;cursor:" +
        (pos === "nw" || pos === "se" ? "nwse-resize" : "nesw-resize") +
        ";";
      if (pos.indexOf("n") !== -1) handle.style.top = "-4px";
      if (pos.indexOf("s") !== -1) handle.style.bottom = "-4px";
      if (pos.indexOf("w") !== -1) handle.style.left = "-4px";
      if (pos.indexOf("e") !== -1) handle.style.right = "-4px";
      overlay.appendChild(handle);
    });
    scalePassiveSelectionOverlay(overlay);
  }

  function makeRepeatInstanceOverlay(): HTMLElement {
    var overlay = document.createElement("div");
    overlay.setAttribute("data-agent-native-edit-overlay", "repeat-instance");
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:99995;border:1px dashed color-mix(in srgb,var(--design-editor-accent-color) 70%,transparent);background:transparent;display:none;box-sizing:border-box;";
    appendEditorChromeNode(overlay);
    return overlay;
  }

  function removeRepeatInstanceOverlays(): void {
    repeatInstanceOverlays.forEach(function (overlay) {
      removeEditorChromeNode(overlay);
    });
    repeatInstanceOverlays = [];
    repeatInstanceAnchor = null;
  }

  function paintRepeatInstances(el: Element | null): void {
    var info = el ? repeatInstanceInfo(el) : null;
    if (!info || info.instanceCount < 2) {
      if (repeatInstanceOverlays.length) removeRepeatInstanceOverlays();
      return;
    }
    var siblings = repeatStyleTargets(el).filter(function (instance) {
      return instance !== el && !isLayerInteractionBlocked(instance);
    });
    if (
      repeatInstanceAnchor !== el ||
      repeatInstanceOverlays.length !== siblings.length
    ) {
      removeRepeatInstanceOverlays();
      for (var made = 0; made < siblings.length; made += 1) {
        repeatInstanceOverlays.push(makeRepeatInstanceOverlay());
      }
      repeatInstanceAnchor = el;
    }
    var line = chromeLineScale();
    siblings.forEach(function (instance, index) {
      var overlay = repeatInstanceOverlays[index]!;
      overlay.style.borderWidth = line + "px";
      positionOverlay(overlay, instance);
    });
  }

  function makePassiveSelectionOverlay(style: "default" | "soft"): HTMLElement {
    var overlay = document.createElement("div");
    overlay.setAttribute("data-agent-native-edit-overlay", "multi-selection");
    if (style === "soft") {
      overlay.setAttribute("data-agent-native-soft-chrome", "true");
    }
    overlay.style.cssText =
      style === "soft"
        ? "position:fixed;pointer-events:none;z-index:99996;border:1px solid color-mix(in srgb,var(--design-editor-accent-color) 64%,transparent);background:color-mix(in srgb,var(--design-editor-accent-color) 5%,transparent);display:none;box-sizing:border-box;"
        : "position:fixed;pointer-events:none;z-index:99996;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;";
    appendEditorChromeNode(overlay);
    return overlay;
  }

  function scalePassiveSelectionOverlay(overlay: HTMLElement): void {
    var sx = chromeScaleX();
    var sy = chromeScaleY();
    var line = chromeLineScale();
    var softChrome =
      overlay.getAttribute("data-agent-native-soft-chrome") === "true";
    overlay.style.borderWidth = (softChrome ? 1 : 1.5) * line + "px";
    overlay
      .querySelectorAll(
        "[data-agent-native-edit-overlay='multi-selection-handle']",
      )
      .forEach(function (handle) {
        var pos = handle.getAttribute("data-corner") || "";
        handle.style.pointerEvents = readOnly ? "none" : "auto";
        handle.style.width = 7 * sx + "px";
        handle.style.height = 7 * sy + "px";
        handle.style.borderWidth = 1 * line + "px";
        if (pos.indexOf("n") !== -1) handle.style.top = -4 * sy + "px";
        if (pos.indexOf("s") !== -1) handle.style.bottom = -4 * sy + "px";
        if (pos.indexOf("w") !== -1) handle.style.left = -4 * sx + "px";
        if (pos.indexOf("e") !== -1) handle.style.right = -4 * sx + "px";
      });
  }

  var passiveSelectionOverlayPoolStyle: "default" | "soft" = "default";
  function syncPassiveSelectionOverlayPool(
    count: number,
    style: "default" | "soft",
  ): void {
    if (style !== passiveSelectionOverlayPoolStyle) {
      removePassiveSelectionOverlays();
      passiveSelectionOverlayPoolStyle = style;
    }
    while (passiveSelectionOverlays.length > count) {
      var extra = passiveSelectionOverlays.pop();
      if (extra) removeEditorChromeNode(extra);
    }
    while (passiveSelectionOverlays.length < count) {
      passiveSelectionOverlays.push(makePassiveSelectionOverlay(style));
    }
  }

  function samePassiveSelectionElements(
    current: Element[],
    next: Element[],
  ): boolean {
    if (current.length !== next.length) return false;
    for (var index = 0; index < current.length; index += 1) {
      if (current[index] !== next[index]) return false;
    }
    return true;
  }

  function setPassiveSelectionElements(
    elements: Element[],
    style: "default" | "soft" = "default",
  ): void {
    var nextPassiveEls = elements.filter(function (el, index, all) {
      return (
        el &&
        el !== selectedEl &&
        document.documentElement.contains(el) &&
        all.indexOf(el) === index
      );
    });
    if (
      style === passiveSelectionOverlayPoolStyle &&
      passiveSelectionOverlays.length === nextPassiveEls.length &&
      samePassiveSelectionElements(passiveSelectionEls, nextPassiveEls)
    ) {
      passiveSelectionEls = nextPassiveEls;
      positionMultiSelectionBounds();
      return;
    }
    passiveSelectionEls = nextPassiveEls;
    syncPassiveSelectionOverlayPool(passiveSelectionEls.length, style);
    passiveSelectionEls.forEach(function (el, index) {
      var overlay = passiveSelectionOverlays[index];
      if (overlay) positionOverlay(overlay, el);
    });
    positionMultiSelectionBounds();
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

  function resolveShiftClickToggleOff(
    target: Element | null,
    e?: MouseEvent,
  ): Element | null | undefined {
    if (!e?.shiftKey || !target) return undefined;
    if (target === selectedEl) {
      var promoted = passiveSelectionEls[0] || null;
      setPassiveSelectionElements(passiveSelectionEls.slice(1));
      selectedEl = promoted;
      return promoted;
    }
    if (passiveSelectionEls.indexOf(target) !== -1) {
      setPassiveSelectionElements(
        passiveSelectionEls.filter(function (el) {
          return el !== target;
        }),
      );
      return selectedEl;
    }
    return undefined;
  }

  function postToggledSelection(toggledPrimary: Element | null): void {
    var survivors = (
      toggledPrimary ? [toggledPrimary] : ([] as Element[])
    ).concat(passiveSelectionEls);
    if (toggledPrimary) {
      positionOverlay(selectionOverlay, toggledPrimary);
    } else {
      hideSelectionOverlay();
    }
    if (survivors.length > 0) {
      postElementMarqueeSelect(survivors, false, undefined);
    } else {
      (window.parent as Window).postMessage({ type: "clear-selection" }, "*");
    }
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

  function applyLayerStateSelectors(): void {
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
    document
      .querySelectorAll("[data-agent-native-runtime-locked]")
      .forEach(function (el) {
        el.removeAttribute("data-agent-native-runtime-locked");
      });
    lockedSelectors.forEach(function (selector) {
      try {
        document.querySelectorAll(selector).forEach(function (el) {
          el.setAttribute("data-agent-native-runtime-locked", "true");
        });
      } catch (_err) {}
    });
  }

  interface MorphContext {
    keyed: Map<string, Element>;
    nextKeys: Set<string>;
    obsolete: Set<string>;
    repeatCloneTargets?: Map<Element, Element[]>;
    repeatCloneBaselines?: Map<Element, SourceMeta>;
  }

  /**
   * What the SOURCE document declared for one element, as of the last time the
   * source was applied to it.
   *
   * The morph needs this because the live DOM is authored by two writers: the
   * design source, and whatever runtime the prototype loads (Alpine above all).
   * Only the source's own contributions may be reconciled away — an x-show
   * `display:none`, an `:class` token or an x-for clone has no counterpart in
   * source and must survive an unrelated edit. Inferring that from directive
   * names cannot work: it misses plugins, and it cannot tell an authored class
   * the user just deleted from a class Alpine computed.
   */
  interface SourceMeta {
    attrs: string[];
    className: string;
    style: string;
  }

  function sourceMetaFor(element: Element): SourceMeta | undefined {
    return (element as Element & { __anSourceMeta?: SourceMeta })
      .__anSourceMeta;
  }

  function isSourceOwned(node: Node): boolean {
    return (node as Node & { __anSource?: boolean }).__anSource === true;
  }

  function recordSourceOwnership(node: Node): void {
    (node as Node & { __anSource?: boolean }).__anSource = true;
    if (node.nodeType !== 1) return;
    var element = node as Element;
    var names: string[] = [];
    for (var i = 0; i < element.attributes.length; i += 1) {
      names.push(element.attributes[i]!.name);
    }
    (element as Element & { __anSourceMeta?: SourceMeta }).__anSourceMeta = {
      attrs: names,
      className: element.getAttribute("class") ?? "",
      style: element.getAttribute("style") ?? "",
    };
  }

  function claimContentAsSource(el: Element | null): void {
    if (!el) return;
    var children = el.childNodes;
    for (var i = 0; i < children.length; i += 1) {
      recordSourceSubtree(children[i]!);
    }
  }

  function recordSourceSubtree(root: Node): void {
    if (
      root.nodeType === 1 &&
      (root as Element).hasAttribute("data-agent-native-edit-overlay")
    ) {
      return;
    }
    if (root.nodeType === 1 && isTemplateCloneElement(root as Element)) return;
    recordSourceOwnership(root);
    if (root.nodeType !== 1) return;
    var template = templateContentOf(root as Element);
    if (template) {
      var held = template.childNodes;
      for (var t = 0; t < held.length; t += 1) recordSourceSubtree(held[t]!);
      return;
    }
    var children = (root as Element).childNodes;
    for (var i = 0; i < children.length; i += 1) {
      recordSourceSubtree(children[i]!);
    }
  }

  function templateContentOf(element: Element): DocumentFragment | null {
    if (element.nodeName !== "TEMPLATE") return null;
    return (element as HTMLTemplateElement).content ?? null;
  }

  function findSourceNodeForSelector(
    root: Document | DocumentFragment | Element,
    selector: string,
  ): { node: Element | null; inTemplate: boolean } {
    var direct = root.querySelector(selector);
    if (direct) return { node: direct, inTemplate: false };
    var templates = root.querySelectorAll("template");
    for (var i = 0; i < templates.length; i += 1) {
      var content = templateContentOf(templates[i]!);
      if (!content) continue;
      var nested = findSourceNodeForSelector(content, selector);
      if (nested.node) return { node: nested.node, inTemplate: true };
    }
    return { node: null, inTemplate: false };
  }

  function scopedMorphContext(
    liveRoot: ParentNode,
    nextRoot: ParentNode,
  ): MorphContext {
    var keyed = new Map<string, Element>();
    liveRoot.querySelectorAll("[data-agent-native-node-id]").forEach(function (
      element: Element,
    ) {
      if (!isSourceOwned(element)) return;
      var key = element.getAttribute("data-agent-native-node-id");
      if (key && !keyed.has(key)) keyed.set(key, element);
    });
    var nextKeys = new Set<string>();
    nextRoot.querySelectorAll("[data-agent-native-node-id]").forEach(function (
      element: Element,
    ) {
      var key = element.getAttribute("data-agent-native-node-id");
      if (key) nextKeys.add(key);
    });
    return { keyed: keyed, nextKeys: nextKeys, obsolete: new Set<string>() };
  }

  function captureInitialSourceOwnership(): void {
    if (document.body) recordSourceSubtree(document.body);
  }

  function classTokens(value: string): string[] {
    return value.split(/\s+/).filter(function (token) {
      return token.length > 0;
    });
  }

  function applyClassAttribute(
    live: Element,
    previousSource: string,
    nextSource: string,
  ): void {
    var previous = classTokens(previousSource);
    var current = classTokens(live.getAttribute("class") ?? "");
    var result = classTokens(nextSource);
    for (var i = 0; i < current.length; i += 1) {
      var token = current[i]!;
      if (previous.indexOf(token) !== -1) continue;
      if (result.indexOf(token) === -1) result.push(token);
    }
    var value = result.join(" ");
    if ((live.getAttribute("class") ?? "") === value) return;
    if (value) live.setAttribute("class", value);
    else live.removeAttribute("class");
  }

  var styleProbe: HTMLElement | null = null;

  function styleDeclarations(value: string): Array<[string, string, string]> {
    var probe = styleProbe || (styleProbe = document.createElement("div"));
    probe.style.cssText = value || "";
    var out: Array<[string, string, string]> = [];
    for (var i = 0; i < probe.style.length; i += 1) {
      var property = probe.style.item(i);
      out.push([
        property,
        probe.style.getPropertyValue(property),
        probe.style.getPropertyPriority(property),
      ]);
    }
    return out;
  }

  function applyStyleAttribute(
    live: Element,
    previousSource: string,
    nextSource: string,
  ): void {
    var previousOwned: Record<string, string> = {};
    styleDeclarations(previousSource).forEach(function (entry) {
      previousOwned[entry[0]] = entry[1];
    });
    var nextDeclarations = styleDeclarations(nextSource);
    var nextOwned: Record<string, true> = {};
    nextDeclarations.forEach(function (entry) {
      nextOwned[entry[0]] = true;
    });
    var target = document.createElement("div");
    target.style.cssText = live.getAttribute("style") ?? "";
    nextDeclarations.forEach(function (entry) {
      var wasSource = Object.prototype.hasOwnProperty.call(
        previousOwned,
        entry[0],
      );
      if (wasSource && previousOwned[entry[0]] === entry[1]) return;
      target.style.setProperty(entry[0], entry[1], entry[2]);
    });
    styleDeclarations(live.getAttribute("style") ?? "").forEach(
      function (entry) {
        if (nextOwned[entry[0]]) return;
        var wasSource = Object.prototype.hasOwnProperty.call(
          previousOwned,
          entry[0],
        );
        if (wasSource && previousOwned[entry[0]] === entry[1]) {
          target.style.removeProperty(entry[0]);
        }
      },
    );
    var value = target.style.cssText;
    if ((live.getAttribute("style") ?? "") === value) return;
    if (value) live.setAttribute("style", value);
    else live.removeAttribute("style");
  }

  function morphFormState(live: Element, next: Element): void {
    if (live.nodeName === "INPUT") {
      var input = live as HTMLInputElement;
      var nextChecked = next.hasAttribute("checked");
      if (input.defaultChecked !== nextChecked) {
        input.defaultChecked = nextChecked;
        input.checked = nextChecked;
      }
      var nextValue = next.getAttribute("value");
      if (nextValue !== null && input.defaultValue !== nextValue) {
        input.defaultValue = nextValue;
        input.value = nextValue;
      }
      return;
    }
    if (live.nodeName === "TEXTAREA") {
      var area = live as HTMLTextAreaElement;
      var nextText = next.textContent ?? "";
      if (area.defaultValue !== nextText) {
        area.defaultValue = nextText;
        area.value = nextText;
      }
      return;
    }
    if (live.nodeName === "OPTION") {
      var option = live as HTMLOptionElement;
      var nextSelected = next.hasAttribute("selected");
      if (option.defaultSelected !== nextSelected) {
        option.defaultSelected = nextSelected;
        option.selected = nextSelected;
      }
    }
  }

  function declaresRuntimeChildren(element: Element): boolean {
    return (
      element.hasAttribute("x-text") ||
      element.hasAttribute("x-html") ||
      element.hasAttribute("v-text") ||
      element.hasAttribute("v-html")
    );
  }

  function scopeDirectiveChanged(live: Element, next: Element): boolean {
    return (
      (live.getAttribute("x-data") ?? "") !==
      (next.getAttribute("x-data") ?? "")
    );
  }

  function morphNodeKey(node: Node): string | null {
    if (node.nodeType !== 1) return null;
    return (node as Element).getAttribute("data-agent-native-node-id");
  }

  function snapshotRepeatCloneTargets(
    template: HTMLTemplateElement,
    nextTemplate: HTMLTemplateElement,
  ): { targets: Map<Element, Element[]>; baselines: Map<Element, SourceMeta> } {
    var targets = new Map<Element, Element[]>();
    var baselines = new Map<Element, SourceMeta>();
    var parent = template.parentElement;
    var sourceRoot = template.content.firstElementChild;
    var nextRoot = nextTemplate.content.firstElementChild;
    if (!parent || !sourceRoot || !nextRoot)
      return { targets: targets, baselines: baselines };

    var templates: Element[] = [];
    for (var i = 0; i < parent.children.length; i += 1) {
      var child = parent.children[i]!;
      if (child.tagName === "TEMPLATE" && child.hasAttribute("x-for"))
        templates.push(child);
    }

    function nestedClone(node: Element, row: Element | null): boolean {
      var current: Element | null = node;
      while (row && current && current !== row) {
        var ancestor = current.parentElement;
        if (!ancestor) return false;
        for (var i = 0; i < ancestor.children.length; i += 1) {
          var candidate = ancestor.children[i]!;
          if (
            candidate.tagName === "TEMPLATE" &&
            candidate.hasAttribute("x-for") &&
            rowKeyFor(candidate, current) !== ""
          )
            return true;
        }
        current = ancestor;
      }
      return false;
    }

    function children(node: Element, row: Element | null): Element[] {
      var result: Element[] = [];
      for (var i = 0; i < node.children.length; i += 1) {
        var child = node.children[i]!;
        if (!nestedClone(child, row)) result.push(child);
      }
      return result;
    }

    function sameShape(left: Element, right: Element, clone: boolean): boolean {
      if (left.tagName !== right.tagName) return false;
      function ignored(name: string): boolean {
        return (
          name === "class" ||
          name === "style" ||
          name === "data-agent-native-node-id" ||
          name === "x-cloak"
        );
      }
      for (var i = 0; i < left.attributes.length; i += 1) {
        var attr = left.attributes[i]!;
        if (!ignored(attr.name) && right.getAttribute(attr.name) !== attr.value)
          return false;
      }
      for (var i = 0; i < right.attributes.length; i += 1) {
        var attr = right.attributes[i]!;
        if (!ignored(attr.name) && left.getAttribute(attr.name) !== attr.value)
          return false;
      }
      var leftClasses = Array.from(left.classList);
      var rightClasses = Array.from(right.classList);
      return clone
        ? leftClasses.every(function (name) {
            return rightClasses.indexOf(name) !== -1;
          })
        : leftClasses.length === rightClasses.length &&
            leftClasses.every(function (name) {
              return rightClasses.indexOf(name) !== -1;
            });
    }

    function walkPairs(
      leftRoot: Element,
      rightRoot: Element,
      row: Element | null,
      onPair: (left: Element, right: Element) => void,
    ): void {
      function visit(left: Element, right: Element): void {
        if (left.tagName !== right.tagName) return;
        onPair(left, right);
        if (
          left.tagName === "TEMPLATE" ||
          left.hasAttribute("x-for") ||
          declaresRuntimeChildren(left)
        )
          return;
        var leftChildren = children(left, null);
        var rightChildren = children(right, row);
        var used = new Set<Element>();
        for (var i = 0; i < leftChildren.length; i += 1) {
          var source = leftChildren[i]!;
          var id = source.getAttribute("data-agent-native-node-id");
          var idTargets = id
            ? rightChildren.filter(function (candidate) {
                return (
                  candidate.getAttribute("data-agent-native-node-id") === id
                );
              })
            : [];
          var target: Element | null =
            idTargets.length === 1 &&
            leftChildren.filter(function (candidate) {
              return candidate.getAttribute("data-agent-native-node-id") === id;
            }).length === 1
              ? idTargets[0]!
              : null;
          if (!target) {
            // ponytail: unkeyed clones need unique unchanged markup; source IDs are required for dynamic reshaping.
            var leftMatches = leftChildren.filter(function (candidate) {
              return sameShape(source, candidate, false);
            });
            var rightMatches = rightChildren.filter(function (candidate) {
              return (
                !used.has(candidate) &&
                sameShape(source, candidate, row !== null)
              );
            });
            if (leftMatches.length === 1 && rightMatches.length === 1)
              target = rightMatches[0]!;
          }
          if (!target || used.has(target)) continue;
          used.add(target);
          visit(source, target);
        }
      }
      visit(leftRoot, rightRoot);
    }

    var rows: Element[] = [];
    for (var i = 0; i < parent.children.length; i += 1) {
      var row = parent.children[i]!;
      if (row === template || isSourceOwned(row)) continue;
      var owners = templates.filter(function (candidate) {
        return rowKeyFor(candidate, row) !== "";
      });
      if (owners.length === 1 && owners[0] === template) rows.push(row);
    }

    rows.forEach(function (row) {
      walkPairs(sourceRoot, row, row, function (source, clone) {
        var matches = targets.get(source);
        if (matches) matches.push(clone);
        else targets.set(source, [clone]);
      });
    });
    walkPairs(sourceRoot, nextRoot, null, function (source, next) {
      var matches = targets.get(source);
      var baseline = sourceMetaFor(source);
      if (matches && baseline) {
        targets.set(next, matches);
        baselines.set(next, baseline);
      }
    });
    return { targets: targets, baselines: baselines };
  }

  function replayRepeatTemplatePaint(
    next: Element,
    previous: SourceMeta,
    targets: Element[],
  ): void {
    var nextClass = next.getAttribute("class") ?? "";
    if (previous.className !== nextClass) {
      targets.forEach(function (target) {
        applyClassAttribute(target, previous.className, nextClass);
      });
    }
    var nextStyle = next.getAttribute("style") ?? "";
    if (previous.style !== nextStyle) {
      targets.forEach(function (target) {
        applyStyleAttribute(target, previous.style, nextStyle);
      });
    }
  }

  function morphAttributes(live: Element, next: Element): void {
    var meta = sourceMetaFor(live);
    var previousAttrs = meta ? meta.attrs : [];
    var previousClass = meta ? meta.className : "";
    var previousStyle = meta ? meta.style : "";
    var nextNames: string[] = [];

    var nextAttrs = next.attributes;
    for (var i = 0; i < nextAttrs.length; i += 1) {
      var attr = nextAttrs[i]!;
      nextNames.push(attr.name);
      if (attr.name === "class") {
        applyClassAttribute(live, previousClass, attr.value);
        continue;
      }
      if (attr.name === "style") {
        applyStyleAttribute(live, previousStyle, attr.value);
        continue;
      }
      if (attr.name === "x-cloak" && !live.hasAttribute("x-cloak")) continue;
      if (live.getAttribute(attr.name) === attr.value) continue;
      if (attr.namespaceURI) {
        live.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      } else {
        live.setAttribute(attr.name, attr.value);
      }
    }

    for (var j = 0; j < previousAttrs.length; j += 1) {
      var name = previousAttrs[j]!;
      if (nextNames.indexOf(name) !== -1) continue;
      if (name === "class") {
        applyClassAttribute(live, previousClass, "");
        continue;
      }
      if (name === "style") {
        applyStyleAttribute(live, previousStyle, "");
        continue;
      }
      live.removeAttribute(name);
    }

    (live as Element & { __anSourceMeta?: SourceMeta }).__anSourceMeta = {
      attrs: nextNames,
      className: next.getAttribute("class") ?? "",
      style: next.getAttribute("style") ?? "",
    };
  }

  function nextSourceAnchor(node: Node | null): Node | null {
    var probe = node;
    while (probe && !isSourceOwned(probe)) probe = probe.nextSibling;
    return probe;
  }

  function morphChildren(
    live: Element | DocumentFragment,
    next: Element | DocumentFragment,
    context: MorphContext,
  ): void {
    var cursor = live.firstChild;
    var nextChild = next.firstChild;
    while (nextChild) {
      var key = morphNodeKey(nextChild);
      var reuse: Node | null = null;
      if (key) {
        var candidate = context.keyed.get(key) ?? null;
        if (
          candidate &&
          !candidate.contains(live) &&
          candidate.nodeName === nextChild.nodeName &&
          candidate.namespaceURI === (nextChild as Element).namespaceURI
        ) {
          reuse = candidate;
          context.keyed.delete(key);
        } else if (candidate) {
          context.obsolete.add(key);
        }
      } else {
        var probe: Node | null = cursor;
        while (probe) {
          var probeKey = morphNodeKey(probe);
          if (probeKey) {
            if (
              context.nextKeys.has(probeKey) &&
              !context.obsolete.has(probeKey)
            ) {
              break;
            }
            probe = probe.nextSibling;
            continue;
          }
          if (!isSourceOwned(probe)) {
            probe = probe.nextSibling;
            continue;
          }
          if (
            probe.nodeType === nextChild.nodeType &&
            probe.nodeName === nextChild.nodeName
          ) {
            reuse = probe;
          }
          break;
        }
      }
      if (
        reuse &&
        reuse.nodeType === 1 &&
        scopeDirectiveChanged(reuse as Element, nextChild as Element)
      ) {
        var rebuilt = document.importNode(nextChild as Element, true);
        live.insertBefore(rebuilt, nextSourceAnchor(cursor));
        if (reuse.parentNode) reuse.parentNode.removeChild(reuse);
        recordSourceSubtree(rebuilt);
        cursor = rebuilt.nextSibling;
        nextChild = nextChild.nextSibling;
        continue;
      }
      if (reuse) {
        var reuseAnchor = nextSourceAnchor(cursor);
        if (reuse !== reuseAnchor) live.insertBefore(reuse, reuseAnchor);
        if (reuse.nodeType === 1) {
          morphElement(reuse as Element, nextChild as Element, context);
        } else if (reuse.nodeValue !== nextChild.nodeValue) {
          reuse.nodeValue = nextChild.nodeValue;
        }
        cursor = reuse.nextSibling;
      } else if (nextChild.nodeType === 1) {
        var shell = document.importNode(nextChild as Element, false) as Element;
        live.insertBefore(shell, nextSourceAnchor(cursor));
        recordSourceOwnership(shell);
        morphElement(shell, nextChild as Element, context);
        cursor = shell.nextSibling;
      } else {
        var imported = document.importNode(nextChild, true);
        live.insertBefore(imported, cursor);
        recordSourceSubtree(imported);
      }
      nextChild = nextChild.nextSibling;
    }
    while (cursor) {
      var stale = cursor;
      cursor = cursor.nextSibling;
      if (stale.parentNode !== live) continue;
      if (!isSourceOwned(stale)) continue;
      live.removeChild(stale);
    }
  }

  function morphElement(
    live: Element,
    next: Element,
    context: MorphContext,
  ): void {
    morphFormState(live, next);
    var previousSource = sourceMetaFor(live);
    morphAttributes(live, next);
    if (context.repeatCloneTargets) {
      var repeatTargets = context.repeatCloneTargets.get(live);
      var repeatBaseline = previousSource;
      if (repeatTargets === undefined) {
        repeatTargets = context.repeatCloneTargets.get(next);
        repeatBaseline = context.repeatCloneBaselines?.get(next);
      }
      if (repeatTargets && repeatBaseline) {
        replayRepeatTemplatePaint(next, repeatBaseline, repeatTargets);
      }
    }
    if (declaresRuntimeChildren(next) || declaresRuntimeChildren(live)) return;
    var liveTemplate = templateContentOf(live);
    var nextTemplate = templateContentOf(next);
    if (liveTemplate && nextTemplate) {
      var templateContext = scopedMorphContext(liveTemplate, nextTemplate);
      var repeatCloneSnapshot = snapshotRepeatCloneTargets(
        live as HTMLTemplateElement,
        next as HTMLTemplateElement,
      );
      templateContext.repeatCloneTargets = repeatCloneSnapshot.targets;
      templateContext.repeatCloneBaselines = repeatCloneSnapshot.baselines;
      morphChildren(liveTemplate, nextTemplate, templateContext);
      return;
    }
    morphChildren(live, next, context);
  }

  function morphRuntimeBody(nextBody: Element): void {
    var keyed = new Map<string, Element>();
    document.querySelectorAll("[data-agent-native-node-id]").forEach(function (
      element: Element,
    ) {
      if (!isSourceOwned(element)) return;
      var key = element.getAttribute("data-agent-native-node-id");
      if (key && !keyed.has(key)) keyed.set(key, element);
    });
    var nextKeys = new Set<string>();
    nextBody.querySelectorAll("[data-agent-native-node-id]").forEach(function (
      element: Element,
    ) {
      var key = element.getAttribute("data-agent-native-node-id");
      if (key) nextKeys.add(key);
    });
    morphElement(document.body, nextBody, {
      keyed: keyed,
      nextKeys: nextKeys,
      obsolete: new Set<string>(),
    });
  }

  function replaceRuntimeDocument(
    html: string,
    preferredSelector: string,
    selectorCandidates: string[],
    forceFullDocument?: boolean,
    preserveTextEditingSession?: boolean,
    sourceProvenanceValue?: unknown,
  ): void {
    if (typeof html !== "string") return;
    var sourceProvenance = normalizeSourceDocumentProvenance(
      sourceProvenanceValue,
    );
    var hasSourceProvenance =
      sourceProvenanceValue !== undefined && sourceProvenanceValue !== null;
    var requiresFullDocumentMorph =
      Boolean(forceFullDocument) || hasSourceProvenance;
    exitStaleTextEditSession();
    var rangeStateBeforeMorph = suspendedTextEditRange;
    var rangeBookmarkBeforeMorph = rangeStateBeforeMorph
      ? captureTextRangeBookmark(
          rangeStateBeforeMorph.target,
          rangeStateBeforeMorph.range,
        )
      : null;
    var rangeTargetSelectorBeforeMorph = rangeStateBeforeMorph
      ? getSelector(rangeStateBeforeMorph.target)
      : "";
    if (
      activeTextEditEl &&
      (!forceFullDocument || preserveTextEditingSession)
    ) {
      pendingRuntimeDocumentUpdate = {
        html: html,
        preferredSelector: preferredSelector,
        selectorCandidates: Array.isArray(selectorCandidates)
          ? selectorCandidates
          : [],
        sourceProvenance: sourceProvenance,
      };
      applyLayerStateSelectors();
      refreshOverlays();
      return;
    }
    if (activeTextEditEl) {
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
    if (lastSourceHeadHtml === null) {
      replaceSourceHeadNodes(null, nextHeadHtml);
      lastSourceHeadHtml = nextHeadHtml;
    }
    var currentHeadHtml = lastSourceHeadHtml;
    if (
      !requiresFullDocumentMorph &&
      nextHeadHtml === currentHeadHtml &&
      activeCandidates.length > 0
    ) {
      var currentMatch = null;
      var nextMatch = null;
      var matchedSelector = "";
      var fallbackCurrentMatch = null;
      var fallbackSelector = "";
      var nextInTemplate = false;
      for (
        var matchIndex = 0;
        matchIndex < activeCandidates.length;
        matchIndex += 1
      ) {
        try {
          var currentCandidate = document.querySelector(
            activeCandidates[matchIndex],
          );
          var nextResolved = findSourceNodeForSelector(
            nextDoc,
            activeCandidates[matchIndex],
          );
          var nextCandidate = nextResolved.node;
          if (currentCandidate && !fallbackCurrentMatch) {
            fallbackCurrentMatch = currentCandidate;
            fallbackSelector = activeCandidates[matchIndex];
          }
          if (currentCandidate && nextCandidate) {
            currentMatch = currentCandidate;
            nextMatch = nextCandidate;
            nextInTemplate = nextResolved.inTemplate;
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
        !nextInTemplate &&
        currentMatch &&
        currentMatch !== document.body &&
        currentMatch !== document.documentElement &&
        !isOverlayElement(currentMatch) &&
        !suspendedTextEditRange
      ) {
        if (nextMatch) {
          if (
            isSourceOwned(currentMatch) &&
            currentMatch.nodeName === nextMatch.nodeName &&
            currentMatch.namespaceURI === nextMatch.namespaceURI &&
            !scopeDirectiveChanged(currentMatch, nextMatch)
          ) {
            morphElement(
              currentMatch,
              nextMatch,
              scopedMorphContext(currentMatch, nextMatch),
            );
          } else {
            var replacement = document.importNode(nextMatch, true);
            currentMatch.replaceWith(replacement);
            recordSourceSubtree(replacement);
          }
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
        hydrateVectorEndpointMarkers();
        applyLayerStateSelectors();
        selectedEl = null;
        if (nextMatch) {
          try {
            selectedEl = document.querySelector(matchedSelector);
          } catch (_err) {}
        }
        clearHoverGate();
        if (selectedEl && !isLayerInteractionBlocked(selectedEl)) {
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
        } else {
          hideSelectionOverlay();
        }
        highlightOverlay.style.display = "none";
        hideMeasurements();
        refreshOverlays();
        publishSourceDocumentProvenance(undefined, true);
        return;
      }
    }
    if (currentHeadHtml !== nextHeadHtml) {
      replaceSourceHeadNodes(currentHeadHtml, nextHeadHtml);
      ensureEditorChromeStyle();
      lastSourceHeadHtml = nextHeadHtml;
    }
    persistentNodes.forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    morphRuntimeBody(nextDoc.body);
    publishSourceDocumentProvenance(sourceProvenance);
    if (suspendedTextEditRange) {
      var suspendedRangeState = suspendedTextEditRange;
      var rangeTargetAfterMorph = suspendedRangeState.target.isConnected
        ? suspendedRangeState.target
        : rangeTargetSelectorBeforeMorph
          ? (findRuntimeTarget(rangeTargetSelectorBeforeMorph, [
              rangeTargetSelectorBeforeMorph,
            ]) as HTMLElement | null)
          : null;
      var restoredRange =
        rangeBookmarkBeforeMorph && rangeTargetAfterMorph
          ? restoreTextRangeBookmark(
              rangeTargetAfterMorph,
              rangeBookmarkBeforeMorph,
            )
          : null;
      if (restoredRange && rangeTargetAfterMorph) {
        suspendedRangeState.target = rangeTargetAfterMorph;
        suspendedRangeState.range = restoredRange;
        var selection = window.getSelection ? window.getSelection() : null;
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(restoredRange.cloneRange());
        }
      } else {
        clearSuspendedTextEditRange();
      }
    }
    persistentNodes.forEach(function (node) {
      appendEditorChromeNode(node);
    });
    hydrateVectorEndpointMarkers();
    applyLayerStateSelectors();
    frameLabelRenderKey = "";

    selectedEl = null;
    clearHoverGate();
    var reanchorCandidates = requiresFullDocumentMorph
      ? activeCandidates.filter(isStableIdentitySelector)
      : activeCandidates;
    for (var i = 0; i < reanchorCandidates.length && !selectedEl; i += 1) {
      try {
        var match = document.querySelector(reanchorCandidates[i]);
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
        cs.position === "fixed" ||
        cs.position === "absolute"
      )
        return false;
      var rect = child.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function gridTrackParticipants(el: Element | null): Element[] {
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
      return (
        cs.display !== "none" &&
        cs.position !== "fixed" &&
        cs.position !== "absolute"
      );
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

  function clampSpacingValue(value: number, allowNegative: boolean): number {
    var rounded = Math.round(value);
    if (!Number.isFinite(rounded)) return 0;
    return Math.max(allowNegative ? -999 : 0, Math.min(999, rounded));
  }

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

  function hitRectForMarginHandle(
    line: { x: number; y: number; width: number; height: number },
    tolerance: number,
    side: string,
    elementRect: { width: number; height: number },
  ): { x: number; y: number; width: number; height: number } {
    var hit = {
      x: line.x - tolerance,
      y: line.y - tolerance,
      width: line.width + tolerance * 2,
      height: line.height + tolerance * 2,
    };
    var inwardReach =
      side === "top" || side === "bottom"
        ? clampHandleInwardReach(Number.POSITIVE_INFINITY, elementRect.height)
        : clampHandleInwardReach(Number.POSITIVE_INFINITY, elementRect.width);
    if (side === "top") {
      var bottom = Math.min(hit.y + hit.height, inwardReach);
      hit.y = Math.min(hit.y, bottom - 1);
      hit.height = Math.max(1, bottom - hit.y);
    } else if (side === "bottom") {
      var originalBottom = hit.y + hit.height;
      var top = Math.max(hit.y, elementRect.height - inwardReach);
      hit.y = top;
      hit.height = Math.max(1, originalBottom - top);
    } else if (side === "left") {
      var right = Math.min(hit.x + hit.width, inwardReach);
      hit.x = Math.min(hit.x, right - 1);
      hit.width = Math.max(1, right - hit.x);
    } else if (side === "right") {
      var originalRight = hit.x + hit.width;
      var left = Math.max(hit.x, elementRect.width - inwardReach);
      hit.x = left;
      hit.width = Math.max(1, originalRight - left);
    }
    return hit;
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
    valueLabel?: string;
    elementRect?: { width: number; height: number };
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
        : config.kind === "margin"
          ? hitRectForMarginHandle(
              config.line,
              PADDING_HANDLE_HIT_TOLERANCE_BASE * chromeLineScale(),
              config.side || "",
              config.elementRect || { width: 0, height: 0 },
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
      value: clampSpacingValue(config.value, config.kind === "margin"),
      valueLabel: config.valueLabel || "",
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
    var line = chromeLineScale();
    var tickLength =
      Math.max(6, Math.min(18, Math.min(rect.width, rect.height) * 0.12)) *
      line;
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
            x: rect.width / 2 - tickLength / 2,
            y: innerTop + paddingTop / 2 - line / 2,
            width: tickLength,
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
            x: rect.width / 2 - tickLength / 2,
            y: rect.height - borderBottom - paddingBottom / 2 - line / 2,
            width: tickLength,
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
            y: rect.height / 2 - tickLength / 2,
            width: line,
            height: tickLength,
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
            y: rect.height / 2 - tickLength / 2,
            width: line,
            height: tickLength,
          },
        }),
      );
    }
    return handles.filter(Boolean);
  }

  function buildMarginSpacingHandles(
    el: Element,
    rect: DOMRect,
    cs: CSSStyleDeclaration,
  ): unknown[] {
    var line = chromeLineScale();
    var tickLength =
      Math.max(6, Math.min(18, Math.min(rect.width, rect.height) * 0.12)) *
      line;
    var marginHandleClearance = 6 * Math.max(1, line);
    var top = clampSpacingValue(readPx(cs.marginTop), true);
    var right = clampSpacingValue(readPx(cs.marginRight), true);
    var bottom = clampSpacingValue(readPx(cs.marginBottom), true);
    var left = clampSpacingValue(readPx(cs.marginLeft), true);

    return [
      makeSpacingHandle({
        key: "margin:top",
        kind: "margin",
        property: "marginTop",
        oppositeProperty: "marginBottom",
        side: "top",
        orientation: "horizontal",
        value: top,
        valueLabel: marginValueIsAuto(el, "top", cs.marginTop) ? "auto" : "",
        elementRect: rect,
        region: {
          x: 0,
          y: Math.min(0, -top),
          width: rect.width,
          height: Math.max(1, Math.abs(top)),
        },
        line: {
          x: rect.width / 2 - tickLength / 2,
          y:
            (top >= 0 ? -1 : 1) *
              Math.max(marginHandleClearance, Math.abs(top) / 2) -
            line / 2,
          width: tickLength,
          height: line,
        },
      }),
      makeSpacingHandle({
        key: "margin:right",
        kind: "margin",
        property: "marginRight",
        oppositeProperty: "marginLeft",
        side: "right",
        orientation: "vertical",
        value: right,
        valueLabel: marginValueIsAuto(el, "right", cs.marginRight)
          ? "auto"
          : "",
        elementRect: rect,
        region: {
          x: rect.width + Math.min(0, right),
          y: 0,
          width: Math.max(1, Math.abs(right)),
          height: rect.height,
        },
        line: {
          x:
            rect.width +
            (right >= 0 ? 1 : -1) *
              Math.max(marginHandleClearance, Math.abs(right) / 2) -
            line / 2,
          y: rect.height / 2 - tickLength / 2,
          width: line,
          height: tickLength,
        },
      }),
      makeSpacingHandle({
        key: "margin:bottom",
        kind: "margin",
        property: "marginBottom",
        oppositeProperty: "marginTop",
        side: "bottom",
        orientation: "horizontal",
        value: bottom,
        valueLabel: marginValueIsAuto(el, "bottom", cs.marginBottom)
          ? "auto"
          : "",
        elementRect: rect,
        region: {
          x: 0,
          y: rect.height + Math.min(0, bottom),
          width: rect.width,
          height: Math.max(1, Math.abs(bottom)),
        },
        line: {
          x: rect.width / 2 - tickLength / 2,
          y:
            rect.height +
            (bottom >= 0 ? 1 : -1) *
              Math.max(marginHandleClearance, Math.abs(bottom) / 2) -
            line / 2,
          width: tickLength,
          height: line,
        },
      }),
      makeSpacingHandle({
        key: "margin:left",
        kind: "margin",
        property: "marginLeft",
        oppositeProperty: "marginRight",
        side: "left",
        orientation: "vertical",
        value: left,
        valueLabel: marginValueIsAuto(el, "left", cs.marginLeft) ? "auto" : "",
        elementRect: rect,
        region: {
          x: Math.min(0, -left),
          y: 0,
          width: Math.max(1, Math.abs(left)),
          height: rect.height,
        },
        line: {
          x:
            (left >= 0 ? -1 : 1) *
              Math.max(marginHandleClearance, Math.abs(left) / 2) -
            line / 2,
          y: rect.height / 2 - tickLength / 2,
          width: line,
          height: tickLength,
        },
      }),
    ].filter(Boolean);
  }

  function buildGapSpacingHandles(
    el: Element,
    rect: DOMRect,
    cs: CSSStyleDeclaration,
  ): unknown[] {
    var children = visibleLayoutChildren(el);
    if (children.length < 2) return [];
    var handles = [];
    var line = chromeLineScale();
    var tickLength = 8 * line;
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
                y: top + height / 2 - tickLength / 2,
                width: line,
                height: tickLength,
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
                x: left + width / 2 - tickLength / 2,
                y: a.bottom + gap / 2 - line / 2,
                width: tickLength,
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
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    var cs = window.getComputedStyle(el);
    return buildPaddingSpacingHandles(el, rect, cs)
      .concat(buildMarginSpacingHandles(el, rect, cs))
      .concat(buildGapSpacingHandles(el, rect, cs));
  }

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
      valueLabel?: string;
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
    spacingBadge.textContent =
      handle.kind === "margin" &&
      handle.valueLabel === "auto" &&
      value === handle.value
        ? "auto"
        : String(clampSpacingValue(value, handle.kind === "margin")) + "px";
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
    lineNode.style.width = handle.line.width + "px";
    lineNode.style.height = handle.line.height + "px";
    lineNode.style.background = spacingColor(handle.kind);
    spacingOverlay.appendChild(lineNode);

    var hatchTile = 6 * chromeLineScale() + "px";
    if (handle.kind === "padding" || handle.kind === "margin") {
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
    regionNode.style.zIndex =
      handle.kind === "padding" ? "3" : handle.kind === "margin" ? "1" : "0";
    regionNode.style.backgroundSize = hatchTile + " " + hatchTile;
    regionNode.style.cursor =
      handle.orientation === "vertical" ? "ew-resize" : "ns-resize";
    var hitRect =
      handle.kind === "padding" || handle.kind === "margin"
        ? handle.hit
        : handle.region;
    regionNode.style.left = hitRect.x + "px";
    regionNode.style.top = hitRect.y + "px";
    regionNode.style.width = hitRect.width + "px";
    regionNode.style.height = hitRect.height + "px";
    regionNode.style.background =
      handle.kind !== "padding" && handle.kind !== "margin" && active
        ? spacingFill(handle.kind, handle.orientation)
        : "transparent";
    regionNode.style.outline =
      handle.kind !== "padding" && handle.kind !== "margin" && active
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
        var gapHighlighted =
          handle.kind !== "padding" && handle.kind !== "margin" && active;
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
      (activeHandle.kind === "padding" || activeHandle.kind === "margin") &&
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

  var HANDLE_MAX_INWARD_FRACTION = 0.25;

  function isAxisAlignedTransform(transform: string): boolean {
    if (!transform || transform === "none") return true;
    var matrixMatch = /^matrix\(([^)]+)\)$/.exec(transform);
    if (matrixMatch) {
      var matrixValues = matrixMatch[1]!.split(",").map(Number);
      return (
        matrixValues.length === 6 &&
        matrixValues.every(function (value) {
          return Number.isFinite(value);
        }) &&
        Math.abs(matrixValues[1]!) < 0.001 &&
        Math.abs(matrixValues[2]!) < 0.001
      );
    }
    var matrix3dMatch = /^matrix3d\(([^)]+)\)$/.exec(transform);
    if (!matrix3dMatch) return false;
    var matrix3dValues = matrix3dMatch[1]!.split(",").map(Number);
    return (
      matrix3dValues.length === 16 &&
      matrix3dValues.every(function (value) {
        return Number.isFinite(value);
      }) &&
      Math.abs(matrix3dValues[1]!) < 0.001 &&
      Math.abs(matrix3dValues[2]!) < 0.001 &&
      Math.abs(matrix3dValues[3]!) < 0.001 &&
      Math.abs(matrix3dValues[4]!) < 0.001 &&
      Math.abs(matrix3dValues[6]!) < 0.001 &&
      Math.abs(matrix3dValues[7]!) < 0.001 &&
      Math.abs(matrix3dValues[8]!) < 0.001 &&
      Math.abs(matrix3dValues[9]!) < 0.001 &&
      Math.abs(matrix3dValues[11]!) < 0.001 &&
      Math.abs(matrix3dValues[10]! - 1) < 0.001 &&
      Math.abs(matrix3dValues[15]! - 1) < 0.001
    );
  }

  function clampHandleInwardReach(nominalInward, elementDimension) {
    if (!Number.isFinite(elementDimension) || elementDimension <= 0) {
      return nominalInward;
    }
    return Math.min(
      nominalInward,
      elementDimension * HANDLE_MAX_INWARD_FRACTION,
    );
  }

  var lastHandleGeometryTargetEl: Element | null = null;

  var RADIUS_UNSUPPORTED_PRIMITIVES = {
    line: true,
    arrow: true,
    ellipse: true,
    circle: true,
    polygon: true,
    star: true,
    path: true,
    pen: true,
  };
  function supportsCornerRadiusHandles(el) {
    if (!el || el.nodeType !== 1) return false;
    var kind = (
      el.getAttribute("data-an-primitive") ||
      el.getAttribute("data-agent-native-primitive") ||
      ""
    ).toLowerCase();
    return !kind || !RADIUS_UNSUPPORTED_PRIMITIVES[kind];
  }

  function applySelectionHandleHitGeometry(el) {
    var isNewSelectionTarget = el !== lastHandleGeometryTargetEl;
    lastHandleGeometryTargetEl = el || null;
    if (isNewSelectionTarget) {
      selectionOverlay.setAttribute(
        "data-agent-native-suppress-handle-transition",
        "",
      );
    }
    var sx = chromeScaleX();
    var sy = chromeScaleY();
    var line = chromeLineScale();
    var elWidth = NaN;
    var elHeight = NaN;
    if (el && document.documentElement.contains(el)) {
      var elRect = el.getBoundingClientRect();
      elWidth = elRect.width;
      elHeight = elRect.height;
    }

    selectionOverlay
      .querySelectorAll("[data-agent-native-edge-handle]")
      .forEach(function (edge) {
        var pos = edge.getAttribute("data-agent-native-edge-handle");
        if (pos === "n" || pos === "s") {
          var outwardY = 5 * sy;
          var inwardY = clampHandleInwardReach(5 * sy, elHeight);
          edge.style.height = outwardY + inwardY + "px";
          edge.style[pos === "n" ? "top" : "bottom"] = -outwardY + "px";
        }
        if (pos === "e" || pos === "w") {
          var outwardX = 5 * sx;
          var inwardX = clampHandleInwardReach(5 * sx, elWidth);
          edge.style.width = outwardX + inwardX + "px";
          edge.style[pos === "w" ? "left" : "right"] = -outwardX + "px";
        }
      });

    selectionOverlay
      .querySelectorAll("[data-agent-native-edit-handle]")
      .forEach(function (handle) {
        var pos = handle.getAttribute("data-agent-native-edit-handle") || "";
        var sizeX = 7 * line;
        var sizeY = 7 * line;
        var inwardX = clampHandleInwardReach(sizeX - 4 * line, elWidth);
        var inwardY = clampHandleInwardReach(sizeY - 4 * line, elHeight);
        handle.style.width = sizeX + "px";
        handle.style.height = sizeY + "px";
        handle.style.borderWidth = 1 * line + "px";
        if (pos.indexOf("n") !== -1) {
          handle.style.top = inwardY - sizeY + "px";
        }
        if (pos.indexOf("s") !== -1) {
          handle.style.bottom = inwardY - sizeY + "px";
        }
        if (pos.indexOf("w") !== -1) {
          handle.style.left = inwardX - sizeX + "px";
        }
        if (pos.indexOf("e") !== -1) {
          handle.style.right = inwardX - sizeX + "px";
        }
      });

    var radiusHandlesSupported = supportsCornerRadiusHandles(el);
    selectionOverlay
      .querySelectorAll("[data-agent-native-radius-handle]")
      .forEach(function (handle) {
        if (
          readOnly ||
          !!activeTextEditEl ||
          !radiusHandlesSupported ||
          !(elWidth > 0) ||
          !(elHeight > 0)
        ) {
          handle.style.display = "none";
          return;
        }
        var pos = handle.getAttribute("data-agent-native-radius-handle") || "";
        var size = 9 * line;
        var maxInset = Math.min(elWidth, elHeight) / 2 - size;
        if (maxInset < 4 * line) {
          handle.style.display = "none";
          return;
        }
        var inset = Math.max(4 * line, Math.min(16 * line, maxInset));
        handle.style.display = "block";
        handle.style.width = size + "px";
        handle.style.height = size + "px";
        handle.style.borderWidth = 1.5 * line + "px";
        var offset = inset - size / 2 + "px";
        if (pos.indexOf("n") !== -1) handle.style.top = offset;
        if (pos.indexOf("s") !== -1) handle.style.bottom = offset;
        if (pos.indexOf("w") !== -1) handle.style.left = offset;
        if (pos.indexOf("e") !== -1) handle.style.right = offset;
      });

    if (isNewSelectionTarget) {
      void selectionOverlay.offsetHeight;
      selectionOverlay.removeAttribute(
        "data-agent-native-suppress-handle-transition",
      );
    }
  }

  function applyEditorChromeScale() {
    syncEditorChromeScaleVars();
    var sx = chromeScaleX();
    var sy = chromeScaleY();
    var line = chromeLineScale();
    highlightOverlay.style.borderWidth =
      (highlightOverlayStyle === "soft" ? 1 : 1.5) * line + "px";
    parentAutoLayoutOverlay.style.borderWidth = 1 * line + "px";
    selectionOverlay.style.borderWidth = 1.5 * line + "px";
    marqueeSelectionOverlay.style.borderWidth = 1 * line + "px";
    passiveSelectionOverlays.forEach(scalePassiveSelectionOverlay);
    if (selectedEl) updateSpacingOverlay(selectedEl);

    applySelectionHandleHitGeometry(selectedEl);

    selectionOverlay
      .querySelectorAll("[data-agent-native-rotate-handle]")
      .forEach(function (handle) {
        var pos = handle.getAttribute("data-agent-native-rotate-handle") || "";
        if (pos === "top-center") {
          var buttonScale = Math.min(sx, sy);
          handle.style.width = 16 * buttonScale + "px";
          handle.style.height = 16 * buttonScale + "px";
          handle.style.fontSize = 10 * buttonScale + "px";
          handle.style.top = -22 * sy + "px";
          return;
        }
        var size = Math.min(sx, sy);
        handle.style.width = 28 * size + "px";
        handle.style.height = 28 * size + "px";
        if (pos.indexOf("n") !== -1) handle.style.top = -34 * sy + "px";
        if (pos.indexOf("s") !== -1) handle.style.bottom = -34 * sy + "px";
        if (pos.indexOf("w") !== -1) handle.style.left = -34 * sx + "px";
        if (pos.indexOf("e") !== -1) handle.style.right = -34 * sx + "px";
      });
  }

  function positionOverlayForRotatedLocalBox(
    overlay: HTMLElement,
    el: Element,
  ): boolean {
    var elCs = window.getComputedStyle(el);
    var elW = readFinitePx((el as HTMLElement).style.width || elCs.width);
    var elH = readFinitePx((el as HTMLElement).style.height || elCs.height);
    var elRot = currentRotation(el);
    if (Math.abs(elRot) < 0.01 || elW === null || elH === null) return false;
    var rect = (el as HTMLElement).getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    overlay.style.display = "block";
    overlay.style.left = cx - elW / 2 + "px";
    overlay.style.top = cy - elH / 2 + "px";
    overlay.style.width = elW + "px";
    overlay.style.height = elH + "px";
    overlay.style.transform = "rotate(" + elRot + "deg)";
    overlay.style.transformOrigin = "50% 50%";
    return true;
  }

  function ensureMultiSelectionBoundsOverlay(): HTMLElement {
    if (multiSelectionBoundsOverlay) return multiSelectionBoundsOverlay;
    var overlay = document.createElement("div");
    overlay.setAttribute("data-agent-native-edit-overlay", "multi-selection");
    overlay.setAttribute("data-agent-native-multi-selection-bounds", "true");
    overlay.style.cssText =
      "position:fixed;pointer-events:none;z-index:99996;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;";
    appendPassiveSelectionHandles(overlay);
    overlay.addEventListener(
      "mousedown",
      function (e) {
        if (readOnly) return;
        var corner =
          e.target &&
          (e.target as Element).getAttribute &&
          (e.target as Element).getAttribute("data-corner");
        if (!corner) return;
        startGroupResize(corner, e);
      },
      true,
    );
    appendEditorChromeNode(overlay);
    multiSelectionBoundsOverlay = overlay;
    return overlay;
  }

  function positionMultiSelectionBounds(): void {
    var members: Element[] = [];
    if (selectedEl && document.documentElement.contains(selectedEl)) {
      members.push(selectedEl);
    }
    passiveSelectionEls.forEach(function (el) {
      if (el && document.documentElement.contains(el)) members.push(el);
    });
    setSelectionOverlayResizeChromeVisible(
      !readOnly && !activeTextEditEl && members.length < 2,
    );
    if (members.length === 0 || selectionChromeHidden) {
      if (multiSelectionBoundsOverlay) {
        multiSelectionBoundsOverlay.style.display = "none";
      }
      return;
    }
    var rects = members.map(function (el) {
      return (el as HTMLElement).getBoundingClientRect();
    });
    var left = Math.min.apply(
      null,
      rects.map(function (r) {
        return r.left;
      }),
    );
    var top = Math.min.apply(
      null,
      rects.map(function (r) {
        return r.top;
      }),
    );
    var right = Math.max.apply(
      null,
      rects.map(function (r) {
        return r.right;
      }),
    );
    var bottom = Math.max.apply(
      null,
      rects.map(function (r) {
        return r.bottom;
      }),
    );
    if (designCanvasBoardSurface && selectedEl) {
      window.parent.postMessage(
        {
          type: "agent-native:board-selection-bounds",
          screenId: designCanvasScreenId,
          selector: getSelector(selectedEl),
          memberSelectors: members.map(getSelector),
          memberSourceIds: members.map(getSourceId),
          contentOffsetX: designCanvasContentOffsetX,
          contentOffsetY: designCanvasContentOffsetY,
          rect: {
            left: left,
            top: top,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top),
          },
          rotationDeg: 0,
        },
        "*",
      );
    }
    if (members.length < 2) {
      if (multiSelectionBoundsOverlay) {
        multiSelectionBoundsOverlay.style.display = "none";
      }
      return;
    }
    var overlay = ensureMultiSelectionBoundsOverlay();
    overlay.style.display = "block";
    overlay.style.transform = "none";
    overlay.style.left = left + "px";
    overlay.style.top = top + "px";
    overlay.style.width = Math.max(0, right - left) + "px";
    overlay.style.height = Math.max(0, bottom - top) + "px";
    scalePassiveSelectionOverlay(overlay);
  }

  function positionOverlay(overlay: HTMLElement, el: Element): void {
    if (!el || !document.documentElement.contains(el)) {
      overlay.style.display = "none";
      if (overlay === selectionOverlay) hideSelectionOverlay();
      return;
    }
    var placedRotatedLocalBox = positionOverlayForRotatedLocalBox(overlay, el);
    if (!placedRotatedLocalBox) {
      var rect =
        overlay === selectionOverlay ? el.getBoundingClientRect() : undefined;
      var box = selectableBounds(el);
      overlay.style.display = "block";
      overlay.style.top = box.top + "px";
      overlay.style.left = box.left + "px";
      overlay.style.width = box.width + "px";
      overlay.style.height = box.height + "px";
      overlay.style.transform = "";
    }
    if (overlay === selectionOverlay) {
      paintRepeatInstances(el);
      applySelectionChrome(el);
      applySelectionHandleHitGeometry(el);
      updateSpacingOverlay(el);
      updateGridCellOverlay(el);
      refreshFrameNameLabels();
      updateComponentTag(el, rect);
      updateParentAutoLayoutOverlay(el);
      showSizeBadge(el);
      if (designCanvasBoardSurface) {
        window.parent.postMessage(
          {
            type: "agent-native:board-selection-rect",
            screenId: designCanvasScreenId,
            selector: getSelector(el),
            sourceId: getSourceId(el),
            contentOffsetX: designCanvasContentOffsetX,
            contentOffsetY: designCanvasContentOffsetY,
            rect: {
              left: parseFloat(overlay.style.left) || 0,
              top: parseFloat(overlay.style.top) || 0,
              width: parseFloat(overlay.style.width) || 0,
              height: parseFloat(overlay.style.height) || 0,
            },
            rotationDeg: currentRotation(el),
          },
          "*",
        );
      }
    } else {
      applyElementOverlayChrome(overlay, el);
    }
  }

  var gridCellOverlayRenderKey = "";
  var gridTrackOverlayRenderKey = "";
  var gridTrackDrag: {
    el: Element;
    axis: "row" | "column";
    sourceIndex: number;
    slot: number;
    originalStyles: Array<{
      el: Element;
      property: "gridRow" | "gridColumn";
      value: string;
      priority: string;
      range: { start: number; end: number };
    }>;
  } | null = null;

  function hideGridTrackOverlay(): void {
    gridTrackOverlay.style.display = "none";
    gridTrackOverlay.innerHTML = "";
    gridTrackOverlay.removeAttribute("data-agent-native-grid-track-dragging");
    gridTrackOverlayRenderKey = "";
  }

  function hideGridCellOverlay(): void {
    gridCellOverlay.style.display = "none";
    if (gridCellOverlayRenderKey) {
      gridCellOverlay.innerHTML = "";
      gridCellOverlayRenderKey = "";
    }
    hideGridTrackOverlay();
  }

  // occupies a line, so only a genuinely non-numeric token (a line name) drops.
  function gridTrackSizes(template: string): number[] {
    var sizes: number[] = [];
    if (!template || template === "none") return sizes;
    template.split(/\s+/).forEach(function (token) {
      var size = readFinitePx(token);
      if (size !== null) sizes.push(size);
    });
    return sizes;
  }

  function gridTrackDistribution(
    tracks: number[],
    contentSize: number,
    gap: number,
    distribution: string,
  ): { offset: number; gap: number } {
    var used = 0;
    for (var i = 0; i < tracks.length; i += 1) used += tracks[i];
    used += gap * Math.max(0, tracks.length - 1);
    var leftover = contentSize - used;
    if (!(leftover > 0.01)) return { offset: 0, gap: gap };
    var mode = (distribution || "normal").split(" ").pop() || "normal";
    if (mode === "center") return { offset: leftover / 2, gap: gap };
    if (mode === "end" || mode === "flex-end" || mode === "right") {
      return { offset: leftover, gap: gap };
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

  function gridTrackLayoutForElement(el: Element | null): {
    container: Element;
    rect: DOMRect;
    columns: number[];
    rows: number[];
    columnTemplate: string;
    rowTemplate: string;
    columnBounds: Array<{ start: number; end: number }>;
    rowBounds: Array<{ start: number; end: number }>;
  } | null {
    if (!el || !document.documentElement.contains(el)) return null;
    var cs = window.getComputedStyle(el);
    if (cs.display !== "grid" && cs.display !== "inline-grid") return null;
    if (Math.abs(currentRotation(el)) > 0.01) return null;
    var columns = gridTrackSizes(cs.gridTemplateColumns);
    var rows = gridTrackSizes(cs.gridTemplateRows);
    if (columns.length === 0 || rows.length === 0) return null;
    var rect = el.getBoundingClientRect();
    var contentLeft =
      rect.left + readPx(cs.borderLeftWidth) + readPx(cs.paddingLeft);
    var contentTop =
      rect.top + readPx(cs.borderTopWidth) + readPx(cs.paddingTop);
    var contentWidth =
      rect.width -
      readPx(cs.borderLeftWidth) -
      readPx(cs.borderRightWidth) -
      readPx(cs.paddingLeft) -
      readPx(cs.paddingRight);
    var contentHeight =
      rect.height -
      readPx(cs.borderTopWidth) -
      readPx(cs.borderBottomWidth) -
      readPx(cs.paddingTop) -
      readPx(cs.paddingBottom);
    var columnFlow = gridTrackDistribution(
      columns,
      contentWidth,
      readPx(cs.columnGap),
      cs.justifyContent,
    );
    var rowFlow = gridTrackDistribution(
      rows,
      contentHeight,
      readPx(cs.rowGap),
      cs.alignContent,
    );
    var columnBounds: Array<{ start: number; end: number }> = [];
    var rowBounds: Array<{ start: number; end: number }> = [];
    var columnStart = contentLeft + columnFlow.offset;
    for (var column = 0; column < columns.length; column += 1) {
      columnBounds.push({
        start: columnStart,
        end: columnStart + columns[column],
      });
      columnStart += columns[column] + columnFlow.gap;
    }
    var rowStart = contentTop + rowFlow.offset;
    for (var row = 0; row < rows.length; row += 1) {
      rowBounds.push({ start: rowStart, end: rowStart + rows[row] });
      rowStart += rows[row] + rowFlow.gap;
    }
    return {
      container: el,
      rect,
      columns,
      rows,
      columnTemplate: cs.gridTemplateColumns,
      rowTemplate: cs.gridTemplateRows,
      columnBounds,
      rowBounds,
    };
  }

  function gridTrackRangeForRect(
    rect: DOMRect,
    bounds: Array<{ start: number; end: number }>,
    axis: "row" | "column",
  ): { start: number; end: number } | null {
    if (bounds.length === 0) return null;
    var leading = axis === "row" ? rect.top : rect.left;
    var trailing = axis === "row" ? rect.bottom : rect.right;
    var start = 0;
    var end = bounds.length - 1;
    var startDistance = Infinity;
    var endDistance = Infinity;
    for (var index = 0; index < bounds.length; index += 1) {
      var startDelta = Math.abs(leading - bounds[index].start);
      var endDelta = Math.abs(trailing - bounds[index].end);
      if (startDelta < startDistance) {
        startDistance = startDelta;
        start = index;
      }
      if (endDelta < endDistance) {
        endDistance = endDelta;
        end = index;
      }
    }
    if (end < start) {
      var center = (leading + trailing) / 2;
      var nearest = 0;
      var nearestDistance = Infinity;
      bounds.forEach(function (bound, index) {
        var distance = Math.abs(center - (bound.start + bound.end) / 2);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = index;
        }
      });
      start = nearest;
      end = nearest;
    }
    return { start, end: end + 1 };
  }

  function gridTrackCssProperty(
    property: "gridRow" | "gridColumn",
  ): "grid-row" | "grid-column" {
    return property === "gridRow" ? "grid-row" : "grid-column";
  }

  function authoredGridTrackRange(
    value: string,
  ): { start: number; end: number } | null {
    var match = value.trim().match(/^(-?\d+)(?:\s*\/\s*(-?\d+))?$/);
    if (!match || !match[1]) return null;
    var start = Number(match[1]) - 1;
    var end = match[2] ? Number(match[2]) - 1 : start + 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0)
      return null;
    return end > start ? { start, end } : null;
  }

  function gridTrackMoveOrder(
    count: number,
    sourceIndex: number,
    slot: number,
  ): { order: number[]; targetIndex: number } {
    var order: number[] = [];
    for (var index = 0; index < count; index += 1) {
      if (index !== sourceIndex) order.push(index);
    }
    var targetIndex = slot > sourceIndex ? slot - 1 : slot;
    targetIndex = Math.max(0, Math.min(order.length, targetIndex));
    order.splice(targetIndex, 0, sourceIndex);
    return { order, targetIndex };
  }

  function gridTrackStylesForSlot(
    drag: NonNullable<typeof gridTrackDrag>,
    slot: number,
  ): Array<{ el: Element; property: "gridRow" | "gridColumn"; value: string }> {
    var layout = gridTrackLayoutForElement(drag.el);
    if (!layout) return [];
    var bounds = drag.axis === "row" ? layout.rowBounds : layout.columnBounds;
    var count = bounds.length;
    var move = gridTrackMoveOrder(count, drag.sourceIndex, slot);
    var originalToNext: number[] = [];
    move.order.forEach(function (original, next) {
      originalToNext[original] = next;
    });
    var property = drag.axis === "row" ? "gridRow" : "gridColumn";
    var changes: Array<{
      el: Element;
      property: "gridRow" | "gridColumn";
      value: string;
    }> = [];
    drag.originalStyles.forEach(function (item) {
      if (item.property !== property) return;
      var authoredRange = authoredGridTrackRange(item.value);
      if (!item.value.trim() || !authoredRange) {
        // ponytail: preserve authored placement semantics until remapping exists.
        return;
      }
      var range = authoredRange;
      var mapped: number[] = [];
      for (var original = range.start; original < range.end; original += 1) {
        if (originalToNext[original] !== undefined) {
          mapped.push(originalToNext[original]);
        }
      }
      if (mapped.length === 0) return;
      mapped.sort(function (left, right) {
        return left - right;
      });
      for (var mappedIndex = 1; mappedIndex < mapped.length; mappedIndex += 1) {
        if (mapped[mappedIndex] !== mapped[mappedIndex - 1] + 1) return;
      }
      var start = Math.min.apply(null, mapped);
      var end = Math.max.apply(null, mapped) + 1;
      var value = start + 1 + " / " + (end + 1);
      if (value === item.value) return;
      changes.push({
        el: item.el,
        property,
        value: value,
      });
    });
    return changes;
  }

  function applyGridTrackPreview(
    drag: NonNullable<typeof gridTrackDrag>,
    slot: number,
  ): void {
    drag.originalStyles.forEach(function (item) {
      item.el.style.setProperty(
        gridTrackCssProperty(item.property),
        item.value,
        item.priority,
      );
    });
    var changes = gridTrackStylesForSlot(drag, slot);
    changes.forEach(function (change) {
      change.el.style.setProperty(
        gridTrackCssProperty(change.property),
        change.value,
      );
    });
    drag.slot = slot;
  }

  function gridTrackSlotAtPoint(
    layout: NonNullable<ReturnType<typeof gridTrackLayoutForElement>>,
    axis: "row" | "column",
    clientX: number,
    clientY: number,
  ): number {
    var bounds = axis === "row" ? layout.rowBounds : layout.columnBounds;
    var coordinate = axis === "row" ? clientY : clientX;
    for (var index = 0; index < bounds.length; index += 1) {
      var midpoint = (bounds[index].start + bounds[index].end) / 2;
      if (coordinate < midpoint) return index;
    }
    return bounds.length;
  }

  function showGridTrackLandingGuide(
    layout: NonNullable<ReturnType<typeof gridTrackLayoutForElement>>,
    axis: "row" | "column",
    slot: number,
  ): void {
    var bounds = axis === "row" ? layout.rowBounds : layout.columnBounds;
    var line = Math.max(1, 2 * chromeLineScale());
    var coordinate =
      slot < bounds.length ? bounds[slot].start : bounds[bounds.length - 1].end;
    insertionGuide.setAttribute("data-agent-native-grid-track-guide", "");
    insertionGuide.setAttribute("data-agent-native-grid-track-axis", axis);
    insertionGuide.setAttribute(
      "data-agent-native-grid-track-index",
      String(slot),
    );
    insertionGuide.style.display = "block";
    insertionGuide.style.background = "var(--design-editor-accent-color)";
    insertionGuide.style.border = "0";
    insertionGuide.style.boxShadow =
      "0 0 0 1px var(--design-editor-accent-color)";
    if (axis === "row") {
      insertionGuide.style.left = layout.rect.left + "px";
      insertionGuide.style.top = coordinate - line / 2 + "px";
      insertionGuide.style.width = layout.rect.width + "px";
      insertionGuide.style.height = line + "px";
    } else {
      insertionGuide.style.left = coordinate - line / 2 + "px";
      insertionGuide.style.top = layout.rect.top + "px";
      insertionGuide.style.width = line + "px";
      insertionGuide.style.height = layout.rect.height + "px";
    }
  }

  function hideGridTrackLandingGuide(): void {
    insertionGuide.removeAttribute("data-agent-native-grid-track-guide");
    insertionGuide.removeAttribute("data-agent-native-grid-track-axis");
    insertionGuide.removeAttribute("data-agent-native-grid-track-index");
    if (!gridTrackDrag) insertionGuide.style.display = "none";
  }

  function renderGridTrackOverlay(
    el: Element,
    layout: NonNullable<ReturnType<typeof gridTrackLayoutForElement>>,
  ): void {
    if (readOnly || selectionChromeHidden || activeTextEditEl) {
      hideGridTrackOverlay();
      return;
    }
    var line = Math.max(1, chromeLineScale());
    var nextKey = [
      layout.rect.left,
      layout.rect.top,
      layout.rect.width,
      layout.rect.height,
      line,
      layout.columns.join(","),
      layout.rows.join(","),
    ].join("|");
    if (
      gridTrackOverlay.style.display === "block" &&
      gridTrackOverlayRenderKey === nextKey
    ) {
      return;
    }
    gridTrackOverlayRenderKey = nextKey;
    gridTrackOverlay.innerHTML = "";
    gridTrackOverlay.style.display = "block";
    var render = function (
      axis: "row" | "column",
      index: number,
      bounds: { start: number; end: number },
    ) {
      var handle = document.createElement("button");
      handle.type = "button";
      handle.setAttribute("data-agent-native-grid-track", axis);
      handle.setAttribute("data-grid-track-index", String(index));
      handle.setAttribute("aria-label", axis + " track " + (index + 1));
      handle.style.position = "fixed";
      handle.style.boxSizing = "border-box";
      handle.style.pointerEvents = "auto";
      handle.style.border = "0";
      handle.style.borderRadius = "3px";
      handle.style.padding = "0";
      handle.style.background =
        "color-mix(in srgb, var(--design-editor-accent-color) 16%, transparent)";
      handle.style.cursor = "grab";
      if (axis === "row") {
        handle.style.left = layout.rect.left - 18 * line + "px";
        handle.style.top = bounds.start + "px";
        handle.style.width = 14 * line + "px";
        handle.style.height =
          Math.max(8 * line, bounds.end - bounds.start) + "px";
      } else {
        handle.style.left = bounds.start + "px";
        handle.style.top = layout.rect.top - 18 * line + "px";
        handle.style.width =
          Math.max(8 * line, bounds.end - bounds.start) + "px";
        handle.style.height = 14 * line + "px";
      }
      handle.addEventListener("pointerdown", function (event) {
        startGridTrackDrag(axis, index, event);
      });
      handle.addEventListener("mousedown", function (event) {
        startGridTrackDrag(axis, index, event);
      });
      gridTrackOverlay.appendChild(handle);
    };
    layout.rowBounds.forEach(function (bounds, index) {
      render("row", index, bounds);
    });
    layout.columnBounds.forEach(function (bounds, index) {
      render("column", index, bounds);
    });
  }

  function startGridTrackDrag(
    axis: "row" | "column",
    sourceIndex: number,
    event: PointerEvent | MouseEvent,
  ): void {
    if (readOnly || gridTrackDrag || !selectedEl) return;
    var layout = gridTrackLayoutForElement(selectedEl);
    if (!layout) return;
    var bounds = axis === "row" ? layout.rowBounds : layout.columnBounds;
    if (!bounds[sourceIndex]) return;
    stopNativeInteraction(event);
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    var property = axis === "row" ? "gridRow" : "gridColumn";
    var children = gridTrackParticipants(selectedEl);
    var cssProperty = gridTrackCssProperty(property);
    if (
      children.some(function (child) {
        return child.style.getPropertyPriority(cssProperty) === "important";
      })
    ) {
      // ponytail: reject !important tracks until batch/source persistence carries priority.
      return;
    }
    var originalStyles: NonNullable<typeof gridTrackDrag>["originalStyles"] =
      [];
    children.forEach(function (child) {
      var range = gridTrackRangeForRect(
        child.getBoundingClientRect(),
        bounds,
        axis,
      );
      if (!range) return;
      var style = child.style;
      originalStyles.push({
        el: child,
        property,
        value: style.getPropertyValue(cssProperty),
        priority: style.getPropertyPriority(cssProperty),
        range,
      });
    });
    gridTrackDrag = {
      el: selectedEl,
      axis,
      sourceIndex,
      slot: sourceIndex,
      originalStyles,
    };
    activeDragStartedAt = Date.now();
    var events = dragEventNames(event);
    function cleanup(): void {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      document.removeEventListener("keydown", onKey, true);
      clearActiveDragCancel(cancel);
    }
    function restore(): void {
      if (!gridTrackDrag) return;
      gridTrackDrag.originalStyles.forEach(function (item) {
        if (item.value)
          item.el.style.setProperty(
            gridTrackCssProperty(item.property),
            item.value,
            item.priority,
          );
        else item.el.style.removeProperty(gridTrackCssProperty(item.property));
      });
      gridTrackDrag = null;
      hideGridTrackLandingGuide();
      positionOverlay(selectionOverlay, selectedEl!);
      updateGridCellOverlay(selectedEl);
    }
    function cancel(): boolean {
      cleanup();
      restore();
      return true;
    }
    function onKey(keyEvent: KeyboardEvent): void {
      if (keyEvent.key !== "Escape") return;
      stopNativeInteraction(keyEvent);
      cancel();
    }
    function onMove(moveEvent: MouseEvent | PointerEvent): void {
      if (
        !gridTrackDrag ||
        !document.documentElement.contains(gridTrackDrag.el)
      )
        return;
      var currentLayout = gridTrackLayoutForElement(gridTrackDrag.el);
      if (!currentLayout) return;
      var slot = gridTrackSlotAtPoint(
        currentLayout,
        gridTrackDrag.axis,
        moveEvent.clientX,
        moveEvent.clientY,
      );
      slot = Math.max(0, Math.min(bounds.length, slot));
      applyGridTrackPreview(gridTrackDrag, slot);
      showGridTrackLandingGuide(currentLayout, gridTrackDrag.axis, slot);
      gridTrackOverlay.setAttribute(
        "data-agent-native-grid-track-dragging",
        "",
      );
      refreshOverlays();
    }
    function onUp(): void {
      if (!gridTrackDrag) return;
      var drag = gridTrackDrag;
      cleanup();
      if (
        drag.slot === drag.sourceIndex ||
        drag.slot === drag.sourceIndex + 1
      ) {
        restore();
        return;
      }
      var changes = gridTrackStylesForSlot(drag, drag.slot);
      var payload = changes.map(function (change) {
        var info = drag.originalStyles.find(function (item) {
          return item.el === change.el;
        });
        return {
          selector: getSelector(change.el),
          sourceId: getSourceId(change.el) || undefined,
          elementInfo: getElementInfo(change.el, undefined, false),
          styles: { [change.property]: change.value },
          originalStyles: info ? { [change.property]: info.value } : undefined,
          preserveSelection: true,
        };
      });
      gridTrackDrag = null;
      hideGridTrackLandingGuide();
      gridTrackOverlay.removeAttribute("data-agent-native-grid-track-dragging");
      if (payload.length > 0) {
        (window.parent as Window).postMessage(
          { type: "visual-style-batch-change", changes: payload },
          "*",
        );
      }
      refreshOverlays();
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onKey, true);
    setActiveDragCancel(cancel);
  }

  function updateGridCellOverlay(el: Element | null): void {
    if (!el || !document.documentElement.contains(el)) {
      hideGridCellOverlay();
      return;
    }
    if (selectionChromeHidden || activeTextEditEl) {
      hideGridCellOverlay();
      return;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display !== "grid" && cs.display !== "inline-grid") {
      hideGridCellOverlay();
      return;
    }
    if (Math.abs(currentRotation(el)) > 0.01) {
      hideGridCellOverlay();
      return;
    }
    var columns = gridTrackSizes(cs.gridTemplateColumns);
    var rows = gridTrackSizes(cs.gridTemplateRows);
    if (columns.length === 0 || rows.length === 0) {
      hideGridCellOverlay();
      return;
    }
    var rect = el.getBoundingClientRect();
    var contentLeft =
      rect.left + readPx(cs.borderLeftWidth) + readPx(cs.paddingLeft);
    var contentTop =
      rect.top + readPx(cs.borderTopWidth) + readPx(cs.paddingTop);
    var contentWidth =
      rect.width -
      readPx(cs.borderLeftWidth) -
      readPx(cs.borderRightWidth) -
      readPx(cs.paddingLeft) -
      readPx(cs.paddingRight);
    var contentHeight =
      rect.height -
      readPx(cs.borderTopWidth) -
      readPx(cs.borderBottomWidth) -
      readPx(cs.paddingTop) -
      readPx(cs.paddingBottom);
    var columnFlow = gridTrackDistribution(
      columns,
      contentWidth,
      readPx(cs.columnGap),
      cs.justifyContent,
    );
    var rowFlow = gridTrackDistribution(
      rows,
      contentHeight,
      readPx(cs.rowGap),
      cs.alignContent,
    );
    var originX = contentLeft + columnFlow.offset;
    var originY = contentTop + rowFlow.offset;
    var columnGap = columnFlow.gap;
    var rowGap = rowFlow.gap;
    var line = Math.max(1, chromeLineScale());
    var nextKey = [
      originX,
      originY,
      columnGap,
      rowGap,
      line,
      columns.join(","),
      rows.join(","),
    ].join("|");
    if (
      gridCellOverlay.style.display === "block" &&
      gridCellOverlayRenderKey === nextKey
    ) {
      return;
    }
    gridCellOverlayRenderKey = nextKey;
    gridCellOverlay.innerHTML = "";
    gridCellOverlay.style.display = "block";
    var color = chromeColorForElement(el);
    var cellY = originY;
    for (var row = 0; row < rows.length; row += 1) {
      var cellX = originX;
      for (var column = 0; column < columns.length; column += 1) {
        var cell = document.createElement("div");
        cell.setAttribute("data-agent-native-grid-cell", column + ":" + row);
        cell.style.cssText =
          "position:absolute;box-sizing:border-box;pointer-events:none;left:" +
          cellX +
          "px;top:" +
          cellY +
          "px;width:" +
          columns[column] +
          "px;height:" +
          rows[row] +
          "px;border:" +
          line +
          "px solid color-mix(in srgb," +
          color +
          " 42%,transparent);";
        gridCellOverlay.appendChild(cell);
        cellX += columns[column] + columnGap;
      }
      cellY += rows[row] + rowGap;
    }
    var trackLayout = gridTrackLayoutForElement(el);
    if (trackLayout) renderGridTrackOverlay(el, trackLayout);
  }

  // guard:allow-raw-color — a mid grey is legible on white screens and dark boards.
  var FRAME_LABEL_IDLE_COLOR = "rgba(113,113,122,0.95)";
  var FRAME_PRIMITIVE_SELECTOR = '[data-an-primitive="frame"]';
  var frameLabelRenderKey = "";

  function outermostFrameElements(): Element[] {
    if (!designCanvasBoardSurface) return [];
    var frames = Array.prototype.slice.call(
      document.querySelectorAll(FRAME_PRIMITIVE_SELECTOR),
    ) as Element[];
    return frames.filter(function (frame) {
      if (isOverlayElement(frame)) return false;
      var parent = frame.parentElement;
      return !parent || !parent.closest(FRAME_PRIMITIVE_SELECTOR);
    });
  }

  function frameLabelText(frame: Element): string {
    var name =
      layerNameForElement(frame) || frame.getAttribute("aria-label") || "";
    return name.trim() || "Frame"; /* i18n-ignore canvas frame label */
  }

  function selectFrameFromLabel(frame: Element, e: MouseEvent): void {
    if (isLayerInteractionBlocked(frame)) return;
    blurActiveTextEditor();
    var toggled = resolveShiftClickToggleOff(frame, e);
    if (toggled !== undefined) {
      postToggledSelection(toggled);
      return;
    }
    var previousSelectedEl = selectedEl;
    selectedEl = frame;
    positionOverlay(selectionOverlay, selectedEl);
    if (!e.shiftKey && passiveSelectionEls.length) {
      setPassiveSelectionElements([]);
    }
    preservePreviousSelectedElementForShiftClick(
      previousSelectedEl,
      selectedEl,
      e,
    );
    postElementSelect(selectedEl, e);
  }

  function refreshFrameNameLabels(): void {
    var frames = outermostFrameElements();
    var line = chromeLineScale();
    var fontSize = 11 * line;
    var labelHeight = 16 * line;
    var placements: {
      frame: Element;
      text: string;
      left: number;
      top: number;
      maxWidth: number;
      selected: boolean;
    }[] = [];
    frames.forEach(function (frame) {
      var rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      var top = rect.top - labelHeight - 2 * line;
      if (top < 0) top = rect.top + 2 * line;
      placements.push({
        frame: frame,
        text: frameLabelText(frame),
        left: rect.left,
        top: top,
        maxWidth: Math.max(48 * line, rect.width),
        selected: frame === selectedEl,
      });
    });
    var nextKey =
      placements
        .map(function (placement) {
          return [
            placement.text,
            Math.round(placement.left),
            Math.round(placement.top),
            Math.round(placement.maxWidth),
            placement.selected ? "1" : "0",
          ].join(",");
        })
        .join("|") +
      "@" +
      line;
    if (frameLabelRenderKey === nextKey) return;
    frameLabelRenderKey = nextKey;
    frameLabelLayer.innerHTML = "";
    placements.forEach(function (placement) {
      var label = document.createElement("button");
      label.type = "button";
      label.setAttribute("data-agent-native-frame-label", "");
      label.textContent = placement.text;
      label.title = placement.text;
      label.style.cssText =
        "position:absolute;margin:0;padding:0;border:0;background:transparent;" +
        "max-width:" +
        placement.maxWidth +
        "px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
        "pointer-events:auto;cursor:default;text-align:left;" +
        "font:500 " +
        fontSize +
        "px/" +
        labelHeight +
        "px ui-sans-serif,system-ui,-apple-system,sans-serif;" +
        "left:" +
        placement.left +
        "px;top:" +
        placement.top +
        "px;height:" +
        labelHeight +
        "px;color:" +
        (placement.selected
          ? "var(--design-editor-accent-color)"
          : FRAME_LABEL_IDLE_COLOR);
      label.addEventListener("mousedown", function (event) {
        event.stopPropagation();
      });
      label.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        selectFrameFromLabel(placement.frame, event as MouseEvent);
      });
      frameLabelLayer.appendChild(label);
    });
  }

  function refreshOverlays(): void {
    paintRepeatInstances(selectedEl);
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
      if (selectionChromeHidden) {
        hideSelectionOverlay();
      } else {
        positionOverlay(selectionOverlay, selectedEl);
      }
    } else {
      hideParentAutoLayoutOverlay();
    }
    passiveSelectionEls.forEach(function (el, index) {
      var overlay = passiveSelectionOverlays[index];
      if (overlay) positionOverlay(overlay, el);
    });
    if (passiveSelectionEls.length > 0) hideSizeBadge();
    positionMultiSelectionBounds();
    positionGradientOverlay();
    refreshFrameNameLabels();
    syncOverlayObservers();
  }

  var refreshOverlaysScheduled = false;
  var refreshOverlaysGeneration = 0;
  function scheduleRefreshOverlays(): void {
    if (refreshOverlaysScheduled) return;
    refreshOverlaysScheduled = true;
    var generation = refreshOverlaysGeneration;
    window.requestAnimationFrame(function () {
      refreshOverlaysScheduled = false;
      if (generation !== refreshOverlaysGeneration) return;
      refreshOverlays();
    });
  }

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

  var overlayAnimationTrackingActive = false;
  var overlayAnimationTrackingUntil = 0;
  var overlayAnimationTrackingStartedAt = 0;
  var OVERLAY_ANIMATION_TRACKING_WINDOW_MS = 1000;
  var OVERLAY_ANIMATION_TRACKING_MAX_MS = 4000;

  function isOverlayAnimationTrackingTarget(
    target: EventTarget | null,
  ): boolean {
    if (!target) return false;
    if (target === selectedEl || target === hoveredEl) return true;
    var el = target as Element;
    if (!el || typeof el.closest !== "function") return false;
    return Boolean(
      el.closest(FRAME_PRIMITIVE_SELECTOR) ||
      (el.querySelector && el.querySelector(FRAME_PRIMITIVE_SELECTOR)),
    );
  }

  function tickOverlayAnimationTracking(): void {
    if (!overlayAnimationTrackingActive) return;
    refreshOverlays();
    var now = Date.now();
    if (
      now >= overlayAnimationTrackingUntil ||
      now - overlayAnimationTrackingStartedAt >=
        OVERLAY_ANIMATION_TRACKING_MAX_MS
    ) {
      overlayAnimationTrackingActive = false;
      return;
    }
    window.requestAnimationFrame(tickOverlayAnimationTracking);
  }

  function startOverlayAnimationTracking(): void {
    var now = Date.now();
    overlayAnimationTrackingUntil = now + OVERLAY_ANIMATION_TRACKING_WINDOW_MS;
    if (overlayAnimationTrackingActive) return;
    overlayAnimationTrackingActive = true;
    overlayAnimationTrackingStartedAt = now;
    window.requestAnimationFrame(tickOverlayAnimationTracking);
  }

  function onOverlayAnimationTrackingEvent(e: Event): void {
    if (isOverlayAnimationTrackingTarget(e.target as EventTarget | null)) {
      startOverlayAnimationTracking();
    }
  }
  document.addEventListener(
    "transitionrun",
    onOverlayAnimationTrackingEvent,
    true,
  );
  document.addEventListener(
    "animationstart",
    onOverlayAnimationTrackingEvent,
    true,
  );

  function hideMeasurements(): void {
    measurementOverlay.style.display = "none";
    measurementOverlay.innerHTML = "";
  }

  function addMeasurementLine(x1, y1, x2, y2, label, dashed) {
    var horizontal = y1 === y2;
    var line = document.createElement("div");
    var scale = chromeLineScale();
    var border =
      scale +
      "px " +
      (dashed ? "dashed" : "solid") +
      " var(--design-editor-measure-color);";
    if (horizontal) {
      var left = Math.min(x1, x2);
      var width = Math.abs(x2 - x1);
      line.style.cssText =
        "position:fixed;left:" +
        left +
        "px;top:" +
        y1 +
        "px;width:" +
        width +
        "px;border-top:" +
        border;
    } else {
      var top = Math.min(y1, y2);
      var height = Math.abs(y2 - y1);
      line.style.cssText =
        "position:fixed;left:" +
        x1 +
        "px;top:" +
        top +
        "px;height:" +
        height +
        "px;border-left:" +
        border;
    }
    measurementOverlay.appendChild(line);
    if (!label) return;
    var labelEl = document.createElement("div");
    labelEl.style.cssText =
      "position:fixed;left:" +
      (horizontal ? (x1 + x2) / 2 : x1 + 8 * scale) +
      "px;top:" +
      (horizontal ? y1 + 7 * scale : (y1 + y2) / 2) +
      "px;transform:" +
      (horizontal ? "translateX(-50%)" : "translateY(-50%)") +
      ";border-radius:" +
      3 * scale +
      "px;background:var(--design-editor-measure-color);color:white;padding:" +
      1 * scale +
      "px " +
      4 * scale +
      "px;font-size:" +
      11 * scale +
      "px;";
    labelEl.textContent = label;
    measurementOverlay.appendChild(labelEl);
  }

  function measurementSegments(s, t) {
    var segments: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      label: string;
      dashed: boolean;
    }> = [];
    function add(x1, y1, x2, y2, dashed) {
      var length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
      if (length < 0.5) return;
      segments.push({
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2,
        label: dashed ? "" : String(Math.round(length)),
        dashed: dashed,
      });
    }
    var apartX = t.left >= s.right || t.right <= s.left;
    var apartY = t.top >= s.bottom || t.bottom <= s.top;
    var intersect = !apartX && !apartY;
    var sCx = (s.left + s.right) / 2;
    var sCy = (s.top + s.bottom) / 2;
    var y = intersect
      ? (Math.max(s.top, t.top) + Math.min(s.bottom, t.bottom)) / 2
      : sCy;
    var x = intersect
      ? (Math.max(s.left, t.left) + Math.min(s.right, t.right)) / 2
      : sCx;
    var tNearY = t.top >= sCy ? t.top : t.bottom;
    var tNearX = t.left >= sCx ? t.left : t.right;
    var yMissesT = y < t.top || y > t.bottom;
    var xMissesT = x < t.left || x > t.right;

    if (apartX) {
      var gapEdge = t.left >= s.right ? t.left : t.right;
      add(t.left >= s.right ? s.right : s.left, y, gapEdge, y, false);
      if (yMissesT) add(gapEdge, y, gapEdge, tNearY, true);
    } else {
      var sFarY = tNearY === t.top ? s.top : s.bottom;
      if (intersect || t.left < s.left) {
        add(t.left, y, s.left, y, false);
        if (!intersect) add(t.left, sFarY, t.left, tNearY, true);
      }
      if (intersect || t.right > s.right) {
        add(s.right, y, t.right, y, false);
        if (!intersect) add(t.right, sFarY, t.right, tNearY, true);
      }
    }
    if (apartY) {
      var gapEdgeY = t.top >= s.bottom ? t.top : t.bottom;
      add(x, t.top >= s.bottom ? s.bottom : s.top, x, gapEdgeY, false);
      if (xMissesT) add(x, gapEdgeY, tNearX, gapEdgeY, true);
    } else {
      var sFarX = tNearX === t.left ? s.left : s.right;
      if (intersect || t.top < s.top) {
        add(x, t.top, x, s.top, false);
        if (!intersect) add(sFarX, t.top, tNearX, t.top, true);
      }
      if (intersect || t.bottom > s.bottom) {
        add(x, s.bottom, x, t.bottom, false);
        if (!intersect) add(sFarX, t.bottom, tNearX, t.bottom, true);
      }
    }
    return segments;
  }

  function showMeasurements(a, b) {
    if (!a || !b || a === b) {
      hideMeasurements();
      return;
    }
    if (!measurementOverlay.isConnected) {
      appendEditorChromeNode(measurementOverlay);
    }
    measurementOverlay.innerHTML = "";
    measurementOverlay.style.display = "block";
    measurementSegments(
      a.getBoundingClientRect(),
      b.getBoundingClientRect(),
    ).forEach(function (segment) {
      addMeasurementLine(
        segment.x1,
        segment.y1,
        segment.x2,
        segment.y2,
        segment.label,
        segment.dashed,
      );
    });
  }

  function dragEventNames(e) {
    var pointerGesture = e && e.type && e.type.indexOf("pointer") === 0;
    return pointerGesture
      ? { move: "pointermove", up: "pointerup" }
      : { move: "mousemove", up: "mouseup" };
  }

  function bridgeGestureViewport() {
    var width = Math.max(
      1,
      window.innerWidth || document.documentElement.clientWidth || 1,
    );
    var height = Math.max(
      1,
      window.innerHeight || document.documentElement.clientHeight || 1,
    );
    return { left: 0, top: 0, width: width, height: height };
  }

  function bridgeGesturePointer(e) {
    return {
      x: e.clientX,
      y: e.clientY,
      altKey: !!e.altKey,
      ctrlKey: !!e.ctrlKey,
      metaKey: !!e.metaKey,
      shiftKey: !!e.shiftKey,
    };
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
        dndLog("select:blocked", { el: getSelector(target) });
        return null;
      }
      return target;
    }
    dndLog("select:nothing-at-point", { x: clientX, y: clientY });
    return null;
  }

  function stopNativeInteraction(e: Event): void {
    if (interactionMode) return;
    if (e.cancelable) e.preventDefault();
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
    scheduleRefreshOverlays();
  }

  function isEditorTypingTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      'input, textarea, select, [contenteditable], [role="textbox"], [data-agent-native-text-editing]',
    );
  }

  var ALT_CODE_KEYS = {
    KeyA: "a",
    KeyB: "b",
    KeyC: "c",
    KeyD: "d",
    KeyE: "e",
    KeyF: "f",
    KeyG: "g",
    KeyH: "h",
    KeyI: "i",
    KeyJ: "j",
    KeyK: "k",
    KeyL: "l",
    KeyM: "m",
    KeyN: "n",
    KeyO: "o",
    KeyP: "p",
    KeyQ: "q",
    KeyR: "r",
    KeyS: "s",
    KeyT: "t",
    KeyU: "u",
    KeyV: "v",
    KeyW: "w",
    KeyX: "x",
    KeyY: "y",
    KeyZ: "z",
    BracketRight: "]",
    BracketLeft: "[",
  };

  function normalizedHotkeyChar(e) {
    if (e.altKey) {
      var fromCode = ALT_CODE_KEYS[e.code];
      if (fromCode) return fromCode;
    }
    var key = e.key;
    return key && key.length === 1 ? key.toLowerCase() : key;
  }

  function isApplePlatformBridge(): boolean {
    var nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    var platform =
      nav.platform || (nav.userAgentData && nav.userAgentData.platform) || "";
    return /Mac|iPhone|iPad|iPod/i.test(platform);
  }

  function isPlatformPrimaryChord(e): boolean {
    return isApplePlatformBridge()
      ? e.metaKey && !e.ctrlKey
      : e.ctrlKey && !e.metaKey;
  }

  function isIgnoreAutoLayoutChord(e): boolean {
    return isApplePlatformBridge()
      ? Boolean(e.ctrlKey && !e.metaKey)
      : bridgeIgnoreAutoLayoutKeyPressed ||
          String(e && e.key).toLowerCase() === "s";
  }

  function isIgnoreAutoLayoutChordForDragPoint(e): boolean {
    if (isApplePlatformBridge()) {
      return Boolean(e.ctrlKey && !e.metaKey);
    }
    if (typeof e.ignoreAutoLayoutKeyPressed === "boolean") {
      return (
        e.ignoreAutoLayoutKeyPressed || String(e && e.key).toLowerCase() === "s"
      );
    }
    return isIgnoreAutoLayoutChord(e);
  }

  function isShowShortcutsChord(e) {
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return false;
    return e.key === "?" || e.key === "/";
  }

  function shouldForwardDesignHotkey(e) {
    if (isShowShortcutsChord(e)) return true;
    if (readOnly) return false;
    if (activeTextEditEl || isEditorTypingTarget(e.target) || e.isComposing)
      return false;
    var key = e.key;
    var normalized = normalizedHotkeyChar(e);
    var primary = e.metaKey || e.ctrlKey;
    var isArrangeBracketChord =
      (e.code === "BracketRight" || e.code === "BracketLeft") &&
      ((!primary && !e.altKey && !e.shiftKey) ||
        (primary && !e.shiftKey) ||
        (e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey));
    if (isArrangeBracketChord) return true;
    if (key === "Escape" || key === "Enter") return true;
    if (key === " " && e.code === "Space") {
      return !primary && !e.altKey && !e.shiftKey;
    }
    if (key === "Tab") return !!selectedEl;
    if (key === "Delete" || key === "Backspace") {
      if (primary) return key === "Backspace" && !e.altKey && !e.shiftKey;
      return true;
    }
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
          "u",
          "k",
        ].indexOf(normalized) !== -1 ||
        e.code === "Digit1" ||
        e.code === "Digit2" ||
        key === "1" ||
        key === "2" ||
        (isPlatformPrimaryChord(e) &&
          !e.altKey &&
          !e.shiftKey &&
          normalized === "f") ||
        (e.code === "Backslash" && !e.altKey) ||
        (e.shiftKey && (normalized === "h" || normalized === "l")) ||
        (e.shiftKey && normalized === "r") ||
        (e.altKey && (normalized === "b" || normalized === "k")) ||
        (e.ctrlKey &&
          e.altKey &&
          !e.metaKey &&
          !e.shiftKey &&
          ["h", "v", "t"].indexOf(normalized) !== -1)
      );
    }

    if (e.altKey) {
      if (e.shiftKey) return normalized === "s";
      return (
        ["a", "d", "w", "s", "h", "v"].indexOf(normalized) !== -1 ||
        e.code === "Digit1" ||
        e.code === "Digit2"
      );
    }
    if (e.shiftKey) {
      return (
        ["a", "h", "v", "x", "c", "l", "y", "n", "=", "+"].indexOf(
          normalized,
        ) !== -1 ||
        e.code === "Digit1" ||
        e.code === "Digit2" ||
        key === "1" ||
        key === "2"
      );
    }
    return (
      [
        "v",
        "f",
        "r",
        "o",
        "l",
        "t",
        "p",
        "h",
        "k",
        "c",
        "i",
        "n",
        "\\",
        "]",
        "[",
        "=",
        "+",
        "-",
      ].indexOf(normalized) !== -1 ||
      /^Digit[0-9]$/.test(e.code || "") ||
      /^[0-9]$/.test(key || "")
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

  function syncShieldPointerEvents(): void {
    shieldOverlay.style.pointerEvents =
      interactionMode || textEditPointerState ? "none" : "auto";
  }

  function setTextEditingPointerPassthrough(enabled: boolean): void {
    if (enabled) {
      if (!textEditPointerState) {
        textEditPointerState = {
          selection: selectionOverlay.style.pointerEvents,
          highlight: highlightOverlay.style.pointerEvents,
        };
      }
      syncShieldPointerEvents();
      selectionOverlay.style.pointerEvents = "none";
      highlightOverlay.style.pointerEvents = "none";
      return;
    }
    if (!textEditPointerState) return;
    selectionOverlay.style.pointerEvents = textEditPointerState.selection;
    highlightOverlay.style.pointerEvents = textEditPointerState.highlight;
    textEditPointerState = null;
    syncShieldPointerEvents();
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
        "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle],[data-agent-native-radius-handle]",
      )
      .forEach(function (node) {
        if (!(node instanceof HTMLElement)) return;
        node.style.display = visible ? "" : "none";
      });
  }

  var textCaretOverlay: HTMLElement | null = null;

  function hideTextCaretOverlay(target: Element): void {
    target.removeAttribute("data-agent-native-drawn-caret");
    if (textCaretOverlay) textCaretOverlay.style.display = "none";
  }

  function positionTextCaretOverlay(target: HTMLElement): void {
    var selection = window.getSelection ? window.getSelection() : null;
    var range =
      selection &&
      selection.isCollapsed &&
      selectionBelongsToElement(selection, target)
        ? selection.getRangeAt(0)
        : null;
    var rect = range ? range.getClientRects()[0] : undefined;
    if (!range || !rect || rect.height <= 0) {
      hideTextCaretOverlay(target);
      return;
    }
    if (!textCaretOverlay) {
      textCaretOverlay = document.createElement("div");
      textCaretOverlay.setAttribute(
        "data-agent-native-edit-overlay",
        "text-caret",
      );
      textCaretOverlay.style.cssText =
        "position:fixed;pointer-events:none;z-index:99999;display:none;";
      appendEditorChromeNode(textCaretOverlay);
    }
    var caretHost =
      range.startContainer.nodeType === 1
        ? (range.startContainer as Element)
        : range.startContainer.parentElement || target;
    var width = chromeLineScale();
    var moved =
      textCaretOverlay.style.display === "none" ||
      textCaretOverlay.style.left !== rect.left - width / 2 + "px" ||
      textCaretOverlay.style.top !== rect.top + "px";
    textCaretOverlay.style.left = rect.left - width / 2 + "px";
    textCaretOverlay.style.top = rect.top + "px";
    textCaretOverlay.style.width = width + "px";
    textCaretOverlay.style.height = rect.height + "px";
    textCaretOverlay.style.background =
      window.getComputedStyle(caretHost).color;
    textCaretOverlay.style.display = "block";
    if (!target.hasAttribute("data-agent-native-drawn-caret")) {
      target.setAttribute("data-agent-native-drawn-caret", "");
    }
    if (moved && textCaretOverlay.animate) {
      textCaretOverlay.getAnimations().forEach(function (animation) {
        animation.cancel();
      });
      textCaretOverlay.animate(
        [
          { opacity: 1 },
          { opacity: 1, offset: 0.5 },
          { opacity: 0, offset: 0.5 },
          { opacity: 0 },
        ],
        { duration: 1060, iterations: Infinity, delay: 500 },
      );
    }
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
      positionTextCaretOverlay(target);
      return;
    }
    hideTextCaretOverlay(target);
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
    return (
      [
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
    var nativeTextRoot = nativeTextPrimitiveForHit(hit);
    if (nativeTextRoot) return nativeTextRoot;
    var selectedContainsHit =
      selectedEl && selectedEl.contains && selectedEl.contains(hit);
    var selectedGroupOwnsHit = !!(
      selectedContainsHit &&
      selectionTargetForHit(hit) === selectedEl &&
      selectionTargetForHit(hit, true) !== selectedEl
    );
    if (
      selectedContainsHit &&
      hasOnlyInlineEditableChildren(selectedEl) &&
      !selectedGroupOwnsHit
    )
      return selectedEl;

    var candidate = null;
    var node = hit;
    while (
      node &&
      node.nodeType === 1 &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      if (selectedGroupOwnsHit && node === selectedEl) break;
      if (hasOnlyInlineEditableChildren(node)) {
        candidate = node;
      }
      if (selectedEl && node === selectedEl) break;
      node = node.parentElement;
    }
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
    if (e.detail >= 2) return;
    var target = elementFromEditorPoint(e.clientX, e.clientY);
    if (!target && lastEditorPointWasBlocked) return;
    if (
      !target ||
      target === document.body ||
      target === document.documentElement
    ) {
      clearRuntimeSelection();
      (window.parent as Window).postMessage({ type: "clear-selection" }, "*");
      return;
    }
    hoveredSpacingHandleKey = "";
    var resolvedClickTarget =
      e.metaKey || e.ctrlKey
        ? selectionTargetForHit(target)
        : plainClickSelectionTarget(target);
    var toggled = resolveShiftClickToggleOff(resolvedClickTarget, e);
    if (toggled !== undefined) {
      postToggledSelection(toggled);
      return;
    }
    var previousSelectedEl = selectedEl;
    selectedEl = resolvedClickTarget;
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
    if (activeMarqueeSelection.moveFrame != null) {
      window.cancelAnimationFrame(activeMarqueeSelection.moveFrame);
      activeMarqueeSelection.moveFrame = null;
    }
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
    final?: boolean,
    infoCache?: Map<Element, unknown> | null,
    lightInfoCache?: Map<Element, unknown> | null,
  ): void {
    function lightInfo(el: Element): unknown {
      if (!lightInfoCache) return getLightElementInfo(el, true);
      var cached = lightInfoCache.get(el);
      if (cached === undefined) {
        cached = getLightElementInfo(el, true);
        lightInfoCache.set(el, cached);
      }
      return cached;
    }
    (window.parent as Window).postMessage(
      {
        type: "agent-native:layer-marquee-selection",
        phase: "change",
        payload: elements.map(function (el) {
          if (!final) return lightInfo(el);
          if (!infoCache) return getElementInfo(el);
          var cached = infoCache.get(el);
          if (cached === undefined) {
            cached = getElementInfo(el);
            infoCache.set(el, cached);
          }
          return cached;
        }),
        intent: {
          additive: additive,
          range: Boolean(e && e.shiftKey),
          source: "marquee",
          shiftKey: Boolean(e && e.shiftKey),
          metaKey: Boolean(e && e.metaKey),
          ctrlKey: Boolean(e && e.ctrlKey),
          final: final === true,
        },
      },
      "*",
    );
  }

  function updateMarqueeSelection(e, final?: boolean): void {
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

    if (!activeMarqueeSelection.candidates) {
      var collected = collectSelectableElements(activeMarqueeSelection.deep);
      activeMarqueeSelection.candidates = collected;
      activeMarqueeSelection.candidateBounds = collected.map(selectableBounds);
    }
    var candidates = activeMarqueeSelection.candidates;
    var candidateBounds = activeMarqueeSelection.candidateBounds || [];
    var hitElements: Element[] = [];
    for (var index = 0; index < candidates.length; index += 1) {
      var bounds = candidateBounds[index];
      if (!bounds) continue;
      if (
        bounds.left <= rect.left &&
        bounds.top <= rect.top &&
        bounds.right >= rect.right &&
        bounds.bottom >= rect.bottom
      ) {
        continue;
      }
      if (rectsIntersect(rect, bounds)) {
        hitElements.push(candidates[index]!);
      }
    }
    var primary = hitElements[hitElements.length - 1] || null;
    if (primary) {
      selectedEl = primary;
      positionOverlay(selectionOverlay, primary);
    } else if (!activeMarqueeSelection.additive) {
      selectedEl = null;
      hideSelectionOverlay();
    }
    setPassiveSelectionElements(hitElements);
    var lastReported = activeMarqueeSelection.lastReportedElements;
    var sameHitSet =
      !!lastReported &&
      lastReported.length === hitElements.length &&
      hitElements.every(function (el, index) {
        return lastReported![index] === el;
      });
    if (!final && sameHitSet) return;
    activeMarqueeSelection.lastReportedElements = hitElements;
    postElementMarqueeSelect(
      hitElements,
      activeMarqueeSelection.additive,
      e,
      final,
      activeMarqueeSelection.infoCache,
      activeMarqueeSelection.lightInfoCache,
    );
  }

  function beginMarqueeSelection(e): void {
    if (e.button !== 0) return;
    if (activeTextEditEl && !exitStaleTextEditSession()) return;
    clearActiveMarqueeSelection();
    var events = dragEventNames(e);
    var additive = Boolean(e && (e.metaKey || e.ctrlKey || e.shiftKey));
    function flushMarqueeMove() {
      var session = activeMarqueeSelection;
      if (!session) return;
      if (session.moveFrame != null) {
        window.cancelAnimationFrame(session.moveFrame);
        session.moveFrame = null;
      }
      var ev = session.pendingMoveEvent;
      if (!ev) return;
      session.pendingMoveEvent = null;
      updateMarqueeSelection(ev);
    }
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
      activeMarqueeSelection.pendingMoveEvent = ev;
      if (activeMarqueeSelection.moveFrame != null) return;
      activeMarqueeSelection.moveFrame = window.requestAnimationFrame(
        function () {
          if (!activeMarqueeSelection) return;
          activeMarqueeSelection.moveFrame = null;
          flushMarqueeMove();
        },
      );
    }
    function onUp(ev) {
      var didMove = Boolean(activeMarqueeSelection?.moved);
      if (didMove) {
        stopNativeInteraction(ev);
        if (
          activeMarqueeSelection &&
          activeMarqueeSelection.moveFrame != null
        ) {
          window.cancelAnimationFrame(activeMarqueeSelection.moveFrame);
          activeMarqueeSelection.moveFrame = null;
        }
        if (activeMarqueeSelection)
          activeMarqueeSelection.pendingMoveEvent = null;
        updateMarqueeSelection(ev, true);
        suppressNextShieldClickBriefly();
      }
      marqueeSelectionOverlay.style.display = "none";
      clearActiveMarqueeSelection();
    }
    activeMarqueeSelection = {
      startX: e.clientX,
      startY: e.clientY,
      additive: additive,
      deep: Boolean(e && (e.metaKey || e.ctrlKey)),
      moved: false,
      infoCache: new Map<Element, unknown>(),
      lightInfoCache: new Map<Element, unknown>(),
      moveFrame: null,
      pendingMoveEvent: null,
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

  var LAYER_LABEL_SEMANTIC_ATTRIBUTES = [
    "aria-label",
    "title",
    "data-code-layer-id",
    "data-layer-id",
    "data-name",
    "data-component",
    "data-screen",
    "data-testid",
    "data-test-id",
  ];

  function fallbackTagLayerLabel(tag: string): string {
    switch (tag) {
      case "article":
        return "Article";
      case "aside":
        return "Aside";
      case "body":
        return "Body";
      case "button":
        return "Button";
      case "div":
        return "Frame";
      case "footer":
        return "Footer";
      case "form":
        return "Form";
      case "header":
        return "Header";
      case "a":
        return "Link";
      case "img":
      case "picture":
        return "Image";
      case "input":
        return "Input";
      case "label":
        return "Label";
      case "main":
        return "Main";
      case "select":
        return "Select";
      case "textarea":
        return "Text area";
      case "nav":
        return "Navigation";
      case "section":
        return "Section";
      case "svg":
        return "Vector";
      case "ul":
      case "ol":
        return "List";
      case "li":
        return "List item";
      case "em":
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
      case "p":
      case "span":
      case "strong":
        return "Text";
      default:
        return tag.toUpperCase();
    }
  }

  function layerCandidateLabelFor(
    candidate: Element,
    candidateInfo: { componentName?: string },
  ): string {
    var explicitLabel = layerNameForElement(candidate);
    if (explicitLabel) return explicitLabel;
    if (candidateInfo.componentName) return candidateInfo.componentName;
    for (var i = 0; i < LAYER_LABEL_SEMANTIC_ATTRIBUTES.length; i += 1) {
      var semanticValue =
        candidate.getAttribute &&
        candidate.getAttribute(LAYER_LABEL_SEMANTIC_ATTRIBUTES[i]);
      if (semanticValue) return semanticValue;
    }
    if (candidate.id) return candidate.id;
    if (candidate.children.length === 0) {
      var textLabel = (candidate.textContent || "").trim().replace(/\s+/g, " ");
      if (textLabel && textLabel.length <= 48) return textLabel;
    }
    return fallbackTagLayerLabel(candidate.tagName.toLowerCase());
  }

  function collectLayerHitCandidates(
    clientX: number,
    clientY: number,
  ): {
    elements: Element[];
    layerCandidates: Array<{ key: string; label: string; info: unknown }>;
  } {
    var shieldPointerEvents = shieldOverlay.style.pointerEvents;
    var selectionPointerEvents = selectionOverlay.style.pointerEvents;
    var highlightPointerEvents = highlightOverlay.style.pointerEvents;
    shieldOverlay.style.pointerEvents = "none";
    selectionOverlay.style.pointerEvents = "none";
    highlightOverlay.style.pointerEvents = "none";
    var pointTargets = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)];
    shieldOverlay.style.pointerEvents = shieldPointerEvents;
    selectionOverlay.style.pointerEvents = selectionPointerEvents;
    highlightOverlay.style.pointerEvents = highlightPointerEvents;

    var elements: Element[] = [];
    var layerCandidates: Array<{
      key: string;
      label: string;
      info: unknown;
    }> = [];
    pointTargets.forEach(function (pointTarget) {
      if (!pointTarget || pointTarget.nodeType !== 1) return;
      if (isOverlayElement(pointTarget)) return;
      var candidate = selectionTargetForHit(pointTarget);
      if (
        !candidate ||
        isDocumentRootElement(candidate) ||
        isOverlayElement(candidate) ||
        isLayerInteractionBlocked(candidate) ||
        isTemplateCloneElement(candidate) ||
        elements.indexOf(candidate) !== -1
      ) {
        return;
      }
      elements.push(candidate);
      var candidateInfo = getElementInfo(candidate);
      var label = layerCandidateLabelFor(candidate, candidateInfo);
      var identity =
        candidateInfo.sourceId ||
        candidateInfo.selector ||
        String(layerCandidates.length);
      layerCandidates.push({
        key: String(identity) + ":" + String(layerCandidates.length),
        label: String(label).slice(0, 80),
        info: candidateInfo,
      });
    });
    return { elements: elements, layerCandidates: layerCandidates };
  }

  function stackCycleTarget(
    clientX: number,
    clientY: number,
    currentEl: Element | null,
  ): Element | null {
    if (!currentEl) return null;
    var stack = collectLayerHitCandidates(clientX, clientY);
    var currentIdx = stack.elements.indexOf(currentEl);
    if (currentIdx === -1) return null;
    var keys = stack.layerCandidates.map(function (candidate) {
      return candidate.key;
    });
    var nextKey = nextStackCandidate(
      keys,
      stack.layerCandidates[currentIdx].key,
    );
    if (nextKey === null) return null;
    var nextEl = stack.elements[keys.indexOf(nextKey)];
    return nextEl && !isLayerInteractionBlocked(nextEl) ? nextEl : null;
  }

  function openContextMenuAtEvent(e) {
    stopNativeInteraction(e);
    blurActiveTextEditor();
    var collected = collectLayerHitCandidates(e.clientX, e.clientY);
    var candidateElements = collected.elements;
    var layerCandidates = collected.layerCandidates;

    var target = candidateElements[0] || null;
    var info = null;
    if (target) {
      hoveredSpacingHandleKey = "";
      selectedEl = selectionTargetForHit(target);
      if (selectedEl && !isLayerInteractionBlocked(selectedEl)) {
        info = getElementInfo(selectedEl);
        positionOverlay(selectionOverlay, selectedEl);
      } else {
        selectedEl = null;
        hideSelectionOverlay();
      }
    }
    (window.parent as Window).postMessage(
      {
        type: "element-contextmenu",
        screenId: designCanvasScreenId,
        clientX: e.clientX,
        clientY: e.clientY,
        payload: info,
        layerCandidates: layerCandidates,
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
    if (selectedEl && document.documentElement.contains(selectedEl)) {
      try {
        ensureRuntimeLayerNodeId(selectedEl);
        if (matchesExactSelectorList(selectedEl, candidates)) return selectedEl;
      } catch (_err) {}
    }
    return null;
  }

  function parseNodeHtmlPreviewElement(html: string): Element | null {
    var trimmed = html.trim();
    if (/^<body(?:\s|>)/i.test(trimmed)) {
      var parsedDocument = new DOMParser().parseFromString(
        "<!doctype html><html><head></head>" + trimmed + "</html>", // i18n-ignore parser scaffold
        "text/html",
      );
      return parsedDocument.body;
    }
    var template = document.createElement("template");
    template.innerHTML = html;
    var element = template.content.firstElementChild;
    if (!element || template.content.childElementCount !== 1) return null;
    for (
      var child = template.content.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (child === element) continue;
      if (child.nodeType !== 3 || String(child.textContent || "").trim()) {
        return null;
      }
    }
    return element;
  }

  function resolveNodeHtmlPreviewTarget(target: unknown): Element | null {
    if (!target || typeof target !== "object") return null;
    var nodeId = (target as { nodeId?: unknown }).nodeId;
    if (typeof nodeId === "string" && nodeId) {
      try {
        var nodeMatch = document.querySelector(
          '[data-agent-native-node-id="' + escapeAttribute(nodeId) + '"]',
        );
        if (nodeMatch && !isLayerInteractionBlocked(nodeMatch)) {
          return nodeMatch;
        }
      } catch (_err) {}
    }
    var selector = (target as { selector?: unknown }).selector;
    if (typeof selector !== "string" || !selector) return null;
    try {
      var selectorMatch = document.querySelector(selector);
      return selectorMatch && !isLayerInteractionBlocked(selectorMatch)
        ? selectorMatch
        : null;
    } catch (_err) {
      return null;
    }
  }

  function postNodeHtmlPreviewApplied(proposalId: string): void {
    (window.parent as Window).postMessage(
      {
        type: "agent-native:node-html-preview-applied",
        proposalId: proposalId,
      },
      "*",
    );
  }

  function replaceNodeHtmlPreviewElement(
    session: NodeHtmlPreviewSession,
    nextElement: Element,
  ): boolean {
    var parent = session.startMarker.parentNode;
    if (!parent || session.endMarker.parentNode !== parent) return false;
    var cursor = session.startMarker.nextSibling;
    while (cursor && cursor !== session.endMarker) {
      var next = cursor.nextSibling;
      parent.removeChild(cursor);
      cursor = next;
    }
    if (cursor !== session.endMarker) return false;
    nextElement.setAttribute(
      "data-agent-native-node-rewrite-proposal",
      session.proposalId,
    );
    parent.insertBefore(nextElement, session.endMarker);
    publishSourceDocumentProvenance(undefined, true);
    session.currentElement = nextElement;
    if (session.selectedWasInside) selectedEl = nextElement;
    if (session.hoveredWasInside) hoveredEl = nextElement;
    refreshOverlays();
    return true;
  }

  function restoreActiveNodeHtmlPreview(proposalId?: string): boolean {
    var session = activeNodeHtmlPreview;
    if (!session || (proposalId && session.proposalId !== proposalId)) {
      return false;
    }
    activeNodeHtmlPreview = null;
    var parent = session.startMarker.parentNode;
    if (!parent || session.endMarker.parentNode !== parent) return false;
    var cursor = session.startMarker.nextSibling;
    while (cursor && cursor !== session.endMarker) {
      var next = cursor.nextSibling;
      parent.removeChild(cursor);
      cursor = next;
    }
    if (cursor !== session.endMarker) return false;
    parent.insertBefore(session.originalElement, session.endMarker);
    parent.removeChild(session.startMarker);
    parent.removeChild(session.endMarker);
    if (session.selectedWasInside) selectedEl = session.originalElement;
    if (session.hoveredWasInside) hoveredEl = session.originalElement;
    refreshOverlays();
    return session.originalElement.outerHTML === session.originalOuterHTML;
  }

  function applyNodeHtmlPreview(data: {
    proposalId?: unknown;
    target?: unknown;
    html?: unknown;
  }): void {
    var proposalId = data.proposalId;
    if (
      typeof proposalId !== "string" ||
      !proposalId ||
      typeof data.html !== "string"
    ) {
      return;
    }
    var nextElement = parseNodeHtmlPreviewElement(data.html);
    if (!nextElement) return;
    if (
      activeNodeHtmlPreview &&
      activeNodeHtmlPreview.proposalId === proposalId
    ) {
      if (replaceNodeHtmlPreviewElement(activeNodeHtmlPreview, nextElement)) {
        postNodeHtmlPreviewApplied(proposalId);
      }
      return;
    }
    if (activeNodeHtmlPreview) restoreActiveNodeHtmlPreview();
    var target = resolveNodeHtmlPreviewTarget(data.target);
    if (!target || !target.parentNode || target === document.documentElement) {
      return;
    }
    var originalOuterHTML = target.outerHTML;
    nextElement.setAttribute(
      "data-agent-native-node-rewrite-proposal",
      proposalId,
    );
    var startMarker = document.createComment(
      "agent-native:node-html-preview:start",
    );
    var endMarker = document.createComment(
      "agent-native:node-html-preview:end",
    );
    var parent = target.parentNode;
    var selectedWasInside = !!selectedEl && target.contains(selectedEl);
    var hoveredWasInside = !!hoveredEl && target.contains(hoveredEl);
    parent.insertBefore(startMarker, target);
    parent.insertBefore(endMarker, target.nextSibling);
    parent.replaceChild(nextElement, target);
    publishSourceDocumentProvenance(undefined, true);
    activeNodeHtmlPreview = {
      proposalId: proposalId,
      originalElement: target,
      originalOuterHTML: originalOuterHTML,
      startMarker: startMarker,
      endMarker: endMarker,
      currentElement: nextElement,
      selectedWasInside: selectedWasInside,
      hoveredWasInside: hoveredWasInside,
    };
    if (selectedWasInside) selectedEl = nextElement;
    if (hoveredWasInside) hoveredEl = nextElement;
    refreshOverlays();
    postNodeHtmlPreviewApplied(proposalId);
  }

  function findUniqueRuntimeStructureTarget(
    selector,
    sourceId,
    pendingId?,
    allowDocumentBody = false,
  ) {
    var matches = new Set<Element>();
    if (typeof pendingId === "string" && pendingId) {
      try {
        var pendingMatches = document.querySelectorAll(
          '[data-an-pending-node-id="' + escapeAttribute(pendingId) + '"]',
        );
        if (pendingMatches.length === 1) {
          var pendingMatch = pendingMatches[0];
          if (
            pendingMatch !== document.documentElement &&
            (allowDocumentBody || pendingMatch !== document.body) &&
            !isOverlayElement(pendingMatch) &&
            !isLayerInteractionBlocked(pendingMatch)
          ) {
            return pendingMatch;
          }
        }
      } catch (_err) {}
    }
    if (typeof sourceId === "string" && sourceId) {
      var attributes = [
        "data-agent-native-node-id",
        "data-code-layer-id",
        "data-layer-id",
        "data-builder-id",
        "data-loc",
        "id",
      ];
      for (var i = 0; i < attributes.length; i += 1) {
        try {
          var sourceMatches = document.querySelectorAll(
            "[" + attributes[i] + '=\"' + escapeAttribute(sourceId) + '\"]',
          );
          for (var j = 0; j < sourceMatches.length; j += 1) {
            matches.add(sourceMatches[j]);
          }
        } catch (_err) {}
      }
      if (matches.size > 1) return null;
      if (matches.size === 1) {
        var sourceMatch = Array.from(matches)[0];
        return sourceMatch &&
          sourceMatch !== document.documentElement &&
          (allowDocumentBody || sourceMatch !== document.body) &&
          !isOverlayElement(sourceMatch) &&
          !isLayerInteractionBlocked(sourceMatch)
          ? sourceMatch
          : null;
      }
    }
    if (typeof selector !== "string" || !selector) {
      return allowDocumentBody &&
        !(typeof sourceId === "string" && sourceId) &&
        !(typeof pendingId === "string" && pendingId)
        ? document.body
        : null;
    }
    try {
      var selectorMatches = document.querySelectorAll(selector);
      if (selectorMatches.length !== 1) return null;
      var selectorMatch = selectorMatches[0];
      return selectorMatch !== document.documentElement &&
        (allowDocumentBody || selectorMatch !== document.body) &&
        !isOverlayElement(selectorMatch) &&
        !isLayerInteractionBlocked(selectorMatch)
        ? selectorMatch
        : null;
    } catch (_err) {
      return null;
    }
  }

  function removeRuntimeTarget(
    selector,
    selectorCandidates,
    requestId?,
    transactionId?,
  ) {
    var target = findRuntimeTarget(selector, selectorCandidates);
    if (
      !target ||
      target === document.body ||
      target === document.documentElement
    ) {
      if (typeof requestId === "string" && requestId) {
        (window.parent as Window).postMessage(
          {
            type: "runtime-element-delete-rejected",
            requestId: requestId,
            transactionId: transactionId,
            routePath: window.location.pathname + window.location.search,
            reason: "target-unresolved",
          },
          "*",
        );
      }
      return false;
    }
    if (typeof requestId === "string" && requestId) {
      restorePendingRuntimeDeleteStyle(target, requestId);
    }
    if (typeof requestId === "string" && requestId && target.parentElement) {
      pendingStructureMoves[requestId] = {
        requestId: requestId,
        el: target,
        target: null,
        origin: {
          removed: true,
          prevParent: target.parentElement,
          prevNextSibling: target.nextSibling,
        },
      };
    }
    if (target.parentElement) target.parentElement.removeChild(target);
    publishSourceDocumentProvenance(undefined, true);
    if (typeof requestId === "string" && requestId) {
      (window.parent as Window).postMessage(
        {
          type: "runtime-element-deleted",
          requestId: requestId,
          transactionId: transactionId,
          routePath: window.location.pathname + window.location.search,
          selector: getSelector(target),
          sourceId: getSourceId(target),
          payload: getElementInfo(target),
        },
        "*",
      );
    }
    exitStaleTextEditSession();
    if (
      selectedEl === target ||
      !document.documentElement.contains(selectedEl)
    ) {
      selectedEl = null;
      hideSelectionOverlay();
    }
    clearHoverGate();
    highlightOverlay.style.display = "none";
    hideMeasurements();
    refreshOverlays();
    return true;
  }

  function restorePendingRuntimeDeleteStyle(target, requestId) {
    if (!(target instanceof HTMLElement || target instanceof SVGElement)) {
      return;
    }
    var attribute = "data-agent-native-pending-delete-style";
    var encoded = target.getAttribute(attribute);
    if (!encoded) return;
    var snapshot: {
      requestId: string;
      properties: Record<string, { value: string; priority: string }>;
    };
    try {
      snapshot = JSON.parse(encoded);
    } catch (error) {
      console.warn("[design:bridge] pending delete style is invalid", error);
      return;
    }
    if (!snapshot.properties || typeof snapshot.requestId !== "string") {
      console.warn("[design:bridge] pending delete style is incomplete");
      return;
    }
    if (snapshot.requestId !== requestId) return;
    var originalTransition = snapshot.properties.transition;
    target.style.setProperty("transition", "none", "important");
    Object.entries(snapshot.properties).forEach(([property, original]) => {
      if (property === "transition") return;
      if (original.value) {
        target.style.setProperty(property, original.value, original.priority);
      } else {
        target.style.removeProperty(property);
      }
    });
    target.removeAttribute(attribute);
    target.getBoundingClientRect();
    requestAnimationFrame(function () {
      if (originalTransition.value) {
        target.style.setProperty(
          "transition",
          originalTransition.value,
          originalTransition.priority,
        );
      } else {
        target.style.removeProperty("transition");
      }
    });
  }

  function concealPendingRuntimeDelete(
    selector,
    selectorCandidates,
    requestId,
  ) {
    if (typeof requestId !== "string" || !requestId) return;
    var target = findRuntimeTarget(selector, selectorCandidates);
    if (!(target instanceof HTMLElement || target instanceof SVGElement))
      return;
    var attribute = "data-agent-native-pending-delete-style";
    var encoded = target.getAttribute(attribute);
    if (encoded) {
      try {
        var existing = JSON.parse(encoded);
        if (existing.requestId === requestId) return;
        restorePendingRuntimeDeleteStyle(target, existing.requestId);
      } catch (error) {
        console.warn("[design:bridge] pending delete style is invalid", error);
        target.removeAttribute(attribute);
      }
    }
    var properties = ["opacity", "pointer-events", "transition"];
    var snapshot = {
      requestId: requestId,
      properties: Object.fromEntries(
        properties.map(function (property) {
          return [
            property,
            {
              value: target.style.getPropertyValue(property),
              priority: target.style.getPropertyPriority(property),
            },
          ];
        }),
      ),
    };
    target.setAttribute(attribute, JSON.stringify(snapshot));
    target.style.setProperty("opacity", "0", "important");
    target.style.setProperty("pointer-events", "none", "important");
    target.style.setProperty("transition", "none", "important");
  }

  function readPx(value: string): number {
    var num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
  }

  function resolveCornerRadiusComponent(part, axisSize) {
    if (!part) return 0;
    if (part.charAt(part.length - 1) === "%") {
      var pct = parseFloat(part) || 0;
      return (pct / 100) * axisSize;
    }
    return readPx(part);
  }

  function resolveCornerRadiusXY(value, width, height) {
    var trimmed = typeof value === "string" ? value.trim() : "";
    var parts = trimmed.split(/\s+/);
    return {
      x: resolveCornerRadiusComponent(parts[0], width),
      y: resolveCornerRadiusComponent(
        parts.length > 1 ? parts[1] : parts[0],
        height,
      ),
    };
  }

  function isDirectCornerRadiusValue(value) {
    var trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) return false;
    var parts = trimmed.split(/\s+/);
    return (
      parts.length <= 2 &&
      parts.every(function (part) {
        return (
          /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:px|%)$/i.test(part) ||
          /^[-+]?0(?:\.0*)?$/.test(part)
        );
      })
    );
  }

  function borderBoxDimensions(cs) {
    var width = readPx(cs.width);
    var height = readPx(cs.height);
    if (cs.boxSizing === "border-box") return { width: width, height: height };
    width +=
      readPx(cs.paddingLeft) +
      readPx(cs.paddingRight) +
      readPx(cs.borderLeftWidth) +
      readPx(cs.borderRightWidth);
    height +=
      readPx(cs.paddingTop) +
      readPx(cs.paddingBottom) +
      readPx(cs.borderTopWidth) +
      readPx(cs.borderBottomWidth);
    return { width: width, height: height };
  }

  function radiusLinearTransformForStyle(cs) {
    var transform = { a: 1, b: 0, c: 0, d: 1 };
    if (cs.transform && cs.transform !== "none" && window.DOMMatrixReadOnly) {
      try {
        var matrix = new DOMMatrixReadOnly(cs.transform);
        transform = { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d };
      } catch (err) {
        void err;
      }
    }
    var scaleParts = (cs.scale || cs.getPropertyValue("scale") || "none")
      .trim()
      .split(/\s+/)
      .map(function (part) {
        return parseFloat(part);
      });
    var scaleX = Number.isFinite(scaleParts[0]) ? scaleParts[0] : 1;
    var scaleY = Number.isFinite(scaleParts[1]) ? scaleParts[1] : scaleX;
    var angle = independentRotation(cs.rotate || "");
    var radians = (angle * Math.PI) / 180;
    var result = composeRadiusLinearTransform(
      transform,
      scaleX,
      scaleY,
      radians,
    );
    var zoom = parseFloat(cs.zoom || cs.getPropertyValue("zoom"));
    if (Number.isFinite(zoom) && zoom > 0) {
      result.a *= zoom;
      result.b *= zoom;
      result.c *= zoom;
      result.d *= zoom;
    }
    return result;
  }

  function radiusLinearTransform(el) {
    return radiusLinearTransformForStyle(window.getComputedStyle(el));
  }

  function composeRadiusLinearTransform(transform, scaleX, scaleY, radians) {
    var cos = Math.cos(radians);
    var sin = Math.sin(radians);
    var independent = {
      a: cos * scaleX,
      b: sin * scaleY,
      c: -sin * scaleX,
      d: cos * scaleY,
    };
    return {
      a: independent.a * transform.a + independent.c * transform.b,
      b: independent.b * transform.a + independent.d * transform.b,
      c: independent.a * transform.c + independent.c * transform.d,
      d: independent.b * transform.c + independent.d * transform.d,
    };
  }

  function multiplyRadiusLinear(parent, child) {
    return {
      a: parent.a * child.a + parent.c * child.b,
      b: parent.b * child.a + parent.d * child.b,
      c: parent.a * child.c + parent.c * child.d,
      d: parent.b * child.c + parent.d * child.d,
    };
  }

  function radiusViewportLinearTransform(el) {
    var total = { a: 1, b: 0, c: 0, d: 1 };
    for (
      var current = el;
      current && current.nodeType === 1;
      current = current.parentElement
    ) {
      total = multiplyRadiusLinear(radiusLinearTransform(current), total);
    }
    return total;
  }

  function radiusLocalDelta(el, screenDx, screenDy) {
    var matrix = radiusViewportLinearTransform(el);
    var determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 0.0001) {
      return { x: screenDx, y: screenDy };
    }
    return {
      x: (matrix.d * screenDx - matrix.c * screenDy) / determinant,
      y: (-matrix.b * screenDx + matrix.a * screenDy) / determinant,
    };
  }

  function cornerRadiusMap(cs, width, height) {
    return {
      nw: resolveCornerRadiusXY(cs.borderTopLeftRadius, width, height),
      ne: resolveCornerRadiusXY(cs.borderTopRightRadius, width, height),
      se: resolveCornerRadiusXY(cs.borderBottomRightRadius, width, height),
      sw: resolveCornerRadiusXY(cs.borderBottomLeftRadius, width, height),
    };
  }

  function radiusDragMaximums(corner, radii, width, height) {
    var horizontalNeighbor =
      corner === "nw"
        ? radii.ne.x
        : corner === "ne"
          ? radii.nw.x
          : corner === "se"
            ? radii.sw.x
            : radii.se.x;
    var verticalNeighbor =
      corner === "nw"
        ? radii.sw.y
        : corner === "ne"
          ? radii.se.y
          : corner === "se"
            ? radii.ne.y
            : radii.nw.y;
    return {
      x: Math.max(0, Math.min(width / 2, width - horizontalNeighbor)),
      y: Math.max(0, Math.min(height / 2, height - verticalNeighbor)),
    };
  }

  var CORNER_RADIUS_PROPERTY_BY_HANDLE = {
    nw: "borderTopLeftRadius",
    ne: "borderTopRightRadius",
    se: "borderBottomRightRadius",
    sw: "borderBottomLeftRadius",
  };

  function readFinitePx(value) {
    if (!value || value === "auto") return null;
    var num = parseFloat(value);
    return Number.isFinite(num) ? num : null;
  }


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

  function rotationFromTransform(transform) {
    var match = transform.match(/rotate(?:Z)?\((-?\d+(?:\.\d+)?)deg\)/i);
    if (match) return parseFloat(match[1]) || 0;
    if (transform && transform !== "none" && window.DOMMatrixReadOnly) {
      try {
        var matrix = new DOMMatrixReadOnly(transform);
        return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
      } catch (err) {}
    }
    return 0;
  }

  function independentRotation(rotate) {
    var match = rotate.match(
      /^(?:z\s+)?(-?\d+(?:\.\d+)?)(deg|grad|rad|turn)$/i,
    );
    if (!match) return 0;
    var value = parseFloat(match[1]) || 0;
    var unit = match[2].toLowerCase();
    if (unit === "grad") return value * 0.9;
    if (unit === "rad") return (value * 180) / Math.PI;
    if (unit === "turn") return value * 360;
    return value;
  }

  function currentRotation(el) {
    var computed = window.getComputedStyle(el);
    return (
      rotationFromTransform(computed.transform || "") +
      independentRotation(computed.rotate || "")
    );
  }

  function mergeAbsoluteRotation(transform, degrees) {
    var rotatePattern = /rotate(?:Z)?\((-?\d+(?:\.\d+)?)deg\)/i;
    if (rotatePattern.test(transform)) {
      return transform
        .replace(rotatePattern, "rotate(" + degrees + "deg)")
        .trim();
    }
    if (/^matrix(?:3d)?\(/i.test(transform.trim())) {
      return "rotate(" + degrees + "deg)";
    }
    return (
      (transform && transform !== "none" ? transform + " " : "") +
      "rotate(" +
      degrees +
      "deg)"
    ).trim();
  }

  function readScalePair(value) {
    if (!value || value === "none") return { x: 1, y: 1 };
    var parts = value
      .trim()
      .split(/\s+/)
      .map(function (part) {
        return parseFloat(part);
      });
    var x = parts[0];
    var y = parts.length > 1 ? parts[1] : x;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: x, y: y };
  }

  function mergeRelativeScale(scale, flipX, flipY) {
    var pair = readScalePair(scale) || { x: 1, y: 1 };
    return (flipX ? -pair.x : pair.x) + " " + (flipY ? -pair.y : pair.y);
  }

  function mergeFlipIntoTransform(transform, flipX, flipY) {
    var base = transform && transform !== "none" ? transform : "";
    var suffix =
      (flipX ? " matrix(-1, 0, 0, 1, 0, 0)" : "") +
      (flipY ? " matrix(1, 0, 0, -1, 0, 0)" : "");
    return (base + suffix).trim();
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
        originalStyles: originalInlineStylesForPatch(selectedEl, styles),
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
      (handle.kind === "padding" &&
        (handle.side === "right" || handle.side === "bottom")) ||
      (handle.kind === "margin" &&
        (handle.side === "left" || handle.side === "top"))
    ) {
      delta = -delta;
    }
    return clampSpacingValue(originValue + delta, handle.kind === "margin");
  }

  var paddingProperties = [
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
  ];
  var marginProperties = [
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
  ];

  function propertiesForSpacingHandle(handle) {
    if (handle.kind === "margin") return marginProperties;
    if (handle.kind === "padding") return paddingProperties;
    return [handle.property];
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
    syncAllSides: boolean,
  ): void {
    if (!target || !handle) return;
    var properties = propertiesForSpacingHandle(handle);
    if (syncAllSides) {
      for (var i = 0; i < properties.length; i += 1) {
        target.style[properties[i]] = value + "px";
      }
      return;
    }
    target.style[handle.property] = value + "px";
    if (
      (handle.kind === "padding" || handle.kind === "margin") &&
      mirrorOpposite &&
      handle.oppositeProperty
    ) {
      target.style[handle.oppositeProperty] = value + "px";
    }
  }

  function startSpacingDrag(key, e) {
    if (readOnly) return;
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
    var spacingProperties = propertiesForSpacingHandle(handle);
    var originInlineSpacingValues = {};
    for (
      var propertyIndex = 0;
      propertyIndex < spacingProperties.length;
      propertyIndex += 1
    ) {
      var spacingProperty = spacingProperties[propertyIndex];
      originInlineSpacingValues[spacingProperty] = (
        dragEl as HTMLElement
      ).style[spacingProperty];
    }
    var syncAllSides = !!e.shiftKey;
    var startX = e.clientX;
    var startY = e.clientY;
    lastSpacingPointerPoint = { x: startX, y: startY };
    hoveredSpacingHandleKey = key;
    spacingDrag = {
      handle: handle,
      currentValue: originValue,
      mirrorOpposite: !!e.altKey,
      syncAllSides: syncAllSides,
    };
    if (syncAllSides) {
      applySpacingDragValue(dragEl, handle, originValue, !!e.altKey, true);
    }
    updateSpacingOverlay(selectedEl);
    showSpacingBadgeForHandle(handle, originValue);

    function updateSpacingDragState(
      mirrorOpposite: boolean,
      syncAllSides: boolean,
    ) {
      if (!spacingDrag) return;
      if (
        spacingDrag.mirrorOpposite === mirrorOpposite &&
        spacingDrag.syncAllSides === syncAllSides
      ) {
        return;
      }
      for (
        var propertyIndex = 0;
        propertyIndex < spacingProperties.length;
        propertyIndex += 1
      ) {
        var spacingProperty = spacingProperties[propertyIndex];
        (dragEl as HTMLElement).style[spacingProperty] =
          originInlineSpacingValues[spacingProperty];
      }
      applySpacingDragValue(
        dragEl,
        handle,
        spacingDrag.currentValue,
        mirrorOpposite,
        syncAllSides,
      );
      spacingDrag = {
        handle: handle,
        currentValue: spacingDrag.currentValue,
        mirrorOpposite: mirrorOpposite,
        syncAllSides: syncAllSides,
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
        for (
          var propertyIndex = 0;
          propertyIndex < spacingProperties.length;
          propertyIndex += 1
        ) {
          var spacingProperty = spacingProperties[propertyIndex];
          (dragEl as HTMLElement).style[spacingProperty] =
            originInlineSpacingValues[spacingProperty];
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
      if (ev.key !== "Alt" && ev.key !== "Shift") return;
      updateSpacingDragState(!!ev.altKey, !!ev.shiftKey);
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
      var syncAllSides = !!ev.shiftKey;
      spacingDrag = {
        handle: handle,
        currentValue: nextValue,
        mirrorOpposite: !!ev.altKey,
        syncAllSides: syncAllSides,
      };
      lastSpacingPointerPoint = { x: ev.clientX, y: ev.clientY };
      applySpacingDragValue(
        dragEl,
        handle,
        nextValue,
        !!ev.altKey,
        syncAllSides,
      );
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
      var syncAllSides = spacingDrag ? spacingDrag.syncAllSides : !!ev.shiftKey;
      var commitAllSides =
        (handle.kind === "padding" || handle.kind === "margin") && syncAllSides;
      if (finalValue === originValue && !commitAllSides) {
        restoreSpacingDragValue();
        return;
      }
      applySpacingDragValue(
        dragEl,
        handle,
        finalValue,
        mirrorOpposite,
        commitAllSides,
      );
      selectedEl = dragEl;
      spacingDrag = null;
      var styles = {};
      if (commitAllSides) {
        for (
          var propertyIndex = 0;
          propertyIndex < spacingProperties.length;
          propertyIndex += 1
        ) {
          styles[spacingProperties[propertyIndex]] = finalValue + "px";
        }
      } else {
        styles[handle.property] = finalValue + "px";
        if (
          (handle.kind === "padding" || handle.kind === "margin") &&
          mirrorOpposite &&
          handle.oppositeProperty
        ) {
          styles[handle.oppositeProperty] = finalValue + "px";
        }
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

  function postTextContentChange(
    el,
    value,
    html,
    originalValue,
    originalHtml,
    relativeOperations,
  ) {
    claimContentAsSource(el);
    publishSourceDocumentProvenance(undefined, true);
    (window.parent as Window).postMessage(
      {
        type: "text-content-change",
        selector: getSelector(el),
        value: value,
        html: html,
        originalValue:
          typeof originalValue === "string" ? originalValue : undefined,
        originalHtml:
          typeof originalHtml === "string" ? originalHtml : undefined,
        relativeOperations:
          relativeOperations && typeof relativeOperations === "object"
            ? relativeOperations
            : undefined,
        payload: getElementInfo(el),
      },
      "*",
    );
  }

  function postTextEditingState(
    el: Element | null,
    active: boolean,
    selectorOverride?: string,
    hasRangeOverride?: boolean,
  ): void {
    var range = active
      ? activeTextEditRange
      : suspendedTextEditRange?.target === el
        ? suspendedTextEditRange.range
        : null;
    var hasRange =
      hasRangeOverride ??
      Boolean(range && !range.collapsed && rangeBelongsToElement(range, el));
    var selector =
      selectorOverride ||
      (active
        ? activeTextEditStyleSelector
        : suspendedTextEditRange?.target === el
          ? suspendedTextEditRange.selector
          : activeTextEditStyleSelector) ||
      (el ? getSelector(el) : "");
    var computedStyles: Record<string, string> | undefined;
    var inlineStyles: Record<string, string> | undefined;
    if (el && range && hasRange && rangeBelongsToElement(range, el)) {
      var bookmark = captureTextRangeBookmark(el, range);
      if (bookmark) {
        computedStyles =
          collectTextRangeComputedStyles(el, bookmark) || undefined;
        if (computedStyles) {
          inlineStyles = collectTextRangeInlineStyles(el, bookmark);
        }
      }
    } else if (el && active) {
      var caretStyles = collectCaretTextStyles(el);
      if (caretStyles) {
        computedStyles = caretStyles.computedStyles;
        inlineStyles = caretStyles.inlineStyles;
      }
    }
    (window.parent as Window).postMessage(
      {
        type: "text-editing-state",
        active: !!active,
        selector,
        sourceId: el ? getSourceId(el) || undefined : undefined,
        hasRange,
        computedStyles,
        inlineStyles,
      },
      "*",
    );
  }

  function clearSuspendedTextEditRange(): void {
    if (!suspendedTextEditRange) return;
    var suspended = suspendedTextEditRange;
    suspendedTextEditRange = null;
    postTextEditingState(suspended.target, false, suspended.selector, false);
  }

  function insertPlainTextAtSelection(text: string): boolean {
    if (!text) return false;
    if (
      document.queryCommandSupported &&
      document.queryCommandSupported("insertText")
    ) {
      var executed = false;
      try {
        executed = document.execCommand("insertText", false, text) === true;
      } catch (_err) {
        executed = false;
      }
      if (executed) return true;
    }
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    if (!selection || selection.rangeCount === 0) return false;
    var range = selection.getRangeAt(0);
    range.deleteContents();
    var textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
    return textNode.isConnected === true;
  }

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
    return rangeBelongsToElement(selection.getRangeAt(0), el);
  }

  function rangeBelongsToElement(
    range: Range | null,
    el: Element | null,
  ): boolean {
    if (!range || !el) return false;
    var ancestor = range.commonAncestorContainer;
    var ancestorEl =
      ancestor && ancestor.nodeType === 1
        ? ancestor
        : ancestor && ancestor.parentElement;
    return !!(ancestorEl && (ancestorEl === el || el.contains(ancestorEl)));
  }

  function textOffsetInElement(
    root: Element,
    node: Node,
    offset: number,
  ): number | null {
    if (node !== root && !root.contains(node)) return null;
    var prefix = document.createRange();
    prefix.selectNodeContents(root);
    try {
      prefix.setEnd(node, offset);
      return prefix.toString().length;
    } catch (error) {
      if (error instanceof DOMException && error.name === "IndexSizeError") {
        return null;
      }
      throw error;
    }
  }

  function captureTextRangeBookmark(
    root: Element,
    range: Range,
  ): { start: number; end: number; text: string } | null {
    if (range.collapsed || !rangeBelongsToElement(range, root)) return null;
    var start = textOffsetInElement(
      root,
      range.startContainer,
      range.startOffset,
    );
    var end = textOffsetInElement(root, range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return null;
    return { start: start, end: end, text: root.textContent || "" };
  }

  function textPointAtElementOffset(
    root: Element,
    offset: number,
  ): { node: Text; offset: number } | null {
    if (!Number.isFinite(offset) || offset < 0) return null;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var remaining = offset;
    var lastText: Text | null = null;
    while (walker.nextNode()) {
      var text = walker.currentNode as Text;
      var length = text.data.length;
      if (remaining <= length) return { node: text, offset: remaining };
      remaining -= length;
      lastText = text;
    }
    return remaining === 0 && lastText
      ? { node: lastText, offset: lastText.data.length }
      : null;
  }

  function restoreTextRangeBookmark(
    root: Element,
    bookmark: { start: number; end: number; text: string },
  ): Range | null {
    if ((root.textContent || "") !== bookmark.text) return null;
    var start = textPointAtElementOffset(root, bookmark.start);
    var end = textPointAtElementOffset(root, bookmark.end);
    if (!start || !end) return null;
    var range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return !range.collapsed && rangeBelongsToElement(range, root)
      ? range
      : null;
  }

  function captureActiveTextEditRange(target: HTMLElement): void {
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed ||
      !selectionBelongsToElement(selection, target)
    ) {
      return;
    }
    activeTextEditRange = selection.getRangeAt(0).cloneRange();
  }

  function clearActiveTextEditRangeIfCollapsed(target: HTMLElement): void {
    if (document.activeElement !== target) return;
    var selection = window.getSelection ? window.getSelection() : null;
    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed ||
      !selectionBelongsToElement(selection, target)
    ) {
      activeTextEditRange = null;
    }
  }

  function normalizeCssPropertyName(property: unknown): string {
    var prop = String(property || "").trim();
    if (!prop) return "";
    if (prop.indexOf("--") === 0) return prop;
    return prop.replace(/([A-Z])/g, "-$1").toLowerCase();
  }

  var VECTOR_ENDPOINT_STYLES = [
    "none",
    "round",
    "square",
    "line",
    "triangle",
    "reversed-triangle",
    "circle",
    "diamond",
  ];

  function vectorEndpointMarkerIdForRuntime(
    nodeId: string,
    side: "start" | "end",
  ): string {
    var safeNodeId = nodeId.replace(/[^A-Za-z0-9_-]/g, "-") || "vector";
    var safePrefix = /^[A-Za-z_]/.test(safeNodeId)
      ? safeNodeId
      : "vector-" + safeNodeId;
    var encodedNodeId = nodeId
      .split("")
      .map(function (character) {
        return character.charCodeAt(0).toString(16).padStart(4, "0");
      })
      .join("");
    var markerNodeId =
      safePrefix === safeNodeId && safeNodeId === nodeId
        ? safeNodeId
        : safePrefix + "." + (encodedNodeId || "0");
    return markerNodeId + "-vector-marker-" + side;
  }

  function vectorEndpointShapeForRuntime(
    endpoint: string,
  ): { tag: string; attributes: Record<string, string> } | null {
    switch (endpoint) {
      case "round":
        return {
          tag: "circle",
          attributes: { cx: "5", cy: "5", r: "4", fill: "context-stroke" },
        };
      case "square":
        return {
          tag: "rect",
          attributes: {
            x: "1",
            y: "1",
            width: "8",
            height: "8",
            fill: "context-stroke",
          },
        };
      case "line":
        return {
          tag: "path",
          attributes: {
            d: "M 0 0 L 10 5 L 0 10",
            fill: "none",
            stroke: "context-stroke",
            "stroke-width": "1",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
          },
        };
      case "triangle":
        return {
          tag: "path",
          attributes: { d: "M 0 0 L 10 5 L 0 10 z", fill: "context-stroke" },
        };
      case "reversed-triangle":
        return {
          tag: "path",
          attributes: { d: "M 10 0 L 0 5 L 10 10 z", fill: "context-stroke" },
        };
      case "circle":
        return {
          tag: "circle",
          attributes: {
            cx: "5",
            cy: "5",
            r: "4",
            fill: "none",
            stroke: "context-stroke",
            "stroke-width": "1",
          },
        };
      case "diamond":
        return {
          tag: "path",
          attributes: {
            d: "M 5 0 L 10 5 L 5 10 L 0 5 z",
            fill: "none",
            stroke: "context-stroke",
            "stroke-width": "1",
            "stroke-linejoin": "round",
          },
        };
      default:
        return null;
    }
  }

  function vectorEndpointMarkerRefXForRuntime(endpoint: string): string {
    return endpoint === "reversed-triangle" ? "0" : "8";
  }

  function applyVectorEndpointProperty(
    el: Element,
    cssProperty: string,
    rawValue: unknown,
  ): boolean {
    if (
      el.tagName.toLowerCase() !== "svg" ||
      !["path", "line", "arrow"].includes(
        el.getAttribute("data-an-primitive") || "",
      )
    ) {
      return false;
    }
    var nodeId = el.getAttribute("data-agent-native-node-id");
    if (!nodeId) return false;
    var side =
      cssProperty === "--an-vector-start-point"
        ? ("start" as const)
        : ("end" as const);
    var raw = String(rawValue ?? "").trim();
    var endpoint = raw || "none";
    if (VECTOR_ENDPOINT_STYLES.indexOf(endpoint) === -1) return false;
    var shape = vectorPaintTarget(el);
    if (!shape) return false;
    var wrapperStyle = (el as HTMLElement).style;
    var markerId = vectorEndpointMarkerIdForRuntime(nodeId, side);
    var defs = el.querySelector(
      ":scope > defs[data-an-vector-endpoints]",
    ) as SVGDefsElement | null;
    if (defs) {
      Array.from(defs.children).forEach(function (child) {
        if (
          child.tagName.toLowerCase() === "marker" &&
          (child.getAttribute("data-an-vector-endpoint-marker") === side ||
            child.getAttribute("id") === markerId)
        ) {
          child.remove();
        }
      });
    }
    if (endpoint !== "none") {
      if (!defs) {
        defs = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "defs",
        ) as SVGDefsElement;
        defs.setAttribute("data-an-vector-endpoints", "true");
        el.insertBefore(defs, shape);
      }
      var endpointShape = vectorEndpointShapeForRuntime(endpoint);
      if (!endpointShape) return false;
      var marker = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "marker",
      );
      marker.setAttribute("data-an-vector-endpoint-marker", side);
      marker.setAttribute("id", markerId);
      marker.setAttribute("markerWidth", "10");
      marker.setAttribute("markerHeight", "10");
      marker.setAttribute("refX", vectorEndpointMarkerRefXForRuntime(endpoint));
      marker.setAttribute("refY", "5");
      marker.setAttribute(
        "orient",
        side === "start" ? "auto-start-reverse" : "auto",
      );
      marker.setAttribute("markerUnits", "strokeWidth");
      var markerShape = document.createElementNS(
        "http://www.w3.org/2000/svg",
        endpointShape.tag,
      );
      Object.keys(endpointShape.attributes).forEach(function (name) {
        markerShape!.setAttribute(name, endpointShape.attributes[name]!);
      });
      marker.appendChild(markerShape);
      defs.appendChild(marker);
    } else if (defs && defs.children.length === 0) {
      defs.remove();
    }
    if (endpoint === "none") {
      shape.removeAttribute(side === "start" ? "marker-start" : "marker-end");
      wrapperStyle.setProperty(cssProperty, "none");
    } else {
      shape.setAttribute(
        side === "start" ? "marker-start" : "marker-end",
        "url(#" + markerId + ")",
      );
      wrapperStyle.setProperty(cssProperty, endpoint);
    }
    return true;
  }

  function hydrateVectorEndpointMarkers(): void {
    document
      .querySelectorAll(
        'svg[data-an-primitive="path"], svg[data-an-primitive="line"], svg[data-an-primitive="arrow"]',
      )
      .forEach(function (element) {
        var style = (element as HTMLElement).style;
        ["--an-vector-start-point", "--an-vector-end-point"].forEach(
          function (cssProperty) {
            var value = style.getPropertyValue(cssProperty).trim();
            if (value) applyVectorEndpointProperty(element, cssProperty, value);
          },
        );
      });
  }

  function vectorPaintTarget(el: Element | null): Element | null {
    if (!el || el.tagName.toLowerCase() !== "svg") return null;
    var kind = el.getAttribute("data-an-primitive") || "";
    if (kind === "boolean") {
      return el.querySelector(':scope > use[data-an-boolean-result="true"]');
    }
    if (kind === "boolean-operand") {
      return el.querySelector(":scope > rect");
    }
    if (
      kind !== "path" &&
      kind !== "line" &&
      kind !== "arrow" &&
      kind !== "polygon" &&
      kind !== "star" &&
      kind !== "rect" &&
      kind !== "rectangle" &&
      kind !== "ellipse" &&
      kind !== "circle" &&
      kind !== "pasted-svg"
    ) {
      return null;
    }
    if (kind === "pasted-svg") {
      var pendingShapes = Array.from(el.children);
      var pastedShape: Element | null = null;
      while (pendingShapes.length) {
        var candidate = pendingShapes.pop();
        if (!candidate) continue;
        var candidateTag = candidate.tagName.toLowerCase();
        if (
          [
            "path",
            "polygon",
            "ellipse",
            "circle",
            "rect",
            "line",
            "polyline",
            "use",
          ].includes(candidateTag)
        ) {
          if (pastedShape) return null;
          pastedShape = candidate;
        } else if (candidateTag === "g") {
          Array.from(candidate.children).forEach(function (child) {
            pendingShapes.push(child);
          });
        }
      }
      return pastedShape;
    }
    return el.querySelector(
      ":scope > path, :scope > polygon, :scope > ellipse, :scope > circle, :scope > rect, :scope > line, :scope > polyline",
    );
  }

  function collectElementInlineStyles(el: Element): Record<string, string> {
    var styles = collectInlineStyles(el);
    var paintTarget = vectorPaintTarget(el);
    if (!paintTarget) return styles;
    var authoredFill = (paintTarget as HTMLElement).style.getPropertyValue(
      "fill",
    );
    if (!authoredFill) authoredFill = paintTarget.getAttribute("fill") || "";
    if (el.getAttribute("data-an-primitive") === "boolean") {
      authoredFill = (el as HTMLElement).style.getPropertyValue(
        "--boolean-mask-fill",
      );
    }
    if (authoredFill) styles.fill = authoredFill;
    return styles;
  }

  function vectorStrokeTarget(el: Element | null): Element | null {
    if (!el || el.tagName.toLowerCase() !== "svg") return null;
    return (
      el.querySelector(":scope > use[data-an-vector-stroke-overlay]") ||
      vectorPaintTarget(el)
    );
  }

  function vectorStrokeCanAlign(el: Element | null): boolean {
    if (!el || el.tagName.toLowerCase() !== "svg") return false;
    var kind = el.getAttribute("data-an-primitive") || "";
    var shape = vectorPaintTarget(el);
    if (!shape) return false;
    var shapeTag = shape.tagName.toLowerCase();
    if ((kind === "rect" || kind === "rectangle") && shapeTag === "rect") {
      return true;
    }
    if (
      (kind === "ellipse" || kind === "circle") &&
      (shapeTag === "ellipse" || shapeTag === "circle")
    ) {
      return true;
    }
    if (kind === "polygon" || kind === "star") {
      return (
        shapeTag === "polygon" ||
        (shapeTag === "path" && /z/i.test(shape.getAttribute("d") || ""))
      );
    }
    if (kind !== "path") return false;
    return !!(
      shape &&
      shapeTag === "path" &&
      /z/i.test(shape.getAttribute("d") || "")
    );
  }

  function scaledVectorStrokeWidth(value: string, scale: number): string {
    var match = value
      .trim()
      .match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([a-z%]*)$/i);
    if (!match) return scale === 1 ? value : "";
    return String(Number(match[1]) * scale) + match[2];
  }

  function applyVectorStrokePosition(el: Element, position: string): boolean {
    if (
      !["inside", "center", "outside"].includes(position) ||
      !vectorStrokeCanAlign(el)
    ) {
      return false;
    }
    var shape = vectorPaintTarget(el);
    if (!shape) return false;
    var oldOverlay = vectorStrokeTarget(el);
    var oldIsOverlay =
      oldOverlay && oldOverlay.hasAttribute("data-an-vector-stroke-overlay");
    var shapeStyle = window.getComputedStyle(shape);
    var paintStyle = oldIsOverlay
      ? window.getComputedStyle(oldOverlay!)
      : shapeStyle;
    var overlayOpacity = oldIsOverlay
      ? (oldOverlay as SVGElement).style.getPropertyValue("opacity") ||
        oldOverlay!.getAttribute("opacity")
      : "";
    var logicalWidth = oldIsOverlay
      ? oldOverlay!.getAttribute("data-an-vector-logical-width") ||
        paintStyle.strokeWidth
      : paintStyle.strokeWidth;
    var paint = {
      opacity: overlayOpacity ? paintStyle.opacity : shapeStyle.opacity,
      stroke: paintStyle.stroke,
      strokeOpacity: paintStyle.strokeOpacity,
      strokeDasharray: paintStyle.strokeDasharray,
      strokeDashoffset: paintStyle.strokeDashoffset,
      strokeLinecap: paintStyle.strokeLinecap,
      strokeLinejoin: paintStyle.strokeLinejoin,
      strokeMiterlimit: paintStyle.strokeMiterlimit,
    };
    var actualWidth = scaledVectorStrokeWidth(
      logicalWidth,
      position === "center" ? 1 : 2,
    );
    if (!actualWidth) return false;

    var viewBox = (el.getAttribute("viewBox") || "0 0 300 150")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      viewBox.length !== 4 ||
      !viewBox.every(Number.isFinite) ||
      viewBox[2]! <= 0 ||
      viewBox[3]! <= 0
    ) {
      return false;
    }
    var wrapperStyle = (el as HTMLElement).style;
    var savedOverflow = el.getAttribute(
      "data-an-vector-stroke-original-overflow",
    );
    if (position === "outside") {
      if (savedOverflow === null) {
        el.setAttribute(
          "data-an-vector-stroke-original-overflow",
          wrapperStyle.getPropertyValue("overflow"),
        );
        el.setAttribute(
          "data-an-vector-stroke-original-overflow-priority",
          wrapperStyle.getPropertyPriority("overflow"),
        );
      }
      wrapperStyle.setProperty("overflow", "visible", "important");
    } else if (savedOverflow !== null) {
      var overflowPriority =
        el.getAttribute("data-an-vector-stroke-original-overflow-priority") ||
        "";
      if (savedOverflow) {
        wrapperStyle.setProperty("overflow", savedOverflow, overflowPriority);
      } else {
        wrapperStyle.removeProperty("overflow");
      }
      el.removeAttribute("data-an-vector-stroke-original-overflow");
      el.removeAttribute("data-an-vector-stroke-original-overflow-priority");
    }
    var miterlimit = Math.max(parseFloat(paint.strokeMiterlimit) || 4, 1);
    var pad = Math.max(((parseFloat(actualWidth) || 0) * miterlimit) / 2, 1);
    var x = viewBox[0]! - pad;
    var y = viewBox[1]! - pad;
    var width = viewBox[2]! + pad * 2;
    var height = viewBox[3]! + pad * 2;

    var svgNs = "http://www.w3.org/2000/svg";
    Array.from(
      el.querySelectorAll(":scope > defs[data-an-vector-stroke-defs]"),
    ).forEach(function (generatedDefs) {
      generatedDefs.remove();
    });
    Array.from(
      el.querySelectorAll(":scope > use[data-an-vector-stroke-overlay]"),
    ).forEach(function (generatedOverlay) {
      generatedOverlay.remove();
    });

    var id = freshRuntimeNodeId("vector-stroke");
    while (document.getElementById(id + "-geometry")) {
      id = freshRuntimeNodeId("vector-stroke");
    }
    var geometryId = id + "-geometry";
    var clipId = id + "-inside";
    var maskId = id + "-outside";
    var geometry = shape.cloneNode(false) as SVGElement;
    Array.from(geometry.attributes).forEach(function (attribute) {
      if (
        ![
          "d",
          "points",
          "x",
          "y",
          "width",
          "height",
          "rx",
          "ry",
          "cx",
          "cy",
          "r",
          "fill-rule",
          "clip-rule",
        ].includes(attribute.name.toLowerCase())
      ) {
        geometry.removeAttribute(attribute.name);
      }
    });
    var geometryStyle = window.getComputedStyle(shape);
    if (geometryStyle.transform !== "none") {
      geometry.style.setProperty("transform", geometryStyle.transform);
    }
    geometry.style.setProperty(
      "transform-origin",
      geometryStyle.transformOrigin,
    );
    geometry.style.setProperty("transform-box", geometryStyle.transformBox);
    geometry.setAttribute("id", geometryId);
    geometry.setAttribute("data-an-vector-stroke-geometry", "");

    var defs = document.createElementNS(svgNs, "defs");
    defs.setAttribute("data-an-vector-stroke-defs", "");
    defs.appendChild(geometry);
    var clip = document.createElementNS(svgNs, "clipPath");
    clip.setAttribute("id", clipId);
    clip.setAttribute("clipPathUnits", "userSpaceOnUse");
    var clipUse = document.createElementNS(svgNs, "use");
    clipUse.setAttribute("href", "#" + geometryId);
    clip.appendChild(clipUse);
    defs.appendChild(clip);
    var mask = document.createElementNS(svgNs, "mask");
    mask.setAttribute("id", maskId);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("maskContentUnits", "userSpaceOnUse");
    mask.setAttribute("mask-type", "luminance");
    mask.setAttribute("x", String(x));
    mask.setAttribute("y", String(y));
    mask.setAttribute("width", String(width));
    mask.setAttribute("height", String(height));
    var maskRect = document.createElementNS(svgNs, "rect");
    maskRect.setAttribute("x", String(x));
    maskRect.setAttribute("y", String(y));
    maskRect.setAttribute("width", String(width));
    maskRect.setAttribute("height", String(height));
    maskRect.setAttribute("fill", "white");
    var maskUse = document.createElementNS(svgNs, "use");
    maskUse.setAttribute("href", "#" + geometryId);
    maskUse.setAttribute("fill", "black");
    mask.appendChild(maskRect);
    mask.appendChild(maskUse);
    defs.appendChild(mask);

    var overlay = document.createElementNS(svgNs, "use");
    overlay.setAttribute("href", "#" + geometryId);
    overlay.setAttribute("data-an-vector-stroke-overlay", "");
    overlay.setAttribute("data-an-vector-logical-width", logicalWidth);
    overlay.setAttribute("pointer-events", "none");
    overlay.setAttribute("aria-hidden", "true");
    var overlayStyle = (overlay as unknown as HTMLElement).style;
    overlayStyle.setProperty("fill", "none");
    overlayStyle.setProperty("opacity", paint.opacity);
    overlayStyle.setProperty("stroke", paint.stroke);
    overlayStyle.setProperty("stroke-width", actualWidth);
    overlayStyle.setProperty("stroke-opacity", paint.strokeOpacity);
    overlayStyle.setProperty("stroke-dasharray", paint.strokeDasharray);
    overlayStyle.setProperty("stroke-dashoffset", paint.strokeDashoffset);
    overlayStyle.setProperty("stroke-linecap", paint.strokeLinecap);
    overlayStyle.setProperty("stroke-linejoin", paint.strokeLinejoin);
    overlayStyle.setProperty("stroke-miterlimit", paint.strokeMiterlimit);
    if (position === "inside") {
      overlayStyle.setProperty("clip-path", "url(#" + clipId + ")");
    } else if (position === "outside") {
      overlayStyle.setProperty("mask", "url(#" + maskId + ")");
    }

    var nextSibling = shape.nextSibling;
    el.insertBefore(defs, nextSibling);
    el.insertBefore(overlay, defs.nextSibling);
    (shape as unknown as HTMLElement).style.setProperty("stroke", "none");
    el.setAttribute("data-an-vector-stroke-position", position);
    return true;
  }

  function isVectorPaintProperty(cssProperty: string): boolean {
    return (
      cssProperty.indexOf("fill") === 0 || cssProperty.indexOf("stroke") === 0
    );
  }

  function clearVectorWrapperPaint(el: Element): void {
    var style = (el as HTMLElement).style;
    var properties = [
      "background",
      "background-color",
      "background-image",
      "border",
      "border-width",
      "border-style",
      "border-color",
    ];
    for (var i = 0; i < properties.length; i += 1) {
      style.removeProperty(properties[i]!);
    }
  }

  function pastedSvgPaintShapes(root: SVGSVGElement): Element[] {
    var shapes: Element[] = [];
    function visit(parent: Element): void {
      Array.from(parent.children).forEach(function (child) {
        var tag = child.tagName.toLowerCase();
        if (tag === "defs") return;
        if (
          /^(path|polygon|ellipse|circle|rect|line|polyline|use)$/i.test(tag)
        ) {
          shapes.push(child);
        } else if (tag === "g") {
          visit(child);
        }
      });
    }
    visit(root);
    return shapes;
  }

  function vectorGradientPaintTargets(
    el: Element,
    paintProperty: "fill" | "stroke",
  ): {
    root: SVGSVGElement;
    targets: Element[];
    metadataTarget: Element;
  } | null {
    var root =
      el.tagName.toLowerCase() === "svg"
        ? (el as SVGSVGElement)
        : (el.closest("svg[data-an-primitive]") as SVGSVGElement | null);
    if (!root) return null;
    var target =
      paintProperty === "stroke"
        ? vectorStrokeTarget(root)
        : vectorPaintTarget(root);
    if (
      !target &&
      el !== root &&
      /^(path|polygon|ellipse|circle|rect|line|polyline|use)$/i.test(el.tagName)
    ) {
      target = el;
    }
    var targets = target ? [target] : [];
    if (
      !targets.length &&
      el === root &&
      root.getAttribute("data-an-primitive") === "pasted-svg"
    ) {
      targets = pastedSvgPaintShapes(root);
    }
    if (!targets.length) return null;
    var shapeCount = pastedSvgPaintShapes(root).length;
    return {
      root: root,
      targets: targets,
      metadataTarget: shapeCount === 1 || el === root ? root : targets[0]!,
    };
  }

  function vectorGradientDefAttribute(paintProperty: "fill" | "stroke") {
    return "data-an-vector-" + paintProperty + "-gradient";
  }

  function vectorGradientMetadataProperty(paintProperty: "fill" | "stroke") {
    return "--an-vector-" + paintProperty + "-gradient";
  }

  function normalizeVectorGradientDefs(
    root: SVGSVGElement,
    paintProperty: "fill" | "stroke",
  ): SVGDefsElement | null {
    var containers = Array.from(
      root.querySelectorAll(
        ":scope > defs[" + vectorGradientDefAttribute(paintProperty) + "]",
      ),
    );
    var canonical = containers[0] || null;
    if (!canonical) return null;
    var seenIds: Record<string, boolean> = Object.create(null);
    Array.from(canonical.children).forEach(function (child) {
      var id = child.getAttribute("id");
      if (id) seenIds[id] = true;
    });
    containers.slice(1).forEach(function (duplicate) {
      Array.from(duplicate.children).forEach(function (child) {
        var id = child.getAttribute("id");
        if (!id || !seenIds[id]) {
          canonical!.appendChild(child);
          if (id) seenIds[id] = true;
        }
      });
      duplicate.remove();
    });
    return canonical;
  }

  function removeVectorGradientPreview(
    root: SVGSVGElement,
    targets: Element[],
    paintProperty: "fill" | "stroke",
  ): void {
    var gradientIds: Record<string, boolean> = Object.create(null);
    var metadataProperty = vectorGradientMetadataProperty(paintProperty);
    var rootMetadata = root.style.getPropertyValue(metadataProperty);
    targets.forEach(function (target) {
      var style = (target as HTMLElement).style.getPropertyValue(paintProperty);
      var reference = style.match(/^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)$/i);
      if (reference?.[1]) gradientIds[reference[1]] = true;
      (target as HTMLElement).style.removeProperty(metadataProperty);
    });
    var defsContainers = Array.from(
      root.querySelectorAll(
        ":scope > defs[" + vectorGradientDefAttribute(paintProperty) + "]",
      ),
    );
    defsContainers.forEach(function (defs) {
      Array.from(defs.children).forEach(function (gradient) {
        var id = gradient.getAttribute("id");
        var remainingReferences = id
          ? Array.from(root.querySelectorAll("[style]")).filter(function (el) {
              if (targets.indexOf(el) >= 0) return false;
              var reference = (el as HTMLElement).style
                .getPropertyValue(paintProperty)
                .match(/^url\(\s*['\"]?#([^)'\"\s]+)['\"]?\s*\)$/i);
              return reference?.[1] === id;
            })
          : [];
        if (id && gradientIds[id] && !remainingReferences.length) {
          gradient.remove();
        } else if (rootMetadata && gradientIds[id || ""]) {
          remainingReferences.forEach(function (el) {
            (el as HTMLElement).style.setProperty(
              metadataProperty,
              rootMetadata,
            );
          });
        }
      });
    });
    var normalizedDefs = normalizeVectorGradientDefs(root, paintProperty);
    if (normalizedDefs && normalizedDefs.children.length === 0) {
      normalizedDefs.remove();
    }
    root.style.removeProperty(metadataProperty);
  }

  function appendSvgGradientStops(
    gradient: SVGLinearGradientElement | SVGRadialGradientElement,
    stops: Array<{ color: string; position: number }>,
  ): boolean {
    var svgNs = "http://www.w3.org/2000/svg";
    var appended = 0;
    stops.forEach(function (stop) {
      var color = document.createElement("span");
      color.style.color = stop.color;
      color.style.position = "absolute";
      color.style.visibility = "hidden";
      document.body.appendChild(color);
      var resolved = window.getComputedStyle(color).color;
      color.remove();
      if (!resolved || resolved === "") return;
      var rgba = resolved.match(/^rgba?\(([^)]+)\)$/i);
      var colorParts = rgba ? rgba[1]!.split(/[\s,\/]+/).filter(Boolean) : [];
      if (colorParts.length < 3) return;
      var svgStop = document.createElementNS(svgNs, "stop");
      svgStop.setAttribute(
        "offset",
        String(Math.max(0, Math.min(100, stop.position))) + "%",
      );
      svgStop.setAttribute(
        "stop-color",
        // guard:allow-raw-color — serialize the resolved user-selected SVG stop color
        "rgb(" + colorParts.slice(0, 3).join(" ") + ")",
      );
      var alpha = colorParts.length > 3 ? Number(colorParts[3]) : 1;
      if (Number.isFinite(alpha) && alpha < 1) {
        svgStop.setAttribute("stop-opacity", String(Math.max(0, alpha)));
      }
      gradient.appendChild(svgStop);
      appended += 1;
    });
    return appended >= 2;
  }

  function applyVectorGradientPreview(
    el: Element,
    value: string,
    paintProperty: "fill" | "stroke",
  ): boolean {
    var paint = vectorGradientPaintTargets(el, paintProperty);
    if (!paint) return false;
    var linear = parseLinearGradientCss(value);
    var radialMatch = String(value || "")
      .trim()
      .match(/^radial-gradient\s*\(([\s\S]*)\)$/i);
    var radialParts = radialMatch ? splitGradientTopLevel(radialMatch[1]!) : [];
    var radialHeader = radialParts[0] || "";
    var radialStopStart =
      /^(?:(?:circle|ellipse)\b|(?:closest|farthest)-(?:side|corner)\b|(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)(?:\s|$))|at\s)/i.test(
        radialHeader,
      )
        ? 1
        : 0;
    var radialStops = radialParts
      .slice(radialStopStart)
      .map(function (segment, index, segments) {
        var position = segment.match(/(-?\d+(?:\.\d+)?)%\s*$/);
        return {
          color: position
            ? segment.slice(0, position.index).trim()
            : segment.trim(),
          position: position
            ? Number(position[1])
            : (index / Math.max(1, segments.length - 1)) * 100,
        };
      })
      .filter(function (stop) {
        return !!stop.color;
      });
    var isRadial = !!radialMatch && radialStops.length >= 2;
    if (!linear && !isRadial) return false;
    var stops = linear ? linear.stops : radialStops;

    removeVectorGradientPreview(paint.root, paint.targets, paintProperty);
    var baseId =
      (paint.root.getAttribute("data-agent-native-node-id") || "vector") +
      "-" +
      paintProperty +
      "-gradient";
    var gradientId = baseId;
    var suffix = 2;
    while (document.getElementById(gradientId)) {
      gradientId = baseId + "-" + suffix;
      suffix += 1;
    }
    var svgNs = "http://www.w3.org/2000/svg";
    var gradient: SVGLinearGradientElement | SVGRadialGradientElement;
    if (linear) {
      var viewBox = paint.root.viewBox.baseVal;
      var rect = paint.root.getBoundingClientRect();
      var width = viewBox.width || rect.width;
      var height = viewBox.height || rect.height;
      if (viewBox.width && viewBox.height && rect.width && rect.height) {
        var scaleX = viewBox.width / rect.width;
        var scaleY = viewBox.height / rect.height;
        if (Math.abs(scaleX - scaleY) > Math.max(scaleX, scaleY) * 0.001) {
          return false;
        }
      }
      var segments = splitGradientTopLevel(
        String(value)
          .trim()
          .slice(String(value).indexOf("(") + 1, -1),
      );
      var header = segments[0] || "";
      var angleDegrees = linear.angle;
      if (/^to\s+/i.test(header)) {
        var sides =
          header.toLowerCase().match(/\b(top|bottom|left|right)\b/g) || [];
        var vertical = sides.find(function (side) {
          return side === "top" || side === "bottom";
        });
        var horizontal = sides.find(function (side) {
          return side === "left" || side === "right";
        });
        if (vertical && horizontal) {
          var cornerDx = (horizontal === "right" ? 1 : -1) * width;
          var cornerDy = (vertical === "top" ? -1 : 1) * height;
          angleDegrees =
            ((Math.atan2(cornerDx, -cornerDy) * 180) / Math.PI + 360) % 360;
        } else if (vertical) {
          angleDegrees = vertical === "top" ? 0 : 180;
        } else if (horizontal) {
          angleDegrees = horizontal === "right" ? 90 : 270;
        }
      } else if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg)?$/i.test(header)) {
        angleDegrees = 180;
      }
      var angle = (angleDegrees * Math.PI) / 180;
      var dx = Math.sin(angle);
      var dy = -Math.cos(angle);
      var length = Math.abs(width * dx) + Math.abs(height * dy);
      var x = viewBox.width ? viewBox.x : 0;
      var y = viewBox.height ? viewBox.y : 0;
      var cx = width / 2;
      var cy = height / 2;
      gradient = document.createElementNS(svgNs, "linearGradient");
      gradient.setAttribute("gradientUnits", "userSpaceOnUse");
      gradient.setAttribute("x1", String(x + cx - (dx * length) / 2));
      gradient.setAttribute("y1", String(y + cy - (dy * length) / 2));
      gradient.setAttribute("x2", String(x + cx + (dx * length) / 2));
      gradient.setAttribute("y2", String(y + cy + (dy * length) / 2));
    } else {
      var viewBox = paint.root.viewBox.baseVal;
      var rect = paint.root.getBoundingClientRect();
      var width = viewBox.width || rect.width;
      var height = viewBox.height || rect.height;
      if (!(width > 0 && height > 0)) return false;
      var x = viewBox.width ? viewBox.x : 0;
      var y = viewBox.height ? viewBox.y : 0;
      var header = radialStopStart ? radialHeader.trim() : "";
      var atIndex = header.toLowerCase().indexOf(" at ");
      var shapeAndSize = (
        atIndex < 0 ? header : header.slice(0, atIndex)
      ).trim();
      var position = atIndex < 0 ? "" : header.slice(atIndex + 4).trim();
      var isCircle = /^circle\b/i.test(shapeAndSize);
      shapeAndSize = shapeAndSize.replace(/^(?:circle|ellipse)\b/i, "").trim();
      var sizeKeyword =
        shapeAndSize
          .match(
            /^(closest-side|farthest-side|closest-corner|farthest-corner)$/i,
          )?.[1]
          ?.toLowerCase() || "farthest-corner";
      var explicitSizes = shapeAndSize.match(
        /^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)?)(?:\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)?))?$/i,
      );
      var positionParts = position ? position.split(/\s+/) : [];
      var positionValue = function (axis: "x" | "y"): number {
        var size = axis === "x" ? width : height;
        var start = axis === "x" ? x : y;
        var candidates = positionParts.filter(function (part) {
          return axis === "x"
            ? /^(left|right|center|[-+\d.]+%|[-+\d.]+px)$/i.test(part)
            : /^(top|bottom|center|[-+\d.]+%|[-+\d.]+px)$/i.test(part);
        });
        var token =
          candidates[axis === "x" ? 0 : candidates.length - 1] || "center";
        if (/^(right|bottom)$/i.test(token)) return start + size;
        if (/^(left|top)$/i.test(token)) return start;
        if (/^center$/i.test(token)) return start + size / 2;
        var number = parseFloat(token);
        return start + (/%$/.test(token) ? (number / 100) * size : number);
      };
      var cx = positionValue("x");
      var cy = positionValue("y");
      var left = cx - x;
      var right = x + width - cx;
      var top = cy - y;
      var bottom = y + height - cy;
      var closestX = Math.max(0, Math.min(left, right));
      var farthestX = Math.max(left, right);
      var closestY = Math.max(0, Math.min(top, bottom));
      var farthestY = Math.max(top, bottom);
      var rx: number;
      var ry: number;
      if (explicitSizes) {
        var parseRadius = function (
          raw: string | undefined,
          axis: "x" | "y",
        ): number {
          if (!raw) return 0;
          var dimension = axis === "x" ? width : height;
          var number = parseFloat(raw);
          return /%$/.test(raw) ? (number / 100) * dimension : number;
        };
        rx = parseRadius(explicitSizes[1], "x");
        ry = explicitSizes[2] ? parseRadius(explicitSizes[2], "y") : rx;
      } else if (
        sizeKeyword === "closest-side" ||
        sizeKeyword === "farthest-side"
      ) {
        var horizontalRadius =
          sizeKeyword === "closest-side" ? closestX : farthestX;
        var verticalRadius =
          sizeKeyword === "closest-side" ? closestY : farthestY;
        if (isCircle) {
          rx = ry =
            sizeKeyword === "closest-side"
              ? Math.min(horizontalRadius, verticalRadius)
              : Math.max(horizontalRadius, verticalRadius);
        } else {
          rx = horizontalRadius;
          ry = verticalRadius;
        }
      } else if (isCircle) {
        var cornerX = sizeKeyword === "closest-corner" ? closestX : farthestX;
        var cornerY = sizeKeyword === "closest-corner" ? closestY : farthestY;
        rx = ry = Math.hypot(cornerX, cornerY);
      } else {
        rx = sizeKeyword === "closest-corner" ? closestX : farthestX;
        ry = sizeKeyword === "closest-corner" ? closestY : farthestY;
      }
      if (!(rx > 0 && ry > 0)) return false;
      gradient = document.createElementNS(svgNs, "radialGradient");
      gradient.setAttribute("gradientUnits", "userSpaceOnUse");
      gradient.setAttribute("cx", String(cx));
      gradient.setAttribute("cy", String(cy));
      if (Math.abs(rx - ry) < 0.001) {
        gradient.setAttribute("r", String(rx));
      } else {
        gradient.setAttribute("r", "1");
        gradient.setAttribute(
          "gradientTransform",
          "translate(" +
            cx +
            " " +
            cy +
            ") scale(" +
            rx +
            " " +
            ry +
            ") translate(" +
            -cx +
            " " +
            -cy +
            ")",
        );
      }
    }
    gradient.setAttribute("id", gradientId);
    if (!appendSvgGradientStops(gradient, stops)) return false;
    var defs = normalizeVectorGradientDefs(paint.root, paintProperty);
    if (!defs) {
      defs = document.createElementNS(svgNs, "defs") as SVGDefsElement;
      defs.setAttribute(vectorGradientDefAttribute(paintProperty), "");
      paint.root.insertBefore(defs, paint.root.firstChild);
    }
    defs.appendChild(gradient);
    recordSourceSubtree(defs);
    paint.targets.forEach(function (target) {
      (target as HTMLElement).style.setProperty(
        paintProperty,
        "url(#" + gradientId + ")",
      );
    });
    (paint.metadataTarget as HTMLElement).style.setProperty(
      vectorGradientMetadataProperty(paintProperty),
      value.trim(),
    );
    return true;
  }

  function applyInlineStyleProperty(
    el: HTMLElement | null,
    property: unknown,
    value: unknown,
  ): boolean {
    if (!el || !property) return false;
    var cssProperty = normalizeCssPropertyName(property);
    if (!cssProperty) return false;
    if (cssProperty === "fill" && typeof value === "string") {
      if (applyVectorGradientPreview(el, value, "fill")) return true;
    }
    if (cssProperty === "stroke" && typeof value === "string") {
      if (applyVectorGradientPreview(el, value, "stroke")) return true;
    }
    if (
      cssProperty === "--an-vector-start-point" ||
      cssProperty === "--an-vector-end-point"
    ) {
      return applyVectorEndpointProperty(el, cssProperty, value);
    }
    if (cssProperty === "--an-vector-stroke-position") {
      return applyVectorStrokePosition(el, String(value));
    }
    var target: Element = el;
    var strokeOverlay: Element | null = null;
    var useOverlay = false;
    if (isVectorPaintProperty(cssProperty)) {
      var vectorRoot =
        el.tagName.toLowerCase() === "svg"
          ? (el as unknown as SVGSVGElement)
          : (el.closest(
              "svg[data-an-primitive]",
            ) as unknown as SVGSVGElement | null);
      var shape = vectorPaintTarget(el);
      var shapes = shape ? [shape] : [];
      if (
        !shapes.length &&
        vectorRoot?.getAttribute("data-an-primitive") === "pasted-svg"
      ) {
        shapes =
          el === vectorRoot
            ? pastedSvgPaintShapes(vectorRoot)
            : /^(path|polygon|ellipse|circle|rect|line|polyline|use)$/i.test(
                  el.tagName,
                )
              ? [el]
              : [];
      }
      if (shapes.length && vectorRoot) {
        if (cssProperty === "fill" || cssProperty === "stroke") {
          removeVectorGradientPreview(vectorRoot, shapes, cssProperty);
        }
        strokeOverlay = vectorStrokeTarget(el);
        useOverlay =
          cssProperty.indexOf("stroke") === 0 &&
          !!strokeOverlay &&
          strokeOverlay.hasAttribute("data-an-vector-stroke-overlay");
        target = useOverlay ? strokeOverlay! : shapes[0]!;
        clearVectorWrapperPaint(el);
        if (useOverlay && cssProperty === "stroke-width") {
          var logicalWidth = String(value);
          var position =
            el.getAttribute("data-an-vector-stroke-position") || "center";
          var actualWidth = scaledVectorStrokeWidth(
            logicalWidth,
            position === "center" ? 1 : 2,
          );
          if (!actualWidth) return false;
          strokeOverlay!.setAttribute(
            "data-an-vector-logical-width",
            logicalWidth,
          );
          value = actualWidth;
        }
        if (shapes.length > 1 && !useOverlay) {
          shapes.forEach(function (shapeTarget) {
            (shapeTarget as HTMLElement).style.setProperty(
              cssProperty,
              String(value),
            );
          });
          return true;
        }
      }
    }
    (target as HTMLElement).style.setProperty(cssProperty, String(value));
    var strokePosition = el.getAttribute("data-an-vector-stroke-position");
    if (
      useOverlay &&
      (cssProperty === "stroke-width" ||
        (cssProperty === "stroke-miterlimit" && strokePosition === "outside"))
    ) {
      return applyVectorStrokePosition(el, strokePosition || "center");
    }
    return true;
  }

  function exactCoverSpanForRange(range: Range): HTMLSpanElement | null {
    var start = range.startContainer;
    var end = range.endContainer;
    if (start !== end) return null;

    if (start.nodeType === 1) {
      var containerEl = start as HTMLElement;
      if (containerEl.tagName !== "SPAN") return null;
      if (containerEl.childNodes.length !== 1) return null;
      if (range.startOffset !== 0 || range.endOffset !== 1) return null;
      return containerEl as HTMLSpanElement;
    }

    if (start.nodeType !== 3) return null;
    var parent = start.parentNode;
    if (!parent || parent.nodeType !== 1) return null;
    var el = parent as HTMLElement;
    if (el.tagName !== "SPAN") return null;
    if (el.childNodes.length !== 1 || el.childNodes[0] !== start) return null;
    if (
      range.startOffset !== 0 ||
      range.endOffset !== start.textContent!.length
    )
      return null;
    return el as HTMLSpanElement;
  }

  function applyTextRangeStyle(property: unknown, value: unknown): boolean {
    var target = activeTextEditEl || suspendedTextEditRange?.target || null;
    if (!target || !property) return false;
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    if (!selection) return false;
    var range =
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      selectionBelongsToElement(selection, target)
        ? selection.getRangeAt(0)
        : activeTextEditEl === target
          ? activeTextEditRange
          : suspendedTextEditRange?.target === target
            ? suspendedTextEditRange.range
            : null;
    if (!range || range.collapsed || !rangeBelongsToElement(range, target)) {
      return false;
    }
    if (
      selection.rangeCount === 0 ||
      selection.isCollapsed ||
      !selectionBelongsToElement(selection, target)
    ) {
      selection.removeAllRanges();
      selection.addRange(range.cloneRange());
      range = selection.getRangeAt(0);
    }
    var reused = exactCoverSpanForRange(range);
    if (reused) {
      if (!applyInlineStyleProperty(reused, property, value)) return false;
      selection.removeAllRanges();
      var reusedRange = document.createRange();
      reusedRange.selectNodeContents(reused);
      selection.addRange(reusedRange);
      if (activeTextEditEl === target) {
        activeTextEditRange = reusedRange.cloneRange();
      } else if (suspendedTextEditRange?.target === target) {
        suspendedTextEditRange.range = reusedRange.cloneRange();
      }
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
    if (activeTextEditEl === target) {
      activeTextEditRange = nextRange.cloneRange();
    } else if (suspendedTextEditRange?.target === target) {
      suspendedTextEditRange.range = nextRange.cloneRange();
    }
    return true;
  }

  var TEXT_EDIT_FORMATS: Record<
    string,
    {
      property: string;
      on: string;
      off: string;
      isOn: (styles: CSSStyleDeclaration) => boolean;
    }
  > = {
    b: {
      property: "font-weight",
      on: "700",
      off: "400",
      isOn: function (styles) {
        var weight = styles.fontWeight;
        return weight === "bold" || Number(weight) >= 600;
      },
    },
    i: {
      property: "font-style",
      on: "italic",
      off: "normal",
      isOn: function (styles) {
        return styles.fontStyle === "italic";
      },
    },
    u: {
      property: "text-decoration",
      on: "underline",
      off: "none",
      isOn: function (styles) {
        return (styles.textDecorationLine || "").indexOf("underline") !== -1;
      },
    },
  };

  function rangeFormatIsOn(
    range: Range,
    spec: { isOn: (styles: CSSStyleDeclaration) => boolean },
  ): boolean {
    var root = range.commonAncestorContainer;
    var rootEl = root.nodeType === 1 ? (root as Element) : root.parentElement;
    if (!rootEl) return false;
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    var sawText = false;
    var current = walker.nextNode();
    while (current) {
      if (
        current.nodeValue &&
        current.nodeValue.trim() &&
        range.intersectsNode(current)
      ) {
        sawText = true;
        var parent = current.parentElement;
        if (!parent || !spec.isOn(window.getComputedStyle(parent))) {
          return false;
        }
      }
      current = walker.nextNode();
    }
    return sawText ? true : spec.isOn(window.getComputedStyle(rootEl));
  }

  function applyTextEditFormat(key: string): boolean {
    var spec = TEXT_EDIT_FORMATS[key];
    if (!spec) return false;
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.rangeCount === 0) return false;
    var range = selection.getRangeAt(0);
    var next = rangeFormatIsOn(range, spec) ? spec.off : spec.on;
    return applyTextRangeStyle(spec.property, next);
  }

  function showTransformBadge(
    text: string,
    clientX: number,
    clientY: number,
  ): void {
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
    transformBadge.style.removeProperty("background");
    transformBadge.style.removeProperty("color");
    transformBadge.style.removeProperty("border-color");
  }

  function showRejectedDragBadge(
    text: string,
    clientX: number,
    clientY: number,
  ): void {
    showTransformBadge(text, clientX, clientY);
    transformBadge.style.background =
      "color-mix(in srgb, #dc2626 92%, transparent)";
    transformBadge.style.color = "#fff";
    transformBadge.style.borderColor = "#dc2626";
  }

  function hideInsertionGuide(): void {
    insertionGuide.style.display = "none";
  }

  function isOverlayElement(el: Element | null): boolean {
    return Boolean(
      el && el.closest && el.closest("[data-agent-native-edit-overlay]"),
    );
  }

  function draggableElementChildren(parent: Element): Element[] {
    return Array.prototype.slice.call(parent.children).filter(function (child) {
      return (
        child.nodeType === 1 &&
        !isOverlayElement(child) &&
        !isLayerInteractionBlocked(child) &&
        !isTemplateCloneElement(child)
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

  function collectSelectionMembers(): Element[] {
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
    return members.filter(function (member) {
      return !members.some(function (other) {
        return other !== member && other.contains(member);
      });
    });
  }

  function collectMoveGroupMembers(gestureEl: Element): Element[] {
    if (!gestureEl) return [];
    var members = collectSelectionMembers();
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

  function isEmptyDropContainer(
    container: Element,
    dragged: Element[],
  ): boolean {
    for (var i = 0; i < dragged.length; i += 1) {
      if (dragged[i] && dragged[i].parentElement === container) return false;
    }
    var nodes = container.childNodes;
    for (var j = 0; j < nodes.length; j += 1) {
      var node = nodes[j];
      if (node.nodeType === 3) {
        if ((node.textContent || "").trim()) return false;
        continue;
      }
      if (node.nodeType !== 1) continue;
      if (isOverlayElement(node as Element)) continue;
      return false;
    }
    return true;
  }

  function applyAutoLayoutConversionForDrop(container: Element): void {
    var el = container as HTMLElement;
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.gap = "10px";
    var styles = {
      display: "flex",
      "flex-direction": "column",
      gap: "10px",
    };
    (window.parent as Window).postMessage(
      {
        type: "visual-style-change",
        selector: getSelector(container),
        styles: styles,
        originalStyles: originalInlineStylesForPatch(container, styles),
        payload: getElementInfo(container),
      },
      "*",
    );
  }

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
    var styles = { color: "inherit" };
    (window.parent as Window).postMessage(
      {
        type: "visual-style-change",
        selector: getSelector(member),
        styles: styles,
        originalStyles: originalInlineStylesForPatch(member, styles),
        payload: getElementInfo(member),
      },
      "*",
    );
  }

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

  function computedSizeInPixels(value: string): number | undefined {
    var match = /^\s*(\d+(?:\.\d+)?)px\s*$/i.exec(value);
    if (!match) return undefined;
    var size = Number(match[1]);
    return Number.isFinite(size) ? size : undefined;
  }

  function flexItemMainSizeChangesWithoutFlexing(
    el: Element,
    property: "width" | "height",
  ): boolean {
    var style = (el as HTMLElement).style;
    if (!style) return false;
    var originalSize = el.getBoundingClientRect()[property];
    var declarations = ["flex-grow", "flex-shrink", "transition"].map(
      function (name) {
        return {
          name,
          value: style.getPropertyValue(name),
          priority: style.getPropertyPriority(name),
        };
      },
    );
    try {
      style.setProperty("transition", "none", "important");
      style.setProperty("flex-grow", "0", "important");
      style.setProperty("flex-shrink", "0", "important");
      return (
        Math.abs(el.getBoundingClientRect()[property] - originalSize) > 0.5
      );
    } finally {
      declarations.forEach(function (declaration) {
        if (declaration.value) {
          style.setProperty(
            declaration.name,
            declaration.value,
            declaration.priority,
          );
        } else {
          style.removeProperty(declaration.name);
        }
      });
    }
  }

  function crossScreenAutoLayoutSizeFallback(
    el: Element | null,
    snapshot: unknown,
    computed: CSSStyleDeclaration | null,
  ): { width?: number; height?: number } | undefined {
    if (
      !el ||
      !computed ||
      computed.position === "absolute" ||
      computed.position === "fixed"
    ) {
      return undefined;
    }
    var parent = el.parentElement;
    if (!parent) return undefined;
    var parentStyle = window.getComputedStyle(parent);
    var isFlex = /^(inline-)?flex$/.test(parentStyle.display);
    var isGrid = /^(inline-)?grid$/.test(parentStyle.display);
    if (!isFlex && !isGrid) return undefined;
    var snapshotRoot = (
      snapshot as {
        nodes?: Array<{ path?: unknown; styles?: unknown }>;
      } | null
    )?.nodes?.find(
      (node) => Array.isArray(node.path) && node.path.length === 0,
    );
    var styles = snapshotRoot?.styles;
    if (!styles || typeof styles !== "object") return undefined;
    var mainAxis = isFlex ? flexMainAxisDimension(parentStyle) : undefined;
    var flexMainSizeIsResolved = false;
    if (isFlex && mainAxis) {
      flexMainSizeIsResolved =
        (computed.flexBasis !== "auto" && computed.flexBasis !== "content") ||
        ((Number(computed.flexGrow) > 0 || Number(computed.flexShrink) > 0) &&
          flexItemMainSizeChangesWithoutFlexing(el, mainAxis));
    }
    var resolvedByAutoLayout = function (property: "width" | "height") {
      if (isGrid) {
        return gridItemDimensionIsStretched(
          el,
          property,
          computed,
          parentStyle,
          typedStyleValue(el, property),
        );
      }
      if (property === mainAxis) {
        return flexMainSizeIsResolved;
      }
      return flexItemDimensionIsStretched(el, property, computed, parentStyle);
    };
    var result: { width?: number; height?: number } = {};
    (["width", "height"] as const).forEach((property) => {
      var snapshotSize = styles[property];
      var snapshotSizeIsAuto =
        typeof snapshotSize === "string" &&
        snapshotSize.trim().toLowerCase() === "auto";
      if (
        (Object.prototype.hasOwnProperty.call(styles, property) &&
          !snapshotSizeIsAuto) ||
        !resolvedByAutoLayout(property)
      ) {
        return;
      }
      var size = computedSizeInPixels(computed[property]);
      if (size !== undefined) result[property] = size;
    });
    return result.width !== undefined || result.height !== undefined
      ? result
      : undefined;
  }

  function eventEpochMilliseconds(
    ev?: { timeStamp?: number; isTrusted?: boolean } | null,
  ): number | undefined {
    if (ev?.isTrusted === false) {
      return performance.timeOrigin + performance.now();
    }
    if (typeof ev?.timeStamp !== "number" || !Number.isFinite(ev.timeStamp)) {
      return undefined;
    }
    return ev.timeStamp >= 1_000_000_000_000
      ? ev.timeStamp
      : performance.timeOrigin + ev.timeStamp;
  }

  function postCrossScreenDrag(
    phase: "start" | "move" | "end" | "cancel",
    el?: Element | null,
    ev?: { clientX?: number; clientY?: number; timeStamp?: number } | null,
    options?: {
      duplicate?: boolean;
      elementRect?: {
        left: number;
        top: number;
        width: number;
        height: number;
      };
      pointerOffset?: { x: number; y: number };
      styleSnapshot?: unknown;
      modifiers?: {
        metaKey?: boolean;
        ctrlKey?: boolean;
        ignoreAutoLayout?: boolean;
        forceNestedAutoLayout?: boolean;
      };
    },
  ): void {
    dndLog("post:cross-screen", { phase: phase, el: getSelector(el ?? null) });
    if (phase === "cancel") {
      activeCrossScreenStyleSnapshot = undefined;
      activeCrossScreenSourceHtml = undefined;
      activeCrossScreenComputedSize = undefined;
      activeCrossScreenDragIdentity = null;
      activeCrossScreenDeleteRequestId = undefined;
      (window.parent as Window).postMessage(
        { type: "agent-native:cross-screen-drag", phase: "cancel" },
        "*",
      );
      return;
    }
    if (phase === "start") {
      activeCrossScreenDeleteRequestId = `cross-screen-source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      activeCrossScreenStyleSnapshot =
        options?.styleSnapshot !== undefined
          ? options.styleSnapshot
          : collectPortableStyleSnapshot(el ?? null);
      activeCrossScreenSourceHtml = el?.outerHTML;
      var computed = el ? window.getComputedStyle(el) : null;
      activeCrossScreenComputedSize = crossScreenAutoLayoutSizeFallback(
        el ?? null,
        activeCrossScreenStyleSnapshot,
        computed,
      );
      var startSourceId = getSourceId(el ?? null);
      var startProvenance = nodeProvenanceForSourceId(
        startSourceId,
        el ?? null,
      );
      var needsStructuralSelector =
        startSourceId &&
        startProvenance?.versionHash &&
        !startProvenance.uniqueNodeId;
      activeCrossScreenDragIdentity = {
        selector: needsStructuralSelector
          ? selectorPath(el ?? null, undefined, true)
          : getSelector(el ?? null),
        sourceId: startSourceId,
        sourceProvenance: startProvenance,
      };
    }
    var dragIdentity = activeCrossScreenDragIdentity;
    var rect = options?.elementRect ?? (el ? el.getBoundingClientRect() : null);
    var pointerOffset =
      options?.pointerOffset ??
      (rect && ev?.clientX !== undefined && ev.clientY !== undefined
        ? {
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
          }
        : undefined);
    (window.parent as Window).postMessage(
      {
        type: "agent-native:cross-screen-drag",
        phase,
        screenId: designCanvasScreenId,
        boardSurface: designCanvasBoardSurface,
        selector: dragIdentity?.selector ?? getSelector(el ?? null),
        sourceId: dragIdentity?.sourceId ?? getSourceId(el ?? null),
        sourceDeleteRequestId: activeCrossScreenDeleteRequestId,
        sourceProvenance: dragIdentity?.sourceProvenance,
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
        sourceComputedSize: activeCrossScreenComputedSize,
        styleSnapshotCaptureFailed: activeCrossScreenStyleSnapshot === null,
        modifiers: options?.modifiers,
        duplicate: options?.duplicate === true ? true : undefined,
        sourceCloneHtml:
          phase === "start" || phase === "end"
            ? activeCrossScreenSourceHtml
            : undefined,
        releasedAt: phase === "end" ? eventEpochMilliseconds(ev) : undefined,
      },
      "*",
    );
    if (phase === "end") {
      bridgeIgnoreAutoLayoutKeyPressed = false;
      activeCrossScreenStyleSnapshot = undefined;
      activeCrossScreenSourceHtml = undefined;
      activeCrossScreenComputedSize = undefined;
      activeCrossScreenDragIdentity = null;
      activeCrossScreenDeleteRequestId = undefined;
    }
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

  function isTextBearingLeaf(el: Element): boolean {
    return hasOnlyLeafContent(el) && (el.textContent || "").trim().length > 0;
  }

  function isContainerDropTarget(el: Element | null): boolean {
    if (!el || el === document.documentElement) return false;
    if (isOverlayElement(el) || isLayerInteractionBlocked(el)) return false;
    if (el === document.body) return true;
    var primitiveKind = el.getAttribute("data-an-primitive");
    if (primitiveKind && primitiveKind !== "frame") return false;
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
      var wraps = cs.flexWrap === "wrap" || cs.flexWrap === "wrap-reverse";
      if (isRow && !wraps) return "x";
      return "y";
    }
    if (cs.display === "grid" || cs.display === "inline-grid") {
      if ((cs.gridAutoFlow || "row").split(/\s+/)[0] === "column") {
        return "y";
      }
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

  function supportsGridPlaceholderProjection(
    container: Element,
    containerStyles: CSSStyleDeclaration,
    children: Element[],
    excluded?: Element[],
  ): boolean {
    if (
      containerStyles.display !== "grid" &&
      containerStyles.display !== "inline-grid"
    ) {
      return false;
    }
    if (containerStyles.transform && containerStyles.transform !== "none") {
      return false;
    }
    var autoFlow = (containerStyles.gridAutoFlow || "row").split(/\s+/);
    if (autoFlow[0] !== "row" && autoFlow[0] !== "column") return false;
    if (autoFlow[1] === "dense" || !children.length) return false;
    var allChildren = (
      Array.prototype.slice.call(container.children) as Element[]
    ).filter(function (child) {
      return (
        child.nodeType === 1 &&
        !isOverlayElement(child) &&
        child.tagName.toLowerCase() !== "template" &&
        !child.hasAttribute("data-agent-native-reflow-placeholder")
      );
    });
    (excluded || []).forEach(function (child) {
      if (allChildren.indexOf(child) === -1) allChildren.push(child);
    });
    for (
      var authoredIndex = 0;
      authoredIndex < allChildren.length;
      authoredIndex += 1
    ) {
      var authoredChild = allChildren[authoredIndex];
      if (
        children.indexOf(authoredChild) === -1 &&
        (excluded || []).indexOf(authoredChild) === -1
      ) {
        return false;
      }
    }
    for (var i = 0; i < allChildren.length; i += 1) {
      var childStyles = window.getComputedStyle(allChildren[i]);
      if (
        childStyles.gridColumnStart !== "auto" ||
        childStyles.gridColumnEnd !== "auto" ||
        childStyles.gridRowStart !== "auto" ||
        childStyles.gridRowEnd !== "auto" ||
        childStyles.order !== "0"
      ) {
        return false;
      }
    }
    return true;
  }

  type GridProjectionSlot = {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  type GridProjectionCacheEntry = {
    container: Element;
    styleKey: string;
    directChildren: Element[];
    children: Element[];
    excluded: Element[];
    slots: GridProjectionSlot[];
  };

  var gridProjectionCaches: GridProjectionCacheEntry[] = [];

  function clearGridProjectionCaches(): void {
    gridProjectionCaches = [];
  }

  function sameGridProjectionElements(
    left: Element[],
    right: Element[],
  ): boolean {
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  function gridProjectionStyleKey(styles: CSSStyleDeclaration): string {
    return [
      styles.gridAutoFlow,
      styles.gridTemplateColumns,
      styles.gridTemplateRows,
      styles.gridAutoColumns,
      styles.gridAutoRows,
      styles.columnGap,
      styles.rowGap,
      styles.justifyContent,
      styles.alignContent,
      styles.width,
      styles.height,
      styles.boxSizing,
      styles.padding,
      styles.border,
    ].join("|");
  }

  function cachedGridProjection(
    container: Element,
    styleKey: string,
    directChildren: Element[],
    children: Element[],
    excluded: Element[],
  ): GridProjectionCacheEntry | null {
    for (var i = 0; i < gridProjectionCaches.length; i += 1) {
      var entry = gridProjectionCaches[i];
      if (
        entry.container === container &&
        entry.styleKey === styleKey &&
        sameGridProjectionElements(entry.directChildren, directChildren) &&
        sameGridProjectionElements(entry.children, children) &&
        sameGridProjectionElements(entry.excluded, excluded)
      ) {
        return entry;
      }
    }
    return null;
  }

  function prepareGridProjectionPlaceholder(
    placeholder: HTMLElement,
    containerStyles: CSSStyleDeclaration,
  ): void {
    if (
      containerStyles.display !== "grid" &&
      containerStyles.display !== "inline-grid"
    ) {
      return;
    }
    placeholder.style.position = "static";
    placeholder.style.left = "auto";
    placeholder.style.top = "auto";
    placeholder.style.right = "auto";
    placeholder.style.bottom = "auto";
    placeholder.style.gridArea = "auto";
    placeholder.style.gridColumn = "auto";
    placeholder.style.gridRow = "auto";
    placeholder.style.order = "0";
  }

  function resetFlowDuplicateGridPlacement(duplicate: HTMLElement): void {
    var parent = duplicate.parentElement;
    if (!parent) return;
    var parentStyles = window.getComputedStyle(parent);
    if (
      parentStyles.display !== "grid" &&
      parentStyles.display !== "inline-grid"
    ) {
      return;
    }
    duplicate.style.gridArea = "auto";
    duplicate.style.gridColumn = "auto";
    duplicate.style.gridRow = "auto";
    duplicate.style.order = "0";
  }

  function gridCellInsertionTarget(
    container: Element,
    clientX: number,
    clientY: number,
    children: Element[],
    excluded: Element[],
  ) {
    var styles = window.getComputedStyle(container);
    if (styles.display !== "grid" && styles.display !== "inline-grid") {
      return null;
    }
    var trackLayout = gridTrackLayoutForElement(container);
    if (trackLayout) {
      trackLayout = expandGridTrackLayoutForAuthoredChildren(
        trackLayout,
        container,
      );
    }
    var singleSource = excluded && excluded.length === 1 ? excluded[0] : null;
    var singleSourceStyles = singleSource
      ? window.getComputedStyle(singleSource)
      : null;
    var singleSourceColumn =
      singleSource && trackLayout
        ? gridItemAxisPlacement(singleSource, trackLayout, "column")
        : null;
    var singleSourceRow =
      singleSource && trackLayout
        ? gridItemAxisPlacement(singleSource, trackLayout, "row")
        : null;
    var sourceHasAuthoredPlacement = Boolean(
      excluded?.some(function (source) {
        var columnPlacement = trackLayout
          ? gridItemAxisPlacement(source, trackLayout, "column")
          : null;
        var rowPlacement = trackLayout
          ? gridItemAxisPlacement(source, trackLayout, "row")
          : null;
        return Boolean(
          columnPlacement?.hasAuthoredPlacement ||
          rowPlacement?.hasAuthoredPlacement,
        );
      }),
    );
    var hasAuthoredSingleCellSourcePlacement = Boolean(
      singleSource &&
      singleSource.parentElement === container &&
      singleSourceStyles &&
      singleSourceStyles.gridColumnStart !== "auto" &&
      singleSourceStyles.gridColumnStart.indexOf("span") !== 0 &&
      singleSourceStyles.gridRowStart !== "auto" &&
      singleSourceStyles.gridRowStart.indexOf("span") !== 0 &&
      (singleSourceStyles.gridColumnEnd === "auto" ||
        singleSourceColumn?.span === 1) &&
      (singleSourceStyles.gridRowEnd === "auto" || singleSourceRow?.span === 1),
    );
    var hit = elementFromEditorPointIgnoring(clientX, clientY, excluded);
    while (hit && hit.parentElement && hit.parentElement !== container) {
      hit = hit.parentElement;
    }
    if (trackLayout && !hasAuthoredSingleCellSourcePlacement) {
      var column = trackLayout.columnBounds.findIndex(function (bound) {
        return clientX >= bound.start && clientX <= bound.end;
      });
      var row = trackLayout.rowBounds.findIndex(function (bound) {
        return clientY >= bound.start && clientY <= bound.end;
      });
      if (
        (column < 0 || row < 0) &&
        hit &&
        hit.parentElement === container &&
        children.indexOf(hit) !== -1
      ) {
        var hitColumn = gridItemAxisPlacement(hit, trackLayout, "column");
        var hitRow = gridItemAxisPlacement(hit, trackLayout, "row");
        if (
          column < 0 &&
          hitColumn.span > 1 &&
          hitColumn.authoredStart !== null
        ) {
          column = hitColumn.authoredStart - 1;
        }
        if (row < 0 && hitRow.span > 1 && hitRow.authoredStart !== null) {
          row = hitRow.authoredStart - 1;
        }
      }
      if (column >= 0 && row >= 0) {
        var cellLeft = trackLayout.columnBounds[column].start;
        var cellTop = trackLayout.rowBounds[row].start;
        var cellRight = trackLayout.columnBounds[column].end;
        var cellBottom = trackLayout.rowBounds[row].end;
        var displaced = children.find(function (child) {
          var rect = child.getBoundingClientRect();
          return (
            rect.left < cellRight &&
            rect.right > cellLeft && // i18n-ignore non-user-facing pointer geometry condition
            rect.top < cellBottom &&
            rect.bottom > cellTop
          );
        });
        var autoFlow = (styles.gridAutoFlow || "row").split(/\s+/);
        var gridAxis = autoFlow[0] === "column" ? "y" : "x";
        var pointer = gridAxis === "x" ? clientX : clientY;
        var midpoint =
          gridAxis === "x"
            ? (cellLeft + cellRight) / 2
            : (cellTop + cellBottom) / 2;
        return {
          anchor: container,
          placement: "inside",
          persistenceAnchor: displaced || container,
          persistencePlacement: displaced
            ? pointer <= midpoint + 0.5
              ? "before"
              : "after"
            : "inside",
          axis: gridAxis,
          dropMode: "flow-insert",
          guideRect: {
            left: cellLeft,
            top: cellTop,
            width: cellRight - cellLeft,
            height: cellBottom - cellTop,
          },
          guideMode: displaced ? "grid-line" : "grid-cell",
          guidePlacement: pointer <= midpoint + 0.5 ? "before" : "after",
          ...(autoFlow[0] === "column" && !sourceHasAuthoredPlacement
            ? {}
            : { gridCell: { column, row } }),
          gridDisplacement: displaced,
        };
      }
    }
    if (
      hit &&
      hit.parentElement === container &&
      children.indexOf(hit) !== -1
    ) {
      return null;
    }
    if (
      !supportsGridPlaceholderProjection(container, styles, children, excluded)
    ) {
      return null;
    }
    var autoFlow = (styles.gridAutoFlow || "row").split(/\s+/);

    var prototype = excluded && excluded.length ? excluded[0] : null;
    var placeholder = prototype
      ? (prototype.cloneNode(true) as HTMLElement)
      : (container.ownerDocument.createElement("div") as HTMLElement);
    placeholder.removeAttribute("data-agent-native-node-id");
    placeholder.setAttribute("data-agent-native-reflow-placeholder", "");
    prepareGridProjectionPlaceholder(placeholder, styles);
    placeholder.style.visibility = "hidden";
    placeholder.style.pointerEvents = "none";
    placeholder.style.transform = "none";
    placeholder.style.transition = "none";

    var originalChildren = Array.prototype.slice.call(
      container.children,
    ) as Element[];
    var originalChildNodes = Array.prototype.slice.call(
      container.childNodes,
    ) as Node[];
    var removed = originalChildren.filter(function (child) {
      return excluded.indexOf(child) !== -1;
    });
    var directChildren = originalChildren.filter(function (child) {
      return (
        child.nodeType === 1 &&
        !isOverlayElement(child) &&
        child.tagName.toLowerCase() !== "template" &&
        !child.hasAttribute("data-agent-native-reflow-placeholder")
      );
    });
    var projectionStyleKey = gridProjectionStyleKey(styles);
    var cachedProjection = cachedGridProjection(
      container,
      projectionStyleKey,
      directChildren,
      children,
      excluded,
    );
    var best: {
      slot: number;
      rect: { left: number; top: number; width: number; height: number };
      distance: number;
    } | null = null;
    var trailingCandidate: typeof best = null;
    var occupiedBottom = -Infinity;
    var occupiedRight = -Infinity;
    var slots: GridProjectionSlot[] = cachedProjection
      ? cachedProjection.slots
      : [];
    if (!cachedProjection) {
      try {
        removed.forEach(function (child) {
          container.removeChild(child);
        });
        for (var slot = 0; slot <= children.length; slot += 1) {
          var anchor = children[slot];
          if (anchor && anchor.parentNode === container) {
            container.insertBefore(placeholder, anchor);
          } else {
            container.appendChild(placeholder);
          }
          var measured = placeholder.getBoundingClientRect();
          slots.push({
            left: measured.left,
            top: measured.top,
            width: measured.width,
            height: measured.height,
          });
          placeholder.remove();
        }
      } finally {
        if (placeholder.parentNode)
          placeholder.parentNode.removeChild(placeholder);
        originalChildNodes.forEach(function (originalChildNode) {
          container.appendChild(originalChildNode);
        });
      }
      cachedProjection = {
        container: container,
        styleKey: projectionStyleKey,
        directChildren: directChildren,
        children: children.slice(),
        excluded: excluded.slice(),
        slots: slots,
      };
      gridProjectionCaches.push(cachedProjection);
    }
    for (var slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      var slotRect = slots[slotIndex];
      var dx =
        clientX < slotRect.left
          ? slotRect.left - clientX
          : clientX > slotRect.left + slotRect.width
            ? clientX - (slotRect.left + slotRect.width)
            : 0;
      var dy =
        clientY < slotRect.top
          ? slotRect.top - clientY
          : clientY > slotRect.top + slotRect.height
            ? clientY - (slotRect.top + slotRect.height)
            : 0;
      var distance = Math.hypot(dx, dy);
      var candidate = {
        slot: slotIndex,
        rect: {
          left: slotRect.left,
          top: slotRect.top,
          width: slotRect.width,
          height: slotRect.height,
        },
        distance: distance,
      };
      if (!best || distance < best.distance) best = candidate;
      if (slotIndex < children.length) {
        occupiedBottom = Math.max(
          occupiedBottom,
          slotRect.top + slotRect.height,
        );
        occupiedRight = Math.max(occupiedRight, slotRect.left + slotRect.width);
      } else {
        trailingCandidate = candidate;
      }
    }
    if (!best) return null;
    if (
      trailingCandidate &&
      ((autoFlow[0] === "row" && clientY > occupiedBottom) ||
        (autoFlow[0] === "column" && clientX > occupiedRight))
    ) {
      best = trailingCandidate;
    }
    var slot = best.slot;
    var anchor = children[slot] || children[children.length - 1];
    return {
      anchor: anchor,
      placement: slot < children.length ? "before" : "after",
      axis: autoFlow[0] === "column" ? "y" : "x",
      dropMode: "flow-insert",
      guideRect: best.rect,
      guideMode: "grid-cell",
    };
  }

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
    var containerStyles = window.getComputedStyle(container);
    var gridCellTarget = gridCellInsertionTarget(
      container,
      clientX,
      clientY,
      children,
      excluded,
    );
    if (gridCellTarget) return gridCellTarget;
    var wrappedFlexAxis = wrappedFlexMainAxis(container);
    var axis = wrappedFlexAxis || parentFlowAxis(container);
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
    excludeEls?: Element[],
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
      excludeEls,
    );
  }

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
      !isOverlayElement(hit) &&
      !isTemplateCloneElement(hit)
    ) {
      var hitAutoLayoutParent = hit.parentElement;
      var hitAutoLayoutStyles = hitAutoLayoutParent
        ? window.getComputedStyle(hitAutoLayoutParent)
        : null;
      var hitIsGrid =
        hitAutoLayoutStyles &&
        (hitAutoLayoutStyles.display === "grid" ||
          hitAutoLayoutStyles.display === "inline-grid");
      var hitIsWrappedFlex =
        hitAutoLayoutStyles &&
        (hitAutoLayoutStyles.display === "flex" ||
          hitAutoLayoutStyles.display === "inline-flex") &&
        (hitAutoLayoutStyles.flexWrap === "wrap" ||
          hitAutoLayoutStyles.flexWrap === "wrap-reverse");
      if (
        hitAutoLayoutParent &&
        isAutoLayoutElement(hitAutoLayoutParent) &&
        (hitAutoLayoutParent === el.parentElement ||
          hitIsGrid ||
          hitIsWrappedFlex)
      ) {
        var directChildSlot = nearestChildInsertionTarget(
          hitAutoLayoutParent,
          clientX,
          clientY,
          dragged,
        );
        if (directChildSlot) return directChildSlot;
      }
      if (isContainerDropTarget(hit) && !isTextBearingLeaf(hit)) {
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
            dropMode:
              isAbsolutePrimitiveContainer(hit) ||
              isFreeformRelativeContainer(hit)
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
      var hasAutoLayoutAncestor = false;
      var ancestor = hit.parentElement;
      while (ancestor && ancestor !== document.body) {
        if (isAutoLayoutElement(ancestor)) {
          hasAutoLayoutAncestor = true;
          break;
        }
        if (isContainerDropTarget(ancestor) && !isTextBearingLeaf(ancestor)) {
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (hit.parentElement !== el.parentElement && hasAutoLayoutAncestor) {
        var descendantTarget = autoLayoutInsertionTargetForPoint(
          el,
          clientX,
          clientY,
          excludeEls,
        );
        if (descendantTarget) return descendantTarget;
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
    if (!siblings.length) {
      return {
        anchor: parent,
        placement: "inside",
        axis: axis,
        dropMode:
          isAbsolutePrimitiveContainer(parent) ||
          isFreeformRelativeContainer(parent)
            ? "absolute-container"
            : "flow-insert",
      };
    }
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

  function flowMoveTargetForPoint(
    el,
    clientX,
    clientY,
    excludeEls,
    keepCurrentParent,
    ignoreTargetAutoLayout,
    forceNestedAutoLayout = false,
  ) {
    if (!el || !el.parentElement) return null;
    var currentParent = el.parentElement;
    var dragged: Element[] = [el].concat(excludeEls || []);
    var parentRect = currentParent.getBoundingClientRect();
    var pointerOutsideCurrentParent =
      clientX < parentRect.left ||
      clientX > parentRect.right ||
      clientY < parentRect.top ||
      clientY > parentRect.bottom;

    var pointHit = elementFromEditorPoint(clientX, clientY);
    if (
      ignoreTargetAutoLayout &&
      pointerOutsideCurrentParent &&
      isAutoLayoutElement(currentParent) &&
      (!pointHit ||
        pointHit === document.body ||
        pointHit === document.documentElement)
    ) {
      return {
        anchor: document.body,
        placement: "inside",
        axis: "y",
        dropMode: "absolute-container",
      };
    }

    if (keepCurrentParent && pointerOutsideCurrentParent) {
      var freeParent = currentParent;
      while (
        freeParent &&
        freeParent.parentElement &&
        freeParent.parentElement !== document.body &&
        isAutoLayoutElement(freeParent)
      ) {
        freeParent = freeParent.parentElement;
      }
      if (freeParent !== currentParent) {
        return {
          anchor: freeParent,
          placement: "after",
          axis: "y",
          dropMode: "flow-insert",
        };
      }
      var retainedSlot = nearestChildInsertionTarget(
        currentParent,
        clientX,
        clientY,
        dragged,
      );
      return (
        retainedSlot || {
          anchor: currentParent,
          placement: "inside",
          axis: parentFlowAxis(currentParent),
          dropMode: "flow-insert",
        }
      );
    }

    var target = reorderTargetForPoint(el, clientX, clientY, excludeEls);
    if (
      (forceNestedAutoLayout || ignoreTargetAutoLayout) &&
      !pointerOutsideCurrentParent
    ) {
      var nestedHit = elementFromEditorPoint(clientX, clientY);
      while (
        nestedHit &&
        nestedHit.parentElement !== currentParent &&
        nestedHit !== el &&
        !el.contains(nestedHit)
      ) {
        if (
          isOverlayElement(nestedHit) ||
          isLayerInteractionBlocked(nestedHit)
        ) {
          nestedHit = null;
          break;
        }
        nestedHit = nestedHit.parentElement;
      }
      if (
        nestedHit &&
        nestedHit !== el &&
        !el.contains(nestedHit) &&
        nestedHit !== currentParent &&
        isAutoLayoutElement(nestedHit) &&
        !isOverlayElement(nestedHit) &&
        !isLayerInteractionBlocked(nestedHit) &&
        nestedHit.parentElement === currentParent &&
        isContainerDropTarget(nestedHit)
      ) {
        target = nearestChildInsertionTarget(
          nestedHit,
          clientX,
          clientY,
          dragged,
        ) || {
          anchor: nestedHit,
          placement: "inside",
          axis: parentFlowAxis(nestedHit),
          dropMode: "flow-insert",
        };
      }
    }
    var container = dropContainerForTarget(target);

    if (
      ignoreTargetAutoLayout &&
      container &&
      container !== document.body &&
      isAutoLayoutElement(container)
    ) {
      return {
        anchor: container,
        placement: "inside",
        axis: parentFlowAxis(container),
        dropMode: "absolute-container",
      };
    }

    if (
      currentParent !== document.body &&
      (container === document.body ||
        container === document.documentElement ||
        target?.anchor === document.body)
    ) {
      return {
        anchor: currentParent,
        placement: "after",
        axis: "y",
        dropMode: "absolute-container",
      };
    }

    if (
      target &&
      target.dropMode === "flow-insert" &&
      container &&
      container !== document.body &&
      isContainerDropTarget(container) &&
      !isAutoLayoutElement(container) &&
      isEmptyDropContainer(container, dragged)
    ) {
      target.needsAutoLayoutConversion = true;
      target.conversionTarget = container;
    }
    return target;
  }

  function ignoreAutoLayoutForDropTarget(target) {
    var container = dropContainerForTarget(target);
    var isDeclaredFrameInAutoLayout = Boolean(
      container &&
      container.getAttribute("data-an-primitive") === "frame" &&
      isAutoLayoutElement(container.parentElement),
    );
    if (
      !target ||
      !container ||
      container === document.body ||
      (!isAutoLayoutElement(container) && !isDeclaredFrameInAutoLayout)
    ) {
      return target;
    }
    return {
      anchor: container,
      placement: "inside",
      axis: parentFlowAxis(container),
      dropMode: "absolute-container",
    };
  }

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

  function autoLayoutInsertionTargetForPoint(
    el,
    clientX,
    clientY,
    excludeEls,
    forceNestedAutoLayout = false,
  ) {
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
      return (
        screenRootFlowInsertionTargetForPoint(clientX, clientY, dragged) ||
        unnestAbsoluteToScreenRoot(el, clientX, clientY)
      );
    }
    var explicitFrame = hit.closest('[data-an-primitive="frame"]');
    if (
      explicitFrame &&
      explicitFrame !== document.body &&
      !isDraggedOrInsideDragged(explicitFrame) &&
      isAutoLayoutElement(explicitFrame.parentElement)
    ) {
      return {
        anchor: explicitFrame,
        placement: "inside",
        axis: parentFlowAxis(explicitFrame),
        dropMode: "flow-insert",
      };
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
      var parent = cursor.parentElement;
      if (
        parent === document.body &&
        isAutoLayoutElement(parent) &&
        cursor !== el &&
        !isDraggedOrInsideDragged(cursor) &&
        !isTemplateCloneElement(cursor)
      ) {
        var rootChildSlot = nearestChildInsertionTarget(
          parent,
          clientX,
          clientY,
          dragged,
        );
        if (rootChildSlot) return rootChildSlot;
      }
      if (
        parent &&
        parent !== document.body &&
        isAutoLayoutElement(parent) &&
        cursor.getAttribute("data-an-primitive") !== "frame" &&
        (!isContainerDropTarget(cursor) ||
          cursor.tagName.toLowerCase() !== "section" ||
          isTemplateCloneElement(cursor)) &&
        !isTextBearingLeaf(parent) &&
        !forceNestedAutoLayout &&
        !isTemplateCloneElement(cursor)
      ) {
        var directChildSlot = nearestChildInsertionTarget(
          parent,
          clientX,
          clientY,
          dragged,
        );
        if (directChildSlot) return directChildSlot;
        var directChildRect = cursor.getBoundingClientRect();
        var directChildAxis = parentFlowAxis(parent);
        var directChildPointer = directChildAxis === "x" ? clientX : clientY;
        var directChildCenter =
          directChildAxis === "x"
            ? directChildRect.left + directChildRect.width / 2
            : directChildRect.top + directChildRect.height / 2;
        return {
          anchor: cursor,
          placement:
            directChildPointer < directChildCenter ? "before" : "after",
          axis: directChildAxis,
          dropMode: "flow-insert",
        };
      }
      if (
        cursor !== document.body &&
        (isAbsolutePrimitiveContainer(cursor) ||
          isFreeformRelativeContainer(cursor))
      ) {
        if (cursor === el.parentElement) return null;
        return {
          anchor: cursor,
          placement: "inside",
          axis: "y",
          dropMode: "absolute-container",
        };
      }
      if (
        cursor !== document.body &&
        isContainerDropTarget(cursor) &&
        !(
          !forceNestedAutoLayout &&
          parent &&
          parent !== document.body &&
          isAutoLayoutElement(parent) &&
          cursor.getAttribute("data-an-primitive") !== "frame" &&
          (cursor.tagName.toLowerCase() !== "section" ||
            isTemplateCloneElement(cursor))
        )
      ) {
        if (!isAutoLayoutElement(cursor)) {
          if (cursor === el.parentElement) return null;
          return {
            anchor: cursor,
            placement: "inside",
            axis: "y",
            dropMode: "absolute-container",
          };
        }
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
            guideRect: betweenContainerChildren.guideRect,
            guideMode: betweenContainerChildren.guideMode,
            guidePlacement: betweenContainerChildren.guidePlacement,
          };
        }
        return {
          anchor: cursor,
          placement: "inside",
          axis: parentFlowAxis(cursor),
          dropMode: "flow-insert",
        };
      }
      if (
        parent &&
        parent !== document.body &&
        parent.parentElement &&
        parent.parentElement !== document.body &&
        isAutoLayoutElement(parent.parentElement) &&
        parent.getAttribute("data-an-primitive") !== "frame"
      ) {
        cursor = parent;
        continue;
      }
      if (parent && parent !== document.body && isContainerDropTarget(parent)) {
        if (!isAutoLayoutElement(parent)) {
          if (parent === el.parentElement) return null;
          return {
            anchor: parent,
            placement: "inside",
            axis: "y",
            dropMode: "absolute-container",
          };
        }
        if (isTemplateCloneElement(cursor)) {
          var cloneFallback = nearestChildInsertionTarget(
            parent,
            clientX,
            clientY,
            dragged,
          );
          if (cloneFallback) {
            return {
              anchor: cloneFallback.anchor,
              placement: cloneFallback.placement,
              axis: cloneFallback.axis,
              dropMode: "flow-insert",
              guideRect: cloneFallback.guideRect,
              guideMode: cloneFallback.guideMode,
              guidePlacement: cloneFallback.guidePlacement,
            };
          }
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
            dragged,
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
      cursor = parent;
    }
    return (
      screenRootFlowInsertionTargetForPoint(clientX, clientY, dragged) ||
      unnestAbsoluteToScreenRoot(el, clientX, clientY)
    );
  }

  function unnestAbsoluteToScreenRoot(el, clientX, clientY) {
    var parent = el && el.parentElement;
    if (
      !parent ||
      parent === document.body ||
      parent === document.documentElement
    ) {
      return null;
    }
    var parentRect = parent.getBoundingClientRect();
    if (
      clientX >= parentRect.left &&
      clientX <= parentRect.right &&
      clientY >= parentRect.top &&
      clientY <= parentRect.bottom
    ) {
      return null;
    }
    return {
      anchor: parent,
      placement: "after",
      axis: "y",
      dropMode: "absolute-container",
    };
  }

  function clipsOverflow(value: string) {
    return (
      value === "hidden" ||
      value === "clip" ||
      value === "auto" ||
      value === "scroll"
    );
  }

  function liftOverflowOnAncestors(els: Element[]) {
    var captured: {
      el: HTMLElement;
      overflow: string;
      overflowX: string;
      overflowY: string;
    }[] = [];
    var seen: HTMLElement[] = [];
    els.forEach(function (el) {
      var cursor = el.parentElement;
      while (
        cursor &&
        cursor !== document.body &&
        cursor !== document.documentElement
      ) {
        var htmlEl = cursor as HTMLElement;
        if (seen.indexOf(htmlEl) === -1) {
          var cs = window.getComputedStyle(htmlEl);
          if (
            clipsOverflow(cs.overflow) ||
            clipsOverflow(cs.overflowX) ||
            clipsOverflow(cs.overflowY)
          ) {
            captured.push({
              el: htmlEl,
              overflow: htmlEl.style.overflow,
              overflowX: htmlEl.style.overflowX,
              overflowY: htmlEl.style.overflowY,
            });
            htmlEl.style.overflow = "visible";
            htmlEl.style.overflowX = "visible";
            htmlEl.style.overflowY = "visible";
          }
          seen.push(htmlEl);
        }
        cursor = cursor.parentElement;
      }
    });
    return captured;
  }

  function restoreOverflowOnAncestors(
    captured: {
      el: HTMLElement;
      overflow: string;
      overflowX: string;
      overflowY: string;
    }[],
  ) {
    captured.forEach(function (entry) {
      entry.el.style.overflow = entry.overflow;
      entry.el.style.overflowX = entry.overflowX;
      entry.el.style.overflowY = entry.overflowY;
    });
  }

  function showInsertionGuideFor(target) {
    if (!target || !target.anchor) {
      hideInsertionGuide();
      return;
    }
    var line = 2 * chromeLineScale();
    var insideBorder = 2 * chromeLineScale();
    var rect = target.guideRect || target.anchor.getBoundingClientRect();
    insertionGuide.style.display = "block";
    insertionGuide.style.background = "var(--design-editor-accent-color)";
    insertionGuide.style.border = "0";
    insertionGuide.style.borderRadius = "999px";
    insertionGuide.style.boxShadow =
      "0 0 0 1px var(--design-editor-accent-color)";
    if (target.guideMode === "grid-line") {
      if (target.axis === "x") {
        var x = target.guidePlacement === "before" ? rect.left : rect.right;
        insertionGuide.style.left = x - line / 2 + "px";
        insertionGuide.style.top = rect.top + "px";
        insertionGuide.style.width = line + "px";
        insertionGuide.style.height = rect.height + "px";
      } else {
        var y = target.guidePlacement === "before" ? rect.top : rect.bottom;
        insertionGuide.style.left = rect.left + "px";
        insertionGuide.style.top = y - line / 2 + "px";
        insertionGuide.style.width = rect.width + "px";
        insertionGuide.style.height = line + "px";
      }
      return;
    }
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
    if (target.guideMode === "grid-cell") {
      insertionGuide.style.boxSizing = "border-box";
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
    if (target.guideMode === "wrapped-slot") {
      if (target.axis === "x") {
        insertionGuide.style.left = rect.left - line / 2 + "px";
        insertionGuide.style.top = rect.top + "px";
        insertionGuide.style.width = line + "px";
        insertionGuide.style.height = rect.height + "px";
      } else {
        insertionGuide.style.left = rect.left + "px";
        insertionGuide.style.top = rect.top - line / 2 + "px";
        insertionGuide.style.width = rect.width + "px";
        insertionGuide.style.height = line + "px";
      }
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

  var ABS_POSITION_INLINE_PROPS = [
    "position",
    "left",
    "top",
    "right",
    "bottom",
  ];
  var FLEX_ITEM_INLINE_PROPS = [
    "flex",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "align-self",
    "order",
  ];
  function stripFlexItemInlineStyles(el: Element): void {
    var htmlEl = el as HTMLElement;
    for (var i = 0; i < FLEX_ITEM_INLINE_PROPS.length; i += 1) {
      htmlEl.style.removeProperty(FLEX_ITEM_INLINE_PROPS[i]);
    }
  }
  function snapshotInlinePositionStyles(el: Element): Record<string, string> {
    var htmlEl = el as HTMLElement;
    var snapshot: Record<string, string> = {};
    for (var i = 0; i < ABS_POSITION_INLINE_PROPS.length; i += 1) {
      var prop = ABS_POSITION_INLINE_PROPS[i];
      snapshot[prop] = htmlEl.style.getPropertyValue(prop);
    }
    return snapshot;
  }
  function restoreInlinePositionStyles(
    el: Element,
    snapshot: Record<string, string> | null | undefined,
  ): void {
    if (!snapshot) return;
    var htmlEl = el as HTMLElement;
    for (var i = 0; i < ABS_POSITION_INLINE_PROPS.length; i += 1) {
      var prop = ABS_POSITION_INLINE_PROPS[i];
      var value = snapshot[prop];
      if (value) {
        htmlEl.style.setProperty(prop, value);
      } else {
        htmlEl.style.removeProperty(prop);
      }
    }
  }
  function snapshotInlineGridStyles(el: Element) {
    var style = (el as HTMLElement).style;
    var declarations: Array<{
      property: string;
      value: string;
      priority: string;
    }> = [];
    for (var index = 0; index < style.length; index += 1) {
      var property = style.item(index);
      if (!/^grid-(?:column|row)(?:-(?:start|end))?$/.test(property)) continue;
      declarations.push({
        property,
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property),
      });
    }
    return declarations;
  }
  function numericGridLine(value: string): number | null {
    var match = value.trim().match(/^(\d+)$/);
    return match ? Number(match[1]) : null;
  }
  function gridLineEnd(value: string, start: number | null): number | null {
    var numeric = numericGridLine(value);
    if (numeric !== null) return numeric;
    var span = value.trim().match(/^span\s+(\d+)$/);
    return span && start !== null ? start + Number(span[1]) : null;
  }
  function withGridAreaProbe<T>(
    container: Element,
    measure: (probe: HTMLElement) => T,
  ): T {
    var htmlContainer = container as HTMLElement;
    var originalStyle = htmlContainer.getAttribute("style");
    var needsContainingBlock =
      window.getComputedStyle(container).position === "static";
    var probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;inset:0;visibility:hidden;pointer-events:none";
    try {
      if (needsContainingBlock)
        htmlContainer.style.setProperty("position", "relative", "important");
      htmlContainer.appendChild(probe);
      return measure(probe);
    } finally {
      probe.remove();
      if (needsContainingBlock) {
        if (originalStyle === null) htmlContainer.removeAttribute("style");
        else htmlContainer.setAttribute("style", originalStyle);
      }
    }
  }
  function gridLineIndexAtCoordinate(
    bounds: Array<{ start: number; end: number }>,
    coordinate: number,
  ): number | null {
    for (var index = 0; index < bounds.length; index += 1) {
      if (Math.abs(bounds[index].start - coordinate) < 1) return index + 1;
    }
    var last = bounds[bounds.length - 1];
    return last && Math.abs(last.end - coordinate) < 1
      ? bounds.length + 1
      : null;
  }
  function gridLinePosition(
    value: string,
    layout: ReturnType<typeof gridTrackLayoutForElement>,
    axis: "column" | "row",
  ): number | null {
    var numeric = numericGridLine(value);
    if (numeric !== null) return numeric;
    if (!layout) return null;
    var negative = value.trim().match(/^-(\d+)$/);
    if (negative) {
      var bounds = axis === "column" ? layout.columnBounds : layout.rowBounds;
      var coordinates = withGridAreaProbe(layout.container, function (probe) {
        if (axis === "column") probe.style.gridRow = "1 / 1";
        else probe.style.gridColumn = "1 / 1";
        if (axis === "column") probe.style.gridColumn = "1 / 1";
        else probe.style.gridRow = "1 / 1";
        var first = probe.getBoundingClientRect();
        if (axis === "column") probe.style.gridColumn = `${value} / ${value}`;
        else probe.style.gridRow = `${value} / ${value}`;
        var resolved = probe.getBoundingClientRect();
        return axis === "column"
          ? { first: first.left, resolved: resolved.left }
          : { first: first.top, resolved: resolved.top };
      });
      var firstLine = gridLineIndexAtCoordinate(bounds, coordinates.first);
      var resolvedLine = gridLineIndexAtCoordinate(
        bounds,
        coordinates.resolved,
      );
      return firstLine !== null && resolvedLine !== null
        ? resolvedLine - firstLine + 1
        : null;
    }
    var name = value.trim();
    if (!name || name === "auto" || name.startsWith("span ")) return null;
    var template =
      axis === "column" ? layout.columnTemplate : layout.rowTemplate;
    var lineIndex = 1;
    var tokens = template.match(/\[[^\]]*\]|[^\s]+/g) || [];
    for (var token of tokens) {
      if (token.startsWith("[")) {
        if (token.slice(1, -1).split(/\s+/).includes(name)) return lineIndex;
      } else if (readFinitePx(token) !== null) {
        lineIndex += 1;
      }
    }
    return null;
  }
  function gridItemAxisPlacement(
    el: Element,
    layout: ReturnType<typeof gridTrackLayoutForElement>,
    axis: "column" | "row",
  ) {
    var styles = window.getComputedStyle(el);
    var startValue =
      axis === "column" ? styles.gridColumnStart : styles.gridRowStart;
    var endValue = axis === "column" ? styles.gridColumnEnd : styles.gridRowEnd;
    var start = gridLinePosition(startValue, layout, axis);
    var end = gridLinePosition(endValue, layout, axis);
    var authoredSpan =
      endValue.trim().match(/^span\s+(\d+)$/) ||
      startValue.trim().match(/^span\s+(\d+)$/);
    var hasAuthoredPlacement =
      authoredSpan !== null ||
      (startValue.trim() !== "auto" && startValue.trim() !== "") ||
      (endValue.trim() !== "auto" && endValue.trim() !== "") ||
      styles.order !== "0";
    var geometricRange = layout
      ? gridTrackRangeForRect(
          el.getBoundingClientRect(),
          axis === "column" ? layout.columnBounds : layout.rowBounds,
          axis,
        )
      : null;
    var span = authoredSpan
      ? Number(authoredSpan[1])
      : start !== null && end !== null
        ? end - start
        : geometricRange
          ? geometricRange.end - geometricRange.start
          : 1;
    span = Math.max(1, span);
    if (start === null && end !== null && authoredSpan) start = end - span;
    return {
      authoredStart: start,
      hasAuthoredPlacement: hasAuthoredPlacement,
      start: start ?? (geometricRange ? geometricRange.start + 1 : null),
      span,
    };
  }
  function expandGridTrackLayoutForAuthoredChildren(
    layout: {
      container: Element;
      rect: DOMRect;
      columns: number[];
      rows: number[];
      columnTemplate: string;
      rowTemplate: string;
      columnBounds: Array<{ start: number; end: number }>;
      rowBounds: Array<{ start: number; end: number }>;
    },
    container: Element,
  ) {
    var requiredColumns = layout.columnBounds.length;
    var requiredRows = layout.rowBounds.length;
    var children = Array.prototype.slice.call(container.children) as Element[];
    children.forEach(function (child) {
      var styles = window.getComputedStyle(child);
      var columnStart = numericGridLine(styles.gridColumnStart);
      var rowStart = numericGridLine(styles.gridRowStart);
      var columnEnd = gridLineEnd(styles.gridColumnEnd, columnStart);
      var rowEnd = gridLineEnd(styles.gridRowEnd, rowStart);
      if (columnStart !== null) {
        requiredColumns = Math.max(
          requiredColumns,
          columnEnd !== null ? columnEnd - 1 : columnStart,
        );
      }
      if (rowStart !== null) {
        requiredRows = Math.max(
          requiredRows,
          rowEnd !== null ? rowEnd - 1 : rowStart,
        );
      }
    });
    var extendBounds = function (
      bounds: Array<{ start: number; end: number }>,
      required: number,
    ) {
      while (bounds.length < required) {
        var previous = bounds[bounds.length - 1];
        var beforePrevious = bounds[bounds.length - 2];
        var size = previous ? previous.end - previous.start : 0;
        var gap =
          previous && beforePrevious ? previous.start - beforePrevious.end : 0;
        var start = previous ? previous.end + gap : 0;
        bounds.push({ start, end: start + size });
      }
    };
    extendBounds(layout.columnBounds, requiredColumns);
    extendBounds(layout.rowBounds, requiredRows);
    if (
      requiredColumns > layout.columns.length ||
      requiredRows > layout.rows.length
    ) {
      withGridAreaProbe(container, function (probe) {
        for (
          var column = layout.columns.length;
          column < requiredColumns;
          column += 1
        ) {
          probe.style.gridColumn = `${column + 1} / ${column + 2}`;
          probe.style.gridRow = "1 / 2";
          var columnRect = probe.getBoundingClientRect();
          if (columnRect.width > 0)
            layout.columnBounds[column] = {
              start: columnRect.left,
              end: columnRect.right,
            };
        }
        for (var row = layout.rows.length; row < requiredRows; row += 1) {
          probe.style.gridColumn = "1 / 2";
          probe.style.gridRow = `${row + 1} / ${row + 2}`;
          var rowRect = probe.getBoundingClientRect();
          if (rowRect.height > 0)
            layout.rowBounds[row] = { start: rowRect.top, end: rowRect.bottom };
        }
      });
    }
    return layout;
  }
  function restoreInlineGridStyles(
    el: Element,
    snapshot:
      | Array<{ property: string; value: string; priority: string }>
      | null
      | undefined,
  ): void {
    if (!snapshot) return;
    var style = (el as HTMLElement).style;
    for (var property of [
      "grid-column",
      "grid-column-start",
      "grid-column-end",
      "grid-row",
      "grid-row-start",
      "grid-row-end",
    ])
      style.removeProperty(property);
    snapshot.forEach(function (declaration) {
      style.setProperty(
        declaration.property,
        declaration.value,
        declaration.priority,
      );
    });
  }
  function dragOriginInlinePositionStyles(state: {
    originalPosition: string;
    originalLeft: string;
    originalTop: string;
  }): Record<string, string> {
    return {
      position: state.originalPosition,
      left: state.originalLeft,
      top: state.originalTop,
      right: "",
      bottom: "",
    };
  }
  function stripAbsolutePositioningForFlowInsert(el: Element, target): void {
    if (!target || target.dropMode !== "flow-insert") return;
    var htmlEl = el as HTMLElement;
    var primitive = (
      el.getAttribute("data-an-primitive") ||
      el.getAttribute("data-agent-native-primitive") ||
      ""
    ).toLowerCase();
    var keepsContainingBlock = primitive === "frame";
    var cs = window.getComputedStyle(htmlEl);
    if (
      !keepsContainingBlock &&
      cs.position !== "absolute" &&
      cs.position !== "fixed"
    ) {
      return;
    }
    for (var i = 0; i < ABS_POSITION_INLINE_PROPS.length; i += 1) {
      htmlEl.style.removeProperty(ABS_POSITION_INLINE_PROPS[i]);
    }
    if (keepsContainingBlock) {
      htmlEl.style.setProperty("position", "relative");
      htmlEl.style.setProperty("left", "auto");
      htmlEl.style.setProperty("top", "auto");
      htmlEl.style.setProperty("right", "auto");
      htmlEl.style.setProperty("bottom", "auto");
    }
    var afterRemoval = window.getComputedStyle(htmlEl).position;
    var needsPositionOverride = keepsContainingBlock
      ? afterRemoval !== "relative"
      : afterRemoval === "absolute" || afterRemoval === "fixed";
    if (needsPositionOverride) {
      htmlEl.style.setProperty(
        "position",
        keepsContainingBlock ? "relative" : "static",
        "important",
      );
      if (keepsContainingBlock) {
        htmlEl.style.setProperty("left", "auto", "important");
        htmlEl.style.setProperty("top", "auto", "important");
        htmlEl.style.setProperty("right", "auto", "important");
        htmlEl.style.setProperty("bottom", "auto", "important");
      }
      target.forceFlowPositionOverride = true;
    }
  }

  function rebaseAbsoluteMemberForContainerDrop(el, target): void {
    if (!el || !target || target.dropMode !== "absolute-container") return;
    if (target.absoluteCoordinatesPrepared) return;
    var container = dropContainerForTarget(target);
    if (!container || container === el) return;
    if (el.contains && el.contains(container)) return;
    var htmlEl = el as HTMLElement;
    var cs = window.getComputedStyle(htmlEl);
    if (cs.position !== "absolute" && cs.position !== "fixed") return;
    var containerRect = container.getBoundingClientRect();
    var containerCS = window.getComputedStyle(container);
    var boardOffsetX = designCanvasBoardSurface
      ? designCanvasContentOffsetX
      : 0;
    var boardOffsetY = designCanvasBoardSurface
      ? designCanvasContentOffsetY
      : 0;
    var bodyIsContainingBlock =
      container !== document.body ||
      containerCS.position !== "static" ||
      containerCS.transform !== "none" ||
      (containerCS.getPropertyValue("translate") || "none") !== "none";
    var newOriginBoardOffsetX = container === document.body ? 0 : boardOffsetX;
    var newOriginBoardOffsetY = container === document.body ? 0 : boardOffsetY;
    var newOriginX = bodyIsContainingBlock
      ? containerRect.left -
        newOriginBoardOffsetX +
        readPx(containerCS.borderLeftWidth) -
        container.scrollLeft
      : -(window.scrollX || 0);
    var newOriginY = bodyIsContainingBlock
      ? containerRect.top -
        newOriginBoardOffsetY +
        readPx(containerCS.borderTopWidth) -
        container.scrollTop
      : -(window.scrollY || 0);
    var oldOriginX = -(window.scrollX || 0);
    var oldOriginY = -(window.scrollY || 0);
    var offsetParent = htmlEl.offsetParent as HTMLElement | null;
    if (offsetParent && offsetParent !== document.documentElement) {
      var offsetParentIsRealContainingBlock = true;
      if (offsetParent === document.body) {
        var bodyCS = window.getComputedStyle(document.body);
        offsetParentIsRealContainingBlock =
          bodyCS.position !== "static" ||
          bodyCS.transform !== "none" ||
          (bodyCS.getPropertyValue("translate") || "none") !== "none";
      }
      if (offsetParentIsRealContainingBlock) {
        var opRect = offsetParent.getBoundingClientRect();
        var opCS = window.getComputedStyle(offsetParent);
        var oldContainingBlockOffsetX =
          designCanvasBoardSurface && offsetParent !== document.body
            ? boardOffsetX
            : 0;
        var oldContainingBlockOffsetY =
          designCanvasBoardSurface && offsetParent !== document.body
            ? boardOffsetY
            : 0;
        oldOriginX =
          opRect.left -
          oldContainingBlockOffsetX +
          readPx(opCS.borderLeftWidth) -
          offsetParent.scrollLeft;
        oldOriginY =
          opRect.top -
          oldContainingBlockOffsetY +
          readPx(opCS.borderTopWidth) -
          offsetParent.scrollTop;
      }
    }
    var currentLeft = readPx(htmlEl.style.left || cs.left);
    var currentTop = readPx(htmlEl.style.top || cs.top);
    htmlEl.style.left =
      Math.round(currentLeft + (oldOriginX - newOriginX)) + "px";
    htmlEl.style.top =
      Math.round(currentTop + (oldOriginY - newOriginY)) + "px";
  }

  function prepareFlowMembersForAbsoluteDrop(
    members: Element[],
    target,
    startRects: DOMRect[],
    gestureStartRect: DOMRect,
    pointerOffset: { x: number; y: number },
    clientX: number,
    clientY: number,
  ): void {
    if (!target || target.dropMode !== "absolute-container") return;
    var container = dropContainerForTarget(target);
    if (!container) return;
    var containerRect = container.getBoundingClientRect();
    var containerCS = window.getComputedStyle(container);
    var containerIsBodyContainingBlock = true;
    if (container === document.body) {
      containerIsBodyContainingBlock =
        containerCS.position !== "static" ||
        containerCS.transform !== "none" ||
        (containerCS.getPropertyValue("translate") || "none") !== "none";
    }
    var originX = containerIsBodyContainingBlock
      ? containerRect.left +
        readPx(containerCS.borderLeftWidth) -
        container.scrollLeft
      : -(window.scrollX || 0);
    var originY = containerIsBodyContainingBlock
      ? containerRect.top +
        readPx(containerCS.borderTopWidth) -
        container.scrollTop
      : -(window.scrollY || 0);
    var desiredGestureLeft = clientX - pointerOffset.x;
    var desiredGestureTop = clientY - pointerOffset.y;
    var deltaX = desiredGestureLeft - gestureStartRect.left;
    var deltaY = desiredGestureTop - gestureStartRect.top;

    members.forEach(function (member, index) {
      var startRect = startRects[index] || member.getBoundingClientRect();
      var htmlEl = member as HTMLElement;
      htmlEl.style.position = "absolute";
      htmlEl.style.left = Math.round(startRect.left + deltaX - originX) + "px";
      htmlEl.style.top = Math.round(startRect.top + deltaY - originY) + "px";
      htmlEl.style.removeProperty("right");
      htmlEl.style.removeProperty("bottom");
      stripFlexItemInlineStyles(htmlEl);
      (
        htmlEl as HTMLElement & {
          __agentNativeDesiredDropPoint?: { left: number; top: number };
        }
      ).__agentNativeDesiredDropPoint = {
        left: startRect.left + deltaX,
        top: startRect.top + deltaY,
      };
    });
    target.absoluteCoordinatesPrepared = true;
  }

  function correctAbsoluteMemberClientPosition(
    el: Element,
    desired: { left: number; top: number } | null,
  ): void {
    if (!desired) return;
    var htmlEl = el as HTMLElement;
    var cs = window.getComputedStyle(htmlEl);
    if (cs.position !== "absolute" && cs.position !== "fixed") return;
    var baseLeft = readPx(htmlEl.style.left || cs.left);
    var baseTop = readPx(htmlEl.style.top || cs.top);
    var baseRect = htmlEl.getBoundingClientRect();
    var clientDx = desired.left - baseRect.left;
    var clientDy = desired.top - baseRect.top;
    if (Math.abs(clientDx) < 0.01 && Math.abs(clientDy) < 0.01) return;

    htmlEl.style.left = baseLeft + 1 + "px";
    var leftRect = htmlEl.getBoundingClientRect();
    htmlEl.style.left = baseLeft + "px";
    htmlEl.style.top = baseTop + 1 + "px";
    var topRect = htmlEl.getBoundingClientRect();
    htmlEl.style.top = baseTop + "px";

    var xx = leftRect.left - baseRect.left;
    var xy = leftRect.top - baseRect.top;
    var yx = topRect.left - baseRect.left;
    var yy = topRect.top - baseRect.top;
    var determinant = xx * yy - yx * xy;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 0.000001) {
      return;
    }
    var localDx = (clientDx * yy - yx * clientDy) / determinant;
    var localDy = (xx * clientDy - clientDx * xy) / determinant;
    htmlEl.style.left = Math.round(baseLeft + localDx) + "px";
    htmlEl.style.top = Math.round(baseTop + localDy) + "px";
  }

  function applyRuntimeReorder(
    el,
    target,
    preview = false,
    excludedDisplacements: Element[] = [],
  ): boolean {
    if (!el || !target || !target.anchor || !target.anchor.parentElement)
      return false;
    var previousParent = el.parentElement;
    var previousNextSibling = el.nextElementSibling;
    var previousInlineStyle = el.getAttribute("style");
    var desiredDropPoint =
      target.dropMode === "absolute-container"
        ? ((
            el as HTMLElement & {
              __agentNativeDesiredDropPoint?: { left: number; top: number };
            }
          ).__agentNativeDesiredDropPoint ??
          (function () {
            var rect = el.getBoundingClientRect();
            return { left: rect.left, top: rect.top };
          })())
        : null;
    delete (
      el as HTMLElement & {
        __agentNativeDesiredDropPoint?: { left: number; top: number };
      }
    ).__agentNativeDesiredDropPoint;
    stripAbsolutePositioningForFlowInsert(el, target);
    if (target.gridCell) {
      var sourceGridLayout = previousParent
        ? gridTrackLayoutForElement(previousParent)
        : null;
      if (sourceGridLayout) {
        sourceGridLayout = expandGridTrackLayoutForAuthoredChildren(
          sourceGridLayout,
          previousParent,
        );
      }
      var sourceColumn = gridItemAxisPlacement(el, sourceGridLayout, "column");
      var sourceRow = gridItemAxisPlacement(el, sourceGridLayout, "row");
      var sourceHasAuthoredPlacement =
        sourceColumn.hasAuthoredPlacement || sourceRow.hasAuthoredPlacement;
      var columnStart = sourceColumn.start ?? NaN;
      var columnSpan = sourceColumn.span;
      var columnEnd = columnStart + columnSpan;
      var rowStart = sourceRow.start ?? NaN;
      var rowSpan = sourceRow.span;
      var rowEnd = rowStart + rowSpan;
      var targetGridLayout = gridTrackLayoutForElement(target.anchor);
      if (targetGridLayout) {
        targetGridLayout = expandGridTrackLayoutForAuthoredChildren(
          targetGridLayout,
          target.anchor,
        );
      }
      var targetDisplacements: Element[] = [];
      if (targetGridLayout) {
        var targetLeft =
          targetGridLayout.columnBounds[target.gridCell.column]?.start;
        var targetRight =
          targetGridLayout.columnBounds[
            Math.min(
              targetGridLayout.columnBounds.length - 1,
              target.gridCell.column + columnSpan - 1,
            )
          ]?.end;
        var targetTop = targetGridLayout.rowBounds[target.gridCell.row]?.start;
        var targetBottom =
          targetGridLayout.rowBounds[
            Math.min(
              targetGridLayout.rowBounds.length - 1,
              target.gridCell.row + rowSpan - 1,
            )
          ]?.end;
        if (
          Number.isFinite(targetLeft) &&
          Number.isFinite(targetRight) &&
          Number.isFinite(targetTop) &&
          Number.isFinite(targetBottom)
        ) {
          targetDisplacements = (
            Array.prototype.slice.call(target.anchor.children) as Element[]
          ).filter(function (child) {
            if (child === el || excludedDisplacements.indexOf(child) !== -1)
              return false;
            var rect = child.getBoundingClientRect();
            return (
              rect.left < targetRight &&
              rect.right > targetLeft && // i18n-ignore non-user-facing pointer geometry condition
              rect.top < targetBottom &&
              rect.bottom > targetTop
            );
          });
        }
      }
      target.gridDisplacements = targetDisplacements;
      target.gridDisplacement = targetDisplacements[0];
      target.gridDisplacementPlacements = [];
      target.gridDisplacementPrevStyles = [];
      if (
        targetDisplacements.length > 0 &&
        Number.isFinite(columnStart) &&
        Number.isFinite(columnEnd) &&
        Number.isFinite(rowStart) &&
        Number.isFinite(rowEnd)
      ) {
        var allocatedDisplacementPlacements: Array<{
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        }> = [];
        var occupiedGridPlacements: Array<{
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        }> = [
          {
            column: target.gridCell.column + 1,
            columnEnd: target.gridCell.column + 1 + columnSpan,
            row: target.gridCell.row + 1,
            rowEnd: target.gridCell.row + 1 + rowSpan,
          },
        ];
        (Array.prototype.slice.call(target.anchor.children) as Element[])
          .filter(function (child) {
            return (
              child !== el &&
              excludedDisplacements.indexOf(child) === -1 &&
              targetDisplacements.indexOf(child) === -1
            );
          })
          .forEach(function (child) {
            var childRect = child.getBoundingClientRect();
            var childColumnRange = gridTrackRangeForRect(
              childRect,
              targetGridLayout!.columnBounds,
              "column",
            );
            var childRowRange = gridTrackRangeForRect(
              childRect,
              targetGridLayout!.rowBounds,
              "row",
            );
            if (childColumnRange && childRowRange) {
              occupiedGridPlacements.push({
                column: childColumnRange.start + 1,
                columnEnd: childColumnRange.end + 1,
                row: childRowRange.start + 1,
                rowEnd: childRowRange.end + 1,
              });
            }
          });
        var placementOverlaps = function (
          candidate: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          },
          allocated: Array<{
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          }>,
        ) {
          return allocated.some(function (existing) {
            return (
              candidate.column < existing.columnEnd &&
              candidate.columnEnd > existing.column &&
              candidate.row < existing.rowEnd &&
              candidate.rowEnd > existing.row
            );
          });
        };
        targetDisplacements.forEach(function (displaced) {
          var displacedColumnPlacement = gridItemAxisPlacement(
            displaced,
            targetGridLayout,
            "column",
          );
          var displacedRowPlacement = gridItemAxisPlacement(
            displaced,
            targetGridLayout,
            "row",
          );
          var displacedHasAuthoredPlacement =
            displacedColumnPlacement.hasAuthoredPlacement ||
            displacedRowPlacement.hasAuthoredPlacement;
          if (!displacedHasAuthoredPlacement) return;
          var displacedRange = gridTrackRangeForRect(
            displaced.getBoundingClientRect(),
            targetGridLayout!.columnBounds,
            "column",
          );
          var displacedRowRange = gridTrackRangeForRect(
            displaced.getBoundingClientRect(),
            targetGridLayout!.rowBounds,
            "row",
          );
          var displacedColumnSpan = displacedRange
            ? Math.max(1, displacedRange.end - displacedRange.start)
            : 1;
          var displacedRowSpan = displacedRowRange
            ? Math.max(1, displacedRowRange.end - displacedRowRange.start)
            : 1;
          var displacementPlacement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          } | null = null;
          var maxRows = Math.max(targetGridLayout!.rowBounds.length, rowEnd);
          var maxColumns = Math.max(
            targetGridLayout!.columnBounds.length,
            columnEnd,
          );
          var candidateCoordinates: Array<{ row: number; column: number }> = [];
          var candidateKeys: { [key: string]: boolean } = {};
          var addCandidateCoordinates = function (row: number, column: number) {
            var key = row + ":" + column;
            if (!candidateKeys[key]) {
              candidateKeys[key] = true;
              candidateCoordinates.push({ row, column });
            }
          };
          for (var oldRow = rowStart; oldRow < rowEnd; oldRow += 1) {
            for (
              var oldColumn = columnStart;
              oldColumn < columnEnd;
              oldColumn += 1
            ) {
              addCandidateCoordinates(oldRow, oldColumn);
            }
          }
          for (
            var displacementRow = 1;
            displacementRow <= maxRows + targetDisplacements.length;
            displacementRow += 1
          ) {
            for (
              var displacementColumn = 1;
              displacementColumn <= maxColumns + targetDisplacements.length;
              displacementColumn += 1
            ) {
              addCandidateCoordinates(displacementRow, displacementColumn);
            }
          }
          for (
            var candidateIndex = 0;
            candidateIndex < candidateCoordinates.length &&
            !displacementPlacement;
            candidateIndex += 1
          ) {
            var coordinate = candidateCoordinates[candidateIndex];
            if (coordinate) {
              var candidate = {
                column: coordinate.column,
                columnEnd: coordinate.column + displacedColumnSpan,
                row: coordinate.row,
                rowEnd: coordinate.row + displacedRowSpan,
              };
              if (!placementOverlaps(candidate, occupiedGridPlacements)) {
                displacementPlacement = candidate;
              }
            }
          }
          if (!displacementPlacement) return;
          allocatedDisplacementPlacements.push(displacementPlacement);
          occupiedGridPlacements.push(displacementPlacement);
          target.gridDisplacementPrevStyles.push({
            element: displaced,
            styles: snapshotInlineGridStyles(displaced),
          });
          target.gridDisplacementPlacements.push({
            element: displaced,
            placement: displacementPlacement,
          });
          displaced.style.gridColumn = `${displacementPlacement.column} / ${displacementPlacement.columnEnd}`;
          displaced.style.gridRow = `${displacementPlacement.row} / ${displacementPlacement.rowEnd}`;
        });
      }
      if (sourceHasAuthoredPlacement) {
        el.style.gridColumn = `${target.gridCell.column + 1} / ${target.gridCell.column + 1 + columnSpan}`;
        el.style.gridRow = `${target.gridCell.row + 1} / ${target.gridCell.row + 1 + rowSpan}`;
        target.gridPlacement = {
          column: target.gridCell.column + 1,
          columnEnd: target.gridCell.column + 1 + columnSpan,
          row: target.gridCell.row + 1,
          rowEnd: target.gridCell.row + 1 + rowSpan,
        };
      }
    }
    rebaseAbsoluteMemberForContainerDrop(el, target);
    var persistenceAnchor = target.persistenceAnchor || target.anchor;
    var persistencePlacement = target.persistencePlacement || target.placement;
    if (persistencePlacement === "inside") {
      persistenceAnchor.appendChild(el);
    } else {
      var parent = persistenceAnchor.parentElement;
      if (persistencePlacement === "before") {
        parent.insertBefore(el, persistenceAnchor);
      } else {
        parent.insertBefore(el, persistenceAnchor.nextSibling);
      }
    }
    correctAbsoluteMemberClientPosition(el, desiredDropPoint);
    var runtimeMutationApplied =
      previousParent !== el.parentElement ||
      previousNextSibling !== el.nextElementSibling ||
      previousInlineStyle !== el.getAttribute("style");
    if (runtimeMutationApplied && !preview) {
      publishSourceDocumentProvenance(undefined, true);
    }
    return runtimeMutationApplied;
  }

  function postVisualStructureChange(
    el,
    target,
    origin,
    insertedHtml?,
    replaced?,
    replacementSnapshotHtml?: string,
    collectMessages?: any[],
    transactionId?: string,
    requestIdOverride?: string,
    runtimeInsert?: boolean,
  ) {
    if (!el || !target || !target.anchor) return;
    var messageAnchor = collectMessages
      ? target.anchor
      : target.persistenceAnchor || target.anchor;
    var messagePlacement = collectMessages
      ? target.placement
      : target.persistencePlacement || target.placement;
    dndLog("post:structure-change", {
      el: getSelector(el),
      anchor: getSelector(target.anchor),
      persistenceAnchor: getSelector(messageAnchor),
      placement: target.placement,
      persistencePlacement: messagePlacement,
      dropMode: target.dropMode || "flow-insert",
    });
    var requestId =
      requestIdOverride ||
      "move-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    pendingStructureMoves[requestId] = {
      requestId: requestId,
      el: el,
      target: target,
      origin: origin || null,
    };
    var message = {
      type: "visual-structure-change",
      requestId: requestId,
      transactionId: transactionId,
      routePath: window.location.pathname + window.location.search,
      selector: getSelector(el),
      sourceId: getSourceId(el),
      anchorSelector: getSelector(messageAnchor),
      anchorSourceId: getSourceId(messageAnchor),
      placement: messagePlacement,
      persistenceAnchorSelector: getSelector(
        target.persistenceAnchor || target.anchor,
      ),
      persistenceAnchorSourceId: getSourceId(
        target.persistenceAnchor || target.anchor,
      ),
      persistencePlacement: target.persistencePlacement || target.placement,
      dropMode: target.dropMode || "flow-insert",
      forceFlowPositionOverride: Boolean(target.forceFlowPositionOverride),
      gridPlacement: target.gridPlacement,
      gridDisplacements: Array.isArray(target.gridDisplacementPlacements)
        ? target.gridDisplacementPlacements.map(function (entry) {
            return {
              selector: getSelector(entry.element),
              sourceId: getSourceId(entry.element),
              placement: entry.placement,
            };
          })
        : undefined,
      insertedHtml: typeof insertedHtml === "string" ? insertedHtml : undefined,
      runtimeInsert: runtimeInsert === true ? true : undefined,
      replaced: replaced === true ? true : undefined,
      replacementSnapshotHtml: replacementSnapshotHtml,
      sourceRect: rectInfoForElement(el),
      anchorRect: rectInfoForElement(target.anchor),
      payload: getElementInfo(el),
      anchorPayload: getElementInfo(messageAnchor),
    };
    if (collectMessages) collectMessages.push(message);
    else (window.parent as Window).postMessage(message, "*");
  }

  function postVisualDuplicateChange(
    originalEl,
    cloneEl,
    target,
    sourceNodeIdMap?: Array<[string, string]>,
  ) {
    if (!originalEl || !cloneEl) return;
    var anchorEl =
      target && (target.persistenceAnchor || target.anchor)
        ? target.persistenceAnchor || target.anchor
        : originalEl;
    recordSourceSubtree(cloneEl);
    var requestId =
      "duplicate-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    pendingStructureMoves[requestId] = {
      requestId: requestId,
      el: cloneEl,
      target: target || null,
      origin: { inserted: true, fallbackSelection: originalEl },
    };
    (window.parent as Window).postMessage(
      {
        type: "visual-duplicate-change",
        requestId: requestId,
        selector: getSelector(originalEl),
        sourceId: getSourceId(originalEl),
        anchorSelector: getSelector(anchorEl),
        anchorSourceId: getSourceId(anchorEl),
        placement:
          target && (target.persistencePlacement || target.placement)
            ? target.persistencePlacement || target.placement
            : "after",
        dropMode: target && target.dropMode ? target.dropMode : undefined,
        forceFlowPositionOverride:
          target && target.forceFlowPositionOverride === true
            ? true
            : undefined,
        sourceRect: rectInfoForElement(cloneEl),
        anchorRect: rectInfoForElement(anchorEl),
        sourceNodeIdMap: Array.isArray(sourceNodeIdMap)
          ? sourceNodeIdMap
          : undefined,
        cloneHtml: cloneEl.outerHTML,
        payload: getElementInfo(cloneEl),
        anchorPayload: getElementInfo(anchorEl),
      },
      "*",
    );
  }

  function applyGroupStructureDrop(
    members: Element[],
    target,
    ev,
    originInlineStylesFor?: (member: Element) => Record<string, string>,
    preview = false,
  ): void {
    var container = dropContainerForTarget(target);
    var transactionId =
      !preview && members.length > 1
        ? "group-" + Date.now() + "-" + Math.random().toString(16).slice(2)
        : undefined;
    var gridGroupMessages =
      !preview && target.gridCell && gridGroupBatchingEnabled ? [] : null;
    var previous: Element | null = null;
    var plannedGridPlacements: Array<{
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    }> = [];
    var targetGridLayout = target.gridCell
      ? gridTrackLayoutForElement(target.anchor)
      : null;
    if (targetGridLayout) {
      targetGridLayout = expandGridTrackLayoutForAuthoredChildren(
        targetGridLayout,
        target.anchor,
      );
    }
    var targetColumnCount = targetGridLayout?.columnBounds.length ?? 100;
    var sourceGridPositions = members.map(function (member) {
      var sourceLayout = gridTrackLayoutForElement(member.parentElement);
      if (sourceLayout)
        sourceLayout = expandGridTrackLayoutForAuthoredChildren(
          sourceLayout,
          member.parentElement!,
        );
      return {
        column: gridItemAxisPlacement(member, sourceLayout, "column"),
        row: gridItemAxisPlacement(member, sourceLayout, "row"),
      };
    });
    var groupGridCellFor = function (index: number) {
      if (!target.gridCell) return undefined;
      var span = {
        column: sourceGridPositions[index].column.span,
        row: sourceGridPositions[index].row.span,
      };
      var startColumn = target.gridCell.column;
      var startRow = target.gridCell.row;
      if (index === 0) {
        if (startColumn + span.column > targetColumnCount) {
          startColumn = 0;
          startRow += 1;
        }
        return { column: startColumn, row: startRow, span };
      }
      var firstColumn = sourceGridPositions[0].column.authoredStart;
      var firstRow = sourceGridPositions[0].row.authoredStart;
      var memberColumn = sourceGridPositions[index].column.authoredStart;
      var memberRow = sourceGridPositions[index].row.authoredStart;
      if (
        firstColumn !== null &&
        firstRow !== null &&
        memberColumn !== null &&
        memberRow !== null
      ) {
        var preferredColumn = startColumn + memberColumn - firstColumn;
        var preferredRow = startRow + memberRow - firstRow;
        if (
          preferredColumn >= 0 &&
          preferredColumn + span.column <= targetColumnCount &&
          preferredRow >= 0 &&
          !plannedGridPlacements.some(function (existing) {
            return (
              preferredColumn < existing.columnEnd &&
              preferredColumn + span.column > existing.column && // i18n-ignore non-user-facing grid overlap condition
              preferredRow < existing.rowEnd &&
              preferredRow + span.row > existing.row
            );
          })
        ) {
          return { column: preferredColumn, row: preferredRow, span };
        }
      }
      for (
        var row = startRow;
        row < startRow + members.length + 100;
        row += 1
      ) {
        for (
          var column = row === startRow ? startColumn : 0;
          column + span.column <= targetColumnCount;
          column += 1
        ) {
          var candidate = {
            column: column,
            columnEnd: column + span.column,
            row: row,
            rowEnd: row + span.row,
          };
          var overlaps = plannedGridPlacements.some(function (existing) {
            return (
              candidate.column < existing.columnEnd &&
              candidate.columnEnd > existing.column &&
              candidate.row < existing.rowEnd &&
              candidate.rowEnd > existing.row
            );
          });
          if (!overlaps) return { column: column, row: row, span };
        }
      }
      return { column: startColumn, row: startRow, span };
    };
    for (var i = 0; i < members.length; i += 1) {
      var member = members[i];
      var plannedGridCell = groupGridCellFor(i);
      var memberTarget =
        i === 0
          ? target.gridCell && plannedGridCell
            ? {
                ...target,
                gridCell: {
                  column: plannedGridCell.column,
                  row: plannedGridCell.row,
                },
              }
            : target
          : target.gridCell
            ? {
                ...target,
                gridCell: plannedGridCell
                  ? {
                      column: plannedGridCell.column,
                      row: plannedGridCell.row,
                    }
                  : target.gridCell,
                gridPlacement: undefined,
                gridDisplacementPlacements: [],
                gridDisplacementPrevStyles: [],
                persistenceAnchor: previous,
                persistencePlacement: previous ? "after" : "inside",
              }
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
      var prevInlinePositionStyles = originInlineStylesFor
        ? originInlineStylesFor(member)
        : snapshotInlinePositionStyles(member);
      var prevInlineGridStyles = snapshotInlineGridStyles(member);
      adaptAutoTextColorForNest(member, container);
      if (
        applyRuntimeReorder(member, memberTarget, preview, members) &&
        !preview
      ) {
        postVisualStructureChange(
          member,
          memberTarget,
          {
            prevParent: prevParent,
            prevNextSibling: prevNextSibling,
            prevInlinePositionStyles: prevInlinePositionStyles,
            prevInlineGridStyles: prevInlineGridStyles,
            ...(Array.isArray(memberTarget.gridDisplacementPrevStyles) &&
            memberTarget.gridDisplacementPrevStyles.length > 0
              ? { gridDisplacements: memberTarget.gridDisplacementPrevStyles }
              : {}),
          },
          undefined,
          undefined,
          undefined,
          gridGroupMessages ?? undefined,
          transactionId,
        );
      }
      if (plannedGridCell) {
        plannedGridPlacements.push({
          column: plannedGridCell.column,
          columnEnd: plannedGridCell.column + plannedGridCell.span.column,
          row: plannedGridCell.row,
          rowEnd: plannedGridCell.row + plannedGridCell.span.row,
        });
      }
      previous = member;
    }
    if (gridGroupMessages) {
      if (gridGroupMessages.length === 1) {
        (window.parent as Window).postMessage(gridGroupMessages[0], "*");
      } else if (gridGroupMessages.length > 1) {
        (window.parent as Window).postMessage(
          { type: "visual-grid-group-change", moves: gridGroupMessages },
          "*",
        );
      }
    }
    if (!preview) postElementMarqueeSelect(members, false, ev);
  }

  var SNAP_THRESHOLD_PX = 6;

  var layoutGridStep = 1;

  function quantizeToLayoutGrid(value: number): number {
    if (!(layoutGridStep > 1)) return Math.round(value);
    return Math.round(value / layoutGridStep) * layoutGridStep;
  }
  var SNAP_CANDIDATE_CAP = 200;

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

  var SNAP_ALIGN_EPSILON = 1e-6;
  var SPACING_MATCH_EPSILON = 0.5;
  var PROXIMITY_RANGE_PX = 160;

  function axisSnapValues(bounds, axis) {
    return axis === "x"
      ? [bounds.left, bounds.centerX, bounds.right]
      : [bounds.top, bounds.centerY, bounds.bottom];
  }

  function axisStart(bounds, axis) {
    return axis === "x" ? bounds.left : bounds.top;
  }

  function axisEnd(bounds, axis) {
    return axis === "x" ? bounds.right : bounds.bottom;
  }

  function crossStart(bounds, axis) {
    return axis === "x" ? bounds.top : bounds.left;
  }

  function crossEnd(bounds, axis) {
    return axis === "x" ? bounds.bottom : bounds.right;
  }

  function crossAxisOverlaps(axis, a, b) {
    return (
      crossStart(a, axis) < crossEnd(b, axis) &&
      crossEnd(a, axis) > crossStart(b, axis)
    );
  }

  function translateRectBounds(bounds, dx, dy) {
    return {
      left: bounds.left + dx,
      right: bounds.right + dx,
      centerX: bounds.centerX + dx,
      top: bounds.top + dy,
      bottom: bounds.bottom + dy,
      centerY: bounds.centerY + dy,
    };
  }

  function findAxisSnapOffset(axis, moving, candidates, threshold) {
    var offset = null;
    var bestDistance = Infinity;
    var movingValues = axisSnapValues(moving, axis);
    for (var i = 0; i < candidates.length; i += 1) {
      var targets = axisSnapValues(candidates[i], axis);
      for (var mi = 0; mi < movingValues.length; mi += 1) {
        for (var ti = 0; ti < targets.length; ti += 1) {
          var candidate = targets[ti] - movingValues[mi];
          var distance = Math.abs(candidate);
          if (distance > threshold || distance >= bestDistance) continue;
          bestDistance = distance;
          offset = candidate;
        }
      }
    }
    return offset;
  }

  function buildAxisGuides(axis, moving, candidates) {
    var positions: number[] = [];
    var spans: { start: number; end: number }[] = [];
    var movingValues = axisSnapValues(moving, axis);
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      var targets = axisSnapValues(candidate, axis);
      for (var mi = 0; mi < movingValues.length; mi += 1) {
        for (var ti = 0; ti < targets.length; ti += 1) {
          if (Math.abs(targets[ti] - movingValues[mi]) > SNAP_ALIGN_EPSILON) {
            continue;
          }
          var slot = positions.indexOf(targets[ti]);
          if (slot === -1) {
            positions.push(targets[ti]);
            spans.push({
              start: Math.min(
                crossStart(moving, axis),
                crossStart(candidate, axis),
              ),
              end: Math.max(crossEnd(moving, axis), crossEnd(candidate, axis)),
            });
          } else {
            spans[slot].start = Math.min(
              spans[slot].start,
              crossStart(candidate, axis),
            );
            spans[slot].end = Math.max(
              spans[slot].end,
              crossEnd(candidate, axis),
            );
          }
        }
      }
    }
    var guides: {
      orientation: string;
      position: number;
      start: number;
      end: number;
    }[] = [];
    for (var g = 0; g < positions.length; g += 1) {
      guides.push({
        orientation: axis === "x" ? "vertical" : "horizontal",
        position: positions[g],
        start: spans[g].start,
        end: spans[g].end,
      });
    }
    return guides;
  }

  function collectAxisGapCandidates(axis, moving, candidates) {
    var gaps: {
      side: string;
      gap: number;
      gapStart: number;
      gapEnd: number;
      crossStart: number;
      crossEnd: number;
    }[] = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var bounds = candidates[i];
      if (!crossAxisOverlaps(axis, bounds, moving)) continue;
      var band = {
        crossStart: Math.max(
          crossStart(bounds, axis),
          crossStart(moving, axis),
        ),
        crossEnd: Math.min(crossEnd(bounds, axis), crossEnd(moving, axis)),
      };
      if (axisEnd(bounds, axis) <= axisStart(moving, axis)) {
        gaps.push({
          side: "before",
          gap: axisStart(moving, axis) - axisEnd(bounds, axis),
          gapStart: axisEnd(bounds, axis),
          gapEnd: axisStart(moving, axis),
          crossStart: band.crossStart,
          crossEnd: band.crossEnd,
        });
      } else if (axisStart(bounds, axis) >= axisEnd(moving, axis)) {
        gaps.push({
          side: "after",
          gap: axisStart(bounds, axis) - axisEnd(moving, axis),
          gapStart: axisEnd(moving, axis),
          gapEnd: axisStart(bounds, axis),
          crossStart: band.crossStart,
          crossEnd: band.crossEnd,
        });
      }
    }
    return gaps;
  }

  function closestGapCandidate(gaps, side) {
    var best = null;
    for (var i = 0; i < gaps.length; i += 1) {
      if (gaps[i].side !== side) continue;
      if (!best || gaps[i].gap < best.gap) best = gaps[i];
    }
    return best;
  }

  function collectRhythmGaps(axis, moving, candidates) {
    var row: any[] = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var entry = candidates[i];
      if (!crossAxisOverlaps(axis, entry, moving)) continue;
      if (
        axisStart(entry, axis) <= axisStart(moving, axis) &&
        axisEnd(entry, axis) >= axisEnd(moving, axis)
      ) {
        continue;
      }
      row.push(entry);
    }
    row.sort(function (a, b) {
      return axisStart(a, axis) - axisStart(b, axis);
    });
    var gaps: { gap: number; band: any }[] = [];
    var previous: any = null;
    for (var r = 0; r < row.length; r += 1) {
      var bounds = row[r];
      var gap = previous
        ? axisStart(bounds, axis) - axisEnd(previous, axis)
        : 0;
      if (previous && gap > 0 && crossAxisOverlaps(axis, previous, bounds)) {
        gaps.push({
          gap: gap,
          band: {
            gapStart: axisEnd(previous, axis),
            gapEnd: axisStart(bounds, axis),
            crossStart: Math.max(
              crossStart(previous, axis),
              crossStart(bounds, axis),
            ),
            crossEnd: Math.min(
              crossEnd(previous, axis),
              crossEnd(bounds, axis),
            ),
          },
        });
      }
      if (!previous || axisEnd(bounds, axis) > axisEnd(previous, axis)) {
        previous = bounds;
      }
    }
    return gaps;
  }

  function findSpacingSnapOffset(axis, moving, candidates, tolerance) {
    var gaps = collectAxisGapCandidates(axis, moving, candidates);
    var before = closestGapCandidate(gaps, "before");
    var after = closestGapCandidate(gaps, "after");
    if (!before && !after) return { offset: 0, side: null };

    var offset = 0;
    var side = null;
    var bestDistance = Infinity;
    function consider(value, matched) {
      var distance = Math.abs(value);
      if (distance > tolerance || distance >= bestDistance) return;
      bestDistance = distance;
      offset = value;
      side = matched;
    }
    if (before && after) consider((after.gap - before.gap) / 2, "both");
    var rhythms = collectRhythmGaps(axis, moving, candidates);
    for (var i = 0; i < rhythms.length; i += 1) {
      if (before) consider(rhythms[i].gap - before.gap, "before");
      if (after) consider(after.gap - rhythms[i].gap, "after");
    }
    return { offset: offset, side: side };
  }

  function gapCandidateBand(candidate) {
    return {
      gapStart: candidate.gapStart,
      gapEnd: candidate.gapEnd,
      crossStart: candidate.crossStart,
      crossEnd: candidate.crossEnd,
    };
  }

  function matchingRhythmBands(rhythms, gap, tolerance) {
    var bands: any[] = [];
    for (var i = 0; i < rhythms.length; i += 1) {
      if (Math.abs(rhythms[i].gap - gap) <= tolerance)
        bands.push(rhythms[i].band);
    }
    return bands;
  }

  function buildSpacingGuides(
    axis,
    moving,
    candidates,
    tolerance,
    gaps,
    matchedSide,
  ) {
    gaps = gaps || collectAxisGapCandidates(axis, moving, candidates);
    var before = closestGapCandidate(gaps, "before");
    var after = closestGapCandidate(gaps, "after");
    var orientation = axis === "x" ? "vertical" : "horizontal";
    var rhythms = collectRhythmGaps(axis, moving, candidates);
    if (before && after && Math.abs(before.gap - after.gap) <= tolerance) {
      var pairGap = (before.gap + after.gap) / 2;
      return [
        {
          orientation: orientation,
          gap: pairGap,
          bands: [gapCandidateBand(before), gapCandidateBand(after)].concat(
            matchingRhythmBands(rhythms, pairGap, tolerance),
          ),
        },
      ];
    }
    var neighbor =
      matchedSide === "after"
        ? after
        : matchedSide === "before"
          ? before
          : before || after;
    if (!neighbor) return [];
    var matched = matchingRhythmBands(rhythms, neighbor.gap, tolerance);
    if (!matched.length) return [];
    return [
      {
        orientation: orientation,
        gap: neighbor.gap,
        bands: [gapCandidateBand(neighbor)].concat(matched),
      },
    ];
  }

  function computeProximityMeasurements(moving, candidates, range, gapsByAxis) {
    var measurements: any[] = [];
    var axes = ["x", "y"];
    for (var a = 0; a < axes.length; a += 1) {
      var axis = axes[a];
      var gaps =
        (gapsByAxis && gapsByAxis[axis]) ||
        collectAxisGapCandidates(axis, moving, candidates);
      var nearest = null;
      for (var i = 0; i < gaps.length; i += 1) {
        if (!nearest || gaps[i].gap < nearest.gap) nearest = gaps[i];
      }
      if (!nearest || nearest.gap > range) continue;
      measurements.push({
        orientation: axis === "x" ? "vertical" : "horizontal",
        gap: nearest.gap,
        band: gapCandidateBand(nearest),
      });
    }
    return measurements;
  }

  function computeMoveSnapOffset(
    movingRect,
    candidates,
    threshold,
    isGroup,
    locked,
  ) {
    var moving = rectBounds(movingRect);
    locked = locked || {};
    var dx = locked.x
      ? null
      : findAxisSnapOffset("x", moving, candidates, threshold);
    var dy = locked.y
      ? null
      : findAxisSnapOffset("y", moving, candidates, threshold);
    var snapped = translateRectBounds(moving, dx || 0, dy || 0);
    var guides = (
      locked.x ? [] : buildAxisGuides("x", snapped, candidates)
    ).concat(locked.y ? [] : buildAxisGuides("y", snapped, candidates));

    if (isGroup) {
      return {
        dx: dx || 0,
        dy: dy || 0,
        guides: guides,
        spacingGuides: [],
        measurements: [],
      };
    }

    var idle = { offset: 0, side: null };
    var spacingXResult = guides.some(function (guide) {
      return guide.orientation === "vertical";
    })
      ? idle
      : locked.x
        ? idle
        : findSpacingSnapOffset("x", snapped, candidates, threshold);
    var spacingYResult = guides.some(function (guide) {
      return guide.orientation === "horizontal";
    })
      ? idle
      : locked.y
        ? idle
        : findSpacingSnapOffset("y", snapped, candidates, threshold);
    var spacingX = spacingXResult.offset;
    var spacingY = spacingYResult.offset;
    var spaced = translateRectBounds(snapped, spacingX, spacingY);
    var settledGaps = {
      x: collectAxisGapCandidates("x", spaced, candidates),
      y: collectAxisGapCandidates("y", spaced, candidates),
    };
    var spacingGuides = buildSpacingGuides(
      "x",
      spaced,
      candidates,
      SPACING_MATCH_EPSILON,
      settledGaps.x,
      spacingXResult.side,
    ).concat(
      buildSpacingGuides(
        "y",
        spaced,
        candidates,
        SPACING_MATCH_EPSILON,
        settledGaps.y,
        spacingYResult.side,
      ),
    );

    var measurements = computeProximityMeasurements(
      spaced,
      candidates,
      (PROXIMITY_RANGE_PX * threshold) / SNAP_THRESHOLD_PX,
      settledGaps,
    ).filter(function (measurement) {
      return !spacingGuides.some(function (guide) {
        return guide.orientation === measurement.orientation;
      });
    });

    return {
      dx: (dx || 0) + spacingX,
      dy: (dy || 0) + spacingY,
      guides: guides,
      spacingGuides: spacingGuides,
      measurements: measurements,
    };
  }

  var snapGuideNodeCount = 0;

  function beginSnapGuideNodes() {
    snapGuideNodeCount = 0;
  }

  function appendSnapGuideNode(cssText) {
    var node = snapGuideLayer.children[snapGuideNodeCount] as
      | HTMLElement
      | undefined;
    if (!node) {
      node = document.createElement("div");
      snapGuideLayer.appendChild(node);
    }
    node.style.cssText = "position:fixed;" + cssText;
    node.textContent = "";
    snapGuideNodeCount += 1;
    return node;
  }

  function endSnapGuideNodes() {
    while (snapGuideLayer.children.length > snapGuideNodeCount) {
      snapGuideLayer.removeChild(snapGuideLayer.lastChild!);
    }
  }

  function showSnapGuides(guides, spacingGuides, measurements) {
    measurements = measurements || [];
    if (!guides.length && !spacingGuides.length && !measurements.length) {
      hideSnapGuides();
      return;
    }
    beginSnapGuideNodes();
    if (snapGuideLayer.style.display !== "block") {
      snapGuideLayer.style.display = "block";
    }
    var scale = chromeLineScale();
    var line = 1 * scale;
    var fill = "background:var(--design-editor-measure-color);";

    for (var i = 0; i < guides.length; i += 1) {
      var guide = guides[i];
      var span = Math.max(1, guide.end - guide.start);
      appendSnapGuideNode(
        guide.orientation === "vertical"
          ? "left:" +
              guide.position +
              "px;top:" +
              guide.start +
              "px;width:" +
              line +
              "px;height:" +
              span +
              "px;" +
              fill
          : "top:" +
              guide.position +
              "px;left:" +
              guide.start +
              "px;height:" +
              line +
              "px;width:" +
              span +
              "px;" +
              fill,
      );
    }

    for (var s = 0; s < spacingGuides.length; s += 1) {
      var spacing = spacingGuides[s];
      for (var b = 0; b < spacing.bands.length; b += 1) {
        appendSnapGuideNode(
          spacingBandCss(spacing.orientation, spacing.bands[b], line, fill),
        );
        appendSnapGuideNode(
          spacingSerifCss(
            spacing.orientation,
            spacing.bands[b],
            line,
            5 * scale,
            fill,
            true,
          ),
        );
        appendSnapGuideNode(
          spacingSerifCss(
            spacing.orientation,
            spacing.bands[b],
            line,
            5 * scale,
            fill,
            false,
          ),
        );
      }
      var label = appendSnapGuideNode(
        spacingLabelCss(spacing.orientation, spacing.bands[0], scale),
      );
      label.textContent = String(Math.round(spacing.gap));
    }

    for (var m = 0; m < measurements.length; m += 1) {
      var measurement = measurements[m];
      appendSnapGuideNode(
        spacingBandCss(measurement.orientation, measurement.band, line, fill),
      );
      appendSnapGuideNode(
        spacingSerifCss(
          measurement.orientation,
          measurement.band,
          line,
          5 * scale,
          fill,
          true,
        ),
      );
      appendSnapGuideNode(
        spacingSerifCss(
          measurement.orientation,
          measurement.band,
          line,
          5 * scale,
          fill,
          false,
        ),
      );
      var measureLabel = appendSnapGuideNode(
        spacingLabelCss(measurement.orientation, measurement.band, scale),
      );
      measureLabel.textContent = String(Math.round(measurement.gap));
    }
    endSnapGuideNodes();
  }

  function spacingBandCss(orientation, band, line, fill) {
    var crossMid = (band.crossStart + band.crossEnd) / 2;
    var length = Math.max(0, band.gapEnd - band.gapStart);
    return orientation === "vertical"
      ? "left:" +
          band.gapStart +
          "px;top:" +
          (crossMid - line / 2) +
          "px;width:" +
          length +
          "px;height:" +
          line +
          "px;" +
          fill
      : "top:" +
          band.gapStart +
          "px;left:" +
          (crossMid - line / 2) +
          "px;height:" +
          length +
          "px;width:" +
          line +
          "px;" +
          fill;
  }

  function spacingSerifCss(orientation, band, line, serif, fill, atStart) {
    var crossMid = (band.crossStart + band.crossEnd) / 2;
    var along = atStart ? band.gapStart : band.gapEnd;
    return orientation === "vertical"
      ? "left:" +
          (along - line / 2) +
          "px;top:" +
          (crossMid - serif) +
          "px;width:" +
          line +
          "px;height:" +
          serif * 2 +
          "px;" +
          fill
      : "top:" +
          (along - line / 2) +
          "px;left:" +
          (crossMid - serif) +
          "px;height:" +
          line +
          "px;width:" +
          serif * 2 +
          "px;" +
          fill;
  }

  function spacingLabelCss(orientation, band, scale) {
    var crossMid = (band.crossStart + band.crossEnd) / 2;
    var alongMid = (band.gapStart + band.gapEnd) / 2;
    return (
      (orientation === "vertical"
        ? "left:" + alongMid + "px;top:" + crossMid + "px;"
        : "left:" + crossMid + "px;top:" + alongMid + "px;") +
      "transform:translate(-50%,-50%);border-radius:" +
      3 * scale +
      "px;padding:" +
      1 * scale +
      "px " +
      4 * scale +
      "px;font:" +
      10 * scale +
      "px/1 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;" +
      "background:var(--design-editor-measure-color);color:white;"
    );
  }

  function authoredOffset(value) {
    if (!value || value === "auto") return "";
    return value;
  }

  function elementConstraints(el) {
    var style = (el as HTMLElement).style;
    var left = authoredOffset(style.left);
    var right = authoredOffset(style.right);
    var top = authoredOffset(style.top);
    var bottom = authoredOffset(style.bottom);
    var transform = style.transform || "";
    return {
      horizontal:
        style.width === "100%"
          ? "scale"
          : left && right
            ? "left-right"
            : right && !left
              ? "right"
              : transform.indexOf("translateX(-50%)") !== -1
                ? "center"
                : "left",
      vertical:
        style.height === "100%"
          ? "scale"
          : top && bottom
            ? "top-bottom"
            : bottom && !top
              ? "bottom"
              : transform.indexOf("translateY(-50%)") !== -1
                ? "center"
                : "top",
    };
  }

  var constraintNodeCount = 0;

  function appendConstraintLine(
    from,
    to,
    crossPosition,
    horizontal,
    thickness,
  ) {
    var start = Math.min(from, to);
    var length = Math.max(1, Math.abs(to - from));
    var node = constraintGuideLayer.children[constraintNodeCount] as
      | HTMLElement
      | undefined;
    if (!node) {
      node = document.createElement("div");
      constraintGuideLayer.appendChild(node);
    }
    constraintNodeCount += 1;
    node.style.cssText =
      "position:fixed;" +
      (horizontal
        ? "left:" +
          start +
          "px;top:" +
          (crossPosition - thickness / 2) +
          "px;width:" +
          length +
          "px;height:0;border-top:"
        : "top:" +
          start +
          "px;left:" +
          (crossPosition - thickness / 2) +
          "px;height:" +
          length +
          "px;width:0;border-left:") +
      thickness +
      "px dashed var(--design-editor-accent-color);";
  }

  function showConstraintGuides(el) {
    if (!el || dragChromeSuppressed) return hideConstraintGuides();
    var parent =
      (el as HTMLElement).offsetParent || (el as HTMLElement).parentElement;
    if (!parent) return hideConstraintGuides();
    var rect = el.getBoundingClientRect();
    var frame = parent.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return hideConstraintGuides();
    if (!constraintGuideLayer.isConnected) {
      appendEditorChromeNode(constraintGuideLayer);
    }
    constraintNodeCount = 0;
    if (constraintGuideLayer.style.display !== "block") {
      constraintGuideLayer.style.display = "block";
    }

    var thickness = chromeLineScale();
    var midY = rect.top + rect.height / 2;
    var midX = rect.left + rect.width / 2;
    var constraints = elementConstraints(el);

    if (constraints.horizontal === "scale") {
      appendConstraintLine(frame.left, frame.right, midY, true, thickness);
    } else {
      if (
        constraints.horizontal !== "right" &&
        constraints.horizontal !== "center"
      ) {
        appendConstraintLine(frame.left, rect.left, midY, true, thickness);
      }
      if (
        constraints.horizontal === "right" ||
        constraints.horizontal === "left-right"
      ) {
        appendConstraintLine(rect.right, frame.right, midY, true, thickness);
      }
      if (constraints.horizontal === "center") {
        appendConstraintLine(
          frame.left + frame.width / 2,
          midX,
          midY,
          true,
          thickness,
        );
      }
    }

    if (constraints.vertical === "scale") {
      appendConstraintLine(frame.top, frame.bottom, midX, false, thickness);
    } else {
      if (
        constraints.vertical !== "bottom" &&
        constraints.vertical !== "center"
      ) {
        appendConstraintLine(frame.top, rect.top, midX, false, thickness);
      }
      if (
        constraints.vertical === "bottom" ||
        constraints.vertical === "top-bottom"
      ) {
        appendConstraintLine(rect.bottom, frame.bottom, midX, false, thickness);
      }
      if (constraints.vertical === "center") {
        appendConstraintLine(
          frame.top + frame.height / 2,
          midY,
          midX,
          false,
          thickness,
        );
      }
    }
    trimConstraintNodes();
  }

  function trimConstraintNodes() {
    while (constraintGuideLayer.children.length > constraintNodeCount) {
      constraintGuideLayer.removeChild(constraintGuideLayer.lastChild!);
    }
  }

  function hideConstraintGuides() {
    if (constraintGuideLayer.style.display === "none") return;
    constraintGuideLayer.style.display = "none";
    constraintGuideLayer.innerHTML = "";
    constraintNodeCount = 0;
  }

  var sizeBadgeKey = "";
  var dragChromeSuppressed = false;

  function showSizeBadge(el) {
    if (!el || dragChromeSuppressed) return hideSizeBadge();
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return hideSizeBadge();
    var scale = chromeLineScale();
    var key =
      rect.left +
      "|" +
      rect.bottom +
      "|" +
      rect.width +
      "|" +
      rect.height +
      "|" +
      scale;
    if (key === sizeBadgeKey && sizeBadge.style.display === "block") return;
    sizeBadgeKey = key;
    if (!sizeBadge.isConnected) appendEditorChromeNode(sizeBadge);
    sizeBadge.textContent =
      Math.round(rect.width) + " × " + Math.round(rect.height);
    sizeBadge.style.display = "block";
    sizeBadge.style.borderRadius = 3 * scale + "px";
    sizeBadge.style.padding = 2 * scale + "px " + 4 * scale + "px";
    sizeBadge.style.fontSize = 10 * scale + "px";
    sizeBadge.style.left = rect.left + rect.width / 2 + "px";
    sizeBadge.style.top = rect.bottom + 6 * scale + "px";
    sizeBadge.style.transform = "translateX(-50%)";
  }

  function hideSizeBadge() {
    if (sizeBadge.style.display === "none") return;
    sizeBadge.style.display = "none";
    sizeBadgeKey = "";
  }

  function hideSnapGuides() {
    dragChromeSuppressed = false;
    if (snapGuideLayer.style.display === "none") return;
    snapGuideLayer.style.display = "none";
    snapGuideLayer.innerHTML = "";
    snapGuideNodeCount = 0;
  }

  function startMove(
    e,
    gestureElParam?: Element,
    pointerStartParam?: {
      clientX: number;
      clientY: number;
      ignoreAutoLayout?: boolean;
    },
  ) {
    if (readOnly) return;
    var gestureEl = gestureElParam || selectedEl;
    if (!gestureEl) return;
    if (isLayerInteractionBlocked(gestureEl)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    clearGridProjectionCaches();
    var moveGestureId = ++dragGestureSequence;
    var gestureStartedAt = eventEpochMilliseconds(e) ?? Date.now();
    var events = dragEventNames(e);
    var originalSelectedEl = selectedEl;
    var duplicatedForDrag = false;
    var duplicateStyleSnapshot;
    var duplicatedSourceNodeIdMap: Array<[string, string]> | undefined;
    var duplicateGrabOffset: { x: number; y: number } | null = null;
    if (
      e.altKey &&
      selectedEl &&
      selectedEl !== document.body &&
      selectedEl !== document.documentElement
    ) {
      duplicateStyleSnapshot = collectPortableStyleSnapshot(selectedEl);
      var grabbedRect = selectedEl.getBoundingClientRect();
      var clone = selectedEl.cloneNode(true);
      duplicatedSourceNodeIdMap = resetRuntimeStableIds(clone);
      clone.setAttribute("data-agent-native-clone-root", "true");
      selectedEl.parentElement.insertBefore(clone, selectedEl.nextSibling);
      resetFlowDuplicateGridPlacement(clone as HTMLElement);
      publishSourceDocumentProvenance(undefined, true);
      selectedEl = clone;
      duplicatedForDrag = true;
      gestureEl = clone;
      var insertedRect = (clone as Element).getBoundingClientRect();
      duplicateGrabOffset = {
        x: grabbedRect.left - insertedRect.left,
        y: grabbedRect.top - insertedRect.top,
      };
      positionOverlay(selectionOverlay, selectedEl);
      postElementSelect(selectedEl);
    }
    function dragGrabRect(el: Element): DOMRect {
      var rect = el.getBoundingClientRect();
      if (!duplicateGrabOffset || el !== gestureEl) return rect;
      return new DOMRect(
        rect.left + duplicateGrabOffset.x,
        rect.top + duplicateGrabOffset.y,
        rect.width,
        rect.height,
      );
    }
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
      postCrossScreenDrag("cancel");
    }
    if (
      !isGroupDrag &&
      !duplicatedForDrag &&
      isFlowReorderCandidate(gestureEl) &&
      isTemplateCloneElement(gestureEl)
    ) {
      postCrossScreenDrag("cancel");
      var rejectedEl = gestureEl;
      function onRejectedMove(ev) {
        showRejectedDragBadge(
          "Can't reorder repeated items",
          ev.clientX,
          ev.clientY,
        );
      }
      function cleanupRejectedDrag() {
        document.removeEventListener(events.move, onRejectedMove, true);
        document.removeEventListener(events.up, onRejectedUp, true);
        document.removeEventListener("keydown", onRejectedKeyDown, true);
        clearActiveDragCancel(onRejectedEscape);
        shieldOverlay.style.cursor = "default";
      }
      function onRejectedEscape() {
        resetBridgeDragModifierStateOnCancel();
        cleanupRejectedDrag();
        hideTransformBadge();
        suppressNextShieldClickBriefly();
        return true;
      }
      function onRejectedKeyDown(ev) {
        if (ev.key === "Escape") {
          stopNativeInteraction(ev);
          onRejectedEscape();
        }
      }
      function onRejectedUp() {
        cleanupRejectedDrag();
        hideTransformBadge();
        selectTargetAfterRejectedDrag();
      }
      function selectTargetAfterRejectedDrag(): void {
        selectedEl = rejectedEl;
        positionOverlay(selectionOverlay, selectedEl);
      }
      shieldOverlay.style.cursor = "not-allowed";
      showRejectedDragBadge(
        "Can't reorder repeated items",
        e.clientX,
        e.clientY,
      );
      document.addEventListener(events.move, onRejectedMove, true);
      document.addEventListener(events.up, onRejectedUp, true);
      document.addEventListener("keydown", onRejectedKeyDown, true);
      setActiveDragCancel(onRejectedEscape);
      return;
    }
    if (isFlowReorderCandidate(gestureEl)) {
      var reorderEl = gestureEl;
      var reorderGroupStartRects = groupEls.map(function (member) {
        return dragGrabRect(member);
      });
      var reorderOrigins = groupEls.map(function (member) {
        return {
          el: member,
          prevParent: member.parentElement,
          prevNextSibling: member.nextSibling,
          prevInlinePositionStyles: snapshotInlinePositionStyles(member),
        };
      });
      var reorderGestureStartRect = dragGrabRect(reorderEl);
      var reorderLastTargetKey = null;
      var keepCurrentFlowParent = bridgeSpaceKeyPressed;
      var reorderIgnoresAutoLayout = isIgnoreAutoLayoutChord(e);
      var reorderMetaFreePlacement = false;
      function reorderCrossScreenModifiers(ev?: any) {
        return {
          metaKey: !!ev?.metaKey,
          ctrlKey: !!ev?.ctrlKey,
          ignoreAutoLayout: ev
            ? isIgnoreAutoLayoutChord(ev)
            : reorderIgnoresAutoLayout,
          forceNestedAutoLayout: ev ? isPlatformPrimaryChord(ev) : false,
        };
      }
      var currentTarget = flowMoveTargetForPoint(
        reorderEl,
        e.clientX,
        e.clientY,
        groupOthers,
        keepCurrentFlowParent,
        reorderIgnoresAutoLayout,
        isPlatformPrimaryChord(e),
      );
      postLayerStructurePreview(reorderEl, currentTarget);
      showInsertionGuideFor(currentTarget);
      dndLog("start:reorder", {
        el: getSelector(reorderEl),
        isGroup: isGroupDrag,
        ctrl: reorderIgnoresAutoLayout,
        target: dndTarget(currentTarget),
      });
      crossScreenClaimedByHost = false;
      var reorderStyleSnapshot = collectPortableStyleSnapshot(reorderEl);
      var reorderRect = dragGrabRect(reorderEl);
      var reorderPointerStart = pointerStartParam || e;
      var reorderPointerOffset = {
        x: reorderPointerStart.clientX - reorderRect.left,
        y: reorderPointerStart.clientY - reorderRect.top,
      };
      if (!isGroupDrag && !reorderIgnoresAutoLayout) {
        postCrossScreenDrag("start", reorderEl, reorderPointerStart, {
          duplicate: duplicatedForDrag,
          elementRect: {
            left: reorderRect.left,
            top: reorderRect.top,
            width: reorderRect.width,
            height: reorderRect.height,
          },
          pointerOffset: reorderPointerOffset,
          styleSnapshot: reorderStyleSnapshot,
          modifiers: reorderCrossScreenModifiers(e),
        });
      }
      function authoredTransformOf(el: HTMLElement): string {
        if (el.style.transform) return el.style.transform;
        var computed = window.getComputedStyle(el).transform;
        return computed && computed !== "none" ? computed : "";
      }
      var reorderLiftedMembers: {
        el: HTMLElement;
        prevTransform: string;
        authoredTransform: string;
        prevTransition: string;
        prevZIndex: string;
        prevBoxShadow: string;
        prevWillChange: string;
        prevPointerEvents: string;
      }[] = [];
      function applyReorderLift(dx: number, dy: number): void {
        if (!liveReflowEnabled) return;
        groupEls.forEach(function (member) {
          var el = member as HTMLElement;
          var snap = reorderLiftedMembers.filter(function (s) {
            return s.el === el;
          })[0];
          if (!snap) {
            snap = {
              el: el,
              prevTransform: el.style.transform,
              authoredTransform: authoredTransformOf(el),
              prevTransition: el.style.transition,
              prevZIndex: el.style.zIndex,
              prevBoxShadow: el.style.boxShadow,
              prevWillChange: el.style.willChange,
              prevPointerEvents: el.style.pointerEvents,
            };
            reorderLiftedMembers.push(snap);
            el.style.transition = "none";
            el.style.willChange = "transform";
            el.style.zIndex = "2147483646";
            el.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.18)";
            el.style.pointerEvents = "none";
          }
          var liftDx = dx + (duplicateGrabOffset ? duplicateGrabOffset.x : 0);
          var liftDy = dy + (duplicateGrabOffset ? duplicateGrabOffset.y : 0);
          el.style.transform =
            "translate(" +
            liftDx +
            "px, " +
            liftDy +
            "px)" +
            (snap.authoredTransform ? " " + snap.authoredTransform : "");
        });
      }
      function clearReorderLift(): void {
        reorderLiftedMembers.forEach(function (snap) {
          var el = snap.el;
          el.style.transform = snap.prevTransform;
          el.style.transition = snap.prevTransition;
          el.style.zIndex = snap.prevZIndex;
          el.style.boxShadow = snap.prevBoxShadow;
          el.style.willChange = snap.prevWillChange;
          el.style.pointerEvents = snap.prevPointerEvents;
        });
        reorderLiftedMembers = [];
      }
      if (
        duplicateGrabOffset &&
        (duplicateGrabOffset.x !== 0 || duplicateGrabOffset.y !== 0)
      ) {
        applyReorderLift(0, 0);
        positionOverlay(selectionOverlay, selectedEl);
      }
      var reorderCommittedTarget: any = null;
      var reorderCommittedSlot: number | null = null;
      var reorderCommittedAt = 0;
      var reorderCommittedPointer = { x: 0, y: 0 };
      var reorderPendingSlot: number | null = null;
      var reorderPendingAt = 0;
      var reflowSiblings: {
        el: HTMLElement;
        prevTransform: string;
        authoredTransform: string;
        prevTransition: string;
        previewTransform: string;
        previewTransition: string;
      }[] = [];
      var reflowKey: string | null = null;
      var reflowGuideRect: {
        left: number;
        top: number;
        width: number;
        height: number;
      } | null = null;
      var reflowGuideMode: string | null = null;
      var reflowDomOrigin: {
        parent: Element;
        nextSibling: ChildNode | null;
      } | null = null;
      function reorderMainAxis(target): "x" | "y" {
        return target && target.axis === "y" ? "y" : "x";
      }
      function reorderRealChildren(container: Element): Element[] {
        var out: Element[] = [];
        var kids = container.children;
        for (var i = 0; i < kids.length; i += 1) {
          var k = kids[i];
          if (k.nodeType === 1 && !isOverlayElement(k)) out.push(k);
        }
        return out;
      }
      function reorderSlotForTarget(target, real: Element[]) {
        if (target.placement === "inside") return { slot: real.length };
        var ai = real.indexOf(target.anchor);
        if (ai < 0) return null;
        return { slot: target.placement === "before" ? ai : ai + 1 };
      }
      function clearReorderReflow(): void {
        reflowSiblings.forEach(function (s) {
          s.el.style.transform = s.prevTransform;
          s.el.style.transition = s.prevTransition;
        });
        if (reflowDomOrigin) {
          if (reorderEl.parentNode === reflowDomOrigin.parent) {
            if (
              reflowDomOrigin.nextSibling &&
              reflowDomOrigin.nextSibling.parentNode === reflowDomOrigin.parent
            ) {
              reflowDomOrigin.parent.insertBefore(
                reorderEl,
                reflowDomOrigin.nextSibling,
              );
            } else {
              reflowDomOrigin.parent.appendChild(reorderEl);
            }
          }
          reflowDomOrigin = null;
        }
        reflowSiblings = [];
        reflowKey = null;
        reflowGuideRect = null;
        reflowGuideMode = null;
      }
      function clearReorderReflowForHitTest(): void {
        reflowSiblings.forEach(function (s) {
          s.el.style.transform = s.prevTransform;
          s.el.style.transition = s.prevTransition;
        });
        if (reflowDomOrigin) {
          if (reorderEl.parentNode === reflowDomOrigin.parent) {
            if (
              reflowDomOrigin.nextSibling &&
              reflowDomOrigin.nextSibling.parentNode === reflowDomOrigin.parent
            ) {
              reflowDomOrigin.parent.insertBefore(
                reorderEl,
                reflowDomOrigin.nextSibling,
              );
            } else {
              reflowDomOrigin.parent.appendChild(reorderEl);
            }
          }
          reflowDomOrigin = null;
          reflowKey = null;
          reflowGuideRect = null;
          reflowGuideMode = null;
        }
      }
      var restoreGroupGridPreview: (() => void) | null = null;
      function clearGroupGridPreview(): void {
        if (!restoreGroupGridPreview) return;
        restoreGroupGridPreview();
        restoreGroupGridPreview = null;
      }
      function applyGroupGridPreview(target): void {
        if (!isGroupDrag || !target?.gridCell) return;
        var container = dropContainerForTarget(target);
        if (!container) return;
        clearReorderLift();
        var elements = Array.from(
          new Set([...groupEls, ...container.children]),
        );
        var origins = elements.map(function (el) {
          return {
            el: el,
            parent: el.parentElement,
            next: el.nextSibling,
            style: el.getAttribute("style"),
          };
        });
        applyGroupStructureDrop(groupEls, target, null, undefined, true);
        restoreGroupGridPreview = function () {
          origins
            .filter(function (origin) {
              return groupEls.indexOf(origin.el) !== -1;
            })
            .reverse()
            .forEach(function (origin) {
              if (origin.parent)
                origin.parent.insertBefore(
                  origin.el,
                  origin.next?.parentNode === origin.parent
                    ? origin.next
                    : null,
                );
            });
          origins.forEach(function (origin) {
            if (origin.style === null) origin.el.removeAttribute("style");
            else origin.el.setAttribute("style", origin.style);
          });
        };
      }
      function restoreReorderReflowPreview(): void {
        reflowSiblings.forEach(function (s) {
          s.el.style.transition = s.previewTransition;
          s.el.style.transform = s.previewTransform;
        });
      }
      var reorderLastMoveEvent: any = null;
      var reorderMoved = false;
      function activateReorderControlOverride(): void {
        if (reorderIgnoresAutoLayout) return;
        reorderIgnoresAutoLayout = true;
        reorderMetaFreePlacement = false;
        crossScreenClaimedByHost = false;
        postCrossScreenDrag("cancel");
      }
      function releaseReorderMetaOverride(point?: {
        clientX?: number;
        clientY?: number;
      }): void {
        if (!reorderMetaFreePlacement) return;
        reorderMetaFreePlacement = false;
        crossScreenClaimedByHost = false;
        if (isGroupDrag || reorderIgnoresAutoLayout) return;
        var lastPoint = point || reorderLastMoveEvent;
        if (
          !lastPoint ||
          !Number.isFinite(lastPoint.clientX) ||
          !Number.isFinite(lastPoint.clientY)
        ) {
          return;
        }
        postCrossScreenDrag(
          "start",
          reorderEl,
          { clientX: lastPoint.clientX, clientY: lastPoint.clientY },
          {
            duplicate: duplicatedForDrag,
            elementRect: reorderRect,
            pointerOffset: reorderPointerOffset,
            styleSnapshot: reorderStyleSnapshot,
            modifiers: reorderCrossScreenModifiers(lastPoint),
          },
        );
      }
      function resetReorderModifierState(): void {
        reorderMetaFreePlacement = false;
        reorderIgnoresAutoLayout = false;
      }
      function activateLateReorderDuplicate(ev): void {
        if (duplicatedForDrag || isGroupDrag || !reorderEl) return;
        clearReorderLift();
        clearReorderReflow();
        var sourceEl = reorderEl;
        var sourceRect = sourceEl.getBoundingClientRect();
        var clone = sourceEl.cloneNode(true) as HTMLElement;
        duplicatedSourceNodeIdMap = resetRuntimeStableIds(clone);
        clone.setAttribute("data-agent-native-clone-root", "true");
        if (sourceEl.parentElement) {
          sourceEl.parentElement.insertBefore(clone, sourceEl.nextSibling);
        }
        resetFlowDuplicateGridPlacement(clone);
        publishSourceDocumentProvenance(undefined, true);
        duplicatedForDrag = true;
        selectedEl = clone;
        gestureEl = clone;
        reorderEl = clone;
        groupEls = [clone];
        groupOthers = [];
        isGroupDrag = false;
        var insertedRect = clone.getBoundingClientRect();
        duplicateGrabOffset = {
          x: sourceRect.left - insertedRect.left,
          y: sourceRect.top - insertedRect.top,
        };
        reorderOrigins = [
          {
            el: clone,
            prevParent: clone.parentElement,
            prevNextSibling: clone.nextSibling,
            prevInlinePositionStyles: snapshotInlinePositionStyles(clone),
          },
        ];
        reorderGroupStartRects = [dragGrabRect(clone)];
        reorderGestureStartRect = dragGrabRect(clone);
        reorderRect = dragGrabRect(clone);
        reorderPointerOffset = {
          x: reorderPointerStart.clientX - reorderRect.left,
          y: reorderPointerStart.clientY - reorderRect.top,
        };
        reorderStyleSnapshot = collectPortableStyleSnapshot(clone);
        reorderLastTargetKey = null;
        crossScreenClaimedByHost = false;
        postCrossScreenDrag("cancel");
        postCrossScreenDrag(
          "start",
          reorderEl,
          { clientX: ev?.clientX, clientY: ev?.clientY },
          {
            duplicate: true,
            elementRect: {
              left: reorderRect.left,
              top: reorderRect.top,
              width: reorderRect.width,
              height: reorderRect.height,
            },
            pointerOffset: reorderPointerOffset,
            styleSnapshot: reorderStyleSnapshot,
          },
        );
        applyReorderLift(0, 0);
        positionOverlay(selectionOverlay, selectedEl);
        postElementSelect(selectedEl);
      }
      function resolveReorderOrFreeTarget(
        cx,
        cy,
        ignoreTargetAutoLayout,
        forceNestedAutoLayout,
      ) {
        if (bridgeSpaceKeyPressed) keepCurrentFlowParent = true;
        return flowMoveTargetForPoint(
          reorderEl,
          cx,
          cy,
          groupOthers,
          keepCurrentFlowParent,
          ignoreTargetAutoLayout,
          forceNestedAutoLayout,
        );
      }
      function hasMetaFlowTarget(target, cx, cy) {
        var sourceParent = reorderEl.parentElement;
        if (sourceParent && isAutoLayoutElement(sourceParent)) {
          var sourceRect = sourceParent.getBoundingClientRect();
          if (
            cx >= sourceRect.left &&
            cx <= sourceRect.right &&
            cy >= sourceRect.top &&
            cy <= sourceRect.bottom
          ) {
            return true;
          }
        }
        if (!target || target.dropMode !== "flow-insert") {
          return false;
        }
        var container = dropContainerForTarget(target);
        if (
          !container ||
          container === document.body ||
          container === document.documentElement ||
          (!isAutoLayoutElement(container) && !target.needsAutoLayoutConversion)
        ) {
          return false;
        }
        var rect = container.getBoundingClientRect();
        return (
          cx >= rect.left &&
          cx <= rect.right &&
          cy >= rect.top &&
          cy <= rect.bottom
        );
      }
      function applyReorderSizeGuard(target, ev) {
        if (!liveReflowEnabled || !target || target.placement !== "inside") {
          return target;
        }
        if (ev && (isIgnoreAutoLayoutChord(ev) || isPlatformPrimaryChord(ev))) {
          return target;
        }
        var container = dropContainerForTarget(target);
        if (
          !container ||
          container === reorderEl ||
          container === document.body ||
          container === document.documentElement
        ) {
          return target;
        }
        var crect = container.getBoundingClientRect();
        var drect = reorderGestureStartRect;
        if (crect.width >= drect.width && crect.height >= drect.height) {
          return target;
        }
        var parent = container.parentElement;
        if (!parent) return null;
        var pcs = window.getComputedStyle(parent);
        var pAxis =
          pcs.flexDirection === "column" ||
          pcs.flexDirection === "column-reverse"
            ? "y"
            : "x";
        var center =
          pAxis === "x"
            ? crect.left + crect.width / 2
            : crect.top + crect.height / 2;
        var ptr =
          pAxis === "x" ? (ev ? ev.clientX : center) : ev ? ev.clientY : center;
        return {
          anchor: container,
          placement: ptr < center ? "before" : "after",
          axis: pAxis,
          dropMode: "flow-insert",
        };
      }
      function stabilizeReorderTarget(rawTarget, cx, cy, now) {
        var reset = function () {
          reorderCommittedTarget = null;
          reorderCommittedSlot = null;
          reorderPendingSlot = null;
        };
        if (
          !liveReflowEnabled ||
          !rawTarget ||
          rawTarget.dropMode !== "flow-insert"
        ) {
          reset();
          return rawTarget;
        }
        var container = dropContainerForTarget(rawTarget);
        if (
          !container ||
          (reorderEl as HTMLElement).parentElement !== container
        ) {
          reset();
          return rawTarget;
        }
        var slotInfo = reorderSlotForTarget(
          rawTarget,
          reorderRealChildren(container),
        );
        if (!slotInfo) {
          reset();
          return rawTarget;
        }
        var slot = slotInfo.slot;
        var commit = function () {
          reorderCommittedSlot = slot;
          reorderCommittedTarget = rawTarget;
          reorderCommittedPointer = { x: cx, y: cy };
          reorderCommittedAt = now;
          reorderPendingSlot = null;
          return rawTarget;
        };
        if (reorderCommittedSlot === null) return commit();
        if (slot === reorderCommittedSlot) {
          reorderCommittedTarget = rawTarget;
          reorderPendingSlot = null;
          return rawTarget;
        }
        if (reorderPendingSlot !== slot) {
          reorderPendingSlot = slot;
          reorderPendingAt = now;
        }
        var movedPx = Math.hypot(
          cx - reorderCommittedPointer.x,
          cy - reorderCommittedPointer.y,
        );
        if (movedPx >= 8 || now - reorderPendingAt >= 60) return commit();
        return reorderCommittedTarget || rawTarget;
      }
      function applyReorderReflow(target, cx, cy): void {
        if (!liveReflowEnabled) return;
        if (isGroupDrag || !target || target.dropMode !== "flow-insert") {
          clearReorderReflow();
          return;
        }
        var container = dropContainerForTarget(target);
        var containerStyles = container
          ? window.getComputedStyle(container)
          : null;
        if (
          !container ||
          (reorderEl as HTMLElement).parentElement !== container ||
          !containerStyles ||
          (containerStyles.display !== "flex" &&
            containerStyles.display !== "inline-flex" &&
            containerStyles.display !== "grid" &&
            containerStyles.display !== "inline-grid")
        ) {
          clearReorderReflow();
          return;
        }
        var real = reorderRealChildren(container);
        var originIndex = real.indexOf(reorderEl);
        var slotInfo = reorderSlotForTarget(target, real);
        if (originIndex < 0 || !slotInfo) {
          clearReorderReflow();
          return;
        }
        var gridProjectionSupported = supportsGridPlaceholderProjection(
          container,
          containerStyles,
          real.filter(function (member) {
            return member !== reorderEl;
          }),
          [reorderEl],
        );
        var isWrappedFlex =
          containerStyles.flexWrap === "wrap" ||
          containerStyles.flexWrap === "wrap-reverse";
        var axis = reorderMainAxis(target);
        var key = axis + ":" + slotInfo.slot;
        if (key === reflowKey) {
          restoreReorderReflowPreview();
          if (reflowGuideRect) target.guideRect = { ...reflowGuideRect };
          if (reflowGuideMode) target.guideMode = reflowGuideMode;
          return;
        }
        clearReorderReflow();
        reflowKey = key;
        var originalNextSibling = reorderEl.nextSibling;
        var placeholder = reorderEl.cloneNode(true) as HTMLElement;
        placeholder.removeAttribute("data-agent-native-node-id");
        placeholder.setAttribute("data-agent-native-reflow-placeholder", "");
        placeholder.style.visibility = "hidden";
        placeholder.style.pointerEvents = "none";
        placeholder.style.transform = "none";
        placeholder.style.transition = "none";
        if (gridProjectionSupported) {
          prepareGridProjectionPlaceholder(placeholder, containerStyles);
        }
        var projectedRects: {
          el: Element;
          left: number;
          top: number;
        }[] = [];
        try {
          reorderEl.parentElement!.removeChild(reorderEl);
          if (target.placement === "inside") {
            container.appendChild(placeholder);
          } else if (target.placement === "before") {
            container.insertBefore(placeholder, target.anchor);
          } else {
            container.insertBefore(placeholder, target.anchor.nextSibling);
          }
          real.forEach(function (member) {
            if (member === reorderEl) return;
            var projected = member.getBoundingClientRect();
            projectedRects.push({
              el: member,
              left: projected.left,
              top: projected.top,
            });
          });
          if (isWrappedFlex) {
            var projectedGuide = placeholder.getBoundingClientRect();
            reflowGuideRect = {
              left: projectedGuide.left,
              top: projectedGuide.top,
              width: projectedGuide.width,
              height: projectedGuide.height,
            };
            target.guideRect = { ...reflowGuideRect };
            reflowGuideMode = "wrapped-slot";
            target.guideMode = reflowGuideMode;
          }
          placeholder.remove();
          if (
            originalNextSibling &&
            originalNextSibling.parentNode === container
          ) {
            container.insertBefore(reorderEl, originalNextSibling);
          } else {
            container.appendChild(reorderEl);
          }
          if (!isWrappedFlex)
            projectedRects.forEach(function (projected) {
              var el = projected.el as HTMLElement;
              var current = el.getBoundingClientRect();
              var dx = projected.left - current.left;
              var dy = projected.top - current.top;
              if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
              var prevTransform = el.style.transform;
              var authoredTransform = authoredTransformOf(el);
              var previewTransition =
                "transform 140ms cubic-bezier(0.2, 0, 0, 1)";
              var previewTransform =
                "translate(" +
                dx +
                "px, " +
                dy +
                "px)" +
                (authoredTransform ? " " + authoredTransform : "");
              reflowSiblings.push({
                el: el,
                prevTransform: prevTransform,
                authoredTransform: authoredTransform,
                prevTransition: el.style.transition,
                previewTransform: previewTransform,
                previewTransition: previewTransition,
              });
              el.style.transition = previewTransition;
              el.style.transform = previewTransform;
            });
          if (isWrappedFlex) {
            var heldRectBefore = reorderEl.getBoundingClientRect();
            reflowDomOrigin = {
              parent: container,
              nextSibling: originalNextSibling,
            };
            if (target.placement === "inside") {
              container.appendChild(reorderEl);
            } else if (target.placement === "before") {
              container.insertBefore(reorderEl, target.anchor);
            } else {
              container.insertBefore(reorderEl, target.anchor.nextSibling);
            }
            var heldRectAfter = reorderEl.getBoundingClientRect();
            var sourceLift = reorderLiftedMembers.filter(function (snap) {
              return snap.el === reorderEl;
            })[0];
            if (sourceLift) {
              var heldLiftDx =
                cx -
                reorderPointerStart.clientX +
                (duplicateGrabOffset ? duplicateGrabOffset.x : 0);
              var heldLiftDy =
                cy -
                reorderPointerStart.clientY +
                (duplicateGrabOffset ? duplicateGrabOffset.y : 0);
              reorderEl.style.transform =
                "translate(" +
                (heldLiftDx + heldRectBefore.left - heldRectAfter.left) +
                "px, " +
                (heldLiftDy + heldRectBefore.top - heldRectAfter.top) +
                "px)" +
                (sourceLift.authoredTransform
                  ? " " + sourceLift.authoredTransform
                  : "");
            }
          }
        } catch (error) {
          clearReorderReflow();
          throw error;
        } finally {
          if (placeholder.parentNode)
            placeholder.parentNode.removeChild(placeholder);
          if ((reorderEl as HTMLElement).parentNode !== container) {
            if (
              originalNextSibling &&
              originalNextSibling.parentNode === container
            ) {
              container.insertBefore(reorderEl, originalNextSibling);
            } else {
              container.appendChild(reorderEl);
            }
          }
        }
      }
      function onReorderMove(ev) {
        clearGroupGridPreview();
        reorderLastMoveEvent = ev;
        if (!ev.metaKey) releaseReorderMetaOverride(ev);
        if (
          !reorderMoved &&
          Math.hypot(
            ev.clientX - reorderPointerStart.clientX,
            ev.clientY - reorderPointerStart.clientY,
          ) > 3
        ) {
          reorderMoved = true;
        }
        if (ev.altKey && reorderMoved && !duplicatedForDrag) {
          activateLateReorderDuplicate(ev);
        }
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cx = ev.clientX;
        var cy = ev.clientY;
        var dx = cx - reorderPointerStart.clientX;
        var dy = cy - reorderPointerStart.clientY;
        var outside = cx < 0 || cy < 0 || cx > vw || cy > vh;
        if (isIgnoreAutoLayoutChord(ev)) activateReorderControlOverride();
        var rawTarget = null;
        if (ev.metaKey && !isGroupDrag && !reorderIgnoresAutoLayout) {
          clearReorderReflow();
          var metaFlowTarget = outside
            ? null
            : resolveReorderOrFreeTarget(
                cx,
                cy,
                false,
                isPlatformPrimaryChord(ev),
              );
          if (hasMetaFlowTarget(metaFlowTarget, cx, cy)) {
            if (reorderMetaFreePlacement) {
              reorderMetaFreePlacement = false;
              postCrossScreenDrag(
                "start",
                reorderEl,
                {
                  clientX: cx,
                  clientY: cy,
                },
                {
                  duplicate: duplicatedForDrag,
                  elementRect: reorderRect,
                  pointerOffset: reorderPointerOffset,
                  styleSnapshot: reorderStyleSnapshot,
                  modifiers: reorderCrossScreenModifiers(ev),
                },
              );
            }
            rawTarget = metaFlowTarget;
          } else {
            if (!reorderMetaFreePlacement) {
              reorderMetaFreePlacement = true;
              crossScreenClaimedByHost = false;
              postCrossScreenDrag("cancel");
            }
            if (!outside) {
              rawTarget = resolveReorderOrFreeTarget(
                cx,
                cy,
                true,
                isPlatformPrimaryChord(ev),
              );
              rawTarget = applyReorderSizeGuard(rawTarget, ev);
            }
          }
        }
        if (
          !isGroupDrag &&
          !reorderIgnoresAutoLayout &&
          !reorderMetaFreePlacement
        ) {
          postCrossScreenDrag(
            "move",
            reorderEl,
            { clientX: cx, clientY: cy },
            {
              duplicate: duplicatedForDrag,
              elementRect: reorderRect,
              pointerOffset: reorderPointerOffset,
              styleSnapshot: reorderStyleSnapshot,
              modifiers: reorderCrossScreenModifiers(ev),
            },
          );
        }
        if (outside && !isGroupDrag) {
          hideInsertionGuide();
          clearReorderLift();
          clearReorderReflow();
          postEditorDragState(true, { phase: "clear" });
          showTransformBadge(
            duplicatedForDrag ? "Duplicate layer" : "Move layer",
            cx,
            cy,
          );
        } else {
          clearReorderReflowForHitTest();
          if (!rawTarget) {
            rawTarget = resolveReorderOrFreeTarget(
              cx,
              cy,
              reorderIgnoresAutoLayout ||
                reorderMetaFreePlacement ||
                isIgnoreAutoLayoutChord(ev),
              isPlatformPrimaryChord(ev),
            );
          }
          rawTarget = applyReorderSizeGuard(rawTarget, ev);
          currentTarget = stabilizeReorderTarget(
            rawTarget,
            cx,
            cy,
            ev.timeStamp,
          );
          var _dndKey = currentTarget
            ? getSelector(currentTarget.anchor) +
              "|" +
              currentTarget.placement +
              "|" +
              currentTarget.dropMode
            : "none";
          if (_dndKey !== reorderLastTargetKey) {
            reorderLastTargetKey = _dndKey;
            dndLog("target", dndTarget(currentTarget));
            postLayerStructurePreview(reorderEl, currentTarget);
          }
          applyReorderLift(dx, dy);
          applyReorderReflow(currentTarget, cx, cy);
          applyGroupGridPreview(currentTarget);
          showInsertionGuideFor(currentTarget);
          showTransformBadge(
            duplicatedForDrag
              ? "Duplicate layer"
              : currentTarget
                ? "Move layer"
                : "Move",
            cx,
            cy,
          );
        }
      }
      function cleanupReorderDrag() {
        clearGroupGridPreview();
        document.removeEventListener(events.move, onReorderMove, true);
        document.removeEventListener(events.up, onReorderUp, true);
        document.removeEventListener("pointercancel", onReorderEscape, true);
        window.removeEventListener("blur", onReorderEscape, true);
        document.removeEventListener(
          "visibilitychange",
          onReorderVisibilityChange,
          true,
        );
        document.removeEventListener("keydown", onReorderKeyDown, true);
        document.removeEventListener("keyup", onReorderKeyUp, true);
        clearActiveDragCancel(onReorderEscape);
        clearReorderLift();
        clearReorderReflow();
        suppressNextShieldClickBriefly();
      }
      function onReorderVisibilityChange() {
        if (document.visibilityState === "hidden") onReorderEscape();
      }
      function onReorderEscape() {
        resetBridgeDragModifierStateOnCancel();
        cleanupReorderDrag();
        hideTransformBadge();
        hideInsertionGuide();
        if (!isGroupDrag) postCrossScreenDrag("cancel");
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
        resetReorderModifierState();
        suppressNextShieldClickBriefly();
        return true;
      }
      function onReorderKeyDown(ev) {
        if (
          ev.key === "Control" ||
          ev.code === "ControlLeft" ||
          ev.code === "ControlRight"
        ) {
          activateReorderControlOverride();
          ev.preventDefault();
          return;
        }
        if (ev.code === "Space" || ev.key === " ") {
          keepCurrentFlowParent = true;
          ev.preventDefault();
          return;
        }
        if (ev.key === "Escape") {
          stopNativeInteraction(ev);
          onReorderEscape();
        }
      }
      function onReorderKeyUp(ev) {
        if (
          ev.key === "Meta" ||
          ev.code === "MetaLeft" ||
          ev.code === "MetaRight"
        ) {
          releaseReorderMetaOverride();
          ev.preventDefault();
          return;
        }
        if (ev.code !== "Space" && ev.key !== " ") return;
        ev.preventDefault();
      }
      function onReorderUp(ev) {
        if (
          !ev ||
          !Number.isFinite(ev.clientX) ||
          !Number.isFinite(ev.clientY)
        ) {
          onReorderEscape();
          return;
        }
        cleanupReorderDrag();
        hideTransformBadge();
        hideInsertionGuide();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cx = ev.clientX;
        var cy = ev.clientY;
        var outside = cx < 0 || cy < 0 || cx > vw || cy > vh;
        if (!ev.metaKey) releaseReorderMetaOverride(ev);
        if (isIgnoreAutoLayoutChord(ev)) activateReorderControlOverride();
        if (ev.metaKey && !reorderIgnoresAutoLayout && !isGroupDrag) {
          var metaReleaseTarget = outside
            ? null
            : resolveReorderOrFreeTarget(
                cx,
                cy,
                false,
                isPlatformPrimaryChord(ev),
              );
          if (!hasMetaFlowTarget(metaReleaseTarget, cx, cy)) {
            reorderMetaFreePlacement = true;
            crossScreenClaimedByHost = false;
            postCrossScreenDrag("cancel");
          } else {
            reorderMetaFreePlacement = false;
          }
        }
        var outsideOnDrop =
          (!reorderIgnoresAutoLayout &&
            !reorderMetaFreePlacement &&
            (cx < 0 || cy < 0 || cx > vw || cy > vh)) ||
          crossScreenClaimedByHost;
        if (
          !isGroupDrag &&
          !reorderIgnoresAutoLayout &&
          !reorderMetaFreePlacement
        ) {
          postCrossScreenDrag(
            "end",
            reorderEl,
            { clientX: cx, clientY: cy },
            {
              duplicate: duplicatedForDrag,
              elementRect: reorderRect,
              pointerOffset: reorderPointerOffset,
              styleSnapshot: reorderStyleSnapshot,
              modifiers: reorderCrossScreenModifiers(ev),
            },
          );
        }
        if (outsideOnDrop) {
          if (duplicatedForDrag) {
            if (reorderEl.parentElement)
              reorderEl.parentElement.removeChild(reorderEl);
            selectedEl = originalSelectedEl;
            positionOverlay(selectionOverlay, selectedEl);
            postElementSelect(selectedEl);
          }
          resetReorderModifierState();
          return;
        }
        var finalRaw = resolveReorderOrFreeTarget(
          cx,
          cy,
          reorderIgnoresAutoLayout ||
            reorderMetaFreePlacement ||
            isIgnoreAutoLayoutChord(ev),
          isPlatformPrimaryChord(ev),
        );
        currentTarget = liveReflowEnabled
          ? stabilizeReorderTarget(
              applyReorderSizeGuard(finalRaw, ev),
              cx,
              cy,
              ev && typeof ev.timeStamp === "number"
                ? ev.timeStamp
                : reorderCommittedAt,
            )
          : finalRaw;
        dndLog("commit:resolve", {
          raw: dndTarget(finalRaw),
          final: dndTarget(currentTarget),
          ctrl: Boolean(ev && ev.ctrlKey),
        });
        if (!currentTarget) {
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
          resetReorderModifierState();
          return;
        }
        if (
          currentTarget.needsAutoLayoutConversion &&
          currentTarget.conversionTarget
        ) {
          applyAutoLayoutConversionForDrop(currentTarget.conversionTarget);
        }
        prepareFlowMembersForAbsoluteDrop(
          groupEls,
          currentTarget,
          reorderGroupStartRects,
          reorderGestureStartRect,
          reorderPointerOffset,
          cx,
          cy,
        );
        if (duplicatedForDrag) {
          applyRuntimeReorder(reorderEl, currentTarget);
          positionOverlay(selectionOverlay, reorderEl);
          postVisualDuplicateChange(
            originalSelectedEl,
            reorderEl,
            currentTarget,
            duplicatedSourceNodeIdMap,
          );
          postCrossScreenDrag("cancel");
        } else if (isGroupDrag) {
          applyGroupStructureDrop(
            groupEls,
            currentTarget,
            ev,
            function (member) {
              var origin = reorderOrigins.filter(function (candidate) {
                return candidate.el === member;
              })[0];
              return origin
                ? origin.prevInlinePositionStyles
                : snapshotInlinePositionStyles(member);
            },
          );
        } else {
          var reorderOrigin = reorderOrigins.filter(function (candidate) {
            return candidate.el === reorderEl;
          })[0];
          var prevParent = reorderOrigin
            ? reorderOrigin.prevParent
            : reorderEl.parentElement;
          var prevNextSibling = reorderOrigin
            ? reorderOrigin.prevNextSibling
            : reorderEl.nextSibling;
          var prevInlinePositionStyles = reorderOrigin
            ? reorderOrigin.prevInlinePositionStyles
            : snapshotInlinePositionStyles(reorderEl);
          var prevInlineGridStyles = snapshotInlineGridStyles(reorderEl);
          adaptAutoTextColorForNest(
            reorderEl,
            dropContainerForTarget(currentTarget),
          );
          var runtimeMutationApplied = applyRuntimeReorder(
            reorderEl,
            currentTarget,
          );
          dndLog("commit:done", {
            el: getSelector(reorderEl),
            parent: reorderEl.parentElement
              ? getSelector(reorderEl.parentElement)
              : null,
          });
          if (runtimeMutationApplied) {
            postVisualStructureChange(reorderEl, currentTarget, {
              prevParent: prevParent,
              prevNextSibling: prevNextSibling,
              prevInlinePositionStyles: prevInlinePositionStyles,
              prevInlineGridStyles: prevInlineGridStyles,
              ...(Array.isArray(currentTarget.gridDisplacementPrevStyles) &&
              currentTarget.gridDisplacementPrevStyles.length > 0
                ? {
                    gridDisplacements: currentTarget.gridDisplacementPrevStyles,
                  }
                : {}),
            });
          }
        }
        resetReorderModifierState();
      }
      document.addEventListener(events.move, onReorderMove, true);
      document.addEventListener(events.up, onReorderUp, true);
      document.addEventListener("pointercancel", onReorderEscape, true);
      window.addEventListener("blur", onReorderEscape, true);
      document.addEventListener(
        "visibilitychange",
        onReorderVisibilityChange,
        true,
      );
      document.addEventListener("keydown", onReorderKeyDown, true);
      document.addEventListener("keyup", onReorderKeyUp, true);
      setActiveDragCancel(onReorderEscape);
      return;
    }
    var memberStates = groupEls.map(function (member) {
      var m = member as HTMLElement;
      var snapshot = {
        el: m,
        originalPosition: m.style.position,
        originalLeft: m.style.left,
        originalTop: m.style.top,
        originLeft: 0,
        originTop: 0,
      };
      ensurePositionable(m);
      var mcs = window.getComputedStyle(m);
      snapshot.originLeft = readPx(m.style.left || mcs.left);
      snapshot.originTop = readPx(m.style.top || mcs.top);
      return snapshot;
    });
    var liftedClippingAncestors = liftOverflowOnAncestors(groupEls);
    var gestureState =
      memberStates[groupEls.indexOf(gestureEl)] || memberStates[0];

    var originLeft = gestureState.originLeft;
    var originTop = gestureState.originTop;
    var startX = pointerStartParam ? pointerStartParam.clientX : e.clientX;
    var startY = pointerStartParam ? pointerStartParam.clientY : e.clientY;
    var dragEl = gestureEl;
    var gestureViewport = bridgeGestureViewport();
    var DRAG_THRESHOLD = 3;
    var bridgeMoveController = createCanvasGestureController({
      capabilities: { move: true, resize: true },
      drag: {
        threshold: pointerStartParam ? 0 : DRAG_THRESHOLD,
        duplicateModifier: "alt",
      },
      adapter: {
        preview: function () {
          return { handled: true };
        },
        commit: function () {
          return { handled: true };
        },
        cancel: function () {
          return { handled: true };
        },
      },
    });
    bridgeMoveController.pointerDown({
      kind: "move",
      objectIds: [getSelector(gestureEl)],
      pointer: bridgeGesturePointer(
        duplicatedForDrag && pointerStartParam
          ? { ...e, ...pointerStartParam }
          : e,
      ),
      viewport: gestureViewport,
      canvas: { width: gestureViewport.width, height: gestureViewport.height },
    });
    var moved = false;
    dndLog("start:free", { el: getSelector(gestureEl), isGroup: isGroupDrag });
    var currentAutoLayoutTarget: {
      anchor: Element;
      placement: string;
      axis?: string;
      needsAutoLayoutConversion?: boolean;
      conversionTarget?: Element;
    } | null = null;
    var dragIgnoreAutoLayout =
      hostIgnoreAutoLayoutAtPointerDown ||
      pointerStartParam?.ignoreAutoLayout === true ||
      isIgnoreAutoLayoutChord(e);
    hostIgnoreAutoLayoutAtPointerDown = false;
    function ignoreAutoLayoutHeld(ev): boolean {
      return dragIgnoreAutoLayout || isIgnoreAutoLayoutChordForDragPoint(ev);
    }
    var autoLayoutTargetFrame = 0;
    var pendingAutoLayoutTargetPoint: {
      clientX: number;
      clientY: number;
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      spaceKeyPressed: boolean;
      ignoreAutoLayoutKeyPressed: boolean;
      snapResult: {
        guides: unknown[];
        spacingGuides: unknown[];
        measurements: unknown[];
      };
    } | null = null;
    var snapCandidateRects = collectSnapCandidateRects(dragEl, groupOthers);
    var dragElStartRect = (dragEl as HTMLElement).getBoundingClientRect();
    var dragElStartWidth = dragElStartRect.width;
    var dragElStartHeight = dragElStartRect.height;
    function applyFreeDropSizeGuard(target, ev) {
      if (
        !target ||
        target.placement !== "inside" ||
        target.dropMode !== "flow-insert"
      ) {
        return target;
      }
      if (ev && (ignoreAutoLayoutHeld(ev) || isPlatformPrimaryChord(ev))) {
        return target;
      }
      var container = dropContainerForTarget(target);
      if (
        !container ||
        container === dragEl ||
        container === document.body ||
        container === document.documentElement ||
        !isAutoLayoutElement(container)
      ) {
        return target;
      }
      var crect = container.getBoundingClientRect();
      if (
        crect.width >= dragElStartRect.width &&
        crect.height >= dragElStartRect.height
      ) {
        return target;
      }
      var parent = container.parentElement;
      if (!parent) return null;
      var pcs = window.getComputedStyle(parent);
      var pAxis =
        pcs.flexDirection === "column" || pcs.flexDirection === "column-reverse"
          ? "y"
          : "x";
      var center =
        pAxis === "x"
          ? crect.left + crect.width / 2
          : crect.top + crect.height / 2;
      var pointer =
        pAxis === "x" ? (ev ? ev.clientX : center) : ev ? ev.clientY : center;
      return {
        anchor: container,
        placement: pointer < center ? "before" : "after",
        axis: pAxis,
        dropMode: "flow-insert",
      };
    }
    function cancelAutoLayoutTargetResolution(): void {
      pendingAutoLayoutTargetPoint = null;
      if (autoLayoutTargetFrame) {
        window.cancelAnimationFrame(autoLayoutTargetFrame);
        autoLayoutTargetFrame = 0;
      }
    }

    function scheduleAutoLayoutTargetResolution(ev, snapResult): void {
      pendingAutoLayoutTargetPoint = {
        clientX: ev.clientX,
        clientY: ev.clientY,
        metaKey: !!ev.metaKey,
        ctrlKey: !!ev.ctrlKey,
        altKey: !!ev.altKey,
        shiftKey: !!ev.shiftKey,
        spaceKeyPressed: Boolean(ev.spaceKeyPressed) || bridgeSpaceKeyPressed,
        ignoreAutoLayoutKeyPressed:
          Boolean(ev.ignoreAutoLayoutKeyPressed) ||
          bridgeIgnoreAutoLayoutKeyPressed ||
          (!isApplePlatformBridge() && String(ev.key).toLowerCase() === "s"),
        snapResult: {
          guides: snapResult.guides,
          spacingGuides: snapResult.spacingGuides,
          measurements: snapResult.measurements,
        },
      };
      if (autoLayoutTargetFrame) return;
      autoLayoutTargetFrame = window.requestAnimationFrame(function () {
        autoLayoutTargetFrame = 0;
        var point = pendingAutoLayoutTargetPoint;
        pendingAutoLayoutTargetPoint = null;
        if (!point || !dragEl || !document.documentElement.contains(dragEl)) {
          return;
        }
        if (point.spaceKeyPressed) {
          currentAutoLayoutTarget = null;
          hideInsertionGuide();
          return;
        }
        var target = autoLayoutInsertionTargetForPoint(
          dragEl,
          point.clientX,
          point.clientY,
          groupOthers,
          isPlatformPrimaryChord(point),
        );
        if (target && isIgnoreAutoLayoutChordForDragPoint(point)) {
          target = ignoreAutoLayoutForDropTarget(target);
        }
        currentAutoLayoutTarget = applyFreeDropSizeGuard(target, point);
        if (currentAutoLayoutTarget) {
          showInsertionGuideFor(currentAutoLayoutTarget);
          if (currentAutoLayoutTarget.dropMode !== "absolute-container") {
            hideSnapGuides();
            dragChromeSuppressed = true;
            hideSizeBadge();
            hideConstraintGuides();
          } else {
            dragChromeSuppressed = false;
            showSnapGuides(
              point.snapResult.guides,
              point.snapResult.spacingGuides,
              point.snapResult.measurements,
            );
            showConstraintGuides(dragEl);
          }
        } else {
          hideInsertionGuide();
          dragChromeSuppressed = false;
          showSnapGuides(
            point.snapResult.guides,
            point.snapResult.spacingGuides,
            point.snapResult.measurements,
          );
          showConstraintGuides(dragEl);
        }
      });
    }

    function ancestorScale(el, axis) {
      var host = el && (el as HTMLElement).offsetParent;
      if (!host) return 1;
      var rect = (host as HTMLElement).getBoundingClientRect();
      var layout =
        axis === "x"
          ? (host as HTMLElement).offsetWidth
          : (host as HTMLElement).offsetHeight;
      var client = axis === "x" ? rect.width : rect.height;
      if (!(layout > 0)) return 1;
      var scale = client / layout;
      return scale > 0 && Number.isFinite(scale) ? scale : 1;
    }
    var dragElOffsetScaleX = ancestorScale(dragEl, "x");
    var dragElOffsetScaleY = ancestorScale(dragEl, "y");
    if (!isGroupDrag) {
      postCrossScreenDrag("start", dragEl, pointerStartParam || e, {
        duplicate: duplicatedForDrag,
        styleSnapshot: duplicateStyleSnapshot,
        modifiers: {
          metaKey: !!e.metaKey,
          ctrlKey: !!e.ctrlKey,
          ignoreAutoLayout: dragIgnoreAutoLayout,
          forceNestedAutoLayout: isPlatformPrimaryChord(e),
        },
      });
    }
    var crossScreenDragMoveScheduled = false;
    var crossScreenDragMovePendingEv: {
      clientX: number;
      clientY: number;
      metaKey: boolean;
      ctrlKey: boolean;
      ignoreAutoLayout: boolean;
      forceNestedAutoLayout: boolean;
    } | null = null;
    function flushCrossScreenDragMove() {
      crossScreenDragMoveScheduled = false;
      var pendingEv = crossScreenDragMovePendingEv;
      crossScreenDragMovePendingEv = null;
      if (pendingEv) {
        postCrossScreenDrag("move", dragEl, pendingEv, {
          duplicate: duplicatedForDrag,
          modifiers: {
            metaKey: pendingEv.metaKey,
            ctrlKey: pendingEv.ctrlKey,
            ignoreAutoLayout: pendingEv.ignoreAutoLayout,
            forceNestedAutoLayout: pendingEv.forceNestedAutoLayout,
          },
        });
      }
    }
    function scheduleCrossScreenDragMove(ev): void {
      crossScreenDragMovePendingEv = {
        clientX: ev.clientX,
        clientY: ev.clientY,
        metaKey: !!ev.metaKey,
        ctrlKey: !!ev.ctrlKey,
        ignoreAutoLayout: ignoreAutoLayoutHeld(ev),
        forceNestedAutoLayout: isPlatformPrimaryChord(ev),
      };
      if (crossScreenDragMoveScheduled) return;
      crossScreenDragMoveScheduled = true;
      window.requestAnimationFrame(flushCrossScreenDragMove);
    }
    function activateLateDuplicate(ev): void {
      if (duplicatedForDrag || isGroupDrag || !originalSelectedEl) return;
      var source = originalSelectedEl as HTMLElement;
      duplicateStyleSnapshot = collectPortableStyleSnapshot(source);
      var sourceState = memberStates.filter(function (state) {
        return state.el === source;
      })[0];
      if (!sourceState || !source.parentElement) return;

      var heldPosition = {
        position: source.style.position,
        left: source.style.left,
        top: source.style.top,
      };
      source.style.position = sourceState.originalPosition;
      source.style.left = sourceState.originalLeft;
      source.style.top = sourceState.originalTop;
      var grabbedRect = source.getBoundingClientRect();
      var clone = source.cloneNode(true) as HTMLElement;
      duplicatedSourceNodeIdMap = resetRuntimeStableIds(clone);
      clone.setAttribute("data-agent-native-clone-root", "true");
      source.parentElement.insertBefore(clone, source.nextSibling);
      clone.style.position = heldPosition.position;
      clone.style.left = heldPosition.left;
      clone.style.top = heldPosition.top;
      publishSourceDocumentProvenance(undefined, true);

      selectedEl = clone;
      gestureEl = clone;
      dragEl = clone;
      duplicatedForDrag = true;
      groupEls = [clone];
      groupOthers = [];
      isGroupDrag = false;
      var insertedRect = clone.getBoundingClientRect();
      duplicateGrabOffset = {
        x: grabbedRect.left - insertedRect.left,
        y: grabbedRect.top - insertedRect.top,
      };
      var cloneState = {
        el: clone,
        originalPosition: clone.style.position,
        originalLeft: clone.style.left,
        originalTop: clone.style.top,
        originLeft: 0,
        originTop: 0,
      };
      ensurePositionable(clone);
      var cloneStyles = window.getComputedStyle(clone);
      cloneState.originLeft = readPx(clone.style.left || cloneStyles.left);
      cloneState.originTop = readPx(clone.style.top || cloneStyles.top);
      memberStates = [cloneState];
      gestureState = cloneState;
      originLeft = sourceState.originLeft;
      originTop = sourceState.originTop;
      cloneState.originLeft = originLeft;
      cloneState.originTop = originTop;
      dragElStartRect = dragGrabRect(clone);
      dragElStartWidth = dragElStartRect.width;
      dragElStartHeight = dragElStartRect.height;
      dragElOffsetScaleX = ancestorScale(clone, "x");
      dragElOffsetScaleY = ancestorScale(clone, "y");
      snapCandidateRects = collectSnapCandidateRects(clone, []);
      currentAutoLayoutTarget = null;
      crossScreenClaimedByHost = false;
      postCrossScreenDrag("cancel");
      postCrossScreenDrag("start", clone, ev, {
        duplicate: true,
        styleSnapshot: duplicateStyleSnapshot,
      });
      positionOverlay(selectionOverlay, selectedEl);
      postElementSelect(selectedEl);
    }
    function onMove(ev) {
      var controllerMove = bridgeMoveController.pointerMove(
        bridgeGesturePointer(ev),
      );
      if (controllerMove.phase !== "active") return;
      if (
        !moved &&
        Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD
      ) {
        moved = true;
      }
      if (ev.altKey && moved && !duplicatedForDrag) {
        activateLateDuplicate(ev);
      }
      var rawDx = controllerMove.gesture.canvasDelta.x;
      var rawDy = controllerMove.gesture.canvasDelta.y;
      var nextLeft = originLeft + rawDx;
      var nextTop = originTop + rawDy;
      var snapBypass = ignoreAutoLayoutHeld(ev) || isPlatformPrimaryChord(ev);
      var snapResult =
        !snapBypass && !duplicatedForDrag
          ? computeMoveSnapOffset(
              {
                left:
                  dragElStartRect.left +
                  (nextLeft - originLeft) * dragElOffsetScaleX,
                top:
                  dragElStartRect.top +
                  (nextTop - originTop) * dragElOffsetScaleY,
                width: dragElStartWidth,
                height: dragElStartHeight,
              },
              snapCandidateRects,
              SNAP_THRESHOLD_PX * chromeLineScale(),
              isGroupDrag,
              ev.shiftKey ? { x: rawDx === 0, y: rawDy === 0 } : null,
            )
          : { dx: 0, dy: 0, guides: [], spacingGuides: [], measurements: [] };
      if ((window as any).__DND_DEBUG)
        dndLog("snap:tick", {
          bypass: snapBypass,
          duplicated: duplicatedForDrag,
          mods:
            (ev.metaKey ? "M" : "") +
              (ev.ctrlKey ? "C" : "") +
              (ev.altKey ? "A" : "") +
              (ev.shiftKey ? "S" : "") || "none",
          guides: snapResult.guides.length,
          measurements: snapResult.measurements.length,
          candidates: snapCandidateRects.length,
          dropMode: currentAutoLayoutTarget
            ? currentAutoLayoutTarget.dropMode || "(none)"
            : "no-target",
        });
      nextLeft += snapResult.dx / dragElOffsetScaleX;
      nextTop += snapResult.dy / dragElOffsetScaleY;
      var appliedDx = nextLeft - originLeft;
      var appliedDy = nextTop - originTop;
      memberStates.forEach(function (state) {
        state.el.style.left =
          quantizeToLayoutGrid(state.originLeft + appliedDx) + "px";
        state.el.style.top =
          quantizeToLayoutGrid(state.originTop + appliedDy) + "px";
      });
      if (!isGroupDrag) {
        scheduleCrossScreenDragMove(ev);
      }
      if (!isGroupDrag && isOutsideIframeViewport(ev.clientX, ev.clientY)) {
        cancelAutoLayoutTargetResolution();
        currentAutoLayoutTarget = null;
        hideInsertionGuide();
      } else {
        if (!bridgeSpaceKeyPressed) {
          scheduleAutoLayoutTargetResolution(ev, snapResult);
        } else {
          cancelAutoLayoutTargetResolution();
          currentAutoLayoutTarget = null;
          hideInsertionGuide();
        }
      }
      var flowInsertPending =
        !!currentAutoLayoutTarget &&
        currentAutoLayoutTarget.dropMode !== "absolute-container";
      if (
        flowInsertPending ||
        (!isGroupDrag && isOutsideIframeViewport(ev.clientX, ev.clientY))
      ) {
        hideSnapGuides();
        dragChromeSuppressed = true;
        hideSizeBadge();
        hideConstraintGuides();
      } else {
        dragChromeSuppressed = false;
        showSnapGuides(
          snapResult.guides,
          snapResult.spacingGuides,
          snapResult.measurements,
        );
        showConstraintGuides(dragEl);
      }
      if (duplicatedForDrag) {
        showTransformBadge("Duplicate layer", ev.clientX, ev.clientY);
      }
      scheduleRefreshOverlays();
    }
    function restoreSourceDragPosition(): void {
      memberStates.forEach(function (state) {
        state.el.style.position = state.originalPosition;
        state.el.style.left = state.originalLeft;
        state.el.style.top = state.originalTop;
      });
      selectedEl = originalSelectedEl;
      positionOverlay(selectionOverlay, selectedEl);
    }
    function cleanupMoveDrag() {
      cancelAutoLayoutTargetResolution();
      refreshOverlaysGeneration += 1;
      refreshOverlaysScheduled = false;
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      document.removeEventListener("keydown", onMoveKeyDown, true);
      clearActiveDragCancel(cancelMoveDrag);
      restoreOverflowOnAncestors(liftedClippingAncestors);
      crossScreenDragMoveScheduled = false;
      crossScreenDragMovePendingEv = null;
      suppressNextShieldClickBriefly();
    }
    function cancelMoveDrag() {
      resetBridgeDragModifierStateOnCancel();
      bridgeMoveController.cancel();
      cleanupMoveDrag();
      hideTransformBadge();
      hideInsertionGuide();
      hideSnapGuides();
      hideSizeBadge();
      hideConstraintGuides();
      currentAutoLayoutTarget = null;
      if (duplicatedForDrag) {
        if (dragEl && dragEl.parentElement) {
          dragEl.parentElement.removeChild(dragEl);
        }
        selectedEl = originalSelectedEl;
        positionOverlay(selectionOverlay, selectedEl);
        postElementSelect(selectedEl);
        postCrossScreenDrag("cancel");
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
      var controllerEnd = bridgeMoveController.pointerUp(
        bridgeGesturePointer(ev),
      );
      if (!controllerEnd.committed) {
        cleanupMoveDrag();
        hideTransformBadge();
        hideInsertionGuide();
        hideSnapGuides();
        hideSizeBadge();
        hideConstraintGuides();
        if (duplicatedForDrag) {
          if (dragEl.parentElement) dragEl.parentElement.removeChild(dragEl);
          selectedEl = originalSelectedEl;
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
          postCrossScreenDrag("cancel");
        } else if (!isGroupDrag) {
          postCrossScreenDrag("cancel");
        }
        return;
      }
      cleanupMoveDrag();
      scheduleRefreshOverlays();
      hideTransformBadge();
      hideInsertionGuide();
      hideSnapGuides();
      hideSizeBadge();
      hideConstraintGuides();
      if (!dragEl) return;
      var outsideOnDrop = ev
        ? isOutsideIframeViewport(ev.clientX, ev.clientY) ||
          crossScreenClaimedByHost
        : false;
      if (ev && !isGroupDrag && (outsideOnDrop || designCanvasBoardSurface)) {
        postCrossScreenDrag("end", dragEl, ev, {
          duplicate: duplicatedForDrag,
          modifiers: {
            metaKey: !!ev.metaKey,
            ctrlKey: !!ev.ctrlKey,
            ignoreAutoLayout: ignoreAutoLayoutHeld(ev),
            forceNestedAutoLayout: isPlatformPrimaryChord(ev),
          },
        });
      }
      if (ev && !isGroupDrag && outsideOnDrop) {
        if (duplicatedForDrag) {
          if (dragEl.parentElement) dragEl.parentElement.removeChild(dragEl);
          selectedEl = originalSelectedEl;
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
        } else {
          restoreSourceDragPosition();
          // The host hides/deletes the source only after the destination
          // acknowledges its insert; failed or unavailable targets leave this
          // node visible at its restored source position.
        }
        return;
      }
      if (ev && !outsideOnDrop && !bridgeSpaceKeyPressed) {
        var finalAutoLayoutTarget = autoLayoutInsertionTargetForPoint(
          dragEl,
          ev.clientX,
          ev.clientY,
          groupOthers,
          isPlatformPrimaryChord(ev),
        );
        if (finalAutoLayoutTarget && ignoreAutoLayoutHeld(ev)) {
          finalAutoLayoutTarget = ignoreAutoLayoutForDropTarget(
            finalAutoLayoutTarget,
          );
        }
        finalAutoLayoutTarget = applyFreeDropSizeGuard(
          finalAutoLayoutTarget,
          ev,
        );
        currentAutoLayoutTarget = finalAutoLayoutTarget;
      } else if (bridgeSpaceKeyPressed) {
        currentAutoLayoutTarget = null;
      }
      if (duplicatedForDrag && !moved) {
        if (dragEl.parentElement) dragEl.parentElement.removeChild(dragEl);
        selectedEl = originalSelectedEl;
        positionOverlay(selectionOverlay, selectedEl);
        postElementSelect(selectedEl);
        postCrossScreenDrag("cancel");
        return;
      }
      if (duplicatedForDrag) {
        postVisualDuplicateChange(
          originalSelectedEl,
          dragEl,
          currentAutoLayoutTarget,
          duplicatedSourceNodeIdMap,
        );
        postCrossScreenDrag("cancel");
      } else if (currentAutoLayoutTarget) {
        if (isGroupDrag) {
          applyGroupStructureDrop(
            groupEls,
            currentAutoLayoutTarget,
            ev,
            function (member) {
              var state = memberStates.filter(function (s) {
                return s.el === member;
              })[0];
              return state
                ? dragOriginInlinePositionStyles(state)
                : snapshotInlinePositionStyles(member);
            },
          );
        } else {
          var prevParent = dragEl.parentElement;
          var prevNextSibling = dragEl.nextSibling;
          var prevInlinePositionStyles =
            dragOriginInlinePositionStyles(gestureState);
          adaptAutoTextColorForNest(
            dragEl,
            dropContainerForTarget(currentAutoLayoutTarget),
          );
          var runtimeMutationApplied = applyRuntimeReorder(
            dragEl,
            currentAutoLayoutTarget,
          );
          dndLog("commit:free-nest", {
            el: getSelector(dragEl),
            target: dndTarget(currentAutoLayoutTarget),
          });
          if (runtimeMutationApplied) {
            postVisualStructureChange(dragEl, currentAutoLayoutTarget, {
              prevParent: prevParent,
              prevNextSibling: prevNextSibling,
              prevInlinePositionStyles: prevInlinePositionStyles,
            });
          }
        }
      } else {
        dndLog("commit:free-absolute", { count: memberStates.length });
        memberStates.forEach(function (state) {
          var styles = {
            position: state.el.style.position,
            left: state.el.style.left,
            top: state.el.style.top,
          };
          (window.parent as Window).postMessage(
            {
              type: "visual-style-change",
              selector: getSelector(state.el),
              styles: styles,
              originalStyles: originalInlineStylesForPatch(state.el, styles),
              payload: getElementInfo(state.el),
            },
            "*",
          );
          recordSourceOwnership(state.el);
        });
        armPostCommitCancelGrace(
          moveGestureId,
          performance.timeOrigin + (ev ? ev.timeStamp : performance.now()),
          function () {
            memberStates.forEach(function (state) {
              state.el.style.position = state.originalPosition;
              state.el.style.left = state.originalLeft;
              state.el.style.top = state.originalTop;
              var revertStyles = {
                position: state.originalPosition,
                left: state.originalLeft,
                top: state.originalTop,
              };
              (window.parent as Window).postMessage(
                {
                  type: "visual-style-change",
                  selector: getSelector(state.el),
                  styles: revertStyles,
                  originalStyles: originalInlineStylesForPatch(
                    state.el,
                    revertStyles,
                  ),
                  payload: getElementInfo(state.el),
                },
                "*",
              );
              recordSourceOwnership(state.el);
            });
            selectedEl = originalSelectedEl;
            positionOverlay(selectionOverlay, selectedEl);
            refreshOverlays();
          },
        );
        if (!isGroupDrag) postCrossScreenDrag("cancel");
      }
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onMoveKeyDown, true);
    setActiveDragCancel(cancelMoveDrag, gestureStartedAt);
  }

  var KSCALE_LENGTH_PROPERTIES = [
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "left",
    "right",
    "top",
    "bottom",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "row-gap",
    "column-gap",
    "flex-basis",
    "font-size",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
    "outline-width",
    "outline-offset",
    "box-shadow",
    "text-shadow",
  ];

  function scaleKScaleLengthValue(value: string, factor: number) {
    return value.replace(/(-?\d*\.?\d+)px\b/gi, function (_token, number) {
      return (Number(number) * factor).toFixed(2).replace(/\.00$/, "") + "px";
    });
  }

  function isInsideScaledSvgViewBox(el: Element) {
    var svgViewport = el instanceof SVGSVGElement ? el : el.closest("svg");
    var outerSvgViewport = svgViewport?.parentElement?.closest("svg");
    return Boolean(
      (svgViewport?.hasAttribute("viewBox") && svgViewport !== el) ||
      outerSvgViewport?.hasAttribute("viewBox"),
    );
  }

  function rawKScaleValue(
    el: Element,
    property: string,
    typedStyleMap: StylePropertyMap | null,
  ) {
    var inlineValue = (el as HTMLElement).style?.getPropertyValue(property);
    return typedStyleMap
      ? typedStyleMap.get(property)?.toString() || inlineValue || ""
      : inlineValue || "";
  }

  function typedKScaleValue(
    el: Element,
    property: string,
    typedStyleMap: StylePropertyMap | null,
  ) {
    var value = rawKScaleValue(el, property, typedStyleMap);
    if (!/[-+]?\d*\.?\d+px\b/i.test(value)) return "";
    return value;
  }

  function collectKScaleStyleTargets(
    root: Element,
    includeRootFontSize: boolean,
  ) {
    var targets: Array<{
      el: HTMLElement;
      selector: string;
      sourceId?: string;
      originalStyles: Record<string, { value: string; priority: string }>;
      scaledStyles: Record<string, string>;
      preservedStyles: Record<string, string>;
    }> = [];
    var elements = [root].concat(
      Array.prototype.slice.call(root.querySelectorAll("*")),
    );

    function isFlexibleMainAxisFill(el: HTMLElement, property: string) {
      if (property !== "width" && property !== "height") return false;
      var parent = el.parentElement;
      if (!parent) return false;
      var parentStyle = window.getComputedStyle(parent);
      if (
        parentStyle.display !== "flex" &&
        parentStyle.display !== "inline-flex"
      ) {
        return false;
      }
      var isMainAxis =
        (property === "width" &&
          parentStyle.flexDirection !== "column" &&
          parentStyle.flexDirection !== "column-reverse") ||
        (property === "height" &&
          (parentStyle.flexDirection === "column" ||
            parentStyle.flexDirection === "column-reverse"));
      if (!isMainAxis) return false;
      var itemStyle = window.getComputedStyle(el);
      return (
        Number(itemStyle.flexGrow) > 0 ||
        itemStyle.flexBasis === "0%" ||
        itemStyle.flexBasis === "0px"
      );
    }

    for (var index = 0; index < elements.length; index += 1) {
      var el = elements[index] as HTMLElement;
      if (
        (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) ||
        !isRuntimeLayerVisualNode(el)
      )
        continue;
      var isRoot = el === root;
      var originalStyles: Record<string, { value: string; priority: string }> =
        {};
      var scaledStyles: Record<string, string> = {};
      var preservedStyles: Record<string, string> = {};
      var typedStyleMap =
        typeof (el as Element & { computedStyleMap?: () => StylePropertyMap })
          .computedStyleMap === "function"
          ? (
              el as Element & { computedStyleMap: () => StylePropertyMap }
            ).computedStyleMap()
          : null;
      var svgViewport = el instanceof SVGSVGElement ? el : el.closest("svg");
      var hasSvgViewBox = Boolean(svgViewport?.hasAttribute("viewBox"));
      var outerSvgViewport = svgViewport?.parentElement?.closest("svg");
      var isSvgViewBoxRoot = Boolean(
        el instanceof SVGSVGElement &&
        hasSvgViewBox &&
        !outerSvgViewport?.hasAttribute("viewBox"),
      );
      var isSvgViewBoxContent = isInsideScaledSvgViewBox(el);
      var borderWidthProperties = [
        "border-top-width",
        "border-right-width",
        "border-bottom-width",
        "border-left-width",
      ];
      if (isSvgViewBoxRoot) {
        ["font-size", "line-height", "letter-spacing", "word-spacing"].forEach(
          function (property) {
            var value = rawKScaleValue(el, property, typedStyleMap);
            if (!value) return;
            preservedStyles[property] = value;
            originalStyles[property] = {
              value: el.style.getPropertyValue(property),
              priority: el.style.getPropertyPriority(property),
            };
          },
        );
      }
      for (
        var propertyIndex = 0;
        propertyIndex < KSCALE_LENGTH_PROPERTIES.length;
        propertyIndex += 1
      ) {
        var property = KSCALE_LENGTH_PROPERTIES[propertyIndex];
        if (isSvgViewBoxContent) continue;
        if (
          isSvgViewBoxRoot &&
          (property === "font-size" ||
            property === "line-height" ||
            property === "letter-spacing" ||
            property === "word-spacing")
        ) {
          continue;
        }
        var authoredValue = typedKScaleValue(el, property, typedStyleMap);
        if (!authoredValue) continue;
        if (
          isRoot &&
          (property === "width" ||
            property === "height" ||
            property === "left" ||
            property === "right" ||
            property === "top" ||
            property === "bottom" ||
            (!includeRootFontSize && property === "font-size"))
        ) {
          continue;
        }
        if (isFlexibleMainAxisFill(el, property)) continue;
        var lengthTokens = authoredValue.match(/[-+]?\d*\.?\d+px\b/gi) || [];
        if (
          lengthTokens.length === 0 ||
          lengthTokens.every(function (token) {
            return Number.parseFloat(token) === 0;
          })
        ) {
          continue;
        }
        originalStyles[property] = {
          value: el.style.getPropertyValue(property),
          priority: el.style.getPropertyPriority(property),
        };
        scaledStyles[property] = authoredValue;
      }

      if (!isSvgViewBoxContent) {
        var borderWidthValues = borderWidthProperties.map(function (property) {
          return typedKScaleValue(el, property, typedStyleMap);
        });
        if (
          borderWidthValues.every(function (value) {
            return /^[-+]?\d*\.?\d+px$/i.test(value);
          }) &&
          borderWidthValues.some(function (value) {
            return Number.parseFloat(value) !== 0;
          })
        ) {
          originalStyles["border-width"] = {
            value: el.style.getPropertyValue("border-width"),
            priority: el.style.getPropertyPriority("border-width"),
          };
          scaledStyles["border-width"] = borderWidthValues.join(" ");
        }
      }

      if (
        Object.keys(scaledStyles).length === 0 &&
        Object.keys(preservedStyles).length === 0
      ) {
        continue;
      }
      rememberLiveVisualEditOriginalStyles(el);
      targets.push({
        el: el,
        selector: getSelector(el),
        sourceId: getSourceId(el) || undefined,
        originalStyles: originalStyles,
        scaledStyles: scaledStyles,
        preservedStyles: preservedStyles,
      });
    }
    return targets;
  }

  function applyKScaleStyleTargets(targets, factor: number) {
    targets.forEach(function (target) {
      Object.keys(target.preservedStyles).forEach(function (property) {
        var original = target.originalStyles[property];
        target.el.style.setProperty(
          property,
          target.preservedStyles[property],
          original ? original.priority : "",
        );
      });
      Object.keys(target.scaledStyles).forEach(function (property) {
        var scaledValue = scaleKScaleLengthValue(
          target.scaledStyles[property],
          factor,
        );
        if (scaledValue === target.scaledStyles[property]) return;
        target.el.style.setProperty(
          property,
          scaledValue,
          target.originalStyles[property]
            ? target.originalStyles[property].priority
            : "",
        );
      });
    });
  }

  function restoreKScaleStyleTargets(targets) {
    targets.forEach(function (target) {
      Object.keys(target.originalStyles).forEach(function (property) {
        var original = target.originalStyles[property];
        if (original.value) {
          target.el.style.setProperty(
            property,
            original.value,
            original.priority,
          );
        } else {
          target.el.style.removeProperty(property);
        }
      });
    });
  }

  function kScaleStyleChanges(targets, factor: number) {
    return targets.flatMap(function (target) {
      var styles: Record<string, string> = {};
      Object.keys(target.scaledStyles).forEach(function (property) {
        var scaledValue = scaleKScaleLengthValue(
          target.scaledStyles[property],
          factor,
        );
        if (scaledValue !== target.scaledStyles[property])
          styles[property] = scaledValue;
      });
      Object.keys(target.preservedStyles).forEach(function (property) {
        styles[property] = target.preservedStyles[property];
      });
      if (Object.keys(styles).length === 0) return [];
      return [
        {
          selector: target.selector,
          sourceId: target.sourceId,
          styles: styles,
          originalStyles: Object.keys(target.originalStyles).reduce(
            function (result, property) {
              result[property] = target.originalStyles[property].value;
              return result;
            },
            {} as Record<string, string>,
          ),
          preserveSelection: true,
        },
      ];
    });
  }

  var externalKScaleTargets = null as ReturnType<
    typeof collectKScaleStyleTargets
  > | null;
  (window as any).__designCanvasScaleContents = function (
    factor: number,
    phase: "begin" | "preview" | "commit" | "cancel" | "accept",
  ) {
    if (phase === "begin") {
      externalKScaleTargets = document.body
        ? collectKScaleStyleTargets(document.body, true)
        : [];
      return [];
    }
    if (!externalKScaleTargets) {
      externalKScaleTargets = document.body
        ? collectKScaleStyleTargets(document.body, true)
        : [];
    }
    if (phase === "cancel") {
      restoreKScaleStyleTargets(externalKScaleTargets);
      externalKScaleTargets = null;
      return [];
    }
    if (phase === "accept") {
      externalKScaleTargets = null;
      return [];
    }
    applyKScaleStyleTargets(externalKScaleTargets, factor);
    if (phase === "commit") {
      var changes = kScaleStyleChanges(externalKScaleTargets, factor);
      return changes;
    }
    return [];
  };

  function scaleSelectionByFactor(
    factor: number,
    anchorX: number,
    anchorY: number,
  ): void {
    if (readOnly || !selectedEl || isLayerInteractionBlocked(selectedEl))
      return;
    if (!(factor > 0) || factor === 1) return;
    var el = selectedEl as HTMLElement;
    refreshLiveVisualEditOriginalStyles(el);
    ensurePositionable(el);
    var cs = window.getComputedStyle(el);
    var width = readPx(cs.width);
    var height = readPx(cs.height);
    var nextWidth = width * factor;
    var nextHeight = height * factor;
    var styles: Record<string, string> = {
      left:
        quantizeToLayoutGrid(
          readPx(el.style.left || cs.left) - (nextWidth - width) * anchorX,
        ) + "px",
      top:
        quantizeToLayoutGrid(
          readPx(el.style.top || cs.top) - (nextHeight - height) * anchorY,
        ) + "px",
      width: quantizeToLayoutGrid(nextWidth) + "px",
      height: quantizeToLayoutGrid(nextHeight) + "px",
    };
    if (el.style.position) styles.position = el.style.position;
    var fontSize = readPx(el.style.fontSize || cs.fontSize);
    var svgViewBoxScalesFont =
      (el instanceof SVGSVGElement && el.hasAttribute("viewBox")) ||
      isInsideScaledSvgViewBox(el);
    if (fontSize > 0 && !svgViewBoxScalesFont) {
      styles.fontSize =
        Math.max(1, Math.round(fontSize * factor * 100) / 100) + "px";
    }
    var targets = collectKScaleStyleTargets(el, false);
    Object.keys(styles).forEach(function (property) {
      (el.style as any)[property] = styles[property];
    });
    applyKScaleStyleTargets(targets, factor);
    var changes = kScaleStyleChanges(targets, factor);
    var rootSelector = getSelector(el);
    var rootChange = changes.find(function (change) {
      return change.selector === rootSelector;
    });
    if (rootChange) {
      rootChange.styles = Object.assign({}, rootChange.styles, styles);
      rootChange.originalStyles = Object.assign(
        {},
        rootChange.originalStyles || {},
        originalInlineStylesForPatch(el, styles),
      );
    } else {
      changes.unshift({
        selector: rootSelector,
        sourceId: getSourceId(el) || undefined,
        styles: styles,
        originalStyles: originalInlineStylesForPatch(el, styles),
        preserveSelection: true,
      });
    }
    (window.parent as Window).postMessage(
      { type: "visual-style-batch-change", changes: changes },
      "*",
    );
    recordSourceOwnership(el);
    targets.forEach(function (target) {
      recordSourceOwnership(target.el);
    });
    releaseLiveVisualEditOriginalStyles(el);
    refreshOverlays();
  }

  function startResize(handle, e) {
    if (readOnly) return;
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    var events = dragEventNames(e);
    var resizeEl = selectedEl;
    var originalInlinePosition = resizeEl.style.position;
    var originalInlineLeft = resizeEl.style.left;
    var originalInlineTop = resizeEl.style.top;
    var originalInlineWidth = resizeEl.style.width;
    var originalInlineHeight = resizeEl.style.height;
    var originalInlineFontSize = resizeEl.style.fontSize;
    var originalInlineTransform = resizeEl.style.transform;
    var originalInlineScale = resizeEl.style.scale;
    refreshLiveVisualEditOriginalStyles(resizeEl);
    ensurePositionable(resizeEl);
    var cs = window.getComputedStyle(resizeEl);
    var hasInlineTransform =
      !!originalInlineTransform && originalInlineTransform !== "none";
    var computedScale = cs.scale || cs.getPropertyValue("scale") || "none";
    var flipTransformBase = hasInlineTransform
      ? originalInlineTransform
      : cs.transform;
    var mirrorScaleBase =
      originalInlineScale && originalInlineScale !== "none"
        ? originalInlineScale
        : computedScale;
    var mirrorUsesScale = !hasInlineTransform;
    var originW = readPx(cs.width);
    var originH = readPx(cs.height);
    var originFontSize = readPx(resizeEl.style.fontSize || cs.fontSize);
    var svgViewBoxScalesFont =
      (resizeEl instanceof SVGSVGElement && resizeEl.hasAttribute("viewBox")) ||
      isInsideScaledSvgViewBox(resizeEl);
    var origin = {
      left: readPx(resizeEl.style.left || cs.left),
      top: readPx(resizeEl.style.top || cs.top),
      width: originW,
      height: originH,
      ratio: originW / Math.max(1, originH),
    };
    var startX = e.clientX;
    var startY = e.clientY;
    var resizeTheta = (currentRotation(resizeEl) * Math.PI) / 180;
    var resizeGestureViewport = bridgeGestureViewport();
    var RESIZE_DRAG_THRESHOLD = 3;
    var bridgeResizeController = createCanvasGestureController({
      capabilities: { move: true, resize: true },
      drag: { threshold: RESIZE_DRAG_THRESHOLD, duplicateModifier: "alt" },
      minSize: 8,
      adapter: {
        preview: function () {
          return { handled: true };
        },
        commit: function () {
          return { handled: true };
        },
        cancel: function () {
          return { handled: true };
        },
      },
    });
    bridgeResizeController.pointerDown({
      kind: "resize",
      objectIds: [getSelector(resizeEl)],
      pointer: bridgeGesturePointer(e),
      viewport: resizeGestureViewport,
      canvas: {
        width: resizeGestureViewport.width,
        height: resizeGestureViewport.height,
      },
      handle: handle,
      rect: {
        x: origin.left,
        y: origin.top,
        width: origin.width,
        height: origin.height,
      },
    });
    var widthTouched = false;
    var heightTouched = false;
    var transformTouched = false;
    var scaleTouched = false;
    var scaledStyleTargetsCache: ReturnType<
      typeof collectKScaleStyleTargets
    > | null = null;
    function scaledStyleTargets() {
      if (!scaledStyleTargetsCache) {
        scaledStyleTargetsCache = collectKScaleStyleTargets(resizeEl, false);
      }
      return scaledStyleTargetsCache;
    }
    function nextRect(ev) {
      var screenDx = ev.clientX - startX;
      var screenDy = ev.clientY - startY;
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
      if (ev.shiftKey) {
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
        if (handle === "e" || handle === "w") {
          height = width / origin.ratio;
        } else if (handle === "n" || handle === "s") {
          width = height * origin.ratio;
        } else if (handle.length === 2) {
          if (Math.abs(dx) > Math.abs(dy)) height = width / origin.ratio;
          else width = height * origin.ratio;
        }
      }
      var anchorLeft =
        handle.indexOf("w") !== -1 ? origin.left + origin.width : origin.left;
      var anchorTop =
        handle.indexOf("n") !== -1 ? origin.top + origin.height : origin.top;
      var movingLeft =
        handle.indexOf("w") !== -1 ? anchorLeft - width : anchorLeft + width;
      var movingTop =
        handle.indexOf("n") !== -1 ? anchorTop - height : anchorTop + height;
      var widthCrossed = width < 0;
      var heightCrossed = height < 0;
      var flipX = widthCrossed;
      var flipY = heightCrossed;
      left = Math.min(anchorLeft, movingLeft);
      width = Math.max(1, Math.abs(movingLeft - anchorLeft));
      top = Math.min(anchorTop, movingTop);
      height = Math.max(1, Math.abs(movingTop - anchorTop));
      if (ev.altKey) {
        if (handle.indexOf("w") !== -1 || handle.indexOf("e") !== -1)
          left = origin.left - (width - origin.width) / 2;
        if (handle.indexOf("n") !== -1 || handle.indexOf("s") !== -1)
          top = origin.top - (height - origin.height) / 2;
      }
      var handlesWidth =
        handle.indexOf("w") !== -1 || handle.indexOf("e") !== -1;
      var handlesHeight =
        handle.indexOf("n") !== -1 || handle.indexOf("s") !== -1;
      var aspectLocked = !!(ev.shiftKey || scaleToolEnabled);
      var touchesWidth = handlesWidth || (aspectLocked && handlesHeight);
      var touchesHeight = handlesHeight || (aspectLocked && handlesWidth);
      return {
        left: left,
        top: top,
        width: width,
        height: height,
        touchesWidth: touchesWidth,
        touchesHeight: touchesHeight,
        flipX: flipX,
        flipY: flipY,
      };
    }
    function onMove(ev) {
      var controllerMove = bridgeResizeController.pointerMove(
        bridgeGesturePointer(ev),
      );
      if (controllerMove.phase !== "active") return;
      if (!resizeEl) return;
      var kScaleTargetsForMove = scaleToolEnabled ? scaledStyleTargets() : null;
      var rect = nextRect(ev);
      if (rect.touchesWidth) widthTouched = true;
      if (rect.touchesHeight) heightTouched = true;
      resizeEl.style.left = quantizeToLayoutGrid(rect.left) + "px";
      resizeEl.style.top = quantizeToLayoutGrid(rect.top) + "px";
      if (widthTouched)
        resizeEl.style.width = quantizeToLayoutGrid(rect.width) + "px";
      if (heightTouched)
        resizeEl.style.height = quantizeToLayoutGrid(rect.height) + "px";
      if (rect.flipX || rect.flipY) {
        if (mirrorUsesScale) {
          scaleTouched = true;
          resizeEl.style.scale = mergeRelativeScale(
            mirrorScaleBase,
            rect.flipX,
            rect.flipY,
          );
        } else {
          transformTouched = true;
          resizeEl.style.transform = mergeFlipIntoTransform(
            flipTransformBase,
            rect.flipX,
            rect.flipY,
          );
        }
      } else {
        if (transformTouched)
          resizeEl.style.transform = originalInlineTransform;
        if (scaleTouched) resizeEl.style.scale = originalInlineScale;
      }
      if (scaleToolEnabled) {
        var kScaleFactor = rect.width / Math.max(1, origin.width);
        if (originFontSize > 0 && !svgViewBoxScalesFont) {
          resizeEl.style.fontSize =
            Math.max(1, Math.round(originFontSize * kScaleFactor * 100) / 100) +
            "px";
        }
        applyKScaleStyleTargets(kScaleTargetsForMove || [], kScaleFactor);
      }
      showTransformBadge(
        Math.round(rect.width) + " x " + Math.round(rect.height),
        ev.clientX,
        ev.clientY,
      );
      var previewStyles: Record<string, string> = {
        position: resizeEl.style.position,
        left: resizeEl.style.left,
        top: resizeEl.style.top,
      };
      if (widthTouched) previewStyles.width = resizeEl.style.width;
      if (heightTouched) previewStyles.height = resizeEl.style.height;
      if (transformTouched) previewStyles.transform = resizeEl.style.transform;
      if (scaleTouched) previewStyles.scale = resizeEl.style.scale;
      if (scaleToolEnabled && originFontSize > 0 && !svgViewBoxScalesFont) {
        previewStyles.fontSize = resizeEl.style.fontSize;
      }
      (window.parent as Window).postMessage(
        {
          type: "visual-style-change",
          phase: "preview",
          selector: getSelector(resizeEl),
          styles: previewStyles,
          payload: getElementInfo(resizeEl),
        },
        "*",
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
      bridgeResizeController.cancel();
      cleanupResizeDrag();
      hideTransformBadge();
      if (resizeEl && document.documentElement.contains(resizeEl)) {
        resizeEl.style.position = originalInlinePosition;
        resizeEl.style.left = originalInlineLeft;
        resizeEl.style.top = originalInlineTop;
        resizeEl.style.width = originalInlineWidth;
        resizeEl.style.height = originalInlineHeight;
        resizeEl.style.fontSize = originalInlineFontSize;
        resizeEl.style.transform = originalInlineTransform;
        resizeEl.style.scale = originalInlineScale;
        restoreKScaleStyleTargets(scaledStyleTargetsCache || []);
        selectedEl = resizeEl;
        positionOverlay(selectionOverlay, selectedEl);
        var restoredComputed = window.getComputedStyle(resizeEl);
        var restoredStyles: Record<string, string> = {
          position: restoredComputed.position,
          left: restoredComputed.left,
          top: restoredComputed.top,
          width: restoredComputed.width,
          height: restoredComputed.height,
          borderWidth: restoredComputed.borderWidth,
          fontSize: restoredComputed.fontSize,
        };
        if (transformTouched)
          restoredStyles.transform = originalInlineTransform;
        if (scaleTouched) restoredStyles.scale = originalInlineScale;
        (window.parent as Window).postMessage(
          {
            type: "visual-style-change",
            phase: "preview",
            selector: getSelector(resizeEl),
            styles: restoredStyles,
            payload: getElementInfo(resizeEl),
          },
          "*",
        );
      }
      releaseLiveVisualEditOriginalStyles(resizeEl);
      suppressNextShieldClickBriefly();
      refreshOverlays();
      return true;
    }
    function onResizeKeyDown(ev) {
      if (ev.key !== "Escape") return;
      stopNativeInteraction(ev);
      cancelResizeDrag();
    }
    function onUp(ev) {
      var controllerEnd = bridgeResizeController.pointerUp(
        bridgeGesturePointer(ev),
      );
      if (!controllerEnd.committed) {
        cleanupResizeDrag();
        hideTransformBadge();
        resizeEl.style.position = originalInlinePosition;
        resizeEl.style.left = originalInlineLeft;
        resizeEl.style.top = originalInlineTop;
        releaseLiveVisualEditOriginalStyles(resizeEl);
        return;
      }
      cleanupResizeDrag();
      hideTransformBadge();
      if (!resizeEl) return;
      var styles: Record<string, string> = {};
      if (resizeEl.style.position) styles.position = resizeEl.style.position;
      if (resizeEl.style.left) styles.left = resizeEl.style.left;
      if (resizeEl.style.top) styles.top = resizeEl.style.top;
      if (widthTouched) styles.width = resizeEl.style.width;
      if (heightTouched) styles.height = resizeEl.style.height;
      if (
        transformTouched &&
        resizeEl.style.transform !== originalInlineTransform
      ) {
        styles.transform = resizeEl.style.transform;
      }
      if (scaleTouched && resizeEl.style.scale !== originalInlineScale) {
        styles.scale = resizeEl.style.scale;
      }
      if (scaleToolEnabled && originFontSize > 0 && !svgViewBoxScalesFont) {
        styles.fontSize = resizeEl.style.fontSize;
      }
      if (scaleToolEnabled) {
        var finalScaleFactor =
          readPx(
            resizeEl.style.width || window.getComputedStyle(resizeEl).width,
          ) / Math.max(1, origin.width);
        var changes = kScaleStyleChanges(
          scaledStyleTargetsCache || [],
          finalScaleFactor,
        );
        var rootSelector = getSelector(resizeEl);
        var rootChange = changes.find(function (change) {
          return change.selector === rootSelector;
        });
        if (rootChange) {
          rootChange.styles = Object.assign({}, rootChange.styles, styles);
          rootChange.originalStyles = Object.assign(
            {},
            rootChange.originalStyles || {},
            originalInlineStylesForPatch(resizeEl, styles),
          );
        } else {
          changes.unshift({
            selector: rootSelector,
            sourceId: getSourceId(resizeEl) || undefined,
            styles: styles,
            originalStyles: originalInlineStylesForPatch(resizeEl, styles),
            preserveSelection: true,
          });
        }
        (window.parent as Window).postMessage(
          { type: "visual-style-batch-change", changes: changes },
          "*",
        );
      } else {
        (window.parent as Window).postMessage(
          {
            type: "visual-style-change",
            phase: "commit",
            selector: getSelector(resizeEl),
            styles: styles,
            originalStyles: originalInlineStylesForPatch(resizeEl, styles),
            payload: getElementInfo(resizeEl),
          },
          "*",
        );
      }
      recordSourceOwnership(resizeEl);
      if (scaleToolEnabled) {
        (scaledStyleTargetsCache || []).forEach(function (target) {
          recordSourceOwnership(target.el);
        });
      }
      releaseLiveVisualEditOriginalStyles(resizeEl);
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onResizeKeyDown, true);
    setActiveDragCancel(cancelResizeDrag);
  }

  function startGroupResize(handle, e) {
    if (readOnly) return;
    var members = collectSelectionMembers();
    if (members.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    var events = dragEventNames(e);
    var groupLeft = Infinity;
    var groupTop = Infinity;
    var groupRight = -Infinity;
    var groupBottom = -Infinity;
    var memberStates = members.map(function (member) {
      var el = member as HTMLElement;
      var snapshot = {
        el: el,
        originalInlinePosition: el.style.position,
        originalInlineLeft: el.style.left,
        originalInlineTop: el.style.top,
        originalInlineWidth: el.style.width,
        originalInlineHeight: el.style.height,
        originLeft: 0,
        originTop: 0,
        originWidth: 0,
        originHeight: 0,
        originCenterX: 0,
        originCenterY: 0,
      };
      rememberLiveVisualEditOriginalStyles(el);
      ensurePositionable(el);
      var cs = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      groupLeft = Math.min(groupLeft, rect.left);
      groupTop = Math.min(groupTop, rect.top);
      groupRight = Math.max(groupRight, rect.right);
      groupBottom = Math.max(groupBottom, rect.bottom);
      snapshot.originLeft = readPx(el.style.left || cs.left);
      snapshot.originTop = readPx(el.style.top || cs.top);
      snapshot.originWidth = readPx(cs.width);
      snapshot.originHeight = readPx(cs.height);
      snapshot.originCenterX = rect.left + rect.width / 2;
      snapshot.originCenterY = rect.top + rect.height / 2;
      return snapshot;
    });
    var groupWidth = Math.max(1, groupRight - groupLeft);
    var groupHeight = Math.max(1, groupBottom - groupTop);
    var anchorX = handle.indexOf("w") !== -1 ? groupRight : groupLeft;
    var anchorY = handle.indexOf("n") !== -1 ? groupBottom : groupTop;
    var minMemberWidth = Math.max(
      1,
      Math.min.apply(
        null,
        memberStates.map(function (state) {
          return Math.max(1, state.originWidth);
        }),
      ),
    );
    var minMemberHeight = Math.max(
      1,
      Math.min.apply(
        null,
        memberStates.map(function (state) {
          return Math.max(1, state.originHeight);
        }),
      ),
    );
    var minFactorX = 8 / minMemberWidth;
    var minFactorY = 8 / minMemberHeight;
    var startX = e.clientX;
    var startY = e.clientY;
    var groupGestureViewport = bridgeGestureViewport();
    var bridgeGroupResizeController = createCanvasGestureController({
      capabilities: { move: true, resize: true },
      drag: { threshold: 3, duplicateModifier: "alt" },
      minSize: 8,
      adapter: {
        preview: function () {
          return { handled: true };
        },
        commit: function () {
          return { handled: true };
        },
        cancel: function () {
          return { handled: true };
        },
      },
    });
    bridgeGroupResizeController.pointerDown({
      kind: "resize",
      objectIds: memberStates.map(function (state) {
        return getSelector(state.el);
      }),
      pointer: bridgeGesturePointer(e),
      viewport: groupGestureViewport,
      canvas: {
        width: groupGestureViewport.width,
        height: groupGestureViewport.height,
      },
      handle: handle,
      rect: {
        x: groupLeft,
        y: groupTop,
        width: groupWidth,
        height: groupHeight,
      },
    });

    function groupFactors(ev) {
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      var nextWidth =
        handle.indexOf("e") !== -1 ? groupWidth + dx : groupWidth - dx;
      var nextHeight =
        handle.indexOf("s") !== -1 ? groupHeight + dy : groupHeight - dy;
      var factorX = nextWidth / groupWidth;
      var factorY = nextHeight / groupHeight;
      if (ev.shiftKey || scaleToolEnabled) {
        var uniform = Math.max(
          Math.max(minFactorX, minFactorY),
          Math.abs(dx) > Math.abs(dy) ? factorX : factorY,
        );
        return { x: uniform, y: uniform };
      }
      return {
        x: Math.max(minFactorX, factorX),
        y: Math.max(minFactorY, factorY),
      };
    }

    var groupKScaleStyleTargetsCache: ReturnType<
      typeof collectKScaleStyleTargets
    > | null = null;
    var lastKScaleFactor = 1;
    function groupKScaleStyleTargets() {
      if (!groupKScaleStyleTargetsCache) {
        var targetsByElement = new Map();
        memberStates.forEach(function (state) {
          collectKScaleStyleTargets(state.el, true).forEach(function (target) {
            targetsByElement.set(target.el, target);
          });
        });
        groupKScaleStyleTargetsCache = Array.from(targetsByElement.values());
      }
      return groupKScaleStyleTargetsCache;
    }

    function onMove(ev) {
      var controllerMove = bridgeGroupResizeController.pointerMove(
        bridgeGesturePointer(ev),
      );
      if (controllerMove.phase !== "active") return;
      var kScaleTargetsForMove = scaleToolEnabled
        ? groupKScaleStyleTargets()
        : null;
      var factor = groupFactors(ev);
      if (kScaleTargetsForMove) lastKScaleFactor = factor.x;
      memberStates.forEach(function (state) {
        var nextCenterX = anchorX + (state.originCenterX - anchorX) * factor.x;
        var nextCenterY = anchorY + (state.originCenterY - anchorY) * factor.y;
        var nextWidth = state.originWidth * factor.x;
        var nextHeight = state.originHeight * factor.y;
        var nextLeft =
          state.originLeft +
          (nextCenterX - state.originCenterX) -
          (nextWidth - state.originWidth) / 2;
        var nextTop =
          state.originTop +
          (nextCenterY - state.originCenterY) -
          (nextHeight - state.originHeight) / 2;
        state.el.style.left =
          (scaleToolEnabled ? nextLeft : Math.round(nextLeft)) + "px";
        state.el.style.top =
          (scaleToolEnabled ? nextTop : Math.round(nextTop)) + "px";
        state.el.style.width =
          (scaleToolEnabled ? nextWidth : Math.round(nextWidth)) + "px";
        state.el.style.height =
          (scaleToolEnabled ? nextHeight : Math.round(nextHeight)) + "px";
      });
      if (kScaleTargetsForMove) {
        applyKScaleStyleTargets(kScaleTargetsForMove, factor.x);
      }
      showTransformBadge(
        Math.round(groupWidth * factor.x) +
          " x " +
          Math.round(groupHeight * factor.y),
        ev.clientX,
        ev.clientY,
      );
      refreshOverlays();
    }

    function cleanupGroupResizeDrag() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      document.removeEventListener("keydown", onGroupResizeKeyDown, true);
      clearActiveDragCancel(cancelGroupResizeDrag);
    }

    function cancelGroupResizeDrag() {
      bridgeGroupResizeController.cancel();
      cleanupGroupResizeDrag();
      hideTransformBadge();
      memberStates.forEach(function (state) {
        if (!document.documentElement.contains(state.el)) return;
        state.el.style.position = state.originalInlinePosition;
        state.el.style.left = state.originalInlineLeft;
        state.el.style.top = state.originalInlineTop;
        state.el.style.width = state.originalInlineWidth;
        state.el.style.height = state.originalInlineHeight;
      });
      restoreKScaleStyleTargets(groupKScaleStyleTargetsCache || []);
      suppressNextShieldClickBriefly();
      refreshOverlays();
      return true;
    }

    function onGroupResizeKeyDown(ev) {
      if (ev.key !== "Escape") return;
      stopNativeInteraction(ev);
      cancelGroupResizeDrag();
    }

    function onUp(ev) {
      var controllerEnd = bridgeGroupResizeController.pointerUp(
        bridgeGesturePointer(ev),
      );
      cleanupGroupResizeDrag();
      hideTransformBadge();
      if (!controllerEnd.committed) return;
      var rootStylesForMember = function (state, omitEmpty) {
        var styles: Record<string, string> = {
          position: state.el.style.position,
          left: state.el.style.left,
          top: state.el.style.top,
          width: state.el.style.width,
          height: state.el.style.height,
        };
        if (omitEmpty) {
          Object.keys(styles).forEach(function (property) {
            if (styles[property] === "") delete styles[property];
          });
        }
        return styles;
      };
      if (groupKScaleStyleTargetsCache) {
        var changes = kScaleStyleChanges(
          groupKScaleStyleTargetsCache,
          lastKScaleFactor,
        );
        memberStates.forEach(function (state) {
          var selector = getSelector(state.el);
          var styles = rootStylesForMember(state, true);
          var originalStyles = originalInlineStylesForPatch(state.el, styles);
          var rootChange = changes.find(function (change) {
            return change.selector === selector;
          });
          if (rootChange) {
            rootChange.styles = Object.assign({}, rootChange.styles, styles);
            rootChange.originalStyles = Object.assign(
              {},
              rootChange.originalStyles || {},
              originalStyles,
            );
          } else {
            changes.unshift({
              selector: selector,
              sourceId: getSourceId(state.el) || undefined,
              styles: styles,
              originalStyles: originalStyles,
              preserveSelection: true,
            });
          }
        });
        (window.parent as Window).postMessage(
          { type: "visual-style-batch-change", changes: changes },
          "*",
        );
        memberStates.forEach(function (state) {
          recordSourceOwnership(state.el);
        });
        groupKScaleStyleTargetsCache.forEach(function (target) {
          recordSourceOwnership(target.el);
        });
      } else {
        memberStates.forEach(function (state) {
          var styles = rootStylesForMember(state, false);
          (window.parent as Window).postMessage(
            {
              type: "visual-style-change",
              selector: getSelector(state.el),
              styles: styles,
              originalStyles: originalInlineStylesForPatch(state.el, styles),
              payload: getElementInfo(state.el),
            },
            "*",
          );
          recordSourceOwnership(state.el);
        });
      }
    }

    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onGroupResizeKeyDown, true);
    setActiveDragCancel(cancelGroupResizeDrag);
  }

  function startRotate(e) {
    if (readOnly) return;
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    var events = dragEventNames(e);
    var rect = selectedEl.getBoundingClientRect();
    var center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    var originAngle =
      (Math.atan2(e.clientY - center.y, e.clientX - center.x) * 180) / Math.PI;
    var originRotation = currentRotation(selectedEl);
    var rotateEl = selectedEl;
    var originalInlineTransform = rotateEl.style.transform;
    var originalComputedTransform = window.getComputedStyle(rotateEl).transform;
    var baseTransform =
      originalInlineTransform && originalInlineTransform !== "none"
        ? originalInlineTransform
        : originalComputedTransform;
    function onMove(ev) {
      if (!rotateEl) return;
      var pointerAngle =
        (Math.atan2(ev.clientY - center.y, ev.clientX - center.x) * 180) /
        Math.PI;
      var next = originRotation + pointerAngle - originAngle;
      if (ev.shiftKey) next = Math.round(next / 15) * 15;
      next = Math.round(next);
      rotateEl.style.transform = mergeAbsoluteRotation(baseTransform, next);
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
      var styles = { transform: rotateEl.style.transform };
      (window.parent as Window).postMessage(
        {
          type: "visual-style-change",
          selector: getSelector(rotateEl),
          styles: styles,
          originalStyles: originalInlineStylesForPatch(rotateEl, styles),
          payload: getElementInfo(rotateEl),
        },
        "*",
      );
      recordSourceOwnership(rotateEl);
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onRotateKeyDown, true);
    setActiveDragCancel(cancelRotateDrag);
  }

  function startRadiusDrag(corner, e) {
    if (readOnly) return;
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    var events = dragEventNames(e);
    var radiusEl = selectedEl;
    var cs = window.getComputedStyle(radiusEl);
    var cornerProperty =
      CORNER_RADIUS_PROPERTY_BY_HANDLE[corner] || "borderTopLeftRadius";
    refreshLiveVisualEditOriginalStyles(radiusEl);
    var borderBox = borderBoxDimensions(cs);
    var elWidthPx = borderBox.width;
    var elHeightPx = borderBox.height;
    var authoredRadiusValue = radiusEl.style[cornerProperty];
    var originRadius = resolveCornerRadiusXY(
      isDirectCornerRadiusValue(authoredRadiusValue)
        ? authoredRadiusValue
        : cs[cornerProperty],
      elWidthPx,
      elHeightPx,
    );
    var maxRadius = radiusDragMaximums(
      corner,
      cornerRadiusMap(cs, elWidthPx, elHeightPx),
      elWidthPx,
      elHeightPx,
    );
    var maxRadiusX = maxRadius.x;
    var maxRadiusY = maxRadius.y;
    var originalRadiusValue = radiusEl.style[cornerProperty];
    var startX = e.clientX;
    var startY = e.clientY;
    var radiusMoved = false;
    var signX = corner.indexOf("w") !== -1 ? 1 : -1;
    var signY = corner.indexOf("n") !== -1 ? 1 : -1;
    function applyRadius(nextX, nextY) {
      var x = Math.max(0, Math.min(maxRadiusX, Math.round(nextX)));
      var y = Math.max(0, Math.min(maxRadiusY, Math.round(nextY)));
      radiusEl.style[cornerProperty] =
        x === y ? x + "px" : x + "px " + y + "px";
    }
    function onMove(ev) {
      if (!radiusEl) return;
      var screenDx = ev.clientX - startX;
      var screenDy = ev.clientY - startY;
      if (screenDx === 0 && screenDy === 0) return;
      radiusMoved = true;
      var local = radiusLocalDelta(radiusEl, screenDx, screenDy);
      applyRadius(
        originRadius.x + local.x * signX,
        originRadius.y + local.y * signY,
      );
      applySelectionHandleHitGeometry(radiusEl);
      refreshOverlays();
    }
    function cleanupRadiusDrag() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      document.removeEventListener("keydown", onRadiusKeyDown, true);
      clearActiveDragCancel(cancelRadiusDrag);
    }
    function cancelRadiusDrag() {
      cleanupRadiusDrag();
      if (radiusEl && document.documentElement.contains(radiusEl)) {
        radiusEl.style[cornerProperty] = originalRadiusValue;
        selectedEl = radiusEl;
        applySelectionHandleHitGeometry(radiusEl);
        refreshOverlays();
      }
      releaseLiveVisualEditOriginalStyles(radiusEl);
      suppressNextShieldClickBriefly();
      return true;
    }
    function onRadiusKeyDown(ev) {
      if (ev.key !== "Escape") return;
      stopNativeInteraction(ev);
      cancelRadiusDrag();
    }
    function onUp() {
      cleanupRadiusDrag();
      if (!radiusEl) return;
      if (!radiusMoved) {
        releaseLiveVisualEditOriginalStyles(radiusEl);
        return;
      }
      var finalRadius = resolveCornerRadiusXY(
        radiusEl.style[cornerProperty] || cs[cornerProperty],
        elWidthPx,
        elHeightPx,
      );
      var radiusChanged =
        Math.abs(finalRadius.x - originRadius.x) > 0.5 ||
        Math.abs(finalRadius.y - originRadius.y) > 0.5;
      if (!radiusChanged) {
        radiusEl.style[cornerProperty] = originalRadiusValue;
        applySelectionHandleHitGeometry(radiusEl);
        refreshOverlays();
        releaseLiveVisualEditOriginalStyles(radiusEl);
        return;
      }
      var styles = {};
      styles[cornerProperty] = radiusEl.style[cornerProperty];
      (window.parent as Window).postMessage(
        {
          type: "visual-style-change",
          selector: getSelector(radiusEl),
          styles: styles,
          originalStyles: originalInlineStylesForPatch(radiusEl, styles),
          payload: getElementInfo(radiusEl),
        },
        "*",
      );
      recordSourceOwnership(radiusEl);
      releaseLiveVisualEditOriginalStyles(radiusEl);
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
    document.addEventListener("keydown", onRadiusKeyDown, true);
    setActiveDragCancel(cancelRadiusDrag);
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

  function dragTargetForPointerDown(args) {
    var selectedEl = args.selectedEl;
    var hitEl = args.hitEl;
    var hitRaw = args.hitRaw || hitEl;
    var selectedAlive = !!args.selectedAlive;
    if (
      selectedEl &&
      selectedAlive &&
      selectedEl.contains &&
      selectedEl.contains(hitRaw)
    ) {
      return selectedEl;
    }
    if (args.preferSelected && selectedEl && selectedAlive) {
      var r = args.selectedRect;
      var p = args.point;
      if (
        r &&
        p &&
        r.width > 0 &&
        r.height > 0 &&
        p.x >= r.left &&
        p.x <= r.right &&
        p.y >= r.top &&
        p.y <= r.bottom
      ) {
        return selectedEl;
      }
    }
    return hitEl;
  }

  function nextStackCandidate(candidateKeys, currentKey) {
    if (!candidateKeys || candidateKeys.length === 0) return null;
    var idx = candidateKeys.indexOf(currentKey);
    if (idx === -1) return null;
    return candidateKeys[(idx + 1) % candidateKeys.length];
  }

  function isContainerBackgroundHit(
    el: Element | null,
    rawHit: Element | null = null,
  ): boolean {
    if (!el || el === selectedEl) return false;
    if (rawHit && rawHit !== el) return false;
    if (isDocumentRootElement(el)) return false;
    if (outermostSvgAncestor(el) === el) return false;
    if (!isContainerDropTarget(el)) return false;
    var child = el.firstElementChild;
    if (
      child &&
      child === el.lastElementChild &&
      child.hasAttribute &&
      child.hasAttribute("data-an-text")
    ) {
      return false;
    }
    return Boolean(child);
  }

  var crossScreenClaimedByHost = false;
  var lastPointerDownTimestamp = 0;

  function beginPotentialShieldDrag(e) {
    if (readOnly) return;
    if (e.type === "mousedown" && Date.now() - lastPointerDownTimestamp < 100) {
      return;
    }
    if (e.type === "pointerdown") lastPointerDownTimestamp = Date.now();
    if (
      activeTextEditEl &&
      isTextEditElConnected() &&
      e.target &&
      activeTextEditEl.contains(e.target)
    ) {
      return;
    }
    if (activeTextEditEl && isTextEditElConnected()) {
      var textEditToFinish = activeTextEditEl;
      if (finishActiveTextEdit) finishActiveTextEdit(true);
      textEditToFinish.blur();
    }
    stopNativeInteraction(e);
    clearGridProjectionCaches();
    // the same value so async postMessage delivery cannot win the race.
    hostIgnoreAutoLayoutAtPointerDown = false;
    pendingMoveCommitRevert = null;
    if (e.button !== 0) return;
    if (activeTextEditEl && !exitStaleTextEditSession()) return;
    var events = dragEventNames(e);
    var hit = elementFromEditorPoint(e.clientX, e.clientY);
    var hitTarget = selectionTargetForHit(hit);
    if (
      !hit ||
      hit === document.body ||
      hit === document.documentElement ||
      isBoardRootMarqueeSurface(hitTarget) ||
      isContainerBackgroundHit(hitTarget, hit)
    ) {
      beginMarqueeSelection(e);
      return;
    }
    var selectedAlive =
      !!selectedEl && document.documentElement.contains(selectedEl);
    var selectedRect =
      selectedAlive && selectedEl.getBoundingClientRect
        ? selectedEl.getBoundingClientRect()
        : null;
    var dragTarget = dragTargetForPointerDown({
      selectedEl: selectedEl,
      selectedAlive: selectedAlive,
      selectedRect: selectedRect,
      hitEl: hitTarget,
      hitRaw: hit,
      point: { x: e.clientX, y: e.clientY },
      preferSelected: selectedLayerDragPriorityEnabled,
    });
    if ((window as any).__DND_DEBUG)
      dndLog("shield:down", {
        hit: getSelector(hit),
        dragTarget: getSelector(dragTarget),
        board: designCanvasBoardSurface,
        readOnly: readOnly,
        position: dragTarget
          ? window.getComputedStyle(dragTarget as Element).position
          : null,
        flowCandidate: dragTarget ? isFlowReorderCandidate(dragTarget) : null,
      });
    if (
      !dragTarget ||
      dragTarget === document.body ||
      dragTarget === document.documentElement ||
      isLayerInteractionBlocked(dragTarget)
    ) {
      dndLog("shield:reject", { reason: "no-drag-target" });
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
    var suppressCrossScreenStartForCtrlReorder =
      isIgnoreAutoLayoutChord(e) && isFlowReorderCandidate(dragTarget);
    if (!readOnly && !e.altKey && !suppressCrossScreenStartForCtrlReorder) {
      postCrossScreenDrag("start", dragTarget, e);
    }
    var startX = e.clientX;
    var startY = e.clientY;
    var didStartDrag = false;
    function selectTarget(target, ev?: MouseEvent, isClick?: boolean) {
      if (isClick) {
        var toggled = resolveShiftClickToggleOff(target, ev);
        if (toggled !== undefined) {
          postToggledSelection(toggled);
          return;
        }
      }
      var previousSelectedEl = selectedEl;
      selectedEl = target;
      positionOverlay(selectionOverlay, selectedEl);
      if (!ev?.shiftKey && passiveSelectionEls.length) {
        setPassiveSelectionElements([]);
      }
      preservePreviousSelectedElementForShiftClick(
        previousSelectedEl,
        selectedEl,
        ev,
      );
      postElementSelect(selectedEl, ev);
    }
    function onMove(ev) {
      if (readOnly) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 3) return;
      clearPendingShieldDrag();
      if (!didStartDrag)
        dndLog("shield:drag-start", { board: designCanvasBoardSurface });
      didStartDrag = true;
      var groupGestureMember = !e.altKey
        ? groupMemberForGestureTarget(dragTarget)
        : null;
      if (
        groupGestureMember &&
        collectMoveGroupMembers(groupGestureMember).length > 1
      ) {
        suppressNextShieldClickBriefly();
        startMove(ev, groupGestureMember, {
          clientX: startX,
          clientY: startY,
          ignoreAutoLayout:
            Boolean(
              (
                e as MouseEvent & {
                  __agentNativeIgnoreAutoLayout?: boolean;
                }
              ).__agentNativeIgnoreAutoLayout,
            ) || isIgnoreAutoLayoutChord(ev),
        });
        return;
      }
      selectTarget(dragTarget, ev);
      suppressNextShieldClickBriefly();
      startMove(ev, undefined, {
        clientX: startX,
        clientY: startY,
        ignoreAutoLayout:
          Boolean(
            (
              e as MouseEvent & {
                __agentNativeIgnoreAutoLayout?: boolean;
              }
            ).__agentNativeIgnoreAutoLayout,
          ) || isIgnoreAutoLayoutChord(ev),
      });
    }
    function onUp(ev) {
      clearPendingShieldDrag();
      if (didStartDrag) return;
      if (!readOnly && !e.altKey) {
        postCrossScreenDrag("cancel");
      }
      if (ev) stopNativeInteraction(ev);
      var cycledEl =
        !readOnly && (e.metaKey || e.ctrlKey) && !e.shiftKey
          ? stackCycleTarget(e.clientX, e.clientY, selectedEl)
          : null;
      var primaryClickTarget =
        !readOnly && (e.metaKey || e.ctrlKey)
          ? selectionTargetForHit(hit)
          : !designCanvasBoardSurface
            ? plainClickSelectionTarget(hit)
            : (!readOnly && !e.shiftKey
                ? clickThroughSelectionTarget(hit, ev)
                : null) || containerFirstSelectionTarget(hit);
      if (cycledEl) {
        selectTarget(cycledEl, ev, true);
      } else {
        selectTarget(primaryClickTarget || dragTarget, ev, true);
      }
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

  var selectionHandleMoveRerouted = false;
  function rerouteStaleSelectionHandleHitToMove(e): boolean {
    if (
      readOnly ||
      !selectedEl ||
      !document.documentElement.contains(selectedEl) ||
      !e ||
      e.button !== 0
    ) {
      return false;
    }
    var target = e.target as Element | null;
    var isResizeHandle = Boolean(
      target &&
      target.getAttribute &&
      (target.getAttribute("data-agent-native-edit-handle") ||
        target.getAttribute("data-agent-native-edge-handle")),
    );
    if (!isResizeHandle) return false;

    var hadSuppressedHandleTransition = selectionOverlay.hasAttribute(
      "data-agent-native-suppress-handle-transition",
    );
    if (!hadSuppressedHandleTransition) {
      selectionOverlay.setAttribute(
        "data-agent-native-suppress-handle-transition",
        "",
      );
    }
    applySelectionHandleHitGeometry(selectedEl);
    void selectionOverlay.offsetHeight;
    var refreshedTarget = document.elementFromPoint(e.clientX, e.clientY);
    var resizeHandlePosition = (
      target.getAttribute("data-agent-native-edit-handle") ||
      target.getAttribute("data-agent-native-edge-handle") ||
      ""
    ).toLowerCase();
    var selectedRect = selectedEl.getBoundingClientRect();
    var selectedTransform = window.getComputedStyle(selectedEl).transform;
    var isAxisAligned = isAxisAlignedTransform(selectedTransform);
    var isClearlyInsideMoveBand = false;
    if (
      isAxisAligned &&
      e.clientX >= selectedRect.left &&
      e.clientX <= selectedRect.right &&
      e.clientY >= selectedRect.top &&
      e.clientY <= selectedRect.bottom
    ) {
      var moveBandX = selectedRect.width * HANDLE_MAX_INWARD_FRACTION;
      var moveBandY = selectedRect.height * HANDLE_MAX_INWARD_FRACTION;
      var awayFromTop = e.clientY > selectedRect.top + moveBandY;
      var awayFromBottom = e.clientY < selectedRect.bottom - moveBandY;
      var awayFromLeft = e.clientX > selectedRect.left + moveBandX;
      var awayFromRight = e.clientX < selectedRect.right - moveBandX;
      var onTop = resizeHandlePosition.indexOf("n") !== -1;
      var onBottom = resizeHandlePosition.indexOf("s") !== -1;
      var onLeft = resizeHandlePosition.indexOf("w") !== -1;
      var onRight = resizeHandlePosition.indexOf("e") !== -1;
      isClearlyInsideMoveBand =
        (!onTop || awayFromTop) &&
        (!onBottom || awayFromBottom) &&
        (!onLeft || awayFromLeft) &&
        (!onRight || awayFromRight);
    }
    var refreshedResizeHandle = Boolean(
      refreshedTarget &&
      refreshedTarget.getAttribute &&
      (refreshedTarget.getAttribute("data-agent-native-edit-handle") ||
        refreshedTarget.getAttribute("data-agent-native-edge-handle")),
    );
    if (isClearlyInsideMoveBand) {
      selectionHandleMoveRerouted = true;
      window.setTimeout(function () {
        selectionHandleMoveRerouted = false;
      }, 0);
      beginPotentialShieldDrag(e);
      if (!hadSuppressedHandleTransition) {
        selectionOverlay.removeAttribute(
          "data-agent-native-suppress-handle-transition",
        );
      }
      return true;
    }
    if (refreshedResizeHandle) {
      if (!hadSuppressedHandleTransition) {
        selectionOverlay.removeAttribute(
          "data-agent-native-suppress-handle-transition",
        );
      }
      return false;
    }

    selectionHandleMoveRerouted = true;
    window.setTimeout(function () {
      selectionHandleMoveRerouted = false;
    }, 0);
    beginPotentialShieldDrag(e);
    if (!hadSuppressedHandleTransition) {
      selectionOverlay.removeAttribute(
        "data-agent-native-suppress-handle-transition",
      );
    }
    return true;
  }

  selectionOverlay.addEventListener(
    "pointerdown",
    function (e) {
      if (readOnly || e.button !== 0) return;
      if (rerouteStaleSelectionHandleHitToMove(e)) return;
      if (e.pointerId !== undefined && selectionOverlay.setPointerCapture) {
        selectionOverlay.setPointerCapture(e.pointerId);
      }
    },
    true,
  );

  selectionOverlay.addEventListener(
    "mousedown",
    function (e) {
      if (readOnly) return;
      if (selectionHandleMoveRerouted) {
        selectionHandleMoveRerouted = false;
        return;
      }
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
      var radiusHandle =
        e.target &&
        e.target.getAttribute &&
        e.target.getAttribute("data-agent-native-radius-handle");
      if (radiusHandle) {
        startRadiusDrag(radiusHandle, e);
        return;
      }
      startMove(e);
    },
    true,
  );

  shieldOverlay.addEventListener("pointerdown", beginPotentialShieldDrag, true);
  shieldOverlay.addEventListener("mousedown", beginPotentialShieldDrag, true);
  document.addEventListener(
    "pointerdown",
    function (e) {
      if (interactionMode) return;
      if (isOverlayElement(e.target)) return;
      if (e.button === 0) beginPotentialShieldDrag(e);
    },
    true,
  );
  document.addEventListener(
    "mousedown",
    function (e) {
      if (interactionMode) return;
      if (isOverlayElement(e.target)) return;
      if (e.button === 0) beginPotentialShieldDrag(e);
    },
    true,
  );
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
    if (interactionMode) return;
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
      if (interactionMode) return;
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
      if (interactionMode) return;
      if (!isApplePlatformBridge() && String(e.key).toLowerCase() === "s") {
        bridgeIgnoreAutoLayoutKeyPressed = true;
      }
      if (
        e.key === " " &&
        e.code === "Space" &&
        !activeTextEditEl &&
        !isEditorTypingTarget(e.target)
      ) {
        bridgeSpaceKeyPressed = true;
        if (activeDragCancel) {
          bridgeSpaceKeyConsumedByDrag = true;
          if (e.cancelable) e.preventDefault();
          return;
        }
      }
      if (!activeTextEditEl && pendingBeginTextEdit) {
        if (!(e.isComposing || e.keyCode === 229) && !e.metaKey && !e.ctrlKey) {
          var pendingKey = e.key || "";
          if (pendingKey === "Escape") {
            if (pendingBeginTextEdit.buffer) {
              pendingBeginTextEdit.commitImmediately = true;
              stopNativeInteraction(e);
              return;
            }
            var abandonedPendingNodeId = pendingBeginTextEdit.nodeId;
            cancelPendingBeginTextEdit();
            postTextEditPending(abandonedPendingNodeId, false, "escape");
            stopNativeInteraction(e);
            return;
          }
          if (pendingKey === "Backspace") {
            pendingBeginTextEdit.buffer = pendingBeginTextEdit.buffer.slice(
              0,
              -1,
            );
            stopNativeInteraction(e);
            return;
          }
          if (pendingKey.length === 1) {
            pendingBeginTextEdit.buffer += pendingKey;
            stopNativeInteraction(e);
            return;
          }
          if (
            pendingKey === "Delete" ||
            pendingKey === "Enter" ||
            pendingKey === "Tab" ||
            pendingKey.indexOf("Arrow") === 0
          ) {
            stopNativeInteraction(e);
            return;
          }
        }
      }
      if (activeTextEditEl) {
        if (exitStaleTextEditSession()) {
          stopNativeInteraction(e);
          return;
        }
        if (e.isComposing || e.keyCode === 229) return;
        var activeNow = document.activeElement;
        var focusInsideEdit = !!(
          activeNow &&
          (activeNow === activeTextEditEl ||
            activeTextEditEl.contains(activeNow))
        );
        if (e.key === "Escape") {
          if (!focusInsideEdit) {
            stopNativeInteraction(e);
            if (finishActiveTextEdit) finishActiveTextEdit(true);
            return;
          }
          return;
        }
        if (!focusInsideEdit) {
          if (!isEditorTypingTarget(activeNow)) {
            try {
              activeTextEditEl.focus();
              collapseSelectionIntoContents(activeTextEditEl);
            } catch (_err) {
              /* focus/selection APIs unavailable — key is still swallowed */
            }
            e.stopPropagation();
          }
        }
        return;
      }
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
  try {
    var parentDocument = window.parent.document as Document & {
      __agentNativeDesignModifierListeners?: WeakMap<
        Window,
        { cleanup: () => void }
      >;
    };
    var modifierListenerWindows =
      parentDocument.__agentNativeDesignModifierListeners ||
      new WeakMap<Window, { cleanup: () => void }>();
    parentDocument.__agentNativeDesignModifierListeners =
      modifierListenerWindows;
    modifierListenerWindows.get(window)?.cleanup();
    var onParentModifierKeyDown = function (e) {
      if (!isApplePlatformBridge() && String(e.key).toLowerCase() === "s") {
        bridgeIgnoreAutoLayoutKeyPressed = true;
      }
    };
    var onParentModifierKeyUp = function (e) {
      if (!isApplePlatformBridge() && String(e.key).toLowerCase() === "s") {
        bridgeIgnoreAutoLayoutKeyPressed = false;
      }
    };
    var cleanupParentModifierListeners = function () {
      parentDocument.removeEventListener(
        "keydown",
        onParentModifierKeyDown,
        true,
      );
      parentDocument.removeEventListener("keyup", onParentModifierKeyUp, true);
      if (
        modifierListenerWindows.get(window)?.cleanup ===
        cleanupParentModifierListeners
      ) {
        modifierListenerWindows.delete(window);
      }
    };
    parentDocument.addEventListener("keydown", onParentModifierKeyDown, true);
    parentDocument.addEventListener("keyup", onParentModifierKeyUp, true);
    modifierListenerWindows.set(window, {
      cleanup: cleanupParentModifierListeners,
    });
    window.addEventListener("unload", cleanupParentModifierListeners, {
      once: true,
    });
  } catch (_err) {
    // coercion-ok: cross-origin previews intentionally cannot inspect the host document.
    void _err;
  }

  document.addEventListener(
    "keyup",
    function (e) {
      if (!isApplePlatformBridge() && String(e.key).toLowerCase() === "s") {
        bridgeIgnoreAutoLayoutKeyPressed = false;
      }
      if (e.key !== " " || e.code !== "Space") return;
      bridgeSpaceKeyPressed = false;
      if (bridgeSpaceKeyConsumedByDrag) {
        bridgeSpaceKeyConsumedByDrag = false;
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (activeTextEditEl || isEditorTypingTarget(e.target)) return;
      stopNativeInteraction(e);
      (window.parent as Window).postMessage(
        { type: "design-hotkey-up", key: e.key, code: e.code },
        "*",
      );
    },
    true,
  );
  window.addEventListener("blur", function () {
    window.setTimeout(function () {
      if (!activeDragCancel) {
        bridgeIgnoreAutoLayoutKeyPressed = false;
        hostIgnoreAutoLayoutAtPointerDown = false;
      }
    }, 0);
  });

  document.addEventListener(
    "pointerdown",
    function (e) {
      if (pendingBeginTextEdit) {
        var canceledPendingNodeId = pendingBeginTextEdit.nodeId;
        cancelPendingBeginTextEdit();
        postTextEditPending(canceledPendingNodeId, false, "pointerdown");
      }
      if (!activeTextEditEl) return;
      if (exitStaleTextEditSession()) return;
      var pointerTarget =
        e.target && (e.target as Element).nodeType === 1
          ? (e.target as Element)
          : null;
      if (
        pointerTarget &&
        (pointerTarget === activeTextEditEl ||
          activeTextEditEl.contains(pointerTarget))
      ) {
        return;
      }
      if (pointerTarget && isOverlayElement(pointerTarget)) return;
      if (finishActiveTextEdit) {
        finishActiveTextEdit(true);
      }
    },
    true,
  );

  function hasFigmaClipboardPayload(value) {
    var content = String(value || "");
    return (
      /\((figmeta|figma)\)[\s\S]*?\(\/(figmeta|figma)\)/i.test(content) ||
      /<[^>]+\sdata-(metadata|buffer)=["'][^"']*\((figmeta|figma)\)[^"']*["']/i.test(
        content,
      )
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
      if (content) {
        stopNativeInteraction(e);
        (window.parent as Window).postMessage(
          {
            type: "figma-clipboard-paste",
            content: content,
            ...clipboardScreenContext(),
          },
          "*",
        );
        return;
      }
      var svgHtml = e.clipboardData?.getData("text/html") || "";
      var svgText = e.clipboardData?.getData("text/plain") || "";
      var svgSource = /<svg\b/i.test(svgHtml)
        ? svgHtml
        : /<svg\b/i.test(svgText)
          ? svgText
          : "";
      if (svgSource) {
        stopNativeInteraction(e);
        (window.parent as Window).postMessage(
          {
            type: "figma-clipboard-paste",
            content: "",
            svg: svgSource,
            ...clipboardScreenContext(),
          },
          "*",
        );
        return;
      }
      var clipboardFiles = Array.from(e.clipboardData?.items ?? [])
        .filter(function (item) {
          return item.kind === "file";
        })
        .map(function (item) {
          return item.getAsFile();
        })
        .filter(function (file): file is File {
          return Boolean(file);
        });
      var svgFiles = clipboardFiles.filter(function (file) {
        return (
          file.type.toLowerCase() === "image/svg+xml" ||
          file.name.toLowerCase().endsWith(".svg")
        );
      });
      var imageFiles = clipboardFiles.filter(function (file) {
        return (
          !svgFiles.includes(file) &&
          (file.type.startsWith("image/") || file.type.startsWith("video/"))
        );
      });
      if (svgFiles.length > 0 || imageFiles.length > 0) {
        stopNativeInteraction(e);
        var relayImageFiles = function () {
          if (imageFiles.length === 0) return;
          var readPromises = imageFiles.map(function (file) {
            return new Promise<{
              dataUrl: string;
              type: string;
              name: string;
            } | null>(function (resolve) {
              var reader = new FileReader();
              reader.onload = function () {
                resolve({
                  dataUrl:
                    typeof reader.result === "string" ? reader.result : "",
                  type: file.type,
                  name: file.name,
                });
              };
              reader.onerror = function () {
                resolve(null);
              };
              reader.readAsDataURL(file);
            });
          });
          void Promise.all(readPromises).then(function (results) {
            var valid = results.filter(function (r) {
              return r && r.dataUrl;
            });
            if (valid.length > 0) {
              (window.parent as Window).postMessage(
                {
                  type: "canvas-image-paste",
                  files: valid,
                  ...clipboardScreenContext(),
                },
                "*",
              );
            }
          });
        };
        void Promise.all(
          svgFiles.map(function (file) {
            if (file.size > 1000000) {
              return Promise.resolve({ error: "too-large" as const });
            }
            return file
              .text()
              .then(function (source) {
                return { source: source };
              })
              .catch(function () {
                return { error: "unreadable" as const };
              });
          }),
        ).then(function (results) {
          for (var result of results) {
            (window.parent as Window).postMessage(
              result.source
                ? {
                    type: "figma-clipboard-paste",
                    content: "",
                    svg: result.source,
                    ...clipboardScreenContext(),
                  }
                : {
                    type: "figma-clipboard-paste",
                    content: "",
                    svgFileError: result.error,
                    ...clipboardScreenContext(),
                  },
              "*",
            );
          }
          relayImageFiles();
        });
        return;
      }
      var pastedHtml = e.clipboardData
        ? e.clipboardData.getData("text/html") || ""
        : "";
      var pastedText = e.clipboardData
        ? e.clipboardData.getData("text/plain") || ""
        : "";
      if (/figma/i.test(pastedHtml) || /figma/i.test(pastedText)) {
        (window.parent as Window).postMessage(
          {
            type: "figma-clipboard-paste",
            content: "",
            html: pastedHtml,
            text: pastedText,
            ...clipboardScreenContext(),
          },
          "*",
        );
      }
    },
    true,
  );

  function collapseSelectionIntoContents(
    el: Element,
    toStart?: boolean,
  ): boolean {
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || !el.isConnected) return false;
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(toStart === true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function selectAllTextContents(target: HTMLElement): void {
    var range = document.createRange();
    range.selectNodeContents(target);
    var selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function isRejectedRawTextEditTarget(el: Element | null): boolean {
    if (!el) return true;
    if (isOverlayElement(el)) return true;
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    return tag === "img" || tag === "svg" || tag === "canvas";
  }

  function beginTextEditingFromEvent(
    e,
    forceTextEditing,
    resumeBookmark?: { start: number; end: number; text: string },
  ) {
    if (activeTextEditEl && e.target && activeTextEditEl.contains(e.target))
      return;
    if (!textEditingEnabled && !forceTextEditing) {
      stopNativeInteraction(e);
      return;
    }
    stopNativeInteraction(e);
    if (pendingBeginTextEdit) {
      var supersededPendingNodeId = pendingBeginTextEdit.nodeId;
      cancelPendingBeginTextEdit();
      postTextEditPending(supersededPendingNodeId, false, "superseded");
    }
    if (activeTextEditEl && finishActiveTextEdit) finishActiveTextEdit(true);
    clearSuspendedTextEditRange();
    var eventTarget =
      e && e.target && e.target.nodeType === 1 ? e.target : null;
    var programmaticFlag =
      !!e &&
      (e as unknown as { agentNativeProgrammaticTextEdit?: boolean })
        .agentNativeProgrammaticTextEdit === true;
    var rawTargetFallback =
      programmaticFlag && !isRejectedRawTextEditTarget(eventTarget)
        ? eventTarget
        : null;
    var target = programmaticFlag
      ?
        rawTargetFallback || findTextEditTarget(eventTarget)
      : findTextEditTarget(elementFromEditorPoint(e.clientX, e.clientY)) ||
        findTextEditTarget(eventTarget) ||
        rawTargetFallback;
    if (!target || target.nodeType !== 1) {
      if (!programmaticFlag) {
        var descendHit = elementFromEditorPoint(e.clientX, e.clientY);
        if (
          descendHit &&
          selectedEl &&
          selectedEl.hasAttribute("data-an-pen-nodes") &&
          selectedEl.contains(descendHit)
        ) {
          postDesignHotkey({ key: "Enter", code: "Enter" });
          return;
        }
        if (
          descendHit &&
          descendHit !== document.body &&
          descendHit !== document.documentElement &&
          !isLayerInteractionBlocked(descendHit)
        ) {
          var previousSelectedElForDescend = selectedEl;
          if (
            previousSelectedElForDescend &&
            document.documentElement.contains(previousSelectedElForDescend) &&
            previousSelectedElForDescend.contains(descendHit)
          ) {
            selectionContainerScope = previousSelectedElForDescend;
          }
          var descendTarget = containerFirstSelectionTarget(descendHit, true);
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
    if (
      !programmaticFlag &&
      isTemplateCloneElement(target) &&
      !(target.getAttribute && target.getAttribute("x-text"))
    ) {
      showRejectedDragBadge(
        "Can't edit repeated items directly",
        e.clientX,
        e.clientY,
      );
      window.setTimeout(hideTransformBadge, 1400);
      var rejectedTextEditFallback = selectionTargetForHit(target);
      if (
        rejectedTextEditFallback &&
        !isLayerInteractionBlocked(rejectedTextEditFallback)
      ) {
        selectedEl = rejectedTextEditFallback;
        positionOverlay(selectionOverlay, selectedEl);
        postElementSelect(selectedEl, e);
      }
      return;
    }
    selectedEl = selectionTargetForHit(target) || target;
    var programmaticTextEdit = programmaticFlag;
    var originalText = target.textContent || "";
    var originalHtml = target.innerHTML || "";
    var originalMinWidth = target.style.minWidth;
    var originalMinHeight = target.style.minHeight;
    var originalLineClamp = target.style.getPropertyValue("-webkit-line-clamp");
    var originalLineClampPriority =
      target.style.getPropertyPriority("-webkit-line-clamp");
    var originalOverflow = target.style.getPropertyValue("overflow");
    var originalOverflowPriority = target.style.getPropertyPriority("overflow");
    var originalHeight = target.style.getPropertyValue("height");
    var originalHeightPriority = target.style.getPropertyPriority("height");
    var computedTextStyle = window.getComputedStyle(target);
    var hasLineClamp = /^\d+$/.test(
      computedTextStyle.getPropertyValue("-webkit-line-clamp").trim(),
    );
    var clampedTextEditHeight = "";
    if (hasLineClamp) {
      var verticalInset =
        computedTextStyle.boxSizing === "border-box"
          ? 0
          : parseFloat(computedTextStyle.paddingTop || "0") +
            parseFloat(computedTextStyle.paddingBottom || "0") +
            parseFloat(computedTextStyle.borderTopWidth || "0") +
            parseFloat(computedTextStyle.borderBottomWidth || "0");
      clampedTextEditHeight =
        Math.max(0, target.offsetHeight - verticalInset) + "px";
    }
    var originalBorderColor = target.style.borderColor;
    var originalOutline = target.style.outline;
    var originalOutlineOffset = target.style.outlineOffset;
    var committed = false;
    activeTextEditEl = target;
    activeTextEditRange = null;
    activeTextEditStyleSelector = getSelector(selectedEl);
    activeTextEditOriginalMinWidth = originalMinWidth;
    activeTextEditOriginalMinHeight = originalMinHeight;
    var chromeUpdateScheduled = false;
    function scheduleTextEditingChromeUpdate() {
      if (chromeUpdateScheduled) return;
      chromeUpdateScheduled = true;
      window.requestAnimationFrame(function () {
        chromeUpdateScheduled = false;
        if (committed) return;
        captureActiveTextEditRange(target);
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
    if (hasLineClamp) {
      target.style.setProperty("-webkit-line-clamp", "none", "important");
      target.style.setProperty("overflow", "visible", "important");
      target.style.setProperty("height", clampedTextEditHeight, "important");
    }
    postTextEditingState(target, true);

    function finish(commit, preserveRangeForInspector) {
      if (committed) return;
      committed = true;
      var preserveForInspector =
        preserveRangeForInspector || textEditInspectorFocused;
      var preservedRange =
        commit &&
        preserveForInspector &&
        activeTextEditRange &&
        !activeTextEditRange.collapsed &&
        rangeBelongsToElement(activeTextEditRange, target)
          ? activeTextEditRange.cloneRange()
          : null;
      target.removeEventListener("blur", onBlur, true);
      target.removeEventListener("keydown", onKeyDown, true);
      target.removeEventListener("paste", onPaste, true);
      target.removeEventListener("input", onInput, true);
      target.removeEventListener("keyup", onKeyUp, true);
      target.removeEventListener("mouseup", onMouseUp, true);
      target.removeEventListener("mousedown", onMouseDownInSelection, true);
      target.removeEventListener("dragstart", preventTextDrag, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("blur", onWindowBlur, true);
      target.removeAttribute("contenteditable");
      target.removeAttribute("data-agent-native-text-editing");
      hideTextCaretOverlay(target);
      document.documentElement.removeAttribute(
        "data-agent-native-empty-text-editing",
      );
      target.style.cursor = "";
      target.style.outline = originalOutline;
      target.style.outlineOffset = originalOutlineOffset;
      target.style.minWidth = originalMinWidth;
      target.style.minHeight = originalMinHeight;
      if (hasLineClamp) {
        if (originalLineClamp) {
          target.style.setProperty(
            "-webkit-line-clamp",
            originalLineClamp,
            originalLineClampPriority,
          );
        } else {
          target.style.removeProperty("-webkit-line-clamp");
        }
        if (originalOverflow) {
          target.style.setProperty(
            "overflow",
            originalOverflow,
            originalOverflowPriority,
          );
        } else {
          target.style.removeProperty("overflow");
        }
        if (originalHeight) {
          target.style.setProperty(
            "height",
            originalHeight,
            originalHeightPriority,
          );
        } else {
          target.style.removeProperty("height");
        }
      }
      target.style.borderColor = originalBorderColor;
      setTextEditingPointerPassthrough(false);
      setSelectionOverlayResizeChromeVisible(true);
      var nativeSelection = window.getSelection ? window.getSelection() : null;
      if (nativeSelection) nativeSelection.removeAllRanges();
      if (activeTextEditEl === target) activeTextEditEl = null;
      activeTextEditRange = null;
      suspendedTextEditRange = preservedRange
        ? {
            target: target,
            range: preservedRange,
            selector: activeTextEditStyleSelector,
          }
        : null;
      if (finishActiveTextEdit === finish) finishActiveTextEdit = null;
      postTextEditingState(
        target,
        false,
        activeTextEditStyleSelector,
        Boolean(preservedRange),
      );
      activeTextEditStyleSelector = "";
      if (!commit) {
        target.innerHTML = originalHtml;
        claimContentAsSource(target);
        refreshOverlays();
        return;
      }
      normalizeNestedIdenticalSpans(target);
      var next = target.textContent || "";
      var nextHtml = target.innerHTML || "";
      refreshOverlays();
      if (
        target.isConnected &&
        (next !== originalText ||
          nextHtml !== originalHtml ||
          (programmaticTextEdit && !hasTextCharacters(target)))
      ) {
        postTextContentChange(
          target,
          next,
          nextHtml,
          originalText,
          originalHtml,
        );
      }
      if (pendingRuntimeDocumentUpdate) {
        var pending = pendingRuntimeDocumentUpdate;
        pendingRuntimeDocumentUpdate = null;
        replaceRuntimeDocument(
          pending.html,
          pending.preferredSelector,
          pending.selectorCandidates,
          true,
          false,
          pending.sourceProvenance,
        );
      }
    }
    finishActiveTextEdit = finish;

    var emptyProgrammaticRefocusScheduled = false;
    function refocusEmptyProgrammaticEdit() {
      if (
        emptyProgrammaticRefocusScheduled ||
        !programmaticTextEdit ||
        (target.textContent || "").trim()
      ) {
        return false;
      }
      emptyProgrammaticRefocusScheduled = true;
      window.setTimeout(function () {
        emptyProgrammaticRefocusScheduled = false;
        if (committed || (target.textContent || "").trim()) return;
        target.focus();
        updateTextEditingChrome(target, originalMinWidth, originalMinHeight);
        postTextEditingState(target, true);
      }, 0);
      return true;
    }

    function onBlur() {
      if (refocusEmptyProgrammaticEdit()) return;
      finish(true, true);
    }

    function onWindowBlur() {
      refocusEmptyProgrammaticEdit();
    }

    function onKeyDown(ev) {
      if (ev.isComposing || ev.keyCode === 229) return;
      var metaOrCtrl = ev.metaKey || ev.ctrlKey;
      if (
        ev.key === "Escape" ||
        (ev.key === "Enter" && metaOrCtrl && !ev.altKey && !ev.shiftKey)
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        finish(true);
        target.blur();
        return;
      }
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        insertLineBreak();
        scheduleTextEditingChromeUpdate();
        return;
      }
      if (
        programmaticTextEdit &&
        metaOrCtrl &&
        !ev.altKey &&
        ev.key.toLowerCase() === "z"
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
        postDesignHotkey(ev);
        return;
      }
      var formatKey = metaOrCtrl && !ev.altKey ? ev.key.toLowerCase() : "";
      if (TEXT_EDIT_FORMATS[formatKey]) {
        ev.preventDefault();
        applyTextEditFormat(formatKey);
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
      captureActiveTextEditRange(target);
      clearActiveTextEditRangeIfCollapsed(target);
      scheduleTextEditingChromeUpdate();
    }

    function onSelectionChange() {
      captureActiveTextEditRange(target);
      scheduleTextEditingChromeUpdate();
    }

    function onKeyUp(ev) {
      captureActiveTextEditRange(target);
      if (document.activeElement === target && !ev.shiftKey) {
        clearActiveTextEditRangeIfCollapsed(target);
      }
      scheduleTextEditingChromeUpdate();
    }

    function onMouseDownInSelection(ev: MouseEvent) {
      if (ev.button !== 0 || ev.shiftKey || ev.detail !== 1) return;
      var selection = window.getSelection ? window.getSelection() : null;
      if (!selection || selection.isCollapsed) return;
      var point = document.caretPositionFromPoint
        ? (function () {
            var position = document.caretPositionFromPoint(
              ev.clientX,
              ev.clientY,
            );
            if (!position) return null;
            var range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.collapse(true);
            return range;
          })()
        : document.caretRangeFromPoint
          ? document.caretRangeFromPoint(ev.clientX, ev.clientY)
          : null;
      if (!point || !rangeBelongsToElement(point, target)) return;
      selection.removeAllRanges();
      selection.addRange(point);
    }

    function preventTextDrag(ev: DragEvent): void {
      ev.preventDefault();
    }

    function onMouseUp() {
      captureActiveTextEditRange(target);
      clearActiveTextEditRangeIfCollapsed(target);
      scheduleTextEditingChromeUpdate();
    }

    target.addEventListener("blur", onBlur, true);
    target.addEventListener("keydown", onKeyDown, true);
    target.addEventListener("paste", onPaste, true);
    target.addEventListener("input", onInput, true);
    target.addEventListener("keyup", onKeyUp, true);
    target.addEventListener("mouseup", onMouseUp, true);
    target.addEventListener("mousedown", onMouseDownInSelection, true);
    target.addEventListener("dragstart", preventTextDrag, true);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("blur", onWindowBlur, true);
    target.focus();
    if (resumeBookmark) {
      var resumedRange = restoreTextRangeBookmark(target, resumeBookmark);
      var resumedSelection = window.getSelection ? window.getSelection() : null;
      if (!resumedRange || !resumedSelection) {
        if (finishActiveTextEdit) finishActiveTextEdit(false);
        return;
      }
      resumedSelection.removeAllRanges();
      resumedSelection.addRange(resumedRange);
    } else if (programmaticTextEdit) {
      collapseSelectionIntoContents(target);
    } else {
      selectAllTextContents(target);
    }
    captureActiveTextEditRange(target);
    postTextEditingState(target, true);
  }

  function beginTextEditRepeatFromMessage(
    value: unknown,
  ): BeginTextEditRepeat | null {
    if (!value || typeof value !== "object") return null;
    var candidate = value as {
      sourceSelector?: unknown;
      itemIndex?: unknown;
    };
    if (
      typeof candidate.sourceSelector !== "string" ||
      !candidate.sourceSelector ||
      typeof candidate.itemIndex !== "number" ||
      !Number.isInteger(candidate.itemIndex) ||
      candidate.itemIndex < 0
    ) {
      return null;
    }
    return {
      sourceSelector: candidate.sourceSelector,
      itemIndex: candidate.itemIndex,
    };
  }
  function sameBeginTextEditRepeat(
    left: BeginTextEditRepeat | null,
    right: BeginTextEditRepeat | null,
  ): boolean {
    return (
      left === right ||
      (!!left &&
        !!right &&
        left.sourceSelector === right.sourceSelector &&
        left.itemIndex === right.itemIndex)
    );
  }
  function queryBeginTextEditNode(
    nodeId: string,
    repeat: BeginTextEditRepeat | null,
  ): HTMLElement | null {
    var nodes = document.querySelectorAll(
      '[data-agent-native-node-id="' +
        nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
        '"]',
    );
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!repeat) return node as HTMLElement;
      var info = repeatInstanceInfo(node);
      if (
        info &&
        info.sourceSelector === repeat.sourceSelector &&
        info.itemIndex === repeat.itemIndex
      ) {
        return node as HTMLElement;
      }
    }
    return null;
  }
  function activateProgrammaticTextEdit(
    textTarget: HTMLElement,
    force: boolean,
    resumeBookmark?: { start: number; end: number; text: string },
  ): void {
    if (activeTextEditEl && activeTextEditEl === textTarget) {
      if (resumeBookmark) {
        var activeResumeRange = restoreTextRangeBookmark(
          textTarget,
          resumeBookmark,
        );
        var activeResumeSelection = window.getSelection
          ? window.getSelection()
          : null;
        if (!activeResumeRange || !activeResumeSelection) return;
        textTarget.focus();
        activeResumeSelection.removeAllRanges();
        activeResumeSelection.addRange(activeResumeRange);
        captureActiveTextEditRange(textTarget);
        postTextEditingState(textTarget, true);
        return;
      }
      if (document.activeElement !== textTarget || !document.hasFocus()) {
        textTarget.focus();
        collapseSelectionIntoContents(textTarget);
        postTextEditingState(textTarget, true);
      }
      return;
    }
    var bteRect = textTarget.getBoundingClientRect();
    var bteCenterX = bteRect.right - 2;
    var bteCenterY = bteRect.top + bteRect.height / 2;
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
      force,
      resumeBookmark,
    );
  }
  var PENDING_BEGIN_TEXT_EDIT_MS = 5000;
  function pumpPendingBeginTextEdit(): void {
    if (!pendingBeginTextEdit) return;
    var entry = pendingBeginTextEdit;
    var node = queryBeginTextEditNode(entry.nodeId, entry.repeat);
    if (node) {
      pendingBeginTextEdit = null;
      if (activeTextEditEl) {
        if (entry.buffer) postTextEditInsertResult(entry.nodeId, false);
      }
      if (!activeTextEditEl) {
        activateProgrammaticTextEdit(node, entry.force);
        var replayLanded = false;
        if (entry.buffer) {
          replayLanded =
            activeTextEditEl === node &&
            insertPlainTextAtSelection(entry.buffer);
          postTextEditInsertResult(entry.nodeId, replayLanded);
        }
        if (entry.commitImmediately) {
          if (
            activeTextEditEl === node &&
            finishActiveTextEdit &&
            (replayLanded || !entry.buffer)
          ) {
            finishActiveTextEdit(true);
            (node as HTMLElement).blur();
            postTextEditPending(entry.nodeId, false, "committed");
          } else {
            postTextEditPending(entry.nodeId, false, "not-taken");
          }
        }
      }
      return;
    }
    if (Date.now() > entry.deadline) {
      pendingBeginTextEdit = null;
      postTextEditPending(entry.nodeId, false, "deadline");
      return;
    }
    entry.raf = window.requestAnimationFrame(pumpPendingBeginTextEdit);
  }
  function scheduleBeginTextEditRetry(
    nodeId: string,
    repeat: BeginTextEditRepeat | null,
    force: boolean,
    insertText?: string,
    commitImmediately?: boolean,
  ): void {
    if (
      pendingBeginTextEdit &&
      pendingBeginTextEdit.nodeId === nodeId &&
      sameBeginTextEditRepeat(pendingBeginTextEdit.repeat, repeat)
    ) {
      pendingBeginTextEdit.force = pendingBeginTextEdit.force || force;
      pendingBeginTextEdit.deadline = Date.now() + PENDING_BEGIN_TEXT_EDIT_MS;
      if (insertText) pendingBeginTextEdit.buffer += insertText;
      if (commitImmediately) pendingBeginTextEdit.commitImmediately = true;
      return;
    }
    cancelPendingBeginTextEdit();
    pendingBeginTextEdit = {
      nodeId: nodeId,
      repeat: repeat,
      force: force,
      commitImmediately: commitImmediately === true,
      deadline: Date.now() + PENDING_BEGIN_TEXT_EDIT_MS,
      raf: window.requestAnimationFrame(pumpPendingBeginTextEdit),
      buffer: insertText || "",
    };
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
      if (interactionMode) return;
      if (isOverlayElement(e.target)) return;
      beginTextEditingFromEvent(e);
    },
    true,
  );

  var lastHoverClientPoint: { x: number; y: number } | null = null;
  function resolveHoverTarget(
    clientX: number,
    clientY: number,
    deepSelect: boolean,
  ): Element | null {
    var rawHit = elementFromEditorPoint(clientX, clientY);
    return deepSelect || !designCanvasBoardSurface
      ? selectionTargetForHit(rawHit)
      : containerFirstSelectionTarget(rawHit);
  }
  function reresolveHoverAtLastPoint(deepSelect: boolean): void {
    if (!lastHoverClientPoint) return;
    hoveredEl = resolveHoverTarget(
      lastHoverClientPoint.x,
      lastHoverClientPoint.y,
      deepSelect,
    );
    if (!hoveredEl || hoveredEl === selectedEl) {
      highlightOverlay.style.display = "none";
    } else {
      positionOverlay(highlightOverlay, hoveredEl);
    }
  }
  document.addEventListener(
    "keydown",
    function (e) {
      if (e.key === "Meta" || e.key === "Control") {
        reresolveHoverAtLastPoint(true);
      }
    },
    true,
  );
  document.addEventListener(
    "keyup",
    function (e) {
      if (e.key === "Meta" || e.key === "Control") {
        reresolveHoverAtLastPoint(false);
      }
    },
    true,
  );
  function handleShieldPointerMove(e) {
    if (readOnly || interactionMode) return;
    stopNativeInteraction(e);
    lastHoverClientPoint = { x: e.clientX, y: e.clientY };
    hoveredEl = resolveHoverTarget(
      e.clientX,
      e.clientY,
      e.metaKey || e.ctrlKey,
    );
    if (!hoveredEl) {
      highlightOverlay.style.display = "none";
      if (!spacingDrag) {
        scheduleSpacingHoverClear(e);
      }
      hideMeasurements();
      lastHoverInfoPostedEl = null;
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
        lastSpacingPointerPoint = { x: e.clientX, y: e.clientY };
        updateSpacingOverlay(selectedEl);
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
    if (!e.altKey && hoveredEl !== lastHoverInfoPostedEl) {
      lastHoverInfoPostedEl = hoveredEl;
      var info = getLightElementInfo(hoveredEl);
      (window.parent as Window).postMessage(
        { type: "element-hover", payload: info },
        "*",
      );
    }
  }

  shieldOverlay.addEventListener("pointermove", handleShieldPointerMove, true);
  shieldOverlay.addEventListener("mousemove", handleShieldPointerMove, true);

  document.addEventListener(
    "pointermove",
    function (e) {
      if (isOverlayElement(e.target)) return;
      if (pendingShieldDrag || activeDragCancel) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        return;
      }
      handleShieldPointerMove(e);
    },
    true,
  );
  document.addEventListener(
    "mousemove",
    function (e) {
      if (isOverlayElement(e.target)) return;
      if (pendingShieldDrag || activeDragCancel) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        return;
      }
      handleShieldPointerMove(e);
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
      clearHoverGate();
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
      if (e.key === "Alt") {
        hideMeasurements();
        lastHoverInfoPostedEl = hoveredEl;
        (window.parent as Window).postMessage(
          {
            type: "element-hover",
            payload: hoveredEl ? getLightElementInfo(hoveredEl) : null,
          },
          "*",
        );
      }
    },
    true,
  );

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    if (!e.data) return;
    if (e.data.type === "measurement-modifier-release") {
      hideMeasurements();
      lastHoverInfoPostedEl = hoveredEl;
      (window.parent as Window).postMessage(
        {
          type: "element-hover",
          payload: hoveredEl ? getLightElementInfo(hoveredEl) : null,
        },
        "*",
      );
      return;
    }
    if (e.data.type === "agent-native:editor-chrome-ready-probe") {
      sendEditorChromeReady();
      return;
    }
    if (e.data.type === "resume-text-edit") {
      var resumeScreenId =
        typeof e.data.screenId === "string" ? e.data.screenId : "";
      var resumeSelector =
        typeof e.data.selector === "string" ? e.data.selector : "";
      var resumeSourceId =
        typeof e.data.sourceId === "string" ? e.data.sourceId : undefined;
      var suspendedForResume = suspendedTextEditRange;
      if (
        !resumeScreenId ||
        resumeScreenId !== designCanvasScreenId ||
        readOnly ||
        !textEditingEnabled ||
        !textEditInspectorFocused ||
        !resumeSelector ||
        !suspendedForResume ||
        !suspendedForResume.target.isConnected ||
        suspendedForResume.selector !== resumeSelector ||
        (resumeSourceId !== undefined &&
          (getSourceId(suspendedForResume.target) || undefined) !==
            resumeSourceId)
      ) {
        return;
      }
      var resumeBookmark = captureTextRangeBookmark(
        suspendedForResume.target,
        suspendedForResume.range,
      );
      if (!resumeBookmark) return;
      var resumeTarget = suspendedForResume.target;
      suspendedTextEditRange = null;
      textEditInspectorFocused = false;
      activateProgrammaticTextEdit(resumeTarget, false, resumeBookmark);
      return;
    }
    if (e.data.type === "design-hotkey") {
      if (
        !isApplePlatformBridge() &&
        String(e.data.key).toLowerCase() === "s"
      ) {
        bridgeIgnoreAutoLayoutKeyPressed = true;
      }
      return;
    }
    if (e.data.type === "agent-native:drag-modifiers") {
      hostIgnoreAutoLayoutAtPointerDown = e.data.ignoreAutoLayout === true;
      return;
    }
    if (e.data.type === "design-hotkey-up") {
      if (
        !isApplePlatformBridge() &&
        String(e.data.key).toLowerCase() === "s"
      ) {
        bridgeIgnoreAutoLayoutKeyPressed = false;
      }
      return;
    }
    if (e.data.type === "text-edit-inspector-focus") {
      if (typeof e.data.focused !== "boolean") return;
      textEditInspectorFocused = e.data.focused;
      if (!textEditInspectorFocused) {
        clearSuspendedTextEditRange();
        if (activeTextEditEl && finishActiveTextEdit) {
          finishActiveTextEdit(true);
        }
      }
      return;
    }
    if (e.data.type === "set-layout-grid-step") {
      var nextStep = Number(e.data.step);
      layoutGridStep =
        Number.isFinite(nextStep) && nextStep >= 1 ? nextStep : 1;
      return;
    }
    if (e.data.type === "set-grid-group-batching-enabled") {
      gridGroupBatchingEnabled = e.data.enabled === true;
      return;
    }
    if (e.data.type === "set-read-only") {
      var nextReadOnly = !!e.data.readOnly;
      readOnly = nextReadOnly;
      textEditingEnabled =
        !readOnly && !interactionMode && textEditingEnabledFlag;
      if (readOnly) {
        if (activeTextEditEl) {
          activeTextEditEl.blur();
        }
        clearPendingShieldDrag();
        cancelActiveBridgeDrag();
        setSelectionOverlayResizeChromeVisible(false);
      }
      syncShieldPointerEvents();
      setSelectionOverlayResizeChromeVisible(
        !readOnly && !interactionMode && !activeTextEditEl,
      );
      if (interactionMode) hideSelectionOverlay();
      else if (selectedEl?.isConnected)
        positionOverlay(selectionOverlay, selectedEl);
      return;
    }
    if (e.data.type === "set-interaction-mode") {
      var nextInteractionMode = e.data.interact === true;
      interactionMode = nextInteractionMode;
      if (interactionMode) {
        var releaseSpacePan = bridgeSpaceKeyPressed;
        clearPendingShieldDrag();
        cancelActiveBridgeDrag();
        if (releaseSpacePan) {
          bridgeSpaceKeyPressed = false;
          bridgeSpaceKeyConsumedByDrag = false;
          (window.parent as Window).postMessage(
            { type: "design-hotkey-up", key: " ", code: "Space" },
            "*",
          );
        }
        if (activeTextEditEl) activeTextEditEl.blur();
        textEditingEnabled = false;
        setSelectionOverlayResizeChromeVisible(false);
        hideSelectionOverlay();
        highlightOverlay.style.display = "none";
        marqueeSelectionOverlay.style.display = "none";
        syncShieldPointerEvents();
      } else {
        textEditingEnabled = !readOnly && textEditingEnabledFlag;
        setSelectionOverlayResizeChromeVisible(!readOnly);
        syncShieldPointerEvents();
        if (selectedEl?.isConnected)
          positionOverlay(selectionOverlay, selectedEl);
        scheduleRuntimeLayerSnapshot();
      }
      return;
    }
    if (e.data.type === "set-text-editing-enabled") {
      var nextTextEditingEnabledFlag = !!e.data.enabled;
      if (textEditingEnabledFlag === nextTextEditingEnabledFlag) return;
      textEditingEnabledFlag = nextTextEditingEnabledFlag;
      var nextTextEditingEnabled =
        !readOnly && !interactionMode && textEditingEnabledFlag;
      if (textEditingEnabled === nextTextEditingEnabled) return;
      textEditingEnabled = nextTextEditingEnabled;
      if (!textEditingEnabled && activeTextEditEl) {
        activeTextEditEl.blur();
      }
      return;
    }
    if (e.data.type === "set-content-offset") {
      var nextContentOffsetX = Number(e.data.x);
      var nextContentOffsetY = Number(e.data.y);
      designCanvasContentOffsetX = Number.isFinite(nextContentOffsetX)
        ? nextContentOffsetX
        : 0;
      designCanvasContentOffsetY = Number.isFinite(nextContentOffsetY)
        ? nextContentOffsetY
        : 0;
      return;
    }
    if (e.data.type === "agent-native:cancel-text-edit") {
      var cancelScreenId =
        typeof e.data.screenId === "string" ? e.data.screenId : "";
      var cancelNodeId = typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      if (!cancelNodeId) return;
      if (cancelScreenId && cancelScreenId !== designCanvasScreenId) return;
      if (
        pendingBeginTextEdit &&
        pendingBeginTextEdit.nodeId === cancelNodeId
      ) {
        cancelPendingBeginTextEdit();
        postTextEditPending(cancelNodeId, false, "superseded");
      }
      if (
        activeTextEditEl &&
        getSourceId(activeTextEditEl) === cancelNodeId &&
        (activeTextEditEl.textContent || "").trim() === "" &&
        finishActiveTextEdit
      ) {
        finishActiveTextEdit(false);
      }
      return;
    }
    if (e.data.type === "begin-text-edit") {
      var forceBeginTextEdit = e.data.force === true;
      if ((readOnly || !textEditingEnabled) && !forceBeginTextEdit) return;
      var nodeId: string =
        typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      if (!nodeId) return;
      var beginTextEditRepeat = beginTextEditRepeatFromMessage(e.data.repeat);
      if (e.data.repeat !== undefined && !beginTextEditRepeat) return;
      var beginInsertText =
        typeof e.data.insertText === "string" ? e.data.insertText : "";
      var beginCommitImmediately = e.data.commitImmediately === true;
      var textTarget = queryBeginTextEditNode(nodeId, beginTextEditRepeat);
      if (!textTarget) {
        scheduleBeginTextEditRetry(
          nodeId,
          beginTextEditRepeat,
          forceBeginTextEdit,
          beginInsertText,
          beginCommitImmediately,
        );
        postTextEditPending(nodeId, true);
        return;
      }
      cancelPendingBeginTextEdit();
      activateProgrammaticTextEdit(textTarget, forceBeginTextEdit);
      var tookTarget = activeTextEditEl === textTarget;
      var beginInsertLanded = false;
      if (beginInsertText) {
        beginInsertLanded =
          tookTarget && insertPlainTextAtSelection(beginInsertText);
        postTextEditInsertResult(nodeId, beginInsertLanded);
      }
      if (beginCommitImmediately) {
        if (
          tookTarget &&
          finishActiveTextEdit &&
          (beginInsertLanded || !beginInsertText)
        ) {
          finishActiveTextEdit(true);
          textTarget.blur();
          postTextEditPending(nodeId, false, "committed");
        } else {
          postTextEditPending(nodeId, false, "not-taken");
        }
      }
      return;
    }
    if (e.data.type === "text-edit-insert-text") {
      var bufferedText = typeof e.data.text === "string" ? e.data.text : "";
      var bufferedNodeId =
        typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      if (!bufferedText) return;
      if (!activeTextEditEl || !isTextEditElConnected()) {
        postTextEditInsertResult(bufferedNodeId, false);
        return;
      }
      if (bufferedNodeId && getSourceId(activeTextEditEl) !== bufferedNodeId) {
        postTextEditInsertResult(bufferedNodeId, false);
        return;
      }
      var bufferedActive = document.activeElement;
      if (
        !bufferedActive ||
        (bufferedActive !== activeTextEditEl &&
          !activeTextEditEl.contains(bufferedActive))
      ) {
        try {
          activeTextEditEl.focus();
        } catch (_err) {}
      }
      var positionedAtStart = collapseSelectionIntoContents(
        activeTextEditEl,
        true,
      );
      var bufferedInserted = insertPlainTextAtSelection(bufferedText);
      if (positionedAtStart) collapseSelectionIntoContents(activeTextEditEl);
      postTextEditInsertResult(bufferedNodeId, bufferedInserted);
      return;
    }
    if (e.data.type === "set-editor-chrome-scale") {
      editorChromeScaleX = Math.max(0.05, Number(e.data.scaleX) || 1);
      editorChromeScaleY = Math.max(
        0.05,
        Number(e.data.scaleY) || editorChromeScaleX,
      );
      applyEditorChromeScale();
      if (selectedEl || hoveredEl) refreshOverlays();
      else refreshFrameNameLabels();
      return;
    }
    if (e.data.type === "scale-tool-mode") {
      scaleToolEnabled = !!e.data.enabled;
      return;
    }
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
    if (e.data.type === "interaction-state-style-preview") {
      var interactionPreviewState =
        typeof e.data.state === "string" ? e.data.state : "";
      if (!isSupportedInteractionState(interactionPreviewState)) return;
      var interactionPreviewCandidates = Array.isArray(
        e.data.selectorCandidates,
      )
        ? e.data.selectorCandidates.slice()
        : [];
      if (e.data.nodeId) {
        interactionPreviewCandidates.push(
          '[data-agent-native-node-id="' +
            escapeAttribute(e.data.nodeId) +
            '"]',
        );
      }
      var interactionPreviewElement = findRuntimeTarget(
        String(e.data.selector || ""),
        interactionPreviewCandidates,
      ) as HTMLElement | null;
      if (!interactionPreviewElement) return;
      updateRuntimeInteractionStatePreview(
        interactionPreviewElement,
        interactionPreviewState,
        e.data.styles && typeof e.data.styles === "object" ? e.data.styles : {},
        false,
      );
      if (statePreviewElement === interactionPreviewElement) {
        interactionPreviewElement.setAttribute(
          "data-an-state-preview",
          interactionPreviewState,
        );
      }
      return;
    }
    if (e.data.type === "state-preview") {
      var statePreviewTargetNodeId =
        typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      var statePreviewState =
        typeof e.data.state === "string" ? e.data.state : "";
      if (statePreviewElement) {
        statePreviewElement.removeAttribute("data-an-state-preview");
        statePreviewElement = null;
      }
      if (!isSupportedInteractionState(statePreviewState)) return;
      var statePreviewCandidates = Array.isArray(e.data.selectorCandidates)
        ? e.data.selectorCandidates.slice()
        : [];
      if (statePreviewTargetNodeId) {
        statePreviewCandidates.push(
          '[data-agent-native-node-id="' +
            escapeAttribute(statePreviewTargetNodeId) +
            '"]',
        );
      }
      var nextStatePreviewElement = findRuntimeTarget(
        String(e.data.selector || ""),
        statePreviewCandidates,
      ) as HTMLElement | null;
      if (!nextStatePreviewElement) return;
      if (Object.prototype.hasOwnProperty.call(e.data, "previewStyles")) {
        updateRuntimeInteractionStatePreview(
          nextStatePreviewElement,
          statePreviewState,
          e.data.previewStyles && typeof e.data.previewStyles === "object"
            ? e.data.previewStyles
            : {},
          true,
        );
      }
      nextStatePreviewElement.setAttribute(
        "data-an-state-preview",
        statePreviewState,
      );
      statePreviewElement = nextStatePreviewElement;
      return;
    }
    if (e.data.type === "agent-native:cross-screen-claim") {
      crossScreenClaimedByHost = Boolean(e.data.claimed);
      return;
    }
    if (e.data.type === "agent-native:set-space-held") {
      bridgeSpaceKeyPressed = Boolean(e.data.held);
      return;
    }
    if (e.data.type === "agent-native:scale-selection") {
      if (!selectedEl || getSelector(selectedEl) !== e.data.selector) return;
      scaleSelectionByFactor(
        Number(e.data.factor),
        Number(e.data.anchorX),
        Number(e.data.anchorY),
      );
      return;
    }
    if (e.data.type === "agent-native:cancel-active-drag") {
      cancelActiveBridgeDragOrPendingCommit(
        typeof e.data.pressedAt === "number" ? e.data.pressedAt : undefined,
      );
      return;
    }
    if (e.data.type === "agent-native:reset-live-visual-edit-baselines") {
      if (liveVisualEditOriginalInlineStyles) {
        liveVisualEditOriginalInlineStyles = new WeakMap<
          Element,
          Record<string, string>
        >();
      }
      return;
    }
    if (e.data.type === "clear-selection") {
      if (activeMarqueeSelection) return;
      clearSuspendedTextEditRange();
      clearRuntimeSelection();
      return;
    }
    if (e.data.type === "agent-native:measure-selection") {
      var measureScreenId: string =
        typeof e.data.screenId === "string" ? e.data.screenId : "";
      if (measureScreenId && measureScreenId !== designCanvasScreenId) return;
      var measureSelector: string =
        typeof e.data.selector === "string" ? e.data.selector : "";
      var measureTarget: Element | null = null;
      if (measureSelector) {
        try {
          measureTarget = document.querySelector(measureSelector);
        } catch (_err) {
          measureTarget = null;
        }
      } else {
        measureTarget = selectedEl;
      }
      (window.parent as Window).postMessage(
        {
          type: "agent-native:selection-measured",
          correlationId:
            typeof e.data.correlationId === "string"
              ? e.data.correlationId
              : "",
          screenId: designCanvasScreenId,
          payload: measureTarget ? getElementInfo(measureTarget) : null,
        },
        "*",
      );
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
          payload: collectSelectableElementInfos(
            Boolean(e.data.deep),
            readSelectablePoint(e.data.atPoint),
            e.data.includePortableStyleSnapshot !== false,
          ),
        },
        "*",
      );
      return;
    }
    if (e.data.type === "agent-native:text-edit-status") {
      var textEditStatusCorrelationId: string =
        typeof e.data.correlationId === "string" ? e.data.correlationId : "";
      var textEditStatusNodeId: string =
        typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      var textEditStatusRepeat = beginTextEditRepeatFromMessage(e.data.repeat);
      var textEditStatus: "active" | "done" | "missing" | false = "missing";
      if (
        textEditStatusNodeId &&
        (e.data.repeat === undefined || textEditStatusRepeat)
      ) {
        var textEditStatusNode = queryBeginTextEditNode(
          textEditStatusNodeId,
          textEditStatusRepeat,
        );
        if (
          textEditStatusNode?.hasAttribute("data-agent-native-text-editing") &&
          document.activeElement === textEditStatusNode &&
          document.hasFocus()
        ) {
          textEditStatus = "active";
        } else if (
          textEditStatusNode &&
          (textEditStatusNode.textContent ?? "").trim().length > 0
        ) {
          textEditStatus = "done";
        } else if (textEditStatusNode) {
          textEditStatus = false;
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
      var selectedRepeat = selectedEl ? repeatInstanceInfo(selectedEl) : null;
      if (selectedRepeat) {
        passiveTargets = passiveTargets.filter(function (candidate) {
          var candidateRepeat = repeatInstanceInfo(candidate);
          return (
            !candidateRepeat ||
            candidateRepeat.sourceSelector !== selectedRepeat!.sourceSelector
          );
        });
      }
      setPassiveSelectionElements(
        passiveTargets,
        e.data.passiveSelectionStyle === "soft" ? "soft" : "default",
      );
      setHighlightOverlayStyle(
        e.data.passiveSelectionStyle === "soft" ? "soft" : "default",
      );
      return;
    }
    if (e.data.type === "set-selection-chrome-hidden") {
      selectionChromeHidden = !!e.data.hidden;
      if (selectionChromeHidden) {
        hideSelectionOverlay();
      } else if (selectedEl) {
        positionOverlay(selectionOverlay, selectedEl);
        updateParentAutoLayoutOverlay(selectedEl);
        refreshOverlays();
      }
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
      var selectionChangedByHost = target !== selectedEl;
      if (
        suspendedTextEditRange &&
        !matchesExactSelectorList(suspendedTextEditRange.target, candidates)
      ) {
        clearSuspendedTextEditRange();
      }
      if (
        selectionChangedByHost &&
        activeTextEditEl &&
        !matchesExactSelectorList(activeTextEditEl, candidates) &&
        finishActiveTextEdit
      ) {
        finishActiveTextEdit(true);
      }
      if (selectionChangedByHost) {
        hoveredSpacingHandleKey = "";
      }
      selectedEl = target;
      if (selectionChromeHidden) {
        hideSelectionOverlay();
      } else {
        positionOverlay(selectionOverlay, target);
      }
      positionMultiSelectionBounds();
      if (hoveredEl === selectedEl) highlightOverlay.style.display = "none";
      if (selectionChangedByHost) {
        postElementSelect(target);
      }
      return;
    }
    if (e.data.type === "hover-element") {
      if (e.data.hoverStyle === "soft" || e.data.hoverStyle === "default") {
        setHighlightOverlayStyle(e.data.hoverStyle);
      }
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
        clearHoverGate();
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
        clearHoverGate();
        highlightOverlay.style.display = "none";
      }
      applyLayerStateSelectors();
      return;
    }
    if (e.data.type === "runtime-structure-move") {
      if (readOnly) return;
      var rawRuntimeMoves = Array.isArray(e.data.moves)
        ? e.data.moves
        : [e.data];
      if (rawRuntimeMoves.length === 0) return;
      var replayTransactionId =
        typeof e.data.transactionId === "string"
          ? e.data.transactionId
          : typeof rawRuntimeMoves[0]?.transactionId === "string"
            ? rawRuntimeMoves[0].transactionId
            : undefined;
      var runtimeReplayMoves: Array<{
        subject: Element;
        target: any;
        origin: any;
        transactionId?: string;
      }> = [];
      var replaySubjects: Element[] = [];
      for (var rawMove of rawRuntimeMoves) {
        var runtimePlacement = String(rawMove.placement || "");
        if (
          runtimePlacement !== "before" &&
          runtimePlacement !== "after" &&
          runtimePlacement !== "inside"
        ) {
          return;
        }
        var runtimeSubject = findUniqueRuntimeStructureTarget(
          String(rawMove.subjectSelector || rawMove.subject?.selector || ""),
          typeof rawMove.subjectSourceId === "string"
            ? rawMove.subjectSourceId
            : typeof rawMove.subject?.sourceId === "string"
              ? rawMove.subject.sourceId
              : "",
        );
        var runtimeAnchor = findUniqueRuntimeStructureTarget(
          String(rawMove.anchorSelector || rawMove.anchor?.selector || ""),
          typeof rawMove.anchorSourceId === "string"
            ? rawMove.anchorSourceId
            : typeof rawMove.anchor?.sourceId === "string"
              ? rawMove.anchor.sourceId
              : "",
        );
        if (
          !runtimeSubject ||
          !runtimeAnchor ||
          runtimeSubject === runtimeAnchor ||
          runtimeSubject.contains(runtimeAnchor)
        ) {
          return;
        }
        if (
          (runtimePlacement === "inside" &&
            !isContainerDropTarget(runtimeAnchor)) ||
          (runtimePlacement !== "inside" && !runtimeAnchor.parentElement)
        ) {
          return;
        }
        var runtimeTarget: any = {
          anchor: runtimeAnchor,
          placement: runtimePlacement,
          axis: parentFlowAxis(
            runtimePlacement === "inside"
              ? runtimeAnchor
              : runtimeAnchor.parentElement!,
          ),
          dropMode:
            runtimePlacement === "inside" &&
            isAbsolutePrimitiveContainer(runtimeAnchor)
              ? "absolute-container"
              : "flow-insert",
        };
        if (
          rawMove.gridPlacement &&
          Number.isInteger(rawMove.gridPlacement.column) &&
          Number.isInteger(rawMove.gridPlacement.row)
        ) {
          runtimeTarget.gridCell = {
            column: rawMove.gridPlacement.column - 1,
            row: rawMove.gridPlacement.row - 1,
          };
        }
        runtimeReplayMoves.push({
          subject: runtimeSubject,
          target: runtimeTarget,
          origin: {
            prevParent: runtimeSubject.parentElement!,
            prevNextSibling: runtimeSubject.nextSibling,
            prevInlinePositionStyles:
              snapshotInlinePositionStyles(runtimeSubject),
            prevInlineGridStyles: snapshotInlineGridStyles(runtimeSubject),
          },
          transactionId:
            typeof rawMove.transactionId === "string"
              ? rawMove.transactionId
              : replayTransactionId,
        });
        replaySubjects.push(runtimeSubject);
      }
      for (var replayMove of runtimeReplayMoves) {
        if (
          replayMove.target.gridCell &&
          replayMove.target.placement !== "inside"
        ) {
          var orderAnchor = replayMove.target.anchor;
          if (!orderAnchor.parentElement) return;
          replayMove.target.persistenceAnchor = orderAnchor;
          replayMove.target.persistencePlacement = replayMove.target.placement;
          replayMove.target.anchor = orderAnchor.parentElement;
          replayMove.target.placement = "inside";
          replayMove.target.axis = parentFlowAxis(orderAnchor.parentElement);
        }
        if (
          !applyRuntimeReorder(
            replayMove.subject,
            replayMove.target,
            false,
            replaySubjects,
          )
        ) {
          for (
            var rollbackIndex = runtimeReplayMoves.indexOf(replayMove);
            rollbackIndex >= 0;
            rollbackIndex -= 1
          ) {
            var rollbackMove = runtimeReplayMoves[rollbackIndex];
            if (!rollbackMove) continue;
            if (
              rollbackMove.origin.prevParent?.isConnected &&
              rollbackMove.subject.isConnected
            ) {
              rollbackMove.origin.prevParent.insertBefore(
                rollbackMove.subject,
                rollbackMove.origin.prevNextSibling?.parentNode ===
                  rollbackMove.origin.prevParent
                  ? rollbackMove.origin.prevNextSibling
                  : null,
              );
              restoreInlinePositionStyles(
                rollbackMove.subject,
                rollbackMove.origin.prevInlinePositionStyles,
              );
              restoreInlineGridStyles(
                rollbackMove.subject,
                rollbackMove.origin.prevInlineGridStyles,
              );
            }
            for (var displaced of rollbackMove.target
              .gridDisplacementPrevStyles ?? []) {
              restoreInlineGridStyles(displaced.element, displaced.styles);
            }
          }
          return;
        }
        selectedEl = replayMove.subject;
        positionOverlay(selectionOverlay, selectedEl);
      }
      for (var completedMove of runtimeReplayMoves) {
        postVisualStructureChange(
          completedMove.subject,
          completedMove.target,
          completedMove.origin,
          undefined,
          undefined,
          undefined,
          undefined,
          completedMove.transactionId,
        );
      }
      return;
    }
    if (e.data.type === "runtime-structure-insert") {
      var insertRequestId = e.data.requestId;
      var rejectInsert = function (reason: string): void {
        (window.parent as Window).postMessage(
          {
            type: "runtime-structure-insert-rejected",
            screenId: designCanvasScreenId,
            requestId: insertRequestId,
            transactionId:
              typeof e.data.transactionId === "string"
                ? e.data.transactionId
                : undefined,
            routePath: window.location.pathname + window.location.search,
            reason: reason,
          },
          "*",
        );
      };
      var acknowledgeInsert = function (
        element: Element,
        applied: boolean = true,
      ): void {
        (window.parent as Window).postMessage(
          {
            type: "runtime-structure-insert-applied",
            screenId: designCanvasScreenId,
            requestId: String(insertRequestId),
            applied,
            transactionId:
              typeof e.data.transactionId === "string"
                ? e.data.transactionId
                : undefined,
            routePath: window.location.pathname + window.location.search,
            selector: getSelector(element),
            sourceId: getSourceId(element),
          },
          "*",
        );
      };
      if (readOnly) {
        rejectInsert("read-only");
        return;
      }
      var insertPlacement = String(e.data.placement || "");
      var replaceInsertAnchor = e.data.replaceAnchor === true;
      if (
        insertPlacement !== "before" &&
        insertPlacement !== "after" &&
        insertPlacement !== "inside"
      ) {
        rejectInsert("placement");
        return;
      }
      var insertAnchor = findUniqueRuntimeStructureTarget(
        String(e.data.anchorSelector || ""),
        typeof e.data.anchorSourceId === "string" ? e.data.anchorSourceId : "",
        typeof e.data.anchorPendingNodeId === "string"
          ? e.data.anchorPendingNodeId
          : "",
        true,
      );
      if (!insertAnchor) {
        rejectInsert("anchor-unresolved");
        return;
      }
      if (
        (insertPlacement === "inside" &&
          !isContainerDropTarget(insertAnchor)) ||
        (insertPlacement !== "inside" && !insertAnchor.parentElement)
      ) {
        rejectInsert("placement-unavailable");
        return;
      }
      var parsedInsertEl = parseNodeHtmlPreviewElement(
        typeof e.data.html === "string" ? e.data.html : "",
      );
      if (
        !parsedInsertEl ||
        parsedInsertEl === document.body ||
        parsedInsertEl.tagName === "BODY"
      ) {
        rejectInsert("html");
        return;
      }
      var insertNodeId = parsedInsertEl.getAttribute(
        "data-agent-native-node-id",
      );
      var existingBeforeRemint: Element | null = null;
      if (insertNodeId) {
        existingBeforeRemint = document.querySelector(
          '[data-agent-native-node-id="' + escapeAttribute(insertNodeId) + '"]',
        );
      }
      var incomingRuntimeInstanceId = parsedInsertEl.getAttribute(
        "data-agent-native-runtime-instance-id",
      );
      var existingRuntimeInstanceId = existingBeforeRemint?.getAttribute(
        "data-agent-native-runtime-instance-id",
      );
      var reuseExistingRuntimeNode = Boolean(
        existingBeforeRemint &&
        incomingRuntimeInstanceId &&
        existingRuntimeInstanceId === incomingRuntimeInstanceId &&
        e.data.screenId === designCanvasScreenId &&
        e.data.sourceScreenId === designCanvasScreenId,
      );
      if (e.data.remintCollidingNodeIds === true && !reuseExistingRuntimeNode) {
        remintCollidingRuntimeNodeIds(parsedInsertEl);
      }
      insertNodeId = parsedInsertEl.getAttribute("data-agent-native-node-id");
      var existingInsertEl: Element | null = reuseExistingRuntimeNode
        ? existingBeforeRemint
        : null;
      if (existingInsertEl === insertAnchor) {
        rejectInsert("anchor-is-subject");
        return;
      }
      var insertTarget = {
        anchor: insertAnchor,
        placement: insertPlacement,
        axis: parentFlowAxis(
          insertPlacement === "inside"
            ? insertAnchor
            : insertAnchor.parentElement!,
        ),
        dropMode:
          insertPlacement === "inside" &&
          isAbsolutePrimitiveContainer(insertAnchor)
            ? "absolute-container"
            : "flow-insert",
      };
      if (existingInsertEl) {
        if (existingInsertEl.contains(insertAnchor)) {
          rejectInsert("anchor-inside-subject");
          return;
        }
        var reinsertOrigin = {
          prevParent: existingInsertEl.parentElement!,
          prevNextSibling: existingInsertEl.nextSibling,
          prevInlinePositionStyles:
            snapshotInlinePositionStyles(existingInsertEl),
        };
        var runtimeMutationApplied = applyRuntimeReorder(
          existingInsertEl,
          insertTarget,
        );
        selectedEl = existingInsertEl;
        positionOverlay(selectionOverlay, selectedEl);
        refreshOverlays();
        if (runtimeMutationApplied) {
          postVisualStructureChange(
            existingInsertEl,
            insertTarget,
            reinsertOrigin,
          );
        }
        acknowledgeInsert(existingInsertEl, runtimeMutationApplied);
        return;
      }
      var insertTransactionId =
        typeof e.data.transactionId === "string" ? e.data.transactionId : "";
      if (insertTransactionId) {
        (parsedInsertEl as unknown as Record<symbol, string>)[
          runtimeStructureInsertTransactionKey
        ] = insertTransactionId;
      }
      if (replaceInsertAnchor) {
        var replaceParent = insertAnchor.parentElement;
        if (!replaceParent) {
          rejectInsert("placement-unavailable");
          return;
        }
        var replaceNextSibling = insertAnchor.nextSibling;
        replaceParent.insertBefore(parsedInsertEl, insertAnchor);
        var replacementSnapshot = serializeRuntimeLayerSnapshot(insertAnchor);
        if (!replacementSnapshot.ok) {
          parsedInsertEl.remove();
          rejectInsert("replacement-" + replacementSnapshot.reason);
          return;
        }
        selectedEl = parsedInsertEl;
        positionOverlay(selectionOverlay, selectedEl);
        refreshOverlays();
        postVisualStructureChange(
          parsedInsertEl,
          insertTarget,
          {
            replaced: true,
            originalElement: insertAnchor,
            prevParent: replaceParent,
            prevNextSibling: replaceNextSibling,
          },
          parsedInsertEl.outerHTML,
          true,
          replacementSnapshot.html,
          undefined,
          typeof e.data.transactionId === "string"
            ? e.data.transactionId
            : undefined,
          String(insertRequestId),
          true,
        );
        replaceParent.removeChild(insertAnchor);
        refreshOverlays();
        acknowledgeInsert(parsedInsertEl);
        return;
      }
      if (insertPlacement === "inside") {
        insertAnchor.appendChild(parsedInsertEl);
      } else {
        insertAnchor.parentElement!.insertBefore(
          parsedInsertEl,
          insertPlacement === "before"
            ? insertAnchor
            : insertAnchor.nextSibling,
        );
      }
      selectedEl = parsedInsertEl;
      positionOverlay(selectionOverlay, selectedEl);
      refreshOverlays();
      postVisualStructureChange(
        parsedInsertEl,
        insertTarget,
        { inserted: true },
        parsedInsertEl.outerHTML,
        undefined,
        undefined,
        undefined,
        typeof e.data.transactionId === "string"
          ? e.data.transactionId
          : undefined,
        String(insertRequestId),
        true,
      );
      acknowledgeInsert(parsedInsertEl);
      return;
    }
    if (e.data.type === "visual-structure-ack") {
      dndLog("ack", {
        requestId: e.data.requestId,
        applied: Boolean(e.data.applied),
      });
      var cancelRuntimeStructureDelete = e.data.cancelRuntimeStructureDelete;
      var postRuntimeStructureDeleteCancellationResult = function (
        sourcePresentOverride?: boolean,
      ) {
        if (
          !cancelRuntimeStructureDelete ||
          typeof cancelRuntimeStructureDelete.transactionId !== "string"
        ) {
          return;
        }
        var restoredSource = findRuntimeTarget(
          String(cancelRuntimeStructureDelete.selector || ""),
          Array.isArray(cancelRuntimeStructureDelete.selectorCandidates)
            ? cancelRuntimeStructureDelete.selectorCandidates
            : [],
        );
        (window.parent as Window).postMessage(
          {
            type: "runtime-structure-delete-cancelled",
            requestId: String(e.data.requestId || ""),
            transactionId: cancelRuntimeStructureDelete.transactionId,
            routePath: window.location.pathname + window.location.search,
            sourcePresent:
              typeof sourcePresentOverride === "boolean"
                ? sourcePresentOverride
                : Boolean(restoredSource),
          },
          "*",
        );
      };
      var move = pendingStructureMoves[e.data.requestId];
      if (!move) {
        postRuntimeStructureDeleteCancellationResult();
        return;
      }
      delete pendingStructureMoves[e.data.requestId];
      var moveWasInsert = Boolean(move.origin && "inserted" in move.origin);
      var moveWasRemoval = Boolean(move.origin && "removed" in move.origin);
      var moveWasReplace = Boolean(move.origin && "replaced" in move.origin);
      if (moveWasReplace && move.origin && "replaced" in move.origin) {
        if (!e.data.applied) {
          if (move.el && move.el.isConnected) move.el.remove();
          var replaceParent = move.origin.prevParent;
          var replaceNextSibling = move.origin.prevNextSibling;
          if (
            replaceParent &&
            replaceParent.isConnected &&
            !move.origin.originalElement.isConnected
          ) {
            replaceParent.insertBefore(
              move.origin.originalElement,
              replaceNextSibling &&
                replaceNextSibling.parentNode === replaceParent
                ? replaceNextSibling
                : null,
            );
            selectedEl = move.origin.originalElement;
            positionOverlay(selectionOverlay, selectedEl);
            postElementSelect(selectedEl);
          }
        }
        refreshOverlays();
        postRuntimeStructureDeleteCancellationResult();
        return;
      }
      if (moveWasRemoval) {
        if (!e.data.applied && move.origin && "removed" in move.origin) {
          var removedParent = move.origin.prevParent;
          var removedNextSibling = move.origin.prevNextSibling;
          if (
            removedParent &&
            removedParent.isConnected &&
            !move.el.isConnected
          ) {
            removedParent.insertBefore(
              move.el,
              removedNextSibling &&
                removedNextSibling.parentNode === removedParent
                ? removedNextSibling
                : null,
            );
            selectedEl = move.el;
            positionOverlay(selectionOverlay, selectedEl);
            postElementSelect(selectedEl);
          }
        }
        refreshOverlays();
        postRuntimeStructureDeleteCancellationResult(
          Boolean(move.el && move.el.isConnected),
        );
        return;
      }
      if (e.data.applied) {
        if (!moveWasInsert && move.el && move.el.isConnected && move.target) {
          applyRuntimeReorder(move.el, move.target);
          selectedEl = move.el;
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
        }
      } else {
        if (moveWasInsert) {
          var selectionBelongsToRejectedClone = Boolean(
            move.el &&
            selectedEl &&
            (selectedEl === move.el || move.el.contains(selectedEl)),
          );
          if (move.el && move.el.isConnected) move.el.remove();
          if (
            selectionBelongsToRejectedClone &&
            move.origin &&
            "inserted" in move.origin &&
            move.origin.fallbackSelection &&
            move.origin.fallbackSelection.isConnected
          ) {
            selectedEl = move.origin.fallbackSelection;
            positionOverlay(selectionOverlay, selectedEl);
            postElementSelect(selectedEl);
          } else if (selectedEl === move.el) {
            selectedEl = null;
          }
          if (hoveredEl === move.el) hoveredEl = null;
          refreshOverlays();
          postRuntimeStructureDeleteCancellationResult();
          return;
        }
        if (
          move.el &&
          move.el.isConnected &&
          move.origin &&
          "prevParent" in move.origin &&
          move.origin.prevParent &&
          move.origin.prevParent.isConnected
        ) {
          move.origin.prevParent.insertBefore(
            move.el,
            move.origin.prevNextSibling?.parentNode === move.origin.prevParent
              ? move.origin.prevNextSibling
              : null,
          );
          restoreInlinePositionStyles(
            move.el,
            move.origin.prevInlinePositionStyles,
          );
          restoreInlineGridStyles(move.el, move.origin.prevInlineGridStyles);
          if (move.origin.gridDisplacements) {
            move.origin.gridDisplacements.forEach(function (displaced) {
              restoreInlineGridStyles(displaced.element, displaced.styles);
            });
          }
          selectedEl = move.el;
          positionOverlay(selectionOverlay, selectedEl);
          postElementSelect(selectedEl);
        }
      }
      postRuntimeStructureDeleteCancellationResult();
      return;
    }
    if (e.data.type === "replace-document-content") {
      activeNodeHtmlPreview = null;
      replaceRuntimeDocument(
        e.data.content,
        e.data.selectedSelector,
        e.data.selectorCandidates,
        Boolean(e.data.forceFullDocument),
        Boolean(e.data.preserveTextEditingSession),
        e.data.sourceProvenance,
      );
      return;
    }
    if (e.data.type === "node-html-preview") {
      if (e.data.operation === "restore") {
        if (typeof e.data.proposalId === "string") {
          restoreActiveNodeHtmlPreview(e.data.proposalId);
        }
      } else if (e.data.operation === "preview") {
        applyNodeHtmlPreview(e.data);
      }
      return;
    }
    if (e.data.type === "delete-element") {
      removeRuntimeTarget(
        e.data.selector,
        e.data.selectorCandidates,
        e.data.requestId,
        e.data.transactionId,
      );
      return;
    }
    if (e.data.type === "pending-delete-element") {
      concealPendingRuntimeDelete(
        e.data.selector,
        e.data.selectorCandidates,
        e.data.requestId,
      );
      return;
    }
    if (e.data.type === "cancel-pending-delete-element") {
      var pendingDeleteTarget = findRuntimeTarget(
        e.data.selector,
        e.data.selectorCandidates,
      );
      if (pendingDeleteTarget) {
        restorePendingRuntimeDeleteStyle(pendingDeleteTarget, e.data.requestId);
      }
      return;
    }
    if (e.data.type === "runtime-structure-rollback-insert") {
      var rollbackRequestId = String(e.data.requestId || "");
      var rollbackTransactionId =
        typeof e.data.transactionId === "string" ? e.data.transactionId : "";
      var rollbackTargets = rollbackTransactionId
        ? Array.from(document.querySelectorAll("*")).filter(
            (element) =>
              (element as unknown as Record<symbol, string>)[
                runtimeStructureInsertTransactionKey
              ] === rollbackTransactionId,
          )
        : [];
      if (rollbackTargets.length === 0) {
        var rollbackTarget = findUniqueRuntimeStructureTarget(
          String(e.data.selector || ""),
          typeof e.data.sourceId === "string" ? e.data.sourceId : "",
        );
        if (rollbackTarget) rollbackTargets = [rollbackTarget];
      }
      if (!rollbackRequestId || rollbackTargets.length === 0) {
        (window.parent as Window).postMessage(
          {
            type: "runtime-structure-rollback-result",
            requestId: rollbackRequestId,
            transactionId: e.data.transactionId,
            applied: false,
            reason: "target-unresolved",
          },
          "*",
        );
        return;
      }
      for (var rollbackTarget of rollbackTargets) {
        if (
          rollbackTarget === selectedEl ||
          rollbackTarget.contains(selectedEl)
        ) {
          selectedEl = null;
        }
        if (
          rollbackTarget === hoveredEl ||
          rollbackTarget.contains(hoveredEl)
        ) {
          hoveredEl = null;
        }
        rollbackTarget.parentElement?.removeChild(rollbackTarget);
      }
      publishSourceDocumentProvenance(undefined, true);
      refreshOverlays();
      (window.parent as Window).postMessage(
        {
          type: "runtime-structure-rollback-result",
          requestId: rollbackRequestId,
          transactionId: e.data.transactionId,
          applied: true,
        },
        "*",
      );
      return;
    }
    if (e.data.type === "set-text-content") {
      var textTarget = findRuntimeTarget(
        String(e.data.selector || ""),
        Array.isArray(e.data.selectorCandidates)
          ? e.data.selectorCandidates
          : [],
      ) as HTMLElement | null;
      if (!textTarget) return;
      if (typeof e.data.html === "string") {
        textTarget.innerHTML = e.data.html;
      } else {
        textTarget.textContent =
          typeof e.data.value === "string" ? e.data.value : "";
      }
      claimContentAsSource(textTarget);
      publishSourceDocumentProvenance(undefined, true);
      refreshOverlays();
      return;
    }
    if (e.data.type === "request-runtime-layer-snapshot") {
      requestRuntimeLayerSnapshot();
      return;
    }
    if (e.data.type === "grant-runtime-layer-snapshot-reservation") {
      if (
        e.data.documentId !== runtimeDocumentId ||
        e.data.requestId !== runtimeLayerSnapshotReservationRequestId
      ) {
        return;
      }
      runtimeLayerSnapshotReservationInFlight = false;
      if (runtimeLayerSnapshotReservationDirty) {
        runtimeLayerSnapshotReservationDirty = false;
        requestRuntimeLayerSnapshot();
        return;
      }
      postRuntimeLayerSnapshot(
        typeof e.data.reservationToken === "string"
          ? e.data.reservationToken
          : undefined,
        Number.isSafeInteger(e.data.requestId) ? e.data.requestId : undefined,
      );
      return;
    }
    if (e.data.type === "runtime-layer-rename") {
      if (readOnly) return;
      var renameName =
        typeof e.data.name === "string" ? e.data.name.trim().slice(0, 200) : "";
      if (!renameName) return;
      var renameCandidates = Array.isArray(e.data.selectorCandidates)
        ? e.data.selectorCandidates
        : [];
      if (
        e.data.selector &&
        renameCandidates.indexOf(String(e.data.selector)) === -1
      ) {
        renameCandidates.push(String(e.data.selector));
      }
      if (typeof e.data.sourceId === "string" && e.data.sourceId) {
        renameCandidates.push(
          '[data-agent-native-node-id="' +
            String(e.data.sourceId).replace(/"/g, '\\"') +
            '"]',
        );
      }
      var renameTarget = findRuntimeTarget(
        String(e.data.selector || ""),
        renameCandidates,
      );
      if (!renameTarget) return;
      var previousLayerName =
        renameTarget.getAttribute("data-agent-native-layer-name") || "";
      renameTarget.setAttribute("data-agent-native-layer-name", renameName);
      claimContentAsSource(renameTarget);
      publishSourceDocumentProvenance(undefined, true);
      postRuntimeLayerSnapshot();
      refreshOverlays();
      (window.parent as Window).postMessage(
        {
          type: "runtime-layer-name-applied",
          requestId: Number(e.data.requestId),
          routePath: window.location.pathname + window.location.search,
          selector: getSelector(renameTarget),
          sourceId:
            typeof e.data.sourceId === "string" ? e.data.sourceId : undefined,
          name: renameName,
          previousName: previousLayerName,
        },
        "*",
      );
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
    var textEditStyleTarget =
      activeTextEditEl || suspendedTextEditRange?.target || null;
    var textEditStyleSelector = activeTextEditEl
      ? activeTextEditStyleSelector
      : suspendedTextEditRange?.selector || "";
    var styleChangeTargetsActiveTextEdit =
      !!textEditStyleTarget &&
      !!el &&
      (el === textEditStyleTarget || el.contains(textEditStyleTarget)) &&
      (!!activeTextEditEl ||
        !textEditStyleSelector ||
        candidatesForStyle.indexOf(textEditStyleSelector) !== -1);
    if (
      prop &&
      styleChangeTargetsActiveTextEdit &&
      applyTextRangeStyle(prop, val)
    ) {
      postTextContentChange(
        textEditStyleTarget,
        textEditStyleTarget!.textContent || "",
        textEditStyleTarget!.innerHTML || "",
        undefined,
        undefined,
        prop && e.data.relativeOperation
          ? { [prop]: e.data.relativeOperation }
          : undefined,
      );
      postTextEditingState(
        textEditStyleTarget,
        !!activeTextEditEl,
        textEditStyleSelector,
        true,
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
      var styleTargets = repeatStyleTargets(el);
      for (var st = 0; st < styleTargets.length; st += 1) {
        applyInlineStyleProperty(styleTargets[st]!, prop, val);
      }
      didPatchDom = true;
    }
    if (didPatchDom) {
      refreshOverlays();
    }
  });

  window.addEventListener("scroll", scheduleRefreshOverlays, true);
  window.addEventListener("resize", scheduleRefreshOverlays);

  // that starts the drag) and would otherwise be the same kind of race
  function isNativeInteractionNetExempt(target: Element | null): boolean {
    return (
      isOverlayElement(target) ||
      isEditorTypingTarget(target) ||
      !!activeDragCancel
    );
  }

  function interceptNativeInteractionNet(e: Event): void {
    if (readOnly || interactionMode) return;
    var target =
      e.target && (e.target as Element).nodeType === 1
        ? (e.target as Element)
        : null;
    if (isNativeInteractionNetExempt(target)) return;
    stopNativeInteraction(e);
  }

  [
    "click",
    "auxclick",
    "dblclick",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
    "submit",
  ].forEach(function (type) {
    document.addEventListener(type, interceptNativeInteractionNet, true);
  });

  function isFocusedActivationTarget(target: Element | null): boolean {
    return !!(
      target &&
      target.closest &&
      target.closest(
        'a[href], button, summary, input[type="submit"], input[type="button"], input[type="reset"], input[type="image"], [role="button"], [role="link"]',
      )
    );
  }

  document.addEventListener(
    "keydown",
    function (e: KeyboardEvent) {
      if (readOnly) return;
      if (e.key !== "Enter" && !(e.key === " " && e.code === "Space")) return;
      var target =
        e.target && (e.target as Element).nodeType === 1
          ? (e.target as Element)
          : null;
      if (isNativeInteractionNetExempt(target)) return;
      if (!isFocusedActivationTarget(target)) return;
      stopNativeInteraction(e);
    },
    true,
  );

  applyEditorChromeScale();

  if (
    runtimeLayerSnapshotEnabled &&
    typeof MutationObserver !== "undefined" &&
    document.body
  ) {
    var runtimeLayerObserver = new MutationObserver(function (mutations) {
      var hasMeaningfulMutation = mutations.some(
        runtimeLayerMutationIsMeaningful,
      );
      if (hasMeaningfulMutation) scheduleRuntimeLayerSnapshot();
    });
    runtimeLayerObserver.observe(document.body, {
      attributes: true,
      attributeOldValue: true,
      childList: true,
      characterData: true,
      subtree: true,
      attributeFilter: [
        "aria-label",
        "class",
        "data-agent-native-component",
        "data-agent-native-runtime-component-capability",
        "data-agent-native-runtime-component-id",
        "data-agent-native-runtime-instance-id",
        "data-agent-native-layer-name",
        "data-layer-name",
        "layer-name",
        "data-an-primitive",
        "data-component-name",
        "data-source-column",
        "data-source-file",
        "data-source-line",
        "hidden",
        "id",
        "style",
        "title",
      ],
    });
  }
  var frameLabelRefreshScheduled = false;
  function scheduleFrameNameLabels(): void {
    if (frameLabelRefreshScheduled) return;
    frameLabelRefreshScheduled = true;
    window.requestAnimationFrame(function () {
      frameLabelRefreshScheduled = false;
      refreshFrameNameLabels();
    });
  }
  if (typeof MutationObserver !== "undefined" && document.body) {
    new MutationObserver(function (mutations) {
      var touchedContent = mutations.some(function (mutation) {
        var target = mutation.target;
        return !(target instanceof Element) || !isOverlayElement(target);
      });
      if (touchedContent) scheduleFrameNameLabels();
    }).observe(document.body, {
      attributes: true,
      attributeFilter: [
        "data-agent-native-layer-name",
        "data-layer-name",
        "layer-name",
        "data-an-primitive",
        "class",
        "style",
      ],
      childList: true,
      subtree: true,
    });
  }
  refreshFrameNameLabels();
  hydrateVectorEndpointMarkers();

  captureInitialSourceOwnership();
  if (runtimeLayerSnapshotEnabled) scheduleRuntimeLayerSnapshot();
  if (document.readyState === "complete") {
    scheduleScreenRootStyleSnapshot();
  } else {
    window.addEventListener("load", scheduleScreenRootStyleSnapshot, {
      once: true,
    });
  }
  window.addEventListener("resize", scheduleScreenRootStyleSnapshot);
  if (typeof MutationObserver !== "undefined" && document.body) {
    new MutationObserver(scheduleScreenRootStyleSnapshot).observe(
      document.body,
      { attributes: true, attributeFilter: ["class", "style"] },
    );
  }

  var fontMetadataRefreshFrame = 0;
  function refreshSelectedTextAfterFontsLoad(): void {
    if (fontMetadataRefreshFrame) return;
    fontMetadataRefreshFrame = window.requestAnimationFrame(function () {
      fontMetadataRefreshFrame = 0;
      var currentSelection = selectedEl;
      if (
        !currentSelection ||
        !currentSelection.isConnected ||
        !document.documentElement.contains(currentSelection) ||
        passiveSelectionEls.length > 0
      ) {
        return;
      }
      if (isWholeTextStyleRoot(currentSelection)) {
        postElementSelect(currentSelection);
      }

      var textEditTarget =
        activeTextEditEl || suspendedTextEditRange?.target || null;
      if (
        !textEditTarget ||
        !textEditTarget.isConnected ||
        !document.documentElement.contains(textEditTarget) ||
        (textEditTarget !== currentSelection &&
          !currentSelection.contains(textEditTarget) &&
          !textEditTarget.contains(currentSelection))
      ) {
        return;
      }
      var active = activeTextEditEl === textEditTarget;
      if (
        active &&
        !textEditTarget.hasAttribute("data-agent-native-text-editing")
      ) {
        return;
      }
      var selector = active
        ? activeTextEditStyleSelector
        : suspendedTextEditRange?.selector || "";
      postTextEditingState(textEditTarget, active, selector);
    });
  }
  if (document.fonts && typeof document.fonts.addEventListener === "function") {
    document.fonts.addEventListener(
      "loadingdone",
      refreshSelectedTextAfterFontsLoad,
    );
  }

  (window as any).__anEditorChromeBridgeInstance = {
    repair: function () {
      observeEditorChromeHost();
      repairEditorChromeHost();
    },
    updateConfig: function (next) {
      if (!next || typeof next !== "object") return;
      var nextReadOnly =
        typeof next.readOnly === "boolean" ? next.readOnly : readOnly;
      var nextTextEditingEnabledFlag =
        typeof next.textEditingEnabled === "boolean"
          ? next.textEditingEnabled
          : textEditingEnabledFlag;
      if (readOnly !== nextReadOnly) {
        readOnly = nextReadOnly;
        if (readOnly) {
          clearPendingShieldDrag();
          cancelActiveBridgeDrag();
        }
      }
      textEditingEnabledFlag = nextTextEditingEnabledFlag;
      textEditingEnabled =
        !readOnly && !interactionMode && textEditingEnabledFlag;
      if (activeTextEditEl && (readOnly || !textEditingEnabled)) {
        activeTextEditEl.blur();
      }
      if (interactionMode) {
        setSelectionOverlayResizeChromeVisible(false);
        hideSelectionOverlay();
        highlightOverlay.style.display = "none";
        marqueeSelectionOverlay.style.display = "none";
        syncShieldPointerEvents();
      } else {
        setSelectionOverlayResizeChromeVisible(!readOnly && !activeTextEditEl);
        syncShieldPointerEvents();
        if (selectedEl?.isConnected)
          positionOverlay(selectionOverlay, selectedEl);
      }
      if (typeof next.screenId === "string") {
        designCanvasScreenId = next.screenId;
      }
      if (typeof next.boardSurface === "boolean") {
        designCanvasBoardSurface = next.boardSurface;
      }
      if (Number.isFinite(next.contentOffsetX)) {
        designCanvasContentOffsetX = next.contentOffsetX;
      }
      if (Number.isFinite(next.contentOffsetY)) {
        designCanvasContentOffsetY = next.contentOffsetY;
      }
      if (editorChromeHost) syncEditorChromeHostStyle(editorChromeHost);
    },
  };

  observeEditorChromeHost();
  sendEditorChromeReady();
  if (document.readyState === "complete") {
    sendEditorChromeReady();
  } else {
    window.addEventListener("load", sendEditorChromeReady, { once: true });
  }
})();
