import { useRef, useEffect, useCallback, useMemo } from "react";
import { agentChat } from "@agent-native/core";
import { usePinchZoom } from "@agent-native/core/client";
import { cn } from "@/lib/utils";
import { DeviceFrame } from "./DeviceFrame";
import type { ElementInfo, DeviceFrameType } from "./types";
// NOTE: This wires up the NEW shared visual-editor DrawOverlay + comment-pin
// components from `@/components/visual-editor`. The legacy iframe-only
// DrawOverlay at `./DrawOverlay.tsx` is intentionally NOT used here — both
// exist for now and can be reconciled in a follow-up. Don't import both.
import {
  DrawOverlay as SharedDrawOverlay,
  CanvasCommentPins,
} from "@/components/visual-editor";

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
    if (e.origin !== window.location.origin) return;
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
    var parentDisplay = el.parentElement
      ? window.getComputedStyle(el.parentElement).display
      : undefined;
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
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
        borderColor: cs.borderColor,
        borderRadius: cs.borderRadius,
      },
      boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      textContent: el.textContent ? el.textContent.slice(0, 200) : undefined,
      isFlexContainer: cs.display === 'flex' || cs.display === 'inline-flex',
      isFlexChild: parentDisplay === 'flex' || parentDisplay === 'inline-flex',
      parentDisplay: parentDisplay,
    };
  }

  var highlightOverlay = document.createElement('div');
  highlightOverlay.setAttribute('data-agent-native-edit-overlay', 'highlight');
  highlightOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;border:2px solid #609FF8;background:rgba(96,159,248,0.08);display:none;';
  document.body.appendChild(highlightOverlay);

  var selectionOverlay = document.createElement('div');
  selectionOverlay.setAttribute('data-agent-native-edit-overlay', 'selection');
  selectionOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99998;border:2px solid #609FF8;background:rgba(96,159,248,0.12);display:none;';
  document.body.appendChild(selectionOverlay);

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

  document.addEventListener('click', function(e) {
    if (e.target && e.target.closest('[data-agent-native-edit-overlay]')) return;
    e.preventDefault();
    e.stopPropagation();
    selectedEl = e.target;
    var info = getElementInfo(selectedEl);
    positionOverlay(selectionOverlay, selectedEl);
    window.parent.postMessage({ type: 'element-select', payload: info }, window.location.origin);
  }, true);

  document.addEventListener('mouseover', function(e) {
    if (e.target && e.target.closest('[data-agent-native-edit-overlay]')) return;
    hoveredEl = e.target;
    positionOverlay(highlightOverlay, hoveredEl);
    var info = getElementInfo(hoveredEl);
    window.parent.postMessage({ type: 'element-hover', payload: info }, window.location.origin);
  }, true);

  document.addEventListener('mouseout', function() {
    hoveredEl = null;
    highlightOverlay.style.display = 'none';
  }, true);

  window.addEventListener('message', function(e) {
    if (e.origin !== window.location.origin) return;
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
}

export function DesignCanvas({
  content,
  zoom,
  onZoomChange,
  deviceFrame,
  editMode,
  onElementSelect,
  onElementHover,
  tweakValues,
  drawMode,
  onExitDrawMode,
  pinMode,
  onExitPinMode,
  designId,
  designTitle,
}: DesignCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
      TWEAK_BRIDGE_SCRIPT + (editMode ? EDIT_BRIDGE_SCRIPT : "");
    if (content.includes("</body>")) {
      return content.replace("</body>", bridgeToInject + "</body>");
    }
    if (content.includes("</html>")) {
      return content.replace("</html>", bridgeToInject + "</html>");
    }
    // No body/html tags — wrap it
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${content}${bridgeToInject}</body></html>`;
  }, [content, editMode]);

  // Listen for messages from the iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== window.location.origin) return;
      if (!e.data || !e.data.type) return;
      if (e.data.type === "element-select") {
        onElementSelect(e.data.payload);
      }
      if (e.data.type === "element-hover") {
        onElementHover(e.data.payload);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onElementSelect, onElementHover]);

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
        window.location.origin,
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
        window.location.origin,
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
        sandbox="allow-scripts allow-same-origin"
        className="border-0 bg-white block w-full h-full"
        title="Design Preview"
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
        contextId={designId || "design"}
        contextLabel={designTitle || designId || "design"}
      />
    </div>
  );
}
