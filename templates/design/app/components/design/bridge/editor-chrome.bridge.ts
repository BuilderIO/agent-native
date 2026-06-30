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

(function () {
  var readOnly = __READ_ONLY__;
  var textEditingEnabled = !readOnly && __TEXT_EDITING_ENABLED__;
  var scaleToolEnabled = false;
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
  (function () {
    var chromeTransitionStyle = document.createElement("style");
    chromeTransitionStyle.textContent =
      '[data-agent-native-edit-overlay="selection"]{transition:border-width 150ms ease-out}' +
      "[data-agent-native-edge-handle],[data-agent-native-edit-handle],[data-agent-native-rotate-handle]{transition:width 150ms ease-out,height 150ms ease-out,border-width 150ms ease-out,top 150ms ease-out,bottom 150ms ease-out,left 150ms ease-out,right 150ms ease-out}" +
      "[data-agent-native-spacing-line]{position:absolute;display:none;pointer-events:none;border-radius:999px}" +
      "[data-agent-native-spacing-region]{position:absolute;display:none;box-sizing:border-box;pointer-events:auto;background-size:6px 6px}" +
      '[data-agent-native-spacing-region][data-orientation="vertical"]{cursor:ew-resize}' +
      '[data-agent-native-spacing-region][data-orientation="horizontal"]{cursor:ns-resize}';
    (document.head || document.documentElement).appendChild(
      chromeTransitionStyle,
    );
  })();

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

  function getElementInfo(el: Element): unknown {
    var cs = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var parentStyles = el.parentElement
      ? window.getComputedStyle(el.parentElement)
      : null;
    var parentDisplay = parentStyles ? parentStyles.display : undefined;
    var sourceBacked =
      hasStableOwnSource(el) || !!closestStableSourceElement(el);
    var sourceId = sourceBacked ? getSourceId(el) || getSelector(el) : "";
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
    if (
      sourceBacked &&
      (parentDisplay === "flex" ||
        parentDisplay === "inline-flex" ||
        parentDisplay === "grid" ||
        parentDisplay === "inline-grid")
    ) {
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
      id: el.id || undefined,
      sourceId: sourceId,
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
        boxShadow: cs.boxShadow,
        textShadow: cs.textShadow,
        filter: cs.filter,
        mixBlendMode: cs.mixBlendMode,
        zIndex: cs.zIndex,
      },
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
      isFlexContainer: cs.display === "flex" || cs.display === "inline-flex",
      isFlexChild: parentDisplay === "flex" || parentDisplay === "inline-flex",
      parentDisplay: parentDisplay,
      parentLayout: parentLayout,
      editCapabilities: capabilities,
      confidence: capabilities.reduce(function (best, item) {
        return Math.max(best, item.confidence || 0);
      }, 0),
      provenance: provenance,
    };
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
      "background:var(--design-editor-accent-color)",
      "color:var(--design-editor-accent-contrast-color)",
      "box-shadow:0 1px 4px color-mix(in srgb,var(--design-editor-accent-color) 40%,transparent)",
      "border:1px solid color-mix(in srgb,var(--design-editor-accent-strong-color) 60%,transparent)",
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

  function updateComponentTag(el: Element | null): void {
    if (!el) {
      clearComponentTag();
      return;
    }
    var compName =
      el.getAttribute && el.getAttribute("data-agent-native-component");
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

    var rect = el.getBoundingClientRect();
    var tagHeight = 22;
    var tagTop = rect.top - tagHeight - 4;
    if (tagTop < 4) tagTop = rect.top + 4;
    componentTagOverlay.style.display = "block";
    componentTagOverlay.style.left = rect.left + "px";
    componentTagOverlay.style.top = tagTop + "px";
    // Accent outline on the selection overlay to distinguish component roots.
    selectionOverlay.style.outline =
      "2px solid var(--design-editor-accent-strong-color)";
    selectionOverlay.style.outlineOffset = "2px";
  }

  function clearComponentTag(): void {
    componentTagOverlay.style.display = "none";
    componentTagOverlay.removeAttribute("data-component-node-id");
    componentTagOverlay.removeAttribute("data-component-name");
    selectionOverlay.style.outline = "";
    selectionOverlay.style.outlineOffset = "";
  }

  var selectedEl: Element | null = null;
  var hoveredEl: Element | null = null;
  var activeTextEditEl: HTMLElement | null = null;
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
  var spacingHandleStateByKey: Record<string, { value: number }> = {};
  var spacingHandleNodesByKey: Record<string, Element> = {};
  var spacingOverlayRenderKey = "";
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
    selectedSpacingHovered = false;
    hoveredSpacingHandleKey = "";
    spacingDrag = null;
    selectionOverlay.style.display = "none";
    highlightOverlay.style.display = "none";
    hideSpacingOverlay();
    hideMeasurements();
    clearComponentTag();
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
  ): void {
    if (typeof html !== "string") return;
    if (activeTextEditEl) {
      applyHiddenSelectors();
      refreshOverlays();
      return;
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
    if (
      nextHeadHtml === document.head.innerHTML &&
      activeCandidates.length > 0
    ) {
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
          (window.parent as Window).postMessage(
            { type: "element-select", payload: getElementInfo(selectedEl) },
            "*",
          );
        } else {
          selectionOverlay.style.display = "none";
        }
        highlightOverlay.style.display = "none";
        hideMeasurements();
        refreshOverlays();
        return;
      }
    }
    if (document.head.innerHTML !== nextHeadHtml) {
      document.head.innerHTML = nextHeadHtml;
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
      (window.parent as Window).postMessage(
        { type: "element-select", payload: getElementInfo(selectedEl) },
        "*",
      );
    } else {
      selectionOverlay.style.display = "none";
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
    spacingOverlayRenderKey = "";
    if (!spacingDrag) spacingBadge.style.display = "none";
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
    return (
      "repeating-linear-gradient(" +
      angle +
      ", " +
      stripe +
      " 0 1px, " +
      tint +
      " 1px 4px, transparent 4px 7px)"
    );
  }

  function clampSpacingValue(value: number): number {
    var rounded = Math.round(value);
    if (!Number.isFinite(rounded)) return 0;
    return Math.max(0, Math.min(999, rounded));
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
    line?: unknown;
  }): unknown {
    var region = config.region;
    if (!region || region.width <= 0 || region.height <= 0) return null;
    return {
      key: config.key,
      groupKey: config.groupKey || config.key,
      kind: config.kind,
      property: config.property,
      oppositeProperty: config.oppositeProperty || "",
      side: config.side || "",
      orientation: config.orientation,
      value: clampSpacingValue(config.value),
      region: {
        x: Math.round(region.x),
        y: Math.round(region.y),
        width: Math.max(1, Math.round(region.width)),
        height: Math.max(1, Math.round(region.height)),
      },
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
    var line = Math.max(1, chromeLineScale());
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
    var line = Math.max(1, chromeLineScale());
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
  ): void {
    if (!selectedEl || !handle) {
      spacingBadge.style.display = "none";
      return;
    }
    var rect = selectedEl.getBoundingClientRect();
    var x = rect.left + handle.region.x + handle.region.width / 2;
    var y = rect.top + handle.region.y + handle.region.height / 2;
    spacingBadge.textContent = String(clampSpacingValue(value));
    spacingBadge.style.display = "block";
    spacingBadge.style.background = spacingColor(handle.kind);
    spacingBadge.style.left = x + "px";
    spacingBadge.style.top = y + "px";
    spacingBadge.style.transform = "translate(-50%, -50%)";
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
      line: { x: number; y: number; width: number; height: number } | undefined;
    } | null,
    activeGroupKey: string,
  ): void {
    if (!handle) return;
    spacingHandleStateByKey[handle.key] = handle;
    var highlighted = Boolean(
      activeGroupKey && handle.groupKey === activeGroupKey,
    );
    var lineNode = document.createElement("span");
    lineNode.setAttribute("data-agent-native-spacing-line", handle.kind);
    lineNode.style.display = "block";
    lineNode.style.left = handle.line.x + "px";
    lineNode.style.top = handle.line.y + "px";
    lineNode.style.width = Math.max(1, handle.line.width) + "px";
    lineNode.style.height = Math.max(1, handle.line.height) + "px";
    lineNode.style.background = spacingColor(handle.kind);
    spacingOverlay.appendChild(lineNode);

    var regionNode = document.createElement("span");
    regionNode.setAttribute("data-agent-native-spacing-region", handle.kind);
    regionNode.setAttribute("data-orientation", handle.orientation);
    regionNode.setAttribute("data-spacing-key", handle.key);
    regionNode.style.display = "block";
    regionNode.style.left = handle.region.x + "px";
    regionNode.style.top = handle.region.y + "px";
    regionNode.style.width = handle.region.width + "px";
    regionNode.style.height = handle.region.height + "px";
    regionNode.style.background = highlighted
      ? spacingFill(handle.kind, handle.orientation)
      : "transparent";
    regionNode.style.outline = highlighted
      ? "1px solid " + spacingColor(handle.kind)
      : "0";
    regionNode.style.outlineOffset = "-1px";
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

  function updateSpacingOverlay(el: Element | null): void {
    if (el && el !== selectedEl) {
      hideSpacingOverlay();
      return;
    }
    if (!selectedEl || !document.documentElement.contains(selectedEl)) {
      hideSpacingOverlay();
      return;
    }
    if (!selectedSpacingHovered && !hoveredSpacingHandleKey && !spacingDrag) {
      hideSpacingOverlay();
      return;
    }
    var handles = buildSpacingHandles(selectedEl);
    if (handles.length === 0) {
      hideSpacingOverlay();
      return;
    }
    var activeHandle =
      (spacingDrag && spacingDrag.handle) ||
      handles.find(function (handle) {
        return handle.key === hoveredSpacingHandleKey;
      }) ||
      null;
    var activeGroupKey = activeHandle ? activeHandle.groupKey : "";
    var nextRenderKey =
      activeGroupKey +
      "|" +
      handles
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
      if (activeHandle) {
        showSpacingBadgeForHandle(
          activeHandle,
          spacingDrag ? spacingDrag.currentValue : activeHandle.value,
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
    handles.forEach(function (handle) {
      renderSpacingHandle(handle, activeGroupKey);
    });
    if (activeHandle) {
      showSpacingBadgeForHandle(
        activeHandle,
        spacingDrag ? spacingDrag.currentValue : activeHandle.value,
      );
    } else {
      spacingBadge.style.display = "none";
    }
  }

  function handleSpacingOverlayPointerMove(e: PointerEvent): void {
    if (spacingDrag) return;
    var target =
      e.target && e.target.closest
        ? e.target.closest("[data-agent-native-spacing-region]")
        : null;
    var spacingKey =
      target && target.getAttribute
        ? target.getAttribute("data-spacing-key")
        : "";
    if (!spacingKey) return;
    stopNativeInteraction(e);
    selectedSpacingHovered = true;
    if (hoveredSpacingHandleKey !== spacingKey) {
      hoveredSpacingHandleKey = spacingKey;
      updateSpacingOverlay(selectedEl);
    }
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
      if (spacingKey) hoveredSpacingHandleKey = spacingKey;
      selectedSpacingHovered = true;
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
    highlightOverlay.style.borderWidth = 1.5 * line + "px";
    selectionOverlay.style.borderWidth = 1.5 * line + "px";
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
        handle.style.borderWidth = Math.max(1, 1 * line) + "px";
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

  function positionOverlay(overlay: HTMLElement, el: Element): void {
    if (!el || !document.documentElement.contains(el)) {
      overlay.style.display = "none";
      if (overlay === selectionOverlay) clearComponentTag();
      return;
    }
    // For the selection overlay, prefer the CSS box + rotation transform so
    // the handles hug the rotated element rather than its inflated AABB.
    if (overlay === selectionOverlay) {
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
      // Convert element-local left/top to viewport coords by walking to the
      // nearest positioned ancestor (same reference frame as getBoundingClientRect).
      if (canUseLocalBox) {
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
        updateSpacingOverlay(el);
        updateComponentTag(el);
        return;
      }
    }
    var rect = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    overlay.style.transform = "";
    if (overlay === selectionOverlay) {
      updateSpacingOverlay(el);
      updateComponentTag(el);
    }
  }

  function refreshOverlays(): void {
    if (hoveredEl && hoveredEl !== selectedEl) {
      positionOverlay(highlightOverlay, hoveredEl);
    } else {
      highlightOverlay.style.display = "none";
    }
    if (selectedEl) positionOverlay(selectionOverlay, selectedEl);
  }

  function hideMeasurements(): void {
    measurementOverlay.style.display = "none";
    measurementOverlay.innerHTML = "";
  }

  function addMeasurementLine(x1, y1, x2, y2, label) {
    var horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    var line = document.createElement("div");
    var labelEl = document.createElement("div");
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
        "px;border-top:1px dashed var(--design-editor-measure-color);";
      labelEl.style.cssText =
        "position:fixed;left:" +
        (left + width / 2) +
        "px;top:" +
        (y1 - 9) +
        "px;transform:translateX(-50%);border-radius:3px;background:var(--design-editor-measure-color);color:white;padding:1px 4px;";
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
        "px;border-left:1px dashed var(--design-editor-measure-color);";
      labelEl.style.cssText =
        "position:fixed;left:" +
        (x1 + 5) +
        "px;top:" +
        (top + height / 2) +
        "px;transform:translateY(-50%);border-radius:3px;background:var(--design-editor-measure-color);color:white;padding:1px 4px;";
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

  function isEditorTypingTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      'input, textarea, select, [contenteditable], [role="textbox"], [data-agent-native-text-editing]',
    );
  }

  function shouldForwardDesignHotkey(e) {
    if (activeTextEditEl || isEditorTypingTarget(e.target) || e.isComposing)
      return false;
    var key = e.key;
    var normalized = key && key.length === 1 ? key.toLowerCase() : key;
    var primary = e.metaKey || e.ctrlKey;
    if (key === "Escape" || key === "Enter") return true;
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
    selectedEl = selectionTargetForHit(target);
    if (!selectedEl || isLayerInteractionBlocked(selectedEl)) {
      selectedEl = null;
      selectionOverlay.style.display = "none";
      clearComponentTag();
      return;
    }
    var info = getElementInfo(selectedEl);
    positionOverlay(selectionOverlay, selectedEl);
    (window.parent as Window).postMessage(
      { type: "element-select", payload: info },
      "*",
    );
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
        (window.parent as Window).postMessage(
          { type: "element-select", payload: info },
          "*",
        );
      } else {
        selectedEl = null;
        selectionOverlay.style.display = "none";
        clearComponentTag();
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
      selectionOverlay.style.display = "none";
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
    var handle = spacingHandleStateByKey[key];
    if (!selectedEl || !handle || isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var events = dragEventNames(e);
    var dragEl = selectedEl;
    var originValue = handle.value;
    var startX = e.clientX;
    var startY = e.clientY;
    hoveredSpacingHandleKey = key;
    selectedSpacingHovered = true;
    spacingDrag = {
      handle: handle,
      currentValue: originValue,
      mirrorOpposite: !!e.altKey,
    };
    showSpacingBadgeForHandle(handle, originValue);

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
      applySpacingDragValue(dragEl, handle, nextValue, !!ev.altKey);
      positionOverlay(selectionOverlay, dragEl);
      showSpacingBadgeForHandle(handle, nextValue);
    }

    function onUp(ev) {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      if (!dragEl || !document.documentElement.contains(dragEl)) {
        spacingDrag = null;
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

  function applyTextRangeStyle(property: unknown, value: unknown): boolean {
    if (!activeTextEditEl || !property) return false;
    var selection: Selection | null = window.getSelection
      ? window.getSelection()
      : null;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
      return false;
    if (!selectionBelongsToElement(selection, activeTextEditEl)) return false;
    var range = selection.getRangeAt(0);
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
    transformBadge.textContent = text;
    transformBadge.style.display = "block";
    transformBadge.style.left = clientX + 12 + "px";
    transformBadge.style.top = clientY + 12 + "px";
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

  function reorderTargetForPoint(el, clientX, clientY) {
    if (!el || !el.parentElement) return null;
    var hit = elementFromEditorPoint(clientX, clientY);
    if (
      hit &&
      hit !== document.documentElement &&
      hit !== el &&
      !el.contains(hit) &&
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
          return {
            anchor: hit,
            placement: "inside",
            axis: parentFlowAxis(hit),
          };
        }
        return { anchor: hit, placement: edgePlacement, axis: edgeAxis };
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
        };
      }
    }
    var parent = el.parentElement;
    var axis = parentFlowAxis(parent);
    var siblings = draggableElementChildren(parent).filter(function (child) {
      return child !== el;
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
    return { anchor: anchor, placement: placement, axis: axis };
  }

  function showInsertionGuideFor(target) {
    if (!target || !target.anchor) {
      hideInsertionGuide();
      return;
    }
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
        "2px solid var(--design-editor-accent-color)";
      insertionGuide.style.borderRadius = "2px";
      insertionGuide.style.boxShadow = "none";
      return;
    }
    if (target.axis === "x") {
      var x = target.placement === "before" ? rect.left : rect.right;
      insertionGuide.style.left = x + "px";
      insertionGuide.style.top = rect.top + "px";
      insertionGuide.style.width = "2px";
      insertionGuide.style.height = rect.height + "px";
    } else {
      var y = target.placement === "before" ? rect.top : rect.bottom;
      insertionGuide.style.left = rect.left + "px";
      insertionGuide.style.top = y + "px";
      insertionGuide.style.width = rect.width + "px";
      insertionGuide.style.height = "2px";
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

  function startMove(e) {
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var events = dragEventNames(e);
    var originalSelectedEl = selectedEl;
    var duplicatedForDrag = false;
    if (
      e.altKey &&
      selectedEl !== document.body &&
      selectedEl !== document.documentElement
    ) {
      var clone = selectedEl.cloneNode(true);
      resetRuntimeStableIds(clone);
      selectedEl.parentElement.insertBefore(clone, selectedEl.nextSibling);
      selectedEl = clone;
      duplicatedForDrag = true;
      positionOverlay(selectionOverlay, selectedEl);
      (window.parent as Window).postMessage(
        { type: "element-select", payload: getElementInfo(selectedEl) },
        "*",
      );
    }
    if (isFlowReorderCandidate(selectedEl)) {
      // Snapshot the element being reordered so a concurrent select-element or
      // clear-selection postMessage cannot mutate the wrong element mid-drag.
      var reorderEl = selectedEl;
      var currentTarget = reorderTargetForPoint(
        reorderEl,
        e.clientX,
        e.clientY,
      );
      showInsertionGuideFor(currentTarget);
      // Cross-screen drag state: true when the pointer is outside this iframe's
      // viewport bounds.  The host frame renders the ghost + highlight and owns
      // the drop when this is true; the bridge suppresses its in-iframe reorder.
      var pointerOutsideIframe = false;
      var reorderSelector = getSelector(reorderEl);
      var reorderSourceId = getSourceId(reorderEl);
      function onReorderMove(ev) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cx = ev.clientX;
        var cy = ev.clientY;
        var outside = cx < 0 || cy < 0 || cx > vw || cy > vh;
        pointerOutsideIframe = outside;
        // Always notify the host frame so it can track the cursor position,
        // render the ghost, and highlight the target screen.
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
          },
          "*",
        );
        if (outside) {
          // Cursor left this iframe — hide the in-iframe insertion guide so
          // it does not render while the host shows a cross-screen drop target.
          hideInsertionGuide();
          showTransformBadge("Move layer", cx, cy);
        } else {
          // Cursor is inside this iframe — use existing in-iframe behavior.
          currentTarget = reorderTargetForPoint(reorderEl, cx, cy);
          showInsertionGuideFor(currentTarget);
          showTransformBadge(currentTarget ? "Move layer" : "Move", cx, cy);
        }
      }
      function onReorderEscape() {
        document.removeEventListener(events.move, onReorderMove, true);
        document.removeEventListener(events.up, onReorderUp, true);
        document.removeEventListener("keydown", onReorderKeyDown, true);
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
          (window.parent as Window).postMessage(
            { type: "element-select", payload: getElementInfo(selectedEl) },
            "*",
          );
        }
      }
      function onReorderKeyDown(ev) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
          onReorderEscape();
        }
      }
      function onReorderUp(ev) {
        document.removeEventListener(events.move, onReorderMove, true);
        document.removeEventListener(events.up, onReorderUp, true);
        document.removeEventListener("keydown", onReorderKeyDown, true);
        hideTransformBadge();
        hideInsertionGuide();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cx = ev ? ev.clientX : 0;
        var cy = ev ? ev.clientY : 0;
        var outsideOnDrop = cx < 0 || cy < 0 || cx > vw || cy > vh;
        // Post the end message so the host can finalize a cross-screen drop.
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
          },
          "*",
        );
        // When the pointer is outside this iframe at release, the host owns the
        // move (cross-screen drop).  Do NOT apply the in-iframe reorder so we
        // avoid a ghost element left in screen A's DOM.
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
            (window.parent as Window).postMessage(
              { type: "element-select", payload: getElementInfo(selectedEl) },
              "*",
            );
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
        } else {
          // Capture the pre-drag DOM anchor so we can revert if the parent
          // reports applied===false on the structure-ack.
          var prevParent = reorderEl.parentElement;
          var prevNextSibling = reorderEl.nextSibling;
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
      return;
    }
    ensurePositionable(selectedEl);
    var cs = window.getComputedStyle(selectedEl);
    var originLeft = readPx((selectedEl as HTMLElement).style.left || cs.left);
    var originTop = readPx(selectedEl.style.top || cs.top);
    var startX = e.clientX;
    var startY = e.clientY;
    // Snapshot the element being moved so that a concurrent select-element or
    // clear-selection postMessage cannot swap selectedEl mid-drag and cause
    // mutations on the wrong element or a null-deref in onUp.
    var dragEl = selectedEl;
    var moved = false;
    var DRAG_THRESHOLD = 3;
    function onMove(ev) {
      if (
        !moved &&
        Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD
      ) {
        moved = true;
      }
      var nextLeft = originLeft + ev.clientX - startX;
      var nextTop = originTop + ev.clientY - startY;
      (dragEl as HTMLElement).style.left = Math.round(nextLeft) + "px";
      (dragEl as HTMLElement).style.top = Math.round(nextTop) + "px";
      showTransformBadge(
        "X " + Math.round(nextLeft) + "  Y " + Math.round(nextTop),
        ev.clientX,
        ev.clientY,
      );
      refreshOverlays();
    }
    function onUp() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      hideTransformBadge();
      if (!dragEl) return;
      if (duplicatedForDrag && !moved) {
        // Alt-click with no real drag — remove the premature clone and restore the original selection.
        if (dragEl.parentElement) dragEl.parentElement.removeChild(dragEl);
        selectedEl = originalSelectedEl;
        positionOverlay(selectionOverlay, selectedEl);
        (window.parent as Window).postMessage(
          { type: "element-select", payload: getElementInfo(selectedEl) },
          "*",
        );
        return;
      }
      if (duplicatedForDrag) {
        postVisualDuplicateChange(originalSelectedEl, dragEl);
      } else {
        (window.parent as Window).postMessage(
          {
            type: "visual-style-change",
            selector: getSelector(dragEl),
            styles: {
              position: (dragEl as HTMLElement).style.position,
              left: (dragEl as HTMLElement).style.left,
              top: (dragEl as HTMLElement).style.top,
            },
            payload: getElementInfo(dragEl),
          },
          "*",
        );
      }
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
  }

  function startResize(handle, e) {
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    var events = dragEventNames(e);
    ensurePositionable(selectedEl);
    var cs = window.getComputedStyle(selectedEl);
    // Bug fix: use CSS width/height (not getBoundingClientRect) for the resize
    // origin dimensions so that rotated elements don't use the inflated
    // axis-aligned bounding box as the starting size.
    var originW = readPx(selectedEl.style.width || cs.width);
    var originH = readPx(selectedEl.style.height || cs.height);
    var origin = {
      left: readPx(selectedEl.style.left || cs.left),
      top: readPx(selectedEl.style.top || cs.top),
      width: originW,
      height: originH,
      ratio: originW / Math.max(1, originH),
    };
    var startX = e.clientX;
    var startY = e.clientY;
    // Snapshot the element so a concurrent clear-selection postMessage cannot
    // cause a null-deref in onMove/onUp.
    var resizeEl = selectedEl;
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
      showTransformBadge(
        Math.round(rect.width) + " x " + Math.round(rect.height),
        ev.clientX,
        ev.clientY,
      );
      refreshOverlays();
    }
    function onUp() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
      hideTransformBadge();
      if (!resizeEl) return;
      (window.parent as Window).postMessage(
        {
          type: "visual-style-change",
          selector: getSelector(resizeEl),
          styles: {
            position: resizeEl.style.position,
            left: resizeEl.style.left,
            top: resizeEl.style.top,
            width: resizeEl.style.width,
            height: resizeEl.style.height,
          },
          payload: getElementInfo(resizeEl),
        },
        "*",
      );
    }
    document.addEventListener(events.move, onMove, true);
    document.addEventListener(events.up, onUp, true);
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
    function onUp() {
      document.removeEventListener(events.move, onMove, true);
      document.removeEventListener(events.up, onUp, true);
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
    pendingShieldDrag = null;
  }

  function beginPotentialShieldDrag(e) {
    stopNativeInteraction(e);
    if (e.button !== 0 || activeTextEditEl) return;
    var events = dragEventNames(e);
    var hit = elementFromEditorPoint(e.clientX, e.clientY);
    if (!hit || hit === document.body || hit === document.documentElement)
      return;
    var dragTarget =
      selectedEl &&
      document.documentElement.contains(selectedEl) &&
      selectedEl.contains(hit)
        ? selectedEl
        : selectionTargetForHit(hit);
    var clickTarget = selectionTargetForHit(hit);
    if (
      !dragTarget ||
      dragTarget === document.body ||
      dragTarget === document.documentElement ||
      isLayerInteractionBlocked(dragTarget)
    ) {
      return;
    }
    var startX = e.clientX;
    var startY = e.clientY;
    var didStartDrag = false;
    function selectTarget(target) {
      selectedEl = target;
      positionOverlay(selectionOverlay, selectedEl);
      (window.parent as Window).postMessage(
        { type: "element-select", payload: getElementInfo(selectedEl) },
        "*",
      );
    }
    function onMove(ev) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 3) return;
      clearPendingShieldDrag();
      didStartDrag = true;
      selectTarget(dragTarget);
      suppressNextShieldClickBriefly();
      startMove(ev);
    }
    function onUp(ev) {
      clearPendingShieldDrag();
      if (didStartDrag) return;
      if (ev) stopNativeInteraction(ev);
      selectTarget(clickTarget || dragTarget);
      suppressNextShieldClickBriefly();
    }
    clearPendingShieldDrag();
    pendingShieldDrag = {
      move: events.move,
      up: events.up,
      onMove: onMove,
      onUp: onUp,
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

  document.addEventListener(
    "keydown",
    function (e) {
      if (!shouldForwardDesignHotkey(e)) return;
      stopNativeInteraction(e);
      if (e.key === "Escape") clearRuntimeSelection();
      (window.parent as Window).postMessage(
        {
          type: "design-hotkey",
          key: e.key,
          code: e.code,
          metaKey: !!e.metaKey,
          ctrlKey: !!e.ctrlKey,
          shiftKey: !!e.shiftKey,
          altKey: !!e.altKey,
          repeat: !!e.repeat,
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
    var target =
      findTextEditTarget(elementFromEditorPoint(e.clientX, e.clientY)) ||
      findTextEditTarget(eventTarget) ||
      eventTarget;
    if (!target || target.nodeType !== 1) return;
    // Anchor the selection identity to the nearest source-backed element. Text
    // editing still operates on the actual target text node, but a later
    // style edit posts from selectedEl, so it must point at a patchable
    // code-layer node rather than a runtime-only descendant (which would emit a
    // brittle body > div:nth-of-type(...) selector that never resolves).
    selectedEl = selectionTargetForHit(target) || target;
    var originalText = target.textContent || "";
    var originalHtml = target.innerHTML || "";
    var committed = false;
    activeTextEditEl = target;
    target.setAttribute("contenteditable", "true");
    target.setAttribute("data-agent-native-text-editing", "true");
    target.style.cursor = "text";
    target.style.outline = "1.5px solid var(--design-editor-accent-color)";
    target.style.outlineOffset = "2px";
    setTextEditingPointerPassthrough(true);
    positionOverlay(selectionOverlay, target);
    (window.parent as Window).postMessage(
      { type: "element-select", payload: getElementInfo(target) },
      "*",
    );
    (window.parent as Window).postMessage(
      { type: "element-dblclick-text", payload: getElementInfo(target) },
      "*",
    );
    postTextEditingState(target, true);

    function finish(commit) {
      if (committed) return;
      committed = true;
      target.removeEventListener("blur", onBlur, true);
      target.removeEventListener("keydown", onKeyDown, true);
      target.removeEventListener("paste", onPaste, true);
      target.removeEventListener("keyup", onSelectionChange, true);
      target.removeEventListener("mouseup", onSelectionChange, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      target.removeAttribute("contenteditable");
      target.removeAttribute("data-agent-native-text-editing");
      target.style.cursor = "";
      target.style.outline = "";
      target.style.outlineOffset = "";
      setTextEditingPointerPassthrough(false);
      if (activeTextEditEl === target) activeTextEditEl = null;
      postTextEditingState(target, false);
      if (!commit) {
        target.innerHTML = originalHtml;
        refreshOverlays();
        return;
      }
      var next = target.textContent || "";
      var nextHtml = target.innerHTML || "";
      refreshOverlays();
      if (next !== originalText || nextHtml !== originalHtml) {
        postTextContentChange(target, next, nextHtml);
      }
    }

    function onBlur() {
      finish(true);
    }

    function onKeyDown(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
        target.blur();
        return;
      }
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
        target.blur();
      }
    }

    function onPaste(ev) {
      ev.preventDefault();
      insertPlainTextAtSelection(
        (ev.clipboardData && ev.clipboardData.getData("text/plain")) || "",
      );
    }

    function onSelectionChange() {
      postTextEditingState(target, true);
    }

    target.addEventListener("blur", onBlur, true);
    target.addEventListener("keydown", onKeyDown, true);
    target.addEventListener("paste", onPaste, true);
    target.addEventListener("keyup", onSelectionChange, true);
    target.addEventListener("mouseup", onSelectionChange, true);
    document.addEventListener("selectionchange", onSelectionChange);
    target.focus();
    placeTextCaretFromPoint(target, e.clientX, e.clientY);
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
          selectedSpacingHovered = false;
          hoveredSpacingHandleKey = "";
          updateSpacingOverlay(selectedEl);
        }
        hideMeasurements();
        return;
      }
      if (hoveredEl && hoveredEl.closest("[data-agent-native-text-editing]"))
        return;
      if (!spacingDrag) {
        selectedSpacingHovered = Boolean(
          selectedEl &&
          hoveredEl &&
          (hoveredEl === selectedEl ||
            (selectedEl.contains && selectedEl.contains(hoveredEl))),
        );
        if (!selectedSpacingHovered) hoveredSpacingHandleKey = "";
        updateSpacingOverlay(selectedEl);
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
      var info = getElementInfo(hoveredEl);
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
        selectedSpacingHovered = false;
        hoveredSpacingHandleKey = "";
        updateSpacingOverlay(selectedEl);
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
        selectedSpacingHovered = false;
        hoveredSpacingHandleKey = "";
        updateSpacingOverlay(selectedEl);
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
    if (e.data.payload && typeof e.data.payload === "object") {
      Object.keys(e.data.payload).forEach(function (key) {
        if (e.data[key] === undefined) e.data[key] = e.data.payload[key];
      });
    }
    // set-read-only: toggle the bridge's readOnly state in-place without a reload.
    // When readOnly becomes true the shield/selection/drag/edit entry points are
    // gated so the surface is safe for background/inactive display use.
    if (e.data.type === "set-read-only") {
      var nextReadOnly = !!e.data.readOnly;
      if (readOnly === nextReadOnly) return;
      readOnly = nextReadOnly;
      textEditingEnabled = !readOnly && __TEXT_EDITING_ENABLED__;
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
      // Resolve the actual editable text leaf (same logic as findTextEditTarget).
      var textTarget: HTMLElement | null =
        (findTextEditTarget(nodeTarget) as HTMLElement | null) ||
        (nodeTarget as HTMLElement);
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
    if (e.data.type === "clear-selection") {
      clearRuntimeSelection();
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
      selectedSpacingHovered = false;
      hoveredSpacingHandleKey = "";
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
        selectionOverlay.style.display = "none";
        clearComponentTag();
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
          (window.parent as Window).postMessage(
            { type: "element-select", payload: getElementInfo(selectedEl) },
            "*",
          );
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
          (window.parent as Window).postMessage(
            { type: "element-select", payload: getElementInfo(selectedEl) },
            "*",
          );
        }
      }
      return;
    }
    if (e.data.type === "replace-document-content") {
      replaceRuntimeDocument(
        e.data.content,
        e.data.forceFullDocument ? "" : e.data.selectedSelector,
        e.data.forceFullDocument ? [] : e.data.selectorCandidates,
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
    if (
      prop &&
      activeTextEditEl &&
      el === activeTextEditEl &&
      applyTextRangeStyle(prop, val)
    ) {
      postTextContentChange(
        activeTextEditEl,
        activeTextEditEl.textContent || "",
        activeTextEditEl.innerHTML || "",
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

  window.addEventListener("scroll", refreshOverlays, true);
  window.addEventListener("resize", refreshOverlays);
  applyEditorChromeScale();
})();
