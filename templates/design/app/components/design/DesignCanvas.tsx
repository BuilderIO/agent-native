import { sendToAgentChat, usePinchZoom, useT } from "@agent-native/core/client";
import { useRef, useEffect, useCallback, useMemo, useState } from "react";

// NOTE: This wires up the NEW shared visual-editor DrawOverlay + comment-pin
// components from `@/components/visual-editor`. The legacy iframe-only
// DrawOverlay at `./DrawOverlay.tsx` is intentionally NOT used here — both
// exist for now and can be reconciled in a follow-up. Don't import both.
import {
  DrawOverlay as SharedDrawOverlay,
  CanvasCommentPins,
  type CanvasPin,
} from "@/components/visual-editor";

import { isTrustedCanvasBridgeMessage } from "./bridge-security";
import { DeviceFrame } from "./DeviceFrame";
import type { ElementInfo, DeviceFrameType } from "./types";

/**
 * Tweak-bridge script. ALWAYS injected so the parent's postMessage
 * (`tweak-values`) can update CSS custom properties on the iframe's :root
 * regardless of which editor mode is active. Without this the tweak panel
 * silently no-ops in the default Comment mode.
 */
const TWEAK_BRIDGE_SCRIPT = `
<script data-agent-native-tweak-bridge>
(function() {
  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (!e.data || e.data.type !== 'tweak-values') return;
    var root = document.documentElement;
    var vals = e.data.values || {};
    Object.keys(vals).forEach(function(k) {
      root.style.setProperty(k, vals[k]);
    });
  });
})();
</script>
`;

/**
 * Pinch-zoom bridge: forwards trackpad pinch / Cmd-Ctrl+scroll wheel events
 * from inside the iframe to the parent window. Wheel events don't naturally
 * bubble out of an iframe, so without this the user can only pinch in the
 * empty area around the canvas, not over the design itself.
 */
const ZOOM_BRIDGE_SCRIPT = `
<script data-agent-native-zoom-bridge>
(function() {
  // Attach to documentElement (not window/document) so { passive: false }
  // is honored consistently and the browser doesn't natively pinch-zoom the
  // iframe's own document alongside the parent's zoom.
  var target = document.documentElement || document.body || document;
  function onWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    try {
      window.parent.postMessage({
        type: 'pinch-zoom-wheel',
        deltaY: e.deltaY,
        clientX: e.clientX,
        clientY: e.clientY,
      }, '*');
    } catch (err) {}
  }
  target.addEventListener('wheel', onWheel, { passive: false, capture: true });
})();
</script>
`;

/**
 * Embedded overview bridge. A screen preview is a real iframe, so normal wheel
 * events never bubble to the overview canvas underneath. In embedded mode we
 * forward a bounded wheel payload to the parent so the existing canvas wheel
 * handler can pan/zoom exactly as if the pointer were over empty canvas.
 */
const EMBEDDED_WHEEL_BRIDGE_SCRIPT = `
<script data-agent-native-embedded-wheel-bridge>
(function() {
  var enabled = __EMBEDDED_WHEEL_FORWARDING_ENABLED__;
  if (!enabled) return;
  function clamp(value, limit) {
    var number = Number(value) || 0;
    if (number > limit) return limit;
    if (number < -limit) return -limit;
    return number;
  }
  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    try {
      window.parent.postMessage({
        type: 'embedded-canvas-wheel',
        deltaX: clamp(e.deltaX, 240),
        deltaY: clamp(e.deltaY, 240),
        deltaZ: clamp(e.deltaZ, 240),
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: !!e.ctrlKey,
        metaKey: !!e.metaKey,
        shiftKey: !!e.shiftKey,
        altKey: !!e.altKey,
      }, '*');
    } catch (err) {}
  }
  var target = document.documentElement || document.body || document;
  target.addEventListener('wheel', onWheel, { passive: false, capture: true });
})();
</script>
`;

/**
 * Navigation bridge. ALWAYS injected. A prototype lives in a `srcdoc` iframe,
 * so a plain `<a href="/pricing">` resolves the relative URL against the PARENT
 * app document and navigates the iframe to the Design app itself ("Design not
 * found"), nuking the prototype. We intercept link clicks + relative form
 * submits and route them to the parent instead:
 *   - in-page anchors (`#...`) and `javascript:`/`@click` handlers: left alone
 *   - external `http(s)`/`//` links: opened in a new tab by the parent
 *   - internal/relative links (or an explicit `data-screen`): asked to switch
 *     to the matching screen in a multi-screen design; otherwise a no-op so the
 *     prototype never blows itself away.
 */
const NAV_BRIDGE_SCRIPT = `
<script data-agent-native-nav-bridge>
(function() {
  function classify(href) {
    var h = (href || '').trim();
    if (!h) return null;
    var lower = h.toLowerCase();
    if (lower.charAt(0) === '#') return null;
    if (lower.indexOf('javascript:') === 0) return null;
    if (lower.indexOf('mailto:') === 0 || lower.indexOf('tel:') === 0) {
      return { external: true, href: h };
    }
    if (/^https?:\\/\\//i.test(h) || /^\\/\\//.test(h)) {
      return { external: true, href: h };
    }
    var screen = h.replace(/^\\.?\\//, '').split(/[?#]/)[0];
    return { external: false, href: h, screen: screen };
  }
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var a = t.closest('a[href], [data-screen]');
    if (!a) return;
    var ds = a.getAttribute && a.getAttribute('data-screen');
    // In-page anchors ('#...') and empty hrefs must be handled in-document.
    // A srcdoc document resolves '#'/'' against the PARENT app URL, so the
    // browser's default action would navigate the iframe to the app itself.
    if (!ds) {
      var rawHref = a.getAttribute('href');
      if (rawHref != null) {
        var hh = rawHref.trim();
        if (hh === '' || hh.charAt(0) === '#') {
          e.preventDefault();
          var fid = hh.charAt(0) === '#' ? hh.slice(1) : '';
          var tgt = fid ? document.getElementById(fid) : null;
          if (tgt && tgt.scrollIntoView) {
            tgt.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }
      }
    }
    var info = ds
      ? { external: false, href: ds, screen: ds.replace(/^\\.?\\//, '').split(/[?#]/)[0] }
      : classify(a.getAttribute('href'));
    if (!info) return;
    if (info.external) {
      // Open external links in a new tab from the iframe itself (the sandbox
      // grants allow-popups), bound to this real user click. We deliberately do
      // NOT round-trip through the parent: a parent window.open() driven by
      // postMessage would let any script in here spawn popups without a gesture.
      try {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      } catch (err) {}
      return; // allow the native click to proceed
    }
    e.preventDefault();
    try {
      window.parent.postMessage({
        type: 'prototype-navigate',
        href: info.href,
        screen: info.screen || '',
      }, '*');
    } catch (err) {}
  }, true);
  document.addEventListener('submit', function(e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    var action = f.getAttribute('action') || '';
    if (/^https?:\\/\\//i.test(action)) return;
    e.preventDefault();
  }, true);
})();
</script>
`;

const EDITOR_BRIDGE_VAR_NAMES = [
  "--design-editor-accent-color",
  "--design-editor-accent-hover-color",
  "--design-editor-selection-color",
  "--design-editor-accent-strong-color",
  "--design-editor-accent-contrast-color",
  "--design-editor-measure-color",
  "--background",
  "--foreground",
  "--border",
];

function readEditorBridgeThemeVars(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const styles = window.getComputedStyle(document.documentElement);
  return Object.fromEntries(
    EDITOR_BRIDGE_VAR_NAMES.map((name) => [
      name,
      styles.getPropertyValue(name).trim(),
    ]).filter(([, value]) => value.length > 0),
  );
}

function createEditorBridgeThemeScript(vars: Record<string, string>) {
  const serializedVars = JSON.stringify(vars).replace(/</g, "\\u003c");
  return `
<script data-agent-native-editor-theme>
(function() {
  var vars = ${serializedVars};
  var root = document.documentElement;
  Object.keys(vars).forEach(function(name) {
    root.style.setProperty(name, vars[name]);
  });
})();
</script>
`;
}

/**
 * Editor chrome bridge: blocks native iframe app interaction outside Interact
 * mode and replaces it with element hover/selection overlays. Double-click text
 * editing is enabled only while the editor is specifically in Edit mode.
 */
const EDITOR_CHROME_BRIDGE_SCRIPT = `
<script data-agent-native-editor-chrome-bridge>
(function() {
  var textEditingEnabled = __TEXT_EDITING_ENABLED__;
  var scaleToolEnabled = false;

  function escapeIdent(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  }

  function escapeAttribute(value) {
    return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  }

  function attributeSelector(el, name) {
    var value = el && el.getAttribute && el.getAttribute(name);
    return value ? '[' + name + '="' + escapeAttribute(value) + '"]' : '';
  }

  function classSelectorSuffix(el, maxCount) {
    if (!el || !el.classList) return '';
    return Array.prototype.slice.call(el.classList, 0, maxCount)
      .map(function(token) { return '.' + escapeIdent(token); })
      .join('');
  }

  function selectorPart(el) {
    if (!el || !el.tagName) return '';
    var stableSelector =
      attributeSelector(el, 'data-agent-native-node-id') ||
      attributeSelector(el, 'data-code-layer-id') ||
      attributeSelector(el, 'data-layer-id') ||
      attributeSelector(el, 'data-builder-id') ||
      attributeSelector(el, 'data-loc');
    if (stableSelector) return el.tagName.toLowerCase() + stableSelector;
    if (el.id) return '#' + escapeIdent(el.id);
    var part = el.tagName.toLowerCase() + (stableSelector || classSelectorSuffix(el, 2));
    var parent = el.parentElement;
    if (parent) {
      var sameTag = Array.prototype.filter.call(
        parent.children,
        function(child) { return child.tagName === el.tagName; }
      );
      if (sameTag.length > 1) {
        part += ':nth-of-type(' + (sameTag.indexOf(el) + 1) + ')';
      }
    }
    return part;
  }

  function selectorPath(el, stopEl) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      if (node !== stopEl) parts.unshift(selectorPart(node));
      if (node === stopEl) break;
      node = node.parentElement;
    }
    return parts.slice(-5).join(' > ');
  }

  function getSourceId(el) {
    if (!el || !el.getAttribute) return '';
    return (
      el.getAttribute('data-agent-native-node-id') ||
      el.getAttribute('data-code-layer-id') ||
      el.getAttribute('data-layer-id') ||
      el.getAttribute('data-builder-id') ||
      el.getAttribute('data-loc') ||
      el.id ||
      ''
    );
  }

  function freshRuntimeNodeId(prefix) {
    var random = '';
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var bytes = new Uint32Array(2);
        window.crypto.getRandomValues(bytes);
        random = Array.prototype.map.call(bytes, function(part) {
          return part.toString(36);
        }).join('');
      }
    } catch (_err) {}
    if (!random) random = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return 'an-' + String(prefix || 'copy') + '-' + random;
  }

  function resetRuntimeStableIds(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll('[data-agent-native-node-id]')));
    nodes.forEach(function(node, index) {
      if (node && node.setAttribute) {
        node.setAttribute('data-agent-native-node-id', freshRuntimeNodeId(index === 0 ? 'copy' : 'copy-child'));
      }
    });
  }

  function getSelector(el) {
    var stableOwnSelector =
      attributeSelector(el, 'data-agent-native-node-id') ||
      attributeSelector(el, 'data-code-layer-id') ||
      attributeSelector(el, 'data-layer-id') ||
      attributeSelector(el, 'data-builder-id') ||
      attributeSelector(el, 'data-loc');
    if (stableOwnSelector) return stableOwnSelector;

    if (el.id) return '#' + escapeIdent(el.id);
    var stableAncestor = el.closest('[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[data-loc]');
    if (stableAncestor && stableAncestor !== el) {
      var stableAncestorSelector = selectorPart(stableAncestor);
      if (stableAncestorSelector) {
        var descendantPath = selectorPath(el, stableAncestor);
        var descendantParts = descendantPath ? descendantPath.split(' > ') : [];
        if (descendantParts.length) {
          return stableAncestorSelector + ' > ' + descendantParts.join(' > ');
        }
        return stableAncestorSelector;
      }
    }

    return selectorPath(el);
  }

  function getElementInfo(el) {
    var cs = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var parentStyles = el.parentElement
      ? window.getComputedStyle(el.parentElement)
      : null;
    var parentDisplay = parentStyles ? parentStyles.display : undefined;
    var sourceId = getSourceId(el) || getSelector(el);
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
    var capabilities = [
      {
        kind: 'deterministic-style-edit',
        label: 'deterministic-style-edit',
        confidence: 0.92,
        reason: 'Inline style can be patched and replayed through HMR/collab.',
      },
    ];
    if (el.classList && el.classList.length > 0) {
      capabilities.push({
        kind: 'deterministic-class-edit',
        label: 'deterministic-class-edit',
        confidence: 0.78,
        reason: 'Class tokens are visible on the selected element.',
      });
    }
    if (parentDisplay === 'flex' || parentDisplay === 'inline-flex' || parentDisplay === 'grid' || parentDisplay === 'inline-grid') {
      capabilities.push({
        kind: 'agent-structural-edit',
        label: 'agent-structural-edit',
        confidence: 0.54,
        reason: 'Parent layout context decides whether movement means gap, order, alignment, or wrapper structure.',
      });
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
      boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      textContent: el.textContent ? el.textContent.slice(0, 200) : undefined,
      htmlContent: el.innerHTML && el.innerHTML !== el.textContent ? el.innerHTML.slice(0, 4000) : undefined,
      isFlexContainer: cs.display === 'flex' || cs.display === 'inline-flex',
      isFlexChild: parentDisplay === 'flex' || parentDisplay === 'inline-flex',
      parentDisplay: parentDisplay,
      parentLayout: parentLayout,
      editCapabilities: capabilities,
      confidence: capabilities.reduce(function(best, item) {
        return Math.max(best, item.confidence || 0);
      }, 0),
    };
  }

  var shieldOverlay = document.createElement('div');
  shieldOverlay.setAttribute('data-agent-native-edit-overlay', 'shield');
  shieldOverlay.style.cssText = 'position:fixed;inset:0;z-index:99990;background:transparent;pointer-events:auto;touch-action:none;cursor:default;';
  document.body.appendChild(shieldOverlay);

  var highlightOverlay = document.createElement('div');
  highlightOverlay.setAttribute('data-agent-native-edit-overlay', 'highlight');
  highlightOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;';
  document.body.appendChild(highlightOverlay);

  var selectionOverlay = document.createElement('div');
  selectionOverlay.setAttribute('data-agent-native-edit-overlay', 'selection');
  selectionOverlay.style.cssText = 'position:fixed;pointer-events:auto;z-index:99998;border:1.5px solid var(--design-editor-accent-color);background:transparent;display:none;box-sizing:border-box;cursor:move;';
  ['n','e','s','w'].forEach(function(pos) {
    var edge = document.createElement('span');
    edge.setAttribute('data-agent-native-edge-handle', pos);
    var cursor = pos === 'n' || pos === 's' ? 'ns-resize' : 'ew-resize';
    edge.style.cssText = 'position:absolute;pointer-events:auto;cursor:' + cursor + ';background:transparent;';
    if (pos === 'n') {
      edge.style.left = '0';
      edge.style.right = '0';
      edge.style.top = '-5px';
      edge.style.height = '10px';
    }
    if (pos === 's') {
      edge.style.left = '0';
      edge.style.right = '0';
      edge.style.bottom = '-5px';
      edge.style.height = '10px';
    }
    if (pos === 'e') {
      edge.style.top = '0';
      edge.style.bottom = '0';
      edge.style.right = '-5px';
      edge.style.width = '10px';
    }
    if (pos === 'w') {
      edge.style.top = '0';
      edge.style.bottom = '0';
      edge.style.left = '-5px';
      edge.style.width = '10px';
    }
    selectionOverlay.appendChild(edge);
  });
  ['nw','ne','se','sw'].forEach(function(pos) {
    var handle = document.createElement('span');
    handle.setAttribute('data-agent-native-edit-handle', pos);
    var cursor = pos === 'n' || pos === 's' ? 'ns-resize' : pos === 'e' || pos === 'w' ? 'ew-resize' : pos === 'nw' || pos === 'se' ? 'nwse-resize' : 'nesw-resize';
    handle.style.cssText = 'position:absolute;width:7px;height:7px;border:1px solid var(--design-editor-accent-color);background:var(--design-editor-accent-contrast-color);box-sizing:border-box;border-radius:1px;pointer-events:auto;cursor:' + cursor + ';';
    if (pos.indexOf('n') !== -1) handle.style.top = '-4px';
    if (pos.indexOf('s') !== -1) handle.style.bottom = '-4px';
    if (pos.indexOf('w') !== -1) handle.style.left = '-4px';
    if (pos.indexOf('e') !== -1) handle.style.right = '-4px';
    if (pos === 'n' || pos === 's') {
      handle.style.left = '50%';
      handle.style.transform = 'translateX(-50%)';
    }
    if (pos === 'e' || pos === 'w') {
      handle.style.top = '50%';
      handle.style.transform = 'translateY(-50%)';
    }
    selectionOverlay.appendChild(handle);
  });
  ['nw','ne','se','sw'].forEach(function(pos) {
    var rotate = document.createElement('span');
    rotate.setAttribute('data-agent-native-rotate-handle', pos);
    rotate.style.cssText = 'position:absolute;width:18px;height:18px;border-radius:999px;pointer-events:auto;cursor:grab;';
    if (pos.indexOf('n') !== -1) rotate.style.top = '-26px';
    if (pos.indexOf('s') !== -1) rotate.style.bottom = '-26px';
    if (pos.indexOf('w') !== -1) rotate.style.left = '-26px';
    if (pos.indexOf('e') !== -1) rotate.style.right = '-26px';
    selectionOverlay.appendChild(rotate);
  });
  var paddingOverlay = document.createElement('div');
  paddingOverlay.setAttribute('data-agent-native-padding-overlay', '');
  paddingOverlay.style.cssText = 'position:absolute;border:1px dashed var(--design-editor-accent-strong-color);border-radius:2px;pointer-events:none;';
  selectionOverlay.appendChild(paddingOverlay);
  document.body.appendChild(selectionOverlay);

  var transformBadge = document.createElement('div');
  transformBadge.setAttribute('data-agent-native-transform-badge', '');
  transformBadge.style.cssText = 'position:fixed;z-index:100000;display:none;pointer-events:none;border:1px solid hsl(var(--border));border-radius:4px;background:hsl(var(--background) / 0.96);color:hsl(var(--foreground));font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 5px;box-shadow:0 8px 20px color-mix(in srgb, hsl(var(--foreground)) 16%, transparent);';
  document.body.appendChild(transformBadge);

  var insertionGuide = document.createElement('div');
  insertionGuide.setAttribute('data-agent-native-insertion-guide', '');
  insertionGuide.style.cssText = 'position:fixed;z-index:100000;display:none;pointer-events:none;background:var(--design-editor-accent-color);border-radius:999px;box-shadow:0 0 0 1px var(--design-editor-accent-color);';
  document.body.appendChild(insertionGuide);

  var measurementOverlay = document.createElement('div');
  measurementOverlay.setAttribute('data-agent-native-measurement-overlay', '');
  measurementOverlay.style.cssText = 'position:fixed;inset:0;z-index:100001;display:none;pointer-events:none;color:var(--design-editor-measure-color);font:11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;';
  document.body.appendChild(measurementOverlay);

	  var selectedEl = null;
	  var hoveredEl = null;
	  var activeTextEditEl = null;
	  var textEditPointerState = null;
	  var pendingStructureMove = null;
	  var lockedSelectors = [];
	  var hiddenSelectors = [];

  function matchesSelectorList(el, selectors) {
    if (!el || !selectors || selectors.length === 0) return false;
    for (var i = 0; i < selectors.length; i += 1) {
      try {
        if (el.matches(selectors[i]) || el.closest(selectors[i])) return true;
      } catch (_err) {}
    }
    return false;
  }

  function matchesExactSelectorList(el, selectors) {
    if (!el || !selectors || selectors.length === 0) return false;
    for (var i = 0; i < selectors.length; i += 1) {
      try {
        if (el.matches(selectors[i])) return true;
      } catch (_err) {}
    }
    return false;
  }

  function isLayerInteractionBlocked(el) {
    return matchesSelectorList(el, lockedSelectors) || matchesSelectorList(el, hiddenSelectors);
  }

  function applyHiddenSelectors() {
    document.querySelectorAll('[data-agent-native-runtime-hidden]').forEach(function(el) {
      var previous = el.getAttribute('data-agent-native-previous-display');
      if (previous === null) {
        el.style.removeProperty('display');
      } else {
        el.style.display = previous;
      }
      el.removeAttribute('data-agent-native-runtime-hidden');
      el.removeAttribute('data-agent-native-previous-display');
    });
    hiddenSelectors.forEach(function(selector) {
      try {
        document.querySelectorAll(selector).forEach(function(el) {
          if (!el.hasAttribute('data-agent-native-runtime-hidden')) {
            el.setAttribute('data-agent-native-previous-display', el.style.display || '');
          }
          el.setAttribute('data-agent-native-runtime-hidden', 'true');
          el.style.display = 'none';
        });
      } catch (_err) {}
    });
  }

  function replaceRuntimeDocument(html, preferredSelector, selectorCandidates) {
    if (typeof html !== 'string') return;
    if (activeTextEditEl) {
      applyHiddenSelectors();
      refreshOverlays();
      return;
    }
    var parser = new DOMParser();
    var nextDoc = parser.parseFromString(html, 'text/html');
    if (!nextDoc || !nextDoc.body) return;

    var persistentNodes = Array.prototype.slice.call(
      document.querySelectorAll('[data-agent-native-edit-overlay]'),
    );
    var activeSelector = preferredSelector || (selectedEl ? getSelector(selectedEl) : '');
    var activeCandidates = [];
    if (Array.isArray(selectorCandidates)) {
      selectorCandidates.forEach(function(selector) {
        if (typeof selector === 'string' && selector && activeCandidates.indexOf(selector) === -1) {
          activeCandidates.push(selector);
        }
      });
    }
    if (activeSelector && activeCandidates.indexOf(activeSelector) === -1) {
      activeCandidates.push(activeSelector);
    }

    var nextHeadHtml = nextDoc.head ? nextDoc.head.innerHTML : '';
    if (nextHeadHtml === document.head.innerHTML && activeCandidates.length > 0) {
      var currentMatch = null;
      var nextMatch = null;
      var matchedSelector = '';
      var fallbackCurrentMatch = null;
      var fallbackSelector = '';
      for (var matchIndex = 0; matchIndex < activeCandidates.length; matchIndex += 1) {
        try {
          var currentCandidate = document.querySelector(activeCandidates[matchIndex]);
          var nextCandidate = nextDoc.querySelector(activeCandidates[matchIndex]);
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
        } else if (currentMatch !== document.body && currentMatch !== document.documentElement) {
          currentMatch.parentElement && currentMatch.parentElement.removeChild(currentMatch);
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
          window.parent.postMessage({ type: 'element-select', payload: getElementInfo(selectedEl) }, '*');
        } else {
          selectionOverlay.style.display = 'none';
        }
        highlightOverlay.style.display = 'none';
        hideMeasurements();
        refreshOverlays();
        return;
      }
    }
    if (document.head.innerHTML !== nextHeadHtml) {
      document.head.innerHTML = nextHeadHtml;
    }
    Array.prototype.slice.call(document.body.attributes).forEach(function(attribute) {
      document.body.removeAttribute(attribute.name);
    });
    Array.prototype.slice.call(nextDoc.body.attributes).forEach(function(attribute) {
      document.body.setAttribute(attribute.name, attribute.value);
    });
    document.body.innerHTML = nextDoc.body.innerHTML;
    persistentNodes.forEach(function(node) {
      document.body.appendChild(node);
    });
    applyHiddenSelectors();

    selectedEl = null;
    hoveredEl = null;
    for (var i = 0; i < activeCandidates.length && !selectedEl; i += 1) {
      try {
        var match = document.querySelector(activeCandidates[i]);
        if (match && !isLayerInteractionBlocked(match)) selectedEl = match;
      } catch (_err) {}
    }
    if (selectedEl) {
      positionOverlay(selectionOverlay, selectedEl);
      window.parent.postMessage({ type: 'element-select', payload: getElementInfo(selectedEl) }, '*');
    } else {
      selectionOverlay.style.display = 'none';
    }
    highlightOverlay.style.display = 'none';
    hideMeasurements();
    refreshOverlays();
  }

  function updatePaddingOverlay(el) {
    if (!el) {
      paddingOverlay.style.display = 'none';
      return;
    }
    var cs = window.getComputedStyle(el);
    var top = readPx(cs.paddingTop) + readPx(cs.borderTopWidth);
    var right = readPx(cs.paddingRight) + readPx(cs.borderRightWidth);
    var bottom = readPx(cs.paddingBottom) + readPx(cs.borderBottomWidth);
    var left = readPx(cs.paddingLeft) + readPx(cs.borderLeftWidth);
    var hasPadding = top > 0 || right > 0 || bottom > 0 || left > 0;
    paddingOverlay.style.display = hasPadding ? 'block' : 'none';
    paddingOverlay.style.top = top + 'px';
    paddingOverlay.style.right = right + 'px';
    paddingOverlay.style.bottom = bottom + 'px';
    paddingOverlay.style.left = left + 'px';
  }

  function positionOverlay(overlay, el) {
    if (!el || !document.documentElement.contains(el)) {
      overlay.style.display = 'none';
      return;
    }
    var rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    if (overlay === selectionOverlay) updatePaddingOverlay(el);
  }

  function refreshOverlays() {
    if (hoveredEl) positionOverlay(highlightOverlay, hoveredEl);
    if (selectedEl) positionOverlay(selectionOverlay, selectedEl);
  }

  function hideMeasurements() {
    measurementOverlay.style.display = 'none';
    measurementOverlay.innerHTML = '';
  }

  function addMeasurementLine(x1, y1, x2, y2, label) {
    var horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    var line = document.createElement('div');
    var labelEl = document.createElement('div');
    if (horizontal) {
      var left = Math.min(x1, x2);
      var width = Math.max(1, Math.abs(x2 - x1));
      line.style.cssText = 'position:fixed;left:' + left + 'px;top:' + y1 + 'px;width:' + width + 'px;border-top:1px dashed var(--design-editor-measure-color);';
      labelEl.style.cssText = 'position:fixed;left:' + (left + width / 2) + 'px;top:' + (y1 - 9) + 'px;transform:translateX(-50%);border-radius:3px;background:var(--design-editor-measure-color);color:white;padding:1px 4px;';
    } else {
      var top = Math.min(y1, y2);
      var height = Math.max(1, Math.abs(y2 - y1));
      line.style.cssText = 'position:fixed;left:' + x1 + 'px;top:' + top + 'px;height:' + height + 'px;border-left:1px dashed var(--design-editor-measure-color);';
      labelEl.style.cssText = 'position:fixed;left:' + (x1 + 5) + 'px;top:' + (top + height / 2) + 'px;transform:translateY(-50%);border-radius:3px;background:var(--design-editor-measure-color);color:white;padding:1px 4px;';
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
    measurementOverlay.innerHTML = '';
    measurementOverlay.style.display = 'block';

    if (hoverRect.right <= selectedRect.left) {
      var yLeft = Math.max(hoverRect.top, Math.min(hoverRect.bottom, selectedRect.top + selectedRect.height / 2));
      addMeasurementLine(hoverRect.right, yLeft, selectedRect.left, yLeft, Math.round(selectedRect.left - hoverRect.right) + 'px');
      return;
    }
    if (selectedRect.right <= hoverRect.left) {
      var yRight = Math.max(selectedRect.top, Math.min(selectedRect.bottom, hoverRect.top + hoverRect.height / 2));
      addMeasurementLine(selectedRect.right, yRight, hoverRect.left, yRight, Math.round(hoverRect.left - selectedRect.right) + 'px');
      return;
    }
    if (hoverRect.bottom <= selectedRect.top) {
      var xTop = Math.max(hoverRect.left, Math.min(hoverRect.right, selectedRect.left + selectedRect.width / 2));
      addMeasurementLine(xTop, hoverRect.bottom, xTop, selectedRect.top, Math.round(selectedRect.top - hoverRect.bottom) + 'px');
      return;
    }
    if (selectedRect.bottom <= hoverRect.top) {
      var xBottom = Math.max(selectedRect.left, Math.min(selectedRect.right, hoverRect.left + hoverRect.width / 2));
      addMeasurementLine(xBottom, selectedRect.bottom, xBottom, hoverRect.top, Math.round(hoverRect.top - selectedRect.bottom) + 'px');
      return;
    }
    addMeasurementLine(
      selectedRect.left + selectedRect.width / 2,
      selectedRect.top + selectedRect.height / 2,
      hoverRect.left + hoverRect.width / 2,
      hoverRect.top + hoverRect.height / 2,
      Math.round(Math.hypot(
        hoverRect.left + hoverRect.width / 2 - (selectedRect.left + selectedRect.width / 2),
        hoverRect.top + hoverRect.height / 2 - (selectedRect.top + selectedRect.height / 2)
      )) + 'px'
    );
  }

  function elementFromEditorPoint(clientX, clientY) {
    var shieldPointerEvents = shieldOverlay.style.pointerEvents;
    var selectionPointerEvents = selectionOverlay.style.pointerEvents;
    var highlightPointerEvents = highlightOverlay.style.pointerEvents;
    shieldOverlay.style.pointerEvents = 'none';
    selectionOverlay.style.pointerEvents = 'none';
    highlightOverlay.style.pointerEvents = 'none';
    var target = document.elementFromPoint(clientX, clientY);
    shieldOverlay.style.pointerEvents = shieldPointerEvents;
    selectionOverlay.style.pointerEvents = selectionPointerEvents;
    highlightOverlay.style.pointerEvents = highlightPointerEvents;
    if (!target || target.nodeType !== 1) return null;
    if (isLayerInteractionBlocked(target)) return null;
    return target;
  }

  function stopNativeInteraction(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function isEditorTypingTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('input, textarea, select, [contenteditable], [role="textbox"], [data-agent-native-text-editing]');
  }

  function shouldForwardDesignHotkey(e) {
    if (activeTextEditEl || isEditorTypingTarget(e.target) || e.isComposing) return false;
    var key = e.key;
    var normalized = key && key.length === 1 ? key.toLowerCase() : key;
    var primary = e.metaKey || e.ctrlKey;
    if (key === 'Escape' || key === 'Enter' || key === 'Tab') return true;
    if (key === 'Delete' || key === 'Backspace') return !primary;
    if (/^Arrow/.test(key || '')) return !e.altKey;
    if (primary) {
      return ['z','y','a','x','c','v','d','g','=','+','-','0',']','['].indexOf(normalized) !== -1 ||
        e.code === 'Digit1' ||
        e.code === 'Digit2' ||
        key === '1' ||
        key === '2';
    }
    if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2' || key === '1' || key === '2')) return true;
    return !e.altKey && !e.shiftKey && ['v','f','r','t','p','h','c','k'].indexOf(normalized) !== -1;
  }

  function blurActiveTextEditor() {
    var active = document.activeElement;
    if (
      active &&
      active.closest &&
      active.closest('[data-agent-native-text-editing]') &&
      typeof active.blur === 'function'
    ) {
      active.blur();
    }
  }

  function setTextEditingPointerPassthrough(enabled) {
    if (enabled) {
      if (!textEditPointerState) {
        textEditPointerState = {
          shield: shieldOverlay.style.pointerEvents,
          selection: selectionOverlay.style.pointerEvents,
          highlight: highlightOverlay.style.pointerEvents,
        };
      }
      shieldOverlay.style.pointerEvents = 'none';
      selectionOverlay.style.pointerEvents = 'none';
      highlightOverlay.style.pointerEvents = 'none';
      return;
    }
    if (!textEditPointerState) return;
    shieldOverlay.style.pointerEvents = textEditPointerState.shield;
    selectionOverlay.style.pointerEvents = textEditPointerState.selection;
    highlightOverlay.style.pointerEvents = textEditPointerState.highlight;
    textEditPointerState = null;
  }

  function hasTextContent(el) {
    return !!(el && el.textContent && el.textContent.trim().length > 0);
  }

  function isInlineEditableDescendant(el) {
    if (!el || !el.tagName) return false;
    return [
      'a',
      'abbr',
      'b',
      'br',
      'cite',
      'code',
      'em',
      'i',
      'mark',
      'small',
      'span',
      'strong',
      'sub',
      'sup',
      'time',
      'u',
      'wbr'
    ].indexOf(el.tagName.toLowerCase()) !== -1;
  }

  function hasOnlyInlineEditableChildren(el) {
    if (!el || !hasTextContent(el)) return false;
    var descendants = el.querySelectorAll ? el.querySelectorAll('*') : [];
    for (var i = 0; i < descendants.length; i += 1) {
      if (!isInlineEditableDescendant(descendants[i])) return false;
    }
    return true;
  }

  function findTextEditTarget(hit) {
    if (!hit || hit.nodeType !== 1 || hit === document.body || hit === document.documentElement) return null;
    var selectedContainsHit = selectedEl && selectedEl.contains && selectedEl.contains(hit);
    if (selectedContainsHit && hasOnlyInlineEditableChildren(selectedEl)) return selectedEl;

    var candidate = null;
    var node = hit;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      if (hasOnlyInlineEditableChildren(node)) {
        candidate = node;
      }
      if (selectedEl && node === selectedEl) break;
      node = node.parentElement;
    }
    return candidate || hit;
  }

  function selectElementAtEvent(e) {
    stopNativeInteraction(e);
    blurActiveTextEditor();
    var target = elementFromEditorPoint(e.clientX, e.clientY);
    if (!target) return;
    selectedEl = target;
    var info = getElementInfo(selectedEl);
    positionOverlay(selectionOverlay, selectedEl);
    window.parent.postMessage({ type: 'element-select', payload: info }, '*');
  }

  function openContextMenuAtEvent(e) {
    stopNativeInteraction(e);
    blurActiveTextEditor();
    var target = elementFromEditorPoint(e.clientX, e.clientY);
    var info = null;
    if (target) {
      selectedEl = target;
      info = getElementInfo(target);
      positionOverlay(selectionOverlay, target);
      window.parent.postMessage({ type: 'element-select', payload: info }, '*');
    }
    window.parent.postMessage({
      type: 'element-contextmenu',
      clientX: e.clientX,
      clientY: e.clientY,
      payload: info
    }, '*');
  }

  function findRuntimeTarget(selector, selectorCandidates) {
    var candidates = [];
    if (Array.isArray(selectorCandidates)) {
      selectorCandidates.forEach(function(candidate) {
        if (typeof candidate === 'string' && candidate && candidates.indexOf(candidate) === -1) {
          candidates.push(candidate);
        }
      });
    }
    if (selector && candidates.indexOf(selector) === -1) candidates.push(selector);
    if (
      selectedEl &&
      document.documentElement.contains(selectedEl) &&
      (candidates.length === 0 || matchesExactSelectorList(selectedEl, candidates))
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
    if (!target || target === document.body || target === document.documentElement) return false;
    if (target.parentElement) target.parentElement.removeChild(target);
    if (selectedEl === target || !document.documentElement.contains(selectedEl)) {
      selectedEl = null;
      selectionOverlay.style.display = 'none';
    }
    hoveredEl = null;
    highlightOverlay.style.display = 'none';
    hideMeasurements();
    refreshOverlays();
    return true;
  }

  function readPx(value) {
    var num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
  }

  function currentRotation(el) {
    var transform = el.style.transform || window.getComputedStyle(el).transform || '';
    var match = transform.match(/rotate\\((-?\\d+(?:\\.\\d+)?)deg\\)/);
    if (match) return parseFloat(match[1]) || 0;
    if (transform && transform !== 'none' && window.DOMMatrixReadOnly) {
      try {
        var matrix = new DOMMatrixReadOnly(transform);
        return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
      } catch (err) {}
    }
    return 0;
  }

  function mergeRotation(el, degrees) {
    var inline = el.style.transform || '';
    var next = inline.match(/rotate\\((-?\\d+(?:\\.\\d+)?)deg\\)/)
      ? inline.replace(/rotate\\((-?\\d+(?:\\.\\d+)?)deg\\)/, 'rotate(' + degrees + 'deg)')
      : (inline && inline !== 'none' ? inline + ' ' : '') + 'rotate(' + degrees + 'deg)';
    return next.trim();
  }

  function ensurePositionable(el) {
    var cs = window.getComputedStyle(el);
    if (cs.position === 'static') {
      el.style.position = 'relative';
      if (!el.style.left) el.style.left = '0px';
      if (!el.style.top) el.style.top = '0px';
    }
  }

  function postVisualStyleChange(styles) {
    if (!selectedEl) return;
    window.parent.postMessage({
      type: 'visual-style-change',
      selector: getSelector(selectedEl),
      styles: styles,
      payload: getElementInfo(selectedEl),
    }, '*');
  }

	  function postTextContentChange(el, value, html) {
	    window.parent.postMessage({
	      type: 'text-content-change',
      selector: getSelector(el),
      value: value,
      html: html,
      payload: getElementInfo(el),
	    }, '*');
	  }

	  function postTextEditingState(el, active) {
	    var selection = window.getSelection && window.getSelection();
	    window.parent.postMessage({
	      type: 'text-editing-state',
	      active: !!active,
	      selector: el ? getSelector(el) : '',
	      hasRange: !!(active && selection && selection.rangeCount > 0 && !selection.isCollapsed && selectionBelongsToElement(selection, el)),
	    }, '*');
	  }

	  function insertPlainTextAtSelection(text) {
	    if (!text) return;
	    if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
	      document.execCommand('insertText', false, text);
	      return;
    }
    var selection = window.getSelection && window.getSelection();
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

	  function selectionBelongsToElement(selection, el) {
	    if (!selection || !el || selection.rangeCount === 0) return false;
	    var range = selection.getRangeAt(0);
	    var ancestor = range.commonAncestorContainer;
	    var ancestorEl = ancestor && ancestor.nodeType === 1 ? ancestor : ancestor && ancestor.parentElement;
	    return !!(ancestorEl && (ancestorEl === el || el.contains(ancestorEl)));
	  }

	  function applyTextRangeStyle(property, value) {
	    if (!activeTextEditEl || !property) return false;
	    var selection = window.getSelection && window.getSelection();
	    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
	    if (!selectionBelongsToElement(selection, activeTextEditEl)) return false;
	    var range = selection.getRangeAt(0);
	    var span = document.createElement('span');
	    span.style[property] = value;
	    if (!span.getAttribute('style')) return false;
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

  function showTransformBadge(text, clientX, clientY) {
    transformBadge.textContent = text;
    transformBadge.style.display = 'block';
    transformBadge.style.left = clientX + 12 + 'px';
    transformBadge.style.top = clientY + 12 + 'px';
  }

  function hideTransformBadge() {
    transformBadge.style.display = 'none';
  }

  function hideInsertionGuide() {
    insertionGuide.style.display = 'none';
  }

  function isOverlayElement(el) {
    return Boolean(el && el.getAttribute && el.getAttribute('data-agent-native-edit-overlay'));
  }

  function draggableElementChildren(parent) {
    return Array.prototype.slice.call(parent.children).filter(function(child) {
      return child.nodeType === 1 && !isOverlayElement(child) && !isLayerInteractionBlocked(child);
    });
  }

  function isFlowReorderCandidate(el) {
    if (!el || !el.parentElement) return false;
    if (el === document.body || el === document.documentElement) return false;
    var cs = window.getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed') return false;
    var parent = el.parentElement;
    if (parent === document.body && draggableElementChildren(parent).length <= 2) return false;
    return draggableElementChildren(parent).filter(function(child) { return child !== el; }).length > 0;
  }

  function parentFlowAxis(parent) {
    var cs = window.getComputedStyle(parent);
    if (cs.display === 'flex' || cs.display === 'inline-flex') {
      return cs.flexDirection && cs.flexDirection.indexOf('row') === 0 ? 'x' : 'y';
    }
    if (cs.display === 'grid' || cs.display === 'inline-grid') {
      var cols = (cs.gridTemplateColumns || '').split(' ').filter(Boolean).length;
      return cols > 1 ? 'x' : 'y';
    }
    return 'y';
  }

  function reorderTargetForPoint(el, clientX, clientY) {
    if (!el || !el.parentElement) return null;
    var hit = elementFromEditorPoint(clientX, clientY);
    if (
      hit &&
      hit !== document.body &&
      hit !== document.documentElement &&
      hit !== el &&
      !el.contains(hit) &&
      !isOverlayElement(hit)
    ) {
      var hitChildren = draggableElementChildren(hit).filter(function(child) {
        return child !== el;
      });
      if (hitChildren.length === 0) {
        return { anchor: hit, placement: 'inside', axis: parentFlowAxis(hit) };
      }
      var hitParent = hit.parentElement;
      if (hitParent) {
        var hitAxis = parentFlowAxis(hitParent);
        var hitRect = hit.getBoundingClientRect();
        var hitCenter = hitAxis === 'x'
          ? hitRect.left + hitRect.width / 2
          : hitRect.top + hitRect.height / 2;
        var hitPointer = hitAxis === 'x' ? clientX : clientY;
        return {
          anchor: hit,
          placement: hitPointer < hitCenter ? 'before' : 'after',
          axis: hitAxis,
        };
      }
    }
    var parent = el.parentElement;
    var axis = parentFlowAxis(parent);
    var siblings = draggableElementChildren(parent).filter(function(child) {
      return child !== el;
    });
    if (!siblings.length) return null;
    var beforeTarget = null;
    for (var i = 0; i < siblings.length; i += 1) {
      var rect = siblings[i].getBoundingClientRect();
      var center = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      var pointer = axis === 'x' ? clientX : clientY;
      if (pointer < center) {
        beforeTarget = siblings[i];
        break;
      }
    }
    var anchor = beforeTarget || siblings[siblings.length - 1];
    var placement = beforeTarget ? 'before' : 'after';
    return { anchor: anchor, placement: placement, axis: axis };
  }

  function showInsertionGuideFor(target) {
    if (!target || !target.anchor) {
      hideInsertionGuide();
      return;
    }
    var rect = target.anchor.getBoundingClientRect();
    insertionGuide.style.display = 'block';
    insertionGuide.style.background = 'var(--design-editor-accent-color)';
    insertionGuide.style.border = '0';
    insertionGuide.style.boxShadow = '0 0 0 1px var(--design-editor-accent-color)';
    if (target.placement === 'inside') {
      insertionGuide.style.left = rect.left + 'px';
      insertionGuide.style.top = rect.top + 'px';
      insertionGuide.style.width = rect.width + 'px';
      insertionGuide.style.height = rect.height + 'px';
      insertionGuide.style.background = 'color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)';
      insertionGuide.style.border = '2px solid var(--design-editor-accent-color)';
      insertionGuide.style.boxShadow = 'none';
      return;
    }
    if (target.axis === 'x') {
      var x = target.placement === 'before' ? rect.left : rect.right;
      insertionGuide.style.left = x + 'px';
      insertionGuide.style.top = rect.top + 'px';
      insertionGuide.style.width = '2px';
      insertionGuide.style.height = rect.height + 'px';
    } else {
      var y = target.placement === 'before' ? rect.top : rect.bottom;
      insertionGuide.style.left = rect.left + 'px';
      insertionGuide.style.top = y + 'px';
      insertionGuide.style.width = rect.width + 'px';
      insertionGuide.style.height = '2px';
    }
  }

  function applyRuntimeReorder(el, target) {
    if (!el || !target || !target.anchor || !target.anchor.parentElement) return;
    if (target.placement === 'inside') {
      target.anchor.appendChild(el);
      return;
    }
    var parent = target.anchor.parentElement;
    if (target.placement === 'before') {
      parent.insertBefore(el, target.anchor);
    } else {
      parent.insertBefore(el, target.anchor.nextSibling);
    }
  }

	  function postVisualStructureChange(el, target) {
	    if (!el || !target || !target.anchor) return;
	    var requestId = 'move-' + Date.now() + '-' + Math.random().toString(16).slice(2);
	    pendingStructureMove = { requestId: requestId, el: el, target: target };
	    window.parent.postMessage({
	      type: 'visual-structure-change',
	      requestId: requestId,
	      selector: getSelector(el),
	      sourceId: getSourceId(el),
	      anchorSelector: getSelector(target.anchor),
	      anchorSourceId: getSourceId(target.anchor),
      placement: target.placement,
      payload: getElementInfo(el),
    }, '*');
  }

  function postVisualDuplicateChange(originalEl, cloneEl, target) {
    if (!originalEl || !cloneEl) return;
    window.parent.postMessage({
      type: 'visual-duplicate-change',
      selector: getSelector(originalEl),
      sourceId: getSourceId(originalEl),
      anchorSelector: target && target.anchor ? getSelector(target.anchor) : '',
      anchorSourceId: target && target.anchor ? getSourceId(target.anchor) : '',
      placement: target && target.placement ? target.placement : 'after',
      cloneHtml: cloneEl.outerHTML,
      payload: getElementInfo(cloneEl),
    }, '*');
  }

  function startMove(e) {
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    var originalSelectedEl = selectedEl;
    var duplicatedForDrag = false;
    if (e.altKey && selectedEl !== document.body && selectedEl !== document.documentElement) {
      var clone = selectedEl.cloneNode(true);
      resetRuntimeStableIds(clone);
      selectedEl.parentElement.insertBefore(clone, selectedEl.nextSibling);
      selectedEl = clone;
      duplicatedForDrag = true;
      positionOverlay(selectionOverlay, selectedEl);
      window.parent.postMessage({ type: 'element-select', payload: getElementInfo(selectedEl) }, '*');
    }
    if (isFlowReorderCandidate(selectedEl)) {
      var currentTarget = reorderTargetForPoint(selectedEl, e.clientX, e.clientY);
      showInsertionGuideFor(currentTarget);
      function onReorderMove(ev) {
        currentTarget = reorderTargetForPoint(selectedEl, ev.clientX, ev.clientY);
        showInsertionGuideFor(currentTarget);
        showTransformBadge(currentTarget ? 'Move layer' : 'Move', ev.clientX, ev.clientY);
      }
      function onReorderUp() {
        document.removeEventListener('mousemove', onReorderMove, true);
        document.removeEventListener('mouseup', onReorderUp, true);
	        hideTransformBadge();
	        hideInsertionGuide();
	        if (!currentTarget) return;
	        if (duplicatedForDrag) {
	          applyRuntimeReorder(selectedEl, currentTarget);
	          postVisualDuplicateChange(originalSelectedEl, selectedEl, currentTarget);
	        }
	        else postVisualStructureChange(selectedEl, currentTarget);
	      }
      document.addEventListener('mousemove', onReorderMove, true);
      document.addEventListener('mouseup', onReorderUp, true);
      return;
    }
    ensurePositionable(selectedEl);
    var cs = window.getComputedStyle(selectedEl);
    var originLeft = readPx(selectedEl.style.left || cs.left);
    var originTop = readPx(selectedEl.style.top || cs.top);
    var startX = e.clientX;
    var startY = e.clientY;
    function onMove(ev) {
      var nextLeft = originLeft + ev.clientX - startX;
      var nextTop = originTop + ev.clientY - startY;
      selectedEl.style.left = Math.round(nextLeft) + 'px';
      selectedEl.style.top = Math.round(nextTop) + 'px';
      showTransformBadge('X ' + Math.round(nextLeft) + '  Y ' + Math.round(nextTop), ev.clientX, ev.clientY);
      refreshOverlays();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      hideTransformBadge();
      if (duplicatedForDrag) {
        postVisualDuplicateChange(originalSelectedEl, selectedEl);
      } else {
        postVisualStyleChange({
          position: selectedEl.style.position,
          left: selectedEl.style.left,
          top: selectedEl.style.top,
        });
      }
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }

  function startResize(handle, e) {
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    ensurePositionable(selectedEl);
    var cs = window.getComputedStyle(selectedEl);
    var origin = {
      left: readPx(selectedEl.style.left || cs.left),
      top: readPx(selectedEl.style.top || cs.top),
      width: selectedEl.getBoundingClientRect().width,
      height: selectedEl.getBoundingClientRect().height,
      ratio: selectedEl.getBoundingClientRect().width / Math.max(1, selectedEl.getBoundingClientRect().height),
    };
    var startX = e.clientX;
    var startY = e.clientY;
    function nextRect(ev) {
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      var left = origin.left;
      var top = origin.top;
      var width = origin.width;
      var height = origin.height;
      if (handle.indexOf('w') !== -1) {
        left = origin.left + dx;
        width = origin.width - dx;
      }
      if (handle.indexOf('e') !== -1) width = origin.width + dx;
      if (handle.indexOf('n') !== -1) {
        top = origin.top + dy;
        height = origin.height - dy;
      }
      if (handle.indexOf('s') !== -1) height = origin.height + dy;
      width = Math.max(8, width);
      height = Math.max(8, height);
      if ((ev.shiftKey || scaleToolEnabled) && handle.length === 2) {
        if (Math.abs(dx) > Math.abs(dy)) height = width / origin.ratio;
        else width = height * origin.ratio;
      }
      if (ev.altKey) {
        if (handle.indexOf('w') !== -1 || handle.indexOf('e') !== -1) left = origin.left - (width - origin.width) / 2;
        if (handle.indexOf('n') !== -1 || handle.indexOf('s') !== -1) top = origin.top - (height - origin.height) / 2;
      }
      return { left: left, top: top, width: width, height: height };
    }
    function onMove(ev) {
      var rect = nextRect(ev);
      selectedEl.style.left = Math.round(rect.left) + 'px';
      selectedEl.style.top = Math.round(rect.top) + 'px';
      selectedEl.style.width = Math.round(rect.width) + 'px';
      selectedEl.style.height = Math.round(rect.height) + 'px';
      showTransformBadge(Math.round(rect.width) + ' x ' + Math.round(rect.height), ev.clientX, ev.clientY);
      refreshOverlays();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      hideTransformBadge();
      postVisualStyleChange({
        position: selectedEl.style.position,
        left: selectedEl.style.left,
        top: selectedEl.style.top,
        width: selectedEl.style.width,
        height: selectedEl.style.height,
      });
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }

  function startRotate(e) {
    if (!selectedEl) return;
    if (isLayerInteractionBlocked(selectedEl)) return;
    e.preventDefault();
    e.stopPropagation();
    var rect = selectedEl.getBoundingClientRect();
    var center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    var originAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x) * 180 / Math.PI;
    var originRotation = currentRotation(selectedEl);
    function onMove(ev) {
      var pointerAngle = Math.atan2(ev.clientY - center.y, ev.clientX - center.x) * 180 / Math.PI;
      var next = originRotation + pointerAngle - originAngle;
      if (ev.shiftKey) next = Math.round(next / 15) * 15;
      next = Math.round(next);
      selectedEl.style.transform = mergeRotation(selectedEl, next);
      showTransformBadge(next + 'deg', ev.clientX, ev.clientY);
      refreshOverlays();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      hideTransformBadge();
      postVisualStyleChange({
        transform: selectedEl.style.transform,
      });
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }

  selectionOverlay.addEventListener('mousedown', function(e) {
    var resizeHandle = e.target && e.target.getAttribute && e.target.getAttribute('data-agent-native-edit-handle');
    if (!resizeHandle && e.target && e.target.getAttribute) {
      resizeHandle = e.target.getAttribute('data-agent-native-edge-handle');
    }
    if (resizeHandle) {
      startResize(resizeHandle, e);
      return;
    }
    var rotateHandle = e.target && e.target.getAttribute && e.target.getAttribute('data-agent-native-rotate-handle');
    if (rotateHandle) {
      startRotate(e);
      return;
    }
    startMove(e);
  }, true);

  ['pointerdown','pointerup','mousedown','mouseup','auxclick'].forEach(function(type) {
    shieldOverlay.addEventListener(type, stopNativeInteraction, true);
  });

  shieldOverlay.addEventListener('click', selectElementAtEvent, true);
  shieldOverlay.addEventListener('contextmenu', openContextMenuAtEvent, true);
  selectionOverlay.addEventListener('contextmenu', openContextMenuAtEvent, true);
  document.addEventListener('contextmenu', function(e) {
    if (isOverlayElement(e.target)) return;
    openContextMenuAtEvent(e);
  }, true);

  document.addEventListener('keydown', function(e) {
    if (!shouldForwardDesignHotkey(e)) return;
    stopNativeInteraction(e);
    window.parent.postMessage({
      type: 'design-hotkey',
      key: e.key,
      code: e.code,
      metaKey: !!e.metaKey,
      ctrlKey: !!e.ctrlKey,
      shiftKey: !!e.shiftKey,
      altKey: !!e.altKey,
      repeat: !!e.repeat
    }, '*');
  }, true);

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

  function beginTextEditingFromEvent(e) {
    if (activeTextEditEl && e.target && activeTextEditEl.contains(e.target)) return;
    if (!textEditingEnabled) {
      stopNativeInteraction(e);
      return;
    }
    stopNativeInteraction(e);
    var target = findTextEditTarget(elementFromEditorPoint(e.clientX, e.clientY));
    if (!target || target.nodeType !== 1) return;
    selectedEl = target;
	    var originalText = target.textContent || '';
	    var originalHtml = target.innerHTML || '';
	    var committed = false;
	    activeTextEditEl = target;
	    target.setAttribute('contenteditable', 'true');
    target.setAttribute('data-agent-native-text-editing', 'true');
    target.style.cursor = 'text';
    target.style.outline = '1.5px solid var(--design-editor-accent-color)';
    target.style.outlineOffset = '2px';
    setTextEditingPointerPassthrough(true);
    positionOverlay(selectionOverlay, target);
	    window.parent.postMessage({ type: 'element-select', payload: getElementInfo(target) }, '*');
	    postTextEditingState(target, true);

    function finish(commit) {
      if (committed) return;
      committed = true;
	      target.removeEventListener('blur', onBlur, true);
	      target.removeEventListener('keydown', onKeyDown, true);
	      target.removeEventListener('paste', onPaste, true);
	      target.removeEventListener('keyup', onSelectionChange, true);
	      target.removeEventListener('mouseup', onSelectionChange, true);
	      document.removeEventListener('selectionchange', onSelectionChange);
      target.removeAttribute('contenteditable');
      target.removeAttribute('data-agent-native-text-editing');
	      target.style.cursor = '';
	      target.style.outline = '';
	      target.style.outlineOffset = '';
      setTextEditingPointerPassthrough(false);
	      if (activeTextEditEl === target) activeTextEditEl = null;
	      postTextEditingState(target, false);
	      if (!commit) {
	        target.innerHTML = originalHtml;
        refreshOverlays();
        return;
      }
      var next = target.textContent || '';
      var nextHtml = target.innerHTML || '';
      refreshOverlays();
      if (next !== originalText || nextHtml !== originalHtml) {
        postTextContentChange(target, next, nextHtml);
      }
    }

    function onBlur() {
      finish(true);
    }

    function onKeyDown(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(true);
        target.blur();
        return;
      }
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
        target.blur();
      }
    }

	    function onPaste(ev) {
	      ev.preventDefault();
	      insertPlainTextAtSelection((ev.clipboardData && ev.clipboardData.getData('text/plain')) || '');
	    }

	    function onSelectionChange() {
	      postTextEditingState(target, true);
	    }

	    target.addEventListener('blur', onBlur, true);
	    target.addEventListener('keydown', onKeyDown, true);
	    target.addEventListener('paste', onPaste, true);
	    target.addEventListener('keyup', onSelectionChange, true);
	    target.addEventListener('mouseup', onSelectionChange, true);
	    document.addEventListener('selectionchange', onSelectionChange);
    target.focus();
    placeTextCaretFromPoint(target, e.clientX, e.clientY);
  }

  shieldOverlay.addEventListener('dblclick', beginTextEditingFromEvent, true);
  selectionOverlay.addEventListener('dblclick', beginTextEditingFromEvent, true);
  document.addEventListener('dblclick', function(e) {
    if (isOverlayElement(e.target)) return;
    beginTextEditingFromEvent(e);
  }, true);

  shieldOverlay.addEventListener('pointermove', function(e) {
    stopNativeInteraction(e);
    hoveredEl = elementFromEditorPoint(e.clientX, e.clientY);
    if (!hoveredEl) {
      highlightOverlay.style.display = 'none';
      hideMeasurements();
      return;
    }
    if (hoveredEl && hoveredEl.closest('[data-agent-native-text-editing]')) return;
    positionOverlay(highlightOverlay, hoveredEl);
    if (e.altKey && selectedEl && hoveredEl && selectedEl !== hoveredEl) {
      showMeasurements(selectedEl, hoveredEl);
    } else {
      hideMeasurements();
    }
    var info = getElementInfo(hoveredEl);
    window.parent.postMessage({ type: 'element-hover', payload: info }, '*');
  }, true);

  shieldOverlay.addEventListener('pointerleave', function(e) {
    stopNativeInteraction(e);
    hoveredEl = null;
    highlightOverlay.style.display = 'none';
    hideMeasurements();
  }, true);

  window.addEventListener('keyup', function(e) {
    if (e.key === 'Alt') hideMeasurements();
  }, true);

  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (!e.data) return;
    if (e.data.type === 'scale-tool-mode') {
      scaleToolEnabled = !!e.data.enabled;
      return;
    }
    if (e.data.type === 'clear-selection') {
      selectedEl = null;
      hoveredEl = null;
      selectionOverlay.style.display = 'none';
      highlightOverlay.style.display = 'none';
      hideMeasurements();
      return;
    }
    if (e.data.type === 'select-element') {
      var candidates = [];
      if (Array.isArray(e.data.selectorCandidates)) {
        e.data.selectorCandidates.forEach(function(selector) {
          if (typeof selector === 'string' && selector && candidates.indexOf(selector) === -1) {
            candidates.push(selector);
          }
        });
      }
      if (e.data.selector && candidates.indexOf(String(e.data.selector)) === -1) {
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
      selectedEl = target;
      var selectedInfo = getElementInfo(target);
      positionOverlay(selectionOverlay, target);
      window.parent.postMessage({ type: 'element-select', payload: selectedInfo }, '*');
      return;
    }
    if (e.data.type === 'hover-element') {
      var hoverCandidates = [];
      if (Array.isArray(e.data.selectorCandidates)) {
        e.data.selectorCandidates.forEach(function(selector) {
          if (typeof selector === 'string' && selector && hoverCandidates.indexOf(selector) === -1) {
            hoverCandidates.push(selector);
          }
        });
      }
      if (e.data.selector && hoverCandidates.indexOf(String(e.data.selector)) === -1) {
        hoverCandidates.push(String(e.data.selector));
      }
      if (hoverCandidates.length === 0) {
        hoveredEl = null;
        highlightOverlay.style.display = 'none';
        hideMeasurements();
        return;
      }
      var hoverTarget = findRuntimeTarget(String(e.data.selector || ''), hoverCandidates);
      hoveredEl = hoverTarget;
      if (hoveredEl && !isLayerInteractionBlocked(hoveredEl)) {
        positionOverlay(highlightOverlay, hoveredEl);
      } else {
        highlightOverlay.style.display = 'none';
        hideMeasurements();
      }
      return;
    }
    if (e.data.type === 'layer-states') {
      lockedSelectors = Array.isArray(e.data.lockedSelectors) ? e.data.lockedSelectors.filter(function(item) { return typeof item === 'string'; }) : [];
      hiddenSelectors = Array.isArray(e.data.hiddenSelectors) ? e.data.hiddenSelectors.filter(function(item) { return typeof item === 'string'; }) : [];
      if (selectedEl && isLayerInteractionBlocked(selectedEl)) {
        selectedEl = null;
        selectionOverlay.style.display = 'none';
      }
      if (hoveredEl && isLayerInteractionBlocked(hoveredEl)) {
        hoveredEl = null;
        highlightOverlay.style.display = 'none';
      }
      applyHiddenSelectors();
	      return;
	    }
	    if (e.data.type === 'visual-structure-ack') {
	      if (!pendingStructureMove || e.data.requestId !== pendingStructureMove.requestId) return;
	      var move = pendingStructureMove;
	      pendingStructureMove = null;
	      if (e.data.applied) {
	        applyRuntimeReorder(move.el, move.target);
	        selectedEl = move.el;
	        positionOverlay(selectionOverlay, selectedEl);
	        window.parent.postMessage({ type: 'element-select', payload: getElementInfo(selectedEl) }, '*');
	      }
	      return;
	    }
	    if (e.data.type === 'replace-document-content') {
	      replaceRuntimeDocument(e.data.content, e.data.selectedSelector, e.data.selectorCandidates);
	      return;
	    }
	    if (e.data.type === 'delete-element') {
	      removeRuntimeTarget(e.data.selector, e.data.selectorCandidates);
	      return;
	    }
	    if (e.data.type !== 'style-change') return;
	    var sel = e.data.selector;
	    var prop = e.data.property;
	    var val = e.data.value;
	    var el = sel ? document.querySelector(sel) : null;
	    if (activeTextEditEl && el === activeTextEditEl && applyTextRangeStyle(prop, val)) {
	      postTextContentChange(activeTextEditEl, activeTextEditEl.textContent || '', activeTextEditEl.innerHTML || '');
	      refreshOverlays();
	      return;
	    }
	    if (el) el.style[prop] = val;
	  });

  window.addEventListener('scroll', refreshOverlays, true);
  window.addEventListener('resize', refreshOverlays);
})();
</script>
`;

interface DesignCanvasProps {
  content: string;
  contentKey?: string;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  deviceFrame: DeviceFrameType;
  embeddedFrame?: {
    viewportWidth: number;
    viewportHeight: number;
    displayWidth: number;
    displayHeight: number;
  };
  editMode: boolean;
  interactMode: boolean;
  scaleMode?: boolean;
  onElementSelect: (info: ElementInfo) => void;
  onElementHover: (info: ElementInfo) => void;
  onVisualStyleChange?: (
    selector: string,
    styles: Record<string, string>,
    info?: ElementInfo,
  ) => void;
  onTextContentChange?: (
    selector: string,
    value: string,
    info?: ElementInfo,
    details?: { html?: string },
  ) => void;
  onTextEditingStateChange?: (state: {
    active: boolean;
    selector?: string;
    hasRange?: boolean;
  }) => void;
  onIframeHotkey?: (event: IframeHotkeyPayload) => void;
  onIframeContextMenu?: (event: IframeContextMenuPayload) => void;
  onVisualStructureChange?: (
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      requestId?: string;
    },
  ) => boolean | void;
  onVisualDuplicateChange?: (
    selector: string,
    cloneHtml: string,
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSelector?: string;
      anchorSourceId?: string;
      placement?: "before" | "after" | "inside";
    },
  ) => boolean | void;
  tweakValues: Record<string, string>;
  /** Whether draw-to-prompt mode is active (overlays the iframe). */
  drawMode?: boolean;
  /** Called when the user exits draw mode (X / Escape / after Send). */
  onExitDrawMode?: () => void;
  /** Whether comment-pin drop mode is active. */
  pinMode?: boolean;
  selectedSelector?: string | null;
  selectedSelectorCandidates?: string[];
  hoveredSelector?: string | null;
  hoveredSelectorCandidates?: string[];
  lockedSelectors?: string[];
  hiddenSelectors?: string[];
  clearSelectionRequest?: number;
  /** Called when the user exits pin mode. */
  onExitPinMode?: () => void;
  /** Stable id of the open design (used for pin scoping + agent prompt). */
  designId?: string;
  /** Human-readable label for the design (used in agent prompt). */
  designTitle?: string;
  /** Stable id for comment pins, usually scoped to the active screen. */
  commentContextId?: string;
  /** Human-readable label for comment-pin prompts. */
  commentContextLabel?: string;
  /**
   * Called when a link inside the prototype points to another screen (a
   * relative href or `data-screen`). Lets the editor switch the active screen
   * instead of letting the iframe navigate to the app. External links are
   * opened in a new tab by the iframe itself and never reach this callback.
   */
  onPrototypeNavigate?: (screen: string, href: string) => void;
}

function getExternalPreviewUrl(content: string): string | null {
  const trimmed = content.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export interface IframeHotkeyPayload {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

export interface IframeContextMenuPayload {
  clientX: number;
  clientY: number;
  viewportClientX?: number;
  viewportClientY?: number;
  info?: ElementInfo | null;
}

export function DesignCanvas({
  content,
  contentKey,
  zoom,
  onZoomChange,
  deviceFrame,
  embeddedFrame,
  editMode,
  interactMode,
  scaleMode = false,
  clearSelectionRequest,
  onElementSelect,
  onElementHover,
  onVisualStyleChange,
  onTextContentChange,
  onTextEditingStateChange,
  onIframeHotkey,
  onIframeContextMenu,
  onVisualStructureChange,
  onVisualDuplicateChange,
  tweakValues,
  drawMode,
  onExitDrawMode,
  pinMode,
  selectedSelector,
  selectedSelectorCandidates = [],
  hoveredSelector,
  hoveredSelectorCandidates = [],
  lockedSelectors = [],
  hiddenSelectors = [],
  onExitPinMode,
  designId,
  designTitle,
  commentContextId,
  commentContextLabel,
  onPrototypeNavigate,
}: DesignCanvasProps) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const previousContentKeyRef = useRef(contentKey);
  const [renderedContent, setRenderedContent] = useState(content);
  const [annotationPins, setAnnotationPins] = useState<CanvasPin[]>([]);
  const [pinSubmitSignal, setPinSubmitSignal] = useState(0);
  const isEmbeddedFrame = Boolean(embeddedFrame);
  const externalPreviewUrl = useMemo(
    () => getExternalPreviewUrl(renderedContent),
    [renderedContent],
  );
  zoomRef.current = zoom;

  const queuedAnnotationPins = useMemo(
    () =>
      annotationPins.filter(
        (pin) => pin.queued && !pin.submitted && (pin.draft || "").trim(),
      ),
    [annotationPins],
  );

  useEffect(() => {
    if (previousContentKeyRef.current !== contentKey) {
      previousContentKeyRef.current = contentKey;
      setRenderedContent(content);
    }
    // Same-screen visual edits are already applied optimistically inside the
    // iframe before the source write is queued. Rebuilding srcdoc for that echo
    // reloads the iframe, flashes unstyled content, and drops selection. Only a
    // content-key change (screen switch / explicit remount) should replace the
    // iframe document here; the bridge replays inspector state after that load.
  }, [content, contentKey]);

  usePinchZoom({
    containerRef: scrollContainerRef,
    zoom,
    setZoom: onZoomChange ?? (() => {}),
    min: 10,
    max: 500,
    zoomToCursor: deviceFrame === "none",
    enabled: Boolean(onZoomChange),
  });

  // Build the srcdoc. The tweak bridge ALWAYS goes in so the panel works
  // outside Edit mode. The editor chrome bridge is omitted only for Interact.
  const srcdoc = useMemo(() => {
    if (externalPreviewUrl) return undefined;
    const editorChromeBridge = interactMode
      ? ""
      : createEditorBridgeThemeScript(readEditorBridgeThemeVars()) +
        EDITOR_CHROME_BRIDGE_SCRIPT.replace(
          "__TEXT_EDITING_ENABLED__",
          editMode ? "true" : "false",
        );
    const embeddedWheelBridge = EMBEDDED_WHEEL_BRIDGE_SCRIPT.replace(
      "__EMBEDDED_WHEEL_FORWARDING_ENABLED__",
      isEmbeddedFrame ? "true" : "false",
    );
    const bridgeToInject =
      TWEAK_BRIDGE_SCRIPT +
      ZOOM_BRIDGE_SCRIPT +
      NAV_BRIDGE_SCRIPT +
      embeddedWheelBridge +
      editorChromeBridge;
    if (renderedContent.includes("</body>")) {
      return renderedContent.replace("</body>", bridgeToInject + "</body>"); // i18n-ignore generated iframe HTML injection
    }
    if (renderedContent.includes("</html>")) {
      return renderedContent.replace("</html>", bridgeToInject + "</html>"); // i18n-ignore generated iframe HTML injection
    }
    // No body/html tags — wrap it
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${renderedContent}${bridgeToInject}</body></html>`;
  }, [
    editMode,
    externalPreviewUrl,
    interactMode,
    isEmbeddedFrame,
    renderedContent,
  ]);

  // Listen for messages from the iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (
        !isTrustedCanvasBridgeMessage({
          source: e.source,
          origin: e.origin,
          iframeWindow: iframeRef.current?.contentWindow,
          parentOrigin: window.location.origin,
        })
      ) {
        return;
      }
      if (!e.data || !e.data.type) return;
      if (e.data.type === "element-select") {
        onElementSelect(e.data.payload);
      }
      if (e.data.type === "element-hover") {
        onElementHover(e.data.payload);
      }
      if (e.data.type === "visual-style-change") {
        const selector = String(e.data.selector || "");
        const styles =
          e.data.styles && typeof e.data.styles === "object"
            ? (e.data.styles as Record<string, string>)
            : {};
        if (selector && Object.keys(styles).length > 0) {
          onVisualStyleChange?.(selector, styles, e.data.payload);
        }
        return;
      }
      if (e.data.type === "text-content-change") {
        const selector = String(e.data.selector || "");
        const value = String(e.data.value ?? "");
        const html =
          typeof e.data.html === "string" ? String(e.data.html) : undefined;
        if (selector) {
          onTextContentChange?.(selector, value, e.data.payload, { html });
        }
        return;
      }
      if (e.data.type === "visual-structure-change") {
        const selector = String(e.data.selector || "");
        const anchorSelector = String(e.data.anchorSelector || "");
        const placement = String(e.data.placement || "after");
        const requestId =
          typeof e.data.requestId === "string" ? e.data.requestId : undefined;
        if (
          selector &&
          anchorSelector &&
          (placement === "before" ||
            placement === "after" ||
            placement === "inside")
        ) {
          const applied = onVisualStructureChange?.(
            selector,
            anchorSelector,
            placement,
            e.data.payload,
            {
              requestId,
              sourceId:
                typeof e.data.sourceId === "string"
                  ? e.data.sourceId
                  : undefined,
              anchorSourceId:
                typeof e.data.anchorSourceId === "string"
                  ? e.data.anchorSourceId
                  : undefined,
            },
          );
          if (requestId) {
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "visual-structure-ack",
                requestId,
                applied: applied !== false,
              },
              "*",
            );
          }
        }
        return;
      }
      if (e.data.type === "visual-duplicate-change") {
        const selector = String(e.data.selector || "");
        const cloneHtml =
          typeof e.data.cloneHtml === "string" ? String(e.data.cloneHtml) : "";
        const placement = String(e.data.placement || "after");
        if (
          selector &&
          cloneHtml &&
          (placement === "before" ||
            placement === "after" ||
            placement === "inside")
        ) {
          onVisualDuplicateChange?.(selector, cloneHtml, e.data.payload, {
            sourceId:
              typeof e.data.sourceId === "string" ? e.data.sourceId : undefined,
            anchorSelector:
              typeof e.data.anchorSelector === "string"
                ? e.data.anchorSelector
                : undefined,
            anchorSourceId:
              typeof e.data.anchorSourceId === "string"
                ? e.data.anchorSourceId
                : undefined,
            placement,
          });
        }
        return;
      }
      if (e.data.type === "text-editing-state") {
        onTextEditingStateChange?.({
          active: Boolean(e.data.active),
          selector:
            typeof e.data.selector === "string" ? e.data.selector : undefined,
          hasRange: Boolean(e.data.hasRange),
        });
        return;
      }
      if (e.data.type === "design-hotkey") {
        onIframeHotkey?.({
          key: String(e.data.key || ""),
          code: String(e.data.code || ""),
          metaKey: Boolean(e.data.metaKey),
          ctrlKey: Boolean(e.data.ctrlKey),
          shiftKey: Boolean(e.data.shiftKey),
          altKey: Boolean(e.data.altKey),
          repeat: Boolean(e.data.repeat),
        });
        return;
      }
      if (e.data.type === "element-contextmenu") {
        const clientX = Number(e.data.clientX);
        const clientY = Number(e.data.clientY);
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
          const iframe = iframeRef.current;
          const iframeRect = iframe?.getBoundingClientRect();
          const scaleX =
            iframe && iframeRect && iframe.clientWidth > 0
              ? iframeRect.width / iframe.clientWidth
              : 1;
          const scaleY =
            iframe && iframeRect && iframe.clientHeight > 0
              ? iframeRect.height / iframe.clientHeight
              : 1;
          onIframeContextMenu?.({
            clientX,
            clientY,
            viewportClientX: (iframeRect?.left ?? 0) + clientX * scaleX,
            viewportClientY: (iframeRect?.top ?? 0) + clientY * scaleY,
            info: e.data.payload ?? null,
          });
        }
        return;
      }
      if (e.data.type === "prototype-navigate") {
        // External links are opened inside the iframe (sandbox allow-popups);
        // only internal screen switches reach the parent.
        onPrototypeNavigate?.(
          String(e.data.screen || ""),
          String(e.data.href || ""),
        );
        return;
      }
      if (e.data.type === "embedded-canvas-wheel") {
        if (!isEmbeddedFrame) return;
        const iframe = iframeRef.current;
        if (!iframe) return;
        const rect = iframe.getBoundingClientRect();
        const scaleX =
          iframe.clientWidth > 0 ? rect.width / iframe.clientWidth : 1;
        const scaleY =
          iframe.clientHeight > 0 ? rect.height / iframe.clientHeight : 1;
        const clientX = rect.left + Number(e.data.clientX || 0) * scaleX;
        const clientY = rect.top + Number(e.data.clientY || 0) * scaleY;
        const forwarded = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: Math.max(-240, Math.min(240, Number(e.data.deltaX) || 0)),
          deltaY: Math.max(-240, Math.min(240, Number(e.data.deltaY) || 0)),
          deltaZ: Math.max(-240, Math.min(240, Number(e.data.deltaZ) || 0)),
          deltaMode: Number(e.data.deltaMode) || WheelEvent.DOM_DELTA_PIXEL,
          clientX,
          clientY,
          ctrlKey: Boolean(e.data.ctrlKey),
          metaKey: Boolean(e.data.metaKey),
          shiftKey: Boolean(e.data.shiftKey),
          altKey: Boolean(e.data.altKey),
        });
        iframe.dispatchEvent(forwarded);
        return;
      }
      if (e.data.type === "pinch-zoom-wheel") {
        if (!onZoomChange) return;
        const iframe = iframeRef.current;
        const scroll = scrollContainerRef.current;
        if (!iframe || !scroll) return;
        // Mirror usePinchZoom's algorithm here. We can't reliably re-dispatch
        // a synthetic WheelEvent to trigger the hook's listener — untrusted
        // events are inconsistent across browsers — so just compute the
        // next zoom directly using the same exponential factor + cursor-anchor
        // math. Clamp range matches the usePinchZoom call above (10–500).
        const currentZoom = zoomRef.current;
        const clampedDelta = Math.max(-50, Math.min(50, e.data.deltaY));
        const factor = Math.exp(-clampedDelta * 0.01);
        const nextZoom = Math.max(10, Math.min(500, currentZoom * factor));
        if (nextZoom === currentZoom) return;
        if (deviceFrame === "none") {
          // The iframe lives inside a `transform: scale(zoom/100)` wrapper, so
          // its visual scale relative to viewport is currentZoom / 100. Convert
          // the iframe-document point under the cursor → viewport point →
          // scroll-content point, then preserve cursor anchoring while zooming.
          const iframeRect = iframe.getBoundingClientRect();
          const scrollRect = scroll.getBoundingClientRect();
          const scale = currentZoom / 100;
          const viewportX = iframeRect.left + e.data.clientX * scale;
          const viewportY = iframeRect.top + e.data.clientY * scale;
          const cx = viewportX - scrollRect.left + scroll.scrollLeft;
          const cy = viewportY - scrollRect.top + scroll.scrollTop;
          const ratio = nextZoom / currentZoom;
          const dx = cx * (ratio - 1);
          const dy = cy * (ratio - 1);
          onZoomChange(nextZoom);
          requestAnimationFrame(() => {
            scroll.scrollLeft += dx;
            scroll.scrollTop += dy;
          });
        } else {
          onZoomChange(nextZoom);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    onElementSelect,
    onElementHover,
    onVisualStyleChange,
    onTextContentChange,
    onTextEditingStateChange,
    onIframeHotkey,
    onIframeContextMenu,
    onVisualStructureChange,
    onVisualDuplicateChange,
    onZoomChange,
    deviceFrame,
    onPrototypeNavigate,
    isEmbeddedFrame,
  ]);

  const replayIframeEditorState = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.contentWindow?.postMessage(
      { type: "tweak-values", values: tweakValues },
      "*",
    );
    iframe.contentWindow?.postMessage(
      { type: "layer-states", lockedSelectors, hiddenSelectors },
      "*",
    );
    iframe.contentWindow?.postMessage(
      { type: "scale-tool-mode", enabled: scaleMode },
      "*",
    );
    iframe.contentWindow?.postMessage(
      selectedSelector
        ? {
            type: "select-element",
            selector: selectedSelector,
            selectorCandidates: selectedSelectorCandidates,
          }
        : { type: "clear-selection" },
      "*",
    );
    iframe.contentWindow?.postMessage(
      hoveredSelector
        ? {
            type: "hover-element",
            selector: hoveredSelector,
            selectorCandidates: hoveredSelectorCandidates,
          }
        : { type: "hover-element", selector: "", selectorCandidates: [] },
      "*",
    );
  }, [
    hoveredSelector,
    hoveredSelectorCandidates,
    hiddenSelectors,
    lockedSelectors,
    scaleMode,
    selectedSelector,
    selectedSelectorCandidates,
    tweakValues,
  ]);

  // Replay the editor state whenever it changes OR the iframe (re)loads. The
  // load case matters for screen switches and mode changes; without replaying
  // selection/layer state here, the freshly mounted document looks deselected.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    replayIframeEditorState();
    iframe.addEventListener("load", replayIframeEditorState);
    return () => iframe.removeEventListener("load", replayIframeEditorState);
  }, [replayIframeEditorState]);

  useEffect(() => {
    if (clearSelectionRequest === undefined) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "clear-selection" },
      "*",
    );
  }, [clearSelectionRequest]);

  const sendStyleChange = useCallback(
    (selector: string, property: string, value: string) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;
      iframe.contentWindow.postMessage(
        { type: "style-change", selector, property, value },
        "*",
      );
    },
    [],
  );

  const replacePreviewContent = useCallback(
    (nextContent: string, selector?: string | null, candidates?: string[]) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      iframe.contentWindow.postMessage(
        {
          type: "replace-document-content",
          content: nextContent,
          selectedSelector: selector ?? "",
          selectorCandidates: candidates ?? [],
        },
        "*",
      );
      return true;
    },
    [],
  );

  const deleteRuntimeElement = useCallback(
    (selector?: string | null, candidates?: string[]) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return false;
      iframe.contentWindow.postMessage(
        {
          type: "delete-element",
          selector: selector ?? "",
          selectorCandidates: candidates ?? [],
        },
        "*",
      );
      return true;
    },
    [],
  );

  // Expose iframe runtime mutations for the editor orchestrator.
  useEffect(() => {
    (window as any).__designCanvasSendStyle = sendStyleChange;
    (window as any).__designCanvasReplaceContent = replacePreviewContent;
    (window as any).__designCanvasDeleteElement = deleteRuntimeElement;
    return () => {
      delete (window as any).__designCanvasSendStyle;
      delete (window as any).__designCanvasReplaceContent;
      delete (window as any).__designCanvasDeleteElement;
    };
  }, [deleteRuntimeElement, replacePreviewContent, sendStyleChange]);

  // Device dimensions match real-world devices. iframes are replaced elements
  // with an intrinsic 300×150 size, so `aspect-ratio` + `height: auto` doesn't
  // reliably compute height from width — explicit pixel heights are required.
  const deviceDimensions: Record<
    DeviceFrameType,
    { width: string; height: string | null }
  > = {
    none: { width: "100%", height: null },
    desktop: { width: "1280px", height: "800px" }, // 16:10
    tablet: { width: "768px", height: "1024px" }, // iPad
    mobile: { width: "390px", height: "844px" }, // iPhone 14
  };

  const { width: iframeWidth, height: iframeHeight } =
    deviceDimensions[deviceFrame];

  // Wrap the iframe in a positioned container so DrawOverlay /
  // CanvasCommentPins can absolutely-position themselves on top of the
  // iframe. The pin component anchors to `.design-canvas-iframe-wrapper`
  // via canvasSelector.
  //
  // The wrapper carries a faint outline + soft shadow so the frame edge stays
  // visible when a design background matches the editor canvas.
  const iframeElement = (
    <div
      className="design-canvas-iframe-wrapper relative inline-block ring-1 ring-border/60 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.45)]"
      style={{
        width: embeddedFrame ? embeddedFrame.viewportWidth : iframeWidth,
        height: embeddedFrame
          ? embeddedFrame.viewportHeight
          : deviceFrame === "none"
            ? "100%"
            : (iframeHeight ?? undefined),
      }}
    >
      <iframe
        ref={iframeRef}
        src={externalPreviewUrl ?? undefined}
        srcDoc={externalPreviewUrl ? undefined : srcdoc}
        sandbox={
          externalPreviewUrl
            ? "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"
            : "allow-scripts allow-popups allow-popups-to-escape-sandbox"
        }
        data-design-preview-iframe
        className="block h-full w-full border-0 bg-transparent"
        title={t("designEditor.designPreview")}
      />
      {/* Draw-to-prompt overlay — sits over the iframe, NOT inside it. */}
      <SharedDrawOverlay
        visible={!!drawMode}
        canvasInteractive={!pinMode}
        queuedAnnotationCount={queuedAnnotationPins.length}
        onClose={() => onExitDrawMode?.()}
        onSend={(annotations, instruction, canvasSize) => {
          const summary = annotations
            .map((a) =>
              a.type === "path"
                ? `[stroke ${a.color} w=${a.lineWidth}] ${a.pathData}`
                : `[label "${a.text}" at ${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}]`,
            )
            .join("\n");
          const pinSummary = queuedAnnotationPins
            .flatMap((pin, index) => {
              const lines = [
                `[${index + 1}] Comment pin on ${commentContextLabel || designTitle || commentContextId || designId || "design"}`,
                `Position: ${pin.xPct.toFixed(1)}% from left, ${pin.yPct.toFixed(1)}% from top`,
              ];
              if (pin.targetAnchorId)
                lines.push(`Anchor id: ${pin.targetAnchorId}`);
              if (pin.targetSelector)
                lines.push(`Element: ${pin.targetSelector}`);
              if (pin.targetText)
                lines.push(`Nearby text: "${pin.targetText}"`);
              lines.push("");
              lines.push((pin.draft || "").trim());
              return [...lines, ""];
            })
            .join("\n");
          const lines = [
            `[Annotations on design ${designId || ""}${designTitle ? ` (${designTitle})` : ""}]`,
            `Canvas size: ${canvasSize.width.toFixed(0)}x${canvasSize.height.toFixed(0)}`,
            ...(summary ? ["", "[Drawing]", summary] : []),
            ...(pinSummary ? ["", "[Comment pins]", pinSummary] : []),
            "",
            instruction || "Apply these annotations to the design.",
          ];
          try {
            sendToAgentChat({
              message: lines.join("\n"),
              submit: true,
              openSidebar: true,
            });
          } catch (err) {
            console.error("[DesignCanvas] failed to submit drawing:", err);
          }
          if (queuedAnnotationPins.length > 0) {
            setPinSubmitSignal((signal) => signal + 1);
          }
          onExitDrawMode?.();
        }}
      />
    </div>
  );

  if (embeddedFrame) {
    const scaleX =
      embeddedFrame.displayWidth / Math.max(1, embeddedFrame.viewportWidth);
    const scaleY =
      embeddedFrame.displayHeight / Math.max(1, embeddedFrame.viewportHeight);
    return (
      <div
        ref={scrollContainerRef}
        className="relative h-full w-full overflow-hidden"
        style={{
          width: embeddedFrame.displayWidth,
          height: embeddedFrame.displayHeight,
        }}
      >
        <div
          style={{
            width: embeddedFrame.viewportWidth,
            height: embeddedFrame.viewportHeight,
            transform: `scale(${scaleX}, ${scaleY})`,
            transformOrigin: "top left",
          }}
        >
          {iframeElement}
        </div>
      </div>
    );
  }

  const wrappedContent =
    deviceFrame === "none" ? (
      iframeElement
    ) : (
      <DeviceFrame type={deviceFrame}>{iframeElement}</DeviceFrame>
    );

  return (
    <div
      ref={scrollContainerRef}
      className="relative flex-1 h-full overflow-auto"
    >
      {/* Canvas area. "none" mode fills the canvas (responsive preview);
          framed modes are centered inside the canvas with zoom applied. */}
      {deviceFrame === "none" ? (
        <div className="relative flex h-full w-full items-center justify-center">
          <div
            className="h-full w-full"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "center center",
            }}
          >
            {wrappedContent}
          </div>
        </div>
      ) : (
        <div className="relative flex items-center justify-center min-h-full">
          <div
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "center center",
            }}
          >
            {wrappedContent}
          </div>
        </div>
      )}

      {/* Canvas comment pins — anchored to the iframe wrapper. The pins
          themselves render via fixed positioning, so we mount them outside
          the zoom-transformed container to keep coordinates stable. */}
      <CanvasCommentPins
        active={!!pinMode}
        submitMode={drawMode ? "queue" : "direct"}
        onPinsChange={setAnnotationPins}
        submitQueuedSignal={pinSubmitSignal}
        clickPlaneUnderToolbar={!!drawMode}
        onClose={() => onExitPinMode?.()}
        canvasSelector=".design-canvas-iframe-wrapper"
        contextId={commentContextId || designId || "design"}
        contextLabel={
          commentContextLabel || designTitle || commentContextId || designId
        }
      />
    </div>
  );
}
