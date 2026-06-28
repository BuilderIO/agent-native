import { agentChat } from "@agent-native/core";
import { usePinchZoom, useT } from "@agent-native/core/client";
import { useRef, useEffect, useCallback, useMemo } from "react";

// NOTE: This wires up the NEW shared visual-editor DrawOverlay + comment-pin
// components from `@/components/visual-editor`. The legacy iframe-only
// DrawOverlay at `./DrawOverlay.tsx` is intentionally NOT used here — both
// exist for now and can be reconciled in a follow-up. Don't import both.
import {
  DrawOverlay as SharedDrawOverlay,
  CanvasCommentPins,
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

/**
 * Edit-mode bridge: element click/hover overlays + selector-targeted
 * style-change messages. Only injected when the user is in Edit mode.
 */
const EDIT_BRIDGE_SCRIPT = `
<script data-agent-native-edit-bridge>
(function() {
  function escapeIdent(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  }

  function getSelector(el) {
    if (el.id) return '#' + escapeIdent(el.id);
    var builderId = el.closest('[data-builder-id]') &&
      el.closest('[data-builder-id]').getAttribute('data-builder-id');
    if (builderId) return '[data-builder-id="' + builderId.replace(/"/g, '\\\\"') + '"]';

    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + escapeIdent(node.id);
        parts.unshift(part);
        break;
      }
      var parent = node.parentElement;
      if (parent) {
        var sameTag = Array.prototype.filter.call(
          parent.children,
          function(child) { return child.tagName === node.tagName; }
        );
        if (sameTag.length > 1) {
          part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(part);
      node = parent;
      if (node === document.body) {
        parts.unshift('body');
        break;
      }
    }
    return parts.join(' > ');
  }

  function getElementInfo(el) {
    var cs = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var parentStyles = el.parentElement
      ? window.getComputedStyle(el.parentElement)
      : null;
    var parentDisplay = parentStyles ? parentStyles.display : undefined;
    var sourceId =
      el.getAttribute('data-agent-native-node-id') ||
      el.getAttribute('data-builder-id') ||
      el.getAttribute('data-loc') ||
      el.id ||
      getSelector(el);
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
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        textAlign: cs.textAlign,
        display: cs.display,
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
        boxShadow: cs.boxShadow,
      },
      boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      textContent: el.textContent ? el.textContent.slice(0, 200) : undefined,
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

  var highlightOverlay = document.createElement('div');
  highlightOverlay.setAttribute('data-agent-native-edit-overlay', 'highlight');
  highlightOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;border:2px solid hsl(var(--primary, 211 100% 50%));background:hsl(var(--primary, 211 100% 50%) / 0.08);display:none;';
  document.body.appendChild(highlightOverlay);

  var selectionOverlay = document.createElement('div');
  selectionOverlay.setAttribute('data-agent-native-edit-overlay', 'selection');
  selectionOverlay.style.cssText = 'position:fixed;pointer-events:auto;z-index:99998;border:1.5px solid hsl(var(--primary, 211 100% 50%));background:hsl(var(--primary, 211 100% 50%) / 0.08);display:none;box-sizing:border-box;cursor:move;';
  ['nw','n','ne','e','se','s','sw','w'].forEach(function(pos) {
    var handle = document.createElement('span');
    handle.setAttribute('data-agent-native-edit-handle', pos);
    var cursor = pos === 'n' || pos === 's' ? 'ns-resize' : pos === 'e' || pos === 'w' ? 'ew-resize' : pos === 'nw' || pos === 'se' ? 'nwse-resize' : 'nesw-resize';
    handle.style.cssText = 'position:absolute;width:7px;height:7px;border:1px solid hsl(var(--primary, 211 100% 50%));background:#fff;box-sizing:border-box;border-radius:1px;pointer-events:auto;cursor:' + cursor + ';';
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
  paddingOverlay.style.cssText = 'position:absolute;inset:8px;border:1px dashed hsl(var(--primary, 211 100% 50%) / 0.75);border-radius:2px;pointer-events:none;';
  selectionOverlay.appendChild(paddingOverlay);
  document.body.appendChild(selectionOverlay);

  var transformBadge = document.createElement('div');
  transformBadge.setAttribute('data-agent-native-transform-badge', '');
  transformBadge.style.cssText = 'position:fixed;z-index:100000;display:none;pointer-events:none;border:1px solid hsl(var(--border, 215 18% 23%));border-radius:4px;background:hsl(var(--background, 0 0% 100%) / 0.96);color:hsl(var(--foreground, 222 47% 11%));font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 5px;box-shadow:0 8px 20px rgba(0,0,0,0.16);';
  document.body.appendChild(transformBadge);

  var selectedEl = null;
  var hoveredEl = null;

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
  }

  function refreshOverlays() {
    if (hoveredEl) positionOverlay(highlightOverlay, hoveredEl);
    if (selectedEl) positionOverlay(selectionOverlay, selectedEl);
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

  function showTransformBadge(text, clientX, clientY) {
    transformBadge.textContent = text;
    transformBadge.style.display = 'block';
    transformBadge.style.left = clientX + 12 + 'px';
    transformBadge.style.top = clientY + 12 + 'px';
  }

  function hideTransformBadge() {
    transformBadge.style.display = 'none';
  }

  function startMove(e) {
    if (!selectedEl) return;
    e.preventDefault();
    e.stopPropagation();
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
      postVisualStyleChange({
        position: selectedEl.style.position,
        left: selectedEl.style.left,
        top: selectedEl.style.top,
      });
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }

  function startResize(handle, e) {
    if (!selectedEl) return;
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
      if (ev.shiftKey && handle.length === 2) {
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

  document.addEventListener('click', function(e) {
    if (e.target && e.target.closest('[data-agent-native-edit-overlay]')) return;
    e.preventDefault();
    e.stopPropagation();
    selectedEl = e.target;
    var info = getElementInfo(selectedEl);
    positionOverlay(selectionOverlay, selectedEl);
    window.parent.postMessage({ type: 'element-select', payload: info }, '*');
  }, true);

  document.addEventListener('mouseover', function(e) {
    if (e.target && e.target.closest('[data-agent-native-edit-overlay]')) return;
    hoveredEl = e.target;
    positionOverlay(highlightOverlay, hoveredEl);
    var info = getElementInfo(hoveredEl);
    window.parent.postMessage({ type: 'element-hover', payload: info }, '*');
  }, true);

  document.addEventListener('mouseout', function() {
    hoveredEl = null;
    highlightOverlay.style.display = 'none';
  }, true);

  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (!e.data || e.data.type !== 'style-change') return;
    var sel = e.data.selector;
    var prop = e.data.property;
    var val = e.data.value;
    var el = sel ? document.querySelector(sel) : null;
    if (el) el.style[prop] = val;
  });

  window.addEventListener('scroll', refreshOverlays, true);
  window.addEventListener('resize', refreshOverlays);
})();
</script>
`;

interface DesignCanvasProps {
  content: string;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  deviceFrame: DeviceFrameType;
  editMode: boolean;
  onElementSelect: (info: ElementInfo) => void;
  onElementHover: (info: ElementInfo) => void;
  onVisualStyleChange?: (
    selector: string,
    styles: Record<string, string>,
    info?: ElementInfo,
  ) => void;
  tweakValues: Record<string, string>;
  /** Whether draw-to-prompt mode is active (overlays the iframe). */
  drawMode?: boolean;
  /** Called when the user exits draw mode (X / Escape / after Send). */
  onExitDrawMode?: () => void;
  /** Whether comment-pin drop mode is active. */
  pinMode?: boolean;
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

export function DesignCanvas({
  content,
  zoom,
  onZoomChange,
  deviceFrame,
  editMode,
  onElementSelect,
  onElementHover,
  onVisualStyleChange,
  tweakValues,
  drawMode,
  onExitDrawMode,
  pinMode,
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
  zoomRef.current = zoom;

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
  // outside Edit mode. The edit bridge (click/hover overlays) is gated.
  const srcdoc = useMemo(() => {
    const bridgeToInject =
      TWEAK_BRIDGE_SCRIPT +
      ZOOM_BRIDGE_SCRIPT +
      NAV_BRIDGE_SCRIPT +
      (editMode ? EDIT_BRIDGE_SCRIPT : "");
    if (content.includes("</body>")) {
      return content.replace("</body>", bridgeToInject + "</body>"); // i18n-ignore generated iframe HTML injection
    }
    if (content.includes("</html>")) {
      return content.replace("</html>", bridgeToInject + "</html>"); // i18n-ignore generated iframe HTML injection
    }
    // No body/html tags — wrap it
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${content}${bridgeToInject}</body></html>`;
  }, [content, editMode]);

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
      if (e.data.type === "prototype-navigate") {
        // External links are opened inside the iframe (sandbox allow-popups);
        // only internal screen switches reach the parent.
        onPrototypeNavigate?.(
          String(e.data.screen || ""),
          String(e.data.href || ""),
        );
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
    onZoomChange,
    deviceFrame,
    onPrototypeNavigate,
  ]);

  // Send tweak values to the iframe whenever they change OR the iframe
  // (re)loads. The reload case matters: changing `content` or toggling Edit
  // mode rebuilds srcdoc and remounts the iframe; without replaying values
  // here, the freshly mounted document loses the user's tweak state.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const send = () => {
      iframe.contentWindow?.postMessage(
        { type: "tweak-values", values: tweakValues },
        "*",
      );
    };
    send();
    iframe.addEventListener("load", send);
    return () => iframe.removeEventListener("load", send);
  }, [tweakValues]);

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

  // Expose sendStyleChange for external use
  useEffect(() => {
    (window as any).__designCanvasSendStyle = sendStyleChange;
    return () => {
      delete (window as any).__designCanvasSendStyle;
    };
  }, [sendStyleChange]);

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
  // The wrapper carries a faint outline + soft shadow so the frame edge is
  // visible even when the design's background matches the canvas dot-grid
  // (e.g. both dark). Without this, a dark design dissolves into the canvas.
  const iframeElement = (
    <div
      className="design-canvas-iframe-wrapper relative inline-block ring-1 ring-border/60 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.45)]"
      style={{
        width: iframeWidth,
        height: deviceFrame === "none" ? "100%" : (iframeHeight ?? undefined),
      }}
    >
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        data-design-preview-iframe
        className="border-0 bg-white block w-full h-full"
        title={t("designEditor.designPreview")}
      />
      {/* Draw-to-prompt overlay — sits over the iframe, NOT inside it. */}
      <SharedDrawOverlay
        visible={!!drawMode}
        onClose={() => onExitDrawMode?.()}
        onSend={(annotations, instruction, canvasSize) => {
          const summary = annotations
            .map((a) =>
              a.type === "path"
                ? `[stroke ${a.color} w=${a.lineWidth}] ${a.pathData}`
                : `[label "${a.text}" at ${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}]`,
            )
            .join("\n");
          const lines = [
            `[Drawing on design ${designId || ""}${designTitle ? ` (${designTitle})` : ""}]`,
            `Canvas size: ${canvasSize.width.toFixed(0)}x${canvasSize.height.toFixed(0)}`,
            summary,
            "",
            instruction || "Apply these annotations to the design.",
          ];
          try {
            agentChat.submit(lines.join("\n"));
          } catch (err) {
            console.error("[DesignCanvas] failed to submit drawing:", err);
          }
          onExitDrawMode?.();
        }}
      />
    </div>
  );

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
      {/* Dot grid background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Canvas area. "none" mode fills the canvas (responsive preview);
          framed modes are centered inside the dot-grid with zoom applied. */}
      {deviceFrame === "none" ? (
        <div className="relative h-full w-full p-8">
          <div
            className="h-full w-full"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top left",
            }}
          >
            {wrappedContent}
          </div>
        </div>
      ) : (
        <div className="relative flex items-center justify-center min-h-full p-8">
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
