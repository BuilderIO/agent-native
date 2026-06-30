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

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";
import { hitTestBridgeScript } from "../../../.generated/bridge/hit-test.generated";
import { isTrustedCanvasBridgeMessage } from "./bridge-security";
import { DeviceFrame } from "./DeviceFrame";
import type { ElementInfo, DeviceFrameType } from "./types";

/**
 * Allowlist check for Fusion (Builder-hosted) frame origins.
 *
 * Fusion frames are served cross-origin from the Builder-hosted app, so the
 * strict `origin === parentOrigin` bridge check can never match. Before relaxing
 * trust to window-identity only, we must confirm the message origin is actually
 * a Builder host — the exact origin of the `fusionUrl` we were asked to render,
 * or any `*.builder.io` host (plus the bare `builder.io`), over https. This
 * prevents the relaxed-trust path from accepting messages from an arbitrary
 * cross-origin frame that merely shares our iframe's window reference.
 */
function isAllowedFusionOrigin(
  origin: string,
  fusionUrl: string | undefined,
): boolean {
  if (!origin || origin === "null") return false;
  let host: string;
  let protocol: string;
  try {
    const parsed = new URL(origin);
    host = parsed.hostname.toLowerCase();
    protocol = parsed.protocol;
  } catch {
    return false;
  }
  // Only allow secure (https) Builder origins.
  if (protocol !== "https:") return false;
  // Exact match against the configured fusion URL's origin.
  if (fusionUrl) {
    try {
      if (new URL(fusionUrl).origin === origin) return true;
    } catch {
      // Malformed fusionUrl — fall through to the host-family allowlist.
    }
  }
  // Builder host family: builder.io and any subdomain of it.
  return host === "builder.io" || host.endsWith(".builder.io");
}

/**
 * Wire shape for a single motion track sent via the `motion-load-tracks`
 * postMessage. Matches the serialisable subset of `MotionTrack` from
 * `shared/motion-timeline.ts` without requiring an import at the UI layer.
 */
export interface MotionTrackWire {
  targetNodeId: string;
  property: string;
  keyframes: Array<{ t: number; value: string; ease?: string }>;
}

/**
 * Motion-preview bridge. Injected alongside the other bridge scripts so the
 * MotionDock's scrubbing preview works in ALL editor modes without writing
 * anything to the DB, Yjs state, or source files.
 *
 * Protocol (parent → iframe):
 *
 *   { type: 'motion-load-tracks', tracks: MotionTrackWire[] }
 *     Load (or replace) the track list for this document. Each entry:
 *     { targetNodeId, property, keyframes: [{ t, value, ease? }] }
 *     where t ∈ [0, 1].  Sent whenever the active timeline changes.
 *
 *   { type: 'motion-preview', t, durationMs }
 *     Seek all loaded tracks to normalised position t ∈ [0, 1] and apply
 *     the interpolated CSS property values as inline styles on the matching
 *     [data-agent-native-node-id="…"] elements.  Never writes to storage.
 *
 *   { type: 'motion-preview-clear' }
 *     Remove all motion-preview inline-style overrides and the in-memory
 *     track list.  Called when the dock is closed or the timeline is
 *     discarded.
 *
 * Interpolation is linear between the surrounding keyframes and understands
 * plain numbers with units, CSS function values (translateY/scale/blur/…), and
 * colors (hex / rgb(a) / hsl(a)) so presets preview smoothly instead of
 * snapping at the midpoint. CSS still owns the real easing when the compiled
 * animation is applied; the preview is a live visualisation, not a perfect
 * recreation of the final animation.
 */
const MOTION_PREVIEW_BRIDGE_SCRIPT = `
<script data-agent-native-motion-preview-bridge>
(function() {
  // Track list loaded by 'motion-load-tracks'.
  var loadedTracks = [];
  // Map of nodeId -> [property, ...] we have touched, for cleanup.
  var touchedProps = {};
  // Map of nodeId -> property -> original inline style value.
  var originalInlineValues = {};

  function camelizeProp(prop) {
    return String(prop).replace(/-([a-z])/g, function(_m, c) { return c.toUpperCase(); });
  }

  function formatNum(n) {
    if (!Number.isFinite(n)) return '0';
    return (Math.round(n * 10000) / 10000).toString();
  }

  function clamp255(x) { return x < 0 ? 0 : x > 255 ? 255 : x; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function parseAlpha(s) {
    if (typeof s === 'string' && s.indexOf('%') >= 0) return parseFloat(s) / 100;
    return parseFloat(s);
  }

  function hueToRgb(p, q, h) {
    if (h < 0) h += 1;
    if (h > 1) h -= 1;
    if (h < 1 / 6) return p + (q - p) * 6 * h;
    if (h < 1 / 2) return q;
    if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    s = clamp01(s);
    l = clamp01(l);
    if (s === 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [
      hueToRgb(p, q, h + 1 / 3) * 255,
      hueToRgb(p, q, h) * 255,
      hueToRgb(p, q, h - 1 / 3) * 255
    ];
  }

  // Parse a CSS color (hex, rgb/rgba, hsl/hsla) into [r, g, b, a] or null.
  function parseColor(str) {
    if (typeof str !== 'string') return null;
    var s = str.trim();
    var hex = /^#([0-9a-fA-F]{3,8})$/.exec(s);
    if (hex) {
      var h = hex[1];
      if (h.length === 3 || h.length === 4) {
        return [
          parseInt(h.charAt(0) + h.charAt(0), 16),
          parseInt(h.charAt(1) + h.charAt(1), 16),
          parseInt(h.charAt(2) + h.charAt(2), 16),
          h.length === 4 ? parseInt(h.charAt(3) + h.charAt(3), 16) / 255 : 1
        ];
      }
      if (h.length === 6 || h.length === 8) {
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
          h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
        ];
      }
      return null;
    }
    var rgb = /^rgba?\\(([^)]+)\\)$/i.exec(s);
    if (rgb) {
      var rp = rgb[1].split(/[\\s,\\/]+/).filter(function(x) { return x.length; });
      if (rp.length >= 3) {
        return [parseFloat(rp[0]), parseFloat(rp[1]), parseFloat(rp[2]), rp.length >= 4 ? parseAlpha(rp[3]) : 1];
      }
      return null;
    }
    var hsl = /^hsla?\\(([^)]+)\\)$/i.exec(s);
    if (hsl) {
      var hp = hsl[1].split(/[\\s,\\/]+/).filter(function(x) { return x.length; });
      if (hp.length >= 3) {
        var c = hslToRgb(parseFloat(hp[0]), parseFloat(hp[1]) / 100, parseFloat(hp[2]) / 100);
        return [c[0], c[1], c[2], hp.length >= 4 ? parseAlpha(hp[3]) : 1];
      }
      return null;
    }
    return null;
  }

  function lerpColorArr(a, b, ratio) {
    return [
      a[0] + (b[0] - a[0]) * ratio,
      a[1] + (b[1] - a[1]) * ratio,
      a[2] + (b[2] - a[2]) * ratio,
      a[3] + (b[3] - a[3]) * ratio
    ];
  }

  function formatColor(c) {
    var r = Math.round(clamp255(c[0]));
    var g = Math.round(clamp255(c[1]));
    var b = Math.round(clamp255(c[2]));
    var a = clamp01(c[3]);
    if (a >= 1) return 'rgb(' + r + ', ' + g + ', ' + b + ')';
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (Math.round(a * 1000) / 1000) + ')';
  }

  // Split a value into literal + typed (number / color) segments so two values
  // that share a skeleton (e.g. 'translateY(16px)' / 'translateY(0px)') can be
  // interpolated component-wise instead of snapping at the midpoint.
  function tokenizeSegments(str) {
    if (typeof str !== 'string') return null;
    var segs = [];
    var i = 0;
    var n = str.length;
    var litStart = 0;
    var colorRe = /^(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\)|hsla?\\([^)]*\\))/i;
    var numRe = /^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)/;
    while (i < n) {
      var rest = str.slice(i);
      var cm = colorRe.exec(rest);
      if (cm) {
        var parsed = parseColor(cm[0]);
        if (parsed) {
          if (i > litStart) segs.push({ lit: str.slice(litStart, i) });
          segs.push({ type: 'color', value: parsed });
          i += cm[0].length;
          litStart = i;
          continue;
        }
      }
      // Skip a number when the previous char is a letter — it belongs to an
      // identifier such as translate3d / matrix3d, not a numeric argument.
      var prevCh = i > 0 ? str.charAt(i - 1) : '';
      if (!/[a-zA-Z]/.test(prevCh)) {
        var nm = numRe.exec(rest);
        if (nm) {
          var numText = nm[0];
          var unit = '';
          var um = /^[a-z%]+/i.exec(str.slice(i + numText.length));
          if (um) unit = um[0];
          if (i > litStart) segs.push({ lit: str.slice(litStart, i) });
          segs.push({ type: 'num', value: parseFloat(numText), unit: unit });
          i += numText.length + unit.length;
          litStart = i;
          continue;
        }
      }
      i++;
    }
    if (n > litStart) segs.push({ lit: str.slice(litStart, n) });
    return segs;
  }

  function segShape(segs) {
    var parts = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      parts.push(s.lit !== undefined ? ('L' + s.lit) : ('T' + s.type));
    }
    return parts.join('\\u0000');
  }

  // Interpolate two keyframe values. Handles plain numbers (with units), CSS
  // function values (translate/scale/blur/…), numbers embedded in gradients,
  // and colors (hex / rgb(a) / hsl(a)). Falls back to a midpoint snap only for
  // genuinely non-interpolable keywords (e.g. none -> block).
  function lerp(a, b, ratio) {
    a = a == null ? '' : String(a);
    b = b == null ? '' : String(b);
    if (a === b) return a;
    var ca = parseColor(a);
    var cb = parseColor(b);
    if (ca && cb) return formatColor(lerpColorArr(ca, cb, ratio));
    var aSegs = tokenizeSegments(a);
    var bSegs = tokenizeSegments(b);
    if (aSegs && bSegs && aSegs.length === bSegs.length && segShape(aSegs) === segShape(bSegs)) {
      var out = '';
      var ok = true;
      var touched = false;
      for (var k = 0; k < aSegs.length; k++) {
        var seg = aSegs[k];
        if (seg.lit !== undefined) { out += seg.lit; continue; }
        var other = bSegs[k];
        if (!other || other.type !== seg.type) { ok = false; break; }
        touched = true;
        if (seg.type === 'color') {
          out += formatColor(lerpColorArr(seg.value, other.value, ratio));
        } else {
          out += formatNum(seg.value + (other.value - seg.value) * ratio) + (seg.unit || other.unit);
        }
      }
      if (ok && touched) return out;
    }
    // Non-interpolable (keywords, mismatched shapes): snap at the midpoint.
    return ratio < 0.5 ? a : b;
  }

  function interpolate(keyframes, t) {
    if (!keyframes || keyframes.length === 0) return '';
    if (keyframes.length === 1) return keyframes[0].value;
    // Find surrounding keyframes.
    var prev = keyframes[0];
    var next = keyframes[keyframes.length - 1];
    for (var i = 0; i < keyframes.length - 1; i++) {
      if (t >= keyframes[i].t && t <= keyframes[i + 1].t) {
        prev = keyframes[i];
        next = keyframes[i + 1];
        break;
      }
    }
    var span = next.t - prev.t;
    if (span <= 0) return prev.value;
    var ratio = Math.max(0, Math.min(1, (t - prev.t) / span));
    return lerp(prev.value, next.value, ratio);
  }

  function applyPreview(t) {
    for (var i = 0; i < loadedTracks.length; i++) {
      var track = loadedTracks[i];
      var el = document.querySelector('[data-agent-native-node-id="' + track.targetNodeId + '"]');
      if (!el) continue;
      var value = interpolate(track.keyframes, t);
      if (value === '') continue;
      // Normalize kebab properties (e.g. background-color) to the camelCase
      // CSSOM accessor; el.style['background-color'] = … is unreliable.
      var prop = camelizeProp(track.property);
      if (!originalInlineValues[track.targetNodeId]) originalInlineValues[track.targetNodeId] = {};
      if (!(prop in originalInlineValues[track.targetNodeId])) {
        originalInlineValues[track.targetNodeId][prop] = el.style[prop] || '';
      }
      el.style[prop] = value;
      if (!touchedProps[track.targetNodeId]) touchedProps[track.targetNodeId] = [];
      if (touchedProps[track.targetNodeId].indexOf(prop) === -1) {
        touchedProps[track.targetNodeId].push(prop);
      }
    }
  }

  function clearPreview() {
    var nodeIds = Object.keys(touchedProps);
    for (var i = 0; i < nodeIds.length; i++) {
      var el = document.querySelector('[data-agent-native-node-id="' + nodeIds[i] + '"]');
      if (!el) continue;
      var props = touchedProps[nodeIds[i]];
      for (var j = 0; j < props.length; j++) {
        var originals = originalInlineValues[nodeIds[i]] || {};
        el.style[props[j]] = Object.prototype.hasOwnProperty.call(originals, props[j])
          ? originals[props[j]]
          : '';
      }
    }
    touchedProps = {};
    originalInlineValues = {};
    loadedTracks = [];
  }

  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (!e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'motion-load-tracks') {
      clearPreview();
      loadedTracks = Array.isArray(e.data.tracks) ? e.data.tracks : [];
      return;
    }
    if (e.data.type === 'motion-preview') {
      var t = Number(e.data.t);
      if (!Number.isFinite(t)) return;
      t = Math.max(0, Math.min(1, t));
      applyPreview(t);
      return;
    }
    if (e.data.type === 'motion-preview-clear') {
      clearPreview();
      return;
    }
  });
})();
</script>
`;

/**
 * Shader-fill preview bridge.  ALWAYS injected alongside the other bridge
 * scripts so the parent can apply a CSS gradient approximation of a shader
 * fill to the currently-selected element **without** persisting anything.
 *
 * Protocol (parent → iframe):
 *
 *   { type: 'shader-fill-preview', selector, nodeId, css }
 *     Apply `css` as the `background` inline style on the first element that
 *     matches `selector` (preferred) or `[data-agent-native-node-id="nodeId"]`.
 *     When both are absent, targets `document.body`.  Stores the previous
 *     background value so it can be restored on clear.
 *     Preview-only — never writes to DB, Yjs, or source files.
 *
 *   { type: 'shader-fill-preview-clear' }
 *     Remove the applied background override and restore the previous value.
 *     Called when the user discards the preview or switches selections.
 */
const SHADER_FILL_PREVIEW_BRIDGE_SCRIPT = `
<script data-agent-native-shader-fill-preview-bridge>
(function() {
  // Track the element we patched and its original background so we can undo.
  var patchedEl = null;
  var originalBackground = '';

  function resolveTarget(selector, nodeId) {
    if (selector) {
      try {
        var hit = document.querySelector(selector);
        if (hit) return hit;
      } catch (_err) {}
    }
    if (nodeId) {
      var byId = document.querySelector('[data-agent-native-node-id="' + nodeId.replace(/"/g, '\\\\"') + '"]');
      if (byId) return byId;
    }
    return document.body;
  }

  function applyPreview(selector, nodeId, css) {
    // Clear any prior patch first so we don't stack patches.
    clearPreview();
    var el = resolveTarget(selector, nodeId);
    if (!el) return;
    originalBackground = el.style.background || '';
    el.style.background = css || '';
    patchedEl = el;
  }

  function clearPreview() {
    if (!patchedEl) return;
    patchedEl.style.background = originalBackground;
    patchedEl = null;
    originalBackground = '';
  }

  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (!e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'shader-fill-preview') {
      var selector = typeof e.data.selector === 'string' ? e.data.selector : '';
      var nodeId = typeof e.data.nodeId === 'string' ? e.data.nodeId : '';
      var css = typeof e.data.css === 'string' ? e.data.css : '';
      applyPreview(selector, nodeId, css);
      return;
    }
    if (e.data.type === 'shader-fill-preview-clear') {
      clearPreview();
      return;
    }
  });
})();
</script>
`;

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

/**
 * Lightweight hit-test bridge: injected into every screen srcdoc iframe so
 * MultiScreenCanvas can ask "what container is under this point?" during a
 * cross-screen drag without needing to synthesise DOM events.
 *
 * Protocol (parent → iframe via postMessage):
 *   { type: 'agent-native:hit-test', correlationId: string, x: number, y: number }
 *   where x/y are in this iframe's viewport coordinate space.
 *
 * Reply (iframe → window.parent):
 *   { type: 'agent-native:hit-test-result', correlationId: string,
 *     anchorNodeId: string, placement: 'before'|'after'|'inside' }
 *
 * Reads DOM only — no mutations, no event interception. The container-drop and
 * placement logic is intentionally kept in sync with the corresponding helpers
 * inside editor-chrome.bridge.ts (search for "// keep in sync with
 * hit-test.bridge.ts" comments there).
 *
 * Source: app/components/design/bridge/hit-test.bridge.ts
 * Compiled: .generated/bridge/hit-test.generated.ts (run bridge/codegen.ts to update)
 */
export const LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT = `
<script data-agent-native-hit-test-bridge>
${hitTestBridgeScript}
</script>
`;

/**
 * Append the LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT into a complete HTML string.
 * Injects before </body> when present, before </html> as a fallback, or appends
 * at the end. This is the seam MultiScreenCanvas uses to add the hit-test
 * responder to each screen srcdoc without rebuilding the entire document.
 */
export function appendHitTestResponder(html: string): string {
  if (html.includes("</body>")) {
    return html.replace(
      "</body>", // i18n-ignore generated iframe HTML marker
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT + "</body>", // i18n-ignore generated iframe HTML injection
    );
  }
  if (html.includes("</html>")) {
    return html.replace(
      "</html>", // i18n-ignore generated iframe HTML marker
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT + "</html>", // i18n-ignore generated iframe HTML injection
    );
  }
  return html + LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT;
}

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
${editorChromeBridgeScript}
</script>
`;

interface DesignCanvasProps {
  content: string;
  contentKey?: string;
  /**
   * The runtime source tier for this canvas.
   *
   * - `"inline"` (default) — HTML/Alpine `srcdoc` iframe; same-origin null
   *   origin; all bridge scripts injected by DesignCanvas.
   * - `"localhost"` — `src=devServerUrl`; dev server is same-origin in most
   *   setups; bridge trust: origin must match parent or be "null".
   * - `"fusion"` — `src=builderHostedUrl`; cross-origin Builder-hosted app;
   *   bridge trust is relaxed to window-identity only (no origin check) so
   *   the Builder-hosted iframe can communicate with the editor.  The sandbox
   *   grants `allow-same-origin` so the Builder app can reach its own resources.
   *
   * When omitted, DesignCanvas infers the tier from the content value:
   * a value that passes `getExternalPreviewUrl` is treated as `"localhost"`;
   * otherwise `"inline"`.  Pass `sourceType="fusion"` explicitly when the
   * content URL is a Builder-hosted (cross-origin) app so the bridge security
   * model uses window-identity trust instead of same-origin trust.
   */
  sourceType?: "inline" | "localhost" | "fusion";
  /**
   * Explicit Builder-hosted app URL for fusion source rendering.
   *
   * When `sourceType === "fusion"` and this prop is provided, the iframe uses
   * this URL as `src` regardless of what `content` contains.  This lets the
   * caller hold the original inline HTML in `content` (for collab/history
   * purposes) while pointing the canvas at the migrated Builder-hosted app.
   *
   * When absent and `sourceType === "fusion"`, the component falls back to
   * the existing external-URL detection on `content` (i.e. if `content` is
   * itself a URL it is used as-is, which is the pattern when the branch URL
   * has been written into the design file content).
   *
   * For `"inline"` and `"localhost"` sources this prop is ignored.
   */
  fusionUrl?: string;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  deviceFrame: DeviceFrameType;
  embeddedFrame?: {
    viewportWidth: number;
    viewportHeight: number;
    displayWidth: number;
    displayHeight: number;
    fluid?: boolean;
  };
  editorChromeScaleX?: number;
  editorChromeScaleY?: number;
  editMode: boolean;
  interactMode: boolean;
  readOnly?: boolean;
  scaleMode?: boolean;
  onElementSelect: (info: ElementInfo) => void;
  onElementHover: (info: ElementInfo | null) => void;
  onClearSelection?: () => void;
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
  onElementDblClickText?: (info: ElementInfo) => void;
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
  registerRuntimeBridge?: boolean;
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
  /**
   * Motion tracks to load into the iframe's motion-preview bridge.  Sent via
   * `motion-load-tracks` whenever this prop changes.  When cleared
   * (`undefined` or `[]`) a `motion-preview-clear` message is sent to remove
   * any applied preview overrides.
   *
   * The MotionDock sends scrub ticks as `{ type: 'motion-preview', t,
   * durationMs }` directly from its `canvasIframeRef`.  DesignCanvas only
   * needs the tracks so the bridge can interpolate values at each tick.
   */
  motionTracks?: MotionTrackWire[];
  /**
   * Explicit iframe width in pixels.  When provided it overrides the width
   * derived from `deviceFrame`, enabling per-breakpoint preview (e.g. Mobile
   * 390 / Tablet 768 / Desktop 1280 side-by-side frames in the overview).
   * The height still comes from `deviceFrame`; `deviceFrame="none"` keeps
   * 100% height.
   */
  previewWidthPx?: number;
  /**
   * Shader-fill CSS preview to apply to a selected element inside the iframe.
   *
   * When set, the canvas sends a `shader-fill-preview` bridge message that
   * applies the CSS `background` value on the target element **without
   * persisting anything**.  When cleared (`null` / `undefined`) a
   * `shader-fill-preview-clear` message is sent to restore the original
   * background.
   *
   * Preview-only — never writes to DB, Yjs, or source.  Part of the §6.7
   * shader-fill PREVIEW path; the apply path remains gated until runtime
   * rendering + source-write + diff proof are all in place.
   */
  shaderFillPreview?: {
    /** CSS selector for the target element (preferred over nodeId). */
    selector?: string;
    /** data-agent-native-node-id value for the target element. */
    nodeId?: string;
    /** The CSS `background` value returned by preview-shader-fill. */
    css: string;
  } | null;
  /**
   * Called when the user clicks the component-instance source tag (the
   * "ComponentName →" pill that floats above a selected component root).
   * The parent should invoke `open-component-source` with these params.
   */
  onComponentSourceJump?: (params: {
    nodeId: string;
    componentName: string;
  }) => void;
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
  sourceType,
  fusionUrl,
  zoom,
  onZoomChange,
  deviceFrame,
  embeddedFrame,
  editorChromeScaleX = 1,
  editorChromeScaleY = editorChromeScaleX,
  editMode,
  interactMode,
  readOnly = false,
  scaleMode = false,
  clearSelectionRequest,
  onElementSelect,
  onElementHover,
  onClearSelection,
  onVisualStyleChange,
  onTextContentChange,
  onTextEditingStateChange,
  onElementDblClickText,
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
  registerRuntimeBridge = true,
  designId,
  designTitle,
  commentContextId,
  commentContextLabel,
  onPrototypeNavigate,
  motionTracks,
  previewWidthPx,
  onComponentSourceJump,
  shaderFillPreview,
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
  // Resolve the URL to render in the iframe:
  // 1. When sourceType === "fusion" and fusionUrl is set, prefer the explicit
  //    Builder-hosted URL over whatever is in `content` (which may still be the
  //    original inline HTML).
  // 2. Otherwise fall back to the content-based URL detection (handles the case
  //    where the branch URL has been written into the design file content, or
  //    where the localhost URL is the file content).
  const externalPreviewUrl = useMemo(() => {
    if (sourceType === "fusion" && fusionUrl) {
      try {
        const url = new URL(fusionUrl);
        url.hash = "";
        return url.toString();
      } catch {
        // fall through to content detection below
      }
    }
    return getExternalPreviewUrl(renderedContent);
  }, [fusionUrl, renderedContent, sourceType]);
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
  // outside Edit mode. The editor chrome bridge is omitted for Interact and
  // read-only surfaces so preview/app users can interact with the app normally.
  const srcdoc = useMemo(() => {
    if (externalPreviewUrl) return undefined;
    const editorChromeBridge =
      interactMode || readOnly
        ? ""
        : createEditorBridgeThemeScript(readEditorBridgeThemeVars()) +
          EDITOR_CHROME_BRIDGE_SCRIPT.replace(
            "__READ_ONLY__",
            readOnly ? "true" : "false",
          )
            .replace("__TEXT_EDITING_ENABLED__", editMode ? "true" : "false")
            .replace("__EDITOR_CHROME_SCALE_X__", String(editorChromeScaleX))
            .replace("__EDITOR_CHROME_SCALE_Y__", String(editorChromeScaleY));
    const embeddedWheelBridge = EMBEDDED_WHEEL_BRIDGE_SCRIPT.replace(
      "__EMBEDDED_WHEEL_FORWARDING_ENABLED__",
      isEmbeddedFrame ? "true" : "false",
    );
    const bridgeToInject =
      MOTION_PREVIEW_BRIDGE_SCRIPT +
      SHADER_FILL_PREVIEW_BRIDGE_SCRIPT +
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
    // editorChromeScaleX/Y are intentionally NOT deps: they only seed the initial
    // baked chrome scale. Live zoom updates flow through the set-editor-chrome-scale
    // postMessage above. Including them here rebuilds srcdoc on every zoom commit,
    // which reloads the iframe and flashes the screen content white.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editMode,
    externalPreviewUrl,
    interactMode,
    isEmbeddedFrame,
    readOnly,
    renderedContent,
  ]);

  // Listen for messages from the iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      const iframeWindow = iframeRef.current?.contentWindow;
      // For fusion sources the Builder-hosted app is cross-origin, so the strict
      // `origin === parentOrigin` check can never match. We still require window
      // identity (the message must come from our own iframe window, not any
      // arbitrary cross-origin frame), AND we validate the message origin
      // against a Builder-host allowlist (the configured fusionUrl origin or the
      // *.builder.io family) before relaxing the origin check. If the origin is
      // not on the allowlist we keep the strict check so a hostile frame that
      // somehow shares our window reference still can't be trusted.
      const trusted =
        sourceType === "fusion"
          ? iframeWindow != null &&
            e.source === iframeWindow &&
            isAllowedFusionOrigin(e.origin, fusionUrl)
          : isTrustedCanvasBridgeMessage({
              source: e.source,
              origin: e.origin,
              iframeWindow,
              parentOrigin: window.location.origin,
            });
      if (!trusted) {
        return;
      }
      if (!e.data || !e.data.type) return;
      if (e.data.type === "clear-selection") {
        onClearSelection?.();
        return;
      }
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
        const sourceId =
          typeof e.data.sourceId === "string" ? e.data.sourceId : undefined;
        const anchorSourceId =
          typeof e.data.anchorSourceId === "string"
            ? e.data.anchorSourceId
            : undefined;
        if (
          (selector || sourceId) &&
          (anchorSelector || anchorSourceId) &&
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
              sourceId,
              anchorSourceId,
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
      if (e.data.type === "element-dblclick-text") {
        onElementDblClickText?.(e.data.payload);
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
      if (e.data.type === "component-source-jump") {
        // The user clicked the component-instance tag ("ComponentName →").
        // Relay to the parent so it can invoke open-component-source.
        const nodeId = String(e.data.nodeId || "");
        const componentName = String(e.data.componentName || "");
        if (nodeId && componentName) {
          onComponentSourceJump?.({ nodeId, componentName });
        }
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
    onClearSelection,
    onVisualStyleChange,
    onTextContentChange,
    onTextEditingStateChange,
    onElementDblClickText,
    onIframeHotkey,
    onIframeContextMenu,
    onVisualStructureChange,
    onVisualDuplicateChange,
    onZoomChange,
    deviceFrame,
    onPrototypeNavigate,
    onComponentSourceJump,
    isEmbeddedFrame,
    sourceType,
    fusionUrl,
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
    // Re-send motion tracks so the preview bridge is ready after a reload.
    if (motionTracks && motionTracks.length > 0) {
      iframe.contentWindow?.postMessage(
        { type: "motion-load-tracks", tracks: motionTracks },
        "*",
      );
    } else {
      iframe.contentWindow?.postMessage({ type: "motion-preview-clear" }, "*");
    }
    // Re-apply the shader-fill preview after a reload so the preview survives
    // screen switches.  Preview-only — never writes to DB, Yjs, or source.
    if (shaderFillPreview) {
      iframe.contentWindow?.postMessage(
        {
          type: "shader-fill-preview",
          selector: shaderFillPreview.selector ?? "",
          nodeId: shaderFillPreview.nodeId ?? "",
          css: shaderFillPreview.css,
        },
        "*",
      );
    } else {
      iframe.contentWindow?.postMessage(
        { type: "shader-fill-preview-clear" },
        "*",
      );
    }
  }, [
    hoveredSelector,
    hoveredSelectorCandidates,
    hiddenSelectors,
    lockedSelectors,
    motionTracks,
    scaleMode,
    selectedSelector,
    selectedSelectorCandidates,
    shaderFillPreview,
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

  // Sync motion tracks to the iframe bridge whenever they change.
  // When motionTracks is empty/undefined, clear any preview overrides so the
  // design returns to its authored state (no stale inline styles).
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (!motionTracks || motionTracks.length === 0) {
      win.postMessage({ type: "motion-preview-clear" }, "*");
    } else {
      win.postMessage(
        { type: "motion-load-tracks", tracks: motionTracks },
        "*",
      );
    }
  }, [motionTracks]);

  // Sync shader-fill preview to the iframe whenever the prop changes.
  // When cleared (null / undefined) send a clear message so the bridge
  // restores the original background on the previously-patched element.
  // Preview-only — never writes to DB, Yjs, or source.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (!shaderFillPreview) {
      win.postMessage({ type: "shader-fill-preview-clear" }, "*");
    } else {
      win.postMessage(
        {
          type: "shader-fill-preview",
          selector: shaderFillPreview.selector ?? "",
          nodeId: shaderFillPreview.nodeId ?? "",
          css: shaderFillPreview.css,
        },
        "*",
      );
    }
  }, [shaderFillPreview]);

  // Push the constant-size chrome scale into the iframe LIVE (CSS vars only) when
  // overview zoom settles. This is intentionally separate from the srcdoc build so
  // a scale change never rebuilds srcdoc / reloads the iframe (which flashes the
  // content white). The baked __EDITOR_CHROME_SCALE__ values cover first paint.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "set-editor-chrome-scale",
        scaleX: editorChromeScaleX,
        scaleY: editorChromeScaleY,
      },
      "*",
    );
  }, [editorChromeScaleX, editorChromeScaleY]);

  const sendStyleChange = useCallback(
    (
      selector: string,
      property: string,
      value: string,
      options?: { selectorCandidates?: string[]; nodeId?: string | null },
    ) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;
      iframe.contentWindow.postMessage(
        {
          type: "style-change",
          selector,
          property,
          value,
          selectorCandidates: options?.selectorCandidates ?? [],
          nodeId: options?.nodeId ?? "",
        },
        "*",
      );
    },
    [],
  );

  /**
   * Send a motion-preview scrub tick to the iframe.  `t` is the normalised
   * playhead position in [0, 1].  Tracks must have been loaded first via the
   * `motionTracks` prop (or an explicit `motion-load-tracks` message).
   * Preview-only — never writes to DB/Yjs/source.
   */
  const sendMotionPreview = useCallback((t: number, durationMs?: number) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: "motion-preview", t: Math.max(0, Math.min(1, t)), durationMs },
      "*",
    );
  }, []);

  /**
   * Clear all motion-preview inline-style overrides in the iframe and remove
   * the in-memory track list.  Call when the Motion dock is closed.
   */
  const clearMotionPreview = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "motion-preview-clear" },
      "*",
    );
  }, []);

  /**
   * Send a shader-fill CSS preview to the iframe.  Targets the element
   * identified by `selector` (preferred) or `nodeId`.  Preview-only — the
   * bridge script restores the original background on clear.
   */
  const sendShaderFillPreview = useCallback(
    (selector: string, nodeId: string, css: string) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(
        { type: "shader-fill-preview", selector, nodeId, css },
        "*",
      );
    },
    [],
  );

  /**
   * Clear the shader-fill preview in the iframe, restoring the original
   * background on the patched element.  Call when the preview is dismissed
   * or when the selection changes to a different element.
   */
  const clearShaderFillPreview = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "shader-fill-preview-clear" },
      "*",
    );
  }, []);

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
    if (!registerRuntimeBridge) return;
    (window as any).__designCanvasSendStyle = sendStyleChange;
    (window as any).__designCanvasReplaceContent = replacePreviewContent;
    (window as any).__designCanvasDeleteElement = deleteRuntimeElement;
    (window as any).__designCanvasSendMotionPreview = sendMotionPreview;
    (window as any).__designCanvasClearMotionPreview = clearMotionPreview;
    // Shader-fill preview helpers (preview-only, §6.7 gating applies to apply).
    (window as any).__designCanvasSendShaderFillPreview = sendShaderFillPreview;
    (window as any).__designCanvasClearShaderFillPreview =
      clearShaderFillPreview;
    return () => {
      // Identity-guard each delete so a stale unmounting instance never clobbers
      // a freshly mounted instance's bridge during a remount race.
      if ((window as any).__designCanvasSendStyle === sendStyleChange) {
        delete (window as any).__designCanvasSendStyle;
      }
      if (
        (window as any).__designCanvasReplaceContent === replacePreviewContent
      ) {
        delete (window as any).__designCanvasReplaceContent;
      }
      if (
        (window as any).__designCanvasDeleteElement === deleteRuntimeElement
      ) {
        delete (window as any).__designCanvasDeleteElement;
      }
      if (
        (window as any).__designCanvasSendMotionPreview === sendMotionPreview
      ) {
        delete (window as any).__designCanvasSendMotionPreview;
      }
      if (
        (window as any).__designCanvasClearMotionPreview === clearMotionPreview
      ) {
        delete (window as any).__designCanvasClearMotionPreview;
      }
      if (
        (window as any).__designCanvasSendShaderFillPreview ===
        sendShaderFillPreview
      ) {
        delete (window as any).__designCanvasSendShaderFillPreview;
      }
      if (
        (window as any).__designCanvasClearShaderFillPreview ===
        clearShaderFillPreview
      ) {
        delete (window as any).__designCanvasClearShaderFillPreview;
      }
    };
  }, [
    deleteRuntimeElement,
    registerRuntimeBridge,
    replacePreviewContent,
    sendStyleChange,
    sendMotionPreview,
    clearMotionPreview,
    sendShaderFillPreview,
    clearShaderFillPreview,
  ]);

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
  const embeddedFrameFluid = embeddedFrame?.fluid === true;

  // Per-breakpoint override: when previewWidthPx is set it takes priority over
  // the deviceFrame width so the caller can render the same source at an
  // explicit viewport width (e.g. 390 / 768 / 1280 side-by-side breakpoints).
  const resolvedWidth =
    previewWidthPx != null ? `${previewWidthPx}px` : iframeWidth;

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
        width: embeddedFrame
          ? embeddedFrameFluid
            ? "100%"
            : embeddedFrame.viewportWidth
          : resolvedWidth,
        height: embeddedFrame
          ? embeddedFrameFluid
            ? "100%"
            : embeddedFrame.viewportHeight
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
            : "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        }
        data-design-preview-iframe
        data-design-source-type={
          sourceType ??
          (externalPreviewUrl
            ? "localhost" // inferred — content is a URL
            : "inline")
        }
        className="block h-full w-full border-0 bg-transparent"
        title={t("designEditor.designPreview")}
      />
      {/* Draw-to-prompt overlay — sits over the iframe, NOT inside it. */}
      <SharedDrawOverlay
        visible={!!drawMode}
        canvasInteractive={!pinMode}
        queuedAnnotationCount={queuedAnnotationPins.length}
        zoom={zoom}
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
    if (embeddedFrameFluid) {
      return (
        <div
          ref={scrollContainerRef}
          className="relative h-full w-full overflow-hidden"
        >
          {iframeElement}
        </div>
      );
    }

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
